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
  directionalLift,
  presentSuccessRate,
  absentSuccessRate,
  wilsonLowerBound,
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
    expect(DEFAULT_GATE.minLift).toBe(0.1);
    expect(DEFAULT_GATE.wilsonConfidenceZ).toBe(1.96);
  });
});

// ─── Phase 6: positional mutualInformation regression + directional/statistical safety ──

describe('Phase 6 mutualInformation — positional marginals (value-collision regression)', () => {
  it('computes the correct MI when two cells share a value but have different roles (c === d)', () => {
    // {11,2,8,8}: the prior value-equality loop mis-keyed the marginals for the
    // two 8-count cells (c and d) because it tested `x === a` etc. Positional
    // computation uses each cell's role, not its value, so the shared 8 does
    // not corrupt the result. The correct value is ~0.1004 bits, NOT 0.
    const mi = mutualInformation(T(11, 2, 8, 8));
    expect(mi).toBeCloseTo(0.1004, 3);
    // And critically, it is NOT the buggy 0 the value-equality loop produced.
    expect(mi).toBeGreaterThan(0.05);
  });

  it('still matches the textbook value when no cells collide (sanity)', () => {
    expect(mutualInformation(T(4, 1, 1, 4))).toBeCloseTo(0.2781, 3);
  });
});

describe('Phase 6 directional + statistical-safety helpers', () => {
  it('presentSuccessRate / absentSuccessRate / directionalLift compute the right rates', () => {
    expect(presentSuccessRate(T(4, 1, 1, 4))).toBeCloseTo(0.8, 10); // 4/5
    expect(absentSuccessRate(T(4, 1, 1, 4))).toBeCloseTo(0.2, 10); // 1/5
    expect(directionalLift(T(4, 1, 1, 4))).toBeCloseTo(0.6, 10);
    // Anti-correlated: present⇒failure.
    expect(presentSuccessRate(T(1, 4, 4, 1))).toBeCloseTo(0.2, 10); // 1/5
    expect(absentSuccessRate(T(1, 4, 4, 1))).toBeCloseTo(0.8, 10); // 4/5
    expect(directionalLift(T(1, 4, 4, 1))).toBeCloseTo(-0.6, 10);
  });

  it('wilsonLowerBound returns 0 for zero trials and a high lower bound for a confident rate', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    // 2/2 successes: the lucky-small-N case. Lower bound is ~0.342 (below a
    // 0.375 absent baseline) — exactly why this must not auto-promote.
    expect(wilsonLowerBound(2, 2)).toBeCloseTo(0.342, 2);
    // A confident large-N rate (18/20) sits well above the same baseline.
    expect(wilsonLowerBound(18, 20)).toBeGreaterThan(0.6);
  });
});

describe('Phase 6 gateLearning — directional + statistically safe promotion', () => {
  it('refuses promotion for a high-MI but ANTI-correlated config (non-directional)', () => {
    // {1,4,4,1}: high MI (~0.278 bits, above threshold) but the config
    // ANTI-correlates with success — present⇒failure. MI is symmetric, so
    // without the directional check this would wrongly promote.
    const res = gateLearning({ key: 'cfg:g', contingency: T(1, 4, 4, 1) });
    expect(res.promoted).toBe(false);
    expect(res.reason).toMatch(/non-directional/);
    // It cleared the MI check (so the rejection is purely directional) — pin that.
    expect(res.mutualInformation).toBeGreaterThan(0.05);
  });

  it('refuses promotion for a lucky small-N run (Wilson lower bound below absent baseline)', () => {
    // {2,0,3,5}: n=10 (≥minSamples), a=2 (≥minPresentSuccesses), MI ~0.236
    // (above threshold), lift = 1.0 − 0.375 = 0.625 (above minLift). It would
    // pass the first four checks — but the Wilson 95% lower bound on a 2/2
    // present-success rate (~0.342) does NOT exceed the 0.375 absent rate, so
    // the lift is statistically indistinguishable from chance at this N.
    const res = gateLearning({ key: 'cfg:g', contingency: T(2, 0, 3, 5) });
    expect(res.promoted).toBe(false);
    expect(res.reason).toMatch(/statistically indistinguishable/);
  });

  it('promotes a real directional lift with enough N (the honest happy path)', () => {
    // {8,2,2,8}: present-success 0.8 vs absent 0.2, lift 0.6, n=20. Wilson lower
    // bound on 8/10 (~0.49) clears the 0.2 absent baseline comfortably.
    const res = gateLearning({ key: 'cfg:g', contingency: T(8, 2, 2, 8) });
    expect(res.promoted).toBe(true);
    expect(res.reason).toMatch(/promoted/);
    expect(res.mutualInformation).toBeGreaterThan(0.05);
  });

  it('still promotes the Phase-5 seed {4,1,1,4} (directional + Wilson-safe)', () => {
    // Regression guard: the existing promoting case must keep promoting under
    // the tightened gate. lift=0.6>0.1, Wilson lower on 4/5 (~0.356) > 0.2.
    const res = gateLearning({ key: 'cfg:g', contingency: T(4, 1, 1, 4) });
    expect(res.promoted).toBe(true);
  });

  it('honours a custom minLift (stricter direction blocks a marginal positive lift)', () => {
    // {6,3,3,6}: present-success 6/9≈0.667, absent 3/9≈0.333, lift≈0.333. MI
    // ~0.082 (above the 0.05 threshold), so it clears MI; with the default
    // minLift 0.1 the lift is directional, but a custom minLift 0.5 blocks it.
    const blocked = gateLearning({ key: 'cfg:g', contingency: T(6, 3, 3, 6), minLift: 0.5 });
    expect(blocked.promoted).toBe(false);
    expect(blocked.reason).toMatch(/non-directional/);
    // Sanity: the same table promotes under the default minLift.
    const allowed = gateLearning({ key: 'cfg:g', contingency: T(6, 3, 3, 6) });
    expect(allowed.promoted).toBe(true);
  });
});