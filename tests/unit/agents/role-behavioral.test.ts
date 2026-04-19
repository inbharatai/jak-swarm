/**
 * Role behavioral tests — Session 8
 *
 * For each of the 4 roles upgraded in Session 8 (Email, CRM, Research, Calendar),
 * assert that when the LLM returns a well-formed expert response, the agent:
 *   - parses it into its structured result type
 *   - preserves the expert-mode optional fields (deliverability, dealHealth,
 *     disagreements, recommendedSlot, etc.)
 *   - doesn't drop them into the freeform fallback
 *
 * We stub `callLLM` on each agent instance to return canned completions so
 * the test runs without network or API keys. The assertions check schema
 * round-tripping, not prose quality — LLM quality is measured elsewhere.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  EmailAgent,
  CRMAgent,
  ResearchAgent,
  CalendarAgent,
  AgentContext,
} from '@jak-swarm/agents';
import type OpenAI from 'openai';

function stubContext(): AgentContext {
  return new AgentContext({ tenantId: 't-1', userId: 'u-1', workflowId: 'wf-1' });
}

/**
 * Build a fake OpenAI.ChatCompletion containing `content` as the assistant
 * final reply (no tool calls — one-shot path). Shape matches what callLLM
 * returns in the base agent's tool loop.
 */
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
        message: {
          role: 'assistant',
          content,
          refusal: null,
        },
      } as unknown as OpenAI.Chat.Completions.ChatCompletion.Choice,
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

/** Patch callLLM on an agent instance to return a canned JSON payload. */
function stubLLM<T extends { [k: string]: unknown }>(
  agent: T,
  jsonPayload: unknown,
): void {
  // BaseAgent.callLLM is protected — cast through unknown to override on the instance.
  (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM =
    vi.fn(async () => fakeCompletion(JSON.stringify(jsonPayload)));
}

describe('EmailAgent — expert-mode output schema', () => {
  it('preserves deliverability + abVariants + sendTimeSuggestion on DRAFT', async () => {
    const agent = new EmailAgent('stub-key');
    stubLLM(agent, {
      draft: {
        id: 'draft-1',
        to: ['buyer@acme.com'],
        subject: 'How Acme can cut 30% onboarding time',
        preheader: 'Five minutes, one integration, measurable outcome',
        body: 'Hi Jordan — quick note…',
        createdAt: '2026-04-19T10:00:00Z',
      },
      deliverability: {
        safetyScore: 82,
        spamTriggers: [],
        notes: ['Single ask present', 'Short enough for mobile'],
        missingUnsubscribe: false,
        authenticationAdvisory: true,
      },
      abVariants: [
        { label: 'benefit', subject: 'Cut 30% onboarding time', hypothesis: 'quantified benefit-led' },
        { label: 'curiosity', subject: 'What we learned from Acme last quarter', hypothesis: 'name-drop + curiosity' },
      ],
      sendTimeSuggestion: '2026-04-22T14:00:00-04:00',
      complianceNotes: ['CAN-SPAM compliant (unsubscribe present in footer template)'],
      requiresApproval: false,
    });

    const result = await agent.execute(
      { action: 'DRAFT', draftContent: { to: ['buyer@acme.com'], subject: 's', body: 'b' } },
      stubContext(),
    );

    expect(result.action).toBe('DRAFT');
    expect(result.draft?.preheader).toBe('Five minutes, one integration, measurable outcome');
    expect(result.deliverability?.safetyScore).toBe(82);
    expect(result.deliverability?.authenticationAdvisory).toBe(true);
    expect(result.abVariants).toHaveLength(2);
    expect(result.abVariants?.[0]?.label).toBe('benefit');
    expect(result.sendTimeSuggestion).toMatch(/2026-04-22/);
    expect(result.complianceNotes).toContain(
      'CAN-SPAM compliant (unsubscribe present in footer template)',
    );
  });

  it('still gates SEND behind approval regardless of LLM output', async () => {
    const agent = new EmailAgent('stub-key');
    // Even if the LLM returned requiresApproval=false, the agent should enforce it.
    stubLLM(agent, { requiresApproval: false });

    const result = await agent.execute(
      { action: 'SEND', draftContent: { to: ['x@y.com'], subject: 's', body: 'b' } },
      stubContext(),
    );
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalReason).toContain('approval');
  });
});

describe('CRMAgent — expert-mode output schema', () => {
  it('preserves dealHealth + qualification + riskFlags on SEARCH_DEALS', async () => {
    const agent = new CRMAgent('stub-key');
    stubLLM(agent, {
      deals: [{ id: 'd-1', name: 'Acme annual', stage: 'negotiation' }],
      dealHealth: [
        {
          dealId: 'd-1',
          healthScore: 42,
          stage: 'negotiation',
          daysInStage: 34,
          risks: ['no reply in 14 days', 'single-threaded — only 1 contact'],
          nextBestActions: [
            'reach out to VP Eng as second contact',
            'propose 30-min pricing conversation',
          ],
        },
      ],
      qualification: [
        {
          contactId: 'c-1',
          score: 74,
          framework: 'BANT',
          signals: { budget: 'mid', authority: 'decision_maker', need: 'must_have', timing: 'this_quarter' },
        },
      ],
      riskFlags: ['Possible duplicate of contact c-42'],
    });

    const result = await agent.execute({ action: 'SEARCH_DEALS' }, stubContext());
    expect(result.dealHealth?.[0]?.healthScore).toBe(42);
    expect(result.dealHealth?.[0]?.risks).toHaveLength(2);
    expect(result.dealHealth?.[0]?.nextBestActions).toHaveLength(2);
    expect(result.qualification?.[0]?.framework).toBe('BANT');
    expect(result.qualification?.[0]?.signals.authority).toBe('decision_maker');
    expect(result.riskFlags).toContain('Possible duplicate of contact c-42');
  });

  it('still gates UPDATE behind approval', async () => {
    const agent = new CRMAgent('stub-key');
    stubLLM(agent, { requiresApproval: false });

    const result = await agent.execute(
      { action: 'UPDATE', contactId: 'c-1', updateData: { title: 'VP Eng' } },
      stubContext(),
    );
    expect(result.requiresApproval).toBe(true);
    expect(result.updatedRecord).toMatchObject({ contactId: 'c-1' });
  });
});

describe('ResearchAgent — expert-mode output schema', () => {
  it('preserves disagreements + citations + overallFreshness', async () => {
    const agent = new ResearchAgent('stub-key');
    stubLLM(agent, {
      findings: 'Claude 4.6 and GPT-4o benchmarks conflict on coding accuracy.',
      keyPoints: ['Anthropic reports 72% SWE-Bench', 'OpenAI disputes methodology'],
      sources: [
        {
          title: 'Anthropic announcement',
          url: 'https://anthropic.com/claude-4-6',
          excerpt: '72%',
          relevanceScore: 0.95,
          qualityTier: 1,
          freshness: 'fresh',
        },
        {
          title: 'OpenAI blog response',
          url: 'https://openai.com/blog/x',
          excerpt: 'methodology differs',
          relevanceScore: 0.85,
          qualityTier: 1,
          freshness: 'fresh',
        },
      ],
      disagreements: [
        {
          point: 'Which model leads on SWE-Bench',
          positions: [
            { claim: 'Claude 4.6 at 72%', supportingSources: ['Anthropic announcement'] },
            { claim: 'Methodology disputed', supportingSources: ['OpenAI blog response'] },
          ],
          analystView: 'Anthropic result uses harder subset; direct comparison with GPT-4o requires same eval harness.',
        },
      ],
      citations: [
        { claim: 'Claude 4.6 SWE-Bench score', sourceIndices: [0] },
        { claim: 'Disputed methodology', sourceIndices: [1] },
      ],
      overallFreshness: 'fresh',
      confidence: 0.72,
      limitations: ['Public benchmarks only — not enterprise eval data'],
    });

    const result = await agent.execute({ query: 'Claude 4.6 vs GPT-4o coding accuracy' }, stubContext());
    expect(result.disagreements).toHaveLength(1);
    expect(result.disagreements?.[0]?.positions).toHaveLength(2);
    expect(result.disagreements?.[0]?.analystView).toContain('harder subset');
    expect(result.citations).toHaveLength(2);
    expect(result.overallFreshness).toBe('fresh');
    expect(result.sources[0]?.qualityTier).toBe(1);
    expect(result.confidence).toBe(0.72);
  });

  it('falls back gracefully when LLM returns non-JSON', async () => {
    const agent = new ResearchAgent('stub-key');
    (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM = vi.fn(
      async () => fakeCompletion('This is definitely not JSON at all'),
    );
    const result = await agent.execute({ query: 'anything' }, stubContext());
    expect(result.query).toBe('anything');
    expect(result.findings).toContain('not JSON');
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.limitations.join(' ')).toMatch(/plain text/i);
  });
});

describe('CalendarAgent — expert-mode output schema', () => {
  it('preserves recommendedSlot + conflicts + meetingType on FIND_AVAILABILITY', async () => {
    const agent = new CalendarAgent('stub-key');
    stubLLM(agent, {
      availability: [
        { start: '2026-04-22T14:00:00Z', end: '2026-04-22T14:30:00Z', durationMinutes: 30, conflictCount: 0 },
        { start: '2026-04-22T18:00:00Z', end: '2026-04-22T18:30:00Z', durationMinutes: 30, conflictCount: 1 },
      ],
      recommendedSlot: {
        slot: { start: '2026-04-22T14:00:00Z', end: '2026-04-22T14:30:00Z', durationMinutes: 30, conflictCount: 0 },
        reasons: [
          'All attendees in business hours (9-5 local)',
          'No soft conflicts',
          'Tue is a preferred day',
        ],
        quality: 75,
      },
      conflicts: [
        {
          attendee: 'buyer@acme.com',
          conflictWith: 'Weekly ops sync',
          start: '2026-04-22T18:00:00Z',
          end: '2026-04-22T18:30:00Z',
          severity: 'soft',
        },
      ],
      meetingType: 'external',
      appliedBufferMinutes: 10,
    });

    const result = await agent.execute(
      {
        action: 'FIND_AVAILABILITY',
        attendees: ['buyer@acme.com', 'seller@us.com'],
        durationMinutes: 30,
        timezone: 'America/New_York',
      },
      stubContext(),
    );
    expect(result.availability).toHaveLength(2);
    expect(result.recommendedSlot?.quality).toBe(75);
    expect(result.recommendedSlot?.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.conflicts?.[0]?.severity).toBe('soft');
    expect(result.meetingType).toBe('external');
    expect(result.appliedBufferMinutes).toBe(10);
  });

  it('gates CREATE_EVENT behind approval regardless of LLM output', async () => {
    const agent = new CalendarAgent('stub-key');
    stubLLM(agent, { requiresApproval: false });

    const result = await agent.execute(
      {
        action: 'CREATE_EVENT',
        eventDetails: {
          title: 'Discovery call',
          start: '2026-04-22T14:00:00Z',
          end: '2026-04-22T14:30:00Z',
        },
      },
      stubContext(),
    );
    expect(result.requiresApproval).toBe(true);
    expect(result.createdEvent?.title).toBe('Discovery call');
  });
});
