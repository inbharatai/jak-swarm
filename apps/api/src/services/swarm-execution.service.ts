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
import { SwarmRunner } from '@jak-swarm/swarm';
import type { SwarmResult } from '@jak-swarm/swarm';
import type { AgentTrace as SharedAgentTrace, ApprovalRequest as SharedApprovalRequest } from '@jak-swarm/shared';
import { WorkflowService } from './workflow.service.js';

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

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {
    super();
    this.runner = new SwarmRunner({ defaultTimeoutMs: 5 * 60 * 1000 });
    this.workflowService = new WorkflowService(db, log);
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

    this.log.info({ workflowId, tenantId }, '[Swarm] Starting async execution');

    try {
      await this.workflowService.updateWorkflowStatus(workflowId, 'RUNNING');
      this.emit(`workflow:${workflowId}`, { type: 'started', workflowId, timestamp: new Date().toISOString() });

      const tenant = await this.db.tenant.findUnique({ where: { id: tenantId } });

      const result = await this.runner.run({
        workflowId,
        tenantId,
        userId,
        goal,
        industry,
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
          } catch { /* non-critical */ }
        },
        approvalThreshold: (tenant as any)?.approvalThreshold ?? undefined,
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
      } catch { /* non-critical */ }

      const dbStatus = mapSwarmStatusToDb(result.status);
      await this.workflowService.updateWorkflowStatus(workflowId, dbStatus, result.error);

      if (dbStatus === 'COMPLETED') {
        this.emit(`workflow:${workflowId}`, { type: 'completed', workflowId, status: dbStatus, timestamp: new Date().toISOString() });
      } else if (dbStatus === 'FAILED') {
        this.emit(`workflow:${workflowId}`, { type: 'failed', workflowId, error: result.error, timestamp: new Date().toISOString() });
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
      });
      for (const wf of stale) {
        await this.db.workflow.update({
          where: { id: wf.id },
          data: {
            status: 'FAILED',
            error: 'Server restarted during execution. Workflow state preserved — resubmit to retry.',
            completedAt: new Date(),
          },
        });
      }
      if (stale.length > 0) {
        this.log.info(`[recovery] Marked ${stale.length} stale workflows as FAILED`);
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
