/**
 * google-drive-ingestion.test.ts — pins B2: deep Google Drive ingestion
 * (truth-doc B2: was metadata-only, pagination capped at 100).
 *
 *   - driveExportPlan: the pure content-export decision (Docs/Sheets -> export,
 *     text/json -> alt=media, binary/Slides -> metadata only).
 *   - pagination: syncGoogleDrive loops across nextPageToken instead of taking
 *     a single 100-file page, so pages are no longer silently dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt } from '../../../apps/api/src/utils/crypto.js';
import {
  CompanyConnectorSyncService,
  driveExportPlan,
} from '../../../apps/api/src/services/company-brain/company-connector-sync.service.js';

const TENANT = 'tnt_test';
const USER = 'usr_test';

function driveIntegration() {
  return {
    id: 'int_drive',
    tenantId: TENANT,
    provider: 'GOOGLE_DRIVE',
    status: 'CONNECTED',
    displayName: 'Drive',
    metadata: { connectedViaOAuth: true },
    updatedAt: new Date(),
    credentials: {
      id: 'cred_d', integrationId: 'int_drive',
      accessTokenEnc: encrypt('drive-token'),
      refreshTokenEnc: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  };
}

describe('driveExportPlan (B2 pure content decision)', () => {
  it('exports Google Docs and Sheets via the export endpoint', () => {
    expect(driveExportPlan('application/vnd.google-apps.document')).toEqual({ kind: 'export_text' });
    expect(driveExportPlan('application/vnd.google-apps.spreadsheet')).toEqual({ kind: 'export_text' });
  });
  it('fetches plain text/json via alt=media', () => {
    expect(driveExportPlan('text/plain')).toEqual({ kind: 'media' });
    expect(driveExportPlan('text/markdown')).toEqual({ kind: 'media' });
    expect(driveExportPlan('application/json')).toEqual({ kind: 'media' });
  });
  it('returns null (metadata only) for binary / Slides / unknown', () => {
    expect(driveExportPlan('application/pdf')).toBeNull();
    expect(driveExportPlan('application/vnd.google-apps.presentation')).toBeNull();
    expect(driveExportPlan('image/png')).toBeNull();
    expect(driveExportPlan('application/octet-stream')).toBeNull();
  });
});

describe('syncGoogleDrive pagination (B2: no more 100-file cap)', () => {
  let listCalls = 0;
  let ingested = 0;
  let enqueued = 0;
  let db: Record<string, unknown>;

  beforeEach(() => {
    listCalls = 0; ingested = 0; enqueued = 0;
    db = {
      $queryRawUnsafe: async () => { enqueued += 1; return [{ id: 'job', created: true }]; },
      integration: {
        findFirst: async () => driveIntegration(),
        findMany: async () => [],
      },
      integrationCredential: { update: async () => driveIntegration().credentials },
      companyArtifact: { upsert: async () => { ingested += 1; return { id: 'art_' + ingested }; } },
      companyConnectorSyncState: {
        findUnique: async () => null, findMany: async () => [],
        upsert: async () => ({ id: 's1', status: 'idle', cursorJson: null, integrationProvider: 'GOOGLE_DRIVE', tenantId: TENANT, provider: 'GOOGLE_DRIVE', lastSyncedAt: null, lastSuccessAt: null, lastError: null, lastErrorAt: null, consecutiveFailures: 0, createdAt: new Date(), updatedAt: new Date() }),
        update: async () => ({ id: 's1', status: 'idle' }),
        updateMany: async () => ({ count: 1 }),
      },
      companyConnectorSyncRun: { create: async () => ({ id: 'r1' }), update: async () => ({ id: 'r1' }), findFirst: async () => null },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      // Drive list endpoint (no /export, no alt=media)
      if (u.includes('drive/v3/files') && !u.includes('/export') && !u.includes('alt=media')) {
        listCalls += 1;
        if (listCalls === 1) {
          return { ok: true, status: 200, text: async () => '', json: async () => ({ files: [{ id: 'f1', name: 'Doc 1', mimeType: 'application/octet-stream', modifiedTime: '2026-07-14T10:00:00.000Z', webViewLink: 'https://drive.google.com/f1' }], nextPageToken: 'tok' }) };
        }
        return { ok: true, status: 200, text: async () => '', json: async () => ({ files: [{ id: 'f2', name: 'Doc 2', mimeType: 'application/octet-stream', modifiedTime: '2026-07-14T11:00:00.000Z', webViewLink: 'https://drive.google.com/f2' }] }) };
      }
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('follows nextPageToken across two pages and ingests every file', async () => {
    const service = new CompanyConnectorSyncService(db as never, undefined as never);
    const res = await service.triggerSync({ tenantId: TENANT, userId: USER, provider: 'google_drive' });
    expect(listCalls).toBe(2);
    expect(res.fetchedCount).toBe(2);
    expect(ingested).toBe(2);
    expect(enqueued).toBe(2); // B4: each ingested file auto-enqueues Brain processing
    expect(res.status).toBe('success');
  });
});
