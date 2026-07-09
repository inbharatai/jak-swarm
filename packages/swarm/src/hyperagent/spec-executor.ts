/**
 * spec-executor.ts — HyperAgent Phase 6 approved-spec closed loop (PURE core).
 *
 * Spec §13 Phase 6: wire an APPROVED AgentExecutableSpec → execute → measure.
 * This module is the deterministic half of "execute": it materialises the
 * spec's `agentTaskPlan` into a runnable `WorkflowPlan` (every task PENDING,
 * ready for the swarm to pick up) and exposes the structured acceptance
 * criteria the run will be measured against. Actual task execution is the
 * swarm's job (and stays non-regressed); this pure seam just prepares the
 * closed loop's inputs deterministically.
 *
 * Guardrails (spec constraints):
 *   - only an APPROVED spec may be materialised — a draft/rejected spec throws
 *     SpecNotApprovedError (never silently run an unapproved spec);
 *   - a spec whose agentTaskPlan is malformed (no tasks / duplicate ids) throws
 *     SpecPlanValidationError (a bad spec must never reach the runner);
 *   - the materialised plan is deterministic: same spec ⇒ same plan (caller
 *     stamps createdAt/updatedAt).
 *
 * Pure + deterministic — no I/O, no LLM, no Date.now.
 */
import { RiskLevel, TaskStatus } from '@jak-swarm/shared';
import { AcceptanceVerdict } from '@jak-swarm/shared';
import type {
  AcceptanceCriterionResult,
  AgentExecutableSpec,
  FailureClass,
  OutcomeEvaluation,
  RunEvidence,
  SpecTaskDescriptor,
  WorkflowPlan,
  WorkflowTask,
} from '@jak-swarm/shared';
import type { VerificationResult } from '@jak-swarm/agents';
import { findCycleTask } from './plan-validator.js';
import { evaluateOutcome } from './outcome-evaluator.js';
import { acceptanceVerdict } from './acceptance-checker.js';

/** Thrown when a non-approved spec is materialised. */
export class SpecNotApprovedError extends Error {
  constructor(specId: string, status: string) {
    super(`AgentExecutableSpec ${specId} is not approved (status=${status}); refusing to materialise plan`);
    this.name = 'SpecNotApprovedError';
  }
}

/** Thrown when an approved spec's agentTaskPlan is malformed. */
export class SpecPlanValidationError extends Error {
  constructor(specId: string, reason: string) {
    super(`AgentExecutableSpec ${specId} has an invalid agentTaskPlan: ${reason}`);
    this.name = 'SpecPlanValidationError';
  }
}

/** Default per-task retry budget when the spec descriptor omits it. */
const DEFAULT_MAX_RETRIES = 2;

/** Convert a spec task descriptor into a runnable WorkflowTask (PENDING). */
function toWorkflowTask(desc: SpecTaskDescriptor): WorkflowTask {
  return {
    id: desc.id,
    name: desc.name,
    description: desc.description,
    agentRole: desc.agentRole,
    toolsRequired: desc.toolsRequired,
    riskLevel: desc.riskLevel ?? RiskLevel.LOW,
    requiresApproval: desc.requiresApproval ?? false,
    status: TaskStatus.PENDING,
    dependsOn: desc.dependsOn ?? [],
    retryable: desc.retryable ?? true,
    maxRetries: desc.maxRetries ?? DEFAULT_MAX_RETRIES,
  };
}

/** Validate an approved spec's plan shape. Throws on malformed input. */
function validatePlan(spec: AgentExecutableSpec): void {
  const tasks = spec.agentTaskPlan?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new SpecPlanValidationError(spec.id, 'agentTaskPlan.tasks must be a non-empty array');
  }
  const ids = new Set<string>();
  for (const t of tasks) {
    if (!t || typeof t.id !== 'string' || t.id.length === 0) {
      throw new SpecPlanValidationError(spec.id, 'every task must have a non-empty string id');
    }
    if (ids.has(t.id)) {
      throw new SpecPlanValidationError(spec.id, `duplicate task id ${t.id}`);
    }
    ids.add(t.id);
  }
  // dependsOn must reference known task ids (no dangling edges).
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (!ids.has(dep)) {
        throw new SpecPlanValidationError(spec.id, `task ${t.id} depends on unknown task ${dep}`);
      }
    }
  }
  // The dependency DAG must be acyclic. A cyclic plan can never make progress
  // (deadlock) — every task waits on another in the cycle forever — so a spec
  // carrying one must never reach the runner. findCycleTask reads only id +
  // dependsOn, so the SpecTaskDescriptor[] shape is sufficient (cast through
  // unknown because the helper is typed for WorkflowPlan).
  const cycleTask = findCycleTask({ tasks } as unknown as WorkflowPlan);
  if (cycleTask) {
    throw new SpecPlanValidationError(spec.id, `dependency cycle detected at task ${cycleTask}`);
  }
}

export interface MaterializePlanInput {
  spec: AgentExecutableSpec;
  /** Caller-supplied plan id (default: `spec.id`). */
  planId?: string;
  /** Caller-supplied timestamps (no Date.now in the pure path). */
  now: Date | string;
}

/**
 * Materialise an APPROVED spec's agentTaskPlan into a runnable WorkflowPlan.
 * Every task starts PENDING. Pure + deterministic.
 *
 * Throws SpecNotApprovedError for non-approved specs, SpecPlanValidationError
 * for malformed plans — never silently runs a bad spec.
 */
export function materializePlan(input: MaterializePlanInput): WorkflowPlan {
  const { spec, now } = input;
  if (spec.status !== 'approved') {
    throw new SpecNotApprovedError(spec.id, spec.status);
  }
  validatePlan(spec);

  const stamp = now instanceof Date ? now : new Date(now);
  const tasks = spec.agentTaskPlan.tasks.map(toWorkflowTask);
  return {
    id: input.planId ?? `plan:${spec.id}`,
    name: spec.title,
    goal: spec.objective,
    industry: 'general',
    tasks,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * The acceptance criteria the closed loop will measure the run against, after
 * approval. Convenience wrapper that pairs the criteria with the spec's
 * evidence-artifact allowlist so the checker can validate harvested artifacts.
 */
export function acceptanceCriteriaForSpec(spec: AgentExecutableSpec) {
  if (spec.status !== 'approved') {
    throw new SpecNotApprovedError(spec.id, spec.status);
  }
  return {
    criteria: spec.acceptanceCriteria,
    allowedArtifactIds: spec.evidenceArtifactIds,
  };
}

// ─── Phase 6 closed-loop execution (service layer over the pure core) ─────────
//
// `executeApprovedSpec` is the orchestrator that binds the three pure halves
// into one closed loop:  materialise the approved spec → run the plan → harvest
// run evidence → measure acceptance → tri-state verdict. It is async only
// because `runPlan` is async (the swarm execution seam); the orchestration
// itself is deterministic given the finished run.
//
// HONEST SCOPE — what this does and does NOT claim:
//   - The closed-loop LOGIC (guard → materialise → run → harvest → measure →
//     verdict) is fully proven by the integration test with a stub `runPlan`
//     (deterministic MET / UNMET / UNVERIFIABLE + SpecNotApprovedError +
//     SpecPlanValidationError). The real harvester (`evaluateOutcome`) and the
//     real deterministic acceptance checker (`checkCriterion` via
//     `measureAcceptanceSeam`) are exercised — no faked satisfied criterion.
//   - The PRODUCTION `runPlan` (`runPlanViaLangGraph`) drives the real graph
//     (guardrail/worker/verifier/validator nodes) against the materialised
//     plan. It is env-blocked at every agent call (no provider keys here) —
//     wired-into-runtime, NOT production-proven. That is the same honesty
//     posture as every other live-graph HyperAgent seam.
//   - The spec `executed` + workflow-link persistence is an OPEN EDGE: the
//     Prisma `AgentExecutableSpec` has no `executedAt`/`executedWorkflowId`
//     column, so the loop RETURNS the verdict + workflowId without mutating
//     the spec row. Persisting the link is a separate (migration-gated) step.

/** Input to the run seam: everything the executor needs to drive the plan. */
export interface RunPlanInput {
  plan: WorkflowPlan;
  tenantId: string;
  userId: string;
  workflowId: string;
  /** The caller-supplied instant (no Date.now in the pure orchestration). */
  now: Date;
}

/** A finished run — the terminal state the harvester + measurer consume. */
export interface FinishedRun {
  /** The plan with terminal task statuses (COMPLETED/FAILED/SKIPPED/...). */
  plan: WorkflowPlan;
  /** Per-task verifier results (SwarmState.verificationResults). */
  verificationResults: Record<string, VerificationResult>;
  /** Task ids the run marked failed (SwarmState.failedTaskIds). */
  failedTaskIds?: string[];
  /** Task ids the run marked completed (SwarmState.completedTaskIds). */
  completedTaskIds?: string[];
  /** Run-level guardrail/policy block flag (SwarmState.blocked). */
  blocked?: boolean;
  /** Artifact ids the run produced/referenced (defaults to the spec's
   *  evidenceArtifactIds when the run harvests none). */
  artifacts: string[];
  /** Named numeric metrics the run reported (cost, latency, counts). */
  metrics: Record<string, number>;
  /** Accumulated spend, when available. */
  accumulatedCostUsd?: number;
  /** Pre-classified failure class per failed task, so NO_FAILURE_CLASS criteria
   *  bind to real classified failures (not a vacuous "no offenders" when the
   *  run simply didn't classify). Optional — the real graph does not yet wire
   *  failure classification into the harvested run (open edge). */
  failureClassByTask?: Record<string, FailureClass>;
  startedAt: Date;
  completedAt: Date;
}

/** Deps the closed loop needs. `runPlan` is the swarm execution seam. */
export interface ExecuteSpecDeps {
  runPlan: (input: RunPlanInput) => Promise<FinishedRun>;
}

export interface ExecuteSpecInput {
  spec: AgentExecutableSpec;
  tenantId: string;
  userId: string;
  /** Caller-supplied instant (the loop is deterministic given this + the run). */
  now: Date;
  deps: ExecuteSpecDeps;
  /** Optional override for the workflow id (default: `wf_spec_<specId>`). */
  workflowId?: string;
}

/** The closed-loop result returned to the caller (route / service). */
export interface ExecuteSpecResult {
  specId: string;
  workflowId: string;
  /** Tri-state acceptance verdict over the wired criteria. */
  verdict: AcceptanceVerdict;
  /** Per-criterion measurement (wired + satisfied, with evidence). */
  acceptanceResults: AcceptanceCriterionResult[];
  /** The full outcome evaluation (task triage + counterfactual hints + summary). */
  outcome: OutcomeEvaluation;
  /** The drift finding the spec was generated to resolve, and whether the run
   *  MET it (so the caller can mark the drift resolved — a separate open edge). */
  resolvedDrift: { driftFindingId: string | null; resolved: boolean };
}

/**
 * Execute an APPROVED spec's closed loop: materialise → run → harvest → measure
 * → verdict. Reuses the pure `materializePlan` (guard + plan), the pure
 * `evaluateOutcome` (harvests `taskOutcomes` from the finished plan + verification
 * AND measures acceptance via `measureAcceptanceSeam`), and the pure
 * `acceptanceVerdict` (reduces criterion results to MET / UNMET / UNVERIFIABLE).
 *
 * Throws `SpecNotApprovedError` for a non-approved spec (never silently runs an
 * unapproved spec) and `SpecPlanValidationError` for a malformed plan (the
 * guard runs in `materializePlan` before any execution). Non-fatal: a run that
 * finishes with no wired criteria surfaces `UNVERIFIABLE` (a human must sign off)
 * rather than the system pretending it passed.
 */
export async function executeApprovedSpec(input: ExecuteSpecInput): Promise<ExecuteSpecResult> {
  const { spec, tenantId, userId, now, deps } = input;

  // 1. Guard approved + validate plan (reuses the pure materializePlan guard —
  //    throws SpecNotApprovedError / SpecPlanValidationError before any run).
  const plan = materializePlan({ spec, now });

  // 2. Run the materialised plan via the swarm execution seam. The workflow id
  //    is deterministic from the spec id (no Date.now); a caller may override.
  const workflowId = input.workflowId ?? `wf_spec_${spec.id}`;
  const finished = await deps.runPlan({ plan, tenantId, userId, workflowId, now });

  // 3. Harvest run evidence + measure acceptance in one pass. evaluateOutcome
  //    triages taskOutcomes from finished.plan + verificationResults, then
  //    measureAcceptanceSeam binds the spec's structured criteria against the
  //    evidence (artifacts + metrics + the triaged taskOutcomes). Passing an
  //    empty taskOutcomes array lets the evaluator's own triage win — never fake
  //    an outcome the run did not produce.
  const acceptanceEvidence: RunEvidence = {
    taskOutcomes: [],
    artifacts: finished.artifacts,
    metrics: finished.metrics,
  };
  const outcome = evaluateOutcome({
    workflowId,
    tenantId,
    plan: finished.plan,
    verificationResults: finished.verificationResults,
    failedTaskIds: finished.failedTaskIds,
    completedTaskIds: finished.completedTaskIds,
    blocked: finished.blocked,
    accumulatedCostUsd: finished.accumulatedCostUsd,
    startedAt: finished.startedAt,
    completedAt: finished.completedAt,
    acceptanceCriteria: spec.acceptanceCriteria,
    acceptanceEvidence,
    failureClassByTask: finished.failureClassByTask,
  });

  // 4. Reduce the criterion results to a tri-state verdict.
  const verdict = acceptanceVerdict(outcome.acceptanceResults);

  return {
    specId: spec.id,
    workflowId,
    verdict,
    acceptanceResults: outcome.acceptanceResults,
    outcome,
    resolvedDrift: {
      driftFindingId: spec.driftFindingId ?? null,
      resolved: verdict === AcceptanceVerdict.MET,
    },
  };
}