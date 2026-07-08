/**
 * learning-extractor.test.ts — HyperAgent Phase 5 self-learning (PURE core).
 *
 * Pins the spec §13 Phase 5 invariants:
 *   - a PASSED + verified task yields a WORKFLOW learning (contingency a=1);
 *   - a FAILED task yields a POLICY learning carrying the diagnosis' repair
 *     preference + isolated counterfactual dimension (contingency b=1), sourced
 *     from FAILURE_DIAGNOSIS when a diagnosis is present, OUTCOME otherwise;
 *   - a BLOCKED task yields a KNOWLEDGE learning;
 *   - a run-level BLOCKED verdict yields a goal-shape KNOWLEDGE learning the
 *     planner can avoid;
 *   - the extractor is pure + deterministic: identical input ⇒ identical output,
 *     and a single observation never has nonzero mutual information (the gate
 *     accumulates across runs before promoting).
 */
import { describe, it, expect } from 'vitest';
import {
  FailureClass,
  LearningKind,
  LearningSource,
  OutcomeVerdict,
  RepairLevel,
  TaskVerdict,
} from '../../../packages/shared/src/index.js';
import type {
  FailureDiagnosis,
  OutcomeEvaluation,
  TaskOutcome,
} from '../../../packages/shared/src/index.js';
import { extractLearnings } from '../../../packages/swarm/src/hyperagent/learning-extractor.js';

function task(over: Partial<TaskOutcome> & { taskId: string }): TaskOutcome {
  return {
    verdict: TaskVerdict.TASK_PASSED,
    verified: true,
    verificationConfidence: 0.9,
    ...over,
  } as TaskOutcome;
}

function outcome(over: Partial<OutcomeEvaluation> & { taskOutcomes: TaskOutcome[] }): OutcomeEvaluation {
  return {
    workflowId: 'wf_test_1',
    tenantId: 't1',
    verdict: OutcomeVerdict.OUTCOME_SUCCESS,
    taskTotal: over.taskOutcomes.length,
    taskPassed: over.taskOutcomes.filter((t) => t.verdict === TaskVerdict.TASK_PASSED).length,
    taskFailed: over.taskOutcomes.filter((t) => t.verdict === TaskVerdict.TASK_FAILED).length,
    taskBlocked: over.taskOutcomes.filter((t) => t.verdict === TaskVerdict.TASK_BLOCKED).length,
    taskSkipped: 0,
    acceptanceResults: [],
    totalCostUsd: 0,
    durationMs: 0,
    counterfactualHints: [],
    summary: 'ok',
    ...over,
  } as OutcomeEvaluation;
}

function diag(over: Partial<FailureDiagnosis> & { taskId: string }): FailureDiagnosis {
  return {
    id: 'd1',
    tenantId: 't1',
    workflowId: 'wf_test_1',
    failureClass: FailureClass.TOOL_UNAVAILABLE,
    rootCause: 'tool timed out',
    evidence: { isolatedDimension: 'tool' },
    confidence: 0.8,
    recommendedRepairLevel: RepairLevel.R2,
    recommendedChanges: { tool: 'alt_tool' },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as FailureDiagnosis;
}

describe('extractLearnings (Phase 5)', () => {
  it('emits a WORKFLOW learning for a verified-passed task (contingency a=1)', () => {
    const res = extractLearnings({
      outcome: outcome({ taskOutcomes: [task({ taskId: 'grounding_1' })] }),
      now: '2026-01-01T00:00:00.000Z',
      tenantId: 't1',
    });
    expect(res).toHaveLength(1);
    const [c] = res;
    expect(c.kind).toBe(LearningKind.WORKFLOW);
    expect(c.source).toBe(LearningSource.OUTCOME);
    expect(c.contingency).toEqual({ a: 1, b: 0, c: 0, d: 0 });
    expect(c.key).toBe('cfg:grounding');
    expect(c.tags).toContain('task:grounding');
    expect(c.tags).toContain('verified');
  });

  it('does NOT emit a WORKFLOW learning for a passed-but-unverified task', () => {
    const res = extractLearnings({
      outcome: outcome({ taskOutcomes: [task({ taskId: 'x_1', verified: false })] }),
      now: '2026-01-01T00:00:00.000Z',
      tenantId: 't1',
    });
    expect(res).toHaveLength(0);
  });

  it('emits a POLICY learning sourced from FAILURE_DIAGNOSIS for a failed task with a diagnosis', () => {
    const res = extractLearnings({
      outcome: outcome({
        verdict: OutcomeVerdict.OUTCOME_FAILED,
        taskOutcomes: [task({ taskId: 'grounding_1', verdict: TaskVerdict.TASK_FAILED, verified: false, failureClass: FailureClass.TOOL_UNAVAILABLE })],
      }),
      diagnoses: { grounding_1: diag({ taskId: 'grounding_1' }) },
      now: '2026-01-01T00:00:00.000Z',
      tenantId: 't1',
    });
    expect(res).toHaveLength(1);
    const [c] = res;
    expect(c.kind).toBe(LearningKind.POLICY);
    expect(c.source).toBe(LearningSource.FAILURE_DIAGNOSIS);
    expect(c.contingency).toEqual({ a: 0, b: 1, c: 0, d: 0 });
    expect(c.failureClass).toBe(FailureClass.TOOL_UNAVAILABLE);
    expect(c.value.isolatedDimension).toBe('tool');
    expect(c.value.recommendedRepairLevel).toBe(RepairLevel.R2);
    expect(c.value.recommendedChanges).toEqual({ tool: 'alt_tool' });
    expect(c.key).toBe('cfg:grounding:TOOL_UNAVAILABLE:tool');
  });

  it('emits a POLICY learning sourced from OUTCOME when no diagnosis is present', () => {
    const res = extractLearnings({
      outcome: outcome({
        verdict: OutcomeVerdict.OUTCOME_FAILED,
        taskOutcomes: [task({ taskId: 'x_1', verdict: TaskVerdict.TASK_FAILED, verified: false, failureClass: FailureClass.UNKNOWN })],
      }),
      now: '2026-01-01T00:00:00.000Z',
      tenantId: 't1',
    });
    expect(res).toHaveLength(1);
    const [c] = res;
    expect(c.kind).toBe(LearningKind.POLICY);
    expect(c.source).toBe(LearningSource.OUTCOME);
    expect(c.failureClass).toBe(FailureClass.UNKNOWN);
  });

  it('emits a KNOWLEDGE learning for a blocked task', () => {
    const res = extractLearnings({
      outcome: outcome({
        verdict: OutcomeVerdict.OUTCOME_BLOCKED,
        taskOutcomes: [task({ taskId: 'pay_1', verdict: TaskVerdict.TASK_BLOCKED, verified: false })],
      }),
      now: '2026-01-01T00:00:00.000Z',
      tenantId: 't1',
    });
    const blocked = res.find((c) => c.kind === LearningKind.KNOWLEDGE && c.key.startsWith('block:'));
    expect(blocked).toBeDefined();
    expect(blocked?.key).toBe('block:pay');
    expect(blocked?.tags).toContain('task:pay');
  });

  it('emits a goal-shape KNOWLEDGE learning for a run-level BLOCKED verdict', () => {
    const res = extractLearnings({
      outcome: outcome({
        workflowId: 'payrun_1',
        verdict: OutcomeVerdict.OUTCOME_BLOCKED,
        taskOutcomes: [task({ taskId: 'pay_1', verdict: TaskVerdict.TASK_BLOCKED, verified: false })],
        summary: 'blocked by payment guardrail',
      }),
      now: '2026-01-01T00:00:00.000Z',
      tenantId: 't1',
    });
    const goal = res.find((c) => c.key.startsWith('goal-block:'));
    expect(goal).toBeDefined();
    expect(goal?.key).toBe('goal-block:payrun');
    expect(goal?.outcomeVerdict).toBe(OutcomeVerdict.OUTCOME_BLOCKED);
    expect(goal?.tags).toContain('goal-shape:blocked');
  });

  it('is pure + deterministic: same input twice ⇒ deeply equal output', () => {
    const input = {
      outcome: outcome({ taskOutcomes: [task({ taskId: 'g_1' })] }),
      now: '2026-01-01T00:00:00.000Z',
      tenantId: 't1',
    };
    const a = extractLearnings(input);
    const b = extractLearnings(input);
    expect(a).toEqual(b);
  });

  it('mixes multiple task outcomes in one run (passed + failed + blocked)', () => {
    const res = extractLearnings({
      outcome: outcome({
        verdict: OutcomeVerdict.OUTCOME_PARTIAL,
        taskOutcomes: [
          task({ taskId: 'a_1', verdict: TaskVerdict.TASK_PASSED, verified: true }),
          task({ taskId: 'b_1', verdict: TaskVerdict.TASK_FAILED, verified: false, failureClass: FailureClass.UNKNOWN }),
          task({ taskId: 'c_1', verdict: TaskVerdict.TASK_BLOCKED, verified: false }),
        ],
      }),
      now: '2026-01-01T00:00:00.000Z',
      tenantId: 't1',
    });
    const kinds = res.map((c) => c.kind).sort();
    expect(kinds).toEqual([LearningKind.KNOWLEDGE, LearningKind.POLICY, LearningKind.WORKFLOW]);
  });
});