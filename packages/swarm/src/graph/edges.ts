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

import {
  AutonomyCapability,
  AutonomyLevel,
  HyperAgentMode,
  RepairLevel,
  WorkflowStatus,
} from '@jak-swarm/shared';
import { evaluateForConfig } from '@jak-swarm/security';
import type { SwarmState } from '../state/swarm-state.js';
import {
  getCurrentTask,
  hasMoreTasks,
  getCurrentVerificationResult,
} from '../state/swarm-state.js';
import { ESCALATE_CLASSES } from '../hyperagent/replanner.js';

/**
 * Single source of truth for the per-task same-input (R1/R2) retry ceiling.
 *
 * `verifier-node` reads `state.taskRetryCount[task.id]` and `afterVerifier`
 * reads the same field against this same ceiling, so the verifier's retry
 * decision and the edge's routing decision can never disagree. Previously
 * the verifier tracked retries in `taskResults[${task.id}_retries]` under a
 * MAX=2 ceiling while the edge read `taskRetryCount` under MAX=3 — two
 * counters, two storages, two ceilings, with the 3-ceiling effectively dead
 * (the verifier's 2 bound first). Unifying on `taskRetryCount` + this one
 * constant removes the divergence. The richer typed `RepairBudget`
 * (hyperagent.ts) governs the HyperAgent repair-budget auction, not this
 * same-input loop.
 */
export const MAX_TASK_RETRIES = 2;

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
  | 'learning'
  | '__end__'
  | '__clarification__';

/**
 * Is the HyperAgent self-healing layer active for this run?
 *
 * The diagnosis/replanner routing AND the post-validator learning node are
 * GATED on this so that a workflow with `hyperAgentMode === OFF` (or the
 * layer disabled) behaves byte-for-byte like the legacy graph — it can never
 * reach the diagnosis/replanner/learning nodes. OBSERVE counts as active: it
 * runs diagnosis + proposes a replan, then the replanner node applies it only
 * if the autonomy decision permits (at L0/L1 it pauses for approval or just
 * records, never mutates). OBSERVE also runs the learning node so observations
 * accrue even when autonomy blocks mutation.
 */
export function hyperAgentActive(state: SwarmState): boolean {
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

/**
 * The reason `decideVerifierRouting` routed back to the worker. The verifier
 * wrapper (`wrapVerifierNode`) reads this to bump the RIGHT counter:
 *   - `legacy-retry`     → `taskRetryCount[taskId]++` (the R1/R2 same-input loop)
 *   - `typed-correction` → `taskRepairState[taskId].outputRepairAttempts++`
 *                          (the R2 CORRECT_OUTPUT loop — distinct counter)
 * Exposed so the wrapper and the edge can never disagree on which budget a
 * worker re-run consumes — the same divergence pattern that bit the legacy
 * R1/R2 loop before it was unified on `taskRetryCount` + `MAX_TASK_RETRIES`.
 */
export type VerifierRoutingReason =
  | 'typed-correction'
  | 'legacy-retry'
  | 'diagnosis'
  | 'next-task'
  | 'end';

export interface VerifierRoutingDecision {
  next: NodeName;
  reason: VerifierRoutingReason;
}

/**
 * Single source of truth for the post-verifier routing decision. Pure.
 *
 * Order of precedence on a retryable (`needsRetry`) failure:
 *   1. R2 CORRECT_OUTPUT typed correction — ONLY when the HyperAgent layer is
 *      ON, autonomy permits `CORRECT_OUTPUT` (L2+), and the verifier emitted
 *      an `outputCorrection` for the current task (malformed-output class). A
 *      malformed output is not helped by re-sending the identical input, so
 *      the worker is re-run with the correction threaded into its prompt.
 *      Budget: `outputRepairAttempts < maxOutputRepairs`, where
 *      `maxOutputRepairs` is capped at the shared `MAX_TASK_RETRIES` ceiling.
 *      When the typed budget exhausts, this escalates straight to R3 diagnosis
 *      (NOT a blind legacy retry — a second pass with guidance already failed).
 *   2. R1/R2 legacy same-input retry — the default loop. Runs when typed
 *      correction was not applicable (no correction payload, HyperAgent OFF,
 *      autonomy < L2, or the failure is not malformed-output). Unchanged from
 *      before; the HyperAgent OFF / L0–L1 path is byte-for-byte identical.
 *   3. R3 diagnosis — HyperAgent active, failed, plan-repair budget remains.
 *   4. Next task / END.
 *
 * Default workflows (HyperAgent OFF / L0) never take branch 1: the
 * `hyperAgentActive(state)` gate is false (OFF) and `evaluateForConfig` returns
 * `allowed=false` for CORRECT_OUTPUT at L0, so the function falls straight to
 * branch 2 — the legacy same-input retry, exactly as before.
 */
export function decideVerifierRouting(state: SwarmState): VerifierRoutingDecision {
  const currentResult = getCurrentVerificationResult(state);

  if (currentResult && !currentResult.passed && currentResult.needsRetry) {
    const task = getCurrentTask(state);
    const retries = task ? (state.taskRetryCount[task.id] ?? 0) : MAX_TASK_RETRIES;

    // ── Branch 1: R2 CORRECT_OUTPUT typed correction ───────────────────────
    // When the typed-correction budget exhausts we SKIP the legacy same-input
    // retry (a guided correction already failed; re-sending identical input
    // burns budget without new information) and escalate straight to R3.
    let skipLegacyRetry = false;
    const correction = state.outputCorrection;
    if (
      task &&
      correction &&
      correction.taskId === task.id &&
      hyperAgentActive(state)
    ) {
      const correctOutput = evaluateForConfig(
        {
          hyperAgentEnabled: state.hyperAgentEnabled ?? false,
          hyperAgentMode: state.hyperAgentMode ?? HyperAgentMode.OFF,
          autonomyLevel: state.autonomyLevel ?? AutonomyLevel.L0,
        },
        AutonomyCapability.CORRECT_OUTPUT,
      );
      if (correctOutput.allowed) {
        const outputRepairs = state.taskRepairState?.[task.id]?.outputRepairAttempts ?? 0;
        // Cap the configured budget at the shared ceiling so the typed loop
        // can never spin past MAX_TASK_RETRIES (belt-and-braces guard).
        const configuredMax = state.repairBudget?.maxOutputRepairs ?? MAX_TASK_RETRIES;
        const maxOutputRepairs = Math.min(configuredMax, MAX_TASK_RETRIES);
        if (outputRepairs < maxOutputRepairs) {
          return { next: 'worker', reason: 'typed-correction' };
        }
        // Typed budget exhausted → escalate to R3 diagnosis, skipping legacy.
        skipLegacyRetry = true;
      }
      // If CORRECT_OUTPUT is not allowed at this level (L0/L1), fall through to
      // the legacy same-input retry below — the default, unchanged behaviour.
    }

    // ── Branch 2: R1/R2 legacy same-input retry ─────────────────────────────
    if (!skipLegacyRetry && retries < MAX_TASK_RETRIES) {
      return { next: 'worker', reason: 'legacy-retry' };
    }
  }

  // ── Branch 3: R3 plan-repair diagnosis (HyperAgent only) ──────────────────
  // GATED: when the HyperAgent layer is OFF (or disabled) this branch is
  // unreachable, so legacy routing is unchanged.
  if (
    hyperAgentActive(state) &&
    currentResult &&
    !currentResult.passed &&
    !hyperAgentBudgetExhausted(state)
  ) {
    return { next: 'diagnosis', reason: 'diagnosis' };
  }

  // ── Branch 4: advance / END ───────────────────────────────────────────────
  if (hasMoreTasks(state)) {
    return { next: 'guardrail', reason: 'next-task' };
  }

  return { next: '__end__', reason: 'end' };
}

export function afterVerifier(state: SwarmState): NodeName {
  return decideVerifierRouting(state).next;
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
  // Security seal (Phase 3 Layer B). Even when the repair level is R3, a
  // security/capability/credential/external-state diagnosis (ESCALATE_CLASSES)
  // or any deterministic-block / quarantine must NEVER reach the replanner —
  // the replanner would hand it to an LLM proposer that cannot be trusted to
  // escalate a permission denial or prompt injection. Route to the validator
  // (the final outcome evaluator + human-escalation path). This is defense-in-
  // depth with the replanner's own pre-LLM guard (replanner.ts `replan()`).
  // The seal fields are typed top-level fields on FailureDiagnosis (previously
  // they were buried in the untyped `evidence` record and unreadable here).
  if (
    ESCALATE_CLASSES.has(diag.failureClass) ||
    diag.deterministicBlock ||
    diag.quarantine
  ) {
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

/**
 * Edge from the validator (the final outcome evaluator). The validator leaves
 * the run terminal (COMPLETED or FAILED). When the HyperAgent layer is ON, a
 * terminal run routes through the learning node FIRST so the outcome is
 * evaluated + learning candidates are extracted + persisted, THEN the graph
 * ends. When the HyperAgent layer is OFF (or disabled) this is a direct
 * validator → END edge — legacy workflows are byte-for-byte unchanged.
 *
 * Learning from BOTH COMPLETED and FAILED terminal runs is intentional: a
 * COMPLETED run yields WORKFLOW learnings (this config worked); a FAILED run
 * yields POLICY learnings (this failure class hit this task type). Both are
 * the honest information-theoretic signal the self-learning half exists to
 * accrue. Runs that never reached the validator (CANCELLED, AWAITING_APPROVAL,
 * blocked at the guardrail) bypass the learning node — they have no terminal
 * validator outcome to learn from.
 */
export function afterValidator(state: SwarmState): NodeName {
  const terminal =
    state.status === WorkflowStatus.COMPLETED || state.status === WorkflowStatus.FAILED;
  if (hyperAgentActive(state) && terminal) return 'learning';
  return '__end__';
}
