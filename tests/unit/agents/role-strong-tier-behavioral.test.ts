/**
 * Strong-tier role behavioral tests.
 *
 * Covers 9 roles classified as `strong` in ROLE_MANIFEST but which had no
 * regression guard: Designer, Knowledge, Content, SEO, PR, Legal, Analytics,
 * Project, ScreenshotToCode.
 *
 * Same stubbed-callLLM pattern — feed realistic domain payloads and assert
 * every domain-specific field round-trips through the agent's parser.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DesignerAgent,
  KnowledgeAgent,
  ContentAgent,
  SEOAgent,
  PRAgent,
  LegalAgent,
  AnalyticsAgent,
  ProjectAgent,
  ScreenshotToCodeAgent,
  AgentContext,
} from '@jak-swarm/agents';
import type OpenAI from 'openai';

function stubContext(): AgentContext {
  return new AgentContext({ tenantId: 't-1', userId: 'u-1', workflowId: 'wf-1' });
}

function fakeCompletion(content: string): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'stub-1',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'stub',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: { role: 'assistant', content, refusal: null },
      } as unknown as OpenAI.Chat.Completions.ChatCompletion.Choice,
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

function stubLLM<T>(agent: T, payload: unknown): void {
  (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM =
    vi.fn(async () => fakeCompletion(JSON.stringify(payload)));
}

// ─── Designer ──────────────────────────────────────────────────────────────

describe('DesignerAgent — UI spec + accessibility notes', () => {
  it('preserves components, colorPalette, typography, accessibilityNotes on DESIGN_UI', { timeout: 20_000 }, async () => {
    const agent = new DesignerAgent('stub-key');
    stubLLM(agent, {
      designSpec: 'Clean dashboard with primary action above the fold + filter sidebar.',
      components: [
        { name: 'PrimaryButton', variants: ['solid', 'outline'], usage: 'Hero CTAs' },
        { name: 'FilterSidebar', variants: ['collapsed', 'expanded'], usage: 'Data filtering' },
      ],
      colorPalette: { primary: '#0ea5e9', neutral: '#0f172a', accent: '#fbbf24' },
      typography: { heading: 'Inter 600', body: 'Inter 400', mono: 'JetBrains Mono' },
      layoutGrid: '12-column, 64px base unit, 24px gutter',
      accessibilityNotes: [
        'Contrast ratio ≥ 4.5:1 on body text (WCAG AA)',
        'All interactive targets ≥ 44×44 px',
        'Keyboard focus ring visible on every button',
      ],
      userFlowDescription: 'User lands → sees primary metric → clicks action → completes task in ≤3 steps',
      confidence: 0.86,
    });

    const result = await agent.execute(
      { action: 'DESIGN_UI', description: 'Ops dashboard for a multi-tenant SaaS' },
      stubContext(),
    );
    expect(result.components).toHaveLength(2);
    expect(result.colorPalette['primary']).toBe('#0ea5e9');
    expect(result.accessibilityNotes.length).toBeGreaterThanOrEqual(3);
    expect(result.accessibilityNotes.join(' ')).toMatch(/contrast|WCAG/i);
  });
});

// ─── Knowledge ─────────────────────────────────────────────────────────────

describe('KnowledgeAgent — RAG discipline', () => {
  it('preserves sources, suggestedRelated, confidence on SEARCH', async () => {
    const agent = new KnowledgeAgent('stub-key');
    stubLLM(agent, {
      results: [
        { id: 'doc-1', title: 'Incident runbook — payment outages', excerpt: 'If Stripe webhooks fail…', relevanceScore: 0.92, documentType: 'runbook', lastUpdated: '2026-03-10' },
        { id: 'doc-2', title: 'On-call rotation schedule', excerpt: 'P1 incidents route to…', relevanceScore: 0.78, documentType: 'policy' },
      ],
      summary: 'Two internal docs match. Primary runbook covers Stripe webhook failures.',
      confidence: 0.85,
      sources: ['doc-1', 'doc-2'],
      suggestedRelated: ['Stripe webhook retry policy', 'PagerDuty escalation config'],
    });

    const result = await agent.execute(
      { action: 'SEARCH', query: 'What to do on Stripe payment outage?' },
      stubContext(),
    );
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.relevanceScore).toBeGreaterThan(0.9);
    expect(result.sources).toContain('doc-1');
    expect(result.suggestedRelated).toHaveLength(2);
  });
});

// ─── Content ───────────────────────────────────────────────────────────────

describe('ContentAgent — long-form + SEO + social variants', () => {
  it('preserves seoMeta, socialVariants, wordCount on WRITE_BLOG', async () => {
    const agent = new ContentAgent('stub-key');
    stubLLM(agent, {
      content: '# Why your agent stack needs a control plane\n\nFull 1200-word blog body would go here...',
      headline: 'Why your agent stack needs a control plane (and how to build one)',
      summary: 'Walks through the durability, approvals, and tool-maturity primitives every AI team eventually builds.',
      seoMeta: {
        title: 'Agent Control Plane: Durability, Approvals, Tool Maturity — JAK Swarm',
        description: 'The boring-but-correct infrastructure every AI team eventually builds. Inside: durable queues, risk-stratified approvals, tool-maturity manifests.',
        keywords: ['agent control plane', 'durable workflows', 'AI approvals', 'tool maturity'],
      },
      socialVariants: [
        { platform: 'linkedin', text: 'Most AI teams ship 3 control planes before admitting they built one. Here is what the final version looks like →' },
        { platform: 'twitter', text: 'Your agent stack is a control plane. Stop pretending it is not.' },
      ],
      wordCount: 1240,
      confidence: 0.88,
    });

    const result = await agent.execute(
      { action: 'WRITE_BLOG', topic: 'Agent control plane architecture' },
      stubContext(),
    );
    expect(result.seoMeta?.title).toContain('Control Plane');
    expect(result.seoMeta?.keywords.length).toBeGreaterThanOrEqual(3);
    expect(result.socialVariants).toHaveLength(2);
    expect(result.wordCount).toBe(1240);
  });
});

// ─── SEO ───────────────────────────────────────────────────────────────────

describe('SEOAgent — P0/P1/P2/P3 prioritization', () => {
  it('preserves optimizations, technicalIssues, linkOpportunities on OPTIMIZE_PAGE', async () => {
    const agent = new SEOAgent('stub-key');
    stubLLM(agent, {
      summary: 'Page has a strong content base but Core Web Vitals and structured data need attention.',
      optimizations: [
        { item: 'Add hreflang tags for locale variants', priority: 'P1', effort: 'low', description: 'Multi-region site missing hreflang' },
        { item: 'Compress hero image', priority: 'P0', effort: 'low', description: '2.8MB PNG → <200kb WebP — LCP drops from 3.2s to ~1.5s' },
      ],
      technicalIssues: [
        { issue: 'Missing canonical tag on /blog', severity: 'high', fix: 'Add <link rel="canonical" href="..."/> to layout.tsx' },
      ],
      schemaMarkup: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script>',
      linkOpportunities: [
        { type: 'resource', target: 'awesome-llm-agents GitHub list', rationale: 'Matches our category' },
      ],
      gapAnalysis: [
        { keyword: 'ai workflow orchestration', opportunity: 'High volume, mid difficulty', difficulty: 'medium' },
      ],
      confidence: 0.82,
    });

    const result = await agent.execute(
      { action: 'OPTIMIZE_PAGE', url: 'https://example.com' },
      stubContext(),
    );
    expect(result.optimizations).toHaveLength(2);
    expect(result.optimizations?.[0]?.priority).toMatch(/^P[0-3]$/);
    expect(result.technicalIssues?.[0]?.severity).toBe('high');
    expect(result.linkOpportunities).toHaveLength(1);
  });
});

// ─── PR ────────────────────────────────────────────────────────────────────

describe('PRAgent — press release + media targets', () => {
  it('preserves keyMessages, mediaTargets, talkingPoints on DRAFT_PRESS_RELEASE', async () => {
    const agent = new PRAgent('stub-key');
    stubLLM(agent, {
      content: 'FOR IMMEDIATE RELEASE\n\nJAK Swarm announces operator-grade AI control plane...',
      keyMessages: [
        'First open-source AI control plane with risk-stratified approvals',
        'Durable across instance failures',
        'Tool-maturity manifest CI-enforced',
      ],
      mediaTargets: [
        { outlet: 'TechCrunch', journalist: 'Jane Doe', beat: 'Developer tools', relevance: 'Covers agent frameworks + infra' },
        { outlet: 'The Information', journalist: 'John Smith', beat: 'Enterprise AI', relevance: 'Covers B2B AI infrastructure' },
      ],
      talkingPoints: [
        'Why a control plane beats point tools',
        'How risk stratification prevents destructive AI actions',
        'What "operator-grade" means beyond demos',
      ],
      timeline: [
        { time: 'T-7 days', action: 'Embargoed press briefings', owner: 'PR' },
        { time: 'T-0 09:00 ET', action: 'Public announcement + blog post', owner: 'CMO' },
      ],
      confidence: 0.88,
    });

    const result = await agent.execute(
      { action: 'DRAFT_PRESS_RELEASE', topic: 'v1.0 launch' },
      stubContext(),
    );
    expect(result.keyMessages?.length).toBeGreaterThanOrEqual(2);
    expect(result.mediaTargets).toHaveLength(2);
    expect(result.mediaTargets?.[0]?.beat).toBeTruthy();
    expect(result.timeline?.[1]?.owner).toBe('CMO');
  });
});

// ─── Legal ─────────────────────────────────────────────────────────────────

describe('LegalAgent — risks + compliance items', () => {
  it('preserves risks (severity + clause) + complianceItems on REVIEW_CONTRACT', async () => {
    const agent = new LegalAgent('stub-key');
    stubLLM(agent, {
      summary: 'MSA review — 3 risks found, 2 compliance items flagged.',
      risks: [
        { risk: 'Unilateral price change clause', severity: 'high', clause: 'Section 6.2', recommendation: 'Require 60-day notice + right to terminate without penalty' },
        { risk: 'Unlimited indemnification', severity: 'high', clause: 'Section 11.3', recommendation: 'Cap indemnification at 12 months fees' },
        { risk: 'Auto-renewal without notice', severity: 'medium', clause: 'Section 2.4', recommendation: 'Require 30-day opt-out notice' },
      ],
      recommendations: [
        'Push back on Sections 6.2 and 11.3 before signing',
        'Attach our standard DPA + SCCs',
      ],
      complianceItems: [
        { item: 'GDPR Article 28 processor terms', status: 'missing', regulation: 'GDPR', action: 'Attach DPA Annex' },
        { item: 'SOC 2 audit reference', status: 'present', regulation: 'SOC 2', action: 'Confirm current report' },
      ],
      confidence: 0.9,
    });

    const result = await agent.execute(
      { action: 'REVIEW_CONTRACT', contractText: 'MSA content...' },
      stubContext(),
    );
    expect(result.risks).toHaveLength(3);
    expect(result.risks?.[0]?.severity).toBe('high');
    expect(result.risks?.[0]?.clause).toContain('6.2');
    expect(result.complianceItems).toHaveLength(2);
    expect(result.complianceItems?.[0]?.regulation).toBe('GDPR');
  });
});

// ─── Analytics ─────────────────────────────────────────────────────────────

describe('AnalyticsAgent — metrics + anomalies', () => {
  it('preserves metrics, insights, anomalies on CALCULATE_METRICS', async () => {
    const agent = new AnalyticsAgent('stub-key');
    stubLLM(agent, {
      summary: 'Week-over-week revenue up 12%, but signup conversion dropped 3pp — anomaly flagged.',
      metrics: {
        weeklyRevenue: 248_000,
        weeklyRevenueGrowth: 0.12,
        signupConversion: 0.079,
        signupConversionDelta: -0.03,
      },
      insights: [
        'Revenue growth driven by expansion (+$18k), not new logos',
        'Signup conversion drop correlates with onboarding flow change on 2026-04-15',
      ],
      anomalies: [
        { metric: 'signupConversion', value: 0.079, expected: 0.105, severity: 'high' },
      ],
      statisticalResults: { ttest_p: 0.003, sample_n: 4200 },
      confidence: 0.84,
    });

    const result = await agent.execute(
      { action: 'CALCULATE_METRICS', metricNames: ['weeklyRevenue', 'signupConversion'] },
      stubContext(),
    );
    expect(result.metrics?.['weeklyRevenue']).toBe(248_000);
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies?.[0]?.severity).toBe('high');
    expect(result.insights).toHaveLength(2);
  });
});

// ─── Project ───────────────────────────────────────────────────────────────

describe('ProjectAgent — timeline + risks + status report', () => {
  it('preserves timeline, risks, statusReport on STATUS_REPORT', async () => {
    const agent = new ProjectAgent('stub-key');
    stubLLM(agent, {
      summary: 'Project is Yellow — 2 blockers, on track for milestone 3 but at risk for milestone 4.',
      statusReport: {
        rag: 'yellow',
        percentComplete: 0.62,
        blockers: ['Waiting on vendor SDK bump', 'Design review for payment flow delayed 1w'],
        nextActions: ['Escalate vendor SDK to account manager', 'Move design review to Monday'],
      },
      risks: [
        { description: 'Vendor SDK delay blocks payment integration', probability: 0.6, impact: 0.8, score: 0.48, mitigation: 'Fork SDK and patch ourselves if not delivered by 2026-05-01', owner: 'Eng lead' },
      ],
      milestones: [
        { name: 'Beta launch', targetDate: '2026-05-15', status: 'on_track', dependencies: ['Payment integration'] },
        { name: 'GA launch', targetDate: '2026-06-30', status: 'at_risk', dependencies: ['Beta launch', 'Load testing'] },
      ],
      confidence: 0.86,
    });

    const result = await agent.execute(
      { action: 'STATUS_REPORT', projectName: 'Checkout v2' },
      stubContext(),
    );
    expect(result.statusReport?.rag).toBe('yellow');
    expect(result.statusReport?.blockers).toHaveLength(2);
    expect(result.risks?.[0]?.score).toBeCloseTo(0.48, 2);
    expect(result.milestones).toHaveLength(2);
    expect(result.milestones?.[1]?.status).toBe('at_risk');
  });
});

// ─── ScreenshotToCode ──────────────────────────────────────────────────────

describe('ScreenshotToCodeAgent — design tokens + components', () => {
  it('preserves components, designTokens, colorPalette, typography on ANALYZE_SCREENSHOT', async () => {
    const agent = new ScreenshotToCodeAgent('stub-key');
    stubLLM(agent, {
      layoutAnalysis: 'Two-column dashboard: 240px fixed sidebar, fluid main. Primary metric card at top of main.',
      components: [
        { name: 'Sidebar', role: 'navigation', bbox: { x: 0, y: 0, w: 240, h: 900 } },
        { name: 'MetricCard', role: 'data', bbox: { x: 280, y: 40, w: 400, h: 160 } },
      ],
      designTokens: [
        { name: 'color.primary', value: '#2563eb', category: 'color' },
        { name: 'spacing.md', value: '16px', category: 'spacing' },
        { name: 'radius.md', value: '8px', category: 'radius' },
      ],
      colorPalette: { primary: '#2563eb', surface: '#ffffff', muted: '#64748b' },
      typography: { heading: 'Inter 700 32px', body: 'Inter 400 14px' },
      overallDescription: 'Clean, data-dense SaaS admin UI with 2-column layout.',
      confidence: 0.82,
    });

    const result = await agent.execute(
      { action: 'ANALYZE_SCREENSHOT', imageBase64: 'base64...' },
      stubContext(),
    );
    expect(result.components).toHaveLength(2);
    expect(result.designTokens).toHaveLength(3);
    expect(result.designTokens?.[0]?.category).toBe('color');
    expect(result.colorPalette['primary']).toBe('#2563eb');
  });
});
