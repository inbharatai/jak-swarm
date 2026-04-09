import type { SwarmState } from './swarm-state.js';

/**
 * WorkflowStateStore — pluggable storage for in-flight workflow state.
 *
 * The default InMemoryStateStore keeps state in a Map (good for dev/test).
 * Production deployments should inject a DB-backed implementation via
 * SwarmRunner constructor so state survives server restarts.
 */
export interface WorkflowStateStore {
  get(workflowId: string): Promise<SwarmState | undefined>;
  set(workflowId: string, state: SwarmState): Promise<void>;
  delete(workflowId: string): Promise<void>;
  has(workflowId: string): Promise<boolean>;
}

/**
 * In-memory implementation with configurable TTL.
 * State auto-expires after `ttlMs` (default 5 minutes).
 */
export class InMemoryStateStore implements WorkflowStateStore {
  private readonly store = new Map<string, SwarmState>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  async get(workflowId: string): Promise<SwarmState | undefined> {
    return this.store.get(workflowId);
  }

  async set(workflowId: string, state: SwarmState): Promise<void> {
    this.store.set(workflowId, state);
    // Reset TTL on every write
    const existing = this.timers.get(workflowId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      workflowId,
      setTimeout(() => {
        this.store.delete(workflowId);
        this.timers.delete(workflowId);
      }, this.ttlMs),
    );
  }

  async delete(workflowId: string): Promise<void> {
    this.store.delete(workflowId);
    const timer = this.timers.get(workflowId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(workflowId);
    }
  }

  async has(workflowId: string): Promise<boolean> {
    return this.store.has(workflowId);
  }

  /** Cleanup all timers (call on shutdown). */
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.store.clear();
  }
}
