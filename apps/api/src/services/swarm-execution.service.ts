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
import { Industry, ToolRiskClass } from '@jak-swarm/shared';
import type { AgentTrace as SharedAgentTrace, ApprovalRequest as SharedApprovalRequest } from '@jak-swarm/shared';
import { getIndustryPack } from '@jak-swarm/industry-packs';
import { detectPII, detectInjection, AuditLogger, AuditAction, classifyToolRisk } from '@jak-swarm/security';
import type { AuditPrismaClient } from '@jak-swarm/security';
import { toolRegistry } from '@jak-swarm/tools';
import { WorkflowService } from './workflow.service.js';
import { DbWorkflowStateStore } from './db-state-store.js';
import { QueueWorker } from './queue-worker.js';
import type { WorkflowJobRow, WorkerHealth } from './queue-worker.js';

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
  roleModes?: string[];
  maxCostUsd?: number;
  /** Caller-provided idempotency key to prevent duplicate execution on replays. */
  idempotencyKey?: string;
  /**
   * Coarse tier for gating paid external services (Serper / Tavily). Populated
   * at workflow creation from `Subscription.maxModelTier`. 'free' forces DDG-only
   * search chain; 'paid' (or undefined) allows Serper primary.
   */
  subscriptionTier?: 'free' | 'paid';
  /**
   * Which workflow pipeline to run. Default 'standard' drives the general
   * SwarmGraph (commander → planner → worker → verifier). 'vibe-coder' drives
   * the dedicated Architect → Generator → Debugger → Deployer chain with
   * build-check + retry loop.
   */
  workflowKind?: 'standard' | 'vibe-coder';
  /** Optional payload for vibe-coder workflows (app spec + builder inputs). */
  vibeCoderInput?: {
    description: string;
    framework?: string;
    features?: string[];
    existingFiles?: Array<{ path: string; content: string; language: string }>;
    projectName?: string;
    envVars?: Record<string, string>;
    deployAfterBuild?: boolean;
    maxDebugRetries?: number;
    /**
     * Optional — when set, the executor persists generated files to this
     * project (via ProjectService) and records a checkpoint (via
     * CheckpointService) after each stage. Absent = ephemeral run, no
     * project rows touched.
     */
    projectId?: string;
  };
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

/** Control actions that flow through the durable queue alongside normal executions. */
export type ControlAction = 'resume' | 'cancel';

export interface EnqueueControlParams {
  action: ControlAction;
  workflowId: string;
  tenantId: string;
  userId: string;
  /** Required for action='resume'. Ignored for action='cancel'. */
  decision?: 'APPROVED' | 'REJECTED' | 'DEFERRED';
  /** Required for action='resume'. The reviewer's userId. */
  reviewedBy?: string;
  /** Optional free-text comment attached to the resume decision. */
  comment?: string;
  /** Idempotency key — prevents duplicate execution on network retries. */
  idempotencyKey?: string;
}

type ReplaySafetyClass =
  | 'REPLAY_SAFE'
  | 'REPLAY_UNSAFE'
  | 'REQUIRES_IDEMPOTENCY_KEY'
  | 'MANUAL_INTERVENTION_REQUIRED';

function classifyReplaySafety(state: Record<string, unknown>): {
  safety: ReplaySafetyClass;
  reason: string;
  taskId?: string;
} {
  const plan = state['plan'] as { tasks?: Array<Record<string, unknown>> } | undefined;
  const currentTaskIndex = typeof state['currentTaskIndex'] === 'number'
    ? state['currentTaskIndex']
    : 0;
  const task = plan?.tasks?.[currentTaskIndex];

  if (!task) {
    return { safety: 'REPLAY_SAFE', reason: 'No active task at checkpoint boundary' };
  }

  const taskId = typeof task['id'] === 'string' ? task['id'] : undefined;
  const requiresApproval = Boolean(task['requiresApproval']);
  const tools = Array.isArray(task['toolsRequired'])
    ? task['toolsRequired'].filter((v): v is string => typeof v === 'string')
    : [];

  const toolRisks = tools.map((name) => {
    const metadata = toolRegistry.get(name)?.metadata;
    return {
      name,
      riskClass: classifyToolRisk(name, metadata),
      requiresApproval: metadata?.requiresApproval ?? false,
    };
  });

  const hasExternalOrDestructive = toolRisks.some((tool) =>
    tool.riskClass === ToolRiskClass.EXTERNAL_SIDE_EFFECT || tool.riskClass === ToolRiskClass.DESTRUCTIVE,
  );
  const hasWrite = toolRisks.some((tool) => tool.riskClass === ToolRiskClass.WRITE);
  const toolRequiresApproval = toolRisks.some((tool) => tool.requiresApproval);

  if (requiresApproval || toolRequiresApproval || hasExternalOrDestructive) {
    return {
      safety: 'MANUAL_INTERVENTION_REQUIRED',
      reason: 'Task includes approval-gated or high side-effect tools that are not replay-safe',
      taskId,
    };
  }

  const readOnlyOnly = tools.length === 0 || toolRisks.every((tool) => tool.riskClass === ToolRiskClass.READ_ONLY);

  if (readOnlyOnly) {
    return {
      safety: 'REPLAY_SAFE',
      reason: 'Task appears read-only or analysis-only',
      taskId,
    };
  }

  if (hasWrite) {
    return {
      safety: 'REQUIRES_IDEMPOTENCY_KEY',
      reason: 'Task includes write tools; replay should use idempotency keys before auto-resume',
      taskId,
    };
  }

  return {
    safety: 'REPLAY_UNSAFE',
    reason: 'Task includes unclassified tools; replay safety cannot be guaranteed',
    taskId,
  };
}

export class SwarmExecutionService extends EventEmitter {
  private readonly runner: SwarmRunner;
  private readonly workflowService: WorkflowService;
  private readonly audit: AuditLogger;
  private readonly queueWorker: QueueWorker;
  private readonly maxConcurrentExecutions = Math.max(
    1,
    Number.parseInt(process.env['WORKFLOW_QUEUE_CONCURRENCY'] ?? '2', 10) || 2,
  );
  private readonly queuePollIntervalMs = Math.max(
    250,
    Number.parseInt(process.env['WORKFLOW_QUEUE_POLL_INTERVAL_MS'] ?? '1000', 10) || 1000,
  );
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

    // Instantiate the dedicated queue worker — delegates job claiming/retry/DLQ.
    // Jobs carry an optional `action` discriminator in their payload so the same queue
    // can durably process executions, resume-after-approval, and cancels. Jobs without
    // an `action` field default to 'execute' for backwards compatibility with any rows
    // created before this change.
    this.queueWorker = new QueueWorker(db, log, async (job: WorkflowJobRow) => {
      const payload = (job.payloadJson ?? {}) as Record<string, unknown> & { action?: string };
      const action = typeof payload.action === 'string' ? payload.action : 'execute';
      try {
        if (action === 'resume') {
          await this.resumeAfterApproval({
            workflowId: job.workflowId,
            tenantId: job.tenantId,
            decision: payload['decision'] as ResumeParams['decision'],
            reviewedBy: String(payload['reviewedBy'] ?? job.userId),
            comment: typeof payload['comment'] === 'string' ? (payload['comment'] as string) : undefined,
          });
        } else if (action === 'cancel') {
          await this.cancelWorkflow({ workflowId: job.workflowId });
        } else {
          // Dispatch on workflowKind — 'vibe-coder' drives the dedicated
          // Architect → Generator → BuildCheck → Debugger → Deployer chain;
          // anything else (or undefined) runs the general SwarmGraph.
          const kind = typeof payload['workflowKind'] === 'string' ? payload['workflowKind'] : 'standard';
          if (kind === 'vibe-coder') {
            await this.executeVibeCoderAsync(payload as unknown as ExecuteAsyncParams);
          } else {
            await this.executeAsync(payload as unknown as ExecuteAsyncParams);
          }
        }
        const workflow = await this.db.workflow.findUnique({
          where: { id: job.workflowId },
          select: { status: true, error: true },
        });
        return String(workflow?.status ?? 'FAILED') === 'FAILED' ? 'FAILED' : 'COMPLETED';
      } catch {
        return 'FAILED';
      }
    }, {
      maxConcurrent: this.maxConcurrentExecutions,
      pollIntervalMs: this.queuePollIntervalMs,
    });

    // Forward worker lifecycle events for observability
    this.queueWorker.on('job:claimed', (e) => this.emit('worker:job:claimed', e));
    this.queueWorker.on('job:completed', (e) => this.emit('worker:job:completed', e));
    this.queueWorker.on('job:retried', (e) => this.emit('worker:job:retried', e));
    this.queueWorker.on('job:dead', (e) => this.emit('worker:job:dead', e));
  }

  /** Inject distributed lock provider for multi-instance safety. */
  setLockProvider(provider: { acquire: (key: string, ttlMs: number) => Promise<string | null>; release: (key: string, token: string) => Promise<boolean> }): void {
    this.lockProvider = provider;
  }

  /**
   * Enqueue a workflow execution request.
   *
   * This provides backpressure and durable intent semantics:
   * the workflow row remains in PENDING until a queue worker claims it.
   */
  enqueueExecution(params: ExecuteAsyncParams): boolean {
    // Tag the payload with an explicit action so the processor's dispatch is unambiguous
    // even alongside resume/cancel control jobs in the same queue.
    void this.upsertWorkflowJob({ ...params, action: 'execute' }).catch((err) => {
      this.log.error(
        { workflowId: params.workflowId, err: err instanceof Error ? err.message : String(err) },
        '[SwarmQueue] Failed to enqueue workflow job',
      );
    });
    return true;
  }

  /**
   * Enqueue a durable control action (resume-after-approval, cancel).
   *
   * Replaces the previous `setImmediate(() => resumeAfterApproval(...))` pattern in the
   * route handlers — that was fire-and-forget and would be lost if the API crashed after
   * returning 202 but before the task fired. Control jobs share the `workflow_jobs` table
   * with execution jobs and get the same atomic claim, retry/backoff, and dead-letter
   * semantics that executions already have.
   */
  enqueueControl(params: EnqueueControlParams): boolean {
    const { action, workflowId, tenantId, userId, decision, reviewedBy, comment, idempotencyKey } = params;

    if (action === 'resume' && (!decision || !reviewedBy)) {
      this.log.error(
        { workflowId, action },
        '[SwarmQueue] enqueueControl(resume) requires decision and reviewedBy',
      );
      return false;
    }

    const payload: Record<string, unknown> = {
      action,
      workflowId,
      tenantId,
      userId,
    };
    if (decision) payload['decision'] = decision;
    if (reviewedBy) payload['reviewedBy'] = reviewedBy;
    if (comment) payload['comment'] = comment;
    if (idempotencyKey) payload['idempotencyKey'] = idempotencyKey;

    void this.upsertWorkflowJob(payload as { workflowId: string; tenantId: string; userId: string } & Record<string, unknown>).catch((err) => {
      this.log.error(
        { workflowId, action, err: err instanceof Error ? err.message : String(err) },
        '[SwarmQueue] Failed to enqueue control action',
      );
    });
    return true;
  }

  async getQueueStats(): Promise<{
    queued: number;
    active: number;
    completed: number;
    failed: number;
    dead: number;
    running: number;
    maxConcurrent: number;
  }> {
    const jobModel = (this.db as any).workflowJob;
    if (!jobModel) {
      return {
        queued: 0,
        active: 0,
        completed: 0,
        failed: 0,
        dead: 0,
        running: this.queueWorker.runningWorkflowIds.size,
        maxConcurrent: this.maxConcurrentExecutions,
      };
    }

    const [queued, active, completed, failed, dead] = await Promise.all([
      jobModel.count({ where: { status: 'QUEUED' } }),
      jobModel.count({ where: { status: 'ACTIVE' } }),
      jobModel.count({ where: { status: 'COMPLETED' } }),
      jobModel.count({ where: { status: 'FAILED' } }),
      jobModel.count({ where: { status: 'DEAD' } }),
    ]);

    return {
      queued,
      active,
      completed,
      failed,
      dead,
      running: this.queueWorker.runningWorkflowIds.size,
      maxConcurrent: this.maxConcurrentExecutions,
    };
  }

  private circuitBreakerFactory: ((name: string, opts: { failureThreshold: number; resetTimeoutMs: number }) => { call: <T>(fn: () => Promise<T>) => Promise<T> }) | undefined;
  private creditServiceInstance: { reconcile: (params: Record<string, unknown>) => Promise<void> } | null = null;

  /** Inject distributed circuit breaker factory for multi-instance safety. */
  setCircuitBreakerFactory(factory: (name: string, opts: { failureThreshold: number; resetTimeoutMs: number }) => { call: <T>(fn: () => Promise<T>) => Promise<T> }): void {
    this.circuitBreakerFactory = factory;
  }

  startQueueWorker(): void {
    this.queueWorker.start();
  }

  stopQueueWorker(): void {
    this.queueWorker.stop();
  }

  /** Graceful shutdown: stop polling and wait for in-flight jobs. */
  async drainQueueWorker(): Promise<void> {
    await this.queueWorker.drain();
  }

  /** Expose worker health for operator diagnostics. */
  getWorkerHealth(): WorkerHealth {
    return this.queueWorker.health();
  }

  /**
   * Persist a durable job row keyed by workflowId. Accepts any payload shape carrying at
   * minimum { workflowId, tenantId, userId } — the rest of the object is stored verbatim
   * in payloadJson and interpreted by the processor (via the `action` discriminator).
   */
  private async upsertWorkflowJob(
    params: { workflowId: string; tenantId: string; userId: string } & Record<string, unknown>,
  ): Promise<void> {
    const jobModel = (this.db as any).workflowJob;
    if (!jobModel) {
      this.log.warn({ workflowId: params.workflowId }, '[SwarmQueue] workflow_jobs model unavailable; executing immediately');
      // Fallback path only runs for execution jobs (no action, or action='execute').
      const actionField = (params as Record<string, unknown>)['action'];
      const action = typeof actionField === 'string' ? actionField : 'execute';
      if (action === 'execute') {
        void this.executeAsync(params as unknown as ExecuteAsyncParams);
      } else {
        this.log.warn(
          { workflowId: params.workflowId, action },
          '[SwarmQueue] Control action dropped — workflow_jobs model unavailable',
        );
      }
      return;
    }

    const payload = params as unknown as Record<string, unknown>;
    const existing = await jobModel.findUnique({ where: { workflowId: params.workflowId } });
    if (existing) {
      if (existing.status === 'COMPLETED') {
        this.log.warn({ workflowId: params.workflowId }, '[SwarmQueue] Workflow already completed; enqueue ignored');
        return;
      }

      await jobModel.update({
        where: { workflowId: params.workflowId },
        data: {
          status: 'QUEUED',
          payloadJson: payload,
          availableAt: new Date(),
          lastError: null,
          completedAt: null,
        },
      });
      return;
    }

    await jobModel.create({
      data: {
        workflowId: params.workflowId,
        tenantId: params.tenantId,
        userId: params.userId,
        status: 'QUEUED',
        attempts: 0,
        maxAttempts: 5,
        payloadJson: payload,
        availableAt: new Date(),
      },
    });
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

    // ── Idempotency guard: prevent duplicate execution for the same request ──
    if (params.idempotencyKey) {
      const existing = await this.db.workflow.findUnique({
        where: { id: workflowId },
        select: { status: true, stateJson: true },
      });
      const existingState = (existing?.stateJson ?? {}) as Record<string, unknown>;
      const existingIdemKey = (existingState['__checkpoint'] as Record<string, unknown> | undefined)?.['idempotencyKey'];
      if (existingIdemKey === params.idempotencyKey && existing?.status === 'COMPLETED') {
        this.log.info({ workflowId, idempotencyKey: params.idempotencyKey },
          '[Swarm] Duplicate execution blocked by idempotency key — workflow already completed');
        return;
      }
    }

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
        roleModes: params.roleModes,
        maxCostUsd: params.maxCostUsd,
        idempotencyKey: params.idempotencyKey,
        subscriptionTier: params.subscriptionTier,
        ...(this.circuitBreakerFactory ? { circuitBreakerFactory: this.circuitBreakerFactory } : {}),
        onStateChange: async (wfId: string, stateData: unknown) => {
          try {
            const s = stateData as Record<string, unknown>;
            const normalizedStatus = mapSwarmStatusToDb(String(s.status ?? 'RUNNING'));
            const replaySafety = classifyReplaySafety(s);
            const checkpoint = {
              ...s,
              __checkpoint: {
                version: 2,
                checkpointAt: new Date().toISOString(),
                replaySafety: replaySafety.safety,
                replayReason: replaySafety.reason,
                replayTaskId: replaySafety.taskId,
                idempotencyKey: params.idempotencyKey ?? null,
                instanceId: this.instanceId,
              },
            };
            await (this.db.workflow.update as any)({
              where: { id: wfId },
              data: {
                stateJson: checkpoint,
                status: normalizedStatus,
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
        disabledToolNames: tenant?.disabledToolNames ?? [],
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
      const traceError = result.traces.find((t: { error?: string }) => t.error)?.error;
      const errorMessage = result.error
        ?? traceError
        ?? (dbStatus === 'FAILED'
          ? 'Workflow failed without error details. Check traces for the failing node.'
          : undefined);
      await this.workflowService.updateWorkflowStatus(workflowId, dbStatus, errorMessage);

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
        this.emit(`workflow:${workflowId}`, { type: 'failed', workflowId, error: errorMessage, timestamp: new Date().toISOString() });
        void this.audit.log({
          action: AuditAction.WORKFLOW_FAILED,
          tenantId,
          userId,
          resource: 'workflow',
          resourceId: workflowId,
          details: { error: errorMessage, durationMs: result.durationMs },
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
   * Execute the Vibe Coder workflow (Architect → Generator → Build-check →
   * Debugger ↻ → Deployer) as the processor for a queued job whose payload
   * carries `workflowKind: 'vibe-coder'`.
   *
   * Persists workflow status + the final result (files, deployment URL,
   * build logs) to the workflow DB row. Emits SSE events so the builder UI
   * can render progress live.
   */
  async executeVibeCoderAsync(params: ExecuteAsyncParams): Promise<void> {
    const { workflowId, tenantId, userId, subscriptionTier, vibeCoderInput } = params;

    if (!vibeCoderInput || !vibeCoderInput.description) {
      this.log.error(
        { workflowId },
        '[VibeCoder] Missing vibeCoderInput or description in payload',
      );
      await this.workflowService.updateWorkflowStatus(
        workflowId,
        'FAILED',
        'Missing vibe-coder input payload',
      );
      return;
    }

    this.log.info(
      { workflowId, tenantId, framework: vibeCoderInput.framework },
      '[VibeCoder] Starting workflow',
    );

    await this.workflowService.updateWorkflowStatus(workflowId, 'RUNNING');

    const { runVibeCoderWorkflow } = await import('@jak-swarm/swarm');

    // Lazy-import the checkpoint and project services so swarm-execution can
    // stay agnostic to builder-specific concerns when no projectId is given.
    const { CheckpointService } = await import('./checkpoint.service.js');
    const { ProjectService } = await import('./project.service.js');
    const projectId = vibeCoderInput.projectId;
    const checkpointService = projectId ? new CheckpointService(this.db, this.log) : null;
    const projectService = projectId ? new ProjectService(this.db, this.log) : null;

    try {
      const result = await runVibeCoderWorkflow({
        workflowId,
        tenantId,
        userId,
        subscriptionTier,
        description: vibeCoderInput.description,
        framework: vibeCoderInput.framework,
        features: vibeCoderInput.features,
        existingFiles: vibeCoderInput.existingFiles,
        projectName: vibeCoderInput.projectName,
        envVars: vibeCoderInput.envVars,
        deployAfterBuild: vibeCoderInput.deployAfterBuild ?? true,
        maxDebugRetries: vibeCoderInput.maxDebugRetries ?? 3,
        onProgress: (event) => {
          // Relay progress to SSE subscribers listening on /workflows/:id/stream.
          this.emit(`workflow:${workflowId}`, {
            type: 'vibe_coder:progress',
            workflowId,
            event: event.type,
            data: event.data,
            timestamp: event.timestamp,
          });
        },
        onCheckpoint: projectId && checkpointService && projectService
          ? async (stage, ctx) => {
              // Persist the current file set to the project, then snapshot it.
              // Both steps are best-effort — the vibe-coder workflow already
              // swallows checkpoint errors, but we still log here for the
              // operator's audit trail.
              try {
                await projectService.saveFiles(
                  projectId,
                  ctx.files.map((f) => ({ path: f.path, content: f.content, language: f.language })),
                );
                const snap = await checkpointService.createCheckpoint({
                  projectId,
                  tenantId,
                  stage,
                  workflowId,
                  createdBy: `workflow:${stage}`,
                  description:
                    stage === 'debugger' && typeof ctx.attempt === 'number'
                      ? `Checkpoint after debugger retry #${ctx.attempt}`
                      : undefined,
                });
                this.emit(`workflow:${workflowId}`, {
                  type: 'vibe_coder:checkpoint',
                  workflowId,
                  projectId,
                  stage,
                  version: snap.version,
                  hasChanges: snap.diff?.hasChanges ?? false,
                  timestamp: new Date().toISOString(),
                });
              } catch (err) {
                this.log.warn(
                  { workflowId, projectId, stage, err: err instanceof Error ? err.message : String(err) },
                  '[VibeCoder] Checkpoint persistence failed (non-fatal)',
                );
              }
            }
          : undefined,
      });

      // Persist the final result to the workflow row.
      const finalStatus =
        result.status === 'completed'
          ? 'COMPLETED'
          : result.status === 'needs_user_input'
          ? 'PAUSED'
          : 'FAILED';

      await (this.db.workflow.update as any)({
        where: { id: workflowId },
        data: {
          status: finalStatus,
          error: result.error ?? null,
          finalOutput: JSON.stringify({
            kind: 'vibe-coder',
            files: result.files,
            deployment: result.deployment,
            buildLogs: result.buildLogs,
            debugAttempts: result.debugAttempts,
            userQuestion: result.userQuestion,
            architecture: result.architecture?.architecture,
          }),
          completedAt: finalStatus === 'PAUSED' ? null : new Date(),
        },
      });

      this.emit(`workflow:${workflowId}`, {
        type: 'vibe_coder:completed',
        workflowId,
        status: result.status,
        deploymentUrl: result.deployment?.deploymentUrl,
        fileCount: result.files.length,
        debugAttempts: result.debugAttempts,
        durationMs: result.durationMs,
        timestamp: new Date().toISOString(),
      });

      this.log.info(
        {
          workflowId,
          status: result.status,
          fileCount: result.files.length,
          debugAttempts: result.debugAttempts,
          durationMs: result.durationMs,
        },
        '[VibeCoder] Workflow finished',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error({ workflowId, err: message }, '[VibeCoder] Workflow threw unexpected error');
      await this.workflowService.updateWorkflowStatus(workflowId, 'FAILED', message);
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
   * Recover queue intent after restart.
   *
   * - PENDING workflows are re-enqueued.
   * - RUNNING/EXECUTING/VERIFYING workflows are moved back to PENDING and re-enqueued.
   *
   * This preserves durable execution intent rather than failing all in-flight work.
   */
  async recoverStaleWorkflows(): Promise<void> {
    try {
      const jobModel = (this.db as any).workflowJob;
      if (jobModel) {
        const activeJobs = await jobModel.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, workflowId: true, attempts: true, maxAttempts: true, updatedAt: true },
        });

        for (const job of activeJobs) {
          const staleDurationMs = Date.now() - new Date(job.updatedAt).getTime();
          const shouldRetry = (job.attempts ?? 0) < (job.maxAttempts ?? 5);
          await jobModel.update({
            where: { id: job.id },
            data: shouldRetry
              ? {
                  status: 'QUEUED',
                  availableAt: new Date(),
                  lastError: `Recovered ACTIVE job after restart (${Math.round(staleDurationMs / 1000)}s stale).`,
                }
              : {
                  status: 'DEAD',
                  completedAt: new Date(),
                  lastError: `Active job exceeded retry budget after restart (${Math.round(staleDurationMs / 1000)}s stale).`,
                },
          });
        }
      }

      const recoverable = await this.db.workflow.findMany({
        where: { status: { in: ['PENDING', 'RUNNING', 'EXECUTING', 'VERIFYING'] } },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          goal: true,
          industry: true,
          status: true,
          updatedAt: true,
          stateJson: true,
          maxCostUsd: true,
        },
      });

      for (const wf of recoverable) {
        const staleDurationMs = Date.now() - new Date(wf.updatedAt).getTime();
        const stateData = (wf.stateJson ?? {}) as Record<string, unknown>;
        const checkpoint = (stateData['__checkpoint'] ?? {}) as Record<string, unknown>;
        const replaySafety = String(checkpoint['replaySafety'] ?? 'REPLAY_SAFE');

        if (replaySafety === 'MANUAL_INTERVENTION_REQUIRED') {
          await this.db.workflow.update({
            where: { id: wf.id },
            data: {
              status: 'PAUSED',
              error: `Recovery paused for manual intervention: ${String(checkpoint['replayReason'] ?? 'Replay safety unknown')}`,
              completedAt: null,
            },
          });

          this.log.warn(
            {
              workflowId: wf.id,
              replaySafety,
            },
            '[recovery] Workflow requires manual intervention before replay',
          );
          continue;
        }

        if (replaySafety === 'REPLAY_UNSAFE') {
          await this.db.workflow.update({
            where: { id: wf.id },
            data: {
              status: 'PAUSED',
              error: `Recovery blocked: replay-unsafe workflow. ${String(checkpoint['replayReason'] ?? '')}`.trim(),
              completedAt: null,
            },
          });

          this.log.warn(
            { workflowId: wf.id, replaySafety },
            '[recovery] Workflow replay is unsafe — paused for operator review',
          );
          continue;
        }

        // Side-effecting tasks without idempotency keys are NOT safe to auto-replay.
        // Gate them to PAUSED so an operator can decide whether to resume or discard.
        if (replaySafety === 'REQUIRES_IDEMPOTENCY_KEY') {
          const hasIdemKey = Boolean(checkpoint['idempotencyKey']);
          if (!hasIdemKey) {
            await this.db.workflow.update({
              where: { id: wf.id },
              data: {
                status: 'PAUSED',
                error: `Recovery paused: task has potential side effects and no idempotency key. ${String(checkpoint['replayReason'] ?? '')}`.trim(),
                completedAt: null,
              },
            });

            this.log.warn(
              { workflowId: wf.id, replaySafety },
              '[recovery] Side-effecting workflow without idempotency key paused for operator review',
            );
            continue;
          }
          // Has idempotency key — safe to auto-replay because the key prevents duplicate side effects
          this.log.info(
            { workflowId: wf.id, idempotencyKey: checkpoint['idempotencyKey'] },
            '[recovery] Side-effecting workflow has idempotency key — proceeding with auto-replay',
          );
        }

        if (wf.status !== 'PENDING') {
          await this.db.workflow.update({
            where: { id: wf.id },
            data: {
              status: 'PENDING',
              error: `Recovered after restart: previous status ${wf.status} (${Math.round(staleDurationMs / 1000)}s since last update).`,
              completedAt: null,
            },
          });
        }

        const roleModes = Array.isArray(stateData['roleModes'])
          ? (stateData['roleModes'].filter((v): v is string => typeof v === 'string'))
          : undefined;

        this.enqueueExecution({
          workflowId: wf.id,
          tenantId: wf.tenantId,
          userId: wf.userId,
          goal: wf.goal,
          industry: wf.industry ?? undefined,
          roleModes,
          maxCostUsd: wf.maxCostUsd ?? undefined,
        });

        this.log.warn(
          {
            workflowId: wf.id,
            tenantId: wf.tenantId,
            previousStatus: wf.status,
            staleDurationMs,
          },
          '[recovery] Re-enqueued workflow after restart',
        );
      }

      if (recoverable.length > 0) {
        this.log.info({ count: recoverable.length }, '[recovery] Queue recovery complete');
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
