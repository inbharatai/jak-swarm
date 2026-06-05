import { describe, expect, it } from 'vitest';
import {
  inferIntentFromKeywords,
  buildHelpfulClarification,
  inferFastClarificationFromUiCard,
} from './commander.agent.js';
import { Industry } from '@jak-swarm/shared';

describe('inferIntentFromKeywords', () => {
  const cases: Array<{ input: string; expectedIntent: string; expectedSub: string; minConfidence: number }> = [
    // Website review / audit (CTO path)
    { input: 'Review www.jakswarm.com', expectedIntent: 'website_review_and_improvement', expectedSub: 'Website Review', minConfidence: 0.9 },
    { input: 'Audit https://example.com for SEO', expectedIntent: 'website_review_and_improvement', expectedSub: 'Website Review', minConfidence: 0.9 },
    { input: 'Check inbharat.ai and tell me issues', expectedIntent: 'website_review_and_improvement', expectedSub: 'Website Review', minConfidence: 0.9 },

    // Marketing / campaign
    { input: 'Create a marketing plan for Q3', expectedIntent: 'marketing_campaign_generation', expectedSub: 'Marketing Campaign', minConfidence: 0.9 },
    { input: 'Draft a go-to-market strategy', expectedIntent: 'marketing_campaign_generation', expectedSub: 'Marketing Campaign', minConfidence: 0.9 },
    { input: 'Brand audit for our startup', expectedIntent: 'marketing_campaign_generation', expectedSub: 'Marketing Campaign', minConfidence: 0.9 },

    // Content creation
    { input: 'Write a LinkedIn post about AI', expectedIntent: 'marketing_campaign_generation', expectedSub: 'Content Creation', minConfidence: 0.85 },
    { input: 'Draft a newsletter for customers', expectedIntent: 'marketing_campaign_generation', expectedSub: 'Content Creation', minConfidence: 0.85 },

    // Strategy / CEO
    { input: 'Build a SWOT analysis for us', expectedIntent: 'company_strategy_review', expectedSub: 'Strategic Planning', minConfidence: 0.9 },
    { input: 'Set OKRs for the next quarter', expectedIntent: 'company_strategy_review', expectedSub: 'Strategic Planning', minConfidence: 0.9 },
    { input: 'Competitive positioning analysis', expectedIntent: 'company_strategy_review', expectedSub: 'Strategic Planning', minConfidence: 0.9 },

    // Investor materials
    { input: 'Create a pitch deck for Series A', expectedIntent: 'investor_material_generation', expectedSub: 'Investor Materials', minConfidence: 0.9 },
    { input: 'One pager for investors', expectedIntent: 'investor_material_generation', expectedSub: 'Investor Materials', minConfidence: 0.9 },

    // Competitor research
    { input: 'Research our competitors', expectedIntent: 'competitor_research', expectedSub: 'Competitive Research', minConfidence: 0.85 },
    { input: 'Benchmark against top players', expectedIntent: 'competitor_research', expectedSub: 'Competitive Research', minConfidence: 0.85 },

    // Code / technical
    { input: 'Write a Python script to scrape data', expectedIntent: 'codebase_review_and_patch', expectedSub: 'Code Task', minConfidence: 0.85 },
    { input: 'Fix the API authentication bug', expectedIntent: 'codebase_review_and_patch', expectedSub: 'Code Task', minConfidence: 0.85 },

    // Research
    { input: 'Research market trends in fintech', expectedIntent: 'research_and_report', expectedSub: 'Research', minConfidence: 0.85 },
    { input: 'Find data on AI adoption rates', expectedIntent: 'research_and_report', expectedSub: 'Research', minConfidence: 0.85 },

    // Pricing
    { input: 'Review our pricing and unit economics', expectedIntent: 'pricing_and_unit_economics_review', expectedSub: 'Pricing Review', minConfidence: 0.85 },
    { input: 'Calculate CAC and LTV', expectedIntent: 'pricing_and_unit_economics_review', expectedSub: 'Pricing Review', minConfidence: 0.85 },

    // Sales outreach
    { input: 'Draft a cold email sequence', expectedIntent: 'sales_outreach_draft_generation', expectedSub: 'Sales Outreach', minConfidence: 0.85 },
    { input: 'Lead gen campaign for Q4', expectedIntent: 'sales_outreach_draft_generation', expectedSub: 'Sales Outreach', minConfidence: 0.85 },

    // Operations / SOP
    { input: 'Write an SOP for onboarding', expectedIntent: 'operations_sop_generation', expectedSub: 'Operations', minConfidence: 0.85 },
    { input: 'Create a runbook for deployments', expectedIntent: 'operations_sop_generation', expectedSub: 'Operations', minConfidence: 0.85 },

    // Customer persona
    { input: 'Build a customer persona for SaaS buyers', expectedIntent: 'customer_persona_generation', expectedSub: 'Customer Persona', minConfidence: 0.85 },
    { input: 'Define our ideal customer profile', expectedIntent: 'customer_persona_generation', expectedSub: 'Customer Persona', minConfidence: 0.85 },

    // Product positioning
    { input: 'Product positioning for our new feature', expectedIntent: 'product_positioning_review', expectedSub: 'Product Positioning', minConfidence: 0.85 },
    { input: 'Value proposition document', expectedIntent: 'product_positioning_review', expectedSub: 'Product Positioning', minConfidence: 0.85 },

    // Legal / compliance
    { input: 'Draft an NDA for contractors', expectedIntent: 'audit_compliance_workflow', expectedSub: 'Legal / Compliance', minConfidence: 0.85 },
    { input: 'Privacy policy compliance check', expectedIntent: 'audit_compliance_workflow', expectedSub: 'Legal / Compliance', minConfidence: 0.85 },

    // HR / hiring
    { input: 'Write a job description for a PM', expectedIntent: 'operations_sop_generation', expectedSub: 'HR / People Ops', minConfidence: 0.8 },
    { input: 'Hiring plan for the engineering team', expectedIntent: 'operations_sop_generation', expectedSub: 'HR / People Ops', minConfidence: 0.8 },

    // Document analysis
    { input: 'Summarize the uploaded document', expectedIntent: 'document_analysis', expectedSub: 'Document Analysis', minConfidence: 0.85 },
    { input: 'Extract data from the PDF', expectedIntent: 'document_analysis', expectedSub: 'Document Analysis', minConfidence: 0.85 },

    // Browser inspection
    { input: 'Scrape https://example.com for prices', expectedIntent: 'browser_inspection', expectedSub: 'Browser Inspection', minConfidence: 0.85 },
  ];

  for (const c of cases) {
    it(`classifies "${c.input.slice(0, 40)}…" as ${c.expectedIntent}`, () => {
      const result = inferIntentFromKeywords(c.input);
      expect(result).not.toBeNull();
      expect(result!.intent).toBe(c.expectedIntent);
      expect(result!.subFunction).toBe(c.expectedSub);
      expect(result!.confidence).toBeGreaterThanOrEqual(c.minConfidence);
    });
  }

  it('returns null for truly ambiguous input', () => {
    const result = inferIntentFromKeywords('hello');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = inferIntentFromKeywords('');
    expect(result).toBeNull();
  });

  it('matches URL review even with mixed case', () => {
    const result = inferIntentFromKeywords('REVIEW www.JAKSWARM.COM');
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('website_review_and_improvement');
  });

  it('matches marketing plan with alternate phrasing', () => {
    const result = inferIntentFromKeywords('GTM strategy for B2B SaaS');
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('marketing_campaign_generation');
  });
});

describe('buildHelpfulClarification', () => {
  it('asks about deliverable when a role is mentioned', () => {
    const q = buildHelpfulClarification('CTO help', Industry.GENERAL);
    expect(q).toContain('CTO');
    expect(q).toContain('deliverable');
  });

  it('asks about URL action when a URL is present without a verb', () => {
    const q = buildHelpfulClarification('https://jakswarm.com', Industry.GENERAL);
    expect(q).toContain('URL');
    expect(q).toMatch(/review|extract|compare/i);
  });

  it('asks for goal when input is very short', () => {
    const q = buildHelpfulClarification('hi there', Industry.GENERAL);
    expect(q).toContain('report');
    expect(q).toContain('draft');
  });

  it('returns a generic but helpful fallback for unclear input', () => {
    const q = buildHelpfulClarification('some random thing that does not match', Industry.GENERAL);
    expect(q).toContain('specialist');
    expect(q).toMatch(/review|draft|plan|research/i);
  });
});

describe('inferFastClarificationFromUiCard', () => {
  it('detects billing card copy and returns deterministic clarification', () => {
    const q = inferFastClarificationFromUiCard(
      'Billing Manage your subscription and payment method. Current Plan Founding 500 - $200/year - $0 included usage',
    );
    expect(q).not.toBeNull();
    expect(q).toContain('billing/subscription');
  });

  it('does not trigger when the user already asked for a concrete action', () => {
    const q = inferFastClarificationFromUiCard(
      'Billing manage your subscription and payment method. Current plan Founding 500. Please summarize this in 2 bullets.',
    );
    expect(q).toBeNull();
  });

  it('returns null for non-billing text', () => {
    const q = inferFastClarificationFromUiCard('Review jakswarm.com and suggest improvements');
    expect(q).toBeNull();
  });
});
