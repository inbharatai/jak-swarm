import type { PrismaClient } from '@jak-swarm/db';
import type { Prisma } from '@jak-swarm/db';
import type { SwarmState } from '@jak-swarm/swarm';

/**
 * WorkflowStateStore interface — matches the one in @jak-swarm/swarm.
 * Duplicated here to avoid build-order dependency.
 */
export interface WorkflowStateStore {
  get(workflowId: string): Promise<SwarmState | undefined>;
  set(workflowId: string, state: SwarmState): Promise<void>;
  delete(workflowId: string): Promise<void>;
  has(workflowId: string): Promise<boolean>;
}

/**
 * DbWorkflowStateStore — production state store backed by PostgreSQL.
 *
 * Stores SwarmState in the `Workflow.stateJson` column so state survives
 * server restarts. Uses an in-memory LRU cache for hot-path reads during
 * active execution (avoids DB round-trip on every node transition).
 *
 * The cache is write-through: every `set()` writes to both cache and DB.
 * On `get()`, cache is checked first, then DB if miss.
 */
export class DbWorkflowStateStore implements WorkflowStateStore {
  private readonly db: PrismaClient;
  private readonly cache = new Map<string, SwarmState>();
  private readonly maxCacheSize: number;

  constructor(db: PrismaClient, maxCacheSize = 200) {
    this.db = db;
    this.maxCacheSize = maxCacheSize;
  }

  async get(workflowId: string): Promise<SwarmState | undefined> {
    // Check in-memory cache first
    const cached = this.cache.get(workflowId);
    if (cached) return cached;

    // Fall back to DB
    try {
      const workflow = await this.db.workflow.findUnique({
        where: { id: workflowId },
        select: { stateJson: true },
      });

      if (!workflow?.stateJson) return undefined;

      const state = workflow.stateJson as unknown as SwarmState;
      this.cacheSet(workflowId, state);
      return state;
    } catch {
      return undefined;
    }
  }

  async set(workflowId: string, state: SwarmState): Promise<void> {
    this.cacheSet(workflowId, state);

    // Write-through to DB (non-blocking for performance, but we await for correctness)
    try {
      await this.db.workflow.update({
        where: { id: workflowId },
        data: { stateJson: state as unknown as Prisma.InputJsonValue },
      });
    } catch {
      // DB write failed — state is still in cache for this server instance.
      // On restart the state will be lost, but recoverStaleWorkflows handles that.
    }
  }

  async delete(workflowId: string): Promise<void> {
    this.cache.delete(workflowId);
    // Don't delete from DB — the workflow record itself should persist.
    // Just clear the in-memory cache entry.
  }

  async has(workflowId: string): Promise<boolean> {
    if (this.cache.has(workflowId)) return true;
    const state = await this.get(workflowId);
    return state !== undefined;
  }

  /** Evict a specific workflow from the cache (e.g., after completion). */
  evict(workflowId: string): void {
    this.cache.delete(workflowId);
  }

  /** Clear the entire cache (for testing or shutdown). */
  clearCache(): void {
    this.cache.clear();
  }

  private cacheSet(workflowId: string, state: SwarmState): void {
    // Simple LRU: if cache is full, evict the oldest entry
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(workflowId, state);
  }
}
