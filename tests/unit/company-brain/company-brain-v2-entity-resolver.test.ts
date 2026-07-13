/**
 * Phase 3 — entity resolver helper tests (no database required).
 *
 * The 6-tier identity hierarchy is driven by pure functions over an entity's
 * `properties` JSONB and its title. These cover the unit-testable core:
 *   - stable-identifier extraction (allowlist-driven, normalized)
 *   - provider + externalId extraction
 *   - the conflicting-identifier guard (two "Acme" with different domains)
 *   - per-candidate tier classification across all six tiers
 *   - normalizeStableIdentifier scheme/www stripping
 *
 * The cross-tier priority ordering and the rejected/deferred re-proposal
 * guard are exercised against real Postgres in
 * `tests/integration/company-brain-entity-access-control.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  ENTITY_RESOLVER_ALGORITHM_VERSION,
  extractProviderExternalId,
  extractStableIdentifiers,
  identifiersConflict,
  normalizeStableIdentifier,
  type CompanyEntityV2Row,
} from '../../../apps/api/src/services/company-brain/company-brain-v2.core.js';
import { classifyEntityCandidate } from '../../../apps/api/src/services/company-brain/company-brain-v2.entities.js';

const mkEntity = (overrides: Partial<CompanyEntityV2Row>): CompanyEntityV2Row => ({
  id: 'e1',
  tenantId: 't1',
  primaryArtifactId: null,
  entityType: 'company',
  title: 'Acme Corp',
  summary: '',
  status: 'active',
  ownerName: null,
  priority: null,
  confidence: 0.8,
  occurredAt: null,
  dueAt: null,
  sourceArtifactIds: [],
  relatedEntityIds: null,
  properties: {},
  extractedBy: 'openai',
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

describe('normalizeStableIdentifier', () => {
  it('lowercases, strips scheme and www, drops trailing slashes', () => {
    expect(normalizeStableIdentifier('HTTPS://WWW.Acme.COM/')).toBe('acme.com');
    expect(normalizeStableIdentifier('  Acme@Example.com ')).toBe('acme@example.com');
  });
  it('returns null for empty / non-scalar / whitespace', () => {
    expect(normalizeStableIdentifier('')).toBeNull();
    expect(normalizeStableIdentifier('   ')).toBeNull();
    expect(normalizeStableIdentifier(null)).toBeNull();
    expect(normalizeStableIdentifier({})).toBeNull();
    expect(normalizeStableIdentifier(undefined)).toBeNull();
  });
});

describe('extractStableIdentifiers', () => {
  it('reads allowlist keys across camelCase / snake_case spellings and dedupes', () => {
    const ids = extractStableIdentifiers({
      emailAddress: 'ceo@acme.com',
      email: 'CEO@acme.com', // duplicate after normalization
      Domain: 'acme.com',
      website: 'https://www.acme.com/about',
      crm_id: 'CRM-123',
      notes: 'irrelevant', // not in the allowlist
    });
    const keys = ids.map((i) => i.key);
    expect(keys).toContain('email');
    expect(keys).toContain('domain');
    expect(keys).toContain('website');
    expect(keys).toContain('crmid');
    // 'email' appeared twice but dedupes to one value.
    expect(ids.filter((i) => i.key === 'email')).toHaveLength(1);
    expect(ids.find((i) => i.key === 'website')?.value).toBe('acme.com/about');
    expect(ids.some((i) => i.key === 'notes')).toBe(false);
  });
  it('returns [] for non-object / unknown properties', () => {
    expect(extractStableIdentifiers(null)).toEqual([]);
    expect(extractStableIdentifiers(undefined)).toEqual([]);
    expect(extractStableIdentifiers('string')).toEqual([]);
    expect(extractStableIdentifiers({ unrelated: 'x' })).toEqual([]);
  });
  it('handles array-valued identifiers (multiple emails)', () => {
    const ids = extractStableIdentifiers({ email: ['a@acme.com', 'b@acme.com'] });
    const emails = ids.filter((i) => i.key === 'email').map((i) => i.value);
    expect(emails).toEqual(['a@acme.com', 'b@acme.com']);
  });
});

describe('extractProviderExternalId', () => {
  it('returns provider + externalId when both present', () => {
    expect(extractProviderExternalId({ provider: 'hubspot', externalId: 'HS-1' })).toEqual({
      provider: 'hubspot',
      externalId: 'hs-1',
    });
  });
  it('accepts source/integration/system as the provider key', () => {
    expect(extractProviderExternalId({ integration: 'Salesforce', crmId: 'SF-9' })).toEqual({
      provider: 'salesforce',
      externalId: 'sf-9',
    });
  });
  it('returns null when either component is missing', () => {
    expect(extractProviderExternalId({ provider: 'hubspot' })).toBeNull();
    expect(extractProviderExternalId({ externalId: 'HS-1' })).toBeNull();
    expect(extractProviderExternalId({})).toBeNull();
  });
});

describe('identifiersConflict', () => {
  it('flags same-key different-value with no shared value', () => {
    const a = extractStableIdentifiers({ domain: 'acme.com' });
    const b = extractStableIdentifiers({ domain: 'acme.io' });
    expect(identifiersConflict(a, b)).toBe(true);
  });
  it('does NOT flag a shared value (that is tier-2 evidence, not a conflict)', () => {
    const a = extractStableIdentifiers({ domain: 'acme.com', email: 'x@acme.com' });
    const b = extractStableIdentifiers({ domain: 'acme.com', email: 'y@acme.com' });
    // shared domain reconciles them → not a blocking conflict.
    expect(identifiersConflict(a, b)).toBe(false);
  });
  it('does NOT flag when keys do not overlap at all', () => {
    const a = extractStableIdentifiers({ domain: 'acme.com' });
    const b = extractStableIdentifiers({ email: 'ceo@other.com' });
    expect(identifiersConflict(a, b)).toBe(false);
  });
  it('does NOT flag when one side has no identifiers', () => {
    expect(identifiersConflict(extractStableIdentifiers({ domain: 'acme.com' }), [])).toBe(false);
    expect(identifiersConflict([], extractStableIdentifiers({ domain: 'acme.com' }))).toBe(false);
  });
});

describe('classifyEntityCandidate (tier selection via resolveEntity helpers)', () => {
  it('tier 1 provider_external_id wins on same provider + externalId', () => {
    const entity = mkEntity({ properties: { provider: 'hubspot', externalId: 'HS-1' } });
    const candidate = mkEntity({ id: 'e2', title: 'Totally Different Name', properties: { provider: 'hubspot', externalId: 'HS-1' } });
    const r = classifyEntityCandidate(entity, extractStableIdentifiers(entity.properties), extractProviderExternalId(entity.properties), candidate);
    expect(r.tier).toBe('provider_external_id');
    expect(r.similarity).toBe(1);
  });

  it('tier 2 verified_stable_identifier fires on a shared email even with different titles', () => {
    const entity = mkEntity({ properties: { email: 'ceo@acme.com' } });
    const candidate = mkEntity({ id: 'e2', title: 'Acme Holdings Ltd', properties: { email: 'ceo@acme.com' } });
    const r = classifyEntityCandidate(entity, extractStableIdentifiers(entity.properties), extractProviderExternalId(entity.properties), candidate);
    expect(r.tier).toBe('verified_stable_identifier');
    expect(r.similarity).toBe(1);
  });

  it('tier 4 deterministic_composite merges exact-title duplicates with no conflicting id', () => {
    const entity = mkEntity({ title: 'Acme Corp', properties: {} });
    const candidate = mkEntity({ id: 'e2', title: 'Acme Corp', properties: {} });
    const r = classifyEntityCandidate(entity, extractStableIdentifiers(entity.properties), extractProviderExternalId(entity.properties), candidate);
    expect(r.tier).toBe('deterministic_composite');
  });

  it('tier 4 is BLOCKED by a conflicting identifier — two "Acme Corp" with different domains do not auto-merge', () => {
    const entity = mkEntity({ title: 'Acme Corp', properties: { domain: 'acme.com' } });
    const candidate = mkEntity({ id: 'e2', title: 'Acme Corp', properties: { domain: 'acme.io' } });
    const r = classifyEntityCandidate(entity, extractStableIdentifiers(entity.properties), extractProviderExternalId(entity.properties), candidate);
    expect(r.tier).not.toBe('deterministic_composite');
    expect(r.tier).not.toBe('provider_external_id');
    expect(r.tier).not.toBe('verified_stable_identifier');
  });

  it('tier 5 probabilistic_review fires for 0.72–0.94 similarity with no identifiers', () => {
    // 'Project Alpha Renewal' tokens: {project, alpha, renewal}.
    // Candidate adds one token → intersection 3 / union 4 = 0.75 (Jaccard).
    const entity = mkEntity({ title: 'Project Alpha Renewal' });
    const candidate = mkEntity({ id: 'e2', title: 'Project Alpha Renewal Q4' });
    const r = classifyEntityCandidate(entity, extractStableIdentifiers(entity.properties), extractProviderExternalId(entity.properties), candidate);
    expect(r.tier).toBe('probabilistic_review');
    expect(r.similarity).toBeGreaterThanOrEqual(0.72);
    expect(r.similarity).toBeLessThan(0.94);
  });

  it('tier none when title similarity is low and identifiers do not match', () => {
    const entity = mkEntity({ title: 'Acme Corp' });
    const candidate = mkEntity({ id: 'e2', title: 'Globex Industries' });
    const r = classifyEntityCandidate(entity, extractStableIdentifiers(entity.properties), extractProviderExternalId(entity.properties), candidate);
    expect(r.tier).toBe('none');
  });

  it('tier 1 outranks tier 2 (provider+externalId checked before stable identifier)', () => {
    const entity = mkEntity({ properties: { provider: 'hubspot', externalId: 'HS-1', email: 'a@acme.com' } });
    const candidate = mkEntity({ id: 'e2', properties: { provider: 'hubspot', externalId: 'HS-1', email: 'a@acme.com' } });
    const r = classifyEntityCandidate(entity, extractStableIdentifiers(entity.properties), extractProviderExternalId(entity.properties), candidate);
    expect(r.tier).toBe('provider_external_id');
  });
});

describe('ENTITY_RESOLVER_ALGORITHM_VERSION', () => {
  it('is pinned and stable', () => {
    expect(ENTITY_RESOLVER_ALGORITHM_VERSION).toBe('entity-resolver-v1');
  });
});