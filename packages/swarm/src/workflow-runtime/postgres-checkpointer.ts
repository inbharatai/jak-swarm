/**
 * PostgresCheckpointSaver — Sprint 2.5 / A.2.
 *
 * A real LangGraph BaseCheckpointSaver backed by the
 * `workflow_checkpoints` Prisma table. Replaces the previous
 * `Workflow.stateJson` storage when LangGraph is the active runtime.
 *
 * Tenant isolation:
 *   - `RunnableConfig.configurable.tenantId` is REQUIRED on every call.
 *     The saver throws if it is missing — no anonymous tenant access.
 *   - Every Prisma query carries `tenantId` in the WHERE clause.
 *     Cross-tenant reads return undefined (the checkpoint "does not
 *     exist" from the caller's perspective).
 *   - `deleteThread` requires tenantId for the same reason.
 *
 * Serialization:
 *   - Reuses the inherited JSONPlus serializer from BaseCheckpointSaver.
 *   - The serializer returns `[type, Uint8Array]`; we base64-encode the
 *     Uint8Array for storage in a JSONB column. JSONB cannot hold raw
 *     binary bytes, so the {type, bytes} pair is serialized as
 *     `{ type: 'json', bytes_b64: '...' }`.
 *   - On read, the pair is decoded back to Uint8Array before being
 *     handed to `serde.loadsTyped(type, bytes)`.
 *
 * Concurrency:
 *   - LangGraph guarantees one-writer-per-thread at the orchestration
 *     level, so we do not need row-level locking.
 *   - Multiple workflows for the same tenant write concurrently to
 *     different `thread_id` values.
 */

import { Buffer } from 'node:buffer';
import type { RunnableConfig } from '@langchain/core/runnables';
// @langchain/langgraph re-exports the checkpoint primitives so we don't
// need a direct dep on @langchain/langgraph-checkpoint.
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  copyCheckpoint,
} from '@langchain/langgraph';
// ChannelVersions + the lower-level write primitives are exported only
// from the checkpoint package; langgraph re-exports the high-level
// surface but not these. Direct dep on @langchain/langgraph-checkpoint
// is declared in package.json.
import type {
  ChannelVersions,
  CheckpointListOptions,
  CheckpointPendingWrite,
  PendingWrite,
  SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import { WRITES_IDX_MAP } from '@langchain/langgraph-checkpoint';

/**
 * Minimal Prisma client interface — accepts any client whose
 * `workflowCheckpoint` model has the methods we use. This avoids
 * coupling the swarm package to `@jak-swarm/db` (which would add a
 * heavy build dependency).
 */
export interface CheckpointPrismaClient {
  workflowCheckpoint: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<{ count: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

interface PersistedCheckpointRow {
  threadId: string;
  checkpointNs: string;
  checkpointId: string;
  parentCheckpointId: string | null;
  tenantId: string;
  type: 'checkpoint' | 'write';
  checkpointJson: SerializedPair | null;
  metadataJson: SerializedPair | null;
  channelVersionsJson: ChannelVersions | null;
  taskId: string | null;
  writesJson: SerializedWrite[] | null;
  createdAt: Date;
}

interface SerializedPair {
  type: string;
  bytes_b64: string;
}

interface SerializedWrite {
  channel: string;
  idx: number;
  taskId: string;
  value: SerializedPair;
}

function requireTenantId(config: RunnableConfig): string {
  const tenantId = config.configurable?.['tenantId'];
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new Error(
      '[PostgresCheckpointSaver] config.configurable.tenantId is required. ' +
        'Every checkpoint read/write must be tenant-scoped.',
    );
  }
  return tenantId;
}

function requireThreadId(config: RunnableConfig, op: string): string {
  const threadId = config.configurable?.['thread_id'];
  if (typeof threadId !== 'string' || threadId.length === 0) {
    throw new Error(
      `[PostgresCheckpointSaver.${op}] config.configurable.thread_id is required.`,
    );
  }
  return threadId;
}

function getCheckpointNs(config: RunnableConfig): string {
  const ns = config.configurable?.['checkpoint_ns'];
  return typeof ns === 'string' ? ns : '';
}

function getCheckpointId(config: RunnableConfig): string | undefined {
  const id = config.configurable?.['checkpoint_id'];
  return typeof id === 'string' ? id : undefined;
}

function encodePair(pair: [string, Uint8Array]): SerializedPair {
  return { type: pair[0], bytes_b64: Buffer.from(pair[1]).toString('base64') };
}

function decodePair(payload: unknown): [string, Uint8Array] {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as SerializedPair).type !== 'string' ||
    typeof (payload as SerializedPair).bytes_b64 !== 'string'
  ) {
    throw new Error('[PostgresCheckpointSaver] malformed serialized pair');
  }
  const p = payload as SerializedPair;
  return [p.type, new Uint8Array(Buffer.from(p.bytes_b64, 'base64'))];
}

export class PostgresCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    private readonly db: CheckpointPrismaClient,
    serde?: SerializerProtocol,
  ) {
    super(serde);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const tenantId = requireTenantId(config);
    const threadId = requireThreadId(config, 'getTuple');
    const checkpointNs = getCheckpointNs(config);
    const checkpointId = getCheckpointId(config);

    // Load either a specific checkpoint by id, or the most recent one.
    const row = (await this.db.workflowCheckpoint.findFirst({
      where: {
        tenantId,
        threadId,
        checkpointNs,
        type: 'checkpoint',
        ...(checkpointId ? { checkpointId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })) as PersistedCheckpointRow | null;

    if (!row || !row.checkpointJson || !row.metadataJson) return undefined;

    const checkpointPair = decodePair(row.checkpointJson);
    const metadataPair = decodePair(row.metadataJson);
    const checkpoint = (await this.serde.loadsTyped(
      checkpointPair[0],
      checkpointPair[1],
    )) as Checkpoint;
    const metadata = (await this.serde.loadsTyped(
      metadataPair[0],
      metadataPair[1],
    )) as CheckpointMetadata;

    // Pending writes for this checkpoint
    const writeRows = (await this.db.workflowCheckpoint.findMany({
      where: {
        tenantId,
        threadId,
        checkpointNs,
        parentCheckpointId: row.checkpointId,
        type: 'write',
      },
    })) as PersistedCheckpointRow[];

    const pendingWrites: CheckpointPendingWrite[] = [];
    for (const w of writeRows) {
      if (!w.writesJson) continue;
      for (const item of w.writesJson) {
        const value = await this.serde.loadsTyped(
          item.value.type,
          new Uint8Array(Buffer.from(item.value.bytes_b64, 'base64')),
        );
        pendingWrites.push([item.taskId, item.channel, value]);
      }
    }

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.checkpointId,
          tenantId,
        },
      },
      checkpoint,
      metadata,
      pendingWrites,
    };
    if (row.parentCheckpointId) {
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.parentCheckpointId,
          tenantId,
        },
      };
    }
    return tuple;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const tenantId = requireTenantId(config);
    const threadId = requireThreadId(config, 'list');
    const checkpointNs = getCheckpointNs(config);
    const before = options?.before;
    const beforeId = before ? getCheckpointId(before) : undefined;

    const rows = (await this.db.workflowCheckpoint.findMany({
      where: {
        tenantId,
        threadId,
        checkpointNs,
        type: 'checkpoint',
        ...(beforeId ? { checkpointId: { lt: beforeId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      ...(typeof options?.limit === 'number' ? { take: options.limit } : {}),
    })) as PersistedCheckpointRow[];

    for (const row of rows) {
      if (!row.checkpointJson || !row.metadataJson) continue;
      const cp = decodePair(row.checkpointJson);
      const md = decodePair(row.metadataJson);
      const checkpoint = (await this.serde.loadsTyped(cp[0], cp[1])) as Checkpoint;
      const metadata = (await this.serde.loadsTyped(md[0], md[1])) as CheckpointMetadata;

      // Optional metadata filter (e.g. { source: 'loop' })
      if (options?.filter && !metadataMatchesFilter(metadata, options.filter)) {
        continue;
      }

      const tuple: CheckpointTuple = {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: row.checkpointId,
            tenantId,
          },
        },
        checkpoint,
        metadata,
      };
      if (row.parentCheckpointId) {
        tuple.parentConfig = {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: row.parentCheckpointId,
            tenantId,
          },
        };
      }
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const tenantId = requireTenantId(config);
    const threadId = requireThreadId(config, 'put');
    const checkpointNs = getCheckpointNs(config);
    const parentId = getCheckpointId(config);

    const prepared = copyCheckpoint(checkpoint);
    const [serializedCheckpoint, serializedMetadata] = await Promise.all([
      this.serde.dumpsTyped(prepared),
      this.serde.dumpsTyped(metadata),
    ]);

    const data = {
      threadId,
      checkpointNs,
      checkpointId: prepared.id,
      parentCheckpointId: parentId ?? null,
      tenantId,
      type: 'checkpoint',
      checkpointJson: encodePair(serializedCheckpoint),
      metadataJson: encodePair(serializedMetadata),
      channelVersionsJson: newVersions as unknown as object,
      taskId: null,
      writesJson: null,
    };

    // Idempotent on (threadId, checkpointNs, checkpointId).
    // We use a delete-then-create pattern instead of upsert because the
    // unique constraint is conditional (WHERE type='checkpoint').
    await this.db.workflowCheckpoint.deleteMany({
      where: {
        tenantId,
        threadId,
        checkpointNs,
        checkpointId: prepared.id,
        type: 'checkpoint',
      },
    });
    await this.db.workflowCheckpoint.create({ data });

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: prepared.id,
        tenantId,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const tenantId = requireTenantId(config);
    const threadId = requireThreadId(config, 'putWrites');
    const checkpointNs = getCheckpointNs(config);
    const checkpointId = getCheckpointId(config);
    if (!checkpointId) {
      throw new Error(
        '[PostgresCheckpointSaver.putWrites] config.configurable.checkpoint_id is required.',
      );
    }

    // Serialize all writes
    const writeItems: SerializedWrite[] = await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const pair = await this.serde.dumpsTyped(value);
        return {
          channel,
          idx: WRITES_IDX_MAP[channel] ?? idx,
          taskId,
          value: encodePair(pair),
        };
      }),
    );

    // One write row per task per parent checkpoint. We use updateMany to
    // overwrite any previous write rows for the same (taskId,
    // checkpointId) pair (LangGraph occasionally re-emits writes during
    // retries; we keep the latest).
    await this.db.workflowCheckpoint.deleteMany({
      where: {
        tenantId,
        threadId,
        checkpointNs,
        parentCheckpointId: checkpointId,
        taskId,
        type: 'write',
      },
    });
    await this.db.workflowCheckpoint.create({
      data: {
        threadId,
        checkpointNs,
        // Synthesize a unique id for the write row from the parent +
        // taskId; the table's primary key is `id` so collisions are
        // avoided by including `Date.now()` in the cuid generation
        // (Prisma @default(cuid())).
        checkpointId: `${checkpointId}::write::${taskId}`,
        parentCheckpointId: checkpointId,
        tenantId,
        type: 'write',
        checkpointJson: null,
        metadataJson: null,
        channelVersionsJson: null,
        taskId,
        writesJson: writeItems as unknown as object,
      },
    });
  }

  /**
   * Hard-delete every checkpoint and write for a thread. Tenant-scoped
   * for safety even though the LangGraph contract takes only threadId
   * — `tenantId` is read from a temporary RunnableConfig the caller
   * MUST set (we expose `deleteThreadForTenant` as the safe API and
   * `deleteThread` throws to force the explicit tenant version).
   */
  async deleteThread(threadId: string): Promise<void> {
    void threadId;
    throw new Error(
      '[PostgresCheckpointSaver.deleteThread] Use deleteThreadForTenant(tenantId, threadId) instead. ' +
        'This saver is tenant-scoped and refuses to delete without explicit tenantId.',
    );
  }

  /**
   * Tenant-scoped thread deletion. Returns the number of rows removed.
   */
  async deleteThreadForTenant(tenantId: string, threadId: string): Promise<number> {
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      throw new Error('[PostgresCheckpointSaver.deleteThreadForTenant] tenantId required.');
    }
    if (typeof threadId !== 'string' || threadId.length === 0) {
      throw new Error('[PostgresCheckpointSaver.deleteThreadForTenant] threadId required.');
    }
    const result = await this.db.workflowCheckpoint.deleteMany({
      where: { tenantId, threadId },
    });
    return result.count;
  }
}

function metadataMatchesFilter(
  metadata: CheckpointMetadata,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if ((metadata as unknown as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}
