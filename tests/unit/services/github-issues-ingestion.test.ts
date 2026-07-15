/**
 * github-issues-ingestion.test.ts — pins the B3 remainder: GitHub issues + PRs
 * are now ingested (truth-doc B3 remainder). The /issues endpoint returns both;
 * a `pull_request` field marks PRs (githubIssueArtifactType classification).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt } from '../../../apps/api/src/utils/crypto.js';
import {
  CompanyConnectorSyncService,
  githubIssueArtifactType,
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

describe('githubIssueArtifactType (B3 pure classification)', () => {
  it('classifies an item with a pull_request object as a pull_request', () => {
    expect(githubIssueArtifactType({ number: 3, pull_request: { url: 'x' } })).toBe('pull_request');
  });
  it('classifies an item without a pull_request as an issue', () => {
    expect(githubIssueArtifactType({ number: 4 })).toBe('issue');
    expect(githubIssueArtifactType({ number: 5, pull_request: null })).toBe('issue');
  });
});

describe('syncGitHub ingests issues + PRs (B3 remainder)', () => {
  let ingestedTypes: string[] = [];
  let db: Record<string, unknown>;

  beforeEach(() => {
    ingestedTypes = [];
    db = {
      $queryRawUnsafe: async () => [{ id: 'job', created: true }],
      integration: { findFirst: async () => githubIntegration(), findMany: async () => [] },
      integrationCredential: { update: async () => githubIntegration().credentials },
      companyArtifact: { upsert: async (args: { create?: { artifactType: string }; update?: { artifactType: string }; data?: { artifactType: string } }) => { ingestedTypes.push(args.create?.artifactType ?? args.update?.artifactType ?? args.data?.artifactType ?? 'unknown'); return { id: 'art_' + ingestedTypes.length }; } },
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
        return { ok: true, status: 200, text: async () => '', json: async () => [{ id: 1001, name: 'repo1', full_name: 'acme/repo1', updated_at: '2026-07-14T10:00:00.000Z', html_url: 'https://github.com/acme/repo1', owner: { login: 'acme' } }], headers: { get: () => null } };
      }
      if (u.includes('/issues?')) {
        return {
          ok: true, status: 200, text: async () => '',
          json: async () => [
            { number: 7, title: 'Bug: login crash', body: 'Steps to repro', state: 'open', html_url: 'https://github.com/acme/repo1/issues/7', user: { login: 'reetu' }, updated_at: '2026-07-14T09:00:00.000Z' },
            { number: 8, title: 'Add dark mode', body: 'PR for dark mode', state: 'open', html_url: 'https://github.com/acme/repo1/pull/8', user: { login: 'dev' }, updated_at: '2026-07-14T09:30:00.000Z', pull_request: { url: 'x' } },
          ],
          headers: { get: () => null },
        };
      }
      if (u.includes('user/events')) {
        return { ok: true, status: 200, text: async () => '', json: async () => [], headers: { get: () => null } };
      }
      return { ok: true, status: 200, text: async () => '', json: async () => ({}), headers: { get: () => null } };
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ingests the repository, the issue, AND the pull request as distinct artifact types', async () => {
    const service = new CompanyConnectorSyncService(db as never, undefined as never);
    const res = await service.triggerSync({ tenantId: TENANT, userId: USER, provider: 'github' });
    expect(ingestedTypes).toContain('repository');
    expect(ingestedTypes).toContain('issue');
    expect(ingestedTypes).toContain('pull_request');
    expect(res.status).toBe('success');
    expect(res.fetchedCount).toBeGreaterThanOrEqual(3); // 1 repo + 2 issues/PRs
  });
});
