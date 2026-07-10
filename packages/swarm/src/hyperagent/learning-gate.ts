/**
 * learning-gate.ts — Innovation #2 (HyperAgent Phase 5), Phase 6-hardened.
 *
 * Information-theoretic + DIRECTIONAL + statistically-safe learning gating. A
 * learning is promoted ONLY when ALL of the following hold over the 2×2
 * contingency table of observed runs:
 *
 *   1. enough samples accrued (n ≥ minSamples);
 *   2. at least one present-success observed (a ≥ minPresentSuccesses);
 *   3. mutual information I(learning; success) ≥ miThreshold (the learning
 *      actually moves the success probability — correlation, not plausibility);
 *   4. the association is DIRECTIONAL: the present-success rate exceeds the
 *      absent-success rate by more than `minLift` (lift > minLift). MI is
 *      symmetric — it is just as high for a config that ANTI-correlates with
 *      success (present ⇒ failure) as for one that helps. A high-MI
 *      anti-correlated learning must NEVER govern behaviour, so promotion now
 *      requires the config to be positively associated with success;
 *   5. the lift is statistically safe: the Wilson 95% lower bound on the
 *      present-success rate exceeds the absent-success rate. A lucky small-N
 *      run (e.g. 2/2 present-success vs a 0.375 absent rate) cannot promote —
 *      its lower confidence bound is indistinguishable from the absent baseline.
 *
 * This replaces "the LLM said this is better" with a MEASURED, DIRECTIONAL,
 * statistically-significant association: a learning that doesn't provably move
 * the success probability in the right direction cannot govern behaviour, no
 * matter how plausible its summary sounds or how high its MI reads.
 *
 * Pure + deterministic — no I/O, no LLM, no Date.now, fully unit-testable.
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
  /** Phase 6: minimum directional lift (present-success rate − absent-success rate). */
  minLift: 0.1,
  /** Phase 6: Wilson lower-bound z (1.96 ⇒ 95% confidence). */
  wilsonConfidenceZ: 1.96,
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
 *
 * Phase 6 fix: each cell's marginals are now taken POSITIONALLY (the cell's
 * role: present/absent × success/failure), not by VALUE equality. The prior
 * loop keyed `pL`/`pS` off `x === a` etc., which selected the WRONG marginal
 * whenever two cells happened to share a count (e.g. c === d) but had different
 * row/column roles — silently corrupting MI. The positional computation below
 * matches the textbook 2×2 formula and is invariant to shared cell values.
 */
export function mutualInformation(table: ContingencyTable): number {
  const { a, b, c, d } = table;
  const n = a + b + c + d;
  if (n <= 0) return 0;
  const present = a + b;
  const absent = c + d;
  const success = a + c;
  const failure = b + d;
  // No variation in either variable ⇒ MI = 0.
  if (present === 0 || absent === 0 || success === 0 || failure === 0) return 0;

  // Each cell: (count, row-marginal pL, col-marginal pS) — positional, never
  // by value equality. Contribution = pJoint · log2(pJoint / (pL·pS)), 0 if count 0.
  const cells: ReadonlyArray<{ x: number; row: number; col: number }> = [
    { x: a, row: present, col: success }, // present   & success
    { x: b, row: present, col: failure }, // present   & failure
    { x: c, row: absent, col: success }, // absent    & success
    { x: d, row: absent, col: failure }, // absent    & failure
  ];

  let mi = 0;
  for (const { x, row, col } of cells) {
    if (x <= 0) continue;
    const pJoint = x / n;
    const pL = row / n;
    const pS = col / n;
    mi += pJoint * Math.log2(pJoint / (pL * pS));
  }
  // Guard tiny floating-point noise.
  return Math.max(0, mi);
}

// ─── Phase 6: directional + statistical-safety helpers ──────────────────────

/** Present-success rate a/(a+b) — 0 when there are no present observations. */
export function presentSuccessRate(table: ContingencyTable): number {
  const present = table.a + table.b;
  return present > 0 ? table.a / present : 0;
}

/** Absent-success rate c/(c+d) — 0 when there are no absent observations. */
export function absentSuccessRate(table: ContingencyTable): number {
  const absent = table.c + table.d;
  return absent > 0 ? table.c / absent : 0;
}

/** Directional lift = present-success rate − absent-success rate. Can be negative. */
export function directionalLift(table: ContingencyTable): number {
  return presentSuccessRate(table) - absentSuccessRate(table);
}

/**
 * Wilson score interval LOWER bound for a binomial success rate. Returns 0 for
 * zero trials. Pure. Used so a lucky small-N run (e.g. 2/2) cannot promote —
 * its lower confidence bound must clear the absent baseline by a real margin.
 */
export function wilsonLowerBound(
  successes: number,
  trials: number,
  z: number = DEFAULT_GATE.wilsonConfidenceZ,
): number {
  if (trials <= 0) return 0;
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return Math.max(0, (center - margin) / denom);
}

/**
 * Decide whether a learning (with its accumulated contingency table) may be
 * promoted. Pure. Returns a LearningPromotion carrying the measured MI.
 *
 * Checks in order: min samples → present-successes → MI threshold → directional
 * lift → Wilson statistical safety. The first failure short-circuits with a
 * human-readable reason; the measured MI is always surfaced.
 */
export function gateLearning(input: {
  key: string;
  contingency: ContingencyTable;
  threshold?: number;
  minSamples?: number;
  minPresentSuccesses?: number;
  /** Phase 6: directional lift required (default DEFAULT_GATE.minLift). */
  minLift?: number;
  /** Phase 6: Wilson lower-bound z (default DEFAULT_GATE.wilsonConfidenceZ). */
  wilsonConfidenceZ?: number;
}): LearningPromotion & { contingency: ContingencyTable } {
  const threshold = input.threshold ?? DEFAULT_GATE.miThreshold;
  const minSamples = input.minSamples ?? DEFAULT_GATE.minSamples;
  const minPresentSuccesses = input.minPresentSuccesses ?? DEFAULT_GATE.minPresentSuccesses;
  const minLift = input.minLift ?? DEFAULT_GATE.minLift;
  const z = input.wilsonConfidenceZ ?? DEFAULT_GATE.wilsonConfidenceZ;
  const mi = mutualInformation(input.contingency);
  const { a, b, c, d } = input.contingency;
  const n = a + b + c + d;

  const candidate = {
    key: input.key,
    kind: LearningKind.WORKFLOW,
    source: LearningSource.OUTCOME,
    value: {},
    summary: '',
    tags: [],
    contingency: input.contingency,
    confidence: 0,
  };

  if (n < minSamples) {
    return { candidate, promoted: false, mutualInformation: mi, reason: `insufficient samples (${n}/${minSamples})`, contingency: input.contingency };
  }
  if (a < minPresentSuccesses) {
    return { candidate, promoted: false, mutualInformation: mi, reason: `no observed present-successes (a=${a})`, contingency: input.contingency };
  }
  if (mi < threshold) {
    return { candidate, promoted: false, mutualInformation: mi, reason: `mutual information ${mi.toFixed(4)} bits below threshold ${threshold}`, contingency: input.contingency };
  }

  // Phase 6: direction. MI is symmetric — equally high for a config that
  // ANTI-correlates with success. Require the present-success rate to exceed
  // the absent-success rate by more than minLift (positive direction).
  const lift = directionalLift(input.contingency);
  const pPresent = presentSuccessRate(input.contingency);
  const pAbsent = absentSuccessRate(input.contingency);
  if (lift <= minLift) {
    return {
      candidate,
      promoted: false,
      mutualInformation: mi,
      reason: `non-directional: present success rate ${pPresent.toFixed(3)} is not higher than absent ${pAbsent.toFixed(3)} by more than minLift ${minLift} (lift ${lift.toFixed(3)})`,
      contingency: input.contingency,
    };
  }

  // Phase 6: statistical safety. The Wilson 95% lower bound on the
  // present-success rate must clear the absent-success rate — otherwise the
  // observed lift is indistinguishable from chance at this sample size (a
  // lucky small-N run cannot promote).
  const presentTrials = a + b;
  const wilsonLower = wilsonLowerBound(a, presentTrials, z);
  if (wilsonLower <= pAbsent) {
    return {
      candidate,
      promoted: false,
      mutualInformation: mi,
      reason: `statistically indistinguishable: Wilson 95% lower bound ${wilsonLower.toFixed(3)} on present-success rate does not exceed absent rate ${pAbsent.toFixed(3)} (small-N lift not yet significant)`,
      contingency: input.contingency,
    };
  }

  return {
    candidate,
    promoted: true,
    mutualInformation: mi,
    reason: `promoted: MI=${mi.toFixed(4)} bits, lift=${lift.toFixed(3)} (pPresent ${pPresent.toFixed(3)} > pAbsent ${pAbsent.toFixed(3)}), Wilson lower ${wilsonLower.toFixed(3)} > ${pAbsent.toFixed(3)}, over ${n} samples`,
    contingency: input.contingency,
  };
}