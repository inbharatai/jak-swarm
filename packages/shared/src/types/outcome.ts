/**
 * outcome.ts — HyperAgent Phase 3 outcome-evaluation types.
 *
 * The Outcome Evaluator consumes a finished (or halted) workflow run and
 * produces a structured `OutcomeEvaluation` — the HyperAgent's verdict on how
 * the run went. This is what gets persisted to `WorkflowOutcome` (migration
 * 112) and read by the Learning Extractor (Phase 5).
 *
 * Honest-seam note: the spec's `acceptanceCriteria` are typed on
 * `AgentExecutableSpec` but NOT yet consumed by the runner/verifier (audit
 * §0). The evaluator therefore records each criterion with
 * `satisfied: false` + `evidence: null` + `wired: false` rather than
 * pretending to verify them — Phase 6 wires real evidence, at which point
 * `wired` flips true. Never fake a satisfied criterion.
 */

import type { AutonomyDecision } from './hyperagent.js';
import type { FailureClass } from './failure.js';

/** Overall verdict the HyperAgent reaches for a run. */
export enum OutcomeVerdict {
  OUTCOME_SUCCESS = 'OUTCOME_SUCCESS', // every task verified-passed
  OUTCOME_PARTIAL = 'OUTCOME_PARTIAL', // some tasks passed, some failed
  OUTCOME_FAILED = 'OUTCOME_FAILED', // no task passed (and not blocked)
  OUTCOME_BLOCKED = 'OUTCOME_BLOCKED', // halted by a guardrail / policy / approval block
}

/** Per-task triage the evaluator computes. */
export enum TaskVerdict {
  TASK_PASSED = 'TASK_PASSED',
  TASK_FAILED = 'TASK_FAILED',
  TASK_BLOCKED = 'TASK_BLOCKED',
  TASK_SKIPPED = 'TASK_SKIPPED',
}

export interface TaskOutcome {
  taskId: string;
  taskName?: string;
  verdict: TaskVerdict;
  /** True when the verifier ran and returned passed=true. */
  verified: boolean;
  /** Verifier confidence 0..1, when available. */
  verificationConfidence?: number;
  /** Failure class from the deterministic classifier, when the task failed. */
  failureClass?: FailureClass;
  error?: string;
}

/**
 * One entry per spec acceptanceCriterion. `wired=false` until Phase 6 actually
 * binds criteria to runtime evidence — the evaluator must NOT mark an
 * unwired criterion `satisfied=true`.
 */
export interface AcceptanceCriterionResult {
  criterion: string;
  satisfied: boolean;
  evidence: string | null;
  /** False until Phase 6 binds the criterion to runtime evidence. */
  wired: boolean;
}

/**
 * Innovation #1 (causal counterfactual diagnosis seam). For each FAILED task,
 * the evaluator records the minimal, deterministic hint the Phase 4
 * diagnostician needs to replay agent-only / tool-only / model-only variants
 * on a sandboxed clone — instead of LLM-guessing a root cause from log
 * strings. This is a *hint*, never execution; Phase 4 consumes it.
 */
export interface CounterfactualReplayHint {
  taskId: string;
  agentRole: string;
  toolName?: string;
  /** Stable hash of the task input — correlates to ExecutionFailure.inputHash. */
  inputHash: string;
  failureClass?: FailureClass;
  /**
   * The three single-variable counterfactual variants Phase 4 will replay in
   * a sandbox: hold the agent, hold the tool, hold the model. Whichever
   * variant flips the outcome isolates the fault dimension.
   */
  hypothesisSet: ReadonlyArray<'agent-only' | 'tool-only' | 'model-only'>;
}

/** The full evaluation — pure value object, no I/O. Persisted as WorkflowOutcome. */
export interface OutcomeEvaluation {
  workflowId: string;
  tenantId: string;
  verdict: OutcomeVerdict;
  taskTotal: number;
  taskPassed: number;
  taskFailed: number;
  taskBlocked: number;
  taskSkipped: number;
  taskOutcomes: TaskOutcome[];
  acceptanceResults: AcceptanceCriterionResult[];
  totalCostUsd: number;
  durationMs: number;
  finalAutonomy?: AutonomyDecision;
  /** Counterfactual replay hints for every failed task (Phase 4 consumes). */
  counterfactualHints: CounterfactualReplayHint[];
  summary: string;
}