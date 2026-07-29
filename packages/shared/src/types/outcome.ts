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
import type { RiskLevel } from './workflow.js';

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
  /**
   * The worker declined to produce an answer it could not stand behind
   * (calibrated abstention). Abstention is HONEST behaviour — it is not a
   * failure and must not feed the failure statistics; but it also never
   * satisfies a completion/verification acceptance criterion. A run whose
   * tasks abstain is PARTIAL/UNVERIFIABLE, never silently SUCCESS.
   */
  TASK_ABSTAINED = 'TASK_ABSTAINED',
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
  /**
   * Calibrated abstention detail (Phase accuracy pass). Present when
   * `verdict === TASK_ABSTAINED`: the worker's own explanation of why it
   * declined, its self-reported confidence, and any partial evidence it did
   * gather. Surfaced to the user ("I don't know — here's what I do know")
   * and to the learning extractor (chronic-abstainer routing). Never
   * populated for PASS/FAIL verdicts.
   */
  abstention?: {
    reason: string;
    confidence?: number;
    partialEvidence?: string;
  };
  /**
   * Agent role that executed the task (Phase 5 self-learning). Carried from
   * WorkflowTask.agentRole so the learning extractor can dimension WORKFLOW
   * learnings by config — without this, every success of a task type folds
   * into one key (`cfg:<taskType>`) and the information-theoretic gate can
   * never fire (no contrast between competing configs). Optional so legacy
   * pure-core test inputs (which construct TaskOutcome by hand) keep
   * producing the legacy `cfg:<taskType>` key.
   */
  agentRole?: string;
  /** Primary tool the task was configured to use (toolsRequired[0]). */
  primaryTool?: string;
  /**
   * Phase 7 self-learning: the FULL tool set the task was configured to use
   * (WorkflowTask.toolsRequired). The learning extractor sorts + de-dupes this
   * into the composite key so a task whose tools were listed in a different
   * order does not shard into a separate learning row. Falls back to
   * `[primaryTool]` when unset (legacy pure-core test inputs).
   */
  toolSet?: string[];
  /**
   * Phase 7: industry the run was planned for (WorkflowPlan.industry). Stamped
   * by the outcome evaluator so a learning's key is dimensioned by industry —
   * learnings do not cross-generalise across industries they were not observed
   * on. Optional; absent on hand-constructed pure-core test inputs.
   */
  industry?: string;
  /**
   * Phase 7: model family that executed the task, when known. Optional — the
   * runtime does not yet thread the resolved model id onto the task outcome, so
   * the evaluator leaves this unset and the key omits it. Future wiring (e.g.
   * the llm-call service stamping `providerModel`) can populate it without a
   * schema change; until then learnings are model-agnostic (honest: not
   * over-claiming model-specificity we don't yet observe).
   */
  modelFamily?: string;
  /**
   * Phase 7: task risk level (WorkflowTask.riskLevel). Stamped by the evaluator
   * so learnings are dimensioned by risk tier — a HIGH-risk config's behaviour
   * should not govern a LOW-risk task of the same type.
   */
  riskLevel?: RiskLevel;
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
  /** Tasks that abstained (calibrated decline). Not failures — tracked separately
   *  so the learning extractor + UI never count honest abstention as failure. */
  taskAbstained?: number;
  taskOutcomes: TaskOutcome[];
  acceptanceResults: AcceptanceCriterionResult[];
  totalCostUsd: number;
  durationMs: number;
  finalAutonomy?: AutonomyDecision;
  /** Counterfactual replay hints for every failed task (Phase 4 consumes). */
  counterfactualHints: CounterfactualReplayHint[];
  summary: string;
}