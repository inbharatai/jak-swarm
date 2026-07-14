/**
 * company-brain-auto-enqueue.test.ts — pins B4: connector ingest auto-enqueues
 * Company Brain processing (truth-doc B4: the connector path never auto-enqueued).
 *
 * ingestAndEnqueue persists the artifact via companyOperatingLayer.createArtifact
 * and then fires enqueueCompanyBrainJob (an INSERT into company_brain_jobs). A
 * Brain enqueue failure must NOT roll back ingestion.
 */
import { describe, it, expect, vi } from 'vitest';
import { CompanyConnectorSyncService } from '../../../apps/api/src/services/company-brain/company-connector-sync.service.js';

const TENANT = 'tnt_test';
const USER = 'usr_test';

function makeDb() {
  const calls: string[] = [];
  const db = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push('enqueue:' + String(params[2]));
      return [{ id: 'job_1', created: true }];
    },
  };
  return { db, calls };
}

describe('CompanyConnectorSyncService B4 auto-enqueue', () => {
  it('ingestAndEnqueue persists the artifact AND enqueues a Brain job for it', async () => {
    const { db, calls } = makeDb();
    const service = new CompanyConnectorSyncService(db as never, undefined as never);
    // Stub the internally-constructed operating layer so we isolate the enqueue.
    (service as unknown as { companyOperatingLayer: { createArtifact: (a: unknown) => Promise<{ id: string }> } }).companyOperatingLayer = {
      createArtifact: async (args: unknown) => ({ id: 'art_1', ...(args as object) }),
    };

    await (service as unknown as { ingestAndEnqueue: (a: unknown) => Promise<void> }).ingestAndEnqueue({
      tenantId: TENANT,
      userId: USER,
      sourceType: 'gmail',
      artifactType: 'email',
      title: 'Q3 decision: ship Friday',
      body: 'The team decided to ship the release on Friday. Owner: Reetu.',
      externalId: 'msg_1',
    });

    // The artifact id was forwarded to the Brain jobs queue.
    expect(calls.some((c) => c === 'enqueue:art_1')).toBe(true);
  });

  it('a Brain enqueue failure does NOT throw out of ingestAndEnqueue (artifact stays ingested)', async () => {
    const db = {
      $queryRawUnsafe: async () => { throw new Error('company_brain_jobs table unavailable'); },
    };
    const service = new CompanyConnectorSyncService(db as never, undefined as never);
    let persisted: string | null = null;
    (service as unknown as { companyOperatingLayer: { createArtifact: (a: unknown) => Promise<{ id: string }> } }).companyOperatingLayer = {
      createArtifact: async () => { persisted = 'art_2'; return { id: 'art_2' }; },
    };

    // Should NOT reject: the enqueue is fire-and-forget; ingestion already succeeded.
    await expect(
      (service as unknown as { ingestAndEnqueue: (a: unknown) => Promise<void> }).ingestAndEnqueue({
        tenantId: TENANT, userId: USER, sourceType: 'gmail', artifactType: 'email',
        title: 'Decision logged', body: 'A longer body so the artifact is valid for ingestion.', externalId: 'msg_2',
      }),
    ).resolves.toBeUndefined();
    expect(persisted).toBe('art_2');
  });
});
