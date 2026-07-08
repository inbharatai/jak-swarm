/**
 * learning-gate.ts — Innovation #2 (HyperAgent Phase 5).
 *
 * Information-theoretic learning gating. A learning is promoted ONLY when the
 * mutual information I(learning; outcome=success) — measured over the 2×2
 * contingency table of observed runs — exceeds a threshold AND enough samples
 * have accrued. This replaces "the LLM said this is better" with a measured
 * correlation: a learning that doesn't actually move the success probability
 * cannot govern behaviour, no matter how plausible its summary sounds.
 *
 * Pure + deterministic — no I/O, no LLM, fully unit-testable.
 */
import type { ContingencyTable, LearningPromotion } from '@jak-swarm/shared';
import { LearningKind, LearningSource } from '@jak-swarm/shared';

/** Default promotion thresholds (the service layer / tenant config may override). */
export const DEFAULT_GATE = {
  /** Minimum mutual information (bits) to promote. */
  miThreshold: 0.05,
  /** Minimum total observations before a promotion is even considered. */
  minSamples: 5,
  /** Minimum present-successes (a) — a learning with zero observed successes never promotes. */
  minPresentSuccesses: 1,
} as const;

/**
 * Merge two contingency tables (e.g. a new candidate into a persisted record).
 */
export function mergeContingency(a: ContingencyTable, b: ContingencyTable): ContingencyTable {
  return { a: a.a + b.a, b: a.b + b.b, c: a.c + b.c, d: a.d + b.d };
}

/**
 * Mutual information I(learning; success) in bits, from the 2×2 table.
 *
 *   a = present   & success
 *   b = present   & failure
 *   c = absent    & success
 *   d = absent    & failure
 *
 * I = Σ_{l,s} P(l,s) · log2( P(l,s) / (P(l)·P(s)) ), with 0·log0 = 0.
 * Returns 0 when the table is empty or has no variation (MI is undefined / 0).
 */
export function mutualInformation(table: ContingencyTable): number {
  const { a, b, c, d } = table;
  const n = a + b + c + d;
  if (n <= 0) return 0;
  // No variation in either variable ⇒ MI = 0.
  if ((a + b) === 0 || (c + d) === 0 || (a + c) === 0 || (b + d) === 0) return 0;

  let mi = 0;
  for (const x of [a, b, c, d]) {
    if (x <= 0) continue;
    const pJoint = x / n;
    const pL = (x === a || x === b) ? (a + b) / n : (c + d) / n;
    const pS = (x === a || x === c) ? (a + c) / n : (b + d) / n;
    mi += pJoint * Math.log2(pJoint / (pL * pS));
  }
  // Guard tiny floating-point noise.
  return Math.max(0, mi);
}

/**
 * Decide whether a learning (with its accumulated contingency table) may be
 * promoted. Pure. Returns a LearningPromotion carrying the measured MI.
 */
export function gateLearning(input: {
  key: string;
  contingency: ContingencyTable;
  threshold?: number;
  minSamples?: number;
  minPresentSuccesses?: number;
}): LearningPromotion & { contingency: ContingencyTable } {
  const threshold = input.threshold ?? DEFAULT_GATE.miThreshold;
  const minSamples = input.minSamples ?? DEFAULT_GATE.minSamples;
  const minPresentSuccesses = input.minPresentSuccesses ?? DEFAULT_GATE.minPresentSuccesses;
  const mi = mutualInformation(input.contingency);
  const { a, b, c, d } = input.contingency;
  const n = a + b + c + d;

  if (n < minSamples) {
    return {
      candidate: { key: input.key, kind: LearningKind.WORKFLOW, source: LearningSource.OUTCOME, value: {}, summary: '', tags: [], contingency: input.contingency, confidence: 0 },
      promoted: false,
      mutualInformation: mi,
      reason: `insufficient samples (${n}/${minSamples})`,
      contingency: input.contingency,
    };
  }
  if (a < minPresentSuccesses) {
    return {
      candidate: { key: input.key, kind: LearningKind.WORKFLOW, source: LearningSource.OUTCOME, value: {}, summary: '', tags: [], contingency: input.contingency, confidence: 0 },
      promoted: false,
      mutualInformation: mi,
      reason: `no observed present-successes (a=${a})`,
      contingency: input.contingency,
    };
  }
  if (mi < threshold) {
    return {
      candidate: { key: input.key, kind: LearningKind.WORKFLOW, source: LearningSource.OUTCOME, value: {}, summary: '', tags: [], contingency: input.contingency, confidence: 0 },
      promoted: false,
      mutualInformation: mi,
      reason: `mutual information ${mi.toFixed(4)} bits below threshold ${threshold}`,
      contingency: input.contingency,
    };
  }
  return {
    candidate: { key: input.key, kind: LearningKind.WORKFLOW, source: LearningSource.OUTCOME, value: {}, summary: '', tags: [], contingency: input.contingency, confidence: 0 },
    promoted: true,
    mutualInformation: mi,
    reason: `promoted: MI=${mi.toFixed(4)} bits over ${n} samples`,
    contingency: input.contingency,
  };
}