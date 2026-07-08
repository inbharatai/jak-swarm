/**
 * spec-executor.test.ts — HyperAgent Phase 6 approved-spec closed loop (PURE).
 *
 * Pins the spec §13 Phase 6 invariants:
 *   - only an APPROVED spec materialises a plan; draft/rejected ⇒ SpecNotApprovedError;
 *   - a malformed agentTaskPlan (no tasks / duplicate ids / dangling dependsOn)
 *     ⇒ SpecPlanValidationError — a bad spec never reaches the runner;
 *   - materialised tasks start PENDING with the spec's role/tools/risk/deps;
 *   - the plan is deterministic: same spec ⇒ same plan;
 *   - acceptanceCriteriaForSpec returns the criteria + artifact allowlist for an
 *     approved spec and refuses a non-approved one.
 */
import { describe, it, expect } from 'vitest';
import { AgentRole, RiskLevel, TaskStatus } from '../../../packages/shared/src/index.js';
import type { AgentExecutableSpec, SpecTaskDescriptor } from '../../../packages/shared/src/index.js';
import {
  materializePlan,
  acceptanceCriteriaForSpec,
  SpecNotApprovedError,
  SpecPlanValidationError,
} from '../../../packages/swarm/src/hyperagent/spec-executor.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function desc(over: Partial<SpecTaskDescriptor> & { id: string }): SpecTaskDescriptor {
  return {
    id: over.id,
    name: `task-${over.id}`,
    description: 'd',
    agentRole: AgentRole.WORKER_RESEARCH,
    toolsRequired: ['web_search'],
    riskLevel: RiskLevel.LOW,
    dependsOn: [],
    requiresApproval: false,
    retryable: true,
    maxRetries: 2,
    ...over,
  } as SpecTaskDescriptor;
}

function spec(over: Partial<AgentExecutableSpec> & { tasks: SpecTaskDescriptor[] }): AgentExecutableSpec {
  const { tasks, ...rest } = over;
  return {
    id: 'spec-1',
    tenantId: 't1',
    title: 'Ship feature X',
    problemStatement: 'p',
    objective: 'o',
    contextSummary: 'c',
    proposedApproach: 'a',
    acceptanceCriteria: [],
    testPlan: {},
    agentTaskPlan: { tasks },
    approvalGates: {},
    evidenceArtifactIds: ['art-1'],
    evidenceEntityIds: [],
    status: 'approved',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
    approvedBy: 'rev',
    ...rest,
  } as AgentExecutableSpec;
}

describe('materializePlan — approval guard', () => {
  it('materialises an approved spec into a PENDING WorkflowPlan', () => {
    const p = materializePlan({ spec: spec({ tasks: [desc({ id: 'a' }), desc({ id: 'b', dependsOn: ['a'] })] }), now: NOW });
    expect(p.id).toBe('plan:spec-1');
    expect(p.name).toBe('Ship feature X');
    expect(p.goal).toBe('o');
    expect(p.tasks).toHaveLength(2);
    expect(p.tasks.every((t) => t.status === TaskStatus.PENDING)).toBe(true);
    expect(p.tasks[1].dependsOn).toEqual(['a']);
    expect(p.createdAt).toBe(NOW);
  });

  it('throws SpecNotApprovedError for a draft spec', () => {
    expect(() =>
      materializePlan({ spec: spec({ tasks: [desc({ id: 'a' })], status: 'draft' }), now: NOW }),
    ).toThrow(SpecNotApprovedError);
  });

  it('throws SpecNotApprovedError for a rejected spec', () => {
    expect(() =>
      materializePlan({ spec: spec({ tasks: [desc({ id: 'a' })], status: 'rejected' }), now: NOW }),
    ).toThrow(SpecNotApprovedError);
  });

  it('honours a caller-supplied planId', () => {
    const p = materializePlan({ spec: spec({ tasks: [desc({ id: 'a' })] }), now: NOW, planId: 'custom-plan' });
    expect(p.id).toBe('custom-plan');
  });
});

describe('materializePlan — validation guard', () => {
  it('throws SpecPlanValidationError when the plan has no tasks', () => {
    expect(() => materializePlan({ spec: spec({ tasks: [] as SpecTaskDescriptor[] }), now: NOW })).toThrow(
      SpecPlanValidationError,
    );
  });

  it('throws SpecPlanValidationError on duplicate task ids', () => {
    expect(() =>
      materializePlan({ spec: spec({ tasks: [desc({ id: 'a' }), desc({ id: 'a' })] }), now: NOW }),
    ).toThrow(SpecPlanValidationError);
  });

  it('throws SpecPlanValidationError on a dangling dependsOn edge', () => {
    expect(() =>
      materializePlan({ spec: spec({ tasks: [desc({ id: 'a', dependsOn: ['nope'] })] }), now: NOW }),
    ).toThrow(SpecPlanValidationError);
  });

  it('throws SpecPlanValidationError on an empty task id', () => {
    expect(() =>
      materializePlan({ spec: spec({ tasks: [desc({ id: '' })] }), now: NOW }),
    ).toThrow(SpecPlanValidationError);
  });
});

describe('materializePlan — determinism', () => {
  it('same spec + now ⇒ deeply equal plans', () => {
    const s = spec({ tasks: [desc({ id: 'a' }), desc({ id: 'b', dependsOn: ['a'] })] });
    const a = materializePlan({ spec: s, now: NOW });
    const b = materializePlan({ spec: s, now: NOW });
    expect(a).toEqual(b);
  });

  it('applies spec descriptor overrides (risk, requiresApproval, maxRetries)', () => {
    const p = materializePlan({
      spec: spec({
        tasks: [desc({ id: 'a', riskLevel: RiskLevel.HIGH, requiresApproval: true, maxRetries: 5, retryable: false })],
      }),
      now: NOW,
    });
    expect(p.tasks[0].riskLevel).toBe(RiskLevel.HIGH);
    expect(p.tasks[0].requiresApproval).toBe(true);
    expect(p.tasks[0].maxRetries).toBe(5);
    expect(p.tasks[0].retryable).toBe(false);
  });

  it('defaults risk to LOW and maxRetries to 2 when the descriptor omits them', () => {
    const p = materializePlan({
      spec: spec({
        tasks: [
          {
            id: 'a', name: 'n', description: 'd',
            agentRole: AgentRole.WORKER_RESEARCH, toolsRequired: [],
          } as SpecTaskDescriptor,
        ],
      }),
      now: NOW,
    });
    expect(p.tasks[0].riskLevel).toBe(RiskLevel.LOW);
    expect(p.tasks[0].maxRetries).toBe(2);
  });
});

describe('acceptanceCriteriaForSpec', () => {
  it('returns the criteria + artifact allowlist for an approved spec', () => {
    const s = spec({
      tasks: [desc({ id: 'a' })],
      acceptanceCriteria: [
        { id: 'c1', description: 'task a done', kind: 'TASK_COMPLETED' as never, taskId: 'a' },
      ],
    });
    const out = acceptanceCriteriaForSpec(s);
    expect(out.criteria).toHaveLength(1);
    expect(out.allowedArtifactIds).toEqual(['art-1']);
  });

  it('refuses a non-approved spec', () => {
    expect(() =>
      acceptanceCriteriaForSpec(spec({ tasks: [desc({ id: 'a' })], status: 'draft' })),
    ).toThrow(SpecNotApprovedError);
  });
});