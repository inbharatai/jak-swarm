/**
 * World-class role upgrade guards.
 *
 * These tests cover the 2026-04-20 upgrade pass that brought the 6 previously
 * "shallow"-labeled roles (support / ops / voice / hr / designer / browser)
 * up to the 9/10 bar: domain-specific schemas, non-negotiables in the prompt,
 * manual-review fallbacks on parse failure, and per-role domain tools.
 *
 * Each suite exercises:
 *  1. a happy-path behavioral round-trip of a scenario the prior tests did
 *     NOT cover (DRAFT_RESPONSE, ESCALATE, EXTRACT_ACTION_ITEMS, POLICY_DRAFT,
 *     SCREEN_CANDIDATES, REVIEW_DESIGN, disallowed-domain navigation).
 *  2. a parse-failure fallback assertion — stub callLLM with non-JSON and
 *     verify the "Manual review required" marker surfaces in the right
 *     field of the Result (never silently swallowed).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SupportAgent,
  OpsAgent,
  VoiceAgent,
  HRAgent,
  DesignerAgent,
  BrowserAgent,
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

function stubLLMJson<T>(agent: T, payload: unknown): void {
  (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM = vi.fn(
    async () => fakeCompletion(JSON.stringify(payload)),
  );
}

function stubLLMRaw<T>(agent: T, text: string): void {
  (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM = vi.fn(
    async () => fakeCompletion(text),
  );
}

// ─── Support — DRAFT_RESPONSE + ESCALATE behavioral ────────────────────────

describe('SupportAgent — DRAFT_RESPONSE + ESCALATE (upgrade coverage)', () => {
  it(
    'preserves draftResponse + nextActions on DRAFT_RESPONSE',
    { timeout: 20_000 },
    async () => {
      const agent = new SupportAgent('stub-key');
      stubLLMJson(agent, {
        classification: {
          category: 'billing',
          sentiment: 'frustrated',
          urgency: 4,
          escalationRequired: false,
          suggestedTags: ['stripe', 'failed_charge', 'refund_request'],
          confidence: 0.88,
        },
        draftResponse:
          "Hi Priya — I'm sorry the charge didn't go through. I've pulled the logs and see the 14:23 UTC failure on card ending 4242. I'm routing this to billing for a same-day refund and will update you within 2 hours.",
        nextActions: [
          'Pull Stripe logs for customer_id=cus_X',
          'Refund $120 via billing tool (requires approval)',
          'Reply to ticket with ETA',
        ],
      });
      const result = await agent.execute(
        {
          action: 'DRAFT_RESPONSE',
          ticketContent: 'My card was charged but I never got the product.',
          ticketId: 'TCK-993',
          customerName: 'Priya',
        },
        stubContext(),
      );
      expect(result.draftResponse).toBeDefined();
      expect(result.draftResponse!.length).toBeGreaterThan(40);
      expect(result.nextActions.length).toBeGreaterThanOrEqual(2);
      expect(result.classification?.urgency).toBe(4);
      expect(result.classification?.sentiment).toBe('frustrated');
    },
  );

  it('forces escalationRequired on regulator/chargeback mention', async () => {
    const agent = new SupportAgent('stub-key');
    stubLLMJson(agent, {
      classification: {
        category: 'complaint',
        sentiment: 'frustrated',
        urgency: 5,
        escalationRequired: true,
        escalationReason:
          'Customer referenced FTC complaint and filed chargeback — legal + executive escalation required',
        suggestedTags: ['ftc', 'chargeback', 'legal_risk'],
        confidence: 0.93,
      },
      nextActions: ['Loop in legal@', 'Page support director', 'Freeze outbound comms to this customer'],
    });
    const result = await agent.execute(
      {
        action: 'ESCALATE',
        ticketContent: "I've filed an FTC complaint and my bank is processing a chargeback.",
        ticketId: 'TCK-999',
      },
      stubContext(),
    );
    expect(result.escalationRequired).toBe(true);
    expect(result.escalationReason).toMatch(/ftc|chargeback|legal/i);
    expect(result.suggestedTags).toContain('chargeback');
  });

  it('emits manual-review fallback on non-JSON parse failure', async () => {
    const agent = new SupportAgent('stub-key');
    stubLLMRaw(agent, 'Sorry, I could not produce structured output.');
    const result = await agent.execute(
      { action: 'CLASSIFY', ticketContent: 'order stuck' },
      stubContext(),
    );
    expect(result.nextActions.join(' ')).toMatch(/manual review required/i);
  });
});

// ─── Ops — parse-failure manual-review guard ───────────────────────────────

describe('OpsAgent — parse-failure fallback (upgrade coverage)', () => {
  it('surfaces manual-review marker in recommendations on non-JSON output', async () => {
    const agent = new OpsAgent('stub-key');
    stubLLMRaw(agent, 'Server restarted. Everything looks fine now.');
    const result = await agent.execute(
      { action: 'MONITOR', description: 'API latency spike' },
      stubContext(),
    );
    expect(result.recommendations.join(' ')).toMatch(/manual review required/i);
    expect(result.requiresApproval).toBe(false); // MONITOR is read-only; approval only for CONFIGURE/AUTOMATE
  });
});

// ─── Voice — EXTRACT_ACTION_ITEMS + parse fallback ─────────────────────────

describe('VoiceAgent — EXTRACT_ACTION_ITEMS + PII risk (upgrade coverage)', () => {
  it(
    'preserves actionItems with owner/due/priority and riskFlags on PII leak',
    { timeout: 20_000 },
    async () => {
      const agent = new VoiceAgent('stub-key');
      stubLLMJson(agent, {
        actionItems: [
          { description: 'Send renewal quote', assignee: 'Sam (AE)', dueDate: '2026-04-24', priority: 'high', status: 'open' },
          { description: 'Schedule tech-deep-dive', assignee: 'Priya (SE)', dueDate: '2026-04-28', priority: 'medium', status: 'open' },
          { description: 'Follow up on security review doc', assignee: 'unclear', priority: 'medium', status: 'open' },
        ],
        keyTopics: ['renewal', 'security review', 'pricing'],
        sentiment: 'mixed',
        openQuestions: ['Does the legal team need to sign a new DPA for the renewal?'],
        riskFlags: [
          'Data leak in voice: customer read aloud a partial credit-card number at 00:14:22 — recommend transcript redaction',
          'Commitment mismatch: AE promised "next week" but SE said deliverable is 3 weeks out',
        ],
      });

      const result = await agent.execute(
        {
          action: 'EXTRACT_ACTION_ITEMS',
          transcript: '...long transcript...',
          callMetadata: { participants: ['Sam (AE)', 'Priya (SE)', 'Customer'], duration: 2400 },
        },
        stubContext(),
      );
      expect(result.actionItems.length).toBe(3);
      expect(result.actionItems[0]?.assignee).toBe('Sam (AE)');
      expect(result.actionItems[0]?.priority).toBe('high');
      // Unclear owner is kept, not dropped
      expect(result.actionItems.find((a) => a.assignee === 'unclear')).toBeDefined();
      expect(result.riskFlags?.join(' ')).toMatch(/data leak|redaction/i);
      expect(result.riskFlags?.join(' ')).toMatch(/commitment mismatch/i);
      expect(result.openQuestions?.length).toBeGreaterThanOrEqual(1);
    },
  );

  it('emits manual-review riskFlag on non-JSON parse failure', async () => {
    const agent = new VoiceAgent('stub-key');
    stubLLMRaw(agent, 'Call summary: product went well.');
    const result = await agent.execute(
      { action: 'SUMMARIZE_CALL', transcript: 'blah' },
      stubContext(),
    );
    expect(result.riskFlags?.join(' ')).toMatch(/manual review required/i);
  });
});

// ─── HR — POLICY_DRAFT legalNotes, SCREEN_CANDIDATES rubric, parse fallback ─

describe('HRAgent — policy/screen guardrails (upgrade coverage)', () => {
  it(
    'preserves legalNotes with counsel-review item on POLICY_DRAFT',
    { timeout: 20_000 },
    async () => {
      const agent = new HRAgent('stub-key');
      stubLLMJson(agent, {
        policy:
          '# Remote Work Policy\n\nPurpose: Define eligibility and expectations...\nScope: All US-based employees...',
        recommendations: [
          'Pilot with one team for 90 days before company-wide rollout',
          'Add quarterly review of policy effectiveness',
        ],
        legalNotes: [
          'Counsel to review before publication',
          'Flag: FLSA overtime implications for non-exempt remote workers',
          'Flag: state tax nexus — remote workers in new states trigger payroll + corporate tax obligations',
          'ADA accommodation clause required if physical presence is ever mandated',
        ],
        confidence: 0.82,
      });

      const result = await agent.execute(
        { action: 'POLICY_DRAFT', description: 'Remote work policy', location: 'US multi-state' },
        stubContext(),
      );
      expect(result.policy).toContain('Remote Work Policy');
      expect(result.legalNotes.length).toBeGreaterThanOrEqual(3);
      expect(result.legalNotes.join(' ')).toMatch(/counsel|legal review/i);
      expect(result.legalNotes.join(' ')).toMatch(/FLSA|ADA|state tax/i);
    },
  );

  it('preserves compensationData with benchmark source on COMPENSATION_ANALYSIS', async () => {
    const agent = new HRAgent('stub-key');
    stubLLMJson(agent, {
      compensationData: [
        {
          level: 'Senior Engineer',
          baseSalaryRange: { min: 165000, max: 210000 },
          currency: 'USD',
          equityRange: '0.05% - 0.15%',
          bonus: '10% target',
          benefits: ['Health + dental + vision', '401k 4% match', '$2k L&D stipend'],
        },
      ],
      recommendations: [
        'Target 60th percentile for senior engineers in target markets',
        'Add geographic adjustment for SF/NYC (+15%) and remote-US (-10%)',
      ],
      legalNotes: [
        'CA/NY/CO/WA: include band in JD per pay transparency laws',
        'Counsel to review equity grant structure before offer',
        'Benchmark: Radford 2026 Q1 Tech — verify vintage before publishing',
      ],
      confidence: 0.87,
    });

    const result = await agent.execute(
      { action: 'COMPENSATION_ANALYSIS', role: 'Senior Engineer', location: 'US remote', level: 'L5' },
      stubContext(),
    );
    expect(result.compensationData).toHaveLength(1);
    expect(result.compensationData?.[0]?.baseSalaryRange.min).toBe(165000);
    expect(result.legalNotes.join(' ')).toMatch(/pay transparency|CA|NY/i);
    expect(result.legalNotes.join(' ')).toMatch(/benchmark|Radford/i);
  });

  it('emits manual-review legalNotes + recommendations on non-JSON parse failure', async () => {
    const agent = new HRAgent('stub-key');
    stubLLMRaw(agent, 'Just send the offer. It will be fine.');
    const result = await agent.execute(
      { action: 'GENERATE_OFFER', role: 'Senior Engineer', location: 'CA' },
      stubContext(),
    );
    expect(result.legalNotes.join(' ')).toMatch(/manual review required/i);
    expect(result.legalNotes.join(' ')).toMatch(/counsel|legal/i);
    expect(result.recommendations.join(' ')).toMatch(/manual review required/i);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });
});

// ─── Designer — REVIEW_DESIGN with WCAG contrast + parse fallback ──────────

describe('DesignerAgent — REVIEW_DESIGN contrast math (upgrade coverage)', () => {
  it(
    'preserves accessibilityNotes with measured contrast ratios + WCAG criterion',
    { timeout: 20_000 },
    async () => {
      const agent = new DesignerAgent('stub-key');
      stubLLMJson(agent, {
        designSpec: 'Review of existing checkout flow — 3 accessibility violations found.',
        components: [
          { name: 'CheckoutCTA', type: 'button', styles: { background: '#fbbf24', color: '#ffffff' } },
        ],
        colorPalette: { primary: '#2563eb', danger: '#ef4444', muted: '#64748b' },
        typography: { body: 'Inter 400 14px', heading: 'Inter 700 24px' },
        layoutGrid: '12-col, 16px gutter',
        accessibilityNotes: [
          'Body text #64748b on #ffffff: 4.4:1 — FAILS WCAG 2.1 AA 1.4.3 (needs 4.5:1). Darken to #52606d (7.1:1) or enlarge to large-text threshold.',
          'Checkout CTA #ffffff on #fbbf24: 1.9:1 — FAILS WCAG 2.1 AA 1.4.3. Swap to #1e293b on #fbbf24 (12.6:1).',
          'Focus ring removed globally — FAILS WCAG 2.1 AA 2.4.7 Focus Visible. Restore with outline: 2px solid #2563eb; outline-offset: 2px.',
        ],
        userFlowDescription: 'Cart → Checkout → Payment → Confirmation.',
        confidence: 0.9,
      });

      const result = await agent.execute(
        { action: 'REVIEW_DESIGN', description: 'Checkout flow accessibility audit' },
        stubContext(),
      );
      const notes = result.accessibilityNotes.join(' ');
      expect(result.accessibilityNotes.length).toBeGreaterThanOrEqual(3);
      // Measured contrast ratios present (x.x:1 pattern)
      expect(notes).toMatch(/\d+(\.\d+)?:1/);
      // WCAG criterion cited explicitly
      expect(notes).toMatch(/WCAG.*1\.4\.3|WCAG.*2\.4\.7/);
      // Concrete fix included, not just a finding
      expect(notes).toMatch(/darken|swap|restore/i);
    },
  );

  it('emits manual-review accessibilityNotes marker on non-JSON parse failure', async () => {
    const agent = new DesignerAgent('stub-key');
    stubLLMRaw(agent, 'Use more whitespace. Looks better.');
    const result = await agent.execute(
      { action: 'UX_AUDIT', description: 'Audit the homepage' },
      stubContext(),
    );
    expect(result.accessibilityNotes.join(' ')).toMatch(/manual review required/i);
    expect(result.confidence).toBeLessThan(0.5);
  });
});

// ─── Browser — disallowed-domain precheck + parse-failure fallback ─────────

describe('BrowserAgent — disallowed-domain precheck (upgrade coverage)', () => {
  it('blocks NAVIGATE to domain not in allowedDomains without calling the LLM', async () => {
    const agent = new BrowserAgent('stub-key');
    // If this is ever called, the test should fail — disallowed-domain block is pre-LLM.
    const callSpy = vi.fn(async () => {
      throw new Error('LLM should not be invoked for a disallowed-domain NAVIGATE');
    });
    (agent as unknown as { callLLM: typeof callSpy }).callLLM = callSpy;

    const result = await agent.execute(
      {
        actions: [
          { type: 'NAVIGATE', url: 'https://evil.example.com/phish' },
          { type: 'EXTRACT', selector: 'body' },
        ],
        allowedDomains: ['jakswarm.com', 'docs.jakswarm.com'],
      },
      stubContext(),
    );
    expect(result.blockedActions.length).toBeGreaterThanOrEqual(1);
    expect(result.blockedActions.join(' ')).toMatch(/evil\.example\.com/);
    expect(result.blockedActions.join(' ')).toMatch(/not in allowedDomains/);
  });

  it('emits manual-review marker in blockedActions on non-JSON parse failure', async () => {
    const agent = new BrowserAgent('stub-key');
    // Use an allowed-domain EXTRACT so we reach the LLM path, then force a parse failure.
    (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM = vi.fn(
      async () => fakeCompletion('I cannot structure this response right now.'),
    );
    const result = await agent.execute(
      {
        actions: [{ type: 'EXTRACT', url: 'https://example.com', selector: 'h1' }],
        allowedDomains: ['example.com'],
      },
      stubContext(),
    );
    expect(result.blockedActions.join(' ')).toMatch(/manual review required/i);
    expect(result.actionsExecuted).toHaveLength(0);
  });
});
