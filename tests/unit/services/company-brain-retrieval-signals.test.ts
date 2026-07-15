/**
 * company-brain-retrieval-signals.test.ts — pins C3: retrieval now carries
 * temporal recency + entity confidence signals (truth-doc C3: was lexical+graph
 * only, no temporal/authority/confidence) and exposes a reciprocal-rank-fusion
 * primitive for the future multi-list fusion.
 */
import { describe, it, expect } from 'vitest';
import {
  compositeEntityScore,
  entityRecencyScore,
  reciprocalRankFusion,
  type RelevanceSignal,
} from '../../../apps/api/src/services/company-brain/company-brain-v2.core.js';

const base: RelevanceSignal = {
  exactAlias: false,
  identifier: false,
  keywordRank: 0,
  graphNeighbor: false,
};

describe('entityRecencyScore (C3 temporal signal)', () => {
  const now = new Date('2026-07-15T00:00:00.000Z');
  it('is 1 for an entity updated now', () => {
    expect(entityRecencyScore({ updatedAt: now }, now)).toBeCloseTo(1, 5);
  });
  it('decays linearly over a half-year to 0', () => {
    const halfYearAgo = new Date(now.getTime() - 180 * 86_400_000);
    expect(entityRecencyScore({ occurredAt: halfYearAgo }, now)).toBeCloseTo(0, 5);
    const yearAgo = new Date(now.getTime() - 365 * 86_400_000);
    expect(entityRecencyScore({ occurredAt: yearAgo }, now)).toBe(0);
  });
  it('returns 0 for missing/unparseable timestamps', () => {
    expect(entityRecencyScore({})).toBe(0);
    expect(entityRecencyScore({ occurredAt: null })).toBe(0);
    expect(entityRecencyScore({ occurredAt: 'not-a-date' })).toBe(0);
  });
});

describe('compositeEntityScore includes recency + confidence (C3)', () => {
  it('a recent high-confidence entity outscores an old low-confidence one with the same match signals', () => {
    const recentHi = { ...base, identifier: true, recency: 1, confidence: 0.9 };
    const oldLo = { ...base, identifier: true, recency: 0, confidence: 0.2 };
    expect(compositeEntityScore(recentHi)).toBeGreaterThan(compositeEntityScore(oldLo));
  });
  it('recency/confidence never push the score above 1', () => {
    expect(compositeEntityScore({ ...base, exactAlias: true, recency: 1, confidence: 1 })).toBeLessThanOrEqual(1);
  });
});

describe('reciprocalRankFusion (C3 fusion primitive)', () => {
  it('fuses two ranked lists, rewarding items ranked high in both', () => {
    const scores = reciprocalRankFusion<string>([
      ['a', 'b', 'c'],
      ['b', 'a', 'd'],
    ]);
    // 'a' is rank0 in list1, rank1 in list2 -> 1/(60+1) + 1/(60+2)
    // 'b' is rank1 in list1, rank0 in list2 -> 1/(60+2) + 1/(60+1)  (same as a)
    expect(scores.get('a')).toBeCloseTo(1 / 61 + 1 / 62, 7);
    expect(scores.get('b')).toBeCloseTo(1 / 62 + 1 / 61, 7);
    expect((scores.get('b') ?? 0)).toBeGreaterThan((scores.get('c') ?? 0));
  });
  it('returns an empty map for no lists', () => {
    expect(reciprocalRankFusion([]).size).toBe(0);
  });
});
