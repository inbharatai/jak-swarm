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
 * server restarts.
 *
 * IMPORTANT: No local cache. Every read goes to the database. This is
 * intentional for multi-instance correctness — local caches cause stale
 * state when multiple instances read/write the same workflow.
 *
 * Performance impact is minimal: single-row PK lookup on an indexed table
 * is ~1-2ms on a local DB and ~5-10ms on a managed DB. This is negligible
 * compared to the LLM calls (100ms-30s) that dominate workflow execution.
 */
export class DbWorkflowStateStore implements WorkflowStateStore {
  private readonly db: PrismaClient;

  constructor(db: PrismaClient) {
    this.db = db;
  }

  async get(workflowId: string): Promise<SwarmState | undefined> {
    try {
      const workflow = await this.db.workflow.findUnique({
        where: { id: workflowId },
        select: { stateJson: true },
      });

      if (!workflow?.stateJson) return undefined;
      return workflow.stateJson as unknown as SwarmState;
    } catch {
      return undefined;
    }
  }

  async set(workflowId: string, state: SwarmState): Promise<void> {
    try {
      await this.db.workflow.update({
        where: { id: workflowId },
        data: { stateJson: state as unknown as Prisma.InputJsonValue },
      });
    } catch (err) {
      // Log the error — state persistence failure is serious, not "non-critical"
      console.error(`[state-store] Failed to persist state for workflow ${workflowId}:`, err instanceof Error ? err.message : String(err));
      throw err; // Propagate — caller must handle persistence failures
    }
  }

  async delete(workflowId: string): Promise<void> {
    // Don't delete from DB — the workflow record itself should persist.
    // This is a no-op since we no longer have a cache.
    void workflowId;
  }

  async has(workflowId: string): Promise<boolean> {
    const state = await this.get(workflowId);
    return state !== undefined;
  }
}
