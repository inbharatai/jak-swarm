/**
 * hazard-model.test.ts — HyperAgent Phase 5 innovation #10 (temporal drift).
 *
 * Pins the spec §13 Phase 5 invariants:
 *   - a promoted learning carries a Beta(α,β) predictive = α/(α+β);
 *   - the predictive DECAYS toward the neutral 0.5 prior as time passes without
 *     fresh validating evidence (factor = 0.5^(elapsed/halfLife));
 *   - a learning expires when its predictive drops below its floor OR its hard
 *     expiry passes — no stale rule governs forever;
 *   - recordValidation updates the Beta counts and resets the decay clock (pure);
 *   - partitionByExpiry splits persisted records into active/expired by their
 *     hazard model, leaving hazard-less records active.
 *
 * Timestamps are caller-supplied ISO strings — the pure core never calls
 * Date.now, so every value here is deterministic.
 */
import { describe, it, expect } from 'vitest';
import {
  createHazardModel,
  basePredictive,
  elapsedMs,
  decayFactor,
  predictive,
  shouldExpire,
  recordValidation,
  partitionByExpiry,
  DEFAULT_HALF_LIFE_MS,
  DEFAULT_PREDICTIVE_FLOOR,
} from '../../../packages/swarm/src/hyperagent/hazard-model.js';
import type { HazardModel, LearningRecord } from '../../../packages/shared/src/index.js';

const NOW = '2026-01-01T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_LIFE = DEFAULT_HALF_LIFE_MS; // 30d
const at = (daysFromNow: number): string => new Date(new Date(NOW).getTime() + daysFromNow * DAY_MS).toISOString();

describe('createHazardModel', () => {
  it('seeds α=1,β=0 for a successful validation and sets a 180d hard expiry', () => {
    const h = createHazardModel({ success: true, now: NOW });
    expect(h.alpha).toBe(1);
    expect(h.beta).toBe(0);
    expect(h.decayHalfLifeMs).toBe(HALF_LIFE);
    expect(h.predictiveFloor).toBe(DEFAULT_PREDICTIVE_FLOOR);
    expect(h.lastValidatedAt).toBe(NOW);
    // 180-day hard ceiling.
    expect(new Date(h.expiresAt).getTime() - new Date(NOW).getTime()).toBe(180 * DAY_MS);
  });

  it('seeds α=0,β=1 for a failed validation', () => {
    const h = createHazardModel({ success: false, now: NOW });
    expect(h.alpha).toBe(0);
    expect(h.beta).toBe(1);
  });

  it('honours a custom half-life, floor, and max age', () => {
    const h = createHazardModel({ success: true, now: NOW, decayHalfLifeMs: 10 * DAY_MS, predictiveFloor: 0.6, maxAgeMs: 5 * DAY_MS });
    expect(h.decayHalfLifeMs).toBe(10 * DAY_MS);
    expect(h.predictiveFloor).toBe(0.6);
    expect(new Date(h.expiresAt).getTime() - new Date(NOW).getTime()).toBe(5 * DAY_MS);
  });
});

describe('basePredictive', () => {
  it('is α/(α+β)', () => {
    expect(basePredictive({ alpha: 3, beta: 1, decayHalfLifeMs: HALF_LIFE, predictiveFloor: 0.45, lastValidatedAt: NOW, expiresAt: at(180) })).toBeCloseTo(0.75, 10);
  });

  it('falls back to the neutral 0.5 prior when there are no observations', () => {
    const h: HazardModel = { alpha: 0, beta: 0, decayHalfLifeMs: HALF_LIFE, predictiveFloor: 0.45, lastValidatedAt: NOW, expiresAt: at(180) };
    expect(basePredictive(h)).toBe(0.5);
  });
});

describe('elapsedMs + decayFactor', () => {
  const h = createHazardModel({ success: true, now: NOW });

  it('elapsed is 0 at the validation instant', () => {
    expect(elapsedMs(h, NOW)).toBe(0);
  });

  it('decay factor is 1 at t=0 and 0.5 after one half-life', () => {
    expect(decayFactor(h, NOW)).toBeCloseTo(1, 10);
    expect(decayFactor(h, at(30))).toBeCloseTo(0.5, 10);
  });

  it('decay factor trends toward 0 far into the future', () => {
    expect(decayFactor(h, at(365))).toBeLessThan(0.001);
  });
});

describe('predictive (decay toward the neutral prior)', () => {
  it('equals the base predictive at t=0 (full belief)', () => {
    const h = createHazardModel({ success: true, now: NOW });
    expect(predictive(h, NOW)).toBeCloseTo(1.0, 10);
  });

  it('is the midpoint between base and neutral after one half-life', () => {
    const h = createHazardModel({ success: true, now: NOW });
    // base=1, neutral=0.5, factor=0.5 ⇒ 1·0.5 + 0.5·0.5 = 0.75.
    expect(predictive(h, at(30))).toBeCloseTo(0.75, 10);
  });

  it('reverts toward 0.5 as t → ∞ (forgetting)', () => {
    const h = createHazardModel({ success: true, now: NOW });
    expect(predictive(h, at(365))).toBeCloseTo(0.5, 3);
  });

  it('for a pure-failure learning the predictive starts at 0 (never succeeds)', () => {
    const h = createHazardModel({ success: false, now: NOW });
    expect(predictive(h, NOW)).toBeCloseTo(0, 10);
  });
});

describe('shouldExpire', () => {
  it('expires once the hard expiry passes, even for a perfect-success model', () => {
    const h = createHazardModel({ success: true, now: NOW });
    expect(shouldExpire(h, at(179))).toBe(false);
    expect(shouldExpire(h, at(181))).toBe(true);
  });

  it('expires immediately when the predictive is below the floor', () => {
    // A pure-failure learning has predictive 0 < default floor 0.45.
    const h = createHazardModel({ success: false, now: NOW });
    expect(shouldExpire(h, NOW)).toBe(true);
  });

  it('expires by floor once a high-floor model decays enough', () => {
    const h = createHazardModel({ success: true, now: NOW, predictiveFloor: 0.8 });
    // At +30d predictive = 0.75 < 0.8 ⇒ expired by floor before the hard ceiling.
    expect(shouldExpire(h, at(30))).toBe(true);
  });
});

describe('recordValidation (pure)', () => {
  it('increments α and resets the decay clock on a success', () => {
    const h0 = createHazardModel({ success: true, now: NOW });
    const h1 = recordValidation(h0, true, at(10));
    expect(h1.alpha).toBe(2);
    expect(h1.beta).toBe(0);
    expect(h1.lastValidatedAt).toBe(at(10));
    // Pure — original untouched.
    expect(h0.alpha).toBe(1);
    expect(h0.lastValidatedAt).toBe(NOW);
  });

  it('increments β on a failure', () => {
    const h0 = createHazardModel({ success: true, now: NOW });
    const h1 = recordValidation(h0, false, at(5));
    expect(h1.alpha).toBe(1);
    expect(h1.beta).toBe(1);
    // base predictive is now 0.5.
    expect(basePredictive(h1)).toBeCloseTo(0.5, 10);
  });
});

describe('partitionByExpiry', () => {
  const baseRecord = (over: Partial<LearningRecord>): LearningRecord => ({
    id: 'r', tenantId: 't1', key: 'k', kind: 'WORKFLOW' as never,
    source: 'OUTCOME' as never, value: {}, summary: 's', status: 'PROMOTED' as never,
    tags: [], confidence: 0.5, createdAt: NOW,
    ...over,
  }) as LearningRecord;

  it('partitions records by their hazard model and stamps expired ones', () => {
    const fresh = baseRecord({ id: 'r1', hazard: createHazardModel({ success: true, now: at(0) }) });
    // lastValidatedAt = NOW; evaluated at NOW ⇒ predictive 1, not expired.
    const stale = baseRecord({
      id: 'r2',
      hazard: createHazardModel({ success: true, now: at(-200) }), // validated 200d ago
    });
    // For a 200d-old model evaluated at NOW: hard expiry (180d) has passed ⇒ expired.
    // Build it explicitly so the timestamps are unambiguous.
    const oldHazard: HazardModel = {
      alpha: 1, beta: 0, decayHalfLifeMs: HALF_LIFE, predictiveFloor: 0.45,
      lastValidatedAt: at(-200), expiresAt: at(-20), // expired 20d ago
    };
    const expiredRec = baseRecord({ id: 'r2', hazard: oldHazard });
    const noHazard = baseRecord({ id: 'r3' });

    const { active, expired } = partitionByExpiry([fresh, expiredRec, noHazard], NOW);
    expect(active.map((r) => r.id).sort()).toEqual(['r1', 'r3']);
    expect(expired.map((r) => r.id)).toEqual(['r2']);
    expect(expired[0].status).toBe('EXPIRED' as never);
    expect(expired[0].expiredAt).toBe(NOW);
  });

  it('leaves hazard-less records active (conservative — only decay what opted in)', () => {
    const noHazard = baseRecord({ id: 'r3' });
    const { active, expired } = partitionByExpiry([noHazard], NOW);
    expect(active).toHaveLength(1);
    expect(expired).toHaveLength(0);
  });
});