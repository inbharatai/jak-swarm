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
  get(key: string, tenantId?: string): Promise<unknown>;
  set(key: string, value: unknown, tenantId?: string, opts?: MemorySetOptions): Promise<void>;
  delete(key: string, tenantId?: string): Promise<void>;
}

export interface MemorySetOptions {
  type?: string;
  source?: string;
}

// ─── In-memory implementation (tests / standalone) ───────────────────────────

export class InMemoryAdapter implements MemoryAdapter {
  private store = new Map<string, { value: unknown; type?: string; source?: string; updatedAt: string }>();

  async get(key: string, _tenantId?: string): Promise<unknown> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return entry;
  }

  async set(key: string, value: unknown, _tenantId?: string, opts?: MemorySetOptions): Promise<void> {
    this.store.set(key, {
      value,
      type: opts?.type ?? 'KNOWLEDGE',
      source: opts?.source ?? 'agent',
      updatedAt: new Date().toISOString(),
    });
  }

  async delete(key: string, _tenantId?: string): Promise<void> {
    this.store.delete(key);
  }
}

// ─── DB-backed implementation (production) ───────────────────────────────────

export class DbMemoryAdapter implements MemoryAdapter {
  private prisma: PrismaLike;

  constructor(prisma: PrismaLike) {
    this.prisma = prisma;
  }

  async get(key: string, tenantId?: string): Promise<unknown> {
    const tid = tenantId ?? 'default';
    const entry = await this.prisma.tenantMemory.findFirst({
      where: { tenantId: tid, key },
    });
    if (!entry) return null;
    return {
      value: entry.value,
      type: entry.memoryType,
      source: entry.source,
      updatedAt: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : String(entry.updatedAt),
    };
  }

  async set(key: string, value: unknown, tenantId?: string, opts?: MemorySetOptions): Promise<void> {
    const tid = tenantId ?? 'default';
    const memoryType = opts?.type ?? 'KNOWLEDGE';
    const source = opts?.source ?? 'agent';

    const existing = await this.prisma.tenantMemory.findFirst({
      where: { tenantId: tid, key },
    });

    if (existing) {
      await this.prisma.tenantMemory.update({
        where: { id: existing.id },
        data: {
          value: value as object,
          memoryType,
          source,
        },
      });
    } else {
      await this.prisma.tenantMemory.create({
        data: {
          tenantId: tid,
          key,
          value: value as object,
          memoryType,
          source,
        },
      });
    }
  }

  async delete(key: string, tenantId?: string): Promise<void> {
    const tid = tenantId ?? 'default';
    const existing = await this.prisma.tenantMemory.findFirst({
      where: { tenantId: tid, key },
    });
    if (existing) {
      await this.prisma.tenantMemory.delete({ where: { id: existing.id } });
    }
  }
}

// ─── Prisma-like interface (avoids hard dependency on @prisma/client types) ──

interface PrismaLike {
  tenantMemory: {
    findFirst(args: { where: Record<string, unknown> }): Promise<PrismaMemoryRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<PrismaMemoryRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaMemoryRow>;
    delete(args: { where: { id: string } }): Promise<PrismaMemoryRow>;
  };
}

interface PrismaMemoryRow {
  id: string;
  tenantId: string;
  key: string;
  value: unknown;
  source: string;
  memoryType: string;
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

  try {
    // Dynamic require to avoid hard dependency on @jak-swarm/db
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbModule = require('@jak-swarm/db');
    const prisma = dbModule.prisma;
    if (prisma?.tenantMemory) {
      _cachedAdapter = new DbMemoryAdapter(prisma as PrismaLike);
      return _cachedAdapter;
    }
  } catch {
    // @jak-swarm/db not available — use in-memory
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
