/**
 * SwarmExecutionService
 *
 * Bridges the @jak-swarm/swarm runner with the WorkflowService (DB persistence).
 * Designed to be called from background tasks — HTTP handlers kick off execution
 * via setImmediate() and return 202 immediately; this service drives the swarm
 * and writes all results to Postgres.
 */
import { EventEmitter } from 'node:events';
import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { SwarmRunner, supervisorBus } from '@jak-swarm/swarm';
import type { SwarmResult } from '@jak-swarm/swarm';
import { Industry } from '@jak-swarm/shared';
import type { AgentTrace as SharedAgentTrace, ApprovalRequest as SharedApprovalRequest } from '@jak-swarm/shared';
import { getIndustryPack } from '@jak-swarm/industry-packs';
import { detectPII, detectInjection, AuditLogger, AuditAction } from '@jak-swarm/security';
import type { AuditPrismaClient } from '@jak-swarm/security';
import { WorkflowService } from './workflow.service.js';
import { DbWorkflowStateStore } from './db-state-store.js';

/**
 * Map the rich internal WorkflowStatus enum to the DB-persisted string literal.
 * The swarm uses fine-grained statuses; the API surface and DB use a simpler set.
 */
function mapSwarmStatusToDb(
  swarmStatus: string,
): 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' {
  switch (swarmStatus) {
    case 'PLANNING':
    case 'ROUTING':
    case 'EXECUTING':
    case 'VERIFYING':
    case 'RUNNING':
      return 'RUNNING';
    case 'AWAITING_APPROVAL':
      return 'PAUSED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'RUNNING';
  }
}

export interface ExecuteAsyncParams {
  workflowId: string;
  tenantId: string;
  userId: string;
  goal: string;
  industry?: string;
  maxCostUsd?: number;
}

export interface ResumeParams {
  workflowId: string;
  tenantId: string;
  decision: 'APPROVED' | 'REJECTED' | 'DEFERRED';
  reviewedBy: string;
  comment?: string;
}

export interface CancelParams {
  workflowId: string;
}

export class SwarmExecutionService extends EventEmitter {
  private readonly runner: SwarmRunner;
  private readonly workflowService: WorkflowService;
  private readonly audit: AuditLogger;
  private lockProvider: { acquire: (key: string, ttlMs: number) => Promise<string | null>; release: (key: string, token: string) => Promise<boolean> } | null = null;
  private redisPublisher: { publish: (ch: string, msg: string) => Promise<unknown> } | null = null;
  private instanceId = `jak-${process.pid}-${Date.now().toString(36)}`;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {
    super();
    const stateStore = new DbWorkflowStateStore(db);
    this.runner = new SwarmRunner({ defaultTimeoutMs: 5 * 60 * 1000, stateStore });
    this.workflowService = new WorkflowService(db, log);
    this.audit = new AuditLogger(db as unknown as AuditPrismaClient);
  }

  /** Inject distributed lock provider for multi-instance safety. */
  setLockProvider(provider: { acquire: (key: string, ttlMs: number) => Promise<string | null>; release: (key: string, token: string) => Promise<boolean> }): void {
    this.lockProvider = provider;
  }

  private circuitBreakerFactory: ((name: string, opts: { failureThreshold: number; resetTimeoutMs: number }) => { call: <T>(fn: () => Promise<T>) => Promise<T> }) | undefined;
  private creditServiceInstance: { reconcile: (params: Record<string, unknown>) => Promise<void> } | null = null;

  /** Inject distributed circuit breaker factory for multi-instance safety. */
  setCircuitBreakerFactory(factory: (name: string, opts: { failureThreshold: number; resetTimeoutMs: number }) => { call: <T>(fn: () => Promise<T>) => Promise<T> }): void {
    this.circuitBreakerFactory = factory;
  }

  /** Inject credit service for post-execution reconciliation. */
  setCreditService(service: { reconcile: (params: Record<string, unknown>) => Promise<void> }): void {
    this.creditServiceInstance = service;
  }

  /**
   * Enable cross-instance SSE event relay via Redis pub/sub.
   * When this is set, all .emit() calls also publish to a Redis channel,
   * and events from other instances are re-emitted locally.
   */
  enableRedisRelay(publisherRedis: unknown, subscriberRedis: unknown): void {
    this.redisPublisher = publisherRedis as SwarmExecutionService['redisPublisher'];

    const sub = subscriberRedis as { subscribe: (ch: string) => Promise<unknown>; on: (event: string, fn: (...args: unknown[]) => void) => void };
    sub.subscribe('jak:sse:events').catch((err: unknown) => {
      this.log.warn({ err }, '[SSE relay] Failed to subscribe to Redis channel');
    });

    sub.on('message', (_channel: unknown, message: unknown) => {
      try {
        const parsed = JSON.parse(String(message)) as { eventName: string; data: unknown; sourceInstance: string };
        // Only re-emit events from OTHER instances
        if (parsed.sourceInstance !== this.instanceId) {
          super.emit(parsed.eventName, parsed.data);
        }
      } catch {
        // Malformed message
      }
    });

    this.log.info('[SSE relay] Cross-instance event relay enabled via Redis');
  }

  /** Override emit to also publish to Redis for cross-instance SSE. */
  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    const result = super.emit(eventName, ...args);

    // Publish to Redis for other instances (only for workflow/project events)
    if (this.redisPublisher && typeof eventName === 'string' && (eventName.startsWith('workflow:') || eventName.startsWith('project:'))) {
      this.redisPublisher.publish('jak:sse:events', JSON.stringify({
        eventName,
        data: args[0],
        sourceInstance: this.instanceId,
      })).catch(() => { /* Redis unavailable — local-only mode */ });
    }

    return result;
  }

  /**
   * Launch swarm execution for a workflow. Intended to be called in the
   * background (e.g. via setImmediate) so the HTTP request returns 202 before
   * the swarm begins executing.
   *
   * Flow:
   *   1. Mark workflow RUNNING
   *   2. Run swarm graph
   *   3. Persist all agent traces to DB
   *   4. Persist any new approval requests to DB
   *   5. Update workflow to final status
   */
  async executeAsync(params: ExecuteAsyncParams): Promise<void> {
    const { workflowId, tenantId, userId, goal, industry } = params;

    // ── Distributed lock: prevent duplicate execution across instances ───
    let lockToken: string | null = null;
    if (this.lockProvider) {
      lockToken = await this.lockProvider.acquire(`workflow:exec:${workflowId}`, 10 * 60 * 1000); // 10 min TTL
      if (!lockToken) {
        this.log.warn({ workflowId }, '[Swarm] Workflow already running on another instance — skipping');
        return;
      }
    }

    this.log.info({ workflowId, tenantId }, '[Swarm] Starting async execution');

    // ── Guardrail: injection detection ───────────────────────────────────
    const injectionResult = detectInjection(goal);
    if (injectionResult.detected && injectionResult.risk === 'HIGH') {
      this.log.warn({ workflowId, patterns: injectionResult.patterns }, '[Guardrail] Injection attempt detected in goal');
      void this.audit.log({
        action: AuditAction.INJECTION_DETECTED,
        tenantId,
        userId,
        resource: 'workflow',
        resourceId: workflowId,
        details: { patterns: injectionResult.patterns, confidence: injectionResult.confidence },
      });
      await this.workflowService.updateWorkflowStatus(
        workflowId,
        'FAILED',
        'Goal rejected: potential prompt injection detected.',
      );
      this.emit(`workflow:${workflowId}`, { type: 'failed', workflowId, error: 'Goal rejected: potential prompt injection detected.', timestamp: new Date().toISOString() });
      return;
    }

    // ── Guardrail: PII detection ─────────────────────────────────────────
    const piiResult = detectPII(goal);
    if (piiResult.containsPII) {
      this.log.warn({ workflowId, piiTypes: piiResult.found }, '[Guardrail] PII detected in goal');
      void this.audit.log({
        action: AuditAction.PII_DETECTED,
        tenantId,
        userId,
        resource: 'workflow',
        resourceId: workflowId,
        details: { types: piiResult.found },
      });
    }

    try {
      await this.workflowService.updateWorkflowStatus(workflowId, 'RUNNING');
      this.emit(`workflow:${workflowId}`, { type: 'started', workflowId, timestamp: new Date().toISOString() });

      // Audit: workflow started
      void this.audit.log({
        action: AuditAction.WORKFLOW_STARTED,
        tenantId,
        userId,
        resource: 'workflow',
        resourceId: workflowId,
        details: { goal, industry },
      });

      // Publish to supervisor bus for cross-cutting coordination
      supervisorBus.publish('workflow:started', {
        type: 'workflow:started',
        tenantId,
        workflowId,
      });

      const tenant = await this.db.tenant.findUnique({ where: { id: tenantId } });
      const effectiveIndustry = (industry ?? tenant?.industry ?? Industry.GENERAL) as Industry;
      const industryPack = getIndustryPack(effectiveIndustry);
      const connectedIntegrations = await this.db.integration.findMany({
        where: { tenantId, status: 'CONNECTED' },
        select: { provider: true },
      });
      const connectedProviders = connectedIntegrations.map((i) => i.provider).filter((p): p is string => Boolean(p));

      const result = await this.runner.run({
        workflowId,
        tenantId,
        userId,
        goal,
        industry: effectiveIndustry,
        maxCostUsd: params.maxCostUsd,
        ...(this.circuitBreakerFactory ? { circuitBreakerFactory: this.circuitBreakerFactory } : {}),
        onStateChange: async (wfId: string, stateData: unknown) => {
          try {
            const s = stateData as Record<string, unknown>;
            await (this.db.workflow.update as any)({
              where: { id: wfId },
              data: {
                stateJson: stateData,
                status: (s.status as string) ?? 'RUNNING',
                totalCostUsd: (s.accumulatedCostUsd as number) ?? 0,
              },
            });
          } catch (stateErr) {
            this.log.error({ workflowId: wfId, err: stateErr instanceof Error ? stateErr.message : String(stateErr) },
              '[Swarm] CRITICAL: Failed to persist workflow state — state may be lost on restart');
          }
        },
        approvalThreshold: (tenant as any)?.approvalThreshold ?? undefined,
        allowedDomains: (tenant as any)?.allowedDomains ?? [],
        browserAutomationEnabled: Boolean((tenant as any)?.enableBrowserAutomation),
        restrictedCategories: industryPack.restrictedTools,
        connectedProviders,
        onAgentActivity: (data: unknown) => {
          this.emit(`workflow:${workflowId}`, data);
        },
      });

      await this.persistTraces(result, tenantId, workflowId);
      await this.persistApprovals(result, tenantId, workflowId);

      // Compile and save final output
      try {
        const traceRecords = await this.db.agentTrace.findMany({
          where: { workflowId },
          orderBy: { stepIndex: 'asc' },
          select: { agentRole: true, outputJson: true, stepIndex: true },
        });
        const finalOutput = this.compileFinalOutput(traceRecords as Array<{ agentRole: string; outputJson: unknown; stepIndex: number }>);
        await (this.db.workflow.update as any)({
          where: { id: workflowId },
          data: { finalOutput },
        });
      } catch (outErr) {
        this.log.warn({ workflowId, err: outErr instanceof Error ? outErr.message : String(outErr) },
          '[Swarm] Failed to persist final output');
      }

      const dbStatus = mapSwarmStatusToDb(result.status);
      await this.workflowService.updateWorkflowStatus(workflowId, dbStatus, result.error);

      if (dbStatus === 'COMPLETED') {
        this.emit(`workflow:${workflowId}`, { type: 'completed', workflowId, status: dbStatus, timestamp: new Date().toISOString() });
        void this.audit.log({
          action: AuditAction.WORKFLOW_COMPLETED,
          tenantId,
          userId,
          resource: 'workflow',
          resourceId: workflowId,
          details: { durationMs: result.durationMs, traceCount: result.traces.length },
        });
      } else if (dbStatus === 'FAILED') {
        this.emit(`workflow:${workflowId}`, { type: 'failed', workflowId, error: result.error, timestamp: new Date().toISOString() });
        void this.audit.log({
          action: AuditAction.WORKFLOW_FAILED,
          tenantId,
          userId,
          resource: 'workflow',
          resourceId: workflowId,
          details: { error: result.error, durationMs: result.durationMs },
        });
      }

      // Publish completion to supervisor bus
      supervisorBus.publish('workflow:completed', {
        type: 'workflow:completed',
        tenantId,
        workflowId,
        status: dbStatus,
        durationMs: result.durationMs,
        taskCount: result.traces.length,
        failedCount: result.traces.filter(t => t.error).length,
      });

      // ── Credit reconciliation: record actual usage to ledger ──────────
      if (this.creditServiceInstance) {
        try {
          const actualCostUsd = result.traces.reduce((sum: number, t: { costUsd?: number }) =>
            sum + (typeof t.costUsd === 'number' ? t.costUsd : 0), 0);
          const actualCredits = Math.max(1, Math.ceil(actualCostUsd * 100));
          const totalTokens = result.traces.reduce((sum: number, t: { tokenUsage?: { totalTokens?: number } }) =>
            sum + (t.tokenUsage?.totalTokens ?? 0), 0);

          await this.creditServiceInstance.reconcile({
            tenantId,
            userId,
            workflowId,
            taskType: 'agent_workflow',
            modelUsed: 'mixed',
            provider: 'mixed',
            inputTokens: Math.round(totalTokens * 0.6),
            outputTokens: Math.round(totalTokens * 0.4),
            actualCredits,
            reservedCredits: actualCredits, // Best estimate; real reservation tracked upstream
            usdCost: actualCostUsd,
            latencyMs: result.durationMs,
            status: dbStatus === 'COMPLETED' ? 'completed' : 'failed',
          });
          this.log.debug({ workflowId, actualCredits, actualCostUsd }, '[billing] Workflow usage reconciled');
        } catch (reconcileErr) {
          this.log.warn({ workflowId, err: reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr) },
            '[billing] Credit reconciliation failed');
        }
      }

      this.log.info(
        { workflowId, dbStatus, durationMs: result.durationMs, traces: result.traces.length },
        '[Swarm] Execution completed',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error({ workflowId, err: message }, '[Swarm] Execution threw unexpected error');
      this.emit(`workflow:${workflowId}`, { type: 'failed', workflowId, error: message, timestamp: new Date().toISOString() });
      try {
        await this.workflowService.updateWorkflowStatus(workflowId, 'FAILED', message);
      } catch (dbErr) {
        this.log.error({ workflowId, dbErr }, '[Swarm] Failed to mark workflow FAILED after error');
      }
    } finally {
      // ── Release distributed lock ──────────────────────────────────────
      if (this.lockProvider && lockToken) {
        await this.lockProvider.release(`workflow:exec:${workflowId}`, lockToken).catch((relErr) => {
          this.log.warn({ workflowId, err: relErr }, '[Swarm] Failed to release workflow lock (will expire via TTL)');
        });
      }
    }
  }

  /**
   * Resume a paused workflow after a reviewer has submitted an approval decision.
   *
   * - APPROVED  → resume the swarm from the worker node
   * - REJECTED  → cancel the workflow immediately
   * - DEFERRED  → leave PAUSED (no-op in swarm; DB status already PAUSED)
   */
  async resumeAfterApproval(params: ResumeParams): Promise<void> {
    const { workflowId, tenantId, decision, reviewedBy, comment } = params;

    this.log.info({ workflowId, decision, reviewedBy }, '[Swarm] Resuming after approval decision');

    if (decision === 'REJECTED') {
      await this.workflowService.updateWorkflowStatus(
        workflowId,
        'CANCELLED',
        `Rejected by ${reviewedBy}${comment ? `: ${comment}` : ''}`,
      );
      return;
    }

    if (decision === 'DEFERRED') {
      // Leave workflow in PAUSED; reviewer will act again later
      this.log.info({ workflowId }, '[Swarm] Approval deferred; workflow stays PAUSED');
      return;
    }

    // APPROVED — re-run from where we left off
    try {
      await this.workflowService.updateWorkflowStatus(workflowId, 'RUNNING');

      const result = await this.runner.resume(workflowId, {
        status: 'APPROVED',
        reviewedBy,
        comment,
      });

      await this.persistTraces(result, tenantId, workflowId);
      await this.persistApprovals(result, tenantId, workflowId);

      const dbStatus = mapSwarmStatusToDb(result.status);
      await this.workflowService.updateWorkflowStatus(workflowId, dbStatus, result.error);

      this.log.info({ workflowId, dbStatus }, '[Swarm] Resumed workflow completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error({ workflowId, err: message }, '[Swarm] Resume threw unexpected error');
      try {
        await this.workflowService.updateWorkflowStatus(workflowId, 'FAILED', message);
      } catch (dbErr) {
        this.log.error({ workflowId, dbErr }, '[Swarm] Failed to mark workflow FAILED after resume error');
      }
    }
  }

  /**
   * Signal the in-memory runner to stop a running workflow.
   * The DB status should be updated separately via WorkflowService.cancelWorkflow().
   */
  async cancelWorkflow(params: CancelParams): Promise<void> {
    await this.runner.cancel(params.workflowId);
  }

  /** Pause a running workflow (it will pause between nodes). */
  pauseWorkflow(workflowId: string): void {
    this.runner.pause(workflowId);
  }

  /** Remove the pause signal so the workflow can be resumed. */
  unpauseWorkflow(workflowId: string): void {
    this.runner.unpause(workflowId);
  }

  /** Signal the runner to cancel a workflow immediately. */
  stopWorkflow(workflowId: string): void {
    this.runner.stop(workflowId);
  }

  /** Resume a previously paused workflow from its saved state. */
  async resumeWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.db.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) return;

    this.log.info({ workflowId }, '[Swarm] Resuming paused workflow');

    try {
      await this.workflowService.updateWorkflowStatus(workflowId, 'RUNNING');

      const result = await this.runner.resume(workflowId, {
        status: 'APPROVED',
        reviewedBy: 'system',
      }, {
        loadState: async (id: string) => {
          const wf = await this.db.workflow.findUnique({ where: { id } });
          return (wf as any)?.stateJson ?? undefined;
        },
      });

      await this.persistTraces(result, workflow.tenantId, workflowId);

      const dbStatus = mapSwarmStatusToDb(result.status);
      await this.workflowService.updateWorkflowStatus(workflowId, dbStatus, result.error);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error({ workflowId, err: message }, '[Swarm] Resume paused workflow failed');
      try {
        await this.workflowService.updateWorkflowStatus(workflowId, 'FAILED', message);
      } catch { /* best effort */ }
    }
  }

  /**
   * Mark any workflows that were mid-execution when the server restarted as FAILED.
   * Call this once on startup so stale in-progress workflows don't hang forever.
   */
  async recoverStaleWorkflows(): Promise<void> {
    try {
      const stale = await this.db.workflow.findMany({
        where: { status: { in: ['RUNNING', 'EXECUTING', 'VERIFYING'] } },
        select: { id: true, tenantId: true, goal: true, status: true, updatedAt: true },
      });
      for (const wf of stale) {
        const staleDurationMs = Date.now() - new Date(wf.updatedAt).getTime();
        await this.db.workflow.update({
          where: { id: wf.id },
          data: {
            status: 'FAILED',
            error: `Server restarted during execution (was ${wf.status} for ${Math.round(staleDurationMs / 1000)}s). Workflow state preserved in stateJson — resubmit to retry.`,
            completedAt: new Date(),
          },
        });
        this.log.warn({
          workflowId: wf.id,
          tenantId: wf.tenantId,
          previousStatus: wf.status,
          staleDurationMs,
        }, '[recovery] Marked stale workflow as FAILED');
      }
      if (stale.length > 0) {
        this.log.info({ count: stale.length }, '[recovery] Stale workflow recovery complete');
      }
    } catch (err) {
      this.log.error({ err }, '[recovery] Failed to recover stale workflows');
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async persistTraces(
    result: SwarmResult,
    tenantId: string,
    workflowId: string,
  ): Promise<void> {
    const traces = result.traces as SharedAgentTrace[];
    for (const trace of traces) {
      try {
        await this.workflowService.saveTrace({
          workflowId,
          tenantId,
          traceId: trace.traceId,
          runId: trace.runId,
          agentRole: String(trace.agentRole),
          stepIndex: trace.stepIndex,
          startedAt: trace.startedAt,
          completedAt: trace.completedAt,
          durationMs: trace.durationMs,
          inputJson: trace.input as Record<string, unknown>,
          outputJson: trace.output as Record<string, unknown>,
          toolCallsJson: { calls: trace.toolCalls } as Record<string, unknown>,
          handoffsJson: { handoffs: trace.handoffs } as Record<string, unknown>,
          tokenUsage: trace.tokenUsage
            ? (trace.tokenUsage as Record<string, unknown>)
            : undefined,
          error: trace.error,
        });
      } catch (err) {
        this.log.warn(
          { workflowId, agentRole: trace.agentRole, err },
          '[Swarm] Failed to persist agent trace — continuing',
        );
      }
    }
  }

  private async persistApprovals(
    result: SwarmResult,
    tenantId: string,
    workflowId: string,
  ): Promise<void> {
    const approvals = result.pendingApprovals as SharedApprovalRequest[];
    for (const approval of approvals) {
      try {
        // Idempotency: skip if this task's approval was already persisted
        const existing = await this.db.approvalRequest.findFirst({
          where: { workflowId, taskId: approval.taskId },
          select: { id: true },
        });

        if (existing) continue;

        await this.workflowService.createApprovalRequest({
          workflowId,
          tenantId,
          taskId: approval.taskId,
          agentRole: String(approval.agentRole),
          action: approval.action,
          rationale: approval.rationale,
          proposedDataJson: approval.proposedData as Record<string, unknown>,
          riskLevel: String(approval.riskLevel),
        });
      } catch (err) {
        this.log.warn(
          { workflowId, taskId: approval.taskId, err },
          '[Swarm] Failed to persist approval request — continuing',
        );
      }
    }
  }

  private compileFinalOutput(traces: Array<{ agentRole: string; outputJson: unknown; stepIndex: number }>): string {
    if (!traces || traces.length === 0) return 'No output produced.';

    const sections: string[] = [];
    const sorted = [...traces].sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));

    for (const trace of sorted) {
      if (!trace.outputJson) continue;
      const output = trace.outputJson as Record<string, unknown>;
      const role = (trace.agentRole ?? 'Agent').replace('WORKER_', '').replace(/_/g, ' ');

      let content = '';
      if (typeof output === 'string') {
        content = output;
      } else if (output.content && typeof output.content === 'string') {
        content = output.content;
      } else if (output.summary && typeof output.summary === 'string') {
        content = output.summary;
      } else if (output.document && typeof output.document === 'string') {
        content = output.document;
      } else if (output.result && typeof output.result === 'string') {
        content = output.result;
      } else {
        content = JSON.stringify(output, null, 2);
        if (content.length > 10000) {
          content = content.slice(0, 10000) + '\n\n[Output truncated — full data available in workflow traces]';
        }
      }

      if (content.trim()) {
        sections.push(`## ${role}\n\n${content}`);
      }
    }

    return sections.length > 0 ? sections.join('\n\n---\n\n') : 'Workflow completed but produced no readable output.';
  }
}
