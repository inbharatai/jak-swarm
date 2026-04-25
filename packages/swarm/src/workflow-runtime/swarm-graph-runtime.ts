/**
 * SwarmGraphRuntime — adapter that wraps the existing SwarmRunner +
 * SwarmGraph behind the JAK-owned WorkflowRuntime interface.
 *
 * Phase 6 of the OpenAI-first migration ships this so the rest of the
 * codebase can talk to a single interface today, with LangGraphRuntime
 * arriving as a peer implementation in the same phase. Zero behavior
 * change: every call delegates 1:1 to the methods SwarmExecutionService
 * already uses today.
 */

import { WorkflowStatus } from '@jak-swarm/shared';
import { SwarmRunner } from '../runner/swarm-runner.js';
import type { SwarmResult, RunParams } from '../runner/swarm-runner.js';
import type { ToolCategory } from '@jak-swarm/shared';
import type {
  WorkflowRuntime,
  StartContext,
  ResumeDecision,
  WorkflowSnapshot,
} from './workflow-runtime.js';
import { safeEmitLifecycle } from './lifecycle-events.js';

export class SwarmGraphRuntime implements WorkflowRuntime {
  readonly name = 'swarmgraph';

  constructor(private readonly runner: SwarmRunner) {}

  async start(ctx: StartContext): Promise<SwarmResult> {
    // Hardening pass: emit canonical lifecycle events at every observable
    // transition. The audit log replays these to reconstruct exactly what
    // happened in the workflow. SafeEmit never propagates errors back into
    // the runtime path — telemetry must not block execution.
    safeEmitLifecycle(ctx.onLifecycle, {
      type: 'created',
      workflowId: ctx.workflowId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      goal: ctx.goal,
      timestamp: new Date().toISOString(),
    });
    safeEmitLifecycle(ctx.onLifecycle, {
      type: 'started',
      workflowId: ctx.workflowId,
      runtime: this.name,
      timestamp: new Date().toISOString(),
    });

    const startedAt = Date.now();
    const params: RunParams = {
      goal: ctx.goal,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      industry: ctx.industry,
      roleModes: ctx.roleModes,
      workflowId: ctx.workflowId,
      idempotencyKey: ctx.idempotencyKey,
      maxCostUsd: ctx.maxCostUsd,
      autoApproveEnabled: ctx.autoApproveEnabled,
      approvalThreshold: ctx.approvalThreshold,
      allowedDomains: ctx.allowedDomains,
      browserAutomationEnabled: ctx.browserAutomationEnabled,
      restrictedCategories: ctx.restrictedCategories as ToolCategory[] | undefined,
      disabledToolNames: ctx.disabledToolNames,
      connectedProviders: ctx.connectedProviders,
      subscriptionTier: ctx.subscriptionTier,
    };
    try {
      const result = await this.runner.run(params);
      const durationMs = Date.now() - startedAt;

      // Map terminal SwarmResult.status → lifecycle event.
      if (result.status === WorkflowStatus.AWAITING_APPROVAL) {
        for (const a of result.pendingApprovals ?? []) {
          safeEmitLifecycle(ctx.onLifecycle, {
            type: 'approval_required',
            workflowId: ctx.workflowId,
            approvalId: a.id,
            riskLevel: a.riskLevel,
            timestamp: new Date().toISOString(),
          });
        }
      } else if (result.status === WorkflowStatus.CANCELLED) {
        safeEmitLifecycle(ctx.onLifecycle, {
          type: 'cancelled',
          workflowId: ctx.workflowId,
          reason: 'runtime-reported',
          timestamp: new Date().toISOString(),
        });
      } else if (result.status === WorkflowStatus.FAILED) {
        safeEmitLifecycle(ctx.onLifecycle, {
          type: 'failed',
          workflowId: ctx.workflowId,
          error: result.error ?? 'unknown failure',
          durationMs,
          timestamp: new Date().toISOString(),
        });
      } else if (result.status === WorkflowStatus.COMPLETED) {
        safeEmitLifecycle(ctx.onLifecycle, {
          type: 'completed',
          workflowId: ctx.workflowId,
          finalStatus: WorkflowStatus.COMPLETED,
          durationMs,
          timestamp: new Date().toISOString(),
        });
      }

      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      safeEmitLifecycle(ctx.onLifecycle, {
        type: 'failed',
        workflowId: ctx.workflowId,
        error: err instanceof Error ? err.message : String(err),
        durationMs,
        timestamp: new Date().toISOString(),
      });
      throw err;
    }
  }

  async resume(workflowId: string, decision: ResumeDecision): Promise<SwarmResult> {
    // SwarmRunner has its own resume path keyed on workflowId.
    // Delegate via the runner's existing API.
    const runnerWithResume = this.runner as unknown as {
      resume?: (id: string, dec: { status: 'APPROVED' | 'REJECTED'; reviewedBy: string; comment?: string }) => Promise<SwarmResult>;
    };
    if (typeof runnerWithResume.resume !== 'function') {
      throw new Error(
        '[SwarmGraphRuntime] underlying SwarmRunner does not expose resume(). Cannot resume workflow ' + workflowId,
      );
    }
    return runnerWithResume.resume(workflowId, {
      status: decision.decision,
      reviewedBy: decision.reviewedBy,
      comment: decision.comment,
    });
  }

  async cancel(workflowId: string): Promise<void> {
    this.runner.stop(workflowId);
  }

  async getState(workflowId: string): Promise<WorkflowSnapshot | null> {
    // SwarmRunner exposes signal flags but not full state read.
    // Phase 6 returns a minimal snapshot — the GET /workflows/:id
    // recovery layer in the API already does the heavy lifting from
    // DB traces, so this snapshot is intentionally lightweight.
    return {
      workflowId,
      status: this.runner.isCancelled(workflowId)
        ? WorkflowStatus.CANCELLED
        : this.runner.isPaused(workflowId)
        ? WorkflowStatus.AWAITING_APPROVAL
        : WorkflowStatus.EXECUTING,
      completedTaskIds: [],
      failedTaskIds: [],
      pendingApprovalIds: [],
    };
  }
}
