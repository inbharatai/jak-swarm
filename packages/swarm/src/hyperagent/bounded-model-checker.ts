/**
 * bounded-model-checker.ts — Innovation #7 (HyperAgent Phase 7): formal verification.
 *
 * A bounded model checker for the plan DAG. It unrolls the task dependency
 * graph to a bounded depth (topological execution) and checks safety invariants
 * at every step, returning a concrete counterexample trace when an invariant
 * is violated. This is the formal-verification gate a self-modification must
 * pass BEFORE promotion — "the LLM said the plan is safe" is never enough; the
 * plan must be PROVEN safe up to the bound.
 *
 * Invariants checked at each execution step:
 *   ACYCLIC           — the DAG has no cycle (topo sort completes).
 *   DEPENDENCY_ORDER  — a task runs only after every dependency completed.
 *   TOOL_PERMITTED    — every tool a task uses is in the permitted set.
 *   RISK_BOUNDED      — cumulative risk rank never exceeds the budget.
 *   APPROVAL_GATED    — high-risk tasks carry requiresApproval (no un-gated auto-run).
 *
 * Pure + deterministic — no I/O, no LLM. Bound is caller-supplied so the check
 * is decidable and replayable.
 */
import { RiskLevel } from '@jak-swarm/shared';
import type { WorkflowPlan } from '@jak-swarm/shared';

/** Risk rank ordering (LOW < MEDIUM < HIGH < CRITICAL). */
const RISK_RANK: Readonly<Record<RiskLevel, number>> = Object.freeze({
  [RiskLevel.LOW]: 0,
  [RiskLevel.MEDIUM]: 1,
  [RiskLevel.HIGH]: 2,
  [RiskLevel.CRITICAL]: 3,
});

export enum ModelCheckInvariant {
  ACYCLIC = 'ACYCLIC',
  DEPENDENCY_ORDER = 'DEPENDENCY_ORDER',
  TOOL_PERMITTED = 'TOOL_PERMITTED',
  RISK_BOUNDED = 'RISK_BOUNDED',
  APPROVAL_GATED = 'APPROVAL_GATED',
}

export interface ModelCheckInput {
  plan: WorkflowPlan;
  /** Tools the run is allowed to use; any task using a tool outside this set violates TOOL_PERMITTED. */
  permittedTools: ReadonlySet<string>;
  /** Cumulative risk-rank budget across the unroll. */
  riskBudget: number;
  /** Tasks at/above this rank MUST set requiresApproval (else APPROVAL_GATED violation). */
  approvalRequiredAboveRank: number;
  /** Bounded unroll depth — a safety ceiling on the model-check trace length. */
  bound: number;
}

export interface ModelCheckViolation {
  step: number;
  taskId: string;
  invariant: ModelCheckInvariant;
  detail: string;
}

export interface ModelCheckResult {
  safe: boolean;
  violations: ModelCheckViolation[];
  /** The execution trace the checker unrolled (task ids in run order). */
  trace: string[];
  /** The first violation, when unsafe — the counterexample. */
  counterexample?: ModelCheckViolation;
}

/**
 * Run the bounded model check. Pure + deterministic.
 * Returns `{ safe: true, violations: [], trace }` when every invariant holds up
 * to `bound`; otherwise the first violation is surfaced as the counterexample.
 */
export function checkPlan(input: ModelCheckInput): ModelCheckResult {
  const violations: ModelCheckViolation[] = [];
  const trace: string[] = [];
  const tasks = input.plan.tasks;
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // ACYCLIC: Kahn's topological sort. If it stalls with tasks remaining, the
  // residual tasks lie on a cycle.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    indegree.set(t.id, 0);
    dependents.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!byId.has(dep)) {
        violations.push({
          step: 0,
          taskId: t.id,
          invariant: ModelCheckInvariant.DEPENDENCY_ORDER,
          detail: `task ${t.id} depends on unknown task ${dep}`,
        });
        continue;
      }
      dependents.get(dep)!.push(t.id);
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
    }
  }

  const ready = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  const completed = new Set<string>();
  let cumulativeRisk = 0;
  let step = 0;

  while (ready.length > 0 && step < input.bound) {
    const id = ready.shift()!;
    const task = byId.get(id)!;
    trace.push(id);

    // DEPENDENCY_ORDER (by topo construction deps are done; double-check).
    for (const dep of task.dependsOn) {
      if (byId.has(dep) && !completed.has(dep)) {
        violations.push({
          step,
          taskId: id,
          invariant: ModelCheckInvariant.DEPENDENCY_ORDER,
          detail: `task ${id} ran before its dependency ${dep} completed`,
        });
      }
    }

    // TOOL_PERMITTED
    for (const tool of task.toolsRequired) {
      if (!input.permittedTools.has(tool)) {
        violations.push({
          step,
          taskId: id,
          invariant: ModelCheckInvariant.TOOL_PERMITTED,
          detail: `task ${id} uses unpermitted tool ${tool}`,
        });
      }
    }

    // APPROVAL_GATED
    const rank = RISK_RANK[task.riskLevel] ?? 0;
    if (rank >= input.approvalRequiredAboveRank && !task.requiresApproval) {
      violations.push({
        step,
        taskId: id,
        invariant: ModelCheckInvariant.APPROVAL_GATED,
        detail: `task ${id} risk ${task.riskLevel} (rank ${rank}) requires approval but is not gated`,
      });
    }

    // RISK_BOUNDED
    cumulativeRisk += rank;
    if (cumulativeRisk > input.riskBudget) {
      violations.push({
        step,
        taskId: id,
        invariant: ModelCheckInvariant.RISK_BOUNDED,
        detail: `cumulative risk rank ${cumulativeRisk} exceeds budget ${input.riskBudget} after task ${id}`,
      });
    }

    completed.add(id);
    for (const dep of dependents.get(id) ?? []) {
      indegree.set(dep, (indegree.get(dep) ?? 1) - 1);
      if ((indegree.get(dep) ?? 0) === 0) ready.push(dep);
    }
    step += 1;
  }

  // ACYCLIC: if tasks remain unprocessed, they are on a cycle (or unreachable via dangling deps).
  const residual = tasks.filter((t) => !completed.has(t.id));
  for (const t of residual) {
    violations.push({
      step,
      taskId: t.id,
      invariant: ModelCheckInvariant.ACYCLIC,
      detail: `task ${t.id} could not be scheduled (cycle or unreachable dependency)`,
    });
  }

  const counterexample = violations[0];
  return { safe: violations.length === 0, violations, trace, counterexample };
}