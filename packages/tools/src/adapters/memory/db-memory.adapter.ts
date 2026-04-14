/**
 * Memory adapter interface and implementations.
 *
 * - InMemoryAdapter: Uses a simple Map (current behavior, for tests/standalone).
 * - DbMemoryAdapter: Uses Prisma via @jak-swarm/db for persistent storage.
 *
 * The active adapter is selected at runtime:
 *   - If @jak-swarm/db is importable, use DbMemoryAdapter.
 *   - Otherwise, fall back to InMemoryAdapter.
 */

// ─── Interface ───────────────────────────────────────────────────────────────

export interface MemoryAdapter {
  get(key: string, tenantId?: string, opts?: MemoryGetOptions): Promise<unknown>;
  set(key: string, value: unknown, tenantId?: string, opts?: MemorySetOptions): Promise<void>;
  delete(key: string, tenantId?: string, opts?: MemoryDeleteOptions): Promise<void>;
}

export interface MemoryGetOptions {
  scopeType?: string;
  scopeId?: string;
  includeDeleted?: boolean;
}

export interface MemorySetOptions {
  type?: string;
  source?: string;
  scopeType?: string;
  scopeId?: string;
  idempotencyKey?: string;
  confidence?: number;
  expiresAt?: Date | string | null;
  sourceRunId?: string;
}

export interface MemoryDeleteOptions {
  scopeType?: string;
  scopeId?: string;
  hard?: boolean;
  idempotencyKey?: string;
  sourceRunId?: string;
  actorId?: string;
}

// ─── In-memory implementation (tests / standalone) ───────────────────────────

export class InMemoryAdapter implements MemoryAdapter {
  private store = new Map<string, { value: unknown; type?: string; source?: string; updatedAt: string }>();

  private buildKey(tenantId: string, scopeType: string, scopeId: string, key: string): string {
    return `${tenantId}:${scopeType}:${scopeId}:${key}`;
  }

  async get(key: string, tenantId?: string, opts?: MemoryGetOptions): Promise<unknown> {
    const tid = tenantId ?? 'default';
    const scopeType = opts?.scopeType ?? 'TENANT';
    const scopeId = opts?.scopeId ?? tid;
    const entry = this.store.get(this.buildKey(tid, scopeType, scopeId, key));
    if (!entry) return null;
    return entry;
  }

  async set(key: string, value: unknown, tenantId?: string, opts?: MemorySetOptions): Promise<void> {
    const tid = tenantId ?? 'default';
    const scopeType = opts?.scopeType ?? 'TENANT';
    const scopeId = opts?.scopeId ?? tid;
    this.store.set(this.buildKey(tid, scopeType, scopeId, key), {
      value,
      type: opts?.type ?? 'KNOWLEDGE',
      source: opts?.source ?? 'agent',
      updatedAt: new Date().toISOString(),
    });
  }

  async delete(key: string, tenantId?: string, opts?: MemoryDeleteOptions): Promise<void> {
    const tid = tenantId ?? 'default';
    const scopeType = opts?.scopeType ?? 'TENANT';
    const scopeId = opts?.scopeId ?? tid;
    this.store.delete(this.buildKey(tid, scopeType, scopeId, key));
  }
}

// ─── DB-backed implementation (production) ───────────────────────────────────

export class DbMemoryAdapter implements MemoryAdapter {
  private prisma: PrismaLike;

  constructor(prisma: PrismaLike) {
    this.prisma = prisma;
  }

  async get(key: string, tenantId?: string, opts?: MemoryGetOptions): Promise<unknown> {
    const tid = tenantId ?? 'default';
    const scopeType = opts?.scopeType ?? 'TENANT';
    const scopeId = opts?.scopeId ?? tid;
    const entry = await this.prisma.memoryItem.findFirst({
      where: {
        tenantId: tid,
        scopeType,
        scopeId,
        key,
        ...(opts?.includeDeleted ? {} : { deletedAt: null }),
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });
    if (!entry) return null;
    try {
      await this.prisma.memoryItem.update({
        where: { id: entry.id },
        data: { lastAccessedAt: new Date() },
      });
    } catch {
      // non-critical
    }
    return {
      value: entry.value,
      type: entry.memoryType,
      source: entry.source,
      confidence: entry.confidence ?? undefined,
      updatedAt: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : String(entry.updatedAt),
    };
  }

  async set(key: string, value: unknown, tenantId?: string, opts?: MemorySetOptions): Promise<void> {
    const tid = tenantId ?? 'default';
    const memoryType = opts?.type ?? 'KNOWLEDGE';
    const source = opts?.source ?? 'agent';
    const scopeType = opts?.scopeType ?? 'TENANT';
    const scopeId = opts?.scopeId ?? tid;
    const confidence = opts?.confidence ?? null;
    const expiresAt = opts?.expiresAt ? new Date(opts.expiresAt) : null;
    const contentHash = hashValue(value);
    const idempotencyKey = opts?.idempotencyKey ?? hashString(`${tid}:${scopeType}:${scopeId}:${key}:${contentHash}:${opts?.sourceRunId ?? ''}`);

    const upserted = await this.prisma.$queryRawUnsafe<PrismaMemoryItemRow[]>(
      `INSERT INTO "memory_items" ("id", "tenantId", "scopeType", "scopeId", "key", "value", "memoryType", "confidence", "source", "sourceRunId", "idempotencyKey", "contentHash", "version", "expiresAt", "createdAt", "updatedAt", "deletedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, 1, $12, NOW(), NOW(), NULL)
       ON CONFLICT ("tenantId", "scopeType", "scopeId", "key") DO UPDATE SET
         "value" = EXCLUDED."value",
         "memoryType" = EXCLUDED."memoryType",
         "confidence" = EXCLUDED."confidence",
         "source" = EXCLUDED."source",
         "sourceRunId" = EXCLUDED."sourceRunId",
         "idempotencyKey" = EXCLUDED."idempotencyKey",
         "contentHash" = EXCLUDED."contentHash",
         "expiresAt" = EXCLUDED."expiresAt",
         "deletedAt" = NULL,
         "updatedAt" = NOW(),
         "version" = "memory_items"."version" + 1
       WHERE "memory_items"."contentHash" IS DISTINCT FROM EXCLUDED."contentHash"
          OR "memory_items"."deletedAt" IS NOT NULL
       RETURNING "id", "contentHash";`,
      tid,
      scopeType,
      scopeId,
      key,
      JSON.stringify(value ?? null),
      memoryType,
      confidence,
      source,
      opts?.sourceRunId ?? null,
      idempotencyKey,
      contentHash,
      expiresAt,
    );

    const memoryId = upserted[0]?.id ?? (await this.prisma.memoryItem.findFirst({
      where: { tenantId: tid, scopeType, scopeId, key },
      select: { id: true },
    }))?.id;

    if (memoryId) {
      try {
        await this.prisma.memoryEvent.create({
          data: {
            tenantId: tid,
            memoryItemId: memoryId,
            scopeType,
            scopeId,
            key,
            action: upserted.length > 0 ? 'UPSERT' : 'NOOP',
            actorId: null,
            runId: opts?.sourceRunId ?? null,
            idempotencyKey,
            diff: upserted.length > 0 ? ({ contentHash } as object) : null,
          },
        });
      } catch {
        // ignore idempotency conflicts
      }
    }
  }

  async delete(key: string, tenantId?: string, opts?: MemoryDeleteOptions): Promise<void> {
    const tid = tenantId ?? 'default';
    const scopeType = opts?.scopeType ?? 'TENANT';
    const scopeId = opts?.scopeId ?? tid;
    const idempotencyKey = opts?.idempotencyKey ?? hashString(`${tid}:${scopeType}:${scopeId}:${key}:delete:${opts?.sourceRunId ?? ''}`);
    const existing = await this.prisma.memoryItem.findFirst({
      where: { tenantId: tid, scopeType, scopeId, key },
      select: { id: true },
    });
    if (!existing) return;

    if (opts?.hard) {
      await this.prisma.memoryItem.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.memoryItem.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
    }

    try {
      await this.prisma.memoryEvent.create({
        data: {
          tenantId: tid,
          memoryItemId: existing.id,
          scopeType,
          scopeId,
          key,
          action: opts?.hard ? 'DELETE_HARD' : 'DELETE',
          actorId: opts?.actorId ?? null,
          runId: opts?.sourceRunId ?? null,
          idempotencyKey,
        },
      });
    } catch {
      // ignore idempotency conflicts
    }
  }
}

// ─── Prisma-like interface (avoids hard dependency on @prisma/client types) ──

interface PrismaLike {
  memoryItem: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<PrismaMemoryItemRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaMemoryItemRow>;
    delete(args: { where: { id: string } }): Promise<PrismaMemoryItemRow>;
  };
  memoryEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  $queryRawUnsafe<T = unknown[]>(query: string, ...args: unknown[]): Promise<T>;
}

interface PrismaMemoryItemRow {
  id: string;
  tenantId: string;
  scopeType: string;
  scopeId: string;
  key: string;
  value: unknown;
  source: string;
  memoryType: string;
  confidence?: number | null;
  contentHash?: string | null;
  updatedAt: Date | string;
}

// ─── Adapter factory ─────────────────────────────────────────────────────────

let _cachedAdapter: MemoryAdapter | null = null;

/**
 * Get the best available memory adapter.
 * If @jak-swarm/db is importable and provides a Prisma client, use DB adapter.
 * Otherwise, fall back to in-memory.
 */
export function getMemoryAdapter(): MemoryAdapter {
  if (_cachedAdapter) return _cachedAdapter;

  const allowFallback = process.env['MEMORY_ALLOW_IN_MEMORY_FALLBACK'] === 'true'
    || process.env['NODE_ENV'] !== 'production';

  try {
    // Dynamic require to avoid hard dependency on @jak-swarm/db
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbModule = require('@jak-swarm/db');
    const prisma = dbModule.prisma;
    if (prisma?.memoryItem) {
      if (!allowFallback) {
        _cachedAdapter = new DbMemoryAdapter(prisma as PrismaLike);
        return _cachedAdapter;
      }

      // Wrap DbMemoryAdapter with auto-fallback to InMemoryAdapter on connection failure
      const dbAdapter = new DbMemoryAdapter(prisma as PrismaLike);
      const inMemoryFallback = new InMemoryAdapter();
      let useDb = true;

      const fallbackAdapter: MemoryAdapter = {
        async get(key: string, tenantId?: string, opts?: MemoryGetOptions): Promise<unknown> {
          if (!useDb) return inMemoryFallback.get(key, tenantId, opts);
          try {
            return await dbAdapter.get(key, tenantId, opts);
          } catch {
            useDb = false;
            return inMemoryFallback.get(key, tenantId, opts);
          }
        },
        async set(key: string, value: unknown, tenantId?: string, opts?: MemorySetOptions): Promise<void> {
          if (!useDb) return inMemoryFallback.set(key, value, tenantId, opts);
          try {
            return await dbAdapter.set(key, value, tenantId, opts);
          } catch {
            useDb = false;
            return inMemoryFallback.set(key, value, tenantId, opts);
          }
        },
        async delete(key: string, tenantId?: string, opts?: MemoryDeleteOptions): Promise<void> {
          if (!useDb) return inMemoryFallback.delete(key, tenantId, opts);
          try {
            return await dbAdapter.delete(key, tenantId, opts);
          } catch {
            useDb = false;
            return inMemoryFallback.delete(key, tenantId, opts);
          }
        },
      };

      _cachedAdapter = fallbackAdapter;
      return _cachedAdapter;
    }
  } catch {
    // @jak-swarm/db not available — use in-memory
  }

  if (!allowFallback) {
    throw new Error('[memory] Persistent storage required but database is unavailable.');
  }
  _cachedAdapter = new InMemoryAdapter();
  return _cachedAdapter;
}

/**
 * Reset the cached adapter (useful for tests).
 */
export function resetMemoryAdapter(): void {
  _cachedAdapter = null;
}

function hashValue(value: unknown): string {
  return hashString(stableStringify(value));
}

function hashString(input: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(input).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}
