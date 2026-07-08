/**
 * learning-gate.test.ts — HyperAgent Phase 5 innovation #2 (information-theoretic gating).
 *
 * Pins the spec §13 Phase 5 invariant: a learning is promoted ONLY when the
 * mutual information I(learning; success) — measured over the 2×2 contingency
 * table — exceeds a threshold AND enough samples have accrued AND at least one
 * present-success was observed. "The LLM said this is better" is never enough.
 *
 *   a = present   & success
 *   b = present   & failure
 *   c = absent    & success
 *   d = absent    & failure
 */
import { describe, it, expect } from 'vitest';
import {
  gateLearning,
  mergeContingency,
  mutualInformation,
  DEFAULT_GATE,
} from '../../../packages/swarm/src/hyperagent/learning-gate.js';
import type { ContingencyTable } from '../../../packages/shared/src/index.js';

const T = (a: number, b: number, c: number, d: number): ContingencyTable => ({ a, b, c, d });

describe('mutualInformation (innovation #2)', () => {
  it('returns 1 bit for perfect correlation (present⇒success, absent⇒failure)', () => {
    expect(mutualInformation(T(5, 0, 0, 5))).toBeCloseTo(1.0, 10);
  });

  it('returns 0 for an independent table (no correlation)', () => {
    expect(mutualInformation(T(2, 2, 2, 2))).toBe(0);
  });

  it('returns 0 for an empty table', () => {
    expect(mutualInformation(T(0, 0, 0, 0))).toBe(0);
  });

  it('returns 0 when one margin is zero (no variation ⇒ MI undefined/0)', () => {
    // No "absent" observations at all.
    expect(mutualInformation(T(5, 5, 0, 0))).toBe(0);
    // No successes at all.
    expect(mutualInformation(T(0, 5, 0, 5))).toBe(0);
  });

  it('computes the textbook 2×2 value for a=4,b=1,c=1,d=4', () => {
    // I = 0.4·log2(1.6)·2 − 0.1·log2(0.4)·2 ≈ 0.2781 bits.
    expect(mutualInformation(T(4, 1, 1, 4))).toBeCloseTo(0.2781, 3);
  });
});

describe('mergeContingency', () => {
  it('sums cells pairwise', () => {
    expect(mergeContingency(T(1, 0, 0, 0), T(0, 1, 2, 3))).toEqual(T(1, 1, 2, 3));
  });
});

describe('gateLearning (innovation #2)', () => {
  it('promotes when MI ≥ threshold AND samples ≥ min AND a ≥ 1', () => {
    const res = gateLearning({ key: 'cfg:g', contingency: T(4, 1, 1, 4) });
    expect(res.promoted).toBe(true);
    expect(res.mutualInformation).toBeCloseTo(0.2781, 3);
    expect(res.reason).toMatch(/promoted/);
  });

  it('refuses promotion when samples < minSamples', () => {
    // n=3, a=2, MI would be high but sample count too low.
    const res = gateLearning({ key: 'cfg:g', contingency: T(2, 0, 0, 1) });
    expect(res.promoted).toBe(false);
    expect(res.reason).toMatch(/insufficient samples/);
  });

  it('refuses promotion when no present-successes were observed (a=0)', () => {
    const res = gateLearning({ key: 'cfg:g', contingency: T(0, 3, 3, 3) });
    expect(res.promoted).toBe(false);
    expect(res.reason).toMatch(/no observed present-successes/);
  });

  it('refuses promotion when MI is below threshold (independent table)', () => {
    const res = gateLearning({ key: 'cfg:g', contingency: T(2, 2, 2, 2) });
    expect(res.promoted).toBe(false);
    expect(res.reason).toMatch(/mutual information/);
    expect(res.reason).toMatch(/below threshold/);
  });

  it('respects a custom threshold, minSamples, and minPresentSuccesses', () => {
    // With defaults this table promotes; with a raised threshold it does not.
    const promotedDefault = gateLearning({ key: 'k', contingency: T(4, 1, 1, 4) });
    expect(promotedDefault.promoted).toBe(true);
    const rejectedHighThreshold = gateLearning({
      key: 'k',
      contingency: T(4, 1, 1, 4),
      threshold: 0.9,
    });
    expect(rejectedHighThreshold.promoted).toBe(false);
    expect(rejectedHighThreshold.reason).toMatch(/below threshold/);

    // Custom minSamples blocks a high-MI small table.
    const blockedBySamples = gateLearning({
      key: 'k',
      contingency: T(4, 0, 0, 4),
      minSamples: 20,
    });
    expect(blockedBySamples.promoted).toBe(false);
    expect(blockedBySamples.reason).toMatch(/insufficient samples/);

    // Custom minPresentSuccesses blocks a table with few present-successes.
    const blockedBySuccesses = gateLearning({
      key: 'k',
      contingency: T(1, 4, 4, 4),
      minPresentSuccesses: 5,
    });
    expect(blockedBySuccesses.promoted).toBe(false);
    expect(blockedBySuccesses.reason).toMatch(/present-successes/);
  });

  it('exposes the contingency table it decided on', () => {
    const res = gateLearning({ key: 'cfg:g', contingency: T(4, 1, 1, 4) });
    expect(res.contingency).toEqual(T(4, 1, 1, 4));
  });

  it('uses the documented default thresholds', () => {
    expect(DEFAULT_GATE.miThreshold).toBe(0.05);
    expect(DEFAULT_GATE.minSamples).toBe(5);
    expect(DEFAULT_GATE.minPresentSuccesses).toBe(1);
  });
});