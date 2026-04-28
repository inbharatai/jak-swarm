/**
 * CEOOrchestratorService unit tests — Final hardening / Gap A.
 *
 * Verifies CEO trigger detection (pure function), pre-flight emits the
 * full ceo_* event sequence, and Company Brain context loading is
 * honest about missing fields.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CEOOrchestratorService,
  detectCEOTrigger,
} from '../../../apps/api/src/services/ceo-orchestrator.service.js';

// ─── Pure function: trigger detection ─────────────────────────────────────

describe('detectCEOTrigger', () => {
  it('returns isCEOMode=true for "act as CEO"', () => {
    const r = detectCEOTrigger('Act as CEO and tell me what to do next');
    expect(r.isCEOMode).toBe(true);
    expect(r.executiveFunctions).toContain('CEO');
    expect(r.executiveFunctions).toContain('CMO');
    expect(r.executiveFunctions).toContain('CTO');
  });

  it('returns isCEOMode=true for "review my company"', () => {
    const r = detectCEOTrigger('Review my company and tell me what is missing');
    expect(r.isCEOMode).toBe(true);
    expect(r.intent).toBe('business_review');
  });

  it('returns isCEOMode=true for "review my website"', () => {
    const r = detectCEOTrigger('Review my company website and create an improvement plan');
    expect(r.isCEOMode).toBe(true);
    expect(r.executiveFunctions).toEqual(['CEO', 'CMO']);
  });

  it('returns isCEOMode=true for "audit these documents"', () => {
    const r = detectCEOTrigger('Audit these compliance documents and create workpapers');
    expect(r.isCEOMode).toBe(true);
    expect(r.intent).toBe('audit_compliance_workflow');
  });

  it('returns isCEOMode=true for explicit mode flag', () => {
    const r = detectCEOTrigger('Do something with my data', 'ceo');
    expect(r.isCEOMode).toBe(true);
    expect(r.executiveFunctions).toEqual(['CEO', 'CMO', 'CTO', 'CFO', 'COO']);
  });

  it('returns isCEOMode=false for trivial questions', () => {
    expect(detectCEOTrigger('What is the weather?').isCEOMode).toBe(false);
    expect(detectCEOTrigger('Hello there').isCEOMode).toBe(false);
    expect(detectCEOTrigger('Send an email to bob@example.com').isCEOMode).toBe(false);
  });

  it('maps executive functions to correct agent roles', () => {
    const r = detectCEOTrigger('act as CEO');
    expect(r.agentRoles).toContain('WORKER_STRATEGIST');
    expect(r.agentRoles).toContain('WORKER_MARKETING');
    expect(r.agentRoles).toContain('WORKER_TECHNICAL');
    expect(r.agentRoles).toContain('WORKER_FINANCE');
    expect(r.agentRoles).toContain('WORKER_OPS');
  });

  it('defaults to standard workflow when no trigger matches', () => {
    const r = detectCEOTrigger('Generate a marketing email');
    expect(r.isCEOMode).toBe(false);
    expect(r.workflow).toBe('standard');
  });
});

// ─── Pre-flight: emits the right event sequence ────────────────────────────

interface EmittedEvent { type: string; [k: string]: unknown }

function makeFakeDb(profile?: Record<string, unknown> | null) {
  return {
    companyProfile: {
      async findFirst() {
        return profile ?? null;
      },
    },
  } as unknown as Parameters<typeof CEOOrchestratorService>[0];
}

describe('CEOOrchestratorService.preFlight', () => {
  const baseCtx = {
    workflowId: 'wf_1',
    tenantId: 'tenant_a',
    userId: 'usr_1',
  };

  it('emits ceo_goal_understood + returns isCEOMode=false for non-CEO goals', async () => {
    const events: EmittedEvent[] = [];
    const svc = new CEOOrchestratorService(makeFakeDb());
    const result = await svc.preFlight({
      ...baseCtx,
      goal: 'Hello, what time is it?',
      onLifecycle: (e) => events.push(e as EmittedEvent),
    });
    expect(result.isCEOMode).toBe(false);
    expect(events.find((e) => e.type === 'ceo_goal_understood')).toBeDefined();
    // Must NOT emit context/workflow/agents events when not in CEO mode
    expect(events.find((e) => e.type === 'ceo_context_loaded')).toBeUndefined();
    expect(events.find((e) => e.type === 'ceo_workflow_selected')).toBeUndefined();
  });

  it('emits the full ceo_* event chain for CEO goals', async () => {
    const events: EmittedEvent[] = [];
    const svc = new CEOOrchestratorService(makeFakeDb({
      tenantId: 'tenant_a',
      status: 'user_approved',
      name: 'Acme Inc',
      industry: 'SaaS',
      description: 'Widget company',
      brandVoice: 'Friendly and direct',
      targetCustomers: 'SMB',
      preferredChannels: ['email', 'linkedin'],
      websiteUrl: 'https://acme.com',
      pricing: 'Tiered',
      constraints: 'No hardware',
    }));
    const result = await svc.preFlight({
      ...baseCtx,
      goal: 'Act as CEO and review my business',
      onLifecycle: (e) => events.push(e as EmittedEvent),
    });
    expect(result.isCEOMode).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      'ceo_goal_understood',
      'ceo_context_loaded',
      'ceo_workflow_selected',
      'ceo_agents_assigned',
    ]);
    // No blocker because the profile has all required fields
    expect(result.blockers).toEqual([]);
    expect(result.profileStatus).toBe('user_approved');
    expect(result.profileFieldsLoaded.length).toBeGreaterThan(0);
  });

  it('emits ceo_blocker_detected when CompanyProfile is missing', async () => {
    const events: EmittedEvent[] = [];
    const svc = new CEOOrchestratorService(makeFakeDb(null)); // no profile
    const result = await svc.preFlight({
      ...baseCtx,
      goal: 'Act as CEO and tell me what to do next',
      onLifecycle: (e) => events.push(e as EmittedEvent),
    });
    expect(result.isCEOMode).toBe(true);
    expect(result.profileStatus).toBe('missing');
    const blocker = events.find((e) => e.type === 'ceo_blocker_detected');
    expect(blocker).toBeDefined();
    expect((blocker as { missingFields: string[] }).missingFields.length).toBeGreaterThan(0);
  });

  it('emits ceo_blocker_detected when profile partially missing fields', async () => {
    const events: EmittedEvent[] = [];
    const svc = new CEOOrchestratorService(makeFakeDb({
      tenantId: 'tenant_a',
      status: 'user_approved',
      name: 'Acme Inc',
      industry: 'SaaS',
      // brandVoice + targetCustomers missing — CMO function will flag
    }));
    const result = await svc.preFlight({
      ...baseCtx,
      goal: 'Run my company marketing this week',
      onLifecycle: (e) => events.push(e as EmittedEvent),
    });
    expect(result.isCEOMode).toBe(true);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers).toContain('brandVoice');
  });

  it('honors explicit ceoMode=ceo even for non-trigger goals', async () => {
    const events: EmittedEvent[] = [];
    const svc = new CEOOrchestratorService(makeFakeDb(null));
    const result = await svc.preFlight(
      {
        ...baseCtx,
        goal: 'Plain workflow goal',
        onLifecycle: (e) => events.push(e as EmittedEvent),
      },
      { explicitMode: 'ceo' },
    );
    expect(result.isCEOMode).toBe(true);
    expect(result.intent).toBe('ceo_explicit_mode');
    expect(result.executiveFunctions).toContain('COO');
  });

  it('survives DB errors gracefully (profileStatus=missing, no throw)', async () => {
    const errDb = {
      companyProfile: {
        async findFirst() {
          throw new Error('relation "company_profiles" does not exist');
        },
      },
    } as unknown as Parameters<typeof CEOOrchestratorService>[0];
    const events: EmittedEvent[] = [];
    const svc = new CEOOrchestratorService(errDb);
    const result = await svc.preFlight({
      ...baseCtx,
      goal: 'Act as CEO and review the business',
      onLifecycle: (e) => events.push(e as EmittedEvent),
    });
    expect(result.isCEOMode).toBe(true);
    expect(result.profileStatus).toBe('missing');
    // The chain still emits goal_understood + context_loaded + workflow_selected + agents_assigned
    expect(events.find((e) => e.type === 'ceo_context_loaded')).toBeDefined();
  });
});

// ─── generateExecutiveSummary: honest failure path when no API key ────────

describe('CEOOrchestratorService.generateExecutiveSummary', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
  });

  function restoreEnv() {
    if (originalApiKey) process.env['OPENAI_API_KEY'] = originalApiKey;
  }

  it('emits ceo_final_summary_generated with explicit error when OPENAI_API_KEY missing', async () => {
    const events: EmittedEvent[] = [];
    const svc = new CEOOrchestratorService(makeFakeDb());
    const result = await svc.generateExecutiveSummary(
      {
        workflowId: 'wf_x',
        tenantId: 'tenant_a',
        goal: 'Act as CEO',
        intent: 'business_review',
        executiveFunctions: ['CEO', 'CMO'],
        outputs: [{ result: 'a' }],
        status: 'COMPLETED',
        durationMs: 1234,
      },
      (e) => events.push(e as EmittedEvent),
    );
    expect(result.summary).toContain('Executive summary unavailable');
    expect(result.summary).toContain('OPENAI_API_KEY not set');
    expect(result.generationError).toContain('OPENAI_API_KEY');
    const ev = events.find((e) => e.type === 'ceo_final_summary_generated');
    expect(ev).toBeDefined();
    restoreEnv();
  });
});
