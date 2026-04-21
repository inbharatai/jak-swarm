/**
 * Memory adapter shape parity — proves InMemoryAdapter and DbMemoryAdapter
 * return the same object shape from get().
 *
 * Agents use both adapters interchangeably: the in-memory one in tests and
 * standalone scripts, the DB-backed one in production. If their shapes
 * diverge (e.g. DB returns `{ value, type, source, confidence, updatedAt }`
 * but the in-memory one returns `{ value, type, source, updatedAt }`), code
 * that works in tests may silently misread in prod — a subtle class of bug
 * that this test exists to catch.
 *
 * Both adapters MUST return an object with the same keys. Numeric values
 * may differ (DB returns confidence from the row, in-memory returns
 * whatever was passed at set()); but `Object.keys()` must match.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryAdapter, DbMemoryAdapter } from '@jak-swarm/tools';

// Minimal PrismaLike stub — implements only what DbMemoryAdapter.get/set use.
// We hand-roll this instead of faking the full Prisma surface because we just
// want to verify the adapter's output shape, not the DB round-trip.
function makeStubPrisma(): { prisma: unknown; seed: (row: Record<string, unknown>) => void } {
  const rows: Record<string, unknown>[] = [];

  const prisma = {
    memoryItem: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return (
          rows.find(
            (r) =>
              r.tenantId === where.tenantId &&
              r.scopeType === where.scopeType &&
              r.scopeId === where.scopeId &&
              r.key === where.key,
          ) ?? null
        );
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const match = rows.find((r) => r.id === where.id);
        if (match) Object.assign(match, data);
        return match;
      },
    },
  };
  return {
    prisma,
    seed: (row) => rows.push(row),
  };
}

describe('Memory adapter shape parity', () => {
  it('InMemoryAdapter.get and DbMemoryAdapter.get return objects with the same keys', async () => {
    const inMem = new InMemoryAdapter();
    const { prisma, seed } = makeStubPrisma();
    const db = new DbMemoryAdapter(prisma as never);

    // Seed the stubbed DB directly with what set() would have written — this
    // keeps the test focused on the GET-shape contract and sidesteps the
    // DB-backed set() code path (tested elsewhere).
    seed({
      id: 'mem_1',
      tenantId: 'tenant-1',
      scopeType: 'TENANT',
      scopeId: 'tenant-1',
      key: 'k1',
      value: { foo: 'bar' },
      memoryType: 'KNOWLEDGE',
      source: 'agent',
      confidence: 0.9,
      expiresAt: null,
      deletedAt: null,
      updatedAt: new Date('2026-04-21T12:00:00Z'),
    });

    await inMem.set('k1', { foo: 'bar' }, 'tenant-1', { type: 'KNOWLEDGE', source: 'agent', confidence: 0.9 });

    const fromMem = (await inMem.get('k1', 'tenant-1')) as Record<string, unknown>;
    const fromDb = (await db.get('k1', 'tenant-1')) as Record<string, unknown>;

    expect(fromMem).not.toBeNull();
    expect(fromDb).not.toBeNull();

    // The two objects must carry the same keys. Values are allowed to differ
    // (e.g. updatedAt timestamps drift, DB may coerce types) — we just want
    // callers to be able to destructure `{ value, type, source, confidence, updatedAt }`
    // interchangeably.
    const memKeys = Object.keys(fromMem).sort();
    const dbKeys = Object.keys(fromDb).sort();

    expect(memKeys).toEqual(dbKeys);

    // Spot-check: both have `value`
    expect(fromMem.value).toBeDefined();
    expect(fromDb.value).toBeDefined();
    // Both carry a confidence field (even if undefined for mem-only entries)
    expect('confidence' in fromMem).toBe(true);
    expect('confidence' in fromDb).toBe(true);
  });

  it('InMemoryAdapter.get returns a fresh object on each call (no shared reference)', async () => {
    const inMem = new InMemoryAdapter();
    await inMem.set('k1', { foo: 'bar' }, 'tenant-1');

    const a = (await inMem.get('k1', 'tenant-1')) as Record<string, unknown>;
    const b = (await inMem.get('k1', 'tenant-1')) as Record<string, unknown>;

    // Different references — callers can mutate `a` without affecting `b`.
    expect(a).not.toBe(b);
    // Same shape
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it('both adapters return null for missing keys', async () => {
    const inMem = new InMemoryAdapter();
    const { prisma } = makeStubPrisma();
    const db = new DbMemoryAdapter(prisma as never);

    expect(await inMem.get('missing', 'tenant-1')).toBeNull();
    expect(await db.get('missing', 'tenant-1')).toBeNull();
  });
});
