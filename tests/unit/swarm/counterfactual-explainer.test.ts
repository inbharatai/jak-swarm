/**
 * counterfactual-explainer.test.ts — HyperAgent Phase 7 innovation #9 (audit explanations).
 *
 * Pins the generic counterfactual explainer:
 *   - a decision that flips under a single-variable perturbation records it,
 *     with the minimal (first-supplied) flip surfaced as `minimalFlip`;
 *   - a decision stable under all supplied perturbations is `robust=true` with
 *     no minimalFlip;
 *   - every flipping perturbation is recorded in order;
 *   - pure + deterministic: same inputs ⇒ identical explanation.
 *
 * Uses the learning-gate promotion rule (innovation #2) as the concrete
 * decision: promote iff MI ≥ threshold AND samples ≥ 5 AND a ≥ 1.
 */
import { describe, it, expect } from 'vitest';
import {
  explainCounterfactual,
  type CounterfactualPerturbation,
} from '../../../packages/swarm/src/hyperagent/counterfactual-explainer.js';

interface GateFactors {
  a: number; // present-successes
  samples: number;
  mi: number;
  threshold: number;
}

const decide = (f: GateFactors): boolean => f.mi >= f.threshold && f.samples >= 5 && f.a >= 1;

const perturbations: CounterfactualPerturbation<GateFactors>[] = [
  { name: 'one-fewer-present-success', apply: (f) => ({ ...f, a: f.a - 1 }), describe: (f) => `had there been ${f.a - 1} present-successes instead of ${f.a}` },
  { name: 'one-fewer-sample', apply: (f) => ({ ...f, samples: f.samples - 1 }), describe: (f) => `had there been ${f.samples - 1} samples instead of ${f.samples}` },
  { name: 'raise-threshold-0.1', apply: (f) => ({ ...f, threshold: f.threshold + 0.1 }), describe: (f) => `had the MI threshold been ${f.threshold + 0.1}` },
];

describe('explainCounterfactual — flipping perturbations', () => {
  it('records the minimal flip and is not robust', () => {
    const e = explainCounterfactual({
      factors: { a: 1, samples: 6, mi: 0.2, threshold: 0.05 },
      decide,
      perturbations,
    });
    expect(e.decision).toBe(true);
    expect(e.robust).toBe(false);
    expect(e.minimalFlip?.name).toBe('one-fewer-present-success');
    // a→0 flips; samples→5 does NOT (still ≥5); threshold→0.15 flips (mi 0.2 still ≥ 0.15? yes) — wait:
    // threshold 0.05+0.1=0.15, mi 0.2 ≥ 0.15 ⇒ still promoted ⇒ does NOT flip.
    expect(e.flippingPerturbations.map((p) => p.name)).toEqual(['one-fewer-present-success']);
  });

  it('records multiple flips in the supplied order', () => {
    // a=1, samples=5, mi=0.06, threshold=0.05.
    // one-fewer-present-success: a→0 ⇒ flip.
    // one-fewer-sample: samples→4 ⇒ flip.
    // raise-threshold-0.1: threshold→0.15, mi 0.06 < 0.15 ⇒ flip.
    const e = explainCounterfactual({
      factors: { a: 1, samples: 5, mi: 0.06, threshold: 0.05 },
      decide,
      perturbations,
    });
    expect(e.decision).toBe(true);
    expect(e.robust).toBe(false);
    expect(e.flippingPerturbations.map((p) => p.name)).toEqual([
      'one-fewer-present-success',
      'one-fewer-sample',
      'raise-threshold-0.1',
    ]);
    expect(e.minimalFlip?.name).toBe('one-fewer-present-success');
  });

  it('surfaces the counterfactual decision value (opposite of the original)', () => {
    const e = explainCounterfactual({
      factors: { a: 1, samples: 6, mi: 0.2, threshold: 0.05 },
      decide,
      perturbations,
    });
    const flip = e.flippingPerturbations.find((p) => p.name === 'one-fewer-present-success');
    expect(flip?.counterfactualDecision).toBe(false);
  });
});

describe('explainCounterfactual — robust decision', () => {
  it('is robust when no supplied perturbation flips it', () => {
    const e = explainCounterfactual({
      factors: { a: 5, samples: 10, mi: 0.5, threshold: 0.05 },
      decide,
      perturbations,
    });
    expect(e.decision).toBe(true);
    expect(e.robust).toBe(true);
    expect(e.flippingPerturbations).toHaveLength(0);
    expect(e.minimalFlip).toBeUndefined();
  });
});

describe('explainCounterfactual — determinism', () => {
  it('same inputs ⇒ identical explanation', () => {
    const factors = { a: 1, samples: 5, mi: 0.06, threshold: 0.05 };
    const a = explainCounterfactual({ factors, decide, perturbations });
    const b = explainCounterfactual({ factors, decide, perturbations });
    expect(a).toEqual(b);
  });
});