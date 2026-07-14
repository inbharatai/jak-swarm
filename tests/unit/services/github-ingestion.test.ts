/**
 * github-ingestion.test.ts — pins B3: deep GitHub ingestion
 * (truth-doc B3: was user-events stream only; now ingests repositories too).
 *
 *   - parseGitHubNextLink: pure GitHub Link-header pagination parsing.
 *   - syncGitHub: ingests the user's repositories (paginated via the Link
 *     header) as real 'repository' artifacts alongside the activity stream.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt } from '../../../apps/api/src/utils/crypto.js';
import {
  CompanyConnectorSyncService,
  parseGitHubNextLink,
} from '../../../apps/api/src/services/company-brain/company-connector-sync.service.js';

const TENANT = 'tnt_test';
const USER = 'usr_test';

function githubIntegration() {
  return {
    id: 'int_gh', tenantId: TENANT, provider: 'GITHUB', status: 'CONNECTED',
    displayName: 'GitHub', metadata: { connectedViaOAuth: true }, updatedAt: new Date(),
    credentials: { id: 'c', integrationId: 'int_gh', accessTokenEnc: encrypt('gh-token'), refreshTokenEnc: null, expiresAt: null },
  };
}

describe('parseGitHubNextLink (B3 pure pagination)', () => {
  it('extracts the rel="next" URL from a GitHub Link header', () => {
    const link = '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"';
    expect(parseGitHubNextLink(link)).toBe('https://api.github.com/user/repos?page=2');
  });
  it('returns null when there is no next page', () => {
    expect(parseGitHubNextLink('<https://api.github.com/user/repos?page=5>; rel="last"')).toBeNull();
    expect(parseGitHubNextLink(null)).toBeNull();
    expect(parseGitHubNextLink('')).toBeNull();
  });
});

describe('syncGitHub repository ingestion (B3)', () => {
  let repoCalls = 0;
  let ingested = 0;
  let enqueued = 0;
  let db: Record<string, unknown>;

  beforeEach(() => {
    repoCalls = 0; ingested = 0; enqueued = 0;
    db = {
      $queryRawUnsafe: async () => { enqueued += 1; return [{ id: 'job', created: true }]; },
      integration: { findFirst: async () => githubIntegration(), findMany: async () => [] },
      integrationCredential: { update: async () => githubIntegration().credentials },
      companyArtifact: { upsert: async () => { ingested += 1; return { id: 'art_' + ingested }; } },
      companyConnectorSyncState: {
        findUnique: async () => null, findMany: async () => [],
        upsert: async () => ({ id: 's1', status: 'idle', cursorJson: null, integrationProvider: 'GITHUB', tenantId: TENANT, provider: 'GITHUB', lastSyncedAt: null, lastSuccessAt: null, lastError: null, lastErrorAt: null, consecutiveFailures: 0, createdAt: new Date(), updatedAt: new Date() }),
        update: async () => ({ id: 's1', status: 'idle' }),
        updateMany: async () => ({ count: 1 }),
      },
      companyConnectorSyncRun: { create: async () => ({ id: 'r1' }), update: async () => ({ id: 'r1' }), findFirst: async () => null },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('user/repos')) {
        repoCalls += 1;
        const page1 = [{ id: 1001, name: 'repo1', full_name: 'acme/repo1', description: 'Main product', language: 'TypeScript', stargazers_count: 42, topics: ['ai','agents'], default_branch: 'main', private: false, html_url: 'https://github.com/acme/repo1', owner: { login: 'acme' }, updated_at: '2026-07-14T10:00:00.000Z' }];
        const page2 = [{ id: 1002, name: 'repo2', full_name: 'acme/repo2', description: '', language: null, stargazers_count: 0, topics: [], default_branch: 'main', private: true, html_url: 'https://github.com/acme/repo2', owner: { login: 'acme' }, updated_at: '2026-07-14T11:00:00.000Z' }];
        const link = repoCalls === 1 ? '<https://api.github.com/user/repos?page=2>; rel="next"' : null;
        return { ok: true, status: 200, text: async () => '', json: async () => (repoCalls === 1 ? page1 : page2), headers: { get: (k: string) => (k === 'link' ? link : null) } };
      }
      if (u.includes('user/events')) {
        return { ok: true, status: 200, text: async () => '', json: async () => [], headers: { get: () => null } };
      }
      return { ok: true, status: 200, text: async () => '', json: async () => ({}), headers: { get: () => null } };
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('paginates repos via the Link header and ingests each as a repository artifact', async () => {
    const service = new CompanyConnectorSyncService(db as never, undefined as never);
    const res = await service.triggerSync({ tenantId: TENANT, userId: USER, provider: 'github' });
    expect(repoCalls).toBe(2);
    expect(ingested).toBe(2); // both repos persisted
    expect(enqueued).toBe(2); // B4: each repo auto-enqueued into the Brain
    expect(res.fetchedCount).toBeGreaterThanOrEqual(2);
    expect(res.status).toBe('success');
  });
});
