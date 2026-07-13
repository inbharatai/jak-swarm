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
  AutonomyLevel,
  FailureDiagnosis,
  HyperAgentMode,
  OutputCorrection,
  PlanVersion,
  ReplanResult,
  RepairBudget,
  TaskRepairState,
  DiagnosisRecord,
  LearningCandidate,
  OutcomeEvaluation,
} from '@jak-swarm/shared';
import type { MissionBrief, RouteMap, GuardrailResult, VerificationResult } from '@jak-swarm/agents';
import { applySummarizationIfNeeded } from '../context/context-summarizer.js';
import { freshTaskRepairState } from '../recovery/failure-classifier.js';
import { commanderNode } from '../graph/nodes/commander-node.js';
import { plannerNode } from '../graph/nodes/planner-node.js';
import type { PlannerNodeDeps } from '../graph/nodes/planner-node.js';
import { routerNode } from '../graph/nodes/router-node.js';
import { guardrailNode } from '../graph/nodes/guardrail-node.js';
import { workerNode } from '../graph/nodes/worker-node.js';
import { verifierNode } from '../graph/nodes/verifier-node.js';
import { approvalNode } from '../graph/nodes/approval-node.js';
import { validatorNode } from '../graph/nodes/validator-node.js';
import { failureDiagnosisNode } from '../graph/nodes/failure-diagnosis-node.js';
import type { FailureDiagnosisNodeDeps } from '../graph/nodes/failure-diagnosis-node.js';
import { replannerNode } from '../graph/nodes/replanner-node.js';
import type { ReplannerNodeDeps } from '../graph/nodes/replanner-node.js';
import { learningNode } from '../graph/nodes/learning-node.js';
import type { LearningNodeDeps } from '../graph/nodes/learning-node.js';
import {
  afterCommander,
  afterPlanner,
  afterGuardrail,
  afterApproval,
  afterVerifier,
  afterDiagnosis,
  afterReplanner,
  afterValidator,
  decideVerifierRouting,
  type NodeName,
} from '../graph/edges.js';
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
 *   - Append for traces / outputs; replace approvals by id so resume decisions
 *     update existing cards instead of duplicating them.
 *   - Sum for accumulatedCostUsd.
 */
const lwwReducer = <T>(_old: T, next: T) => (next === undefined ? _old : next);
/**
 * Clearable last-writer-wins: `next` ALWAYS wins, INCLUDING when it is
 * `undefined` (which clears the field). Used ONLY for state a node can
 * legitimately reset after recovery — currently `error` (the replanner returns
 * `error: undefined` to clear a stale error before re-executing a revised plan).
 *
 * Why not use this everywhere? LangGraph only dispatches a channel's reducer for
 * keys a node ACTUALLY returned, so a node that omits `error` never touches the
 * reducer — `undefined` is therefore always an explicit "clear" intent, never a
 * "leave it alone" intent. The plain `lwwReducer` (which keeps the old value on
 * `undefined`) was a defensive no-op guard that had the unintended effect of
 * making the stale-error clear a no-op: a workflow that failed, got re-planned,
 * and then completed successfully still carried the stale error in its final
 * SwarmResult (`toSwarmResult` includes `state.error` whenever truthy), mis-
 * reporting a recovered run as errored.
 *
 * Safety: when `next === undefined` wins, the BinaryOperatorAggregate channel
 * value becomes `undefined` — identical to its initial state (the `default:
 * () => undefined` factory already yields `undefined` at startup, so `get()`
 * throws `EmptyChannelError` and the key is omitted from the assembled state →
 * `state.error` is `undefined`). Clearing simply returns the channel to that
 * initial semantic state; verified against @langchain/langgraph 1.4.7's
 * BinaryOperatorAggregate.update + _isOverwriteValue (a plain `undefined` write
 * is NOT an Overwrite sentinel, so it IS dispatched to the operator).
 */
export const clearableLwwReducer = <T>(_old: T, next: T) => next;
const mergeReducer = <T extends Record<string, unknown>>(old: T | undefined, next: T | undefined): T => {
  if (!next) return old ?? ({} as T);
  return { ...(old ?? {} as T), ...next };
};
const appendReducer = <T>(old: T[] | undefined, next: T[] | undefined): T[] => {
  if (!next) return old ?? [];
  return [...(old ?? []), ...next];
};
const approvalReducer = (
  old: ApprovalRequest[] | undefined,
  next: ApprovalRequest[] | undefined,
): ApprovalRequest[] => {
  if (!next || next.length === 0) return old ?? [];
  const byId = new Map<string, ApprovalRequest>();
  for (const approval of old ?? []) byId.set(approval.id, approval);
  for (const approval of next) byId.set(approval.id, approval);
  return Array.from(byId.values());
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
  pendingApprovals: Annotation<ApprovalRequest[]>({ reducer: approvalReducer, default: () => [] }),

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
  // Standing Order tool whitelist — must be a declared channel or LangGraph's
  // StateGraph strips the field set by createInitialSwarmState, leaving every
  // node reading `undefined` and the registry chokepoint never enforcing it.
  allowedToolNames: Annotation<string[]>({ reducer: lwwReducer, default: () => [] }),
  connectedProviders: Annotation<string[]>({ reducer: lwwReducer, default: () => [] }),
  subscriptionTier: Annotation<'free' | 'paid' | undefined>({ reducer: lwwReducer, default: () => undefined }),

  // Google grounding config (Gemini-only)
  googleSearchGrounding: Annotation<boolean | undefined>({ reducer: lwwReducer, default: () => undefined }),
  vertexAISearchDatastore: Annotation<string | undefined>({ reducer: lwwReducer, default: () => undefined }),
  openaiWebSearch: Annotation<boolean | undefined>({ reducer: lwwReducer, default: () => undefined }),

  // Output / terminal
  status: Annotation<WorkflowStatus>({ reducer: lwwReducer, default: () => WorkflowStatus.PENDING }),
  // `error` is clearable: a recovering node (replanner) returns `error: undefined`
  // to clear a stale error before re-execution. See clearableLwwReducer above.
  error: Annotation<string | undefined>({ reducer: clearableLwwReducer, default: () => undefined }),
  outputs: Annotation<unknown[]>({ reducer: appendReducer, default: () => [] }),
  traces: Annotation<AgentTrace[]>({ reducer: appendReducer, default: () => [] }),

  // ─── HyperAgent (Phase 4+) ───────────────────────────────────────────────
  hyperAgentEnabled: Annotation<boolean | undefined>({ reducer: lwwReducer, default: () => undefined }),
  hyperAgentMode: Annotation<HyperAgentMode | undefined>({ reducer: lwwReducer, default: () => undefined }),
  autonomyLevel: Annotation<AutonomyLevel | undefined>({ reducer: lwwReducer, default: () => undefined }),
  repairBudget: Annotation<RepairBudget | undefined>({ reducer: lwwReducer, default: () => undefined }),
  executionMode: Annotation<'standard' | 'hyperagent' | 'shadow' | undefined>({ reducer: lwwReducer, default: () => undefined }),
  activePlanVersion: Annotation<number>({ reducer: lwwReducer, default: () => 0 }),
  planHistory: Annotation<PlanVersion[]>({ reducer: appendReducer, default: () => [] }),
  taskRepairState: Annotation<Record<string, TaskRepairState>>({ reducer: mergeReducer, default: () => ({}) }),
  failureDiagnoses: Annotation<Record<string, FailureDiagnosis>>({ reducer: mergeReducer, default: () => ({}) }),
  repairProposals: Annotation<ReplanResult[]>({ reducer: appendReducer, default: () => [] }),
  hyperAgentIteration: Annotation<number>({ reducer: lwwReducer, default: () => 0 }),
  maxHyperAgentIterations: Annotation<number>({ reducer: lwwReducer, default: () => 3 }),
  pendingDiagnoses: Annotation<Record<string, DiagnosisRecord>>({ reducer: mergeReducer, default: () => ({}) }),
  // R2 CORRECT_OUTPUT typed correction (Phase 5). `clearableLwwReducer` so the
  // verifier can clear it by returning `outputCorrection: undefined` when the
  // task passes or the failure is not malformed-output. Only the verifier
  // returns this key, so no other node can accidentally clear it.
  outputCorrection: Annotation<OutputCorrection | undefined>({
    reducer: clearableLwwReducer,
    default: () => undefined,
  }),

  // ─── HyperAgent self-learning (Phase 5 live wiring) ───────────────────────
  // outcomeEvaluation: lww (single write by the learning node per run).
  // learningCandidates: lww (single write; the full candidate set for this run).
  // relevantLearnings: lww (written once by Phase 3 recall before the planner).
  // promotedLearnings: lww (written by the learning node as a persist side effect).
  outcomeEvaluation: Annotation<OutcomeEvaluation | undefined>({ reducer: lwwReducer, default: () => undefined }),
  learningCandidates: Annotation<LearningCandidate[] | undefined>({ reducer: lwwReducer, default: () => undefined }),
  relevantLearnings: Annotation<Array<{ key: string; summary: string; confidence: number }> | undefined>({
    reducer: lwwReducer,
    default: () => undefined,
  }),
  promotedLearnings: Annotation<Array<{ key: string; mutualInformation: number }> | undefined>({
    reducer: lwwReducer,
    default: () => undefined,
  }),
  // banditSelections: lww (single write by the Phase 3 planner recall+bandit step).
  banditSelections: Annotation<
    Array<{
      taskId: string;
      taskType: string;
      selectedKey: string;
      selectedConfig: string | undefined;
      applied: boolean;
      strategy: string;
      score: number;
      reason: string;
    }> | undefined
  >({ reducer: lwwReducer, default: () => undefined }),
});

export type SwarmAnnotationT = typeof SwarmStateAnnotation.State;

// ─── Edge functions (LangGraph mappings) ──────────────────────────────────

/** Translate SwarmGraph's NodeName-string return to LangGraph branch keys. */
function commanderEdge(state: SwarmAnnotationT): 'planner' | 'end' {
  const next: NodeName = afterCommander(state as unknown as SwarmState);
  return next === '__end__' || next === '__clarification__' ? 'end' : 'planner';
}
function plannerEdge(state: SwarmAnnotationT): 'router' | 'end' {
  const next: NodeName = afterPlanner(state as unknown as SwarmState);
  return next === '__end__' ? 'end' : 'router';
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
function verifierEdge(state: SwarmAnnotationT): 'worker' | 'guardrail' | 'validator' | 'diagnosis' {
  const next = afterVerifier(state as unknown as SwarmState);
  if (next === 'worker') return 'worker';
  if (next === 'diagnosis') return 'diagnosis';
  if (next === '__end__') return 'validator';
  return 'guardrail';
}
function diagnosisEdge(state: SwarmAnnotationT): 'replanner' | 'validator' {
  const next = afterDiagnosis(state as unknown as SwarmState);
  return next === 'replanner' ? 'replanner' : 'validator';
}
function replannerEdge(state: SwarmAnnotationT): 'guardrail' | 'validator' | 'end' {
  const next = afterReplanner(state as unknown as SwarmState);
  if (next === 'guardrail') return 'guardrail';
  if (next === 'validator') return 'validator';
  return 'end';
}
/** Validator terminal edge: route to the learning node when HyperAgent is ON
 *  and the run is terminal (COMPLETED/FAILED), else straight to END. */
function validatorEdge(state: SwarmAnnotationT): 'learning' | 'end' {
  const next = afterValidator(state as unknown as SwarmState);
  return next === 'learning' ? 'learning' : 'end';
}

// ─── Node wrappers ────────────────────────────────────────────────────────

interface NodeDeps {
  /** Cooperative cancel — returns true if this workflow should be cancelled. */
  shouldStop?: (workflowId: string) => boolean;
  /** Manual pause flag. */
  shouldPause?: (workflowId: string) => boolean;
}

/**
 * Race a node promise against a timeout, CLEARING the timer the moment the
 * node settles (success or failure) so a fast node does not leave a 120s
 * dangling timer per invocation.
 *
 * The prior implementation used `Promise.race([fn, new Promise(reject =>
 * setTimeout(reject, t))])` and never cleared the timer: when `fn` resolved
 * quickly (the common case), the 120s timeout timer kept running for every
 * single node invocation, leaking one timer per node call for the full
 * timeout window. Over a long workflow with many nodes this held an unbounded
 * number of live timers (and, under real timers, kept the event loop alive).
 *
 * The underlying node work is NOT cancelled when the timeout wins — there is no
 * AbortSignal plumbed through the node contract — only the timer is cleared;
 * an orphaned late resolution is dropped on the floor. Exported for unit
 * testing of the cleanup behaviour.
 */
export async function raceNodeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  name: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      timer = setTimeout(
        () => reject(new Error(`Node '${name}' exceeded ${timeoutMs}ms timeout`)),
        timeoutMs,
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    fn()
      .then((result) => {
        if (timer) clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
  });
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
      // Node-level timeout — prevents any single node from hanging the workflow.
      // 120s matches the documented NODE_TIMEOUT_MS in ARCHITECTURE.md.
      const NODE_TIMEOUT_MS = 120_000;
      updates = await raceNodeWithTimeout(() => fn(condensed), NODE_TIMEOUT_MS, name);
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
    if (decision.status === 'DEFERRED') {
      return {
        pendingApprovals: updatedApprovals,
        status: WorkflowStatus.AWAITING_APPROVAL,
      } as Partial<SwarmAnnotationT>;
    }

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
 *
 * Phase 5: the counter bumped depends on the routing reason from
 * `decideVerifierRouting` — `legacy-retry` bumps `taskRetryCount`, while
 * `typed-correction` bumps `taskRepairState[taskId].outputRepairAttempts`
 * (the distinct R2 CORRECT_OUTPUT counter). Reading the decision from the
 * SAME pure function the edge uses guarantees the wrapper and the edge can
 * never disagree on which budget a worker re-run consumes.
 */
function wrapVerifierNode(deps: NodeDeps) {
  const inner = wrapNode('verifier', verifierNode, deps);
  return async (state: SwarmAnnotationT): Promise<Partial<SwarmAnnotationT>> => {
    const updates = await inner(state);
    const merged = { ...state, ...updates } as unknown as SwarmState;
    const decision = decideVerifierRouting(merged);
    if (decision.next === 'worker') {
      const task = getCurrentTask(merged);
      if (task) {
        if (decision.reason === 'typed-correction') {
          // Bump the R2 typed-correction counter (distinct from taskRetryCount).
          const prevRepair = merged.taskRepairState?.[task.id] ?? freshTaskRepairState(task.id);
          const failureClass = merged.outputCorrection?.failureClass;
          return {
            ...(updates as Partial<SwarmAnnotationT>),
            taskRepairState: {
              [task.id]: {
                ...prevRepair,
                outputRepairAttempts: prevRepair.outputRepairAttempts + 1,
                ...(failureClass ? { lastFailureClass: failureClass } : {}),
              },
            } as Record<string, TaskRepairState>,
          };
        }
        // Legacy same-input retry — bump the shared retry counter.
        const current = (merged.taskRetryCount ?? {})[task.id] ?? 0;
        return {
          ...(updates as Partial<SwarmAnnotationT>),
          taskRetryCount: { [task.id]: current + 1 } as Record<string, number>,
        };
      }
    } else if (decision.next === 'guardrail') {
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
  /**
   * HyperAgent node dependencies (Phase 4+). When omitted, the diagnosis +
   * replanner nodes run with no injected LLM / counterfactual re-executor —
   * the deterministic classifier + deterministic proposer handle everything —
   * and the learning node runs evaluate+extract into state only (no durable
   * persist). The new nodes are only REACHABLE when the run has
   * `hyperAgentMode !== OFF && hyperAgentEnabled` (see edges.ts), so omitting
   * this keeps legacy workflows byte-for-byte unchanged.
   */
  hyperAgent?: {
    failureDiagnosis?: FailureDiagnosisNodeDeps;
    replanner?: ReplannerNodeDeps;
    /** Phase 5 self-learning node deps (persist seam + gate overrides). */
    learning?: LearningNodeDeps;
    /** Phase 3 planner recall + bandit selection deps (recall db + bandit cfg). */
    planner?: PlannerNodeDeps;
  };
}

export function buildLangGraph(params: BuildLangGraphParams) {
  const deps: NodeDeps = {
    shouldStop: params.shouldStop,
    shouldPause: params.shouldPause,
  };
  const checkpointer = new PostgresCheckpointSaver(params.db);
  const failureDiagnosisDeps = params.hyperAgent?.failureDiagnosis ?? {};
  const replannerDeps = params.hyperAgent?.replanner ?? {};
  const learningDeps = params.hyperAgent?.learning ?? {};
  const plannerDeps = params.hyperAgent?.planner ?? {};

  const builder = new StateGraph(SwarmStateAnnotation)
    .addNode('commander', wrapNode('commander', commanderNode, deps))
    .addNode('planner', wrapNode('planner', (s) => plannerNode(s, plannerDeps), deps))
    .addNode('router', wrapNode('router', routerNode, deps))
    .addNode('guardrail', wrapNode('guardrail', guardrailNode, deps))
    .addNode('worker', wrapNode('worker', workerNode, deps))
    .addNode('verifier', wrapVerifierNode(deps))
    .addNode('approval', wrapApprovalNode(deps))
    .addNode('validator', wrapNode('validator', validatorNode, deps))
    // HyperAgent Phase 4 nodes — only reachable when hyperAgentActive(state).
    .addNode(
      'diagnosis',
      wrapNode('diagnosis', (s) => failureDiagnosisNode(s, failureDiagnosisDeps), deps),
    )
    .addNode(
      'replanner',
      wrapNode('replanner', (s) => replannerNode(s, replannerDeps), deps),
    )
    // HyperAgent Phase 5 self-learning node — only reachable when
    // hyperAgentActive(state) AND the run is terminal (afterValidator).
    .addNode(
      'learning',
      wrapNode('learning', (s) => learningNode(s, learningDeps), deps),
    )
    .addEdge(START, 'commander')
    .addConditionalEdges('commander', commanderEdge, {
      planner: 'planner',
      end: END,
    })
    .addConditionalEdges('planner', plannerEdge, {
      router: 'router',
      end: END,
    })
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
      diagnosis: 'diagnosis',
    })
    // HyperAgent plan-repair routing (gated; unreachable when OFF).
    .addConditionalEdges('diagnosis', diagnosisEdge, {
      replanner: 'replanner',
      validator: 'validator',
    })
    .addConditionalEdges('replanner', replannerEdge, {
      guardrail: 'guardrail',
      validator: 'validator',
      end: END,
    })
    // Validator terminal: route through the learning node when HyperAgent is ON
    // and the run is terminal, else straight to END (legacy byte-for-byte).
    .addConditionalEdges('validator', validatorEdge, {
      learning: 'learning',
      end: END,
    })
    // The learning node is always terminal — after it accrues + persists, END.
    .addEdge('learning', END);

  return builder.compile({ checkpointer });
}

export type CompiledLangGraph = ReturnType<typeof buildLangGraph>;

/**
 * Spec-execution graph — Phase 6 `executeApprovedSpec` run seam.
 *
 * A FOCUSED subgraph that runs the REAL execution nodes (guardrail → worker →
 * verifier → validator) against a pre-materialised `WorkflowPlan`, WITHOUT the
 * commander/planner prefix (the plan is already decided — it came from an
 * APPROVED AgentExecutableSpec, so re-deriving it from the goal would break the
 * task-id binding the acceptance criteria depend on). START → guardrail.
 *
 * HyperAgent is OFF in this graph: the diagnosis/replanner/learning nodes are
 * absent, so `verifierEdge`'s `'diagnosis'` branch and `validatorEdge`'s
 * `'learning'` branch are unreachable — they are mapped to terminal paths
 * (validator / END) so LangGraph's conditional-edge mapping is exhaustive
 * without spawning the HyperAgent nodes. This is the spec EXECUTE half; the
 * self-healing/self-learning half is a separate concern.
 *
 * HONEST SCOPE: every node calls an LLM agent (GuardrailAgent / worker agent /
 * VerifierAgent / validator agent), so invoking this graph is env-blocked
 * without provider keys — wired-into-runtime, NOT production-proven here. The
 * closed-loop LOGIC that consumes this graph's output is proven by the
 * integration test with a stub runPlan.
 */
export interface SpecExecutionGraphParams {
  db: CheckpointPrismaClient;
  shouldStop?: (workflowId: string) => boolean;
  shouldPause?: (workflowId: string) => boolean;
}

export function buildSpecExecutionGraph(params: SpecExecutionGraphParams) {
  const deps: NodeDeps = {
    shouldStop: params.shouldStop,
    shouldPause: params.shouldPause,
  };
  const checkpointer = new PostgresCheckpointSaver(params.db);

  const builder = new StateGraph(SwarmStateAnnotation)
    .addNode('guardrail', wrapNode('guardrail', guardrailNode, deps))
    .addNode('worker', wrapNode('worker', workerNode, deps))
    .addNode('verifier', wrapVerifierNode(deps))
    .addNode('approval', wrapApprovalNode(deps))
    .addNode('validator', wrapNode('validator', validatorNode, deps))
    .addEdge(START, 'guardrail')
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
    // HyperAgent is OFF → 'diagnosis' is unreachable; map it to 'validator' so
    // the conditional-edge mapping is exhaustive without a diagnosis node.
    .addConditionalEdges('verifier', verifierEdge, {
      worker: 'worker',
      guardrail: 'guardrail',
      validator: 'validator',
      diagnosis: 'validator',
    })
    // HyperAgent is OFF → 'learning' is unreachable; map it to END so the
    // mapping is exhaustive without a learning node.
    .addConditionalEdges('validator', validatorEdge, {
      learning: END,
      end: END,
    });

  return builder.compile({ checkpointer });
}

export type CompiledSpecExecutionGraph = ReturnType<typeof buildSpecExecutionGraph>;

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
