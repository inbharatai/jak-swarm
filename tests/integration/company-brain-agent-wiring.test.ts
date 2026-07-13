/**
 * Company Brain Graph V2 → agent runtime wiring.
 *
 * This is the test that PR #137's silent-optional cast allowed to stay green
 * while the feature was inert. It proves the production wiring path:
 *
 *   createCompanyContextProvider() (the real boot factory)
 *     → CompanyBrainV2Service.getContextPackage() (the real Graph V2 service)
 *       → PromptBuilder.injectCompanyContext() (the real BaseAgent path)
 *         → <company_context> + <company_brain> in the prompt
 *
 * It asserts that:
 *  - the wired provider formally exposes getContextPackage (no optional cast);
 *  - a real BaseAgent/PromptBuilder invocation receives <company_brain>;
 *  - permitted evidence appears, restricted evidence does NOT appear;
 *  - Graph V2 failure is non-blocking but observable (telemetry).
 *
 * Role and tenant are derived from the trusted AgentContext / agent role enum,
 * never from an HTTP body.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type OpenAI from 'openai';
import { PromptBuilder } from '../../packages/agents/src/base/prompt-builder.service.js';
import { CompanyBrainV2Service } from '../../apps/api/src/services/company-brain/company-brain-v2.service.js';
import { createCompanyContextProvider } from '../../apps/api/src/services/company-brain/company-context-provider.factory.js';

const system = (content: string): OpenAI.ChatCompletionMessageParam => ({ role: 'system', content });
const user = (content: string): OpenAI.ChatCompletionMessageParam => ({ role: 'user', content });

/** A capturing pino-shaped logger so we can assert on telemetry outcomes. */
function captureLogger(): FastifyBaseLogger & { calls: Array<{ level: string; obj: unknown; msg?: string }> } {
  const calls: Array<{ level: string; obj: unknown; msg?: string }> = [];
  const make = (level: string) => (obj: unknown, msg?: string) => { calls.push({ level, obj, msg }); };
  return {
    info: make('info'), warn: make('warn'), debug: make('debug'), error: make('error'),
    calls,
  } as unknown as FastifyBaseLogger & { calls: Array<{ level: string; obj: unknown; msg?: string }> };
}

/** Fake profile service: returns an approved profile row. */
function fakeProfileService(getApproved: () => Promise<unknown> = async () => ({
  name: 'InBharat', industry: 'AI', description: 'Agent systems',
  productsServices: [], targetCustomers: null, brandVoice: null,
  competitors: [], pricing: null, websiteUrl: null, goals: 'Build JAK',
  constraints: null, preferredChannels: [],
})) {
  return { getApproved: vi.fn(getApproved) };
}

/**
 * Fake PrismaClient whose $queryRawUnsafe dispatches on the SQL string to
 * return canned Graph V2 rows. One permitted artifact (internal) and one
 * restricted artifact (allowedAgentRoles: ['COMMANDER']); the calling agent
 * is WORKER_RESEARCH, so the restricted artifact + its entity must be omitted.
 */
function fakeDb(rows: {
  entities?: unknown[];
  artifacts?: unknown[];
  claims?: unknown[];
  edges?: unknown[];
}) {
  const $queryRawUnsafe = vi.fn(async (sql: string, ..._values: unknown[]) => {
    if (sql.includes('"ok" AS "ok"')) return [{ ok: 1 }]; // probeAvailability
    if (sql.includes('company_artifacts')) return rows.artifacts ?? [];
    if (sql.includes('company_claims')) return rows.claims ?? [];
    if (sql.includes('company_edges')) return rows.edges ?? [];
    if (sql.includes('company_graph_entities')) return rows.entities ?? [];
    return [];
  });
  return { $queryRawUnsafe } as never;
}

const now = new Date('2026-07-13T00:00:00Z');

const PERMITTED_ENTITY = {
  id: 'e1', tenantId: 't1', primaryArtifactId: 'a1', entityType: 'project',
  title: 'Project Alpha', summary: 'Renewal risk review', status: 'active',
  ownerName: 'Ops', priority: 'high', confidence: 0.9, occurredAt: now, dueAt: null,
  sourceArtifactIds: ['a1'], relatedEntityIds: [], properties: {},
  extractedBy: 'ingestor', createdBy: null, createdAt: now, updatedAt: now, deletedAt: null, rank: 1,
};

const RESTRICTED_ENTITY = {
  id: 'e2', tenantId: 't1', primaryArtifactId: 'a2', entityType: 'company',
  title: 'Secret M&A Target ZetaCorp', summary: 'Confidential acquisition target', status: 'active',
  ownerName: null, priority: null, confidence: 0.5, occurredAt: now, dueAt: null,
  sourceArtifactIds: ['a2'], relatedEntityIds: [], properties: {},
  extractedBy: 'ingestor', createdBy: null, createdAt: now, updatedAt: now, deletedAt: null, rank: 0.5,
};

const PERMITTED_ARTIFACT = {
  id: 'a1', tenantId: 't1', sourceType: 'document', artifactType: 'memo',
  title: 'Project Alpha renewal memo', body: 'Renewal risk is high for Project Alpha.',
  bodyHash: 'h1', authorName: 'Ops', occurredAt: now, metadata: {},
  ingestionStatus: 'ready', extractedAt: now, visibility: 'internal', allowedAgentRoles: [],
  sensitivity: 'normal', retentionUntil: null, processingState: 'ready', processingAttempts: 0,
  processingError: null, createdBy: null, createdAt: now, updatedAt: now, deletedAt: null,
};

const RESTRICTED_ARTIFACT = {
  id: 'a2', tenantId: 't1', sourceType: 'document', artifactType: 'memo',
  title: 'Secret M&A target memo', body: 'Top secret acquisition target name: ZetaCorp',
  bodyHash: 'h2', authorName: 'CEO', occurredAt: now, metadata: {},
  ingestionStatus: 'ready', extractedAt: now, visibility: 'restricted', allowedAgentRoles: ['COMMANDER'],
  sensitivity: 'highly_confidential', retentionUntil: null, processingState: 'ready', processingAttempts: 0,
  processingError: null, createdBy: null, createdAt: now, updatedAt: now, deletedAt: null,
};

const ACTIVE_CLAIM = {
  id: 'c1', tenantId: 't1', subjectEntityId: 'e1', predicate: 'renewal_risk',
  objectEntityId: null, objectValue: 'high', normalizedObject: 'high', fingerprint: 'f1',
  status: 'active', confidence: 0.85, authorityScore: 0.9, validFrom: now, validTo: null,
  supersedesClaimId: null, createdBy: 'ingestor', reviewedBy: null, reviewedAt: null, reviewComment: null,
  createdAt: now, updatedAt: now,
};

describe('Company Brain Graph V2 — agent runtime wiring', () => {
  it('the boot factory produces a provider that formally exposes getContextPackage (no optional cast)', async () => {
    const log = captureLogger();
    const brainSvc = new CompanyBrainV2Service(fakeDb({ entities: [PERMITTED_ENTITY], artifacts: [PERMITTED_ARTIFACT] }) as never, log);
    const provider = createCompanyContextProvider({ profileSvc: fakeProfileService() as never, brainSvc, log });
    expect(typeof provider.getContextPackage).toBe('function');
    expect(typeof provider.getApprovedProfile).toBe('function');
  });

  it('a real PromptBuilder invocation receives <company_context> + <company_brain> with permitted evidence, not restricted', async () => {
    const log = captureLogger();
    const brainSvc = new CompanyBrainV2Service(
      fakeDb({
        entities: [PERMITTED_ENTITY, RESTRICTED_ENTITY],
        artifacts: [PERMITTED_ARTIFACT, RESTRICTED_ARTIFACT],
        claims: [ACTIVE_CLAIM],
        edges: [],
      }) as never,
      log,
    );
    const provider = createCompanyContextProvider({ profileSvc: fakeProfileService() as never, brainSvc, log });

    const builder = new PromptBuilder('WORKER_RESEARCH' as never, () => null, () => provider, log as never);
    const result = await builder.injectCompanyContext(
      [system('PRIMARY'), user('Review Project Alpha renewal risk')],
      { tenantId: 't1' } as never,
    );

    const joined = result.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');

    // Both governed context blocks appear, primary system prompt preserved.
    expect(result.messages[0]).toEqual(system('PRIMARY'));
    expect(joined).toContain('<company_context>');
    expect(joined).toContain('<company_brain>');

    // Permitted evidence + claim appear.
    expect(joined).toContain('Project Alpha');
    expect(joined).toContain('renewal_risk');

    // Restricted artifact + entity + secret content do NOT leak — directly or indirectly.
    expect(joined).not.toContain('ZetaCorp');
    expect(joined).not.toContain('Secret M&A');
    expect(joined).not.toContain('restricted');

    // Telemetry: injected + redacted (one artifact and one entity were omitted).
    const injectedCall = log.calls.find((c) => c.level === 'info' && typeof c.msg === 'string' && c.msg.includes('injected'));
    expect(injectedCall, 'expected "injected" telemetry').toBeTruthy();
    expect((injectedCall!.obj as { redacted?: boolean }).redacted).toBe(true);
    expect(((injectedCall!.obj as { omittedCount?: number }).omittedCount ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('Graph V2 retrieval failure is non-blocking but observable — agent still gets the profile, no <company_brain>, no throw', async () => {
    const log = captureLogger();
    const failingDb = { $queryRawUnsafe: vi.fn(async () => { throw new Error('relation company_graph_entities does not exist'); }) } as never;
    const brainSvc = new CompanyBrainV2Service(failingDb, log);
    const provider = createCompanyContextProvider({ profileSvc: fakeProfileService() as never, brainSvc, log });

    const builder = new PromptBuilder('WORKER_RESEARCH' as never, () => null, () => provider, log as never);
    // Must not throw.
    const result = await builder.injectCompanyContext(
      [system('PRIMARY'), user('Review Project Alpha renewal risk')],
      { tenantId: 't1' } as never,
    );
    const joined = result.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');

    expect(joined).toContain('<company_context>'); // profile still grounds the agent
    expect(joined).not.toContain('<company_brain>'); // brain unavailable
    // Failure was observable at BOTH layers: factory (warn unavailable) + builder (warn failed).
    const warns = log.calls.filter((c) => c.level === 'warn');
    expect(warns.length).toBeGreaterThanOrEqual(1);
  });

  it('when getContextPackage resolves to null (unavailable/failed), the PromptBuilder logs "empty" and omits <company_brain> — agent continues', async () => {
    const log = captureLogger();
    // A provider whose Graph V2 layer is unavailable (factory returns null on
    // failure). This is the exact "empty" telemetry branch: the profile still
    // grounds the agent, the brain block is omitted, execution continues.
    const provider = {
      getApprovedProfile: vi.fn(async () => ({
        name: 'InBharat', industry: 'AI', description: 'Agent systems',
        productsServices: [], targetCustomers: null, brandVoice: null,
        competitors: [], pricing: null, websiteUrl: null, goals: 'Build JAK',
        constraints: null, preferredChannels: [],
      })),
      getContextPackage: vi.fn(async () => null),
    };

    const builder = new PromptBuilder('WORKER_RESEARCH' as never, () => null, () => provider, log as never);
    const result = await builder.injectCompanyContext(
      [system('PRIMARY'), user('Review Project Alpha renewal risk')],
      { tenantId: 't1' } as never,
    );
    const joined = result.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');

    expect(joined).toContain('<company_context>');
    expect(joined).not.toContain('<company_brain>');
    const emptyCall = log.calls.find((c) => c.level === 'info' && typeof c.msg === 'string' && c.msg.includes('empty'));
    expect(emptyCall, 'expected "empty" telemetry').toBeTruthy();
    expect(provider.getContextPackage).toHaveBeenCalledTimes(1);
  });
});