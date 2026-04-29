/**
 * SwarmRunner — Sprint 2.5 / A.6 rewrite.
 *
 * After the LangGraph hard cutover, this class is now a thin facade
 * over the LangGraphRuntime. The public API (run, resume, pause, stop,
 * isCancelled, isPaused, cancel, getState) is preserved so existing
 * callers (swarm-execution.service.ts, queue worker, tests) require
 * no changes. SwarmGraph itself is deleted; everything below
 * delegates to the native @langchain/langgraph orchestrator built in
 * langgraph-graph-builder.ts.
 *
 * Why preserve the SwarmRunner facade rather than make every caller
 * use WorkflowRuntime.start() directly: SwarmRunner has unique
 * responsibilities the workflow-runtime interface doesn't carry —
 * concurrency limits, the activity-emitter side-channel registration,
 * timeout enforcement, supervisor-bus lifecycle events. Folding these
 * into LangGraphRuntime would bloat the runtime contract; keeping them
 * here keeps the runtime pure and the facade minimal.
 */

import { WorkflowStatus } from '@jak-swarm/shared';
import type { AgentTrace, ApprovalRequest } from '@jak-swarm/shared';
import type { ToolCategory } from '@jak-swarm/shared';
import { createLogger } from '@jak-swarm/shared';
import { generateId } from '@jak-swarm/shared';
import type { SwarmState } from '../state/swarm-state.js';
import type { WorkflowStateStore } from '../state/workflow-state-store.js';
import { InMemoryStateStore } from '../state/workflow-state-store.js';
import { supervisorBus } from '../supervisor/supervisor-bus.js';
import {
  registerBreakerFactory,
  unregisterBreakerFactory,
} from '../supervisor/breaker-registry.js';
import {
  registerActivityEmitter,
  clearActivityEmitter,
} from '../supervisor/activity-registry.js';
import {
  registerLifecycleEmitter,
  clearLifecycleEmitter,
} from '../workflow-runtime/lifecycle-registry.js';
import type { AgentActivityEvent } from '@jak-swarm/agents';
import { LangGraphRuntime } from '../workflow-runtime/langgraph-runtime.js';
import type { CheckpointPrismaClient } from '../workflow-runtime/postgres-checkpointer.js';
import type { WorkflowLifecycleEmitter } from '../workflow-runtime/lifecycle-events.js';

export interface RunParams {
  goal: string;
  tenantId: string;
  userId: string;
  industry?: string;
  roleModes?: string[];
  workflowId?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  onStateChange?: (workflowId: string, state: unknown) => Promise<void>;
  onAgentActivity?: (data: unknown) => void;
  onLifecycle?: WorkflowLifecycleEmitter;
  maxCostUsd?: number;
  autoApproveEnabled?: boolean;
  approvalThreshold?: string;
  allowedDomains?: string[];
  browserAutomationEnabled?: boolean;
  restrictedCategories?: ToolCategory[];
  disabledToolNames?: string[];
  /**
   * Item C (OpenClaw-inspired Phase 1) — StandingOrder allowedTools
   * whitelist. Non-empty array enforces strict whitelist; empty/unset
   * preserves the legacy default-allow + blocklist semantics.
   */
  allowedToolNames?: string[];
  connectedProviders?: string[];
  subscriptionTier?: 'free' | 'paid';
  loadState?: (id: string) => Promise<unknown | undefined>;
  circuitBreakerFactory?: (
    name: string,
    opts: { failureThreshold: number; resetTimeoutMs: number },
  ) => { call: <T>(fn: () => Promise<T>) => Promise<T> };
}

export interface SwarmResult {
  workflowId: string;
  status: WorkflowStatus;
  outputs: unknown[];
  traces: AgentTrace[];
  pendingApprovals: ApprovalRequest[];
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
  error?: string;
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
}

export interface ApprovalDecision {
  status: 'APPROVED' | 'REJECTED' | 'DEFERRED';
  reviewedBy: string;
  comment?: string;
}

const logger = createLogger('swarm-runner');

function cleanupSignals(
  signals: { cancelled: Set<string>; paused: Set<string> },
  workflowId: string,
): void {
  signals.cancelled.delete(workflowId);
  signals.paused.delete(workflowId);
}

export interface SwarmRunnerOptions {
  defaultTimeoutMs?: number;
  maxConcurrentWorkflows?: number;
  stateStore?: WorkflowStateStore;
  /**
   * Prisma client for the LangGraph PostgresCheckpointSaver. Required
   * for production deployment so checkpoints persist across processes.
   * When omitted (e.g. in unit tests), an in-memory adapter is used —
   * checkpoints are lost on process exit but the rest of the runtime
   * works identically.
   */
  db?: CheckpointPrismaClient;
}

/**
 * In-memory CheckpointPrismaClient stub used when no real db is
 * provided. Implements the same surface (workflowCheckpoint methods)
 * with an array-backed store. Tenant isolation is preserved because
 * the saver still scopes by tenantId in all queries.
 */
function makeInMemoryCheckpointDb(): CheckpointPrismaClient {
  interface Row { [k: string]: unknown }
  const rows: Row[] = [];
  let idCounter = 0;
  function matches(row: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && 'lt' in (v as object)) {
        if (!((row[k] as string) < (v as { lt: string }).lt)) return false;
      } else if (row[k] !== v) {
        return false;
      }
    }
    return true;
  }
  return {
    workflowCheckpoint: {
      async findFirst(args: unknown) {
        const a = args as { where: Record<string, unknown> };
        const filtered = rows.filter((r) => matches(r, a.where));
        filtered.sort((x, y) => ((y['createdAt'] as Date).getTime() - (x['createdAt'] as Date).getTime()));
        return filtered[0] ?? null;
      },
      async findMany(args: unknown) {
        const a = args as { where: Record<string, unknown>; take?: number };
        let filtered = rows.filter((r) => matches(r, a.where));
        filtered.sort((x, y) => ((y['createdAt'] as Date).getTime() - (x['createdAt'] as Date).getTime()));
        if (typeof a.take === 'number') filtered = filtered.slice(0, a.take);
        return filtered;
      },
      async create(args: unknown) {
        const a = args as { data: Record<string, unknown> };
        const row: Row = { id: `mem_${++idCounter}`, createdAt: new Date(Date.now() + idCounter), ...a.data };
        rows.push(row);
        return row;
      },
      async upsert() { throw new Error('upsert not used'); },
      async deleteMany(args: unknown) {
        const a = args as { where: Record<string, unknown> };
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i];
          if (row && matches(row, a.where)) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      },
      async updateMany() { throw new Error('updateMany not used'); },
    },
  };
}

export class SwarmRunner {
  private readonly defaultTimeoutMs: number;
  private readonly maxConcurrent: number;
  private activeWorkflows = new Set<string>();
  private readonly stateStore: WorkflowStateStore;

  // Instance-level signal sets — prevents race conditions across instances.
  private readonly cancelledWorkflows = new Set<string>();
  private readonly pausedWorkflows = new Set<string>();

  /** Native LangGraph runtime; this is where the actual orchestration runs. */
  private readonly runtime: LangGraphRuntime;

  constructor(options: SwarmRunnerOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5 * 60 * 1000;
    this.maxConcurrent = options.maxConcurrentWorkflows ?? 20;
    this.stateStore = options.stateStore ?? new InMemoryStateStore();
    this.runtime = new LangGraphRuntime(this, options.db ?? makeInMemoryCheckpointDb());
  }

  pause(workflowId: string): void {
    this.pausedWorkflows.add(workflowId);
  }

  unpause(workflowId: string): void {
    this.pausedWorkflows.delete(workflowId);
  }

  stop(workflowId: string): void {
    this.cancelledWorkflows.add(workflowId);
  }

  isCancelled(workflowId: string): boolean {
    return this.cancelledWorkflows.has(workflowId);
  }

  isPaused(workflowId: string): boolean {
    return this.pausedWorkflows.has(workflowId);
  }

  async run(params: RunParams): Promise<SwarmResult> {
    const workflowId = params.workflowId ?? generateId('wf_');
    const startedAt = new Date();

    if (this.activeWorkflows.size >= this.maxConcurrent) {
      return {
        workflowId,
        status: WorkflowStatus.FAILED,
        error: `Server at capacity: ${this.activeWorkflows.size}/${this.maxConcurrent} workflows running. Try again shortly.`,
        startedAt,
        completedAt: new Date(),
        durationMs: 0,
        traces: [],
        outputs: [],
        pendingApprovals: [],
        clarificationNeeded: false,
      };
    }
    this.activeWorkflows.add(workflowId);

    logger.info(
      { workflowId, tenantId: params.tenantId, industry: params.industry },
      'Starting swarm workflow (LangGraph runtime)',
    );

    supervisorBus.publish('workflow:started', {
      type: 'workflow:started',
      tenantId: params.tenantId,
      workflowId,
    });

    if (params.circuitBreakerFactory) {
      registerBreakerFactory(workflowId, params.circuitBreakerFactory);
    }

    // Activity emitter side-channel — agent nodes call getActivityEmitter
    // and emit fine-grained events that flow through to the caller's
    // onAgentActivity callback (which the SSE stream consumes).
    if (params.onAgentActivity) {
      registerActivityEmitter(workflowId, (ev: AgentActivityEvent) => {
        try {
          params.onAgentActivity!({ workflowId, ...ev });
        } catch {
          // Activity-emitter errors must never break workflow execution.
        }
      });
    }

    // P1-3: Lifecycle emitter side-channel — worker-node calls
    // getLifecycleEmitter on failure to publish repair_* events to the
    // RepairService decision tree. Registered here so the worker-node
    // can find it without threading the emitter through SwarmState
    // (which can't carry Function values across DB checkpoint
    // serialization). Cleared in the finally block below.
    if (params.onLifecycle) {
      registerLifecycleEmitter(workflowId, params.onLifecycle);
    }

    const timeoutMs = params.timeoutMs ?? this.defaultTimeoutMs;

    try {
      const result = await this.runWithTimeout(
        this.runtime.start({
          workflowId,
          tenantId: params.tenantId,
          userId: params.userId,
          goal: params.goal,
          ...(params.industry !== undefined ? { industry: params.industry } : {}),
          ...(params.roleModes !== undefined ? { roleModes: params.roleModes } : {}),
          ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
          ...(params.maxCostUsd !== undefined ? { maxCostUsd: params.maxCostUsd } : {}),
          ...(params.autoApproveEnabled !== undefined ? { autoApproveEnabled: params.autoApproveEnabled } : {}),
          ...(params.approvalThreshold !== undefined ? { approvalThreshold: params.approvalThreshold } : {}),
          ...(params.allowedDomains !== undefined ? { allowedDomains: params.allowedDomains } : {}),
          ...(params.browserAutomationEnabled !== undefined ? { browserAutomationEnabled: params.browserAutomationEnabled } : {}),
          ...(params.restrictedCategories !== undefined ? { restrictedCategories: params.restrictedCategories } : {}),
          ...(params.disabledToolNames !== undefined ? { disabledToolNames: params.disabledToolNames } : {}),
          ...(params.allowedToolNames !== undefined ? { allowedToolNames: params.allowedToolNames } : {}),
          ...(params.connectedProviders !== undefined ? { connectedProviders: params.connectedProviders } : {}),
          ...(params.subscriptionTier !== undefined ? { subscriptionTier: params.subscriptionTier } : {}),
          ...(params.onLifecycle ? { onLifecycle: params.onLifecycle } : {}),
        }),
        timeoutMs,
        workflowId,
      );

      // Persist final state via stateStore for backwards compat with
      // any caller that reads it via getState() — including the legacy
      // SwarmRunner integration tests and `Workflow.stateJson` consumers.
      // We synthesize a SwarmState shape from the result + input params
      // since LangGraph holds the canonical state in its checkpoint.
      try {
        const persistedState: SwarmState = {
          goal: params.goal,
          tenantId: params.tenantId,
          userId: params.userId,
          workflowId,
          industry: params.industry,
          roleModes: params.roleModes ?? [],
          ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
          missionBrief: undefined,
          clarificationNeeded: result.clarificationNeeded,
          ...(result.clarificationQuestion !== undefined ? { clarificationQuestion: result.clarificationQuestion } : {}),
          plan: undefined,
          routeMap: undefined,
          currentTaskIndex: 0,
          taskResults: {},
          pendingApprovals: result.pendingApprovals,
          guardrailResult: undefined,
          blocked: false,
          verificationResults: {},
          completedTaskIds: [],
          failedTaskIds: [],
          taskRetryCount: {},
          accumulatedCostUsd: 0,
          ...(params.maxCostUsd !== undefined ? { maxCostUsd: params.maxCostUsd } : {}),
          allowedDomains: params.allowedDomains ?? [],
          browserAutomationEnabled: params.browserAutomationEnabled ?? false,
          restrictedCategories: params.restrictedCategories ?? [],
          disabledToolNames: params.disabledToolNames ?? [],
          allowedToolNames: params.allowedToolNames ?? [],
          connectedProviders: params.connectedProviders ?? [],
          ...(params.subscriptionTier !== undefined ? { subscriptionTier: params.subscriptionTier } : {}),
          status: result.status,
          ...(result.error !== undefined ? { error: result.error } : { error: undefined }),
          outputs: result.outputs,
          traces: result.traces,
        } as SwarmState;
        await this.stateStore.set(workflowId, persistedState);
      } catch (err) {
        logger.error({ workflowId, err: err instanceof Error ? err.message : String(err) }, 'Failed to persist final workflow state');
      }

      if (params.onStateChange) {
        try {
          await params.onStateChange(workflowId, result);
        } catch (err) {
          logger.error({ workflowId, err: err instanceof Error ? err.message : String(err) }, 'onStateChange callback failed');
        }
      }

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      logger.info(
        {
          workflowId,
          status: result.status,
          outputCount: result.outputs.length,
          traceCount: result.traces.length,
          durationMs,
        },
        'Swarm workflow completed',
      );

      supervisorBus.publish('workflow:completed', {
        type: 'workflow:completed',
        tenantId: params.tenantId,
        workflowId,
        status: result.status,
        durationMs,
        taskCount: 0,
        failedCount: 0,
      });

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ workflowId, err: errorMessage }, 'Swarm workflow failed');

      const completedAt = new Date();
      return {
        workflowId,
        status: WorkflowStatus.FAILED,
        outputs: [],
        traces: [],
        pendingApprovals: [],
        clarificationNeeded: false,
        error: errorMessage,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        startedAt,
        completedAt,
      };
    } finally {
      this.activeWorkflows.delete(workflowId);
      unregisterBreakerFactory(workflowId);
      clearActivityEmitter(workflowId);
      clearLifecycleEmitter(workflowId);
      cleanupSignals({ cancelled: this.cancelledWorkflows, paused: this.pausedWorkflows }, workflowId);
    }
  }

  async resume(
    workflowId: string,
    approvalDecision: ApprovalDecision,
    options?: { loadState?: (id: string) => Promise<unknown | undefined> },
  ): Promise<SwarmResult> {
    void options; // loadState is no longer needed — LangGraph rehydrates from checkpointer
    const startedAt = new Date();

    logger.info(
      { workflowId, decision: approvalDecision.status, reviewedBy: approvalDecision.reviewedBy },
      'Resuming workflow after approval decision (LangGraph runtime)',
    );

    try {
      const result = await this.runWithTimeout(
        this.runtime.resume(workflowId, {
          decision: approvalDecision.status === 'REJECTED' ? 'REJECTED' : 'APPROVED',
          reviewedBy: approvalDecision.reviewedBy,
          ...(approvalDecision.comment !== undefined ? { comment: approvalDecision.comment } : {}),
        }),
        this.defaultTimeoutMs,
        workflowId,
      );
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ workflowId, err: errorMessage }, 'Workflow resume failed');
      const completedAt = new Date();
      return {
        workflowId,
        status: WorkflowStatus.FAILED,
        outputs: [],
        traces: [],
        pendingApprovals: [],
        clarificationNeeded: false,
        error: errorMessage,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        startedAt,
        completedAt,
      };
    } finally {
      cleanupSignals({ cancelled: this.cancelledWorkflows, paused: this.pausedWorkflows }, workflowId);
    }
  }

  async cancel(workflowId: string): Promise<void> {
    this.cancelledWorkflows.add(workflowId);
    try {
      await this.runtime.cancel(workflowId, 'user-cancelled');
    } catch {
      // Cancel is best-effort.
    }
    // Update the persisted state so getState() reflects the cancellation
    // even when no further node runs occur after the cancel.
    try {
      const existing = await this.stateStore.get(workflowId);
      if (existing) {
        await this.stateStore.set(workflowId, {
          ...existing,
          status: WorkflowStatus.CANCELLED,
          error: existing.error ?? 'Cancelled by user',
        });
      }
    } catch {
      // Persistence is best-effort here.
    }
    logger.info({ workflowId }, 'Workflow cancelled');
  }

  async getState(workflowId: string): Promise<SwarmState | undefined> {
    const stored = await this.stateStore.get(workflowId);
    if (stored) return stored;
    // Fallback: ask LangGraph for a snapshot built from the checkpoint.
    const snapshot = await this.runtime.getState(workflowId);
    return snapshot?.rawState;
  }

  private async runWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    workflowId: string,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Workflow ${workflowId} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }
}
