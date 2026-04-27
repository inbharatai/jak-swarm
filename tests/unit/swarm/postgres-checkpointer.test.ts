/**
 * PostgresCheckpointSaver unit tests — Sprint 2.5 / A.2.
 *
 * Verifies the LangGraph BaseCheckpointSaver implementation against an
 * in-memory fake of the Prisma client. The real Prisma path is exercised
 * by the integration suite; these unit tests cover the
 * tenant-isolation, serialization, and round-trip semantics in
 * isolation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  PostgresCheckpointSaver,
  type CheckpointPrismaClient,
} from '../../../packages/swarm/src/workflow-runtime/postgres-checkpointer.js';
import type { Checkpoint, CheckpointMetadata } from '@langchain/langgraph';

// ─── Fake Prisma client ───────────────────────────────────────────────────

interface Row {
  id: string;
  threadId: string;
  checkpointNs: string;
  checkpointId: string;
  parentCheckpointId: string | null;
  tenantId: string;
  type: string;
  checkpointJson: unknown;
  metadataJson: unknown;
  channelVersionsJson: unknown;
  taskId: string | null;
  writesJson: unknown;
  createdAt: Date;
}

function makeFakePrisma(): { db: CheckpointPrismaClient; rows: Row[] } {
  const rows: Row[] = [];
  let idCounter = 0;

  function matches(row: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && 'lt' in (v as object)) {
        if (!((row as unknown as Record<string, unknown>)[k]! < (v as { lt: string }).lt)) return false;
      } else if ((row as unknown as Record<string, unknown>)[k] !== v) {
        return false;
      }
    }
    return true;
  }

  const db: CheckpointPrismaClient = {
    workflowCheckpoint: {
      async findFirst(args: unknown) {
        const a = args as { where: Record<string, unknown>; orderBy?: unknown };
        const filtered = rows.filter((r) => matches(r, a.where));
        // Newest-first if orderBy createdAt desc
        filtered.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
        return filtered[0] ?? null;
      },
      async findMany(args: unknown) {
        const a = args as { where: Record<string, unknown>; orderBy?: unknown; take?: number };
        let filtered = rows.filter((r) => matches(r, a.where));
        filtered.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
        if (typeof a.take === 'number') filtered = filtered.slice(0, a.take);
        return filtered;
      },
      async create(args: unknown) {
        const a = args as { data: Omit<Row, 'id' | 'createdAt'> };
        const row: Row = {
          id: `row_${++idCounter}`,
          createdAt: new Date(Date.now() + idCounter), // monotonic for sort stability
          ...a.data,
        };
        rows.push(row);
        return row;
      },
      async upsert() { throw new Error('upsert not used'); },
      async deleteMany(args: unknown) {
        const a = args as { where: Record<string, unknown> };
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i];
          if (row && matches(row, a.where)) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      },
      async updateMany() { throw new Error('updateMany not used'); },
    },
  };
  return { db, rows };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const TENANT_A = 'tenant_a';
const TENANT_B = 'tenant_b';
const THREAD_X = 'workflow_x';
const THREAD_Y = 'workflow_y';

function makeConfig(tenantId: string, threadId: string, checkpointId?: string): RunnableConfig {
  return {
    configurable: {
      tenantId,
      thread_id: threadId,
      checkpoint_ns: '',
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
    },
  };
}

function makeCheckpoint(id: string, taskCount = 1): Checkpoint {
  return {
    v: 4,
    id,
    ts: new Date().toISOString(),
    channel_values: { taskResults: { task_1: { result: 'hello' } }, currentTaskIndex: taskCount },
    channel_versions: { taskResults: 1, currentTaskIndex: 1 },
    versions_seen: {},
  };
}

function makeMetadata(step: number): CheckpointMetadata {
  return { source: 'loop', step, parents: {} };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('PostgresCheckpointSaver — basic round-trip', () => {
  let saver: PostgresCheckpointSaver;
  let rows: Row[];

  beforeEach(() => {
    const fake = makeFakePrisma();
    rows = fake.rows;
    saver = new PostgresCheckpointSaver(fake.db);
  });

  it('put then getTuple returns the same checkpoint', async () => {
    const checkpoint = makeCheckpoint('cp_1');
    const metadata = makeMetadata(0);
    const cfg = makeConfig(TENANT_A, THREAD_X);

    const result = await saver.put(cfg, checkpoint, metadata, { taskResults: 1 });
    expect(result.configurable?.checkpoint_id).toBe('cp_1');

    const tuple = await saver.getTuple(makeConfig(TENANT_A, THREAD_X, 'cp_1'));
    expect(tuple).toBeDefined();
    expect(tuple!.checkpoint.id).toBe('cp_1');
    expect(tuple!.checkpoint.channel_values.currentTaskIndex).toBe(1);
    expect(tuple!.metadata?.source).toBe('loop');
  });

  it('getTuple without checkpoint_id returns the most recent checkpoint', async () => {
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_1'), makeMetadata(0), {});
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_2', 2), makeMetadata(1), {});
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_3', 3), makeMetadata(2), {});

    const tuple = await saver.getTuple(makeConfig(TENANT_A, THREAD_X));
    expect(tuple!.checkpoint.id).toBe('cp_3');
    expect(tuple!.checkpoint.channel_values.currentTaskIndex).toBe(3);
  });

  it('returns undefined for non-existent thread', async () => {
    const tuple = await saver.getTuple(makeConfig(TENANT_A, 'no_such_thread'));
    expect(tuple).toBeUndefined();
  });

  it('put is idempotent on (threadId, checkpointId)', async () => {
    const cp = makeCheckpoint('cp_1');
    await saver.put(makeConfig(TENANT_A, THREAD_X), cp, makeMetadata(0), {});
    await saver.put(makeConfig(TENANT_A, THREAD_X), cp, makeMetadata(0), {});
    const checkpointRows = rows.filter((r) => r.type === 'checkpoint' && r.checkpointId === 'cp_1');
    expect(checkpointRows).toHaveLength(1);
  });
});

describe('PostgresCheckpointSaver — tenant isolation (CRITICAL SECURITY)', () => {
  let saver: PostgresCheckpointSaver;

  beforeEach(() => {
    const fake = makeFakePrisma();
    saver = new PostgresCheckpointSaver(fake.db);
  });

  it('throws when tenantId is missing from config', async () => {
    const cfg: RunnableConfig = { configurable: { thread_id: THREAD_X } };
    await expect(saver.getTuple(cfg)).rejects.toThrow(/tenantId is required/);
    await expect(saver.put(cfg, makeCheckpoint('cp_1'), makeMetadata(0), {})).rejects.toThrow(
      /tenantId is required/,
    );
    await expect(saver.putWrites(cfg, [], 'task_1')).rejects.toThrow(/tenantId is required/);
  });

  it('tenant A cannot read tenant B checkpoints', async () => {
    // Tenant A writes
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_a'), makeMetadata(0), {});
    // Tenant B tries to read tenant A's thread by thread_id
    const tuple = await saver.getTuple(makeConfig(TENANT_B, THREAD_X));
    expect(tuple).toBeUndefined();
  });

  it('tenant A cannot read tenant B by explicit checkpoint_id', async () => {
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_a'), makeMetadata(0), {});
    const tuple = await saver.getTuple(makeConfig(TENANT_B, THREAD_X, 'cp_a'));
    expect(tuple).toBeUndefined();
  });

  it('tenant A cannot list tenant B checkpoints', async () => {
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_a'), makeMetadata(0), {});
    const collected: unknown[] = [];
    for await (const tuple of saver.list(makeConfig(TENANT_B, THREAD_X))) collected.push(tuple);
    expect(collected).toHaveLength(0);
  });

  it('deleteThread without explicit tenant API throws (security guard)', async () => {
    await expect(saver.deleteThread(THREAD_X)).rejects.toThrow(/Use deleteThreadForTenant/);
  });

  it('deleteThreadForTenant only removes that tenants rows', async () => {
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_a'), makeMetadata(0), {});
    await saver.put(makeConfig(TENANT_B, THREAD_X), makeCheckpoint('cp_b'), makeMetadata(0), {});
    const removed = await saver.deleteThreadForTenant(TENANT_A, THREAD_X);
    expect(removed).toBe(1);
    // Tenant B's data still readable
    const tuple = await saver.getTuple(makeConfig(TENANT_B, THREAD_X));
    expect(tuple).toBeDefined();
    expect(tuple!.checkpoint.id).toBe('cp_b');
  });
});

describe('PostgresCheckpointSaver — list + filter', () => {
  let saver: PostgresCheckpointSaver;

  beforeEach(() => {
    const fake = makeFakePrisma();
    saver = new PostgresCheckpointSaver(fake.db);
  });

  it('list yields newest-first by default', async () => {
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_1'), makeMetadata(0), {});
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_2'), makeMetadata(1), {});
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_3'), makeMetadata(2), {});

    const ids: string[] = [];
    for await (const t of saver.list(makeConfig(TENANT_A, THREAD_X))) {
      ids.push(t.checkpoint.id);
    }
    expect(ids).toEqual(['cp_3', 'cp_2', 'cp_1']);
  });

  it('list honors the limit option', async () => {
    for (let i = 1; i <= 5; i++) {
      await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint(`cp_${i}`), makeMetadata(i), {});
    }
    const collected: unknown[] = [];
    for await (const t of saver.list(makeConfig(TENANT_A, THREAD_X), { limit: 2 })) {
      collected.push(t);
    }
    expect(collected).toHaveLength(2);
  });

  it('list honors the metadata filter', async () => {
    await saver.put(
      makeConfig(TENANT_A, THREAD_X),
      makeCheckpoint('cp_1'),
      { source: 'loop', step: 0, parents: {} },
      {},
    );
    await saver.put(
      makeConfig(TENANT_A, THREAD_X),
      makeCheckpoint('cp_2'),
      { source: 'input', step: -1, parents: {} },
      {},
    );
    const ids: string[] = [];
    for await (const t of saver.list(makeConfig(TENANT_A, THREAD_X), { filter: { source: 'loop' } })) {
      ids.push(t.checkpoint.id);
    }
    expect(ids).toEqual(['cp_1']);
  });
});

describe('PostgresCheckpointSaver — putWrites round-trip', () => {
  let saver: PostgresCheckpointSaver;

  beforeEach(() => {
    const fake = makeFakePrisma();
    saver = new PostgresCheckpointSaver(fake.db);
  });

  it('persists pending writes and returns them on getTuple', async () => {
    // First lay down a parent checkpoint
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_parent'), makeMetadata(0), {});
    // Then add writes referencing that checkpoint
    await saver.putWrites(
      makeConfig(TENANT_A, THREAD_X, 'cp_parent'),
      [
        ['taskResults', { task_1: { result: 'partial' } }],
        ['accumulatedCostUsd', 0.005],
      ],
      'task_1',
    );

    const tuple = await saver.getTuple(makeConfig(TENANT_A, THREAD_X, 'cp_parent'));
    expect(tuple!.pendingWrites).toBeDefined();
    expect(tuple!.pendingWrites).toHaveLength(2);
    const channels = (tuple!.pendingWrites ?? []).map((w) => w[1]);
    expect(channels).toContain('taskResults');
    expect(channels).toContain('accumulatedCostUsd');
  });

  it('putWrites without checkpoint_id throws', async () => {
    const cfg = makeConfig(TENANT_A, THREAD_X); // no checkpoint_id
    await expect(saver.putWrites(cfg, [['x', 1]], 'task_1')).rejects.toThrow(/checkpoint_id is required/);
  });

  it('writes are tenant-scoped (cross-tenant readers see none)', async () => {
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_p'), makeMetadata(0), {});
    await saver.putWrites(makeConfig(TENANT_A, THREAD_X, 'cp_p'), [['x', 1]], 'task_1');

    // Tenant B reads the parent (none) — pendingWrites should not leak
    const bTuple = await saver.getTuple(makeConfig(TENANT_B, THREAD_X, 'cp_p'));
    expect(bTuple).toBeUndefined();
  });
});

describe('PostgresCheckpointSaver — failure recovery semantics', () => {
  let saver: PostgresCheckpointSaver;

  beforeEach(() => {
    const fake = makeFakePrisma();
    saver = new PostgresCheckpointSaver(fake.db);
  });

  it('parentCheckpointId is preserved across put for resume traceability', async () => {
    // Parent
    await saver.put(makeConfig(TENANT_A, THREAD_X), makeCheckpoint('cp_1'), makeMetadata(0), {});
    // Child references parent via config
    await saver.put(
      makeConfig(TENANT_A, THREAD_X, 'cp_1'),
      makeCheckpoint('cp_2'),
      makeMetadata(1),
      {},
    );
    const tuple = await saver.getTuple(makeConfig(TENANT_A, THREAD_X, 'cp_2'));
    expect(tuple!.parentConfig?.configurable?.checkpoint_id).toBe('cp_1');
  });

  it('round-trips a checkpoint with deeply nested SwarmState shape', async () => {
    const heavyCheckpoint: Checkpoint = {
      v: 4,
      id: 'cp_heavy',
      ts: new Date().toISOString(),
      channel_values: {
        taskResults: {
          task_1: { result: 'hello', cost: 0.01 },
          task_2: { result: 'world', cost: 0.02, nested: { deep: ['a', 'b', 1, 2] } },
        },
        verificationResults: {
          task_1: { passed: true, confidence: 0.9, issues: [] },
        },
        plan: { tasks: [{ id: 't1', name: 'Hello' }] },
        accumulatedCostUsd: 0.03,
      },
      channel_versions: { taskResults: 2, verificationResults: 1, plan: 1, accumulatedCostUsd: 1 },
      versions_seen: {},
    };
    await saver.put(makeConfig(TENANT_A, THREAD_X), heavyCheckpoint, makeMetadata(0), {});

    const tuple = await saver.getTuple(makeConfig(TENANT_A, THREAD_X));
    expect(tuple!.checkpoint.channel_values.taskResults).toEqual(heavyCheckpoint.channel_values.taskResults);
    expect(tuple!.checkpoint.channel_values.verificationResults).toEqual(
      heavyCheckpoint.channel_values.verificationResults,
    );
    expect(tuple!.checkpoint.channel_values.accumulatedCostUsd).toBe(0.03);
  });
});
