import { WorkflowStatus } from '@jak-swarm/shared';
import type { AgentTrace, ApprovalRequest } from '@jak-swarm/shared';
import { createLogger } from '@jak-swarm/shared';
import { generateId } from '@jak-swarm/shared';
import type { SwarmState } from '../state/swarm-state.js';
import { createInitialSwarmState } from '../state/swarm-state.js';
import { buildSwarmGraph } from '../graph/swarm-graph.js';

export interface RunParams {
  goal: string;
  tenantId: string;
  userId: string;
  industry?: string;
  workflowId?: string;
  timeoutMs?: number;
  onStateChange?: (workflowId: string, state: unknown) => Promise<void>;
  onAgentActivity?: (data: unknown) => void;
  maxCostUsd?: number;
  approvalThreshold?: string;
  loadState?: (id: string) => Promise<unknown | undefined>;
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

// In-memory workflow state store (replace with Redis/DB in production)
const workflowStateStore = new Map<string, SwarmState>();

// Module-level signal sets (shared across runner instances for the same process)
const cancelledWorkflows = new Set<string>();
const pausedWorkflows = new Set<string>();

/** Clean up signals after workflow completes */
function cleanupSignals(workflowId: string): void {
  cancelledWorkflows.delete(workflowId);
  pausedWorkflows.delete(workflowId);
}

export class SwarmRunner {
  private readonly graph = buildSwarmGraph();
  private readonly defaultTimeoutMs: number;
  private readonly maxConcurrent: number;
  private activeWorkflows = new Set<string>();

  constructor(options?: { defaultTimeoutMs?: number; maxConcurrentWorkflows?: number }) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 5 * 60 * 1000; // 5 minutes
    this.maxConcurrent = options?.maxConcurrentWorkflows ?? 20;

    // Wire signal callbacks to graph
    this.graph.shouldStop = (wfId) => cancelledWorkflows.has(wfId);
    this.graph.shouldPause = (wfId) => pausedWorkflows.has(wfId);
  }

  pause(workflowId: string): void {
    pausedWorkflows.add(workflowId);
  }

  unpause(workflowId: string): void {
    pausedWorkflows.delete(workflowId);
  }

  stop(workflowId: string): void {
    cancelledWorkflows.add(workflowId);
  }

  static isCancelled(workflowId: string): boolean {
    return cancelledWorkflows.has(workflowId);
  }

  static isPaused(workflowId: string): boolean {
    return pausedWorkflows.has(workflowId);
  }

  async run(params: RunParams): Promise<SwarmResult> {
    const workflowId = params.workflowId ?? generateId('wf_');
    const startedAt = new Date();

    // Enforce concurrent workflow limit
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
      'Starting swarm workflow',
    );

    const initialState = createInitialSwarmState({
      goal: params.goal,
      tenantId: params.tenantId,
      userId: params.userId,
      workflowId,
      industry: params.industry,
      maxCostUsd: params.maxCostUsd,
      approvalThreshold: params.approvalThreshold,
    });

    const timeoutMs = params.timeoutMs ?? this.defaultTimeoutMs;

    // Track listeners so we can remove them after workflow completes
    const listeners: Array<{ event: string; fn: (...args: any[]) => void }> = [];

    // Register state-change listener so callers can persist intermediate state
    if (params.onStateChange) {
      const fn = (data: { workflowId: string; state: unknown }) => {
        params.onStateChange!(data.workflowId, data.state).catch(() => {});
      };
      this.graph.on('state:updated', fn);
      listeners.push({ event: 'state:updated', fn });
    }

    // Relay agent telemetry events to callers
    if (params.onAgentActivity) {
      const activityFn = (data: unknown) => {
        params.onAgentActivity!(data);
      };
      this.graph.on('agent:activity', activityFn);
      listeners.push({ event: 'agent:activity', fn: activityFn });

      const enterFn = (data: unknown) => {
        params.onAgentActivity!({ type: 'node_enter', ...(data as Record<string, unknown>) });
      };
      this.graph.on('node:enter', enterFn);
      listeners.push({ event: 'node:enter', fn: enterFn });

      const exitFn = (data: unknown) => {
        params.onAgentActivity!({ type: 'node_exit', ...(data as Record<string, unknown>) });
      };
      this.graph.on('node:exit', exitFn);
      listeners.push({ event: 'node:exit', fn: exitFn });
    }

    let finalState: SwarmState;

    try {
      // Use parallel execution when available — independent tasks run concurrently.
      // Falls back to sequential if runParallel encounters issues.
      finalState = await this.runWithTimeout(
        this.graph.runParallel
          ? this.graph.runParallel(initialState)
          : this.graph.run(initialState),
        timeoutMs,
        workflowId,
      );
    } catch (err) {
      // Remove event listeners to prevent memory leaks
      for (const { event, fn } of listeners) {
        this.graph.off(event, fn);
      }
      this.activeWorkflows.delete(workflowId);

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
    }

    // Remove event listeners to prevent memory leaks
    for (const { event, fn } of listeners) {
      this.graph.off(event, fn);
    }
    this.activeWorkflows.delete(workflowId);

    // Persist state for resume/cancel
    workflowStateStore.set(workflowId, finalState);
    // Clean up after 5 minutes (keep briefly for status queries)
    setTimeout(() => { workflowStateStore.delete(workflowId); }, 5 * 60 * 1000);

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    logger.info(
      {
        workflowId,
        status: finalState.status,
        outputCount: finalState.outputs.length,
        traceCount: finalState.traces.length,
        durationMs,
      },
      'Swarm workflow completed',
    );

    cleanupSignals(workflowId);
    return this.stateToResult(finalState, workflowId, startedAt, completedAt);
  }

  async resume(
    workflowId: string,
    approvalDecision: ApprovalDecision,
    options?: { loadState?: (id: string) => Promise<unknown | undefined> },
  ): Promise<SwarmResult> {
    const startedAt = new Date();

    logger.info(
      { workflowId, decision: approvalDecision.status, reviewedBy: approvalDecision.reviewedBy },
      'Resuming workflow after approval decision',
    );

    let savedState = workflowStateStore.get(workflowId);

    // If not in memory, try loading from external store (e.g. DB)
    if (!savedState && options?.loadState) {
      const loaded = await options.loadState(workflowId);
      if (loaded) {
        savedState = loaded as SwarmState;
        workflowStateStore.set(workflowId, savedState);
      }
    }

    if (!savedState) {
      return {
        workflowId,
        status: WorkflowStatus.FAILED,
        outputs: [],
        traces: [],
        pendingApprovals: [],
        clarificationNeeded: false,
        error: `Workflow '${workflowId}' not found or already completed`,
        durationMs: 0,
        startedAt,
        completedAt: new Date(),
      };
    }

    if (savedState.status !== WorkflowStatus.AWAITING_APPROVAL) {
      return {
        workflowId,
        status: savedState.status,
        outputs: savedState.outputs,
        traces: savedState.traces,
        pendingApprovals: savedState.pendingApprovals,
        clarificationNeeded: savedState.clarificationNeeded,
        error: `Workflow is not awaiting approval (status: ${savedState.status})`,
        durationMs: 0,
        startedAt,
        completedAt: new Date(),
      };
    }

    let finalState: SwarmState;
    try {
      finalState = await this.runWithTimeout(
        this.graph.resume(savedState, approvalDecision),
        this.defaultTimeoutMs,
        workflowId,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ workflowId, err: errorMessage }, 'Workflow resume failed');
      const completedAt = new Date();
      return {
        workflowId,
        status: WorkflowStatus.FAILED,
        outputs: savedState.outputs,
        traces: savedState.traces,
        pendingApprovals: savedState.pendingApprovals,
        clarificationNeeded: false,
        error: errorMessage,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        startedAt,
        completedAt,
      };
    }

    workflowStateStore.set(workflowId, finalState);
    // Clean up after 5 minutes (keep briefly for status queries)
    setTimeout(() => { workflowStateStore.delete(workflowId); }, 5 * 60 * 1000);

    cleanupSignals(workflowId);
    const completedAt = new Date();
    return this.stateToResult(finalState, workflowId, startedAt, completedAt);
  }

  async cancel(workflowId: string): Promise<void> {
    const state = workflowStateStore.get(workflowId);
    if (!state) {
      logger.warn({ workflowId }, 'Cancel requested for unknown workflow');
      return;
    }

    const cancelledState: SwarmState = {
      ...state,
      status: WorkflowStatus.CANCELLED,
      error: 'Cancelled by user',
    };

    workflowStateStore.set(workflowId, cancelledState);
    // Clean up after 5 minutes (keep briefly for status queries)
    setTimeout(() => { workflowStateStore.delete(workflowId); }, 5 * 60 * 1000);

    logger.info({ workflowId }, 'Workflow cancelled');
  }

  getState(workflowId: string): SwarmState | undefined {
    return workflowStateStore.get(workflowId);
  }

  private stateToResult(
    state: SwarmState,
    workflowId: string,
    startedAt: Date,
    completedAt: Date,
  ): SwarmResult {
    return {
      workflowId,
      status: state.status,
      outputs: state.outputs,
      traces: state.traces,
      pendingApprovals: state.pendingApprovals,
      clarificationNeeded: state.clarificationNeeded,
      clarificationQuestion: state.clarificationQuestion,
      error: state.error,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      startedAt,
      completedAt,
    };
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
