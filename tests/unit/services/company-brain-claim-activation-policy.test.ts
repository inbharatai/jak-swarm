/**
 * company-brain-claim-activation-policy.test.ts — pins C4: per-predicate claim
 * activation policy (truth-doc C4: was one universal threshold; a "deadline"
 * claim and a "vibe" claim used the same bar).
 */
import { describe, it, expect } from 'vitest';
import {
  claimActivationThreshold,
  decideClaimTransition,
  DEFAULT_CLAIM_ACTIVATION,
  CLAIM_ACTIVATION_POLICY,
} from '../../../apps/api/src/services/company-brain/company-brain-v2.core.js';

describe('claimActivationThreshold (C4 per-predicate policy)', () => {
  it('returns the default for an unconfigured predicate', () => {
    expect(claimActivationThreshold('some_random_predicate')).toEqual(DEFAULT_CLAIM_ACTIVATION);
  });
  it('returns a stricter bar for high-stakes predicates', () => {
    expect(claimActivationThreshold('deadline')).toEqual(CLAIM_ACTIVATION_POLICY['deadline']);
    expect(CLAIM_ACTIVATION_POLICY['deadline']!.minConfidence).toBeGreaterThan(DEFAULT_CLAIM_ACTIVATION.minConfidence);
    expect(claimActivationThreshold('revenue').minAuthority).toBeGreaterThan(DEFAULT_CLAIM_ACTIVATION.minAuthority);
  });
});

describe('decideClaimTransition uses the per-predicate bar (C4)', () => {
  // Evidence that meets the DEFAULT bar (0.82 / 0.75) but NOT the deadline bar (0.85 / 0.82).
  const borderline = { confidence: 0.78, authorityScore: 0.83, validFrom: undefined };

  it('auto-activates a default-predicate claim at the default bar', () => {
    const t = decideClaimTransition({ predicate: 'sentiment', ...borderline });
    expect(t.candidateStatus).toBe('active');
    expect(t.requiresReview).toBe(false);
  });

  it('forces review for a high-stakes deadline claim at the same evidence (stricter bar)', () => {
    const t = decideClaimTransition({ predicate: 'deadline', ...borderline });
    expect(t.candidateStatus).toBe('proposed');
    expect(t.requiresReview).toBe(true);
  });

  it('auto-activates a deadline claim once evidence clears the stricter bar', () => {
    const t = decideClaimTransition({ predicate: 'deadline', confidence: 0.90, authorityScore: 0.90, validFrom: undefined });
    expect(t.candidateStatus).toBe('active');
  });
});
