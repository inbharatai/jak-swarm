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
import type {
  AgentExecutableSpec,
  SpecTaskDescriptor,
  WorkflowPlan,
  WorkflowTask,
} from '@jak-swarm/shared';
import { findCycleTask } from './plan-validator.js';

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