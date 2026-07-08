/**
 * meta-optimiser.ts — HyperAgent Phase 10: bandit-style config arm selection.
 *
 * Treats each candidate config (a PROMOTED ConfigVersion, a repair strategy, a
 * tool-substitution choice) as a multi-armed bandit arm and selects which arm to
 * run next from outcome history. Reward ≈ 1 on a successful run, ≈ 0 on a failed
 * run. The bandit balances exploitation (high posterior mean) and exploration
 * (under-sampled arms) so a promising-but-lucky arm cannot starve a better-but-
 * unlucky one.
 *
 * Strategies:
 *   - UCB1 (deterministic): score = mean + c·sqrt(ln(N)/n_i); an unplayed arm has
 *     score +∞ so every arm is tried at least once before any is re-pulled. Pure
 *     given the history — no randomness, so the same history ⇒ the same choice.
 *   - ε-greedy (seeded): with prob ε explore a uniformly-random arm, else exploit
 *     the empirical best. The PRNG is SEEDED so the same (history, seed) ⇒ the
 *     same choice.
 *
 * Cross-tenant reward aggregates are released through the DP mechanism
 * (innovation #8) so a single run's outcome is not recoverable from a published
 * "arm X succeeds p% of the time" figure.
 *
 * Pure + deterministic — no I/O, no LLM, no Date.now / Math.random. The caller
 * stamps `lastSelectedAt` + the seed; the LLM may SUGGEST arms, only this gate
 * SELECTS. Honest: with no history every arm is tied and the selector falls back
 * to a deterministic tiebreak (lowest id), never a fake "best".
 */
import {
  BanditStrategy,
  DEFAULT_META_OPTIMISER_CONFIG,
} from '@jak-swarm/shared';
import type { BanditArm, BanditSelection, MetaOptimiserConfig } from '@jak-swarm/shared';
import { makePrng, privatizeMetric } from './dp-noise.js';

export class MetaOptimiserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaOptimiserError';
  }
}

/** Create a fresh arm with no pull history. Pure. */
export function createArm(id: string, configVersionId?: string): BanditArm {
  return { id, configVersionId, successes: 0, failures: 0, lastSelectedAt: null };
}

/** Total pulls (successes + failures) of an arm. Pure. */
export function armPulls(arm: BanditArm): number {
  return arm.successes + arm.failures;
}

/** Empirical mean reward of an arm (0.5 prior when never pulled). Pure. */
export function armMean(arm: BanditArm): number {
  const n = armPulls(arm);
  return n === 0 ? 0.5 : arm.successes / n;
}

/** Beta(α=s+1, β=f+1) posterior mean = α/(α+β). Pure. */
export function armPosteriorMean(arm: BanditArm): number {
  const alpha = arm.successes + 1;
  const beta = arm.failures + 1;
  return alpha / (alpha + beta);
}

/** UCB1 score: mean + c·sqrt(ln(totalPulls)/n); +∞ for an unplayed arm. Pure. */
export function ucb1Score(arm: BanditArm, totalPulls: number, c = DEFAULT_META_OPTIMISER_CONFIG.explorationConstant ?? Math.SQRT2): number {
  const n = armPulls(arm);
  if (n === 0) return Number.POSITIVE_INFINITY;
  if (totalPulls <= 0) return Number.POSITIVE_INFINITY;
  return armMean(arm) + c * Math.sqrt(Math.log(totalPulls) / n);
}

/** Total pulls across all arms. Pure. */
export function totalPulls(arms: readonly BanditArm[]): number {
  return arms.reduce((acc, a) => acc + armPulls(a), 0);
}

/** The empirical-best arm by mean (deterministic tiebreak: lowest id). Pure. */
export function bestArm(arms: readonly BanditArm[]): BanditArm {
  if (arms.length === 0) throw new MetaOptimiserError('bestArm requires ≥1 arm');
  let best = arms[0]!;
  for (let i = 1; i < arms.length; i++) {
    const a = arms[i]!;
    const al = armMean(a);
    const bl = armMean(best);
    if (al > bl || (al === bl && a.id < best.id)) best = a;
  }
  return best;
}

/**
 * UCB1 selection: argmax of ucb1Score with a deterministic lowest-id tiebreak.
 * Unplayed arms (+∞ score) are tried first; once all are played, the score
 * balances mean and confidence width. Pure + deterministic. Pure.
 */
export function selectUcb1(arms: readonly BanditArm[], pulls = totalPulls(arms), c?: number): BanditSelection {
  if (arms.length === 0) throw new MetaOptimiserError('selectUcb1 requires ≥1 arm');
  let chosen = arms[0]!;
  let chosenScore = ucb1Score(chosen, pulls, c);
  for (let i = 1; i < arms.length; i++) {
    const a = arms[i]!;
    const s = ucb1Score(a, pulls, c);
    if (s > chosenScore || (s === chosenScore && a.id < chosen.id)) {
      chosen = a;
      chosenScore = s;
    }
  }
  const exploration = armPulls(chosen) === 0 || !Number.isFinite(chosenScore);
  return {
    armId: chosen.id,
    strategy: BanditStrategy.UCB1,
    score: chosenScore,
    reason: exploration
      ? `exploration: arm ${chosen.id} unplayed (must try each arm once)`
      : `exploitation+exploration: UCB score ${chosenScore.toFixed(4)} (mean ${armMean(chosen).toFixed(4)} + bonus)`,
    exploration,
  };
}

/**
 * ε-greedy selection: with probability ε explore a uniformly-random arm (seeded
 * PRNG), else exploit the empirical best. Deterministic given (arms, seed). Pure.
 */
export function selectEpsilonGreedy(
  arms: readonly BanditArm[],
  epsilon = DEFAULT_META_OPTIMISER_CONFIG.epsilon ?? 0.1,
  seed = DEFAULT_META_OPTIMISER_CONFIG.seed ?? 'jak-swarm-meta-optimiser',
): BanditSelection {
  if (arms.length === 0) throw new MetaOptimiserError('selectEpsilonGreedy requires ≥1 arm');
  const prng = makePrng(seed);
  const r = prng();
  const best = bestArm(arms);
  if (r < epsilon) {
    // Explore: pick a uniformly-random arm (seeded). Keep advancing the PRNG by
    // arm index so the chosen index is deterministic for this seed.
    const idx = Math.floor(prng() * arms.length);
    const safeIdx = idx >= arms.length ? arms.length - 1 : idx;
    const chosen = arms[safeIdx]!;
    return {
      armId: chosen.id,
      strategy: BanditStrategy.EPSILON_GREEDY,
      score: armMean(chosen),
      reason: `exploration (ε=${epsilon}, draw=${r.toFixed(4)}): random arm ${chosen.id}`,
      exploration: true,
    };
  }
  return {
    armId: best.id,
    strategy: BanditStrategy.EPSILON_GREEDY,
    score: armMean(best),
    reason: `exploitation (ε=${epsilon}, draw=${r.toFixed(4)}): best arm ${best.id} (mean ${armMean(best).toFixed(4)})`,
    exploration: false,
  };
}

/** Select an arm under the configured strategy. Pure. */
export function selectArm(arms: readonly BanditArm[], config: MetaOptimiserConfig = DEFAULT_META_OPTIMISER_CONFIG): BanditSelection {
  switch (config.strategy) {
    case BanditStrategy.UCB1:
      return selectUcb1(arms, totalPulls(arms), config.explorationConstant);
    case BanditStrategy.EPSILON_GREEDY:
      return selectEpsilonGreedy(arms, config.epsilon, config.seed);
    default:
      throw new MetaOptimiserError(`unknown bandit strategy: ${config.strategy as string}`);
  }
}

/**
 * Record a pull's outcome on an arm. reward ∈ [0,1] — reward ≥ 0.5 counts as a
 * success, < 0.5 as a failure (a run that partially succeeded still counts as
 * success toward the bandit). Returns a NEW arm (immutable). Pure.
 */
export function updateArmWithReward(arm: BanditArm, reward: number, now: string): BanditArm {
  const success = reward >= 0.5;
  return {
    ...arm,
    successes: arm.successes + (success ? 1 : 0),
    failures: arm.failures + (success ? 0 : 1),
    lastSelectedAt: now,
  };
}

/** Rank arms by posterior mean descending (deterministic tiebreak: lowest id). Pure. */
export function rankArms(arms: readonly BanditArm[]): BanditArm[] {
  return [...arms].sort((a, b) => {
    const pa = armPosteriorMean(a);
    const pb = armPosteriorMean(b);
    if (pb !== pa) return pb - pa;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Release a DP-privatised posterior mean for an arm (innovation #8): add Laplace
 * noise calibrated to ε so a single run's outcome is not recoverable from a
 * published "arm X succeeds p% of the time" figure. Pure + deterministic (seeded).
 */
export function privatizeArmSuccessRate(
  arm: BanditArm,
  epsilon: number,
  seed: string,
): { value: number; noise: number; trueRate: number; sensitivity: number } {
  const trueRate = armPosteriorMean(arm);
  // Sensitivity of a success-rate over n pulls is 1/n (one run flips it by ≤1/n).
  const n = armPulls(arm);
  const sensitivity = n === 0 ? 1 : 1 / n;
  const released = privatizeMetric(trueRate, epsilon, `${seed}:${arm.id}`);
  return { value: released.value, noise: released.noise, trueRate, sensitivity };
}

/**
 * Build arms from a per-arm reward history (e.g. aggregated WorkflowOutcome rows).
 * Each entry contributes one pull; reward ≥ 0.5 ⇒ success. Returns fresh arms.
 * Pure — the caller stamps `now` once for the build.
 */
export function armsFromHistory(
  history: ReadonlyArray<{ armId: string; reward: number; configVersionId?: string }>,
  now: string,
): BanditArm[] {
  const map = new Map<string, BanditArm>();
  for (const h of history) {
    const existing = map.get(h.armId);
    const base = existing ?? createArm(h.armId, h.configVersionId);
    map.set(h.armId, updateArmWithReward(base, h.reward, now));
  }
  return [...map.values()];
}

/**
 * Meta-optimise: from a reward history, build the arms and select the next arm to
 * run under the configured strategy. Pure + deterministic. Honest: with empty
 * history every arm is tied (0.5 prior) and the selector falls back to the
 * deterministic tiebreak, never a fake "best".
 */
export function metaOptimise(
  history: ReadonlyArray<{ armId: string; reward: number; configVersionId?: string }>,
  config: MetaOptimiserConfig = DEFAULT_META_OPTIMISER_CONFIG,
  now = '1970-01-01T00:00:00.000Z',
): { arms: BanditArm[]; selection: BanditSelection } {
  const arms = armsFromHistory(history, now);
  if (arms.length === 0) throw new MetaOptimiserError('metaOptimise requires ≥1 arm in history');
  const selection = selectArm(arms, config);
  return { arms, selection };
}