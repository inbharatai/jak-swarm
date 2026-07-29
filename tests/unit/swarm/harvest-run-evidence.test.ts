/**
 * harvest-run-evidence.test.ts — pins the pure Hyperagent live-seam harvester
 * (truth-doc open edges D1/D2, now wired into runPlanViaLangGraph).
 *
 * The harvester is pure (no I/O, no LLM), so it is unit-testable in isolation
 * without the real LangGraph + provider keys. runPlanViaLangGraph spreads the
 * harvested { artifacts, failureClassByTask? } into FinishedRun, which the
 * closed loop (executeApprovedSpec) feeds straight into evaluateOutcome +
 * RunEvidence. These tests pin the contract that makes that wiring honest.
 */
import { describe, it, expect } from 'vitest';
import { FailureClass } from '../../../packages/shared/src/index.js';
import { createInitialSwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import type { SwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import type { FailureDiagnosis } from '../../../packages/shared/src/index.js';
import { harvestRunEvidence } from '../../../packages/swarm/src/hyperagent/spec-executor-runtime.js';
import { harvestAccuracyMetrics } from '../../../packages/swarm/src/hyperagent/spec-executor-runtime.js';

function baseState(over: Partial<SwarmState> = {}): SwarmState {
  const base = createInitialSwarmState({
    goal: 'g',
    tenantId: 't1',
    userId: 'u1',
    workflowId: 'wf1',
  });
  return { ...base, ...over } as SwarmState;
}

function diag(taskId: string, failureClass: FailureClass): FailureDiagnosis {
  return {
    id: `d-${taskId}`,
    tenantId: 't1',
    workflowId: 'wf1',
    taskId,
    failureClass,
    rootCause: 'rc',
    evidence: {},
    confidence: 0.9,
    recommendedRepairLevel: 'R2',
    recommendedChanges: {},
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as FailureDiagnosis;
}

describe('harvestRunEvidence (Hyperagent D1/D2 live-seam harvester)', () => {
  it('returns empty artifacts and no failureClassByTask for a bare state', () => {
    const out = harvestRunEvidence(baseState());
    expect(out.artifacts).toEqual([]);
    expect(out.failureClassByTask).toBeUndefined();
  });

  it('harvests artifactId / artifactIds / artifacts from taskResults, deduped', () => {
    const state = baseState({
      taskResults: {
        t1: { artifactId: 'art-1' },
        t2: { artifactIds: ['art-2', 'art-1', 'art-3'] },
        t3: { artifacts: ['art-4'] },
        t4: { ok: true },
        t5: { artifactId: '' },
      },
    });
    expect(harvestRunEvidence(state).artifacts.sort()).toEqual(['art-1', 'art-2', 'art-3', 'art-4']);
  });

  it('ignores non-string / non-string-array artifact-like fields', () => {
    const state = baseState({
      taskResults: {
        t1: { artifactId: 123 },
        t2: { artifactIds: ['ok', 9 as unknown as string] },
        t3: { artifacts: 'not-an-array' },
      },
    });
    expect(harvestRunEvidence(state).artifacts).toEqual([]);
  });

  it('builds failureClassByTask from state.failureDiagnoses', () => {
    const state = baseState({
      failureDiagnoses: {
        t1: diag('t1', FailureClass.HALLUCINATION),
        t2: diag('t2', FailureClass.RATE_LIMIT),
      },
    });
    const out = harvestRunEvidence(state);
    expect(out.failureClassByTask).toEqual({
      t1: FailureClass.HALLUCINATION,
      t2: FailureClass.RATE_LIMIT,
    });
  });

  it('returns undefined failureClassByTask when there are no diagnoses', () => {
    const state = baseState({ failureDiagnoses: {} });
    expect(harvestRunEvidence(state).failureClassByTask).toBeUndefined();
  });

  it('harvests both artifacts and failure classes together', () => {
    const state = baseState({
      taskResults: { t1: { artifactId: 'art-1' } },
      failureDiagnoses: { t1: diag('t1', FailureClass.POLICY_BLOCK) },
    });
    const out = harvestRunEvidence(state);
    expect(out.artifacts).toEqual(['art-1']);
    expect(out.failureClassByTask).toEqual({ t1: FailureClass.POLICY_BLOCK });
  });
});

describe('harvestAccuracyMetrics (accuracy pass)', () => {
  it('emits nothing for a bare state (no quality scores, no served claims)', () => {
    expect(harvestAccuracyMetrics(baseState())).toEqual({});
  });

  it('emits the mean quality_score across verified tasks', () => {
    const state = baseState({
      verificationResults: {
        t1: { passed: true, issues: [], confidence: 0.9, needsRetry: false, qualityScore: 0.8 },
        t2: { passed: true, issues: [], confidence: 0.7, needsRetry: false, qualityScore: 0.6 },
        t3: { passed: true, issues: [], confidence: 0.95, needsRetry: false },
      },
    } as unknown as Partial<SwarmState>);
    const m = harvestAccuracyMetrics(state);
    expect(m.quality_score).toBeCloseTo(0.7);
  });

  it('emits citation_coverage only when served claims + a text output exist', () => {
    const state = baseState({
      taskResults: { t1: 'Churn increased 18% in Q2 2026.' },
      servedClaims: [
        { id: 'c1', text: 'Customer churn increased 18% in Q2 2026 driven by onboarding drop-off.' },
      ],
    } as unknown as Partial<SwarmState>);
    const m = harvestAccuracyMetrics(state);
    expect(m.citation_coverage).toBe(1);
  });

  it('omits citation_coverage when no claims were served (never fakes grounded)', () => {
    const state = baseState({ taskResults: { t1: 'Churn increased 18%.' } });
    const m = harvestAccuracyMetrics(state);
    expect(m.citation_coverage).toBeUndefined();
  });
});
