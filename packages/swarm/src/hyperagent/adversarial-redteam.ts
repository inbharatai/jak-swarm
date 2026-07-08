/**
 * adversarial-redteam.ts — Innovation #4 (HyperAgent Phase 7): adversarial self-red-team.
 *
 * Before a self-modification (a revised plan, a promoted learning, an approved
 * spec) is applied, an adversary tries to BREAK it. This pure core is the
 * deterministic adversary: it applies a fixed repertoire of attack strategies
 * to the proposed plan and checks whether the symbolic validator
 * (plan-validator.ts) CATCHES each mutation. A BREAKTHROUGH is a mutation that
 * the validator let pass (valid=true) but is independently unsafe — a gap in
 * the validator + plan combination that a real adversary would exploit.
 *
 * A self-modification may promote ONLY when the red-team reports zero
 * breakthroughs (`survived === true`). "The plan looks fine" is never enough;
 * the plan must SURVIVE an active attempt to break it.
 *
 * Pure + deterministic — no I/O, no LLM. An LLM red-team wrapper may PROPOSE
 * additional creative attacks; this deterministic core is the gating arbiter.
 */
import { RiskLevel } from '@jak-swarm/shared';
import type { WorkflowPlan, WorkflowTask } from '@jak-swarm/shared';
import { findCycleTask, validateReplan } from './plan-validator.js';
import type { PlanValidationContext } from './plan-validator.js';

const RISK_RANK: Readonly<Record<RiskLevel, number>> = Object.freeze({
  [RiskLevel.LOW]: 0,
  [RiskLevel.MEDIUM]: 1,
  [RiskLevel.HIGH]: 2,
  [RiskLevel.CRITICAL]: 3,
});

/** The repertoire of attack strategies the adversary applies. */
export enum RedTeamStrategy {
  REMOVE_DEPENDENCY = 'REMOVE_DEPENDENCY',
  SWAP_TO_UNKNOWN_TOOL = 'SWAP_TO_UNKNOWN_TOOL',
  INFLATE_RISK_TO_CRITICAL = 'INFLATE_RISK_TO_CRITICAL',
  INTRODUCE_CYCLE = 'INTRODUCE_CYCLE',
  DROP_APPROVAL_FLAG = 'DROP_APPROVAL_FLAG',
  DUPLICATE_TASK_ID = 'DUPLICATE_TASK_ID',
  EMPTY_TOOLSET = 'EMPTY_TOOLSET',
}

export interface RedTeamAttack {
  strategy: RedTeamStrategy;
  /** True when the attack was applicable to this plan (some attacks need ≥2 tasks / a dep). */
  applicable: boolean;
  /** Did the mutated plan PASS the symbolic validator? */
  mutatedPlanValid: boolean;
  /** True when the validator passed a mutation that is independently unsafe — a gap. */
  breakthrough: boolean;
  detail: string;
}

export interface RedTeamReport {
  attacks: RedTeamAttack[];
  /** Attacks the validator caught (mutatedPlanValid=false). */
  caught: number;
  /** Attacks the validator let through that were independently unsafe. */
  breakthroughs: number;
  /** True when zero breakthroughs — the plan survived the red-team. */
  survived: boolean;
}

/** Clone a plan with a task list override (pure). */
function withTasks(plan: WorkflowPlan, tasks: WorkflowTask[]): WorkflowPlan {
  return { ...plan, tasks, updatedAt: plan.updatedAt };
}

/** Find the previous version of a task by id (for risk/approval regression). */
function prevTask(ctx: PlanValidationContext, id: string): WorkflowTask | undefined {
  return ctx.previousPlan.tasks.find((t) => t.id === id);
}

/** Apply a mutation strategy; returns null when the attack is not applicable. */
function mutate(plan: WorkflowPlan, strategy: RedTeamStrategy): WorkflowPlan | null {
  const tasks: WorkflowTask[] = plan.tasks.map((t) => ({ ...t, toolsRequired: [...t.toolsRequired], dependsOn: [...t.dependsOn] }));
  switch (strategy) {
    case RedTeamStrategy.REMOVE_DEPENDENCY: {
      const idx = tasks.findIndex((t) => t.dependsOn.length > 0);
      if (idx < 0) return null;
      const t = tasks[idx]!;
      tasks[idx] = { ...t, dependsOn: t.dependsOn.slice(1) };
      return withTasks(plan, tasks);
    }
    case RedTeamStrategy.SWAP_TO_UNKNOWN_TOOL: {
      const idx = tasks.findIndex((t) => t.toolsRequired.length > 0);
      if (idx < 0) return null;
      const t = tasks[idx]!;
      const tools = [...t.toolsRequired];
      tools[0] = '__redteam_unknown_tool__';
      tasks[idx] = { ...t, toolsRequired: tools };
      return withTasks(plan, tasks);
    }
    case RedTeamStrategy.INFLATE_RISK_TO_CRITICAL: {
      const idx = tasks.findIndex((t) => t.riskLevel !== RiskLevel.CRITICAL);
      if (idx < 0) return null;
      const t = tasks[idx]!;
      tasks[idx] = { ...t, riskLevel: RiskLevel.CRITICAL };
      return withTasks(plan, tasks);
    }
    case RedTeamStrategy.INTRODUCE_CYCLE: {
      // Need a task with a dependency to reverse into a cycle.
      const idx = tasks.findIndex((t) => t.dependsOn.length > 0);
      if (idx < 0) return null;
      const t = tasks[idx]!;
      const depId = t.dependsOn[0];
      const depIdx = tasks.findIndex((x) => x.id === depId);
      if (depIdx < 0) return null;
      const dep = tasks[depIdx]!;
      tasks[depIdx] = { ...dep, dependsOn: [...dep.dependsOn, t.id] };
      return withTasks(plan, tasks);
    }
    case RedTeamStrategy.DROP_APPROVAL_FLAG: {
      const idx = tasks.findIndex((t) => t.requiresApproval);
      if (idx < 0) return null;
      const t = tasks[idx]!;
      tasks[idx] = { ...t, requiresApproval: false };
      return withTasks(plan, tasks);
    }
    case RedTeamStrategy.DUPLICATE_TASK_ID: {
      const first = tasks[0];
      if (!first) return null;
      return withTasks(plan, [...tasks, { ...first }]);
    }
    case RedTeamStrategy.EMPTY_TOOLSET: {
      const idx = tasks.findIndex((t) => t.toolsRequired.length > 0);
      if (idx < 0) return null;
      const t = tasks[idx]!;
      tasks[idx] = { ...t, toolsRequired: [] as string[] };
      return withTasks(plan, tasks);
    }
    default:
      return null;
  }
}

/**
 * Default independent safety oracle: flags the genuine GAPS the symbolic
 * validator does NOT cover — a cyclic plan the validator missed, or a SILENT
 * RISK INCREASE (the validator only flags risk *decreases*, so inflating a
 * task's risk beyond the approved envelope passes it). Returns a description
 * when the mutated plan is independently unsafe, else null. Pure.
 *
 * The governance gate overrides this with the bounded model checker
 * (innovation #7) as a stronger oracle; callers may inject their own.
 */
export function defaultSafetyOracle(mutated: WorkflowPlan, ctx: PlanValidationContext): string | null {
  const cyc = findCycleTask(mutated);
  if (cyc) return `cyclic plan (cycle at task ${cyc}) the validator did not flag`;
  const offender = mutated.tasks.find((t) => {
    const prev = prevTask(ctx, t.id);
    return prev && RISK_RANK[t.riskLevel] > RISK_RANK[prev.riskLevel];
  });
  if (offender) return `silent risk increase on task ${offender.id} the validator did not flag`;
  return null;
}

export interface RedTeamInput {
  plan: WorkflowPlan;
  ctx: PlanValidationContext;
  /** Strategies to apply (defaults to the full repertoire). */
  strategies?: RedTeamStrategy[];
  /**
   * Independent safety oracle. Returns a description when the mutated plan is
   * unsafe (a BREAKTHROUGH when the validator also passed it), else null.
   * Defaults to `defaultSafetyOracle`; the governance gate injects the bounded
   * model checker as a stronger oracle.
   */
  isUnsafe?: (mutated: WorkflowPlan) => string | null;
}

/**
 * Run the adversarial red-team against a proposed plan. Pure + deterministic.
 * Returns a report; the plan survived iff `breakthroughs === 0` — no mutation
 * the validator let through was independently unsafe.
 */
export function redTeamPlan(input: RedTeamInput): RedTeamReport {
  const strategies = input.strategies ?? Object.values(RedTeamStrategy);
  const oracle = input.isUnsafe ?? ((mutated) => defaultSafetyOracle(mutated, input.ctx));
  const attacks: RedTeamAttack[] = strategies.map((strategy) => {
    const mutated = mutate(input.plan, strategy);
    if (!mutated) {
      return { strategy, applicable: false, mutatedPlanValid: false, breakthrough: false, detail: 'attack not applicable to this plan' };
    }
    const validation = validateReplan(mutated, input.ctx);
    const unsafe = oracle(mutated);
    const breakthrough = validation.valid && unsafe !== null;
    return {
      strategy,
      applicable: true,
      mutatedPlanValid: validation.valid,
      breakthrough,
      detail: breakthrough ? unsafe! : validation.valid ? 'mutation passed validation and was independently safe' : `validator caught the mutation (${validation.issues.length} issue(s))`,
    };
  });

  const caught = attacks.filter((a) => a.applicable && !a.mutatedPlanValid).length;
  const breakthroughs = attacks.filter((a) => a.breakthrough).length;
  return { attacks, caught, breakthroughs, survived: breakthroughs === 0 };
}

/** Convenience: did the plan survive the full red-team? */
export function survivesRedTeam(input: RedTeamInput): boolean {
  return redTeamPlan(input).survived;
}