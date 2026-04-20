/**
 * Executive-tier role behavioral tests.
 *
 * Covers the 8 C-suite / executive roles (CEO / CMO / CTO / CFO / HR /
 * Senior PM / Customer Success / Growth) whose prompts are world-class in
 * ROLE_MANIFEST. Without these tests, "world-class" is a claim without a
 * regression guard — edit one prompt, drop a field in the parser, and the
 * product silently degrades.
 *
 * Same stubbed-LLM pattern as role-behavioral.test.ts: override `callLLM`,
 * feed canned structured JSON, assert the Result type round-trips with
 * every domain-specific field preserved (RICE matrix, scenarios, security
 * findings, comp bands, health scores, etc).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  StrategistAgent,
  MarketingAgent,
  TechnicalAgent,
  FinanceAgent,
  HRAgent,
  ProductAgent,
  SuccessAgent,
  GrowthAgent,
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

function stubLLM<T>(agent: T, jsonPayload: unknown): void {
  (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM =
    vi.fn(async () => fakeCompletion(JSON.stringify(jsonPayload)));
}

// ─── CEO / Strategist ──────────────────────────────────────────────────────

describe('StrategistAgent (CEO) — strategic analysis output schema', () => {
  it('preserves recommendations + risks + opportunities + framework on STRATEGIC_ANALYSIS', { timeout: 20_000 }, async () => {
    const agent = new StrategistAgent('stub-key');
    stubLLM(agent, {
      analysis: 'Market is bifurcating between enterprise and SMB — we have an attacker advantage in SMB due to self-serve onboarding.',
      recommendations: [
        { recommendation: 'Double down on SMB self-serve; postpone enterprise RFP pursuit', rationale: 'SMB has 3× faster sales cycle and matches our product strengths', priority: 'HIGH', timeline: 'Q2' },
        { recommendation: 'Build a partner program for mid-market channel', rationale: 'Expands TAM without direct-sales spend', priority: 'MEDIUM', timeline: 'Q3' },
      ],
      risks: ['Enterprise competitors moving down-market', 'Partner program dilutes brand if not curated'],
      opportunities: ['Self-serve ARR compounding', 'EU GDPR differentiation'],
      framework: "Porter's Five Forces + McKinsey 3-Horizon",
      metrics: ['MQL → SQL conversion', 'Self-serve activation rate', 'Partner-sourced ARR'],
      timeline: '2026 Q2-Q4',
      confidence: 0.82,
    });

    const result = await agent.execute(
      { action: 'STRATEGIC_ANALYSIS', description: 'Evaluate SMB vs enterprise focus for 2026', market: 'US SaaS', competitors: ['Incumbent A', 'Incumbent B'] },
      stubContext(),
    );

    expect(result.action).toBe('STRATEGIC_ANALYSIS');
    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations[0]?.priority).toBe('HIGH');
    expect(result.recommendations[0]?.timeline).toBe('Q2');
    expect(result.risks).toContain('Enterprise competitors moving down-market');
    expect(result.opportunities).toHaveLength(2);
    expect(result.framework).toContain('Porter');
    expect(result.metrics.length).toBeGreaterThanOrEqual(3);
    expect(result.confidence).toBe(0.82);
  });

  it('falls back with confidence lowered on non-JSON output', async () => {
    const agent = new StrategistAgent('stub-key');
    (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM = vi.fn(
      async () => fakeCompletion('Not JSON at all'),
    );
    const result = await agent.execute({ action: 'STRATEGIC_ANALYSIS' }, stubContext());
    // Analysis carries the raw content (prefixed or not)
    expect(result.analysis).toContain('Not JSON at all');
    // Upgrade 2026-04-20: parse-failure fallback now carries an explicit
    // "Manual review required" recommendation instead of silently returning [].
    expect(result.recommendations.length).toBe(1);
    expect(result.recommendations[0]?.title).toMatch(/manual review/i);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });
});

// ─── CMO / Marketing ───────────────────────────────────────────────────────

describe('MarketingAgent (CMO) — GTM + campaign output schema', () => {
  it('preserves strategy, channels, kpis, budget, contentCalendar on GTM_STRATEGY', async () => {
    const agent = new MarketingAgent('stub-key');
    stubLLM(agent, {
      strategy: 'Category-creation around AI operator control plane; anchor launch at target dev conf.',
      targetAudience: 'Platform engineers + VPEng at Series B-D SaaS',
      messaging: 'Every AI team ships a control plane. Build one, not three.',
      channels: ['Content (long-form)', 'Conference sponsorships', 'LinkedIn thought leadership', 'Webinar series'],
      budget: '$180k for Q1-Q2',
      kpis: ['CTR on category-page', 'Conference attributed demos', 'Newsletter subscribers > 5k'],
      contentCalendar: [
        { title: 'Why every AI team needs a control plane', date: '2026-05-06', channel: 'Blog + LinkedIn', owner: 'CMO' },
        { title: 'How we run risk-stratified approvals at scale', date: '2026-05-20', channel: 'Webinar', owner: 'VPEng' },
      ],
      competitiveAnalysis: 'Existing tools are point products (Cursor for code, Clay for enrichment). JAK owns the plane, not the app.',
      confidence: 0.88,
    });

    const result = await agent.execute(
      { action: 'GTM_STRATEGY', product: 'JAK Swarm', targetMarket: 'B2B SaaS platform teams', budget: 180000 },
      stubContext(),
    );

    expect(result.strategy).toContain('control plane');
    expect(result.channels).toHaveLength(4);
    expect(result.kpis).toContain('Newsletter subscribers > 5k');
    expect(result.contentCalendar).toHaveLength(2);
    expect(result.contentCalendar?.[0]?.owner).toBe('CMO');
    expect(result.competitiveAnalysis).toBeTruthy();
    expect(result.confidence).toBe(0.88);
  });
});

// ─── CTO / Technical ───────────────────────────────────────────────────────

describe('TechnicalAgent (CTO) — architecture + security output schema', () => {
  it('preserves tradeoffs + securityFindings + scalabilityNotes on SYSTEM_DESIGN', async () => {
    const agent = new TechnicalAgent('stub-key');
    stubLLM(agent, {
      architecture: 'Multi-tenant event-driven microservices; Postgres primary with Redis for coordination + cache; Kafka for inter-service events.',
      techStack: ['TypeScript', 'Fastify', 'Postgres 15', 'Redis 7', 'Kafka', 'Kubernetes'],
      tradeoffs: [
        { decision: 'Microservices vs modular monolith', chosen: 'Modular monolith for now', alternatives: ['Microservices', 'Serverless'], reasoning: 'Team size <10 eng — microservices overhead > benefit. Reassess at 30+ eng.' },
        { decision: 'Postgres vs DynamoDB for tenant data', chosen: 'Postgres', alternatives: ['DynamoDB'], reasoning: 'Relational queries + row-level security needed; DynamoDB forces workarounds.' },
      ],
      recommendations: ['Start with modular monolith', 'Extract auth service only if it becomes a bottleneck'],
      risks: ['Single-DB bottleneck at >10k tenants', 'Kafka adds operational complexity — budget for it'],
      diagramDescription: 'API gateway → modular monolith (auth / workflow / tools / billing) → Postgres + Redis; async tasks via Kafka',
      scalabilityNotes: 'Horizontal scale on API layer with sticky sessions until Redis SSE relay covers cross-instance streaming. DB read-replica at >5k tenants.',
      securityFindings: [
        { severity: 'HIGH', finding: 'Approval gate uses short-lived JWT — should also check per-tenant role grants server-side', remediation: 'Add enforceTenantIsolation + role check on every approval action' },
        { severity: 'MEDIUM', finding: 'Webhook endpoints lack HMAC verification for Slack bridge', remediation: 'Implement SLACK_SIGNING_SECRET validation' },
      ],
      confidence: 0.85,
    });

    const result = await agent.execute(
      { action: 'SYSTEM_DESIGN', description: 'Multi-tenant platform for 10k+ tenants', scale: { users: 100000, rps: 500 } },
      stubContext(),
    );

    expect(result.tradeoffs).toHaveLength(2);
    expect(result.tradeoffs[0]?.chosen).toContain('monolith');
    expect(result.tradeoffs[0]?.reasoning).toContain('Team size');
    expect(result.securityFindings).toHaveLength(2);
    expect(result.securityFindings[0]?.severity).toBe('HIGH');
    expect(result.securityFindings[0]?.remediation).toBeTruthy();
    expect(result.scalabilityNotes).toContain('read-replica');
    expect(result.risks).toContain('Single-DB bottleneck at >10k tenants');
  });
});

// ─── CFO / Finance ─────────────────────────────────────────────────────────

describe('FinanceAgent (CFO) — scenarios + metrics output schema', () => {
  it('preserves scenarios (best/likely/worst) + metrics + assumptions on REVENUE_FORECAST', async () => {
    const agent = new FinanceAgent('stub-key');
    stubLLM(agent, {
      analysis: 'Revenue grows from $2.4M ARR to $8.5M in the likely case driven by self-serve expansion.',
      metrics: {
        currentARR: 2400000,
        projectedARR_12mo: 8500000,
        grossMargin: 0.82,
        paybackMonths: 11,
        netRevenueRetention: 1.18,
      },
      assumptions: [
        'Win rate on inbound stays at 23%',
        'Enterprise motion contributes <15% until Q4',
        'Paddle fees at 5% on self-serve, negotiated down to 3% at scale',
      ],
      projections: 'See scenario breakdown — likely case assumes 25% QoQ growth, best case 40%, worst case flat at 10%.',
      scenarios: {
        best:   { period: '2026', revenue: 11200000, growth: 0.40, notes: 'Requires signing 2 enterprise logos' },
        likely: { period: '2026', revenue: 8500000,  growth: 0.25, notes: 'Self-serve continues, no enterprise' },
        worst:  { period: '2026', revenue: 3100000,  growth: 0.10, notes: 'Churn spikes + no new enterprise' },
      },
      recommendations: [
        'Hire 1 AE dedicated to mid-market — pays back in 8 months at current conversion',
        'Delay second office lease until NRR confirms at >1.2',
      ],
      risks: ['Paddle fee renegotiation dependency', 'Enterprise pipeline has 2 concentrated accounts'],
      confidence: 0.78,
    });

    const result = await agent.execute(
      { action: 'REVENUE_FORECAST', description: '12-month forecast', timeHorizon: '2026', currency: 'USD', companyStage: 'series-a' },
      stubContext(),
    );

    expect(result.metrics.currentARR).toBe(2400000);
    expect(result.metrics.netRevenueRetention).toBeGreaterThan(1);
    expect(result.assumptions).toHaveLength(3);
    expect(result.scenarios?.best?.revenue).toBe(11200000);
    expect(result.scenarios?.likely?.growth).toBe(0.25);
    expect(result.scenarios?.worst?.notes).toContain('Churn');
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});

// ─── HR ────────────────────────────────────────────────────────────────────

describe('HRAgent — JD + interview plan + comp + legal notes output schema', () => {
  it('preserves jobDescription + interviewPlan + legalNotes on JOB_DESCRIPTION', async () => {
    const agent = new HRAgent('stub-key');
    stubLLM(agent, {
      jobDescription: 'Senior Platform Engineer — Remote US. Responsibilities: own the distributed workflow queue, approval gate, and tenant isolation...',
      interviewPlan: [
        { stage: 'Recruiter screen', durationMinutes: 30, interviewers: ['Recruiter'], focus: 'Fit + motivation', rubric: ['Communicates clearly', 'Understands the mission'] },
        { stage: 'Technical deep-dive', durationMinutes: 90, interviewers: ['Principal Eng'], focus: 'Distributed systems + Postgres', rubric: ['Designs correct leader election', 'Reasons about FOR UPDATE SKIP LOCKED trade-offs'] },
        { stage: 'Culture + leadership', durationMinutes: 45, interviewers: ['VP Eng', 'CEO'], focus: 'Ownership + collaboration', rubric: ['Drives projects to completion', 'Handles disagreement well'] },
      ],
      recommendations: ['Include live coding on tenant isolation', 'Skip the "whiteboard sort" test — low signal'],
      legalNotes: [
        'Job post must comply with pay transparency laws in CO, NY, WA, CA (include salary range)',
        'Avoid gendered language — use "they" not "he/she"',
        'EEOC: no questions about age, marital status, nationality',
      ],
      confidence: 0.9,
    });

    const result = await agent.execute(
      { action: 'JOB_DESCRIPTION', role: 'Senior Platform Engineer', level: 'senior', location: 'Remote US' },
      stubContext(),
    );

    expect(result.jobDescription).toContain('Platform Engineer');
    expect(result.interviewPlan).toHaveLength(3);
    expect(result.interviewPlan?.[1]?.rubric).toContain('Designs correct leader election');
    expect(result.legalNotes.length).toBeGreaterThanOrEqual(3);
    expect(result.legalNotes.join(' ')).toMatch(/pay transparency/i);
  });

  it('preserves compensationData with bands on COMPENSATION_ANALYSIS', async () => {
    const agent = new HRAgent('stub-key');
    stubLLM(agent, {
      compensationData: [
        { role: 'Senior Platform Engineer', level: 'L5', baseSalaryMin: 180000, baseSalaryMax: 230000, equityRange: '0.08% - 0.15%', totalComp: '$220k - $290k', region: 'US Remote', source: 'Levels.fyi 2026 + Radford survey' },
      ],
      recommendations: ['Our current offers are 8% below the 50th percentile — raise bands before next hire cycle'],
      legalNotes: ['Pay transparency laws require salary range in job posts for CO/NY/WA/CA'],
      confidence: 0.85,
    });
    const result = await agent.execute(
      { action: 'COMPENSATION_ANALYSIS', role: 'Senior Platform Engineer', level: 'senior' },
      stubContext(),
    );
    expect(result.compensationData?.[0]?.baseSalaryMin).toBe(180000);
    expect(result.compensationData?.[0]?.region).toBe('US Remote');
    expect(result.recommendations[0]).toContain('8%');
  });
});

// ─── Product (Sr PM) ───────────────────────────────────────────────────────

describe('ProductAgent (Sr PM) — RICE + user stories + roadmap output schema', () => {
  it('preserves priorityMatrix RICE, userStories, competitiveGaps on WRITE_SPEC', async () => {
    const agent = new ProductAgent('stub-key');
    stubLLM(agent, {
      summary: 'PRD: Add audit-log export so compliance-heavy tenants can feed JAK activity to their SIEM.',
      document: {
        problem: 'Finance + HR customers cannot satisfy SOC 2 controls without structured export',
        goals: ['Export audit log as NDJSON + CSV', 'Per-tenant filter', 'Signed URLs'],
        nonGoals: ['Real-time streaming (separate epic)'],
      },
      userStories: [
        { persona: 'Compliance officer', goal: 'Export 90 days of audit logs', benefit: 'Ship SOC 2 evidence without engineering tickets', acceptanceCriteria: ['NDJSON + CSV format', 'Includes reviewer identity on approvals', 'Signed URL expires in 15 min'] },
        { persona: 'Admin', goal: 'Schedule monthly exports', benefit: 'Set and forget', acceptanceCriteria: ['Cron-based schedule', 'Delivery to S3 bucket of choice'] },
      ],
      priorityMatrix: [
        { feature: 'Audit log export NDJSON+CSV', reach: 120, impact: 3, confidence: 0.9, effort: 2, riceScore: 162 },
        { feature: 'Scheduled export to S3', reach: 40, impact: 2, confidence: 0.7, effort: 3, riceScore: 19 },
        { feature: 'SIEM-native format (Splunk HEC)', reach: 15, impact: 3, confidence: 0.5, effort: 4, riceScore: 6 },
      ],
      competitiveGaps: [
        { feature: 'Audit log export', us: 'Not available', competitor: 'Ramp + Vanta both ship this', gap: 'Table-stakes for compliance personas' },
      ],
      confidence: 0.88,
    });

    const result = await agent.execute(
      { action: 'WRITE_SPEC', feature: 'Audit log export', targetUser: 'Compliance officer' },
      stubContext(),
    );

    expect(result.userStories).toHaveLength(2);
    expect(result.userStories?.[0]?.acceptanceCriteria).toHaveLength(3);
    expect(result.priorityMatrix).toHaveLength(3);
    // RICE = reach × impact × confidence / effort = 120 * 3 * 0.9 / 2 = 162
    expect(result.priorityMatrix?.[0]?.riceScore).toBe(162);
    expect(result.competitiveGaps?.[0]?.competitor).toContain('Ramp');
  });
});

// ─── Success (VP CS) ───────────────────────────────────────────────────────

describe('SuccessAgent (VP CS) — health + churn + upsell output schema', () => {
  it('preserves healthScore + churnRisk + upsellOpportunities on SCORE_HEALTH', async () => {
    const agent = new SuccessAgent('stub-key');
    stubLLM(agent, {
      summary: 'Customer shows YELLOW health — declining usage + one open escalation, but strong NPS.',
      healthScore: 58,
      churnRisk: 0.35,
      plan: {
        tier: 'YELLOW',
        triggerActions: ['Proactive outreach by CSM within 48h', 'Surface the escalation to product'],
        successPlan: '30-day re-engagement with weekly check-ins',
      },
      upsellOpportunities: [
        'Their API usage is at 80% of plan — propose tier upgrade',
        'They asked about SAML SSO last month — Enterprise add-on',
      ],
      recommendations: [
        'Schedule executive business review within 2 weeks',
        'Assign a dedicated CSM (currently pool)',
      ],
      confidence: 0.82,
    });

    const result = await agent.execute(
      { action: 'SCORE_HEALTH', customerName: 'Acme Corp', healthData: { usageFrequency: 0.5, featureAdoption: 0.4, supportTicketVolume: 3, nps: 8 } },
      stubContext(),
    );

    expect(result.healthScore).toBe(58);
    expect(result.churnRisk).toBeGreaterThan(0);
    expect(result.upsellOpportunities).toHaveLength(2);
    expect(result.upsellOpportunities?.[0]).toContain('tier upgrade');
    expect(result.plan).toMatchObject({ tier: 'YELLOW' });
  });
});

// ─── Growth ────────────────────────────────────────────────────────────────

describe('GrowthAgent — lead scoring / enrichment output schema', () => {
  it('preserves data + metrics + recommendations on LEAD_SCORING', async () => {
    const agent = new GrowthAgent('stub-key');
    stubLLM(agent, {
      summary: '3 leads scored — 1 hot (A-grade), 2 warm (B-grade). No cold leads in batch.',
      data: {
        scores: [
          { contact: 'Jordan @ Acme', grade: 'A', score: 82, signals: ['ICP match', 'Recent funding', 'Growing team 50%'], recommendedAction: 'AE outreach within 24h with tailored demo' },
          { contact: 'Priya @ Beta', grade: 'B', score: 61, signals: ['Partial ICP', 'Active on LinkedIn'], recommendedAction: 'Automated nurture sequence' },
          { contact: 'Sam @ Gamma', grade: 'B', score: 58, signals: ['Small team', 'Strong engineering brand'], recommendedAction: 'LinkedIn connect + soft outreach' },
        ],
      },
      metrics: { batchSize: 3, aGrade: 1, bGrade: 2, cGrade: 0, avgScore: 67 },
      recommendations: [
        'Route Jordan to an AE today',
        'Add Priya + Sam to drip sequence 4',
      ],
      confidence: 0.76,
    });

    const result = await agent.execute(
      { action: 'LEAD_SCORING', contacts: [{ name: 'Jordan', email: 'jordan@acme.com', company: 'Acme' }] },
      stubContext(),
    );

    expect(result.summary).toContain('A-grade');
    expect(result.metrics['batchSize']).toBe(3);
    expect(result.metrics['avgScore']).toBe(67);
    expect(result.recommendations.length).toBeGreaterThan(0);
    // Data shape is permissive on GrowthResult — assert the round-trip preserved the scores array.
    const scores = (result.data as { scores?: unknown[] }).scores ?? [];
    expect(scores).toHaveLength(3);
  });
});
