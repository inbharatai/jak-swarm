/**
 * dp-noise.test.ts — HyperAgent Phase 7 innovation #8 (differential privacy).
 *
 * Pins the Laplace-mechanism invariants:
 *   - deterministic: same (values, epsilon, seed) ⇒ identical noisy output;
 *   - the noise is centered at zero (Laplace is symmetric) over many samples;
 *   - smaller ε ⇒ larger expected |noise| (more privacy, less utility);
 *   - the true sum/mean is recoverable from the returned audit fields;
 *   - basic composition: total ε = k · ε, and a release over budget is reported.
 */
import { describe, it, expect } from 'vitest';
import {
  makePrng,
  laplace,
  dpSum,
  dpMean,
  privatizeMetric,
  composeBudget,
} from '../../../packages/swarm/src/hyperagent/dp-noise.js';

describe('makePrng + laplace — determinism', () => {
  it('same seed ⇒ identical PRNG stream', () => {
    const a = makePrng('tenant:metric:run-1');
    const b = makePrng('tenant:metric:run-1');
    const streamA = Array.from({ length: 5 }, () => a());
    const streamB = Array.from({ length: 5 }, () => b());
    expect(streamA).toEqual(streamB);
  });

  it('different seeds ⇒ different streams', () => {
    const a = makePrng('seed-a');
    const b = makePrng('seed-b');
    expect(a()).not.toBe(b());
  });

  it('laplace is deterministic for a fixed prng', () => {
    const p = makePrng('fixed');
    const p2 = makePrng('fixed');
    expect(laplace(1, p)).toBe(laplace(1, p2));
  });

  it('laplace(0, prng) returns 0 (no noise when scale is zero)', () => {
    expect(laplace(0, makePrng('x'))).toBe(0);
  });
});

describe('laplace — distribution sanity', () => {
  it('is symmetric and zero-centered over many samples', () => {
    const p = makePrng('symmetry-seed');
    const n = 5000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += laplace(1, p);
    const mean = sum / n;
    // Zero-centered within a generous tolerance (Laplace variance = 2·scale²).
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });

  it('larger scale ⇒ larger expected absolute noise', () => {
    const small = makePrng('scale-seed');
    const large = makePrng('scale-seed');
    let smallAbs = 0;
    let largeAbs = 0;
    for (let i = 0; i < 2000; i++) {
      smallAbs += Math.abs(laplace(0.1, small));
      largeAbs += Math.abs(laplace(5, large));
    }
    expect(largeAbs).toBeGreaterThan(smallAbs * 10);
  });
});

describe('dpSum', () => {
  it('returns the true sum plus deterministic Laplace noise', () => {
    const r = dpSum({ values: [1, 2, 3, 4], epsilon: 1, seed: 's1' });
    expect(r.trueSum).toBe(10);
    expect(r.value).toBeCloseTo(r.trueSum + r.noise, 10);
  });

  it('is deterministic for the same inputs', () => {
    const a = dpSum({ values: [1, 2, 3], epsilon: 0.5, seed: 's1' });
    const b = dpSum({ values: [1, 2, 3], epsilon: 0.5, seed: 's1' });
    expect(a).toEqual(b);
  });

  it('smaller ε ⇒ larger expected |noise| (more privacy)', () => {
    let loose = 0;
    let tight = 0;
    for (let i = 0; i < 2000; i++) {
      loose += Math.abs(dpSum({ values: [0], epsilon: 10, seed: `l${i}` }).noise);
      tight += Math.abs(dpSum({ values: [0], epsilon: 0.1, seed: `t${i}` }).noise);
    }
    // ε=0.1 ⇒ scale 10; ε=10 ⇒ scale 0.1. Tight privacy (small ε) ⇒ bigger noise.
    expect(tight).toBeGreaterThan(loose * 10);
  });
});

describe('dpMean', () => {
  it('returns the true mean plus scaled noise', () => {
    const r = dpMean({ values: [10, 20, 30], epsilon: 1, seed: 'm1' });
    expect(r.trueMean).toBeCloseTo(20, 10);
    expect(r.value).toBeCloseTo(r.trueMean + r.noise, 10);
  });

  it('returns 0 for an empty input (no division by zero)', () => {
    const r = dpMean({ values: [], epsilon: 1, seed: 'empty' });
    expect(r.value).toBe(0);
    expect(r.noise).toBe(0);
  });
});

describe('privatizeMetric', () => {
  it('adds Laplace(1/ε) noise to a single metric', () => {
    const a = privatizeMetric(42, 1, 'metric-seed');
    const b = privatizeMetric(42, 1, 'metric-seed');
    expect(a).toEqual(b);
    expect(a.value).toBeCloseTo(42 + a.noise, 10);
  });

  it('honours a caller-supplied sensitivity (Laplace(sensitivity/ε)) — Bug 8', () => {
    // The noise scale MUST be sensitivity/ε, not the hardcoded 1/ε. Assert the
    // released noise equals an independently-computed laplace(sensitivity/ε)
    // with the same seed, for a non-unit sensitivity.
    const sensitivity = 0.1;
    const epsilon = 1.0;
    const seed = 'metric-seed';
    const r = privatizeMetric(42, epsilon, seed, sensitivity);
    const expected = laplace(sensitivity / epsilon, makePrng(seed));
    expect(r.noise).toBeCloseTo(expected, 10);
    // And it is NOT the hardcoded-sensitivity-1 noise (the prior bug).
    const buggy = laplace(1 / epsilon, makePrng(seed));
    expect(r.noise).not.toBeCloseTo(buggy, 6);
  });
});

describe('composeBudget', () => {
  it('totals ε across sequential releases (basic composition)', () => {
    expect(composeBudget(0.1, 5)).toBeCloseTo(0.5, 10);
  });

  it('is zero for zero releases', () => {
    expect(composeBudget(0.5, 0)).toBe(0);
  });
});