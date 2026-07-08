/**
 * meta-optimiser.ts — HyperAgent Phase 10 shared types: bandit-style config arm selection.
 *
 * The meta-optimiser treats each candidate config (a PROMOTED ConfigVersion, a
 * repair strategy, a tool-substitution choice) as a multi-armed bandit arm and
 * selects which arm to run next from outcome history. Reward = a run's success
 * signal; the bandit balances exploitation (arms with high posterior mean) and
 * exploration (under-sampled arms) so a promising-but-lucky arm does not starve
 * a better-but-unlucky one. Honest: with no history every arm is tied and the
 * selector falls back to a deterministic tiebreak, never a fake "best".
 *
 * Pure + deterministic: UCB1 needs no randomness (given the history the score is
 * exact); epsilon-greedy uses a SEEDED PRNG so the same (history, seed) ⇒ the
 * same selection. Cross-tenant reward aggregates are released through the DP
 * mechanism (innovation #8) so a single run's outcome is not recoverable.
 */

/** Which bandit selection strategy the meta-optimiser uses. */
export enum BanditStrategy {
  /** UCB1 — deterministic upper-confidence-bound; no randomness needed. */
  UCB1 = 'UCB1',
  /** ε-greedy — explore a random arm with prob ε, else exploit the best; seeded. */
  EPSILON_GREEDY = 'EPSILON_GREEDY',
}

/** One bandit arm: cumulative reward history for one candidate config. */
export interface BanditArm {
  /** Stable arm id (e.g. the ConfigVersion id, or a strategy key). */
  id: string;
  /** Optional link to the ConfigVersion this arm represents (Phase 9). */
  configVersionId?: string;
  /** Number of times the arm was pulled and the run SUCCEEDED (reward ≈ 1). */
  successes: number;
  /** Number of times the arm was pulled and the run FAILED (reward ≈ 0). */
  failures: number;
  /** ISO timestamp of the last pull (caller-stamped; null if never pulled). */
  lastSelectedAt: string | null;
}

/** The meta-optimiser's selection result (audit: which arm, why, with what score). */
export interface BanditSelection {
  armId: string;
  strategy: BanditStrategy;
  /** The selector score for the chosen arm (UCB score, or the exploited mean). */
  score: number;
  /** Human-readable reason for the choice (audit). */
  reason: string;
  /** True when the selection was an EXPLORATION pull (not the empirical best). */
  exploration: boolean;
}

/** Configuration for the meta-optimiser selection. */
export interface MetaOptimiserConfig {
  strategy: BanditStrategy;
  /** UCB1 exploration constant c (typical 1.414 ≈ sqrt(2)). */
  explorationConstant?: number;
  /** ε-greedy exploration probability in [0,1]. */
  epsilon?: number;
  /** Seed for ε-greedy randomness (deterministic selection). */
  seed?: string;
}

export const DEFAULT_META_OPTIMISER_CONFIG: MetaOptimiserConfig = Object.freeze({
  strategy: BanditStrategy.UCB1,
  explorationConstant: Math.SQRT2,
  epsilon: 0.1,
  seed: 'jak-swarm-meta-optimiser',
});