/**
 * governance-gate.test.ts — HyperAgent Phase 7 bounded self-modification gate.
 *
 * Pins the composed governance verdict:
 *   - APPROVED when the red-team survives (model-checker oracle) AND the bounded
 *     model checker is safe AND the privacy budget is not exhausted;
 *   - REJECTED with a "model checker" reason when the base plan is unsafe;
 *   - REJECTED with a "red-team" reason when a mutation the validator let
 *     through fails the model checker (breakthrough) even though the base plan
 *     is safe;
 *   - REJECTED with a "privacy budget" reason when DP releases exceed the
 *     tenant budget;
 *   - a counterfactual explanation is ALWAYS attached for audit, regardless of
 *     the verdict.
 */
import { describe, it, expect } from 'vitest';
import { AgentRole, RiskLevel, TaskStatus } from '../../../packages/shared/src/index.js';
import type { WorkflowPlan, WorkflowTask } from '../../../packages/shared/src/index.js';
import type { PlanValidationContext } from '../../../packages/swarm/src/hyperagent/plan-validator.js';
import type { CounterfactualPerturbation } from '../../../packages/swarm/src/hyperagent/counterfactual-explainer.js';
import { governSelfModification } from '../../../packages/swarm/src/hyperagent/governance-gate.js';

function task(over: Partial<WorkflowTask> & { id: string }): WorkflowTask {
  return {
    name: `task-${over.id}`,
    description: 'd',
    agentRole: AgentRole.WORKER_RESEARCH,
    toolsRequired: ['web_search'],
    riskLevel: RiskLevel.LOW,
    requiresApproval: false,
    status: TaskStatus.PENDING,
    dependsOn: [],
    retryable: true,
    maxRetries: 2,
    ...over,
  } as WorkflowTask;
}

function plan(tasks: WorkflowTask[]): WorkflowPlan {
  return {
    id: 'plan-1', name: 'p', goal: 'g', industry: 'general', tasks,
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function ctx(previousPlan: WorkflowPlan): PlanValidationContext {
  return {
    knownToolNames: new Set(['web_search']),
    permittedTools: new Set(['web_search']),
    permittedAgents: new Set([AgentRole.WORKER_RESEARCH]),
    completedExternalTaskIds: new Set(),
    previousPlan,
    maxTasks: 20,
  };
}

interface GateFactors { a: number; samples: number; mi: number; threshold: number; }
const decide = (f: GateFactors): boolean => f.mi >= f.threshold && f.samples >= 5 && f.a >= 1;
const perturbations: CounterfactualPerturbation<GateFactors>[] = [
  { name: 'one-fewer-present-success', apply: (f) => ({ ...f, a: f.a - 1 }), describe: (f) => `had there been ${f.a - 1} present-successes` },
];

function govern(planArg: WorkflowPlan, over: Partial<Parameters<typeof governSelfModification>[0]> = {}) {
  return governSelfModification<GateFactors>({
    redTeam: { plan: planArg, ctx: ctx(planArg) },
    modelCheck: {
      plan: planArg,
      permittedTools: new Set(['web_search']),
      riskBudget: 10,
      approvalRequiredAboveRank: 2,
      bound: 20,
    },
    counterfactual: {
      factors: { a: 1, samples: 6, mi: 0.2, threshold: 0.05 },
      decide,
      perturbations,
    },
    ...over,
  });
}

describe('governSelfModification — APPROVED', () => {
  it('approves a plan that survives red-team, passes the model checker, and stays in budget', () => {
    // Both tasks LOW + gated ⇒ inflating keeps approval, so no red-team breakthrough.
    const p = plan([task({ id: 'a', requiresApproval: true }), task({ id: 'b', dependsOn: ['a'], requiresApproval: true })]);
    const v = govern(p);
    expect(v.approved).toBe(true);
    expect(v.reasons).toHaveLength(0);
    expect(v.redTeam.survived).toBe(true);
    expect(v.modelCheck.safe).toBe(true);
    // Counterfactual always attached.
    expect(v.counterfactual).toBeDefined();
    expect(v.counterfactual.decision).toBe(true);
  });
});

describe('governSelfModification — REJECTED by model checker', () => {
  it('rejects with a model-checker reason when the base plan is unsafe', () => {
    // HIGH-risk task without approval ⇒ APPROVAL_GATED violation in the base plan.
    const p = plan([task({ id: 'a', riskLevel: RiskLevel.HIGH, requiresApproval: false })]);
    const v = govern(p);
    expect(v.approved).toBe(false);
    expect(v.reasons.some((r) => r.includes('model checker'))).toBe(true);
    expect(v.modelCheck.safe).toBe(false);
  });
});

describe('governSelfModification — REJECTED by red-team breakthrough', () => {
  it('rejects with a red-team reason when a mutation breaks the model checker despite a safe base', () => {
    // LOW un-gated task ⇒ base plan safe (LOW < approval rank), but INFLATE_RISK
    // mutates it to CRITICAL un-gated ⇒ validator lets the risk increase through
    // ⇒ model checker flags APPROVAL_GATED ⇒ breakthrough.
    const p = plan([task({ id: 'a', riskLevel: RiskLevel.LOW, requiresApproval: false })]);
    const v = govern(p);
    expect(v.approved).toBe(false);
    expect(v.modelCheck.safe).toBe(true);
    expect(v.redTeam.survived).toBe(false);
    expect(v.reasons.some((r) => r.includes('red-team'))).toBe(true);
  });
});

describe('governSelfModification — REJECTED by privacy budget', () => {
  it('rejects when DP releases would exhaust the tenant privacy budget', () => {
    const p = plan([task({ id: 'a', requiresApproval: true }), task({ id: 'b', dependsOn: ['a'], requiresApproval: true })]);
    const v = govern(p, {
      privacyBudget: { epsilonPerRelease: 1, releases: 10, tenantBudget: 2 },
    });
    expect(v.approved).toBe(false);
    expect(v.reasons.some((r) => r.includes('privacy budget'))).toBe(true);
    expect(v.remainingPrivacyBudget).toBe(0);
  });

  it('approves when the privacy budget comfortably covers the releases', () => {
    const p = plan([task({ id: 'a', requiresApproval: true }), task({ id: 'b', dependsOn: ['a'], requiresApproval: true })]);
    const v = govern(p, {
      privacyBudget: { epsilonPerRelease: 0.1, releases: 3, tenantBudget: 1 },
    });
    expect(v.approved).toBe(true);
    expect(v.remainingPrivacyBudget).toBeCloseTo(0.7, 10);
  });
});