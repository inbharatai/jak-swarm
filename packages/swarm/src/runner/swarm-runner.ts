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

  constructor(options?: { defaultTimeoutMs?: number }) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 5 * 60 * 1000; // 5 minutes

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

    // Register state-change listener so callers can persist intermediate state
    if (params.onStateChange) {
      this.graph.on('state:updated', (data: { workflowId: string; state: unknown }) => {
        params.onStateChange!(data.workflowId, data.state).catch(() => {});
      });
    }

    // Relay agent telemetry events to callers
    if (params.onAgentActivity) {
      this.graph.on('agent:activity', (data: unknown) => {
        params.onAgentActivity!(data);
      });
      this.graph.on('node:enter', (data: unknown) => {
        params.onAgentActivity!({ type: 'node_enter', ...(data as Record<string, unknown>) });
      });
      this.graph.on('node:exit', (data: unknown) => {
        params.onAgentActivity!({ type: 'node_exit', ...(data as Record<string, unknown>) });
      });
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

    // Persist state for resume/cancel
    workflowStateStore.set(workflowId, finalState);

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
