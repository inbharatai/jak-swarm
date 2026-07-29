/**
 * citation-coverage.test.ts — unit tests for the citation-coverage gate.
 *
 * Invariants under test:
 *   1. Output claims supported by served Brain claims score high coverage.
 *   2. Invented facts (unevidenced numbers/entities) are caught verbatim.
 *   3. An empty served-claim set is NOT measurable (never fakes "grounded").
 *   4. coverageMetrics only emits metrics for a measurable report, so the
 *      acceptance checker's METRIC_THRESHOLD binding stays honest.
 */
import { describe, expect, it } from 'vitest';
import {
  CITATION_COVERAGE_METRIC,
  coverageMetrics,
  measureCitationCoverage,
  splitSentences,
} from '../../../packages/swarm/src/hyperagent/citation-coverage.js';

const SERVED = [
  {
    id: 'claim_churn_1',
    text: 'Customer churn increased 18% in Q2 2026 driven by onboarding drop-off in the SMB segment.',
  },
  {
    id: 'claim_pricing_1',
    text: 'The Pro plan costs $29 per month and includes 3,000 credits.',
  },
];

describe('splitSentences', () => {
  it('splits on sentence boundaries and protects abbreviations', () => {
    const s = splitSentences('Dr. Smith found the result. It was significant. Was it expected?');
    expect(s).toHaveLength(3);
    expect(s[0]).toMatch(/^Dr\. Smith/);
  });
});

describe('measureCitationCoverage', () => {
  it('marks output claims supported by served claims as covered', () => {
    const r = measureCitationCoverage({
      outputText:
        'Churn increased 18% in Q2 2026. The rise was driven by onboarding drop-off in the SMB segment. [evidence:claim_churn_1]',
      servedClaims: SERVED,
    });
    expect(r.measurable).toBe(true);
    expect(r.coverage).toBe(1);
    expect(r.unsupportedClaims).toHaveLength(0);
  });

  it('catches an invented fact verbatim (unevidenced entities/numbers)', () => {
    const r = measureCitationCoverage({
      outputText:
        'Churn increased 18% in Q2 2026. The Enterprise tier costs $999 per month and includes unlimited seats.',
      servedClaims: SERVED,
    });
    expect(r.coverage).toBeLessThan(1);
    expect(r.unsupportedClaims.some((s) => s.includes('$999'))).toBe(true);
  });

  it('scores citation-form density independently of support', () => {
    const cited = measureCitationCoverage({
      outputText: 'Churn increased 18% in Q2 2026. [evidence:claim_churn_1]',
      servedClaims: SERVED,
    });
    expect(cited.citationFormDensity).toBe(1);

    const uncited = measureCitationCoverage({
      outputText: 'Churn increased 18% in Q2 2026.',
      servedClaims: SERVED,
    });
    // Supported by the served claim (content matches) but no citation marker.
    expect(uncited.coverage).toBe(1);
    expect(uncited.citationFormDensity).toBe(0);
  });

  it('is NOT measurable against an empty served-claim set (never fakes grounded)', () => {
    const r = measureCitationCoverage({
      outputText: 'Churn increased 18% in Q2 2026.',
      servedClaims: [],
    });
    expect(r.measurable).toBe(false);
    // Coverage is 0 (nothing proven grounded) and `measurable=false` is the
    // guard that keeps the acceptance criterion unwired — the report can
    // never be mistaken for a pass.
    expect(r.coverage).toBe(0);
    expect(coverageMetrics(r)).toEqual({});
  });

  it('ignores non-claim sentences (questions, pure instructions)', () => {
    const r = measureCitationCoverage({
      outputText: 'What is the churn rate? Churn increased 18% in Q2 2026.',
      servedClaims: SERVED,
    });
    expect(r.claims).toHaveLength(1);
    expect(r.coverage).toBe(1);
  });

  it('paraphrase beyond the token threshold is honestly unsupported', () => {
    const r = measureCitationCoverage({
      // "costs" IS a claim verb, so this counts as a claim — but its content
      // (a $999 Enterprise tier) is paraphrased/invented vs the served claims.
      outputText: 'The Enterprise tier costs $999 per month and includes unlimited seats.',
      servedClaims: SERVED,
    });
    // Lexical matching catches the invented numbers/tier — surfaced verbatim
    // for review rather than faked as supported.
    expect(r.coverage).toBeLessThan(1);
    expect(r.unsupportedClaims[0]).toContain('$999');
  });
});

describe('coverageMetrics', () => {
  it('emits citation_coverage for a measurable report', () => {
    const r = measureCitationCoverage({
      outputText: 'Churn increased 18% in Q2 2026.',
      servedClaims: SERVED,
    });
    const m = coverageMetrics(r);
    expect(m[CITATION_COVERAGE_METRIC]).toBe(1);
  });

  it('emits NOTHING for an unmeasurable report (acceptance stays honest)', () => {
    const r = measureCitationCoverage({
      outputText: 'Churn increased 18%.',
      servedClaims: [],
    });
    expect(coverageMetrics(r)).toEqual({});
  });
});
