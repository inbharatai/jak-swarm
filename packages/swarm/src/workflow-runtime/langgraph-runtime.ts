/**
 * LangGraphRuntime — Sprint 2.5 / A.3.
 *
 * Real native-LangGraph orchestrator backed by `PostgresCheckpointSaver`.
 * Replaces the previous proof-of-life shim. The runtime:
 *
 *   - Compiles a `StateGraph` with the 9 SwarmGraph node functions added
 *     via `addNode` and the 4 conditional-edge functions reused verbatim
 *     from `swarm-graph.ts`.
 *   - Persists every checkpoint into Postgres via the
 *     `PostgresCheckpointSaver` (Sprint 2.5 / A.2).
 *   - Pauses on approval via LangGraph's native `interrupt()` (called
 *     inside the approval node wrapper). Resumes via
 *     `Command(resume=...)` — the standard LangGraph contract.
 *   - Implements the JAK-owned `WorkflowRuntime` interface so
 *     SwarmExecutionService consumes it identically to the old runtime.
 *
 * INVARIANT: no `@langchain/langgraph` import escapes this directory.
 */

import {
  Command,
  GraphInterrupt,
  isInterrupted,
} from '@langchain/langgraph';
import { WorkflowStatus } from '@jak-swarm/shared';
import type { ToolCategory, AgentTrace, ApprovalRequest } from '@jak-swarm/shared';
import type { SwarmRunner, SwarmResult } from '../runner/swarm-runner.js';
import {
  buildLangGraph,
  makeRunnableConfig,
  type CompiledLangGraph,
} from './langgraph-graph-builder.js';
import type { CheckpointPrismaClient } from './postgres-checkpointer.js';
import type {
  WorkflowRuntime,
  StartContext,
  ResumeDecision,
  WorkflowSnapshot,
} from './workflow-runtime.js';
import { safeEmitLifecycle } from './lifecycle-events.js';
import { createInitialSwarmState, type SwarmState } from '../state/swarm-state.js';
import { WorkflowPausedError } from './workflow-runtime.js';

export class LangGraphRuntime implements WorkflowRuntime {
  readonly name = 'langgraph';
  /** True now that the cutover is real. */
  readonly isFullyImplemented = true;
  readonly status = 'active' as const;

  private readonly graph: CompiledLangGraph;
  private readonly runner: SwarmRunner;

  constructor(runner: SwarmRunner, db: CheckpointPrismaClient) {
    this.runner = runner;
    // Wire cooperative cancel/pause flags from the SwarmRunner to the
    // graph's per-node wrappers. We reuse the SwarmRunner's flag sets
    // because nothing else in the system tracks per-workflow cancel
    // state, and the callers (HTTP cancel route + UI pause button)
    // already mutate them via runner.stop / runner.pause.
    this.graph = buildLangGraph({
      db,
      shouldStop: (id) => runner.isCancelled(id),
      shouldPause: (id) => runner.isPaused(id),
    });
  }

  async start(ctx: StartContext): Promise<SwarmResult> {
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
    const initialState = createInitialSwarmState({
      goal: ctx.goal,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      workflowId: ctx.workflowId,
      industry: ctx.industry,
      roleModes: ctx.roleModes,
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
    });

    const config = makeRunnableConfig(ctx.workflowId, ctx.tenantId);
    return this.runOrPause(initialState, config, ctx, startedAt);
  }

  async resume(workflowId: string, decision: ResumeDecision): Promise<SwarmResult> {
    // Look up tenantId from the existing checkpoint header. We cannot
    // rebuild the full state ourselves — LangGraph rehydrates from
    // the checkpointer when invoke is called with the same thread_id.
    const tenantId = await this.findTenantIdForThread(workflowId);
    if (!tenantId) {
      throw new Error(`[LangGraphRuntime.resume] no checkpoint found for workflow ${workflowId}`);
    }
    const config = makeRunnableConfig(workflowId, tenantId);
    const startedAt = Date.now();

    // Resume via Command(resume=...). LangGraph applies the value to the
    // most recent interrupt() call inside the approval wrapper.
    const resumeCommand = new Command({
      resume: {
        status: decision.decision,
        reviewedBy: decision.reviewedBy,
        ...(decision.comment ? { comment: decision.comment } : {}),
      },
    });

    return this.runOrPause(resumeCommand as unknown as Partial<SwarmState>, config, undefined, startedAt);
  }

  async cancel(workflowId: string, _reason?: string): Promise<void> {
    this.runner.stop(workflowId);
  }

  async getState(workflowId: string): Promise<WorkflowSnapshot | null> {
    // Find the most recent checkpoint for this thread across tenants.
    // We use a low-level lookup because configurable.tenantId is required
    // but the caller (GET /workflows/:id) might not have it in scope.
    const tenantId = await this.findTenantIdForThread(workflowId);
    if (!tenantId) return null;
    const config = makeRunnableConfig(workflowId, tenantId);
    const snapshot = await this.graph.getState(config);
    if (!snapshot) return null;

    const state = snapshot.values as unknown as SwarmState;
    return {
      workflowId,
      status: state.status,
      currentStage: snapshot.next?.[0],
      ...(state.plan?.tasks?.[state.currentTaskIndex ?? 0]
        ? { currentTaskId: state.plan.tasks[state.currentTaskIndex ?? 0]!.id }
        : {}),
      completedTaskIds: state.completedTaskIds ?? [],
      failedTaskIds: state.failedTaskIds ?? [],
      pendingApprovalIds: (state.pendingApprovals ?? []).map((a) => a.id),
      ...(state.error ? { error: state.error } : {}),
      rawState: state,
    };
  }

  /**
   * Run the graph and convert LangGraph's GraphInterrupt into the
   * JAK-owned WorkflowPausedError. Any other terminal status produces
   * a SwarmResult.
   */
  private async runOrPause(
    input: Partial<SwarmState> | unknown,
    config: ReturnType<typeof makeRunnableConfig>,
    ctx: StartContext | undefined,
    startedAt: number,
  ): Promise<SwarmResult> {
    let finalState: SwarmState;
    try {
      const result = await this.graph.invoke(input as Parameters<typeof this.graph.invoke>[0], config);
      finalState = result as unknown as SwarmState;
    } catch (err) {
      // GraphInterrupt → workflow paused for approval. Return a
      // WorkflowPausedError so SwarmExecutionService enqueues a resume.
      if (err instanceof GraphInterrupt || isInterrupted(err)) {
        // Read the current state to extract pendingApprovals.
        const snapshot = await this.graph.getState(config);
        const state = (snapshot?.values ?? {}) as unknown as SwarmState;

        if (ctx?.onLifecycle) {
          for (const a of state.pendingApprovals ?? []) {
            safeEmitLifecycle(ctx.onLifecycle, {
              type: 'approval_required',
              workflowId: ctx.workflowId,
              approvalId: a.id,
              riskLevel: a.riskLevel,
              timestamp: new Date().toISOString(),
            });
          }
        }
        // Return an AWAITING_APPROVAL SwarmResult; SwarmExecutionService
        // recognises this status and persists pendingApprovals.
        return {
          workflowId: state.workflowId,
          status: WorkflowStatus.AWAITING_APPROVAL,
          outputs: state.outputs ?? [],
          traces: state.traces ?? [],
          pendingApprovals: state.pendingApprovals ?? [],
          clarificationNeeded: state.clarificationNeeded ?? false,
          ...(state.clarificationQuestion ? { clarificationQuestion: state.clarificationQuestion } : {}),
          durationMs: Date.now() - startedAt,
          startedAt: new Date(startedAt),
          completedAt: new Date(),
        };
      }
      // Non-interrupt error: surface as FAILED.
      const errorMessage = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startedAt;
      if (ctx?.onLifecycle) {
        safeEmitLifecycle(ctx.onLifecycle, {
          type: 'failed',
          workflowId: ctx.workflowId,
          error: errorMessage,
          durationMs,
          timestamp: new Date().toISOString(),
        });
      }
      throw err;
    }

    // Terminal state — emit corresponding lifecycle event.
    const durationMs = Date.now() - startedAt;
    if (ctx?.onLifecycle) {
      if (finalState.status === WorkflowStatus.CANCELLED) {
        safeEmitLifecycle(ctx.onLifecycle, {
          type: 'cancelled',
          workflowId: ctx.workflowId,
          reason: 'runtime-reported',
          timestamp: new Date().toISOString(),
        });
      } else if (finalState.status === WorkflowStatus.FAILED) {
        safeEmitLifecycle(ctx.onLifecycle, {
          type: 'failed',
          workflowId: ctx.workflowId,
          error: finalState.error ?? 'unknown failure',
          durationMs,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Treat anything that wasn't FAILED / CANCELLED as COMPLETED for
        // lifecycle purposes (matches SwarmGraphRuntime behavior).
        safeEmitLifecycle(ctx.onLifecycle, {
          type: 'completed',
          workflowId: ctx.workflowId,
          finalStatus: finalState.status,
          durationMs,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return this.toSwarmResult(finalState, startedAt);
  }

  private toSwarmResult(state: SwarmState, startedAt: number): SwarmResult {
    return {
      workflowId: state.workflowId,
      status: state.status,
      outputs: state.outputs ?? [],
      traces: (state.traces ?? []) as AgentTrace[],
      pendingApprovals: (state.pendingApprovals ?? []) as ApprovalRequest[],
      clarificationNeeded: state.clarificationNeeded ?? false,
      ...(state.clarificationQuestion ? { clarificationQuestion: state.clarificationQuestion } : {}),
      ...(state.error ? { error: state.error } : {}),
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt),
      completedAt: new Date(),
    };
  }

  /**
   * Best-effort tenant lookup for an existing workflow's checkpoint.
   * Used by getState + resume when the caller doesn't carry tenantId
   * explicitly. Reads any checkpoint row for the thread and returns
   * its tenant_id. Returns undefined if no checkpoint exists.
   */
  private async findTenantIdForThread(workflowId: string): Promise<string | undefined> {
    // We piggyback on the same Prisma client the checkpointer uses by
    // accessing its private `db`. This is intentional — the runtime
    // owns both for the duration of a workflow.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cp = (this.graph as unknown as { checkpointer?: { db?: CheckpointPrismaClient } }).checkpointer;
    if (!cp || !cp.db) return undefined;
    const row = (await cp.db.workflowCheckpoint.findFirst({
      where: { threadId: workflowId },
      orderBy: { createdAt: 'desc' },
    })) as { tenantId?: string } | null;
    return row?.tenantId;
  }
}

// Re-export so the index.ts export from this directory remains consistent.
export { WorkflowPausedError };
