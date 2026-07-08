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
 *   - acceptanceCriteria are typed on AgentExecutableSpec but NOT yet consumed
 *     by the runner/verifier (audit §0). We record each criterion with
 *     `satisfied=false`, `evidence=null`, `wired=false`. Phase 6 flips `wired`
 *     and binds real evidence. Never mark an unwired criterion satisfied.
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
  type AcceptanceCriterionResult,
  type CounterfactualReplayHint,
  type OutcomeEvaluation,
  type TaskOutcome,
} from '@jak-swarm/shared';

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
  /** Spec acceptanceCriteria (AgentExecutableSpec.acceptanceCriteria), if any. */
  acceptanceCriteria?: string[];
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
): TaskOutcome {
  const failureClass = failureClassByTask?.[task.id];
  const error = errorByTask?.[task.id] ?? task.error;

  switch (task.status) {
    case TaskStatus.SKIPPED:
      return { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_SKIPPED, verified: false };
    case TaskStatus.FAILED:
      return { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_FAILED, verified: false, failureClass, error };
    case TaskStatus.AWAITING_APPROVAL:
      return { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_BLOCKED, verified: false, error };
    case TaskStatus.COMPLETED:
      if (verification) {
        return verification.passed
          ? { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_PASSED, verified: true, verificationConfidence: verification.confidence }
          : { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_FAILED, verified: true, verificationConfidence: verification.confidence, failureClass, error: error ?? verification.issues.join('; ') };
      }
      return { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_PASSED, verified: false };
    case TaskStatus.PENDING:
    case TaskStatus.IN_PROGRESS:
    default:
      return runBlocked
        ? { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_BLOCKED, verified: false, error }
        : { taskId: task.id, taskName: task.name, verdict: TaskVerdict.TASK_FAILED, verified: false, failureClass, error };
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
    ),
  );

  const taskPassed = taskOutcomes.filter((o) => o.verdict === TaskVerdict.TASK_PASSED).length;
  const taskFailed = taskOutcomes.filter((o) => o.verdict === TaskVerdict.TASK_FAILED).length;
  const taskBlocked = taskOutcomes.filter((o) => o.verdict === TaskVerdict.TASK_BLOCKED).length;
  const taskSkipped = taskOutcomes.filter((o) => o.verdict === TaskVerdict.TASK_SKIPPED).length;
  const taskTotal = input.plan.tasks.length;
  const activeTotal = taskTotal - taskSkipped;

  let verdict: OutcomeVerdict;
  if (runBlocked || taskBlocked > 0) {
    verdict = OutcomeVerdict.OUTCOME_BLOCKED;
  } else if (activeTotal > 0 && taskPassed === activeTotal && taskFailed === 0) {
    verdict = OutcomeVerdict.OUTCOME_SUCCESS;
  } else if (taskPassed > 0) {
    verdict = OutcomeVerdict.OUTCOME_PARTIAL;
  } else {
    verdict = OutcomeVerdict.OUTCOME_FAILED;
  }

  // Honest acceptance-criteria seam: record but do NOT verify until Phase 6.
  const acceptanceResults: AcceptanceCriterionResult[] = (input.acceptanceCriteria ?? []).map(
    (criterion) => ({ criterion, satisfied: false, evidence: null, wired: false }),
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

  const summary = buildSummary(verdict, taskPassed, taskFailed, taskBlocked, taskSkipped, activeTotal);

  return {
    workflowId: input.workflowId,
    tenantId: input.tenantId,
    verdict,
    taskTotal,
    taskPassed,
    taskFailed,
    taskBlocked,
    taskSkipped,
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
  activeTotal: number,
): string {
  const counts = `passed=${passed} failed=${failed} blocked=${blocked} skipped=${skipped} (active=${activeTotal})`;
  switch (verdict) {
    case OutcomeVerdict.OUTCOME_SUCCESS: return `All ${activeTotal} active task(s) verified-passed. ${counts}`;
    case OutcomeVerdict.OUTCOME_PARTIAL: return `Partial: ${passed}/${activeTotal} active task(s) passed. ${counts}`;
    case OutcomeVerdict.OUTCOME_FAILED: return `Failed: 0/${activeTotal} active task(s) passed. ${counts}`;
    case OutcomeVerdict.OUTCOME_BLOCKED: return `Blocked by guardrail/policy/approval. ${counts}`;
    default: return `Unknown verdict. ${counts}`;
  }
}