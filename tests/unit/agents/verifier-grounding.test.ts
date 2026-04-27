/**
 * Verifier source-grounded contract — Sprint 2.4 / Item F.
 *
 * Tests the citation-density helpers in isolation (pure functions)
 * + asserts the manifest correctly classifies which roles need
 * grounding.
 */
import { describe, it, expect } from 'vitest';
import { AgentRole } from '@jak-swarm/shared';
import {
  splitIntoSentences,
  computeCitationDensity,
} from '../../../packages/agents/src/roles/verifier.agent.js';
import {
  ROLE_MANIFEST,
  getGroundingRequirement,
} from '../../../packages/agents/src/role-manifest.js';

describe('splitIntoSentences', () => {
  it('splits on period+capital and preserves order', () => {
    const out = splitIntoSentences('First sentence. Second sentence! Third one?');
    expect(out).toEqual(['First sentence.', 'Second sentence!', 'Third one?']);
  });

  it('protects common abbreviations from premature splits', () => {
    const out = splitIntoSentences('Acme Inc. ships widgets. Mr. Smith confirmed the order.');
    expect(out.length).toBe(2);
    expect(out[0]).toContain('Acme Inc.');
    expect(out[1]).toContain('Mr. Smith');
  });

  it('protects decimal numbers', () => {
    const out = splitIntoSentences('Revenue grew by 12.5 percent. Profit margin held steady.');
    expect(out.length).toBe(2);
    expect(out[0]).toContain('12.5');
  });

  it('returns empty array on empty input', () => {
    expect(splitIntoSentences('')).toEqual([]);
    expect(splitIntoSentences('   ')).toEqual([]);
  });
});

describe('computeCitationDensity — citation gating', () => {
  it('returns density=1 when there are no claim sentences', () => {
    const r = computeCitationDensity('Hello there. How are you doing today?');
    expect(r.totalClaims).toBe(0);
    expect(r.density).toBe(1);
    expect(r.uncited).toEqual([]);
  });

  it('returns density=1 when every claim has an inline citation', () => {
    const r = computeCitationDensity(
      'The platform achieves 99.9% uptime [evidence:doc_42]. Latency is 200ms p95 [evidence:doc_43].',
    );
    expect(r.totalClaims).toBe(2);
    expect(r.citedClaims).toBe(2);
    expect(r.density).toBe(1);
  });

  it('accepts citations on the prior sentence', () => {
    const r = computeCitationDensity(
      '[evidence:trace_99] The platform achieves 99.9% uptime.',
    );
    // The sentence with a claim verb is "The platform achieves..."
    // Its prior sentence is the bare citation marker — that counts as cited.
    expect(r.totalClaims).toBe(1);
    expect(r.citedClaims).toBe(1);
    expect(r.density).toBe(1);
  });

  it('flags uncited claim sentences and surfaces them', () => {
    const r = computeCitationDensity(
      'The product is the market leader. Customer churn was 3 percent last quarter [evidence:crm_q4]. Revenue grew 25 percent.',
    );
    expect(r.totalClaims).toBe(3); // 3 claim verbs across 3 sentences
    expect(r.citedClaims).toBe(1);
    expect(r.density).toBeCloseTo(1 / 3, 5);
    expect(r.uncited).toHaveLength(2);
    expect(r.uncited[0]).toContain('market leader');
  });

  it('honors all citation prefixes (evidence/source/cite/ref/citation)', () => {
    expect(computeCitationDensity('It is true [source:abc].').density).toBe(1);
    expect(computeCitationDensity('It is true [cite:def].').density).toBe(1);
    expect(computeCitationDensity('It is true [ref:ghi].').density).toBe(1);
    expect(computeCitationDensity('It is true [citation:jkl].').density).toBe(1);
  });

  it('does NOT count generic brackets like [TODO] or [WIP] as citations', () => {
    const r = computeCitationDensity('The system is working [TODO: verify this]');
    expect(r.density).toBeLessThan(1);
    expect(r.uncited).toHaveLength(1);
  });
});

describe('Role-manifest grounding requirements (Sprint 2.4 / Item F)', () => {
  it('marks WORKER_RESEARCH as needsGrounding=true with 0.7 threshold', () => {
    const entry = ROLE_MANIFEST[AgentRole.WORKER_RESEARCH];
    expect(entry.needsGrounding).toBe(true);
    expect(entry.groundingDensityThreshold).toBe(0.7);
  });

  it('marks WORKER_DESIGNER as needsGrounding=true with lower 0.5 threshold (creative slack)', () => {
    const entry = ROLE_MANIFEST[AgentRole.WORKER_DESIGNER];
    expect(entry.needsGrounding).toBe(true);
    expect(entry.groundingDensityThreshold).toBe(0.5);
  });

  it('does NOT mark creative roles as needsGrounding (marketing/content/strategy)', () => {
    expect(ROLE_MANIFEST[AgentRole.WORKER_MARKETING].needsGrounding).toBeFalsy();
    expect(ROLE_MANIFEST[AgentRole.WORKER_CONTENT].needsGrounding).toBeFalsy();
    expect(ROLE_MANIFEST[AgentRole.WORKER_STRATEGIST].needsGrounding).toBeFalsy();
  });

  it('does NOT mark orchestrators as needsGrounding (they don\'t produce factual claims)', () => {
    expect(ROLE_MANIFEST[AgentRole.COMMANDER].needsGrounding).toBeFalsy();
    expect(ROLE_MANIFEST[AgentRole.PLANNER].needsGrounding).toBeFalsy();
    expect(ROLE_MANIFEST[AgentRole.VERIFIER].needsGrounding).toBeFalsy();
  });

  it('getGroundingRequirement returns enforce=false for non-grounded roles', () => {
    const r = getGroundingRequirement(AgentRole.WORKER_MARKETING);
    expect(r.enforce).toBe(false);
    expect(r.threshold).toBe(0.7); // default
  });

  it('getGroundingRequirement returns enforce=true for grounded roles', () => {
    const r = getGroundingRequirement(AgentRole.WORKER_RESEARCH);
    expect(r.enforce).toBe(true);
    expect(r.threshold).toBe(0.7);
  });
});
