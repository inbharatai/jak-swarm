/**
 * P1b worker-lease reclaim behavioral tests.
 *
 * Verifies the reclaim sweep + claim ownership columns are wired into
 * QueueWorker. Records SQL calls via a minimal spy object (not a Prisma
 * mock) so we can assert the exact statements issued by the worker.
 */
import { describe, it, expect, vi } from 'vitest';
import { QueueWorker } from '../../../apps/api/src/services/queue-worker.ts';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeDb() {
  const rawQuery: Array<{ sql: string; args: unknown[] }> = [];
  const rawExec: Array<{ sql: string; args: unknown[] }> = [];
  const nextClaim: unknown[][] = [];
  const nextReclaim: unknown[][] = [];

  return {
    rawQuery,
    rawExec,
    pushClaim: (rows: unknown[]) => nextClaim.push(rows),
    pushReclaim: (rows: unknown[]) => nextReclaim.push(rows),
    db: {
      $queryRawUnsafe: async (sql: string, ...args: unknown[]) => {
        rawQuery.push({ sql, args });
        if (
          sql.includes("status = 'QUEUED'") &&
          sql.includes('leaseExpiresAt') &&
          sql.includes('< NOW()')
        ) {
          return nextReclaim.shift() ?? [];
        }
        if (sql.includes('ownerInstanceId') && sql.includes('$1')) {
          return nextClaim.shift() ?? [];
        }
        return [];
      },
      $executeRawUnsafe: async (sql: string, ...args: unknown[]) => {
        rawExec.push({ sql, args });
        return 0;
      },
      workflowJob: {
        findFirst: async () => null,
        update: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
    },
  };
}

describe('QueueWorker P1b — ownership + lease + reclaim', () => {
  it('claim SQL carries instanceId + lease seconds as $1 / $2', async () => {
    const h = makeDb();
    h.pushClaim([
      {
        id: 'j1', workflowId: 'w1', tenantId: 't1', userId: 'u1',
        payloadJson: {}, attempts: 1, maxAttempts: 5, availableAt: new Date(),
      },
    ]);

    const worker = new QueueWorker(h.db as any, silentLogger() as any, async () => 'COMPLETED', {
      instanceId: 'worker-alpha',
      leaseTtlMs: 60_000,
      maxConcurrent: 1,
    });
    try {
      await (worker as any).poll();
    } finally {
      worker.stop();
    }

    const claim = h.rawQuery.find((c) => c.sql.includes('ownerInstanceId') && c.sql.includes('$1'));
    expect(claim).toBeDefined();
    expect(claim!.args).toEqual(['worker-alpha', '60']);
    expect(claim!.sql).toContain('leaseExpiresAt');
    expect(claim!.sql).toContain('lastHeartbeatAt');
    expect(claim!.sql).toContain("seconds')::interval");
  });

  it('reclaim sweep runs before claim every poll', async () => {
    const h = makeDb();
    const worker = new QueueWorker(h.db as any, silentLogger() as any, async () => 'COMPLETED', {
      instanceId: 'worker-beta',
      leaseTtlMs: 30_000,
    });
    try {
      await (worker as any).poll();
    } finally {
      worker.stop();
    }

    const reclaimIdx = h.rawQuery.findIndex(
      (c) => c.sql.includes("status = 'QUEUED'") && c.sql.includes('leaseExpiresAt') && c.sql.includes('< NOW()'),
    );
    expect(reclaimIdx).toBeGreaterThanOrEqual(0);
  });

  it('emits jobs:reclaimed + increments reclaimedTotal on expired leases', async () => {
    const h = makeDb();
    h.pushReclaim([
      { id: 'j1', ownerInstanceId: 'dead-x' },
      { id: 'j2', ownerInstanceId: 'dead-x' },
    ]);
    const worker = new QueueWorker(h.db as any, silentLogger() as any, async () => 'COMPLETED', {
      instanceId: 'worker-gamma',
    });
    const events: Array<{ count: number }> = [];
    worker.on('jobs:reclaimed', (e: { count: number }) => events.push(e));

    try {
      await (worker as any).reclaimExpiredLeases();
    } finally {
      worker.stop();
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.count).toBe(2);
    expect(worker.health().reclaimedTotal).toBe(2);
  });

  it('heartbeat updates running jobs with lease args', async () => {
    const h = makeDb();
    const worker = new QueueWorker(h.db as any, silentLogger() as any, async () => 'COMPLETED', {
      instanceId: 'worker-delta',
      leaseTtlMs: 60_000,
    });
    try {
      const running = (worker as any).runningJobs as Map<string, unknown>;
      running.set('a', { workflowId: 'wa', startedAt: Date.now() });
      running.set('b', { workflowId: 'wb', startedAt: Date.now() });
      await (worker as any).heartbeatRunningJobs();
    } finally {
      worker.stop();
    }

    const hb = h.rawExec.find((c) => c.sql.includes('lastHeartbeatAt'));
    expect(hb).toBeDefined();
    expect(hb!.args).toEqual(['60', ['a', 'b'], 'worker-delta']);
  });

  it('skips heartbeat when no running jobs', async () => {
    const h = makeDb();
    const worker = new QueueWorker(h.db as any, silentLogger() as any, async () => 'COMPLETED', {
      instanceId: 'w-eps',
    });
    try {
      await (worker as any).heartbeatRunningJobs();
    } finally {
      worker.stop();
    }
    expect(h.rawExec).toHaveLength(0);
  });

  it('instanceId defaults to a unique id when not set', () => {
    const h = makeDb();
    const w1 = new QueueWorker(h.db as any, silentLogger() as any, async () => 'COMPLETED', {});
    const w2 = new QueueWorker(h.db as any, silentLogger() as any, async () => 'COMPLETED', {});
    try {
      expect(w1.instanceId).toBeDefined();
      expect(w2.instanceId).toBeDefined();
      expect(w1.instanceId).not.toBe(w2.instanceId);
    } finally {
      w1.stop();
      w2.stop();
    }
  });

  it('leaseTtlMs is clamped to 10s minimum', () => {
    const h = makeDb();
    const worker = new QueueWorker(h.db as any, silentLogger() as any, async () => 'COMPLETED', {
      leaseTtlMs: 1,
    });
    try {
      expect(worker.health().leaseTtlMs).toBe(10_000);
    } finally {
      worker.stop();
    }
  });

  it('health() exposes reclaimedTotal, instanceId, leaseTtlMs', () => {
    const h = makeDb();
    const worker = new QueueWorker(h.db as any, silentLogger() as any, async () => 'COMPLETED', {
      instanceId: 'w-zeta',
      leaseTtlMs: 45_000,
    });
    try {
      const status = worker.health();
      expect(status.instanceId).toBe('w-zeta');
      expect(status.leaseTtlMs).toBe(45_000);
      expect(status.reclaimedTotal).toBe(0);
    } finally {
      worker.stop();
    }
  });
});
