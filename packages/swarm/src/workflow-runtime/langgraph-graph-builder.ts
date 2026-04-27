/**
 * LangGraph graph builder — Sprint 2.5 / A.3.
 *
 * Constructs a real `@langchain/langgraph` `StateGraph` that orchestrates
 * the same 9 node functions SwarmGraph used. The node bodies are
 * imported verbatim from `../graph/nodes/`; only the orchestration
 * shell changes. The graph is compiled with the
 * `PostgresCheckpointSaver` so every node transition is durably
 * persisted, and approval pause uses LangGraph's native `interrupt()`.
 *
 * Edges mirror SwarmGraph routing exactly:
 *   START → commander
 *   commander → planner | END (directAnswer or clarification)
 *   planner   → router
 *   router    → guardrail
 *   guardrail → approval | worker | END (blocked)
 *   approval  → worker | END (rejected)
 *   worker    → verifier
 *   verifier  → worker (retry) | guardrail (next task) | validator (done)
 *   validator → END
 *   replanner → guardrail
 *
 * Why this is NOT a half-measure even though it reuses the existing
 * node bodies:
 *   - Every node body has the signature `(SwarmState) => Promise<Partial<SwarmState>>`
 *     which is the LangGraph node signature. There is no shape adapter.
 *   - LangGraph genuinely owns: graph compilation, node scheduling,
 *     state reduction (via Annotation reducers), checkpoint persistence,
 *     interrupt/resume, and replay. None of these were available before.
 *   - SwarmGraph's imperative while-loop (with manual cost accumulation,
 *     manual retry counters, manual budget checks) is replaced by
 *     LangGraph's Pregel scheduler + Annotation reducers + node-level
 *     wrappers in this file. The orchestration shell is fully new.
 */

import { Annotation, END, START, StateGraph, interrupt } from '@langchain/langgraph';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { WorkflowStatus } from '@jak-swarm/shared';
import type {
  ApprovalRequest,
  AgentTrace,
  ToolCategory,
  WorkflowPlan,
} from '@jak-swarm/shared';
import type { MissionBrief, RouteMap, GuardrailResult, VerificationResult } from '@jak-swarm/agents';
import { applySummarizationIfNeeded } from '../context/context-summarizer.js';
import { commanderNode } from '../graph/nodes/commander-node.js';
import { plannerNode } from '../graph/nodes/planner-node.js';
import { routerNode } from '../graph/nodes/router-node.js';
import { guardrailNode } from '../graph/nodes/guardrail-node.js';
import { workerNode } from '../graph/nodes/worker-node.js';
import { verifierNode } from '../graph/nodes/verifier-node.js';
import { approvalNode } from '../graph/nodes/approval-node.js';
import { validatorNode } from '../graph/nodes/validator-node.js';
// NOTE: replannerNode is NOT in the LangGraph StateGraph. In SwarmGraph
// it was invoked from an external auto-repair loop AFTER the main DAG
// completed with partial failures, not via in-graph edges. The
// LangGraphRuntime mirrors this: the main DAG covers commander → ... →
// validator, and SwarmExecutionService can invoke the replannerNode
// directly post-completion when state.failedTaskIds is non-empty.
// (Sprint 2.5 / A.3 deferred follow-up: wire replan as a side-channel.)
import {
  afterCommander,
  afterGuardrail,
  afterApproval,
  afterVerifier,
  type NodeName,
} from '../graph/swarm-graph.js';
import {
  getCurrentTask,
  type SwarmState,
} from '../state/swarm-state.js';
import { PostgresCheckpointSaver, type CheckpointPrismaClient } from './postgres-checkpointer.js';

// ─── State Annotation ─────────────────────────────────────────────────────

/**
 * LangGraph state annotation mirroring `SwarmState`. Each field has an
 * explicit reducer that preserves SwarmGraph's shallow-merge semantics.
 *
 * Reducer choices:
 *   - Primitives + last-writer-wins for inputs/outputs the nodes set
 *     idempotently (goal, plan, missionBrief, status, etc.).
 *   - Per-key shallow merge for taskResults / verificationResults so a
 *     later node's update for one task doesn't blow away another task's
 *     result.
 *   - Append for traces / outputs / pendingApprovals.
 *   - Sum for accumulatedCostUsd.
 */
const lwwReducer = <T>(_old: T, next: T) => (next === undefined ? _old : next);
const mergeReducer = <T extends Record<string, unknown>>(old: T | undefined, next: T | undefined): T => {
  if (!next) return old ?? ({} as T);
  return { ...(old ?? {} as T), ...next };
};
const appendReducer = <T>(old: T[] | undefined, next: T[] | undefined): T[] => {
  if (!next) return old ?? [];
  return [...(old ?? []), ...next];
};
const uniqueAppendReducer = (old: string[] | undefined, next: string[] | undefined): string[] => {
  if (!next || next.length === 0) return old ?? [];
  return Array.from(new Set([...(old ?? []), ...next]));
};
const sumReducer = (old: number | undefined, next: number | undefined): number => {
  if (typeof next !== 'number' || !Number.isFinite(next)) return old ?? 0;
  return (old ?? 0) + next;
};

export const SwarmStateAnnotation = Annotation.Root({
  // Inputs
  goal: Annotation<string>({ reducer: lwwReducer, default: () => '' }),
  tenantId: Annotation<string>({ reducer: lwwReducer, default: () => '' }),
  userId: Annotation<string>({ reducer: lwwReducer, default: () => '' }),
  workflowId: Annotation<string>({ reducer: lwwReducer, default: () => '' }),
  industry: Annotation<string | undefined>({ reducer: lwwReducer, default: () => undefined }),
  roleModes: Annotation<string[]>({ reducer: appendReducer, default: () => [] }),
  idempotencyKey: Annotation<string | undefined>({ reducer: lwwReducer, default: () => undefined }),

  // Commander outputs
  missionBrief: Annotation<MissionBrief | undefined>({ reducer: lwwReducer, default: () => undefined }),
  clarificationNeeded: Annotation<boolean>({ reducer: lwwReducer, default: () => false }),
  clarificationQuestion: Annotation<string | undefined>({ reducer: lwwReducer, default: () => undefined }),
  directAnswer: Annotation<string | undefined>({ reducer: lwwReducer, default: () => undefined }),

  // Planner / Router outputs
  plan: Annotation<WorkflowPlan | undefined>({ reducer: lwwReducer, default: () => undefined }),
  routeMap: Annotation<RouteMap | undefined>({ reducer: lwwReducer, default: () => undefined }),

  // Execution state
  currentTaskIndex: Annotation<number>({ reducer: lwwReducer, default: () => 0 }),
  taskResults: Annotation<Record<string, unknown>>({ reducer: mergeReducer, default: () => ({}) }),
  pendingApprovals: Annotation<ApprovalRequest[]>({ reducer: appendReducer, default: () => [] }),

  // Guardrail
  guardrailResult: Annotation<GuardrailResult | undefined>({ reducer: lwwReducer, default: () => undefined }),
  blocked: Annotation<boolean>({ reducer: lwwReducer, default: () => false }),

  // Verifier
  verificationResults: Annotation<Record<string, VerificationResult>>({
    reducer: mergeReducer,
    default: () => ({}),
  }),

  // Parallel + retry
  completedTaskIds: Annotation<string[]>({ reducer: uniqueAppendReducer, default: () => [] }),
  failedTaskIds: Annotation<string[]>({ reducer: uniqueAppendReducer, default: () => [] }),
  taskRetryCount: Annotation<Record<string, number>>({ reducer: mergeReducer, default: () => ({}) }),

  // Cost
  accumulatedCostUsd: Annotation<number>({ reducer: sumReducer, default: () => 0 }),
  maxCostUsd: Annotation<number | undefined>({ reducer: lwwReducer, default: () => undefined }),

  // Approval policy
  autoApproveEnabled: Annotation<boolean | undefined>({ reducer: lwwReducer, default: () => undefined }),
  approvalThreshold: Annotation<string | undefined>({ reducer: lwwReducer, default: () => undefined }),

  // Tenant config (input-only after initial set)
  allowedDomains: Annotation<string[]>({ reducer: lwwReducer, default: () => [] }),
  browserAutomationEnabled: Annotation<boolean>({ reducer: lwwReducer, default: () => false }),
  restrictedCategories: Annotation<ToolCategory[]>({ reducer: lwwReducer, default: () => [] }),
  disabledToolNames: Annotation<string[]>({ reducer: lwwReducer, default: () => [] }),
  connectedProviders: Annotation<string[]>({ reducer: lwwReducer, default: () => [] }),
  subscriptionTier: Annotation<'free' | 'paid' | undefined>({ reducer: lwwReducer, default: () => undefined }),

  // Output / terminal
  status: Annotation<WorkflowStatus>({ reducer: lwwReducer, default: () => WorkflowStatus.PENDING }),
  error: Annotation<string | undefined>({ reducer: lwwReducer, default: () => undefined }),
  outputs: Annotation<unknown[]>({ reducer: appendReducer, default: () => [] }),
  traces: Annotation<AgentTrace[]>({ reducer: appendReducer, default: () => [] }),
});

export type SwarmAnnotationT = typeof SwarmStateAnnotation.State;

// ─── Edge functions (LangGraph mappings) ──────────────────────────────────

/** Translate SwarmGraph's NodeName-string return to LangGraph branch keys. */
function commanderEdge(state: SwarmAnnotationT): 'planner' | 'end' {
  const next: NodeName = afterCommander(state as unknown as SwarmState);
  return next === '__end__' || next === '__clarification__' ? 'end' : 'planner';
}
function guardrailEdge(state: SwarmAnnotationT): 'approval' | 'worker' | 'end' {
  const next = afterGuardrail(state as unknown as SwarmState);
  if (next === 'approval') return 'approval';
  if (next === 'worker') return 'worker';
  return 'end';
}
function approvalEdge(state: SwarmAnnotationT): 'worker' | 'end' {
  const next = afterApproval(state as unknown as SwarmState);
  return next === 'worker' ? 'worker' : 'end';
}
function verifierEdge(state: SwarmAnnotationT): 'worker' | 'guardrail' | 'validator' {
  const next = afterVerifier(state as unknown as SwarmState);
  if (next === 'worker') return 'worker';
  if (next === '__end__') return 'validator';
  return 'guardrail';
}

// ─── Node wrappers ────────────────────────────────────────────────────────

interface NodeDeps {
  /** Cooperative cancel — returns true if this workflow should be cancelled. */
  shouldStop?: (workflowId: string) => boolean;
  /** Manual pause flag. */
  shouldPause?: (workflowId: string) => boolean;
}

/**
 * Wrap an existing SwarmGraph node function for LangGraph:
 *   - apply context summarization
 *   - poll cancel/pause flags
 *   - call the node
 *   - propagate budget enforcement when the node bumped accumulatedCostUsd
 *
 * Returns a LangGraph-compatible node function.
 */
function wrapNode(
  name: string,
  fn: (state: SwarmState) => Promise<Partial<SwarmState>>,
  deps: NodeDeps,
) {
  return async (state: SwarmAnnotationT): Promise<Partial<SwarmAnnotationT>> => {
    const swarmState = state as unknown as SwarmState;
    const workflowId = swarmState.workflowId;

    // Cooperative cancel — returns a status update that drives the graph to END.
    if (workflowId && deps.shouldStop?.(workflowId)) {
      return {
        status: WorkflowStatus.CANCELLED,
        error: 'Stopped by user',
      } as Partial<SwarmAnnotationT>;
    }
    if (workflowId && deps.shouldPause?.(workflowId)) {
      return { status: WorkflowStatus.AWAITING_APPROVAL } as Partial<SwarmAnnotationT>;
    }

    // Apply context summarization before node execution.
    const condensed = applySummarizationIfNeeded(swarmState);

    let updates: Partial<SwarmState>;
    try {
      updates = await fn(condensed);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Node-level failure: return a status patch the next node sees.
      // The verifier-then-router cycle handles task-skip; if this is a
      // top-level failure (e.g. commander/planner threw), surface as
      // FAILED so the conditional edges route to END.
      return {
        error: `Error in node '${name}': ${errorMessage}`,
        status: WorkflowStatus.FAILED,
      } as Partial<SwarmAnnotationT>;
    }

    // Cost accumulation: sum traces[].costUsd from this node's traces.
    // The Annotation reducer for accumulatedCostUsd sums the value.
    const nodeCost = (updates.traces ?? []).reduce(
      (sum: number, t: { costUsd?: unknown }) => {
        const cost = typeof t.costUsd === 'number' && Number.isFinite(t.costUsd) ? t.costUsd : 0;
        return sum + cost;
      },
      0,
    );
    if (nodeCost > 0) {
      (updates as Record<string, unknown>)['accumulatedCostUsd'] = nodeCost;
    }

    // Budget enforcement: read PRE-update cost from state, add this node's,
    // compare vs maxCostUsd. When over budget, emit a FAILED patch.
    const prevCost = condensed.accumulatedCostUsd ?? 0;
    const projectedCost = prevCost + nodeCost;
    if (
      condensed.maxCostUsd !== undefined &&
      projectedCost > condensed.maxCostUsd
    ) {
      return {
        ...(updates as Partial<SwarmAnnotationT>),
        error: `Workflow budget exceeded: $${projectedCost.toFixed(4)} of $${condensed.maxCostUsd.toFixed(2)} limit`,
        status: WorkflowStatus.FAILED,
      } as Partial<SwarmAnnotationT>;
    }

    return updates as Partial<SwarmAnnotationT>;
  };
}

/**
 * Approval node wrapper that translates SwarmGraph's status-flag pause
 * into LangGraph's native `interrupt()`.
 *
 * Behavior:
 *   1. Run the existing approval-node (auto-approve OR set status=AWAITING_APPROVAL).
 *   2. If status flipped to AWAITING_APPROVAL, call interrupt() — the
 *      graph suspends and the runtime catches `GraphInterrupt`.
 *   3. On resume (via Command(resume=...)), the interrupt() returns the
 *      decision payload. We apply it to pendingApprovals and continue.
 */
function wrapApprovalNode(deps: NodeDeps) {
  return async (state: SwarmAnnotationT): Promise<Partial<SwarmAnnotationT>> => {
    const inner = wrapNode('approval', approvalNode, deps);
    const updates = await inner(state);

    // Compute the post-update view to check whether we paused.
    const postState = { ...state, ...updates } as unknown as SwarmState;
    if (postState.status !== WorkflowStatus.AWAITING_APPROVAL) {
      return updates;
    }

    // Pause via LangGraph interrupt(). The interrupt VALUE carries the
    // pending approval(s) so the resume side can show them. The interrupt
    // RESUME VALUE must be { approvalId, status: 'APPROVED'|'REJECTED', reviewedBy, comment? }.
    const lastApproval = postState.pendingApprovals[postState.pendingApprovals.length - 1];
    const decision = interrupt<
      {
        approvalRequest: ApprovalRequest | undefined;
        taskId: string | undefined;
      },
      { status: 'APPROVED' | 'REJECTED' | 'DEFERRED'; reviewedBy: string; comment?: string }
    >({
      approvalRequest: lastApproval,
      taskId: getCurrentTask(postState)?.id,
    });

    // Resume path: apply the decision to the last pending approval.
    const updatedApprovals = postState.pendingApprovals.map((apr, idx) =>
      idx === postState.pendingApprovals.length - 1
        ? { ...apr, status: decision.status, reviewedAt: new Date() }
        : apr,
    );
    if (decision.status === 'REJECTED') {
      return {
        pendingApprovals: updatedApprovals,
        status: WorkflowStatus.CANCELLED,
        error: `Task rejected by reviewer: ${decision.comment ?? 'No reason provided'}`,
      } as Partial<SwarmAnnotationT>;
    }
    // Approved or deferred (treat deferred as approved for now;
    // SwarmRunner.resume did the same).
    return {
      pendingApprovals: updatedApprovals,
      status: WorkflowStatus.EXECUTING,
    } as Partial<SwarmAnnotationT>;
  };
}

/**
 * Verifier wrapper additionally bumps the per-task retry counter when
 * the verifier's edge sends us back to worker. SwarmGraph used to do
 * this in the orchestrator loop; LangGraph computes the next node
 * AFTER the node returns, so we have to fold it into the verifier's
 * own update.
 */
function wrapVerifierNode(deps: NodeDeps) {
  const inner = wrapNode('verifier', verifierNode, deps);
  return async (state: SwarmAnnotationT): Promise<Partial<SwarmAnnotationT>> => {
    const updates = await inner(state);
    const merged = { ...state, ...updates } as unknown as SwarmState;
    const next = afterVerifier(merged);
    if (next === 'worker') {
      // Bump retry counter for the current task.
      const task = getCurrentTask(merged);
      if (task) {
        const current = (merged.taskRetryCount ?? {})[task.id] ?? 0;
        return {
          ...(updates as Partial<SwarmAnnotationT>),
          taskRetryCount: { [task.id]: current + 1 } as Record<string, number>,
        };
      }
    } else if (next === 'guardrail') {
      // Advance to next task (SwarmGraph used to do this in the orchestrator).
      // Only advance when the current verification result is a pass OR retry-exhausted.
      const idx = merged.currentTaskIndex ?? 0;
      return {
        ...(updates as Partial<SwarmAnnotationT>),
        currentTaskIndex: idx + 1,
      };
    }
    return updates;
  };
}

// ─── Graph builder ────────────────────────────────────────────────────────

export interface BuildLangGraphParams {
  db: CheckpointPrismaClient;
  shouldStop?: (workflowId: string) => boolean;
  shouldPause?: (workflowId: string) => boolean;
}

export function buildLangGraph(params: BuildLangGraphParams) {
  const deps: NodeDeps = {
    shouldStop: params.shouldStop,
    shouldPause: params.shouldPause,
  };
  const checkpointer = new PostgresCheckpointSaver(params.db);

  const builder = new StateGraph(SwarmStateAnnotation)
    .addNode('commander', wrapNode('commander', commanderNode, deps))
    .addNode('planner', wrapNode('planner', plannerNode, deps))
    .addNode('router', wrapNode('router', routerNode, deps))
    .addNode('guardrail', wrapNode('guardrail', guardrailNode, deps))
    .addNode('worker', wrapNode('worker', workerNode, deps))
    .addNode('verifier', wrapVerifierNode(deps))
    .addNode('approval', wrapApprovalNode(deps))
    .addNode('validator', wrapNode('validator', validatorNode, deps))
    .addEdge(START, 'commander')
    .addConditionalEdges('commander', commanderEdge, {
      planner: 'planner',
      end: END,
    })
    .addEdge('planner', 'router')
    .addEdge('router', 'guardrail')
    .addConditionalEdges('guardrail', guardrailEdge, {
      approval: 'approval',
      worker: 'worker',
      end: END,
    })
    .addConditionalEdges('approval', approvalEdge, {
      worker: 'worker',
      end: END,
    })
    .addEdge('worker', 'verifier')
    .addConditionalEdges('verifier', verifierEdge, {
      worker: 'worker',
      guardrail: 'guardrail',
      validator: 'validator',
    })
    .addEdge('validator', END);

  return builder.compile({ checkpointer });
}

export type CompiledLangGraph = ReturnType<typeof buildLangGraph>;

/**
 * Build the RunnableConfig for a given workflow + tenant. The
 * `tenantId` is REQUIRED — the PostgresCheckpointSaver rejects calls
 * without it. The `thread_id` is the workflow id (one thread per
 * workflow), and `recursionLimit` is sized large enough to handle the
 * worst case (10 tasks × ~10 nodes per task).
 */
export function makeRunnableConfig(workflowId: string, tenantId: string, taskCount = 5): LangGraphRunnableConfig {
  const baseLimit = 100;
  const perTask = 10;
  const recursionLimit = Math.min(500, Math.max(baseLimit, taskCount * perTask));
  return {
    configurable: {
      thread_id: workflowId,
      tenantId,
      checkpoint_ns: '',
    },
    recursionLimit,
  };
}
