/**
 * evidence-accrual.test.ts — HyperAgent Phase 5 innovation #5 (Bayesian accrual).
 *
 * Pins the spec §13 Phase 5 invariants:
 *   - priors are copied to posteriors at cluster creation (observations=0);
 *   - observe() multiplies each named hypothesis' posterior by its likelihood
 *     (Bayesian update) and increments its observation count; unnamed hypotheses
 *     keep their posterior;
 *   - normalised posteriors sum to 1, with a uniform fallback when all zeroed;
 *   - forkOnContradiction spawns a genuine competitor (leftover mass as prior)
 *     only when the leader's normalised posterior has eroded below the fork
 *     threshold, and never on a resolved cluster;
 *   - collapseWinner resolves the cluster when one normalised posterior reaches
 *     the collapse threshold, recording the winner.
 */
import { describe, it, expect } from 'vitest';
import {
  createCluster,
  observe,
  normalizedPosteriors,
  forkOnContradiction,
  collapseWinner,
  leader,
  DEFAULT_COLLAPSE_THRESHOLD,
  DEFAULT_FORK_THRESHOLD,
} from '../../../packages/swarm/src/hyperagent/evidence-accrual.js';

const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-02T00:00:00.000Z';

describe('createCluster', () => {
  it('copies priors to posteriors and zeroes observation counts', () => {
    const c = createCluster({
      id: 'c1',
      tenantId: 't1',
      question: 'which agent grounds best?',
      hypotheses: [
        { id: 'H1', claim: 'research', prior: 0.6 },
        { id: 'H2', claim: 'browser', prior: 0.4 },
      ],
      now: NOW,
    });
    expect(c.hypotheses).toHaveLength(2);
    expect(c.hypotheses[0].posterior).toBe(0.6);
    expect(c.hypotheses[0].observations).toBe(0);
    expect(c.resolved).toBe(false);
    expect(c.winnerId).toBeUndefined();
    expect(c.createdAt).toBe(NOW);
  });
});

describe('observe (Bayesian update)', () => {
  it('multiplies named posteriors by their likelihood and bumps observations', () => {
    const c0 = createCluster({
      id: 'c1', tenantId: 't1', question: 'q',
      hypotheses: [{ id: 'H1', claim: 'a', prior: 0.6 }, { id: 'H2', claim: 'b', prior: 0.4 }],
      now: NOW,
    });
    const c1 = observe(c0, { H1: 0.9, H2: 0.1 }, LATER);
    expect(c1.hypotheses[0].posterior).toBeCloseTo(0.54, 10); // 0.6 * 0.9
    expect(c1.hypotheses[1].posterior).toBeCloseTo(0.04, 10); // 0.4 * 0.1
    expect(c1.hypotheses[0].observations).toBe(1);
    expect(c1.hypotheses[1].observations).toBe(1);
    expect(c1.updatedAt).toBe(LATER);
    // Pure — original untouched.
    expect(c0.hypotheses[0].posterior).toBe(0.6);
  });

  it('leaves unnamed hypotheses unchanged', () => {
    const c0 = createCluster({
      id: 'c1', tenantId: 't1', question: 'q',
      hypotheses: [{ id: 'H1', claim: 'a', prior: 0.5 }, { id: 'H2', claim: 'b', prior: 0.5 }],
      now: NOW,
    });
    const c1 = observe(c0, { H1: 0.8 }, LATER);
    expect(c1.hypotheses[0].posterior).toBeCloseTo(0.4, 10);
    expect(c1.hypotheses[1].posterior).toBe(0.5); // unchanged
    expect(c1.hypotheses[1].observations).toBe(0);
  });
});

describe('normalizedPosteriors', () => {
  it('normalises so the masses sum to 1', () => {
    const norms = normalizedPosteriors([
      { id: 'H1', claim: 'a', prior: 0.6, posterior: 0.54, observations: 1, lastUpdatedAt: NOW },
      { id: 'H2', claim: 'b', prior: 0.4, posterior: 0.04, observations: 1, lastUpdatedAt: NOW },
    ]);
    expect(norms.H1 + norms.H2).toBeCloseTo(1, 10);
    expect(norms.H1).toBeCloseTo(0.9310, 3); // 0.54 / 0.58
  });

  it('falls back to a uniform distribution when all posteriors are zero', () => {
    const norms = normalizedPosteriors([
      { id: 'H1', claim: 'a', prior: 0.5, posterior: 0, observations: 0, lastUpdatedAt: NOW },
      { id: 'H2', claim: 'b', prior: 0.5, posterior: 0, observations: 0, lastUpdatedAt: NOW },
    ]);
    expect(norms.H1).toBe(0.5);
    expect(norms.H2).toBe(0.5);
  });
});

describe('collapseWinner', () => {
  it('resolves the cluster when a posterior reaches the collapse threshold', () => {
    let c = createCluster({
      id: 'c1', tenantId: 't1', question: 'q',
      hypotheses: [{ id: 'H1', claim: 'a', prior: 0.6 }, { id: 'H2', claim: 'b', prior: 0.4 }],
      now: NOW,
    });
    // Two strongly-H1 observations drive H1's normalised posterior past 0.95.
    c = observe(c, { H1: 0.9, H2: 0.1 }, LATER);
    c = observe(c, { H1: 0.9, H2: 0.1 }, LATER);
    // 0.486 vs 0.004 ⇒ H1 ≈ 0.9918.
    const collapsed = collapseWinner(c);
    expect(collapsed.resolved).toBe(true);
    expect(collapsed.winnerId).toBe('H1');
  });

  it('does NOT resolve when no posterior has reached the threshold', () => {
    const c = createCluster({
      id: 'c1', tenantId: 't1', question: 'q',
      hypotheses: [{ id: 'H1', claim: 'a', prior: 0.5 }, { id: 'H2', claim: 'b', prior: 0.5 }],
      now: NOW,
    });
    expect(collapseWinner(c).resolved).toBe(false);
  });

  it('is idempotent on an already-resolved cluster', () => {
    const resolved = { id: 'c', tenantId: 't', question: 'q', hypotheses: [], resolved: true, winnerId: 'H1', createdAt: NOW, updatedAt: NOW };
    expect(collapseWinner(resolved)).toBe(resolved);
  });

  it('exposes the documented default collapse threshold', () => {
    expect(DEFAULT_COLLAPSE_THRESHOLD).toBe(0.95);
  });
});

describe('forkOnContradiction', () => {
  it('does NOT fork when the leader is still strong', () => {
    const c = createCluster({
      id: 'c1', tenantId: 't1', question: 'q',
      hypotheses: [{ id: 'H1', claim: 'a', prior: 0.6 }, { id: 'H2', claim: 'b', prior: 0.4 }],
      now: NOW,
    });
    const forked = forkOnContradiction(c, { id: 'H3', claim: 'c' }, LATER);
    expect(forked.hypotheses).toHaveLength(2);
  });

  it('forks a genuine competitor when the leader has eroded below the fork threshold', () => {
    // Three hypotheses spread so the leader's normalised posterior < 0.4.
    const c = createCluster({
      id: 'c1', tenantId: 't1', question: 'q',
      hypotheses: [
        { id: 'H1', claim: 'a', prior: 0.34 },
        { id: 'H2', claim: 'b', prior: 0.33 },
        { id: 'H3', claim: 'c', prior: 0.33 },
      ],
      now: NOW,
    });
    const forked = forkOnContradiction(c, { id: 'H4', claim: 'd' }, LATER);
    expect(forked.hypotheses).toHaveLength(4);
    const competitor = forked.hypotheses.find((h) => h.id === 'H4');
    expect(competitor).toBeDefined();
    // Competitor starts with the leftover mass (1 − leader) as its prior.
    expect(competitor!.prior).toBeCloseTo(0.66, 2);
  });

  it('never forks a resolved cluster', () => {
    const resolved = {
      id: 'c', tenantId: 't', question: 'q',
      hypotheses: [{ id: 'H1', claim: 'a', prior: 0.5, posterior: 0.5, observations: 0, lastUpdatedAt: NOW }],
      resolved: true, winnerId: 'H1', createdAt: NOW, updatedAt: NOW,
    };
    expect(forkOnContradiction(resolved, { id: 'H2', claim: 'b' }, LATER)).toBe(resolved);
  });

  it('honours a custom fork threshold', () => {
    // With default 0.4 this leader (0.5) is strong; with threshold 0.6 it forks.
    const c = createCluster({
      id: 'c1', tenantId: 't1', question: 'q',
      hypotheses: [{ id: 'H1', claim: 'a', prior: 0.5 }, { id: 'H2', claim: 'b', prior: 0.5 }],
      now: NOW,
    });
    expect(forkOnContradiction(c, { id: 'H3', claim: 'c' }, LATER, 0.6).hypotheses).toHaveLength(3);
    expect(DEFAULT_FORK_THRESHOLD).toBe(0.4);
  });
});

describe('leader', () => {
  it('returns the highest normalised posterior', () => {
    const c = observe(
      createCluster({
        id: 'c1', tenantId: 't1', question: 'q',
        hypotheses: [{ id: 'H1', claim: 'a', prior: 0.5 }, { id: 'H2', claim: 'b', prior: 0.5 }],
        now: NOW,
      }),
      { H1: 0.9, H2: 0.1 },
      LATER,
    );
    const l = leader(c);
    expect(l?.id).toBe('H1');
    expect(l?.posterior).toBeGreaterThan(0.8);
  });

  it('returns undefined for an empty cluster', () => {
    const empty = { id: 'c', tenantId: 't', question: 'q', hypotheses: [], resolved: false, createdAt: NOW, updatedAt: NOW };
    expect(leader(empty)).toBeUndefined();
  });
});