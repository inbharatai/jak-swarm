/**
 * plan-validator.test.ts — HyperAgent Phase 4 symbolic validator (Innovation #3).
 *
 * The validator is the constraint layer that decides whether ANY proposed
 * revised plan (deterministic or LLM) may be applied. These tests pin every
 * rejection code + the happy path, so no cyclic / invalid / unsafe plan can
 * ever slip through silently.
 */
import { describe, it, expect } from 'vitest';
import { AgentRole, RiskLevel, TaskStatus } from '../../../packages/shared/src/index.js';
import type { WorkflowPlan, WorkflowTask } from '../../../packages/shared/src/index.js';
import { validateReplan, findCycleTask, type PlanValidationContext } from '../../../packages/swarm/src/hyperagent/plan-validator.js';

function task(over: Partial<WorkflowTask> & { id: string }): WorkflowTask {
  return {
    name: `task-${over.id}`,
    description: 'd',
    agentRole: AgentRole.WORKER_RESEARCH,
    toolsRequired: [],
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

function ctx(over: Partial<PlanValidationContext> = {}): PlanValidationContext {
  return {
    knownToolNames: new Set(['web_search', 'send_email', 'browser_navigate']),
    permittedTools: new Set(['web_search', 'send_email', 'browser_navigate']),
    permittedAgents: new Set([AgentRole.WORKER_RESEARCH, AgentRole.WORKER_BROWSER]),
    completedExternalTaskIds: new Set(),
    previousPlan: plan([]),
    maxTasks: 50,
    ...over,
  };
}

describe('plan-validator — happy path', () => {
  it('accepts a well-formed acyclic plan with permitted agents + tools', () => {
    const p = plan([
      task({ id: 'a', toolsRequired: ['web_search'] }),
      task({ id: 'b', dependsOn: ['a'], toolsRequired: ['browser_navigate'], agentRole: AgentRole.WORKER_BROWSER }),
    ]);
    const r = validateReplan(p, ctx({ previousPlan: p }));
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});

describe('plan-validator — structural rejections', () => {
  it('rejects an empty plan with EMPTY_PLAN', () => {
    const r = validateReplan(plan([]), ctx());
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('EMPTY_PLAN');
  });

  it('rejects a task missing id/name/agentRole with INVALID_TASK', () => {
    const bad = { ...task({ id: 'x' }), name: '' } as WorkflowTask;
    const r = validateReplan(plan([bad]), ctx());
    expect(r.issues.map((i) => i.code)).toContain('INVALID_TASK');
  });

  it('rejects plans exceeding the task-count ceiling with TASK_COUNT_OVER_LIMIT', () => {
    const many = Array.from({ length: 3 }, (_, i) => task({ id: `t${i}` }));
    const r = validateReplan(plan(many), ctx({ maxTasks: 2 }));
    expect(r.issues.map((i) => i.code)).toContain('TASK_COUNT_OVER_LIMIT');
  });
});

describe('plan-validator — DAG integrity', () => {
  it('detects a dependency cycle with CYCLE', () => {
    const cyclic = plan([
      task({ id: 'a', dependsOn: ['b'] }),
      task({ id: 'b', dependsOn: ['a'] }),
    ]);
    const r = validateReplan(cyclic, ctx({ previousPlan: cyclic }));
    expect(r.issues.map((i) => i.code)).toContain('CYCLE');
  });

  it('detects a self-loop as a cycle', () => {
    const self = plan([task({ id: 'a', dependsOn: ['a'] })]);
    expect(findCycleTask(self)).toBe('a');
  });

  it('rejects a dangling dependency with DANGLING_DEPENDENCY', () => {
    const r = validateReplan(plan([task({ id: 'a', dependsOn: ['nope'] })]), ctx());
    expect(r.issues.map((i) => i.code)).toContain('DANGLING_DEPENDENCY');
  });
});

describe('plan-validator — agent + tool permission', () => {
  it('rejects an unpermitted agent with AGENT_NOT_PERMITTED', () => {
    const r = validateReplan(
      plan([task({ id: 'a', agentRole: AgentRole.WORKER_CODER as unknown as AgentRole })]),
      ctx({ permittedAgents: new Set([AgentRole.WORKER_RESEARCH]) }),
    );
    expect(r.issues.map((i) => i.code)).toContain('AGENT_NOT_PERMITTED');
  });

  it('rejects an unknown tool with UNKNOWN_TOOL', () => {
    const r = validateReplan(plan([task({ id: 'a', toolsRequired: ['not_a_tool'] })]), ctx());
    expect(r.issues.map((i) => i.code)).toContain('UNKNOWN_TOOL');
  });

  it('rejects a known-but-disallowed tool with TOOL_NOT_PERMITTED', () => {
    const r = validateReplan(
      plan([task({ id: 'a', toolsRequired: ['send_email'] })]),
      ctx({ knownToolNames: new Set(['web_search', 'send_email']), permittedTools: new Set(['web_search']) }),
    );
    expect(r.issues.map((i) => i.code)).toContain('TOOL_NOT_PERMITTED');
  });

  it('skips TOOL_NOT_PERMITTED when no allowlist is configured (empty permittedTools)', () => {
    const r = validateReplan(
      plan([task({ id: 'a', toolsRequired: ['web_search'] })]),
      ctx({ knownToolNames: new Set(['web_search']), permittedTools: new Set() }),
    );
    expect(r.issues.map((i) => i.code)).not.toContain('TOOL_NOT_PERMITTED');
  });
});

describe('plan-validator — completed external actions never repeated', () => {
  it('rejects re-scheduling a completed external action with COMPLETED_EXTERNAL_REPEATED', () => {
    const r = validateReplan(
      plan([task({ id: 'ext', toolsRequired: ['send_email'], status: TaskStatus.PENDING })]),
      ctx({ completedExternalTaskIds: new Set(['ext']) }),
    );
    expect(r.issues.map((i) => i.code)).toContain('COMPLETED_EXTERNAL_REPEATED');
  });

  it('allows a completed external action to remain COMPLETED', () => {
    const r = validateReplan(
      plan([task({ id: 'ext', toolsRequired: ['send_email'], status: TaskStatus.COMPLETED })]),
      ctx({ completedExternalTaskIds: new Set(['ext']) }),
    );
    expect(r.issues.map((i) => i.code)).not.toContain('COMPLETED_EXTERNAL_REPEATED');
  });
});

describe('plan-validator — risk + approval regression', () => {
  it('rejects a silent risk decrease on an approval-required task with RISK_SILENTLY_DECREASED', () => {
    const prev = plan([task({ id: 'a', riskLevel: RiskLevel.HIGH, requiresApproval: true })]);
    const next = plan([task({ id: 'a', riskLevel: RiskLevel.LOW, requiresApproval: true })]);
    const r = validateReplan(next, ctx({ previousPlan: prev }));
    expect(r.issues.map((i) => i.code)).toContain('RISK_SILENTLY_DECREASED');
  });

  it('rejects stripping approval from a previously-approval-required task with DESTRUCTIVE_AUTO_APPROVED', () => {
    const prev = plan([task({ id: 'a', requiresApproval: true, riskLevel: RiskLevel.HIGH })]);
    const next = plan([task({ id: 'a', requiresApproval: false, riskLevel: RiskLevel.HIGH })]);
    const r = validateReplan(next, ctx({ previousPlan: prev }));
    expect(r.issues.map((i) => i.code)).toContain('DESTRUCTIVE_AUTO_APPROVED');
  });

  it('does NOT flag a risk increase (only silent decreases are blocked)', () => {
    const prev = plan([task({ id: 'a', riskLevel: RiskLevel.LOW, requiresApproval: true })]);
    const next = plan([task({ id: 'a', riskLevel: RiskLevel.HIGH, requiresApproval: true })]);
    const r = validateReplan(next, ctx({ previousPlan: prev }));
    expect(r.issues.map((i) => i.code)).not.toContain('RISK_SILENTLY_DECREASED');
  });
});