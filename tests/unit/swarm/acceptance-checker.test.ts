/**
 * acceptance-checker.test.ts — HyperAgent Phase 6 deterministic acceptance.
 *
 * Pins the spec §13 Phase 6 invariants:
 *   - each criterion KIND binds to a concrete evidence source and is wired=true
 *     (even when the check FAILS — a failed wired check is still wired);
 *   - TASK_COMPLETED / TASK_VERIFIED read the task triage;
 *   - ARTIFACT_PRESENT checks the artifact id set;
 *   - METRIC_THRESHOLD applies the operator;
 *   - NO_FAILURE_CLASS checks no task failed with that class;
 *   - CUSTOM is never wired (no deterministic binding) ⇒ UNVERIFIABLE;
 *   - acceptanceVerdict is tri-state: MET / UNMET / UNVERIFIABLE;
 *   - never fake a satisfied criterion.
 */
import { describe, it, expect } from 'vitest';
import {
  AcceptanceCriterionKind,
  AcceptanceVerdict,
  FailureClass,
  TaskVerdict,
} from '../../../packages/shared/src/index.js';
import type { AcceptanceCriterion, RunEvidence, TaskOutcome } from '../../../packages/shared/src/index.js';
import {
  checkCriterion,
  measureAcceptance,
  acceptanceVerdict,
} from '../../../packages/swarm/src/hyperagent/acceptance-checker.js';

function to(over: Partial<TaskOutcome> & { taskId: string }): TaskOutcome {
  return { verdict: TaskVerdict.TASK_PASSED, verified: true, ...over } as TaskOutcome;
}

function ev(over: Partial<RunEvidence>): RunEvidence {
  return { taskOutcomes: [], artifacts: [], metrics: {}, ...over } as RunEvidence;
}

function crit(over: Partial<AcceptanceCriterion> & { id: string; kind: AcceptanceCriterionKind }): AcceptanceCriterion {
  return { id: over.id, description: over.id, kind: over.kind, ...over } as AcceptanceCriterion;
}

describe('checkCriterion — TASK_COMPLETED', () => {
  it('is satisfied + wired when the named task passed', () => {
    const r = checkCriterion(
      crit({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'a' }),
      ev({ taskOutcomes: [to({ taskId: 'a', verdict: TaskVerdict.TASK_PASSED })] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.wired).toBe(true);
    expect(r.evidence).toMatch(/verdict=TASK_PASSED/);
  });

  it('is unsatisfied + wired when the task failed', () => {
    const r = checkCriterion(
      crit({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'a' }),
      ev({ taskOutcomes: [to({ taskId: 'a', verdict: TaskVerdict.TASK_FAILED, verified: false })] }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.wired).toBe(true);
  });

  it('is unsatisfied + wired when the task is absent from the run', () => {
    const r = checkCriterion(
      crit({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'a' }),
      ev({ taskOutcomes: [] }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.wired).toBe(true);
    expect(r.evidence).toMatch(/not present in run/);
  });
});

describe('checkCriterion — TASK_VERIFIED', () => {
  it('requires verified=true AND TASK_PASSED', () => {
    const ok = checkCriterion(
      crit({ id: 'c', kind: AcceptanceCriterionKind.TASK_VERIFIED, taskId: 'a' }),
      ev({ taskOutcomes: [to({ taskId: 'a', verdict: TaskVerdict.TASK_PASSED, verified: true })] }),
    );
    expect(ok.satisfied).toBe(true);

    const passedUnverified = checkCriterion(
      crit({ id: 'c', kind: AcceptanceCriterionKind.TASK_VERIFIED, taskId: 'a' }),
      ev({ taskOutcomes: [to({ taskId: 'a', verdict: TaskVerdict.TASK_PASSED, verified: false })] }),
    );
    expect(passedUnverified.satisfied).toBe(false);
  });
});

describe('checkCriterion — ARTIFACT_PRESENT', () => {
  it('is satisfied when the artifact id was produced', () => {
    const r = checkCriterion(
      crit({ id: 'c', kind: AcceptanceCriterionKind.ARTIFACT_PRESENT, artifactId: 'art-1' }),
      ev({ artifacts: ['art-1', 'art-2'] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.wired).toBe(true);
  });

  it('is unsatisfied when the artifact is absent', () => {
    const r = checkCriterion(
      crit({ id: 'c', kind: AcceptanceCriterionKind.ARTIFACT_PRESENT, artifactId: 'art-9' }),
      ev({ artifacts: ['art-1'] }),
    );
    expect(r.satisfied).toBe(false);
  });
});

describe('checkCriterion — METRIC_THRESHOLD', () => {
  it('applies each operator correctly', () => {
    const m = (operator: 'gte' | 'lte' | 'gt' | 'lt' | 'eq', threshold: number, value: number) =>
      checkCriterion(
        crit({ id: 'c', kind: AcceptanceCriterionKind.METRIC_THRESHOLD, metric: { name: 'cost', operator, threshold } }),
        ev({ metrics: { cost: value } }),
      ).satisfied;
    expect(m('gte', 5, 5)).toBe(true);
    expect(m('gte', 5, 4)).toBe(false);
    expect(m('lte', 5, 5)).toBe(true);
    expect(m('lte', 5, 6)).toBe(false);
    expect(m('gt', 5, 6)).toBe(true);
    expect(m('gt', 5, 5)).toBe(false);
    expect(m('lt', 5, 4)).toBe(true);
    expect(m('lt', 5, 5)).toBe(false);
    expect(m('eq', 5, 5)).toBe(true);
    expect(m('eq', 5, 6)).toBe(false);
  });

  it('is unsatisfied + wired when the metric was not reported', () => {
    const r = checkCriterion(
      crit({ id: 'c', kind: AcceptanceCriterionKind.METRIC_THRESHOLD, metric: { name: 'latency', operator: 'lte', threshold: 100 } }),
      ev({ metrics: {} }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.wired).toBe(true);
    expect(r.evidence).toMatch(/not reported/);
  });
});

describe('checkCriterion — NO_FAILURE_CLASS', () => {
  it('is satisfied when no task failed with the given class', () => {
    const r = checkCriterion(
      crit({ id: 'c', kind: AcceptanceCriterionKind.NO_FAILURE_CLASS, failureClass: FailureClass.GROUNDING_FAILURE }),
      ev({ taskOutcomes: [to({ taskId: 'a', verdict: TaskVerdict.TASK_PASSED, verified: true })] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.wired).toBe(true);
  });

  it('is unsatisfied when a task failed with that class', () => {
    const r = checkCriterion(
      crit({ id: 'c', kind: AcceptanceCriterionKind.NO_FAILURE_CLASS, failureClass: FailureClass.GROUNDING_FAILURE }),
      ev({ taskOutcomes: [to({ taskId: 'a', verdict: TaskVerdict.TASK_FAILED, verified: false, failureClass: FailureClass.GROUNDING_FAILURE })] }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.evidence).toMatch(/GROUNDING_FAILURE/);
  });
});

describe('checkCriterion — CUSTOM', () => {
  it('is never wired and never satisfied (no deterministic binding)', () => {
    const r = checkCriterion(
      crit({ id: 'c', kind: AcceptanceCriterionKind.CUSTOM, description: 'feels right to a human' }),
      ev({}),
    );
    expect(r.wired).toBe(false);
    expect(r.satisfied).toBe(false);
    expect(r.evidence).toBeNull();
  });
});

describe('measureAcceptance', () => {
  it('maps every criterion to a result preserving order', () => {
    const results = measureAcceptance(
      [
        crit({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'a' }),
        crit({ id: 'c2', kind: AcceptanceCriterionKind.CUSTOM }),
      ],
      ev({ taskOutcomes: [to({ taskId: 'a', verdict: TaskVerdict.TASK_PASSED, verified: true })] }),
    );
    expect(results).toHaveLength(2);
    expect(results[0].criterion).toBe('c1');
    expect(results[1].criterion).toBe('c2');
  });
});

describe('acceptanceVerdict (tri-state)', () => {
  it('MET when ≥1 wired criterion AND all wired satisfied', () => {
    const results = measureAcceptance(
      [
        crit({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'a' }),
        crit({ id: 'c2', kind: AcceptanceCriterionKind.ARTIFACT_PRESENT, artifactId: 'x' }),
      ],
      ev({ taskOutcomes: [to({ taskId: 'a', verdict: TaskVerdict.TASK_PASSED, verified: true })], artifacts: ['x'] }),
    );
    expect(acceptanceVerdict(results)).toBe(AcceptanceVerdict.MET);
  });

  it('UNMET when some wired criterion is unsatisfied', () => {
    const results = measureAcceptance(
      [
        crit({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'a' }),
        crit({ id: 'c2', kind: AcceptanceCriterionKind.ARTIFACT_PRESENT, artifactId: 'missing' }),
      ],
      ev({ taskOutcomes: [to({ taskId: 'a', verdict: TaskVerdict.TASK_PASSED, verified: true })], artifacts: [] }),
    );
    expect(acceptanceVerdict(results)).toBe(AcceptanceVerdict.UNMET);
  });

  it('UNVERIFIABLE when every criterion is CUSTOM (zero wired)', () => {
    const results = measureAcceptance(
      [crit({ id: 'c1', kind: AcceptanceCriterionKind.CUSTOM }), crit({ id: 'c2', kind: AcceptanceCriterionKind.CUSTOM })],
      ev({}),
    );
    expect(acceptanceVerdict(results)).toBe(AcceptanceVerdict.UNVERIFIABLE);
  });

  it('MET ignores CUSTOM criteria as long as all wired ones pass', () => {
    const results = measureAcceptance(
      [
        crit({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 'a' }),
        crit({ id: 'c2', kind: AcceptanceCriterionKind.CUSTOM }),
      ],
      ev({ taskOutcomes: [to({ taskId: 'a', verdict: TaskVerdict.TASK_PASSED, verified: true })] }),
    );
    expect(acceptanceVerdict(results)).toBe(AcceptanceVerdict.MET);
  });
});