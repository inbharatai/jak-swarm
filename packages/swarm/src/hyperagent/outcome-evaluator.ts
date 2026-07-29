/**
 * outcome-evaluator.ts — HyperAgent Phase 3: deterministic outcome evaluator.
 *
 * Pure. No I/O, no LLM, no DB. Consumes a finished (or halted) workflow run
 * and produces an `OutcomeEvaluation` value object that the thin persist seam
 * writes to `WorkflowOutcome` (migration 112). The Learning Extractor
 * (Phase 5) reads it back.
 *
 * Why pure: the verdict MUST be reproducible from the run's state alone — an
 * outcome that depends on a clock or an LLM cannot be audited or replayed.
 * Callers stamp `completedAt`/`startedAt`; we only subtract.
 *
 * Honest seams (do NOT paper over):
 *   - acceptanceCriteria: Phase 6 wires real evidence. Structured criteria
 *     (AcceptanceCriterion) paired with `acceptanceEvidence` are measured by the
 *     deterministic acceptance-checker (wired=true with real evidence). Criteria
 *     supplied as plain strings, or structured criteria without evidence, stay
 *     `satisfied=false`, `evidence=null`, `wired=false` (the legacy honest stub
 *     — never mark an unwired criterion satisfied). CUSTOM criteria are always
 *     wired=false and surface UNVERIFIABLE.
 *   - Counterfactual replay hints (innovation #1) are *hints*, not execution.
 *     Phase 4's diagnostician replays the agent-only/tool-only/model-only
 *     variants in a sandbox to isolate the fault dimension. The inputHash
 *     here is a stable proxy over the task definition until Phase 4 rewires
 *     the real task-input hash from ExecutionFailure.
 */

import { createHash } from 'node:crypto';
import type { WorkflowPlan, WorkflowTask } from '@jak-swarm/shared';
import { TaskStatus } from '@jak-swarm/shared';
import type { VerificationResult } from '@jak-swarm/agents';
import type { AutonomyDecision, FailureClass } from '@jak-swarm/shared';
import {
  OutcomeVerdict,
  TaskVerdict,
  type AcceptanceCriterion,
  type AcceptanceCriterionResult,
  type CounterfactualReplayHint,
  type OutcomeEvaluation,
  type RunEvidence,
  type TaskOutcome,
} from '@jak-swarm/shared';
import { checkCriterion } from './acceptance-checker.js';

/** Input bundle — everything the evaluator needs from a finished run. */
export interface OutcomeEvaluatorInput {
  workflowId: string;
  tenantId: string;
  plan: WorkflowPlan;
  /** Per-task verifier results (SwarmState.verificationResults). */
  verificationResults: Record<string, VerificationResult>;
  /** Task ids the run marked failed (SwarmState.failedTaskIds). */
  failedTaskIds?: string[];
  /** Task ids the run marked completed (SwarmState.completedTaskIds). */
  completedTaskIds?: string[];
  /** Run-level guardrail/policy block flag (SwarmState.blocked). */
  blocked?: boolean;
  /** Accumulated spend (SwarmState.accumulatedCostUsd). */
  accumulatedCostUsd?: number;
  startedAt: Date | string;
  completedAt: Date | string;
  /** Spec acceptanceCriteria — structured (AcceptanceCriterion) or legacy strings. */
  acceptanceCriteria?: Array<AcceptanceCriterion | string>;
  /**
   * Phase 6 — runtime evidence to bind structured criteria against. When
   * supplied alongside structured criteria, the deterministic acceptance-checker
   * measures them (wired=true). Without it, criteria stay unwired (honest stub).
   */
  acceptanceEvidence?: RunEvidence;
  /** Final autonomy decision snapshot for this run, if HyperAgent drove it. */
  finalAutonomy?: AutonomyDecision;
  /** Optional pre-classified failure class per failed task (from Phase 2). */
  failureClassByTask?: Record<string, FailureClass>;
  /** Optional per-task error message override (else read from plan task.error). */
  errorByTask?: Record<string, string>;
}

/**
 * Triage a single task. Pure.
 *
 * Rules (documented so Phase 4's rewiring can revise them deliberately):
 *   - SKIPPED                 → TASK_SKIPPED
 *   - ABSTAINED               → TASK_ABSTAINED (honest decline, NOT a failure —
 *                              never feeds failure statistics; carries the
 *                              worker's abstention detail through)
 *   - FAILED                  → TASK_FAILED
 *   - AWAITING_APPROVAL       → TASK_BLOCKED (halted for a human)
 *   - COMPLETED + verifier    → passed ? TASK_PASSED : TASK_FAILED
 *   - COMPLETED, no verifier  → TASK_PASSED (graph only marks COMPLETED when
 *                              the worker output is accepted for that role)
 *   - PENDING/IN_PROGRESS at
 *     run end + run blocked   → TASK_BLOCKED
 *   - PENDING/IN_PROGRESS at
 *     run end, not blocked    → TASK_FAILED (run ended without finishing it)
 */
function triageTask(
  task: WorkflowTask,
  verification: VerificationResult | undefined,
  runBlocked: boolean,
  failureClassByTask?: Record<string, FailureClass>,
  errorByTask?: Record<string, string>,
  industry?: string,
): TaskOutcome {
  const failureClass = failureClassByTask?.[task.id];
  const error = errorByTask?.[task.id] ?? task.error;
  // Phase 5 self-learning: carry the config (agent role + primary tool) so the
  // learning extractor can dimension WORKFLOW learnings by config and the
  // information-theoretic gate has the contrast it needs to fire.
  const agentRole = String(task.agentRole);
  const primaryTool = task.toolsRequired[0];
  // Phase 7: carry the full tool set + industry + risk level so the extractor's
  // composite key is order-invariant and dimensioned by industry / risk tier
  // (learnings do not cross-generalise across tool orderings, industries, or
  // risk tiers they were not observed on).
  const toolSet = task.toolsRequired;
  const riskLevel = task.riskLevel;

  switch (task.status) {
    case TaskStatus.SKIPPED:
      return { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_SKIPPED, verified: false, agentRole, primaryTool, toolSet, industry, riskLevel };
    case TaskStatus.ABSTAINED:
      // Calibrated abstention: an honest decline, not a failure. No
      // failureClass is attached (the learning extractor must not count this
      // as a failure observation); the worker's abstention detail carries the
      // reason + partial evidence for the user-facing "I don't know" surface.
      return {
        taskId: task.id,
        taskName: task.name,
        verdict: TaskVerdict.TASK_ABSTAINED,
        verified: false,
        abstention: task.abstention ?? { reason: task.error ?? 'worker abstained without recording a reason' },
        agentRole,
        primaryTool,
        toolSet,
        industry,
        riskLevel,
      };
    case TaskStatus.FAILED:
      return { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_FAILED, verified: false, failureClass, error, agentRole, primaryTool, toolSet, industry, riskLevel };
    case TaskStatus.AWAITING_APPROVAL:
      return { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_BLOCKED, verified: false, error, agentRole, primaryTool, toolSet, industry, riskLevel };
    case TaskStatus.COMPLETED:
      if (verification) {
        return verification.passed
          ? { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_PASSED, verified: true, verificationConfidence: verification.confidence, agentRole, primaryTool, toolSet, industry, riskLevel }
          : { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_FAILED, verified: true, verificationConfidence: verification.confidence, failureClass, error: error ?? verification.issues.join('; '), agentRole, primaryTool, toolSet, industry, riskLevel };
      }
      return { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_PASSED, verified: false, agentRole, primaryTool, toolSet, industry, riskLevel };
    case TaskStatus.PENDING:
    case TaskStatus.IN_PROGRESS:
    default:
      return runBlocked
        ? { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_BLOCKED, verified: false, error, agentRole, primaryTool, toolSet, industry, riskLevel }
        : { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_FAILED, verified: false, failureClass, error, agentRole, primaryTool, toolSet, industry, riskLevel };
  }
}

/**
 * Stable proxy hash over a task's deterministic definition. Phase 4 will
 * replace this with the real ExecutionFailure.inputHash once task-input
 * hashing is wired through the runner. Same definition ⇒ same hash ⇒
 * correlation across replays.
 */
export function taskDefinitionHash(task: WorkflowTask): string {
  const material = JSON.stringify({
    id: task.id,
    agentRole: task.agentRole,
    toolsRequired: task.toolsRequired,
    description: task.description,
  });
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** Build the counterfactual replay hint for a failed task (innovation #1). */
function counterfactualHint(
  task: WorkflowTask,
  failureClass?: FailureClass,
): CounterfactualReplayHint {
  return {
    taskId: task.id,
    agentRole: task.agentRole,
    toolName: task.toolsRequired[0],
    inputHash: taskDefinitionHash(task),
    failureClass,
    hypothesisSet: Object.freeze(['agent-only', 'tool-only', 'model-only']),
  };
}

/**
 * Evaluate a finished run. Pure — callers stamp timestamps.
 *
 * Verdict precedence:
 *   1. run-level block (guardrail/policy)            → OUTCOME_BLOCKED
 *   2. any task TASK_BLOCKED                          → OUTCOME_BLOCKED
 *   3. all active tasks passed (no fail, no block)    → OUTCOME_SUCCESS
 *   4. some active tasks passed                       → OUTCOME_PARTIAL
 *   5. no active task passed                          → OUTCOME_FAILED
 * (SKIPPED tasks are excluded from the active denominator.)
 */
export function evaluateOutcome(input: OutcomeEvaluatorInput): OutcomeEvaluation {
  const runBlocked = input.blocked === true;
  const taskOutcomes: TaskOutcome[] = input.plan.tasks.map((t) =>
    triageTask(
      t,
      input.verificationResults[t.id],
      runBlocked,
      input.failureClassByTask,
      input.errorByTask,
      input.plan.industry,
    ),
  );

  const taskPassed = taskOutcomes.filter((o) => o.verdict === TaskVerdict.TASK_PASSED).length;
  const taskFailed = taskOutcomes.filter((o) => o.verdict === TaskVerdict.TASK_FAILED).length;
  const taskBlocked = taskOutcomes.filter((o) => o.verdict === TaskVerdict.TASK_BLOCKED).length;
  const taskSkipped = taskOutcomes.filter((o) => o.verdict === TaskVerdict.TASK_SKIPPED).length;
  const taskAbstained = taskOutcomes.filter((o) => o.verdict === TaskVerdict.TASK_ABSTAINED).length;
  const taskTotal = input.plan.tasks.length;
  const activeTotal = taskTotal - taskSkipped;

  let verdict: OutcomeVerdict;
  if (runBlocked || taskBlocked > 0) {
    verdict = OutcomeVerdict.OUTCOME_BLOCKED;
  } else if (activeTotal === 0) {
    // No active tasks ran (empty plan, or every task SKIPPED — e.g. all
    // dependencies failed so every dependent was skipped). This is neither a
    // failure (nothing failed) nor a success (nothing passed); label it
    // BLOCKED so the learning extractor doesn't ingest a false FAILED signal
    // for a run that simply made no progress.
    verdict = OutcomeVerdict.OUTCOME_BLOCKED;
  } else if (taskAbstained === activeTotal) {
    // EVERY active task abstained. Abstention is honest, so this is not
    // FAILED — but the run produced no answers, so it is not SUCCESS either.
    // BLOCKED is the honest label: the run could not make verified progress,
    // and (like the all-skipped case above) the learning extractor must not
    // ingest a false FAILED signal for a run that simply declined to guess.
    verdict = OutcomeVerdict.OUTCOME_BLOCKED;
  } else if (activeTotal > 0 && taskPassed === activeTotal && taskFailed === 0) {
    verdict = OutcomeVerdict.OUTCOME_SUCCESS;
  } else if (taskPassed > 0 || taskAbstained > 0) {
    // Some answers passed and/or some tasks abstained (without failing) —
    // partial progress with honest gaps. (Abstentions never count toward the
    // pass numerator, so SUCCESS above already excluded them.)
    verdict = OutcomeVerdict.OUTCOME_PARTIAL;
  } else {
    verdict = OutcomeVerdict.OUTCOME_FAILED;
  }

  // Phase 6 acceptance seam: measure structured criteria against run evidence
  // when both are supplied; otherwise keep the honest wired=false stub. String
  // criteria (legacy) are always unwired — never fake a satisfied criterion.
  const acceptanceResults: AcceptanceCriterionResult[] = measureAcceptanceSeam(
    input.acceptanceCriteria,
    input.acceptanceEvidence,
    taskOutcomes,
  );

  // Counterfactual hints for every failed task — Phase 4 consumes these.
  const counterfactualHints: CounterfactualReplayHint[] = taskOutcomes
    .filter((o) => o.verdict === TaskVerdict.TASK_FAILED)
    .map((o) => {
      const task = input.plan.tasks.find((t) => t.id === o.taskId)!;
      return counterfactualHint(task, o.failureClass);
    });

  const startedMs = new Date(input.startedAt).getTime();
  const completedMs = new Date(input.completedAt).getTime();
  const durationMs = Number.isFinite(completedMs) && Number.isFinite(startedMs)
    ? Math.max(0, completedMs - startedMs)
    : 0;

  const summary = buildSummary(verdict, taskPassed, taskFailed, taskBlocked, taskSkipped, taskAbstained, activeTotal);

  return {
    workflowId: input.workflowId,
    tenantId: input.tenantId,
    verdict,
    taskTotal,
    taskPassed,
    taskFailed,
    taskBlocked,
    taskSkipped,
    taskAbstained,
    taskOutcomes,
    acceptanceResults,
    totalCostUsd: input.accumulatedCostUsd ?? 0,
    durationMs,
    finalAutonomy: input.finalAutonomy,
    counterfactualHints,
    summary,
  };
}

function buildSummary(
  verdict: OutcomeVerdict,
  passed: number,
  failed: number,
  blocked: number,
  skipped: number,
  abstained: number,
  activeTotal: number,
): string {
  const counts = `passed=${passed} failed=${failed} blocked=${blocked} skipped=${skipped} abstained=${abstained} (active=${activeTotal})`;
  const abstainNote = abstained > 0 ? ` ${abstained} task(s) abstained rather than guess.` : '';
  switch (verdict) {
    case OutcomeVerdict.OUTCOME_SUCCESS: return `All ${activeTotal} active task(s) verified-passed. ${counts}`;
    case OutcomeVerdict.OUTCOME_PARTIAL: return `Partial: ${passed}/${activeTotal} active task(s) passed.${abstainNote} ${counts}`;
    case OutcomeVerdict.OUTCOME_FAILED: return `Failed: 0/${activeTotal} active task(s) passed. ${counts}`;
    case OutcomeVerdict.OUTCOME_BLOCKED: return abstained > 0 && abstained === activeTotal
      ? `All ${activeTotal} active task(s) abstained — no verified progress. ${counts}`
      : `Blocked by guardrail/policy/approval. ${counts}`;
    default: return `Unknown verdict. ${counts}`;
  }
}

/**
 * Phase 6 acceptance seam. Pure.
 *
 * - Structured criterion + evidence supplied → measured by the deterministic
 *   acceptance-checker (wired=true, real evidence).
 * - Structured criterion WITHOUT evidence → honest stub (wired=false) — we have
 *   the shape to bind but not the run's evidence yet.
 * - String criterion (legacy) → honest stub (wired=false) — no binding exists.
 *
 * When evidence is supplied but lacks taskOutcomes (e.g. a caller only passed
 * metrics), fall back to the run's own triaged taskOutcomes so TASK_* criteria
 * still bind. Never fake a satisfied criterion.
 */
function measureAcceptanceSeam(
  criteria: Array<AcceptanceCriterion | string> | undefined,
  evidence: RunEvidence | undefined,
  taskOutcomes: TaskOutcome[],
): AcceptanceCriterionResult[] {
  if (!criteria || criteria.length === 0) return [];
  if (!evidence) {
    return criteria.map((c) => ({
      criterion: typeof c === 'string' ? c : c.description,
      satisfied: false,
      evidence: null,
      wired: false,
    }));
  }
  const fullEvidence: RunEvidence = {
    taskOutcomes: evidence.taskOutcomes.length > 0 ? evidence.taskOutcomes : taskOutcomes,
    artifacts: evidence.artifacts,
    metrics: evidence.metrics,
  };
  return criteria.map((c) => {
    if (typeof c === 'string') {
      return { criterion: c, satisfied: false, evidence: null, wired: false };
    }
    return checkCriterion(c, fullEvidence);
  });
}