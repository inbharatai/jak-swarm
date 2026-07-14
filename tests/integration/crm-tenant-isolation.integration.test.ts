import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@jak-swarm/db';
import { PrismaCRMAdapter } from '../../packages/tools/src/adapters/crm/prisma-crm.adapter.js';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Adversarial cross-tenant isolation test for the Prisma-backed CRM adapter.
 *
 * Threat model: a tool caller (agent) supplies an arbitrary `contactId` /
 * `dealId` from untrusted input. Without tenant scoping, a record id that
 * happens to belong to another tenant would be read/mutated (IDOR). This
 * suite proves the fix: every record-specific op is confined to the adapter's
 * own `tenantId`, and a cross-tenant id is indistinguishable from an absent
 * one (no existence oracle).
 *
 * Runs against a real Postgres (testcontainers) with the full migration set
 * applied, so this exercises the actual Prisma query layer — `updateMany`
 * row counting, `findFirstOrThrow` P2025 semantics, and `$transaction`
 * parent-tenant verification — not a mock. Skips gracefully when no container
 * runtime is available (the same pattern as postgres-integration.test.ts).
 */
describe.sequential('CRM adapter cross-tenant isolation (testcontainers)', () => {
  let container: Awaited<ReturnType<GenericContainer['start']>>;
  let prisma: PrismaClient;
  let runtimeUnavailable = false;

  // Two tenants + their own contacts/deals. Synthetic tenant ids are fine —
  // CrmContact.tenantId is a plain String with no FK to the Tenant table, so
  // no Tenant rows need to exist for the isolation logic under test.
  const TENANT_A = 'tenant-a-isolation';
  const TENANT_B = 'tenant-b-isolation';

  let contactA: { id: string; email: string; firstName: string };
  let contactB: { id: string; email: string; firstName: string };
  let dealA: { id: string; stage: string };
  let dealB: { id: string; stage: string };

  beforeAll(async () => {
    try {
      container = await new GenericContainer('pgvector/pgvector:pg16')
        .withEnvironment({
          POSTGRES_DB: 'jakswarm',
          POSTGRES_USER: 'jakswarm',
          POSTGRES_PASSWORD: 'jakswarm',
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/i))
        .start();

      const host = container.getHost();
      const port = container.getMappedPort(5432);
      const dbUrl = `postgresql://jakswarm:jakswarm@${host}:${port}/jakswarm`;
      process.env.DATABASE_URL = dbUrl;
      process.env.DIRECT_URL = dbUrl;

      const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
      execSync('pnpm --filter @jak-swarm/db db:migrate:deploy', {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl },
      });

      prisma = new PrismaClient();
      await prisma.$connect();

      // Seed two tenants, each with one contact + one deal.
      contactA = await prisma.crmContact.create({
        data: { tenantId: TENANT_A, firstName: 'Alfa', lastName: 'One', email: 'alfa-a@isolation.test' },
      });
      contactB = await prisma.crmContact.create({
        data: { tenantId: TENANT_B, firstName: 'Bravo', lastName: 'Two', email: 'bravo-b@isolation.test' },
      });
      dealA = await prisma.crmDeal.create({
        data: { tenantId: TENANT_A, contactId: contactA.id, name: 'Deal A' },
      });
      dealB = await prisma.crmDeal.create({
        data: { tenantId: TENANT_B, contactId: contactB.id, name: 'Deal B' },
      });
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[crm-tenant-isolation] Skipping: container runtime unavailable', error);
    }
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      try {
        await prisma.crmNote.deleteMany({});
        await prisma.crmDeal.deleteMany({});
        await prisma.crmContact.deleteMany({});
      } catch {
        // best-effort cleanup
      }
    }
    await prisma?.$disconnect();
    await container?.stop();
  });

  function adapters() {
    return {
      a: new PrismaCRMAdapter(prisma, TENANT_A),
      b: new PrismaCRMAdapter(prisma, TENANT_B),
    };
  }

  it('getContact: own tenant resolves, cross-tenant id throws', async () => {
    if (runtimeUnavailable) return;
    const { a, b } = adapters();

    const own = await a.getContact(contactA.id);
    expect(own.id).toBe(contactA.id);
    expect(own.firstName).toBe('Alfa');

    // Cross-tenant read must reject — Tenant A cannot fetch Tenant B's contact.
    await expect(a.getContact(contactB.id)).rejects.toThrow();
    await expect(b.getContact(contactA.id)).rejects.toThrow();
  });

  it('getContact: cross-tenant id is indistinguishable from an absent id (no existence oracle)', async () => {
    if (runtimeUnavailable) return;
    const { a } = adapters();
    const absentId = 'cls_nonexistent_aaaaaaaaa';

    // Both must reject. Both go through findFirstOrThrow with
    // where:{id,tenantId:TENANT_A} → Prisma P2025. Capture the error codes
    // and assert they match, so a caller cannot tell "exists in another
    // tenant" from "does not exist at all".
    const crossTenantErr = await a.getContact(contactB.id).then(
      () => null,
      (e) => e,
    );
    const absentErr = await a.getContact(absentId).then(
      () => null,
      (e) => e,
    );

    expect(crossTenantErr).toBeInstanceOf(Error);
    expect(absentErr).toBeInstanceOf(Error);
    // Same Prisma error code (P2025) for both → no information leaked.
    expect((crossTenantErr as { code?: string }).code).toBe((absentErr as { code?: string }).code);
  });

  it('updateContact: cross-tenant id throws and leaves the other tenant row untouched', async () => {
    if (runtimeUnavailable) return;
    const { a } = adapters();

    await expect(a.updateContact(contactB.id, { firstName: 'STOLEN' })).rejects.toThrow();

    // Verify Tenant B's row was NOT mutated.
    const stillB = await prisma.crmContact.findUnique({ where: { id: contactB.id } });
    expect(stillB?.firstName).toBe('Bravo');
  });

  it('updateContact: own-tenant update applies and is returned tenant-scoped', async () => {
    if (runtimeUnavailable) return;
    const { a } = adapters();

    const updated = await a.updateContact(contactA.id, { company: 'Acme' });
    expect(updated.id).toBe(contactA.id);
    expect(updated.company).toBe('Acme');

    const raw = await prisma.crmContact.findUnique({ where: { id: contactA.id } });
    expect(raw?.company).toBe('Acme');
  });

  it('createNote: cross-tenant contactId throws (parent-tenant verification) and pins no note', async () => {
    if (runtimeUnavailable) return;
    const { a } = adapters();

    // Tenant A must NOT be able to attach a note to Tenant B's contact.
    await expect(
      a.createNote(contactB.id, 'cross-tenant probe', 'user-a', 'JAK Swarm'),
    ).rejects.toThrow();

    // No note should exist for Tenant B's contact.
    const notesOnB = await prisma.crmNote.findMany({ where: { contactId: contactB.id } });
    expect(notesOnB).toHaveLength(0);
  });

  it('createNote: own-tenant contactId attaches the note', async () => {
    if (runtimeUnavailable) return;
    const { a } = adapters();

    const note = await a.createNote(contactA.id, 'legit note', 'user-a', 'JAK Swarm');
    expect(note.contactId).toBe(contactA.id);
    expect(note.content).toBe('legit note');

    const notesOnA = await prisma.crmNote.findMany({ where: { contactId: contactA.id } });
    expect(notesOnA.length).toBeGreaterThanOrEqual(1);
  });

  it('updateDealStage: cross-tenant dealId throws and leaves the other tenant deal untouched', async () => {
    if (runtimeUnavailable) return;
    const { a } = adapters();

    await expect(a.updateDealStage(dealB.id, 'CLOSED_WON')).rejects.toThrow();

    const stillB = await prisma.crmDeal.findUnique({ where: { id: dealB.id } });
    expect(stillB?.stage).toBe('PROSPECT');
  });

  it('updateDealStage: own-tenant deal applies', async () => {
    if (runtimeUnavailable) return;
    const { a } = adapters();

    const updated = await a.updateDealStage(dealA.id, 'NEGOTIATION');
    expect(updated.id).toBe(dealA.id);
    expect(updated.stage).toBe('NEGOTIATION');
  });

  it('listContacts / searchContacts / listDeals never leak the other tenant', async () => {
    if (runtimeUnavailable) return;
    const { a, b } = adapters();

    const aContacts = await a.listContacts();
    expect(aContacts.every((c) => c.id !== contactB.id)).toBe(true);
    expect(aContacts.some((c) => c.id === contactA.id)).toBe(true);

    const aSearch = await a.searchContacts('Bravo'); // Tenant B's first name
    expect(aSearch.every((c) => c.id !== contactB.id)).toBe(true);

    const aDeals = await a.listDeals();
    expect(aDeals.every((d) => d.id !== dealB.id)).toBe(true);
    expect(aDeals.some((d) => d.id === dealA.id)).toBe(true);

    // And symmetric for Tenant B.
    const bContacts = await b.listContacts();
    expect(bContacts.every((c) => c.id !== contactA.id)).toBe(true);
  });
});