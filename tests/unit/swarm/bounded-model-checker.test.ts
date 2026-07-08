/**
 * bounded-model-checker.test.ts — HyperAgent Phase 7 innovation #7 (formal verification).
 *
 * Pins the bounded model checker invariants:
 *   - a safe plan ⇒ safe=true with a topological trace and no violations;
 *   - ACYCLIC: a cyclic plan ⇒ counterexample;
 *   - TOOL_PERMITTED: an unpermitted tool ⇒ violation;
 *   - RISK_BOUNDED: cumulative risk over budget ⇒ violation;
 *   - APPROVAL_GATED: a high-risk un-gated task ⇒ violation;
 *   - DEPENDENCY_ORDER: a dangling dependency ⇒ violation;
 *   - the trace respects topological order (deps before dependents);
 *   - a bound of 0 ⇒ unsafe (the plan could not be unrolled within the bound).
 */
import { describe, it, expect } from 'vitest';
import { AgentRole, RiskLevel, TaskStatus } from '../../../packages/shared/src/index.js';
import type { WorkflowPlan, WorkflowTask } from '../../../packages/shared/src/index.js';
import {
  checkPlan,
  ModelCheckInvariant,
} from '../../../packages/swarm/src/hyperagent/bounded-model-checker.js';

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
    id: 'plan-1',
    name: 'p',
    goal: 'g',
    industry: 'general',
    tasks,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

const baseInput = (tasks: WorkflowTask[], over: Partial<Parameters<typeof checkPlan>[0]> = {}) => ({
  plan: plan(tasks),
  permittedTools: new Set(['web_search', 'email_send']),
  riskBudget: 10,
  approvalRequiredAboveRank: 2, // HIGH (2) and CRITICAL (3) require approval
  bound: 20,
  ...over,
});

describe('checkPlan — safe plan', () => {
  it('is safe with a topological trace and no violations', () => {
    const r = checkPlan(baseInput([task({ id: 'a' }), task({ id: 'b', dependsOn: ['a'] })]));
    expect(r.safe).toBe(true);
    expect(r.violations).toHaveLength(0);
    expect(r.trace).toEqual(['a', 'b']);
    expect(r.counterexample).toBeUndefined();
  });
});

describe('checkPlan — ACYCLIC', () => {
  it('flags a cyclic plan with a counterexample', () => {
    const r = checkPlan(baseInput([
      task({ id: 'a', dependsOn: ['b'] }),
      task({ id: 'b', dependsOn: ['a'] }),
    ]));
    expect(r.safe).toBe(false);
    const cyc = r.violations.find((v) => v.invariant === ModelCheckInvariant.ACYCLIC);
    expect(cyc).toBeDefined();
    expect(r.counterexample?.invariant).toBe(ModelCheckInvariant.ACYCLIC);
  });
});

describe('checkPlan — TOOL_PERMITTED', () => {
  it('flags a task using a tool outside the permitted set', () => {
    const r = checkPlan(baseInput([task({ id: 'a', toolsRequired: ['forbidden_tool'] })]));
    expect(r.safe).toBe(false);
    const v = r.violations.find((x) => x.invariant === ModelCheckInvariant.TOOL_PERMITTED);
    expect(v?.taskId).toBe('a');
  });
});

describe('checkPlan — RISK_BOUNDED', () => {
  it('flags cumulative risk exceeding the budget', () => {
    // Three CRITICAL tasks (rank 3 each) ⇒ cumulative 9; budget 8 ⇒ over.
    const r = checkPlan(baseInput([
      task({ id: 'a', riskLevel: RiskLevel.CRITICAL, requiresApproval: true }),
      task({ id: 'b', riskLevel: RiskLevel.CRITICAL, requiresApproval: true }),
      task({ id: 'c', riskLevel: RiskLevel.CRITICAL, requiresApproval: true }),
    ], { riskBudget: 8 }));
    expect(r.safe).toBe(false);
    expect(r.violations.some((x) => x.invariant === ModelCheckInvariant.RISK_BOUNDED)).toBe(true);
  });
});

describe('checkPlan — APPROVAL_GATED', () => {
  it('flags a high-risk task without requiresApproval', () => {
    const r = checkPlan(baseInput([task({ id: 'a', riskLevel: RiskLevel.HIGH, requiresApproval: false })]));
    expect(r.safe).toBe(false);
    const v = r.violations.find((x) => x.invariant === ModelCheckInvariant.APPROVAL_GATED);
    expect(v?.taskId).toBe('a');
  });

  it('does NOT flag a high-risk task that IS gated', () => {
    const r = checkPlan(baseInput([task({ id: 'a', riskLevel: RiskLevel.HIGH, requiresApproval: true })]));
    expect(r.violations.some((x) => x.invariant === ModelCheckInvariant.APPROVAL_GATED)).toBe(false);
  });
});

describe('checkPlan — DEPENDENCY_ORDER', () => {
  it('flags a dangling dependency on an unknown task', () => {
    const r = checkPlan(baseInput([task({ id: 'a', dependsOn: ['nope'] })]));
    expect(r.safe).toBe(false);
    expect(r.violations.some((x) => x.invariant === ModelCheckInvariant.DEPENDENCY_ORDER)).toBe(true);
  });
});

describe('checkPlan — trace ordering + bound', () => {
  it('runs dependencies before dependents in the trace', () => {
    const r = checkPlan(baseInput([
      task({ id: 'z', dependsOn: ['y'] }),
      task({ id: 'y', dependsOn: ['x'] }),
      task({ id: 'x' }),
    ]));
    expect(r.safe).toBe(true);
    expect(r.trace.indexOf('x')).toBeLessThan(r.trace.indexOf('y'));
    expect(r.trace.indexOf('y')).toBeLessThan(r.trace.indexOf('z'));
  });

  it('reports unsafe when the bound is too small to unroll the plan', () => {
    const r = checkPlan(baseInput([task({ id: 'a' }), task({ id: 'b', dependsOn: ['a'] })], { bound: 0 }));
    expect(r.safe).toBe(false);
    // Every task is residual ⇒ ACYCLIC-flagged for not being schedulable within the bound.
    expect(r.violations.some((x) => x.invariant === ModelCheckInvariant.ACYCLIC)).toBe(true);
  });
});