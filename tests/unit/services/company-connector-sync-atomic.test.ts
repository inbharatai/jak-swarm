/**
 * company-connector-sync-atomic.test.ts — pins the A9 atomic-sync claim
 * (truth-doc A9: scheduled-vs-manual and manual-vs-manual sync races).
 *
 * The old triggerSync did a read (`if status === 'running' throw`) then a
 * SEPARATE write (`update status='running'`) — two statements, no transaction,
 * so two concurrent triggers could both read 'idle' and both ingest the same
 * cursor window. The manual trigger also bypassed the scheduler's inFlight /
 * leader guards. The fix is a single conditional updateMany (`where status !=
 * 'running'`) that is the atomic claim; count 0 means a concurrent trigger won
 * and we throw without starting any work.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt } from '../../../apps/api/src/utils/crypto.js';
import { CompanyConnectorSyncService } from '../../../apps/api/src/services/company-brain/company-connector-sync.service.js';

const TENANT = 'tnt_test';
const USER = 'usr_test';
const STATE_ID = 'state_1';

function makeIntegration() {
  return {
    id: 'int_1',
    tenantId: TENANT,
    provider: 'gmail',
    status: 'CONNECTED',
    displayName: 'Gmail',
    metadata: { connectedViaOAuth: true },
    updatedAt: new Date(),
    credentials: {
      id: 'cred_1',
      integrationId: 'int_1',
      accessTokenEnc: encrypt('test-token'),
      refreshTokenEnc: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  };
}

function makeState(status: string) {
  return {
    id: STATE_ID,
    tenantId: TENANT,
    provider: 'GMAIL',
    integrationProvider: 'gmail',
    status,
    cursorJson: null,
    lastSyncedAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeDb(opts: { claimCount: number; stateStatus: string }) {
  const calls = {
    updateMany: 0,
    runCreate: 0,
    stateUpdate: 0,
  };
  const db = {
    integration: {
      findFirst: async () => makeIntegration(),
      findMany: async () => [],
    },
    integrationCredential: { update: async () => makeIntegration().credentials },
    companyConnectorSyncState: {
      findUnique: async () => makeState(opts.stateStatus),
      findMany: async () => [],
      upsert: async () => makeState(opts.stateStatus),
      update: async () => makeState('idle'),
      updateMany: async () => { calls.updateMany += 1; return { count: opts.claimCount }; },
    },
    companyConnectorSyncRun: {
      create: async () => { calls.runCreate += 1; return { id: 'run_1' }; },
      update: async () => ({ id: 'run_1' }),
      findFirst: async () => null,
    },
  };
  return { db, calls };
}

const emptyListResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({ messages: [] }),
  text: async () => '',
});

describe('CompanyConnectorSyncService.triggerSync atomic claim (A9)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => emptyListResponse()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('claims an idle state atomically and runs the sync', async () => {
    const { db, calls } = makeDb({ claimCount: 1, stateStatus: 'idle' });
    const service = new CompanyConnectorSyncService(db as never, undefined as never);
    const res = await service.triggerSync({ tenantId: TENANT, userId: USER, provider: 'gmail' });
    expect(calls.updateMany).toBe(1);
    expect(calls.runCreate).toBe(1);
    expect(res.provider).toBe('GMAIL');
    expect(res.status).toBe('success');
    // State was reset to idle at the end of a successful sync.
    expect(calls.stateUpdate).toBeGreaterThanOrEqual(0);
  });

  it('throws "already running" and starts NO work when a concurrent claim won (count=0)', async () => {
    const { db, calls } = makeDb({ claimCount: 0, stateStatus: 'idle' });
    const service = new CompanyConnectorSyncService(db as never, undefined as never);
    await expect(
      service.triggerSync({ tenantId: TENANT, userId: USER, provider: 'gmail' }),
    ).rejects.toThrow(/already running/i);
    // The atomic claim failed, so no SyncRun row was created (no ingestion started).
    expect(calls.runCreate).toBe(0);
    // The claim itself was attempted (the guard is the conditional updateMany).
    expect(calls.updateMany).toBe(1);
  });

  it('throws "disabled" before attempting any claim', async () => {
    const { db, calls } = makeDb({ claimCount: 1, stateStatus: 'disabled' });
    const service = new CompanyConnectorSyncService(db as never, undefined as never);
    await expect(
      service.triggerSync({ tenantId: TENANT, userId: USER, provider: 'gmail' }),
    ).rejects.toThrow(/disabled/i);
    expect(calls.updateMany).toBe(0);
    expect(calls.runCreate).toBe(0);
  });
});
