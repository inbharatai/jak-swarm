/**
 * db-memory-adapter-tenant-isolation.test.ts — pins knowledge/memory injection
 * accuracy (truth-doc E1: cross-tenant inference-leakage was untested). The
 * DbMemoryAdapter must scope every read by tenantId so tenant B can never
 * retrieve tenant A's memory. Verified at the adapter boundary with a fake
 * prisma that honours the where clause.
 */
import { describe, it, expect } from 'vitest';
import { DbMemoryAdapter } from '../../../packages/tools/src/adapters/memory/db-memory.adapter.js';

interface Row {
  id: string;
  tenantId: string;
  scopeType: string;
  scopeId: string;
  key: string;
  value: unknown;
  deletedAt: Date | null;
  expiresAt: Date | null;
}

function fakePrisma(rows: Row[]) {
  return {
    memoryItem: {
      findFirst: async ({ where }: { where: Partial<Row> & { OR?: unknown[] } }) => {
        return rows.find(
          (r) =>
            r.tenantId === where.tenantId &&
            r.scopeType === where.scopeType &&
            r.scopeId === where.scopeId &&
            r.key === where.key &&
            (where.includeDeleted || !r.deletedAt) &&
            (!r.expiresAt || r.expiresAt.getTime() > Date.now()),
        ) ?? null;
      },
      update: async () => ({}),
    },
    $queryRawUnsafe: async () => [],
  } as never;
}

describe('DbMemoryAdapter tenant isolation (knowledge injection accuracy)', () => {
  it('returns the value for the owning tenant', async () => {
    const rows: Row[] = [
      { id: 'm1', tenantId: 'tenantA', scopeType: 'TENANT', scopeId: 'tenantA', key: 'roadmap', value: { next: 'ship Friday' }, deletedAt: null, expiresAt: null },
    ];
    const adapter = new DbMemoryAdapter(fakePrisma(rows));
    const got = await adapter.get('roadmap', 'tenantA');
    expect(got).not.toBeNull();
    expect(got?.value).toEqual({ next: 'ship Friday' });
  });

  it('returns null for a different tenant (no cross-tenant leak)', async () => {
    const rows: Row[] = [
      { id: 'm1', tenantId: 'tenantA', scopeType: 'TENANT', scopeId: 'tenantA', key: 'roadmap', value: { next: 'ship Friday' }, deletedAt: null, expiresAt: null },
    ];
    const adapter = new DbMemoryAdapter(fakePrisma(rows));
    expect(await adapter.get('roadmap', 'tenantB')).toBeNull();
  });

  it('does not leak across scope within the same tenant (scopeId is part of the key)', async () => {
    const rows: Row[] = [
      { id: 'm1', tenantId: 'tenantA', scopeType: 'PROJECT', scopeId: 'proj-secret', key: 'k', value: 'secret', deletedAt: null, expiresAt: null },
    ];
    const adapter = new DbMemoryAdapter(fakePrisma(rows));
    // Same tenant, different project scope -> no leak.
    expect(await adapter.get('k', 'tenantA', { scopeType: 'PROJECT', scopeId: 'proj-other' })).toBeNull();
    // Same tenant + same project scope -> returns.
    expect(await adapter.get('k', 'tenantA', { scopeType: 'PROJECT', scopeId: 'proj-secret' })).not.toBeNull();
  });
});
