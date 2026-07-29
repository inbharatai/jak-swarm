/**
 * criteria-compiler.test.ts — unit tests for the structured-criteria compiler.
 *
 * The invariants under test are the accuracy guarantees:
 *   1. Resolvable prose → wired structured criteria (the MET path opens up).
 *   2. Unresolvable prose → stays CUSTOM/unbound with a reason (never faked).
 *   3. Validation rejects bad bindings (dangling tasks, bad failure classes,
 *      malformed metrics) even when an LLM proposes them.
 *   4. Pattern binding beats LLM proposals (a model cannot override rules).
 */
import { describe, expect, it } from 'vitest';
import { AcceptanceCriterionKind, AgentRole, FailureClass } from '@jak-swarm/shared';
import type { SpecTaskPlan } from '@jak-swarm/shared';
import {
  compileCriteria,
  compileSpecCriteria,
  resolveTaskId,
  validateProposal,
} from '../../../packages/swarm/src/hyperagent/criteria-compiler.js';

const PLAN: SpecTaskPlan = {
  tasks: [
    {
      id: 'task_research',
      name: 'Research churn drivers',
      description: 'Analyse support tickets and CRM notes for churn signals',
      agentRole: AgentRole.RESEARCHER,
      toolsRequired: ['web.search'],
    },
    {
      id: 'task_report',
      name: 'Write churn report',
      description: 'Produce the churn report artifact',
      agentRole: AgentRole.WRITER,
      toolsRequired: ['doc.generate'],
      dependsOn: ['task_research'],
    },
  ],
};

describe('resolveTaskId', () => {
  it('resolves an exact task id', () => {
    expect(resolveTaskId('task_report', PLAN)).toBe('task_report');
  });

  it('resolves an exact case-insensitive task name', () => {
    expect(resolveTaskId('research churn drivers', PLAN)).toBe('task_research');
  });

  it('resolves a unique substring of a task name', () => {
    expect(resolveTaskId('churn report', PLAN)).toBe('task_report');
  });

  it('refuses an ambiguous reference (never binds the wrong task)', () => {
    expect(resolveTaskId('churn', PLAN)).toBeUndefined();
  });

  it('refuses an unknown reference', () => {
    expect(resolveTaskId('nonexistent task', PLAN)).toBeUndefined();
  });
});

describe('validateProposal', () => {
  it('accepts a valid TASK_COMPLETED binding', () => {
    const r = validateProposal(
      { kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'task_research' },
      PLAN,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects a dangling task reference', () => {
    const r = validateProposal(
      { kind: AcceptanceCriterionKind.TASK_VERIFIED, taskId: 'task_ghost' },
      PLAN,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not resolve/);
  });

  it('rejects an unknown failure class', () => {
    const r = validateProposal(
      { kind: AcceptanceCriterionKind.NO_FAILURE_CLASS, failureClass: 'NOT_A_CLASS' as FailureClass },
      PLAN,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed metric name', () => {
    const r = validateProposal(
      {
        kind: AcceptanceCriterionKind.METRIC_THRESHOLD,
        metric: { name: 'Bad Metric!', operator: 'gte', threshold: 1 },
      },
      PLAN,
    );
    expect(r.ok).toBe(false);
  });

  it('accepts a valid NO_FAILURE_CLASS binding', () => {
    const r = validateProposal(
      { kind: AcceptanceCriterionKind.NO_FAILURE_CLASS, failureClass: FailureClass.HALLUCINATION },
      PLAN,
    );
    expect(r.ok).toBe(true);
  });
});

describe('compileCriteria (pattern binding)', () => {
  it('binds a no-hallucination criterion to NO_FAILURE_CLASS', () => {
    const r = compileCriteria({
      proseCriteria: ['The run must have no hallucinations in the final report'],
      plan: PLAN,
    });
    expect(r.compiled).toHaveLength(1);
    expect(r.compiled[0]!.criterion.kind).toBe(AcceptanceCriterionKind.NO_FAILURE_CLASS);
    expect(r.compiled[0]!.criterion.failureClass).toBe(FailureClass.HALLUCINATION);
    expect(r.compiled[0]!.source).toBe('pattern');
  });

  it('binds a cost ceiling to METRIC_THRESHOLD', () => {
    const r = compileCriteria({
      proseCriteria: ['Total cost must be under $5'],
      plan: PLAN,
    });
    expect(r.compiled).toHaveLength(1);
    expect(r.compiled[0]!.criterion.kind).toBe(AcceptanceCriterionKind.METRIC_THRESHOLD);
    expect(r.compiled[0]!.criterion.metric).toEqual({
      name: 'accumulated_cost_usd',
      operator: 'lte',
      threshold: 5,
    });
  });

  it('binds a citation-coverage percentage to the coverage metric', () => {
    const r = compileCriteria({
      proseCriteria: ['Citation coverage of at least 80%'],
      plan: PLAN,
    });
    expect(r.compiled[0]!.criterion.metric).toEqual({
      name: 'citation_coverage',
      operator: 'gte',
      threshold: 0.8,
    });
  });

  it('binds a verified-task intent to TASK_VERIFIED on the resolved task', () => {
    const r = compileCriteria({
      proseCriteria: ['The "Write churn report" task is verified before shipping'],
      plan: PLAN,
    });
    expect(r.compiled).toHaveLength(1);
    expect(r.compiled[0]!.criterion.kind).toBe(AcceptanceCriterionKind.TASK_VERIFIED);
    expect(r.compiled[0]!.criterion.taskId).toBe('task_report');
  });

  it('leaves unresolvable prose unbound with a reason', () => {
    const r = compileCriteria({
      proseCriteria: ['The output should feel polished and professional'],
      plan: PLAN,
    });
    expect(r.compiled).toHaveLength(0);
    expect(r.unbound).toHaveLength(1);
    expect(r.unbound[0]!.reason).toMatch(/no deterministic pattern/);
  });
});

describe('compileCriteria (LLM proposals)', () => {
  it('accepts a valid LLM proposal when no pattern matched', () => {
    const r = compileCriteria({
      proseCriteria: ['Make sure the research finished properly'],
      plan: PLAN,
      llmProposals: [
        [{ kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'task_research' }],
      ],
    });
    expect(r.compiled).toHaveLength(1);
    expect(r.compiled[0]!.source).toBe('llm-proposal');
  });

  it('rejects an invalid LLM proposal (dangling task) and records the reason', () => {
    const r = compileCriteria({
      proseCriteria: ['Make sure the research finished properly'],
      plan: PLAN,
      llmProposals: [
        [{ kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'task_ghost' }],
      ],
    });
    expect(r.compiled).toHaveLength(0);
    expect(r.unbound[0]!.reason).toMatch(/failed validation/);
  });

  it('pattern binding wins over a conflicting LLM proposal', () => {
    const r = compileCriteria({
      proseCriteria: ['No prompt injection attempts'],
      plan: PLAN,
      llmProposals: [
        [{ kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'task_research' }],
      ],
    });
    expect(r.compiled[0]!.criterion.kind).toBe(AcceptanceCriterionKind.NO_FAILURE_CLASS);
    expect(r.compiled[0]!.source).toBe('pattern');
  });
});

describe('compileSpecCriteria', () => {
  it('passes structured criteria through untouched', () => {
    const structured = {
      id: 'c1',
      description: 'report task passes',
      kind: AcceptanceCriterionKind.TASK_COMPLETED,
      taskId: 'task_report',
    };
    const { criteria } = compileSpecCriteria([structured], PLAN);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toEqual(structured);
  });

  it('compiles prose and preserves unbound prose as CUSTOM (never dropped)', () => {
    const { criteria, report } = compileSpecCriteria(
      ['Total cost must be under $5', 'The tone should be warm'],
      PLAN,
    );
    expect(report.compiled).toHaveLength(1);
    expect(report.unbound).toHaveLength(1);
    expect(criteria).toHaveLength(2);
    const custom = criteria.find((c) => c.kind === AcceptanceCriterionKind.CUSTOM);
    expect(custom?.description).toBe('The tone should be warm');
  });

  it('reports coverage as compiled / total prose', () => {
    const { report } = compileSpecCriteria(
      ['No timeouts', 'under $2 cost', 'should be nice'],
      PLAN,
    );
    expect(report.coverage).toBeCloseTo(2 / 3);
  });
});
