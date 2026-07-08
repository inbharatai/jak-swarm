/**
 * hazard-model.ts — Innovation #10 (HyperAgent Phase 5).
 *
 * Hazard-model temporal drift on learnings. A promoted learning carries a
 * Beta(α, β) predictive posterior = α/(α+β) — the probability it still yields
 * a successful outcome. As time passes WITHOUT fresh validating evidence, the
 * predictive DECAYS toward a neutral prior (forgetting), so no stale rule
 * governs forever. The learning auto-expires when the predictive drops below
 * its floor OR its hard expiry passes.
 *
 * Pure + deterministic. Timestamps are parsed from caller-supplied ISO strings
 * (no Date.now / argless new Date() — those would break determinism).
 */
import type { HazardModel, LearningRecord } from '@jak-swarm/shared';
import { LearningStatus } from '@jak-swarm/shared';

/** Neutral prior the predictive decays toward as evidence goes stale. */
const NEUTRAL_PRIOR = 0.5;

/** Default decay half-life (30 days in ms) when a hazard model omits it. */
export const DEFAULT_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/** Default predictive floor — below this a learning expires. */
export const DEFAULT_PREDICTIVE_FLOOR = 0.45;

/** Construct a fresh hazard model from an initial validation outcome. */
export function createHazardModel(input: {
  success: boolean;
  now: string;
  decayHalfLifeMs?: number;
  predictiveFloor?: number;
  /** Hard lifespan (ms) from `now` regardless of decay. */
  maxAgeMs?: number;
}): HazardModel {
  const alpha = input.success ? 1 : 0;
  const beta = input.success ? 0 : 1;
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_HALF_LIFE_MS * 6; // ~180d default ceiling
  return {
    alpha,
    beta,
    decayHalfLifeMs: input.decayHalfLifeMs ?? DEFAULT_HALF_LIFE_MS,
    predictiveFloor: input.predictiveFloor ?? DEFAULT_PREDICTIVE_FLOOR,
    lastValidatedAt: input.now,
    expiresAt: new Date(new Date(input.now).getTime() + maxAgeMs).toISOString(),
  };
}

/** Base (undecayed) Beta predictive = α/(α+β), 0.5 when no observations. */
export function basePredictive(h: HazardModel): number {
  const n = h.alpha + h.beta;
  return n <= 0 ? NEUTRAL_PRIOR : h.alpha / n;
}

/** Elapsed milliseconds since the last validating observation. */
export function elapsedMs(h: HazardModel, now: string): number {
  return Math.max(0, new Date(now).getTime() - new Date(h.lastValidatedAt).getTime());
}

/**
 * Decay factor in [0,1]: 1 at t=0 (full belief), →0 as t→∞ (full forgetting).
 * factor = 0.5 ^ (elapsed / halfLife).
 */
export function decayFactor(h: HazardModel, now: string): number {
  const half = h.decayHalfLifeMs > 0 ? h.decayHalfLifeMs : DEFAULT_HALF_LIFE_MS;
  return Math.pow(0.5, elapsedMs(h, now) / half);
}

/**
 * The decayed predictive posterior: belief reverts toward the neutral prior as
 * evidence goes stale. predictive = base·factor + NEUTRAL·(1−factor).
 */
export function predictive(h: HazardModel, now: string): number {
  const f = decayFactor(h, now);
  return basePredictive(h) * f + NEUTRAL_PRIOR * (1 - f);
}

/** True when the learning should expire (predictive below floor OR past hard expiry). */
export function shouldExpire(h: HazardModel, now: string): boolean {
  if (new Date(now).getTime() >= new Date(h.expiresAt).getTime()) return true;
  return predictive(h, now) < h.predictiveFloor;
}

/**
 * Record a fresh validating observation: update the Beta counts and reset the
 * decay clock. Returns a new HazardModel (pure).
 */
export function recordValidation(h: HazardModel, success: boolean, now: string): HazardModel {
  return {
    ...h,
    alpha: h.alpha + (success ? 1 : 0),
    beta: h.beta + (success ? 0 : 1),
    lastValidatedAt: now,
  };
}

/**
 * Partition persisted learning records into { active, expired } by their hazard
 * model. Records without a hazard model are left active (conservative — only
 * decay what opted into the model).
 */
export function partitionByExpiry(records: LearningRecord[], now: string): {
  active: LearningRecord[];
  expired: LearningRecord[];
} {
  const active: LearningRecord[] = [];
  const expired: LearningRecord[] = [];
  for (const r of records) {
    if (r.hazard && shouldExpire(r.hazard, now)) {
      expired.push({ ...r, status: LearningStatus.EXPIRED, expiredAt: now });
    } else {
      active.push(r);
    }
  }
  return { active, expired };
}