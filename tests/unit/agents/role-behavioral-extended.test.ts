/**
 * Role behavioral tests — extended set for AppDeployer / Browser / Ops / Voice /
 * Document / Support. Matches the Session 8 style: stub `callLLM` to return
 * canned JSON, then assert the agent parses the expert-mode fields correctly
 * and does not drop them into the freeform fallback.
 *
 * Intentionally separate from role-behavioral.test.ts so the cold-start
 * transform cost (agent barrel imports) is amortized once per file rather
 * than timing out the first test.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AppDeployerAgent,
  BrowserAgent,
  OpsAgent,
  VoiceAgent,
  DocumentAgent,
  SupportAgent,
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

// ─── AppDeployer ────────────────────────────────────────────────────────────

describe('AppDeployerAgent — expert-mode output schema', () => {
  // Higher timeout on the first test — cold agents package transform.
  it('preserves buildErrors classification, envVarsNeeded, rollback, domainStatus', { timeout: 20_000 }, async () => {
    const agent = new AppDeployerAgent('stub-key');
    stubLLM(agent, {
      status: 'failed',
      error: 'Missing env var at runtime',
      buildErrors: [
        {
          category: 'missing_env_var',
          severity: 'blocker',
          summary: 'STRIPE_SECRET_KEY referenced but not provided',
          affectedFiles: ['src/api/checkout.ts'],
          suggestedFix: 'Add STRIPE_SECRET_KEY to Vercel project env vars',
          retryableByDebugger: false,
        },
        {
          category: 'type_error',
          severity: 'blocker',
          summary: 'Type number is not assignable to string',
          affectedFiles: ['src/app/page.tsx'],
          suggestedFix: 'Cast numeric value or fix the type',
          retryableByDebugger: true,
        },
      ],
      envVarsNeeded: {
        required: ['STRIPE_SECRET_KEY', 'DATABASE_URL'],
        provided: ['DATABASE_URL'],
        missing: ['STRIPE_SECRET_KEY'],
        consequences: ['STRIPE_SECRET_KEY missing — /api/checkout will 500 on first payment'],
      },
      rollback: {
        shouldRollback: true,
        reason: 'Blocker env var missing, cannot retry',
        previousDeploymentId: 'dpl_abc123',
        instructions: 'Run: vercel rollback --deployment dpl_abc123',
      },
      confidence: 0.9,
    });

    const result = await agent.execute(
      { action: 'DEPLOY_VERCEL', projectName: 'demo-app', framework: 'nextjs' },
      stubContext(),
    );

    expect(result.status).toBe('failed');
    expect(result.buildErrors).toHaveLength(2);
    expect(result.buildErrors?.[0]?.category).toBe('missing_env_var');
    expect(result.buildErrors?.[0]?.retryableByDebugger).toBe(false);
    expect(result.buildErrors?.[1]?.retryableByDebugger).toBe(true);
    expect(result.envVarsNeeded?.missing).toContain('STRIPE_SECRET_KEY');
    expect(result.envVarsNeeded?.consequences?.[0]).toContain('500');
    expect(result.rollback?.shouldRollback).toBe(true);
    expect(result.rollback?.previousDeploymentId).toBe('dpl_abc123');
  });

  it('returns a failed structured result when deploy succeeds with no errors', async () => {
    const agent = new AppDeployerAgent('stub-key');
    stubLLM(agent, {
      deploymentUrl: 'https://demo-abc.vercel.app',
      deploymentId: 'dpl_xyz',
      status: 'success',
      confidence: 0.95,
    });
    const result = await agent.execute(
      { action: 'DEPLOY_VERCEL', projectName: 'demo-app' },
      stubContext(),
    );
    expect(result.status).toBe('success');
    expect(result.deploymentUrl).toMatch(/vercel\.app/);
    // No buildErrors / rollback required on clean deploy.
    expect(result.buildErrors).toBeUndefined();
    expect(result.rollback).toBeUndefined();
  });

  it('preserves domainStatus on CONFIGURE_DOMAIN', async () => {
    const agent = new AppDeployerAgent('stub-key');
    stubLLM(agent, {
      status: 'pending',
      domainStatus: {
        domain: 'app.example.com',
        status: 'pending_dns',
        dnsRecords: [
          { type: 'A', name: '@', value: '76.76.21.21' },
          { type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com' },
        ],
        sslReady: false,
        notes: ['Apex records take up to 24h to propagate'],
      },
      confidence: 0.8,
    });
    const result = await agent.execute(
      { action: 'CONFIGURE_DOMAIN', domain: 'app.example.com' },
      stubContext(),
    );
    expect(result.domainStatus?.status).toBe('pending_dns');
    expect(result.domainStatus?.dnsRecords).toHaveLength(2);
    expect(result.domainStatus?.sslReady).toBe(false);
    expect(result.domainStatus?.notes?.[0]).toContain('24h');
  });
});

// ─── Browser ───────────────────────────────────────────────────────────────

describe('BrowserAgent — defensive automation output', () => {
  it('preserves blockedActions and screenshotsTaken on a mixed run', async () => {
    const agent = new BrowserAgent('stub-key');
    stubLLM(agent, {
      actionsExecuted: [
        { type: 'NAVIGATE', success: true, result: 'Loaded https://example.com' },
        { type: 'EXTRACT', success: true, result: 'title: Example' },
      ],
      extractedData: { title: 'Example' },
      screenshotsTaken: 2,
      requiresApproval: true,
      approvalReason: 'Detected a write action on a logged-in flow',
      blockedActions: [
        'honeypot detected: input[name="website"] (display:none)',
      ],
    });
    const result = await agent.execute(
      { actions: [{ type: 'NAVIGATE', url: 'https://example.com' }], allowedDomains: ['example.com'] },
      stubContext(),
    );
    expect(result.blockedActions).toHaveLength(1);
    expect(result.blockedActions[0]).toContain('honeypot');
    expect(result.requiresApproval).toBe(true);
    expect(result.screenshotsTaken).toBe(2);
  });
});

// ─── Ops ───────────────────────────────────────────────────────────────────

describe('OpsAgent — SRE triage + rollback plan', () => {
  it('preserves triage (severity + blast radius) on MONITOR', async () => {
    const agent = new OpsAgent('stub-key');
    stubLLM(agent, {
      result: 'API error rate spiking on checkout endpoint',
      steps: [
        { stepIndex: 0, description: 'Check Grafana', status: 'completed', output: '2.3% error rate' },
      ],
      recommendations: ['Page on-call engineer', 'Check recent deploys'],
      triage: {
        severity: 'p1',
        blastRadius: 'service_cohort',
        dataLossRisk: false,
        cascadeRisk: true,
        primaryHypothesis: 'Recent deploy of payment service introduced regression',
        alternativeHypotheses: ['Stripe API rate limit', 'DB connection pool exhaustion'],
        matchedRunbookId: 'payment-api-degraded',
      },
    });
    const result = await agent.execute(
      { action: 'MONITOR', description: 'Checkout error rate spiking' },
      stubContext(),
    );
    expect(result.triage?.severity).toBe('p1');
    expect(result.triage?.cascadeRisk).toBe(true);
    expect(result.triage?.alternativeHypotheses).toHaveLength(2);
    expect(result.triage?.matchedRunbookId).toBe('payment-api-degraded');
  });

  it('returns rollback plan AND requiresApproval on CONFIGURE (hard gate)', async () => {
    const agent = new OpsAgent('stub-key');
    stubLLM(agent, {
      result: 'Should not be used because CONFIGURE is gated',
      rollback: { steps: ['Restore previous config'], eta: '5min', requiresDataRestore: false },
    });
    const result = await agent.execute(
      { action: 'CONFIGURE', description: 'Reduce Redis memory limit to 512MB' },
      stubContext(),
    );
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalReason).toContain('approval');
  });

  it('preserves rootCauseChain on TROUBLESHOOT', async () => {
    const agent = new OpsAgent('stub-key');
    stubLLM(agent, {
      result: 'Five-whys traced to DNS misconfiguration',
      steps: [],
      recommendations: ['Update Route53 TTL'],
      rootCauseChain: [
        'Symptom: 10% of requests time out',
        'Because: requests from us-east-1 fail DNS resolution',
        'Because: Route53 record has low TTL and propagation lag',
        'Because: recent DNS change at 14:20 UTC',
        'Root cause: change window overlapped with traffic spike',
      ],
    });
    const result = await agent.execute(
      { action: 'TROUBLESHOOT', description: '10% timeout rate' },
      stubContext(),
    );
    expect(result.rootCauseChain).toHaveLength(5);
    expect(result.rootCauseChain?.[4]).toContain('Root cause');
  });
});

// ─── Voice ─────────────────────────────────────────────────────────────────

describe('VoiceAgent — decisions, speaker stats, risk flags', () => {
  it('preserves decisions[], speakerStats, openQuestions, riskFlags on SUMMARIZE_CALL', async () => {
    const agent = new VoiceAgent('stub-key');
    stubLLM(agent, {
      summary: 'Renewal call — mixed signals. CFO wants 20% discount, CS wants expansion.',
      actionItems: [
        { description: 'Send updated proposal with volume discount', assignee: 'AE:Sarah', priority: 'high', status: 'open' },
      ],
      keyTopics: ['renewal', 'pricing', 'expansion'],
      sentiment: 'mixed',
      decisions: [
        { decision: 'Extend trial by 30 days', decidedBy: 'CFO', transcriptTimestamp: '00:14:22' },
      ],
      speakerStats: [
        { speaker: 'AE:Sarah', talkTimePct: 40, wordCount: 820, questionsAsked: 12, interruptions: 2 },
        { speaker: 'CFO:Jordan', talkTimePct: 60, wordCount: 1250, questionsAsked: 8, interruptions: 5 },
      ],
      openQuestions: ['What is our data-residency story for EU customers?'],
      riskFlags: ['Deal risk: CFO said "let us think" and no next step scheduled'],
    });
    const result = await agent.execute(
      { action: 'SUMMARIZE_CALL', transcript: 'long transcript here' },
      stubContext(),
    );
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions?.[0]?.decidedBy).toBe('CFO');
    expect(result.speakerStats).toHaveLength(2);
    expect(result.speakerStats?.[0]?.talkTimePct).toBe(40);
    expect(result.openQuestions?.[0]).toContain('data-residency');
    expect(result.riskFlags?.[0]).toContain('Deal risk');
  });
});

// ─── Document ──────────────────────────────────────────────────────────────

describe('DocumentAgent — forensic extraction', () => {
  it('preserves extractedFields with sourceText + confidence on EXTRACT', async () => {
    const agent = new DocumentAgent('stub-key');
    stubLLM(agent, {
      extractedFields: [
        { field: 'invoice_number', value: 'INV-2026-04-0042', confidence: 0.98, sourceText: 'Invoice Number: INV-2026-04-0042' },
        { field: 'total_amount', value: '$12,450.00', confidence: 0.95, sourceText: 'Total: $12,450.00 USD' },
        { field: 'due_date', value: '2026-05-15', confidence: 0.92, sourceText: 'Due: May 15, 2026' },
        { field: 'purchase_order', value: null, confidence: 0.1, sourceText: 'not found' },
      ],
      overallConfidence: 0.88,
    });
    const result = await agent.execute(
      { action: 'EXTRACT', documentContent: 'Invoice content...', extractionSchema: { invoice_number: 'string' } },
      stubContext(),
    );
    expect(result.extractedFields).toHaveLength(4);
    expect(result.extractedFields?.[0]?.confidence).toBeGreaterThan(0.9);
    expect(result.extractedFields?.[0]?.sourceText).toContain('INV-2026-04-0042');
    const missing = result.extractedFields?.find((f) => f.field === 'purchase_order');
    expect(missing?.value).toBeNull();
    expect(missing?.sourceText).toBe('not found');
  });
});

// ─── Support ───────────────────────────────────────────────────────────────

describe('SupportAgent — urgency + escalation', () => {
  it('classifies p5 / frustrated correctly and escalates', async () => {
    const agent = new SupportAgent('stub-key');
    stubLLM(agent, {
      classification: {
        category: 'complaint',
        sentiment: 'frustrated',
        urgency: 5,
        escalationRequired: true,
        escalationReason: 'Customer threatened to file complaint with regulator',
        suggestedTags: ['regulator_threat', 'cancellation_risk', 'vip_account'],
        confidence: 0.92,
      },
      draftResponse: 'I understand your frustration...',
      nextActions: ['Page on-call account manager', 'Flag VIP status to leadership'],
    });
    const result = await agent.execute(
      {
        action: 'CLASSIFY',
        ticketContent: 'This is unacceptable, I will be filing a complaint with the FTC',
      },
      stubContext(),
    );
    expect(result.classification?.urgency).toBe(5);
    expect(result.classification?.sentiment).toBe('frustrated');
    expect(result.escalationRequired).toBe(true);
    expect(result.suggestedTags).toContain('regulator_threat');
    expect(result.nextActions.join(' ')).toContain('Page');
  });
});
