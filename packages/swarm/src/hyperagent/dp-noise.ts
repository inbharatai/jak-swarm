/**
 * dp-noise.ts — Innovation #8 (HyperAgent Phase 7): differential privacy.
 *
 * When the HyperAgent aggregates outcome metrics ACROSS runs/tenants to learn
 * (e.g. "tool X succeeds 73% of the time"), a single run's outcome must not be
 * recoverable from the published aggregate. The Laplace mechanism adds
 * Laplace(scale = sensitivity / ε) noise calibrated to the privacy budget ε.
 *
 * Pure + deterministic: the PRNG is seeded (xmur3 → mulberry32) so the SAME
 * (values, epsilon, seed) ALWAYS produces the SAME noisy aggregate — auditable
 * and replayable. No Math.random / Date.now (those would break determinism and
 * leak non-determinism into promotion decisions).
 *
 * Honesty: DP is a bound on what an adversary can INFER, not a guarantee of
 * perfect privacy. ε is a budget — smaller ε ⇒ more noise ⇒ more privacy ⇒
 * less utility. The caller owns ε; this module only implements the mechanism
 * correctly and reports the noise it added.
 */

/** xmur3 string hash → uint32 seed (deterministic). */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 PRNG: uint32 seed → () => float in [0,1). Deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a deterministic PRNG keyed by a caller-supplied seed string. */
export function makePrng(seed: string): () => number {
  const seedHash = xmur3(seed);
  return mulberry32(seedHash());
}

/**
 * Sample Laplace(0, scale) via the inverse CDF. Deterministic given the prng.
 * Guards against the degenerate u∈{0,1} that would yield ±Infinity.
 */
export function laplace(scale: number, prng: () => number): number {
  if (scale <= 0 || !Number.isFinite(scale)) return 0;
  const u = Math.min(1 - 1e-12, Math.max(1e-12, prng()));
  return -scale * Math.sign(u - 0.5) * Math.log(1 - 2 * Math.abs(u - 0.5));
}

/** Sensitivity of a sum over bounded contributions (each |value| ≤ sensitivityPerItem). */
export interface DpSumInput {
  values: number[];
  /** Privacy budget — smaller ε ⇒ more noise. */
  epsilon: number;
  /** Max absolute contribution of any single value (L1 sensitivity). */
  sensitivity?: number;
  /** Deterministic seed (e.g. `${tenantId}:${metricName}:${runId}`). */
  seed: string;
}

/**
 * Differentially-private sum: true sum + Laplace(sensitivity / ε). Deterministic.
 * Returns the noisy sum AND the noise added (for audit).
 */
export function dpSum(input: DpSumInput): { value: number; noise: number; trueSum: number } {
  const sensitivity = input.sensitivity ?? 1;
  const trueSum = input.values.reduce((s, v) => s + v, 0);
  const prng = makePrng(input.seed);
  const noise = laplace(sensitivity / input.epsilon, prng);
  return { value: trueSum + noise, noise, trueSum };
}

/**
 * Differentially-private mean over `values`. The count is treated as public
 * (bounded); only the sum is privatised. Deterministic.
 */
export function dpMean(input: Omit<DpSumInput, 'values'> & { values: number[] }): {
  value: number;
  noise: number;
  trueMean: number;
} {
  if (input.values.length === 0) return { value: 0, noise: 0, trueMean: 0 };
  const sum = dpSum(input);
  return {
    value: sum.value / input.values.length,
    noise: sum.noise / input.values.length,
    trueMean: sum.trueSum / input.values.length,
  };
}

/**
 * Privatise a single bounded metric with Laplace(sensitivity / ε) noise. Use
 * when publishing a per-run metric into a cross-tenant learning aggregate.
 *
 * `sensitivity` defaults to 1 (the L1 sensitivity of a single bounded
 * contribution in [0,1] or similar). Callers publishing a DERIVED quantity
 * whose sensitivity is NOT 1 — e.g. a success rate over n pulls, where one run
 * flips the rate by at most 1/n — MUST pass the true sensitivity so the noise
 * scale matches the bound they advertise. Passing the wrong sensitivity here
 * silently under- or over-privatises vs. the audit metadata.
 */
export function privatizeMetric(
  value: number,
  epsilon: number,
  seed: string,
  sensitivity = 1,
): {
  value: number;
  noise: number;
} {
  const prng = makePrng(seed);
  const noise = laplace(sensitivity / epsilon, prng);
  return { value: value + noise, noise };
}

/**
 * Compose the privacy budget across `k` sequential releases under basic
 * composition: total ε = k · ε. The caller uses this to refuse a release that
 * would blow the tenant's epoch budget. Pure.
 */
export function composeBudget(epsilonPerRelease: number, releases: number): number {
  return Math.max(0, epsilonPerRelease * Math.max(0, releases));
}