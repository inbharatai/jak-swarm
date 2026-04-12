import { EventEmitter } from 'node:events';

/**
 * Typed events emitted through the SupervisorBus.
 * Every event carries `tenantId` for multi-tenant isolation
 * and `timestamp` for ordering/debugging.
 */
export interface SupervisorEvent {
  tenantId: string;
  workflowId?: string;
  timestamp: string; // ISO-8601
}

export interface WorkflowRequestedEvent extends SupervisorEvent {
  type: 'workflow:requested';
  userId: string;
  goal: string;
  industry?: string;
}

export interface WorkflowStartedEvent extends SupervisorEvent {
  type: 'workflow:started';
  workflowId: string;
}

export interface NodeEnteredEvent extends SupervisorEvent {
  type: 'node:entered';
  workflowId: string;
  node: string;
  taskId?: string;
}

export interface NodeCompletedEvent extends SupervisorEvent {
  type: 'node:completed';
  workflowId: string;
  node: string;
  taskId?: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface WorkflowCompletedEvent extends SupervisorEvent {
  type: 'workflow:completed';
  workflowId: string;
  status: string;
  durationMs: number;
  taskCount: number;
  failedCount: number;
}

export interface ApprovalRequiredEvent extends SupervisorEvent {
  type: 'approval:required';
  workflowId: string;
  taskId: string;
  agentRole: string;
  riskLevel: string;
}

export interface BudgetExceededEvent extends SupervisorEvent {
  type: 'budget:exceeded';
  workflowId: string;
  accumulatedCostUsd: number;
  limitUsd: number;
}

export interface CircuitOpenEvent extends SupervisorEvent {
  type: 'circuit:open';
  service: string;
  failureCount: number;
  lastError: string;
}

export type SupervisorEventMap = {
  'workflow:requested': WorkflowRequestedEvent;
  'workflow:started': WorkflowStartedEvent;
  'node:entered': NodeEnteredEvent;
  'node:completed': NodeCompletedEvent;
  'workflow:completed': WorkflowCompletedEvent;
  'approval:required': ApprovalRequiredEvent;
  'budget:exceeded': BudgetExceededEvent;
  'circuit:open': CircuitOpenEvent;
};

export type SupervisorEventType = keyof SupervisorEventMap;

/**
 * SupervisorBus — the central nervous system of the hybrid architecture.
 *
 * Platform-level supervisor uses this bus to:
 * - Track all active workflows across tenants
 * - Enforce global resource limits (max concurrent, budget caps)
 * - Coordinate cross-workflow dependencies
 * - Feed real-time telemetry to the frontend (via SSE/WebSocket)
 * - Trigger circuit breakers when agents/tools fail repeatedly
 *
 * Each internal swarm emits events here. The supervisor listens and acts.
 */
export class SupervisorBus extends EventEmitter {
  private static instance: SupervisorBus = new SupervisorBus();

  private readonly activeWorkflows = new Map<string, {
    tenantId: string;
    startedAt: Date;
    nodeHistory: Array<{ node: string; timestamp: Date }>;
  }>();

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  static getInstance(): SupervisorBus {
    return SupervisorBus.instance;
  }

  /**
   * Emit a typed supervisor event. Automatically sets timestamp if missing.
   */
  publish<T extends SupervisorEventType>(type: T, event: Omit<SupervisorEventMap[T], 'timestamp'> & { timestamp?: string }): void {
    const fullEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    } as SupervisorEventMap[T];

    // Track workflow lifecycle
    if (type === 'workflow:started') {
      const e = fullEvent as WorkflowStartedEvent;
      this.activeWorkflows.set(e.workflowId, {
        tenantId: e.tenantId,
        startedAt: new Date(e.timestamp),
        nodeHistory: [],
      });
    } else if (type === 'node:entered') {
      const e = fullEvent as NodeEnteredEvent;
      const wf = this.activeWorkflows.get(e.workflowId);
      if (wf) wf.nodeHistory.push({ node: e.node, timestamp: new Date(e.timestamp) });
    } else if (type === 'workflow:completed') {
      const e = fullEvent as WorkflowCompletedEvent;
      this.activeWorkflows.delete(e.workflowId);
    }

    this.emit(type, fullEvent);
  }

  /**
   * Subscribe to a specific event type with type safety.
   */
  subscribe<T extends SupervisorEventType>(
    type: T,
    handler: (event: SupervisorEventMap[T]) => void,
  ): () => void {
    this.on(type, handler);
    return () => this.off(type, handler);
  }

  /** Count of currently active (in-flight) workflows. */
  getActiveWorkflowCount(): number {
    return this.activeWorkflows.size;
  }

  /** Active workflow IDs for a given tenant. */
  getActiveWorkflowsForTenant(tenantId: string): string[] {
    return [...this.activeWorkflows.entries()]
      .filter(([, info]) => info.tenantId === tenantId)
      .map(([id]) => id);
  }

  /** Total active workflows across all tenants. */
  getActiveWorkflows(): Map<string, { tenantId: string; startedAt: Date }> {
    return new Map(
      [...this.activeWorkflows.entries()].map(([id, info]) => [id, { tenantId: info.tenantId, startedAt: info.startedAt }]),
    );
  }

  /**
   * Purge stale workflows that have been active for longer than maxAgeMs.
   * Guards against memory leaks from workflows that crash without publishing workflow:completed.
   */
  purgeStaleWorkflows(maxAgeMs = 30 * 60 * 1000 /* 30 min */): number {
    const now = Date.now();
    let purged = 0;
    for (const [id, info] of this.activeWorkflows) {
      if (now - info.startedAt.getTime() > maxAgeMs) {
        this.activeWorkflows.delete(id);
        purged++;
      }
    }
    if (purged > 0) {
      console.warn(`[supervisor] Purged ${purged} stale workflows (older than ${maxAgeMs / 1000}s)`);
    }
    return purged;
  }

  /** Reset (for testing). */
  reset(): void {
    this.removeAllListeners();
    this.activeWorkflows.clear();
  }
}

export const supervisorBus = SupervisorBus.getInstance();
