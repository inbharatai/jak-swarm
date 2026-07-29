/**
 * rubric/floor-rules.test.ts — unit tests for the deterministic quality floor.
 *
 * Invariants:
 *   1. A complete, well-structured, cited answer scores near 1.
 *   2. Sub-ask neglect, placeholder text, missing citations, and bloat score low.
 *   3. The floor is deterministic — same input, same score, every time.
 *   4. Dimensions degrade gracefully (single-ask tasks, no-evidence tasks).
 */
import { describe, expect, it } from 'vitest';
import { scoreRubricFloor, subAsks } from '../../../packages/verification/src/rubric/floor-rules.js';

const CTX = {
  taskName: 'Analyse churn',
  taskDescription:
    'Summarise the top churn drivers from Q2 support tickets. Compare SMB and Enterprise churn rates. Recommend two retention actions.',
};

describe('subAsks', () => {
  it('splits a multi-part brief into checkable asks', () => {
    const asks = subAsks(CTX.taskDescription);
    expect(asks.length).toBe(3);
    expect(asks[0]).toMatch(/Summarise/);
  });

  it('caps long briefs at 8 asks', () => {
    const long = Array.from({ length: 15 }, (_, i) => `Step ${i}: do thing number ${i} properly.`).join(' ');
    expect(subAsks(long).length).toBeLessThanOrEqual(8);
  });
});

describe('scoreRubricFloor', () => {
  it('scores a complete, structured, cited answer high', () => {
    const output = [
      'Churn in Q2 was driven primarily by onboarding drop-off and pricing confusion. [evidence:tickets_41]',
      'SMB churn reached 12% while Enterprise churn held at 4%, a threefold gap concentrated in the first 90 days.',
      'I recommend two retention actions: first, a guided onboarding track for SMB accounts; second, a pricing-page simplification to reduce confusion at upgrade time.',
      'Together these steps address the drivers summarised above and target the segment with the highest churn.',
    ].join(' ');
    const r = scoreRubricFloor(output, { ...CTX, evidenceServed: true });
    expect(r.floorScore).toBeGreaterThan(0.85);
    expect(r.issues).toHaveLength(0);
  });

  it('penalises an answer that ignores a sub-ask', () => {
    const output =
      'Churn in Q2 was driven by onboarding drop-off. SMB churn reached 12% while Enterprise churn held at 4%. ' +
      'This gap is concentrated in the first 90 days and reflects onboarding friction for smaller accounts.';
    const r = scoreRubricFloor(output, CTX);
    const coverage = r.dimensions.find((d) => d.name === 'addressCoverage');
    expect(coverage?.score).toBeLessThan(1);
    expect(r.floorScore).toBeLessThan(0.9);
  });

  it('flags placeholder and refusal text', () => {
    const r = scoreRubricFloor('As an AI language model, I cannot complete this. TODO: finish later.', CTX);
    const format = r.dimensions.find((d) => d.name === 'formatConformity');
    expect(format?.score).toBeLessThan(0.7);
  });

  it('requires citation markers when evidence was served', () => {
    const output =
      'Churn was driven by onboarding drop-off and pricing confusion. SMB churn reached 12% while Enterprise held at 4%. ' +
      'I recommend a guided onboarding track and a pricing-page simplification to address these drivers and reduce churn.';
    const r = scoreRubricFloor(output, { ...CTX, evidenceServed: true });
    const citation = r.dimensions.find((d) => d.name === 'citationPresence');
    expect(citation?.score).toBe(0);
    expect(r.issues.some((i) => i.includes('citationPresence'))).toBe(true);
  });

  it('does not require citations when no evidence was served', () => {
    const output =
      'Churn was driven by onboarding drop-off and pricing confusion. SMB churn reached 12% while Enterprise held at 4%. ' +
      'I recommend a guided onboarding track and a pricing-page simplification to address these drivers and reduce churn.';
    const r = scoreRubricFloor(output, { ...CTX, evidenceServed: false });
    expect(r.dimensions.find((d) => d.name === 'citationPresence')?.score).toBe(1);
  });

  it('flags invalid JSON when JSON output is expected', () => {
    const r = scoreRubricFloor('not json at all, just prose about churn drivers and retention.', {
      ...CTX,
      expectedFormat: 'json',
    });
    expect(r.dimensions.find((d) => d.name === 'formatConformity')?.score).toBeLessThan(1);
  });

  it('is deterministic — identical input yields identical output', () => {
    const output = 'Churn was driven by onboarding drop-off. SMB churn reached 12% while Enterprise held at 4%.';
    const a = scoreRubricFloor(output, CTX);
    const b = scoreRubricFloor(output, CTX);
    expect(a).toEqual(b);
  });
});
