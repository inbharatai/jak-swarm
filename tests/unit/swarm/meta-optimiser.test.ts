/**
 * meta-optimiser.test.ts — HyperAgent Phase 10 bandit-style config arm selection.
 *
 * Pins the bandit invariants:
 *   - UCB1 plays every unplayed arm first (+∞ score), then balances mean +
 *     confidence; deterministic given the history;
 *   - ε-greedy explores with prob ε (seeded ⇒ deterministic), else exploits the
 *     empirical best; deterministic tiebreak = lowest id;
 *   - updateArmWithReward accrues successes/failures; armMean/ posteriorMean /
 *     rankArms are pure;
 *   - privatizeArmSuccessRate adds DP noise (innovation #8) deterministically;
 *   - armsFromHistory + metaOptimise build arms from outcome history and select;
 *   - honest: empty-ish history ⇒ deterministic tiebreak, never a fake "best".
 */
import { describe, it, expect } from 'vitest';
import { BanditStrategy } from '../../../packages/shared/src/index.js';
import type { BanditArm, MetaOptimiserConfig } from '../../../packages/shared/src/index.js';
import {
  MetaOptimiserError,
  createArm,
  armPulls,
  armMean,
  armPosteriorMean,
  ucb1Score,
  totalPulls,
  bestArm,
  selectUcb1,
  selectEpsilonGreedy,
  selectArm,
  updateArmWithReward,
  rankArms,
  privatizeArmSuccessRate,
  armsFromHistory,
  metaOptimise,
} from '../../../packages/swarm/src/hyperagent/meta-optimiser.js';
import { laplace, makePrng } from '../../../packages/swarm/src/hyperagent/dp-noise.js';

const NOW = '2026-07-08T12:00:00.000Z';

function arm(id: string, s: number, f: number): BanditArm {
  return { id, successes: s, failures: f, lastSelectedAt: s + f > 0 ? NOW : null };
}

describe('arm primitives', () => {
  it('createArm starts with no pulls + 0.5 prior mean', () => {
    const a = createArm('a');
    expect(armPulls(a)).toBe(0);
    expect(armMean(a)).toBe(0.5);
    expect(armPosteriorMean(a)).toBe(0.5); // Beta(1,1)
  });

  it('armMean + posteriorMean reflect history', () => {
    const a = arm('a', 7, 3);
    expect(armPulls(a)).toBe(10);
    expect(armMean(a)).toBeCloseTo(0.7, 10);
    expect(armPosteriorMean(a)).toBeCloseTo(8 / 12, 10); // Beta(8,4) ⇒ 8/12
  });

  it('updateArmWithReward accrues success / failure immutably', () => {
    const a = createArm('a');
    const afterWin = updateArmWithReward(a, 0.9, NOW);
    const afterLoss = updateArmWithReward(afterWin, 0.1, NOW);
    expect(afterLoss.successes).toBe(1);
    expect(afterLoss.failures).toBe(1);
    expect(afterLoss.lastSelectedAt).toBe(NOW);
    expect(a.successes).toBe(0); // immutable
  });
});

describe('ucb1Score', () => {
  it('is +∞ for an unplayed arm', () => {
    expect(ucb1Score(createArm('a'), 0)).toBe(Number.POSITIVE_INFINITY);
    expect(ucb1Score(createArm('a'), 100)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is +∞ for all arms when totalPulls is 0', () => {
    expect(ucb1Score(arm('a', 1, 1), 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('grows with under-sampling (confidence width)', () => {
    const many = arm('a', 90, 10); // mean 0.9, n=100
    const few = arm('b', 9, 1); // mean 0.9, n=10
    const pulls = 110;
    // Same mean; the under-sampled arm has a larger UCB bonus.
    expect(ucb1Score(few, pulls)).toBeGreaterThan(ucb1Score(many, pulls));
  });
});

describe('selectUcb1 — deterministic + explore-first', () => {
  it('plays every unplayed arm first (lowest id tiebreak among +∞)', () => {
    const arms = [arm('b', 0, 0), arm('a', 0, 0), arm('c', 0, 0)];
    const sel = selectUcb1(arms);
    expect(sel.armId).toBe('a'); // lowest id among +∞ scores
    expect(sel.exploration).toBe(true);
  });

  it('after all arms played once, balances mean + bonus (deterministic)', () => {
    const arms = [arm('a', 1, 0), arm('b', 0, 1), arm('c', 0, 0)]; // c unplayed
    const sel = selectUcb1(arms, totalPulls(arms));
    expect(sel.armId).toBe('c'); // unplayed first
    expect(sel.exploration).toBe(true);
  });

  it('is deterministic: same history ⇒ same selection', () => {
    const arms = [arm('a', 5, 5), arm('b', 7, 3), arm('c', 6, 4)];
    const s1 = selectUcb1(arms, totalPulls(arms));
    const s2 = selectUcb1(arms, totalPulls(arms));
    expect(s1).toEqual(s2);
  });

  it('throws with no arms', () => {
    expect(() => selectUcb1([])).toThrow(MetaOptimiserError);
  });
});

describe('bestArm + rankArms — deterministic tiebreak', () => {
  it('bestArm picks the highest mean, lowest id on ties', () => {
    const arms = [arm('b', 8, 2), arm('a', 8, 2), arm('c', 1, 9)];
    expect(bestArm(arms).id).toBe('a');
  });

  it('rankArms sorts by posterior mean desc, lowest id on ties', () => {
    const arms = [arm('c', 1, 9), arm('a', 9, 1), arm('b', 9, 1)];
    const ranked = rankArms(arms).map((a) => a.id);
    expect(ranked).toEqual(['a', 'b', 'c']); // a<b tie at top, c last
  });
});

describe('selectEpsilonGreedy — seeded determinism', () => {
  it('is deterministic for a fixed seed + history', () => {
    const arms = [arm('a', 1, 1), arm('b', 5, 5), arm('c', 9, 1)];
    const s1 = selectEpsilonGreedy(arms, 0.5, 'seed-1');
    const s2 = selectEpsilonGreedy(arms, 0.5, 'seed-1');
    expect(s1).toEqual(s2);
  });

  it('exploits the best arm when ε=0 (no exploration)', () => {
    const arms = [arm('a', 1, 9), arm('b', 9, 1)];
    const sel = selectEpsilonGreedy(arms, 0, 'any');
    expect(sel.armId).toBe('b');
    expect(sel.exploration).toBe(false);
  });

  it('always explores when ε=1', () => {
    const arms = [arm('a', 1, 9), arm('b', 9, 1), arm('c', 5, 5)];
    const sel = selectEpsilonGreedy(arms, 1, 'explore-seed');
    expect(sel.exploration).toBe(true);
  });

  it('different seeds can select different arms (coverage of randomness)', () => {
    const arms = [arm('a', 1, 9), arm('b', 9, 1)];
    const picks = new Set<string>();
    for (let i = 0; i < 50; i++) {
      picks.add(selectEpsilonGreedy(arms, 1, `seed-${i}`).armId);
    }
    // With ε=1 over 50 distinct seeds, both arms should be picked at least once.
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe('selectArm — strategy dispatch', () => {
  it('dispatches to UCB1 by default', () => {
    const arms = [arm('a', 0, 0), arm('b', 0, 0)];
    const sel = selectArm(arms);
    expect(sel.strategy).toBe(BanditStrategy.UCB1);
    expect(sel.armId).toBe('a');
  });

  it('dispatches to ε-greedy when configured', () => {
    const arms = [arm('a', 1, 9), arm('b', 9, 1)];
    const cfg: MetaOptimiserConfig = { strategy: BanditStrategy.EPSILON_GREEDY, epsilon: 0, seed: 'x' };
    const sel = selectArm(arms, cfg);
    expect(sel.strategy).toBe(BanditStrategy.EPSILON_GREEDY);
    expect(sel.armId).toBe('b');
  });
});

describe('privatizeArmSuccessRate — DP noise (innovation #8)', () => {
  it('is deterministic for a fixed seed + arm', () => {
    const a = arm('a', 7, 3);
    const r1 = privatizeArmSuccessRate(a, 1.0, 'seed-1');
    const r2 = privatizeArmSuccessRate(a, 1.0, 'seed-1');
    expect(r1.value).toBe(r2.value);
    expect(r1.trueRate).toBeCloseTo(armPosteriorMean(a), 10);
  });

  it('reports the true rate + the noise added + the sensitivity', () => {
    const a = arm('a', 9, 1); // n=10 ⇒ sensitivity 0.1
    const r = privatizeArmSuccessRate(a, 1.0, 'seed-1');
    expect(r.trueRate).toBeCloseTo(10 / 12, 2); // Beta(10,2) ⇒ 0.8333
    expect(r.sensitivity).toBeCloseTo(0.1, 10);
    expect(typeof r.noise).toBe('number');
    expect(r.value).toBeCloseTo(r.trueRate + r.noise, 10);
  });

  it('noise scale MATCHES the reported sensitivity (1/n), not hardcoded 1 — Bug 8', () => {
    // Before the fix, privatizeArmSuccessRate reported sensitivity=1/n but
    // privatizeMetric hardcoded Laplace(1/ε) (sensitivity 1), so the published
    // rate was n× over-privatised while the audit field claimed 1/n. Assert the
    // released noise equals an independent laplace((1/n)/ε, seed) and NOT
    // laplace(1/ε, seed).
    const a = arm('a', 9, 1); // n=10 ⇒ sensitivity 0.1
    const epsilon = 1.0;
    const seed = 'seed-1';
    const r = privatizeArmSuccessRate(a, epsilon, seed);
    const n = armPulls(a);
    const sens = 1 / n;
    const expected = laplace(sens / epsilon, makePrng(`${seed}:${a.id}`));
    expect(r.noise).toBeCloseTo(expected, 10);
    // The buggy hardcoded-sensitivity-1 noise would have a different scale.
    const buggy = laplace(1 / epsilon, makePrng(`${seed}:${a.id}`));
    expect(r.noise).not.toBeCloseTo(buggy, 6);
  });
});

describe('armsFromHistory + metaOptimise', () => {
  it('builds arms from a reward history, one pull per entry', () => {
    const history = [
      { armId: 'a', reward: 1 },
      { armId: 'a', reward: 0 },
      { armId: 'b', reward: 1 },
      { armId: 'b', reward: 1 },
    ];
    const arms = armsFromHistory(history, NOW);
    const byId = new Map(arms.map((a) => [a.id, a]));
    expect(byId.get('a')?.successes).toBe(1);
    expect(byId.get('a')?.failures).toBe(1);
    expect(byId.get('b')?.successes).toBe(2);
    expect(byId.get('b')?.lastSelectedAt).toBe(NOW);
  });

  it('metaOptimise selects the best-under-UCB1 arm from history', () => {
    // b clearly better (9/10) than a (1/10), both played ⇒ UCB1 exploits b.
    const history = [
      ...Array.from({ length: 10 }, () => ({ armId: 'a', reward: 0.1 })),
      ...Array.from({ length: 10 }, () => ({ armId: 'b', reward: 0.9 })),
    ];
    const { arms, selection } = metaOptimise(history, { strategy: BanditStrategy.UCB1 });
    expect(arms).toHaveLength(2);
    expect(selection.armId).toBe('b');
  });

  it('metaOptimise is honest with no history signal — deterministic tiebreak', () => {
    // One pull each, all ties ⇒ UCB1 picks lowest id, never a fake "best".
    const history = [{ armId: 'z', reward: 0.5 }, { armId: 'a', reward: 0.5 }];
    const { selection } = metaOptimise(history, { strategy: BanditStrategy.UCB1 });
    expect(selection.armId).toBe('a');
  });

  it('throws with empty history', () => {
    expect(() => metaOptimise([])).toThrow(MetaOptimiserError);
  });
});