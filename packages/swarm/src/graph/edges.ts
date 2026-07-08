/**
 * Pure conditional-edge functions for the JAK workflow graph.
 *
 * Extracted from swarm-graph.ts in Sprint 2.5 / A.6 so that the LangGraph
 * builder (langgraph-graph-builder.ts) can import them without depending
 * on the deleted SwarmGraph class. Each function reads `SwarmState` and
 * returns the next-node label.
 *
 * `__clarification__` and `__end__` are sentinel labels mapped to
 * LangGraph's `END` by the builder; nothing else uses them.
 */

import { HyperAgentMode, RepairLevel, WorkflowStatus } from '@jak-swarm/shared';
import type { SwarmState } from '../state/swarm-state.js';
import {
  getCurrentTask,
  hasMoreTasks,
  getCurrentVerificationResult,
} from '../state/swarm-state.js';

export type NodeName =
  | 'commander'
  | 'planner'
  | 'router'
  | 'guardrail'
  | 'worker'
  | 'verifier'
  | 'approval'
  | 'validator'
  | 'diagnosis'
  | 'replanner'
  | '__end__'
  | '__clarification__';

/**
 * Is the HyperAgent self-healing layer active for this run?
 *
 * The new diagnosis/replanner routing is GATED on this so that a workflow
 * with `hyperAgentMode === OFF` (or the layer disabled) behaves byte-for-byte
 * like the legacy graph — it can never reach the diagnosis/replanner nodes.
 * OBSERVE counts as active: it runs diagnosis + proposes a replan, then the
 * replanner node applies it only if the autonomy decision permits (at L0/L1
 * it pauses for approval or just records, never mutates).
 */
function hyperAgentActive(state: SwarmState): boolean {
  return (
    (state.hyperAgentEnabled ?? false) &&
    (state.hyperAgentMode ?? HyperAgentMode.OFF) !== HyperAgentMode.OFF
  );
}

/**
 * Has the HyperAgent exhausted its self-healing iteration budget for this run?
 * When true, a failed task routes to the final evaluator (validator) for
 * human escalation instead of looping back through diagnosis/replanner.
 */
function hyperAgentBudgetExhausted(state: SwarmState): boolean {
  const used = state.hyperAgentIteration ?? 0;
  const max = state.maxHyperAgentIterations ?? 3;
  return used >= max;
}

export function afterCommander(state: SwarmState): NodeName {
  // If commander failed (provider error, timeout, malformed response),
  // stop immediately so planner doesn't run without a mission brief.
  if (state.status === WorkflowStatus.FAILED) return '__end__';

  // Short-circuit: Commander answered the user directly (greeting,
  // trivial factual Q). Skip Planner/Router/Workers/Verifier entirely.
  if (state.directAnswer) return '__end__';
  if (state.clarificationNeeded) return '__clarification__';
  return 'planner';
}

export function afterPlanner(state: SwarmState): NodeName {
  // If the planner failed (no LLM key, timeout, budget exceeded, etc.),
  // do NOT advance to the router — it will crash with "no plan or mission
  // brief". Instead, route to END with the FAILED status already set.
  if (state.status === WorkflowStatus.FAILED || !state.plan) return '__end__';
  return 'router';
}

export function afterGuardrail(state: SwarmState): NodeName {
  if (state.blocked) return '__end__';
  const task = getCurrentTask(state);
  if (!task) return '__end__';
  if (task.requiresApproval) return 'approval';
  return 'worker';
}

export function afterApproval(state: SwarmState): NodeName {
  // Pending, rejected, or deferred decisions must not advance to the worker. The
  // approval node keeps DEFERRED runs in AWAITING_APPROVAL so the reviewer
  // can decide later through the proper approval endpoint.
  const lastApproval = state.pendingApprovals[state.pendingApprovals.length - 1];
  if (lastApproval?.status === 'PENDING') return '__end__';
  if (lastApproval?.status === 'REJECTED') return '__end__';
  if (lastApproval?.status === 'DEFERRED') return '__end__';
  return 'worker';
}

export function afterVerifier(state: SwarmState): NodeName {
  const currentResult = getCurrentVerificationResult(state);

  // R1/R2 output-repair loop — identical for legacy + HyperAgent. The
  // HyperAgent layer only takes over once the verifier says "no more
  // same-input retries" (needsRetry false OR the retry ceiling is hit).
  if (currentResult && !currentResult.passed && currentResult.needsRetry) {
    const task = getCurrentTask(state);
    const MAX_TASK_RETRIES = 3;
    const retries = task ? (state.taskRetryCount[task.id] ?? 0) : MAX_TASK_RETRIES;
    if (retries < MAX_TASK_RETRIES) {
      return 'worker';
    }
  }

  // HyperAgent plan-repair path (spec §6 case 3): when a task has failed
  // verification AND the R1/R2 loop is exhausted, route to root-cause
  // diagnosis instead of advancing. The diagnosis node classifies the
  // failure; the replanner node proposes + validates a revised plan.
  //
  // GATED: when the HyperAgent layer is OFF (or disabled) this branch is
  // unreachable, so legacy routing is unchanged.
  if (
    hyperAgentActive(state) &&
    currentResult &&
    !currentResult.passed &&
    !hyperAgentBudgetExhausted(state)
  ) {
    return 'diagnosis';
  }

  if (hasMoreTasks(state)) {
    return 'guardrail';
  }

  return '__end__';
}

/**
 * Edge from the diagnosis node. The diagnosis node wrote a `DiagnosisRecord`
 * into `pendingDiagnoses[taskId]` and left the workflow non-terminal.
 *
 * - R3 (PLAN_REPAIR) and not a hard block → replanner (propose + validate +
 *   maybe apply the revised plan).
 * - Anything else (R1/R2 on an already-retried task, a deterministic security
 *   block, a quarantine, or a budget-exhausted escalation) → validator, which
 *   is the final outcome evaluator + human-escalation path (spec §6 case 6).
 */
export function afterDiagnosis(state: SwarmState): NodeName {
  const task = getCurrentTask(state);
  if (!task) return 'validator';
  const pending = state.pendingDiagnoses?.[task.id];
  if (!pending) return 'validator';

  const diag = pending.diagnosis;
  // Hard blocks never reach the replanner — they are terminal escalations.
  if (diag.recommendedRepairLevel !== RepairLevel.R3_PLAN_REPAIR) {
    return 'validator';
  }
  // Budget exhausted mid-diagnosis → escalate rather than replan.
  if (hyperAgentBudgetExhausted(state)) {
    return 'validator';
  }
  return 'replanner';
}

/**
 * Edge from the replanner node. The replanner either applied a revised plan
 * (status EXECUTING, rewound to the failed task) or surfaced a terminal /
 * approval-paused state.
 *
 * - EXECUTING → guardrail (re-execute the revised plan from the rewound index;
 *   completed external actions are retained, only invalidated work re-runs).
 * - AWAITING_APPROVAL → __end__ (paused for a human; the runtime resumes via
 *   the approval endpoint, same as the task-approval pause).
 * - FAILED / anything else → validator (final evaluator + human escalation).
 */
export function afterReplanner(state: SwarmState): NodeName {
  if (state.status === WorkflowStatus.EXECUTING) return 'guardrail';
  if (state.status === WorkflowStatus.AWAITING_APPROVAL) return '__end__';
  return 'validator';
}
