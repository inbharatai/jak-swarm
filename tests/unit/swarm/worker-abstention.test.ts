/**
 * worker-abstention.test.ts — accuracy pass design 3 (calibrated abstention).
 *
 * Invariants:
 *   1. detectAbstention fires on strong uncertainty signals (explicit low
 *      confidence, "cannot determine", "insufficient evidence").
 *   2. It never fires on hedging alone or on a confident, grounded answer.
 *   3. The verifier node short-circuits an abstained output to ABSTAINED
 *      (non-pass, non-retry) rather than failing it or burning a retry.
 */
import { describe, expect, it } from 'vitest';
import { detectAbstention } from '../../../packages/swarm/src/graph/nodes/worker-node.js';

describe('detectAbstention', () => {
  it('fires on an explicit self-confidence below the threshold', () => {
    const r = detectAbstention({ answer: 'possibly 12%', confidence: 0.25 });
    expect(r).toBeDefined();
    expect(r?.confidence).toBe(0.25);
  });

  it('does NOT fire on confidence at/above the threshold', () => {
    expect(detectAbstention({ answer: 'Churn was 12%.', confidence: 0.6 })).toBeUndefined();
  });

  it('fires on "cannot determine" declarations', () => {
    const r = detectAbstention('After reviewing the available data, I cannot determine the churn rate for Q2.');
    expect(r).toBeDefined();
    expect(r?.reason).toMatch(/cannot determine/i);
  });

  it('fires on "insufficient evidence" declarations', () => {
    const r = detectAbstention('There is insufficient evidence to conclude which plan costs more.');
    expect(r).toBeDefined();
  });

  it('does NOT fire on hedging alone (measured language is not abstention)', () => {
    expect(detectAbstention('Churn was likely around 12%, driven mainly by onboarding.')).toBeUndefined();
    expect(detectAbstention('The Pro plan probably costs $29 per month.')).toBeUndefined();
  });

  it('does NOT fire on a confident, grounded answer', () => {
    expect(detectAbstention('Churn increased 18% in Q2 2026, driven by onboarding drop-off.')).toBeUndefined();
  });

  it('extracts the matching sentence as the human-readable reason', () => {
    const r = detectAbstention('I looked at the tickets. I cannot determine the root cause from the data available.');
    expect(r?.reason).toMatch(/cannot determine/i);
  });
});
