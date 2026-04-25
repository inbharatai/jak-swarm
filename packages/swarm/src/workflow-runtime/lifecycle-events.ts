/**
 * Workflow lifecycle events — JAK-owned canonical event vocabulary that
 * any WorkflowRuntime must emit through `emitLifecycle`. The audit log,
 * cockpit, and downstream Audit & Compliance product all read from this
 * single vocabulary instead of the runtime-specific event names.
 *
 * Two layers of events exist intentionally:
 *
 *   1. AGENT-level events (`agent:activity` from the swarm graph + base
 *      agents) — fine-grained: tool_called, tool_completed, cost_updated,
 *      worker_started, worker_completed, plan_created. These are the SSE
 *      events the cockpit already reads.
 *
 *   2. WORKFLOW-level lifecycle events (this file) — coarse-grained
 *      terminal-state-machine transitions: created, planned, started,
 *      step_started, step_completed, step_failed, approval_required,
 *      approval_granted, approval_rejected, resumed, cancelled, completed,
 *      failed. The Audit & Compliance product replays this stream to
 *      reconstruct exactly what happened in a workflow.
 *
 * The two layers MUST stay in sync at observable boundaries (the audit
 * trail must include both an `approval_required` lifecycle event AND
 * the corresponding `paused` SSE event). The lifecycle stream is the
 * source of truth; SSE events are the live mirror.
 */

import type { WorkflowStatus } from '@jak-swarm/shared';

/**
 * Exhaustive list of lifecycle events. Each carries a discriminated `type`
 * + the workflowId + a timestamp. Event-specific fields are added per type.
 *
 * Note: `step_*` events use `stepId` to identify the WorkflowTask within
 * the run. For the swarm runtime today, stepId === task.id from the plan.
 */
export type WorkflowLifecycleEvent =
  | { type: 'created'; workflowId: string; tenantId: string; userId: string; goal: string; timestamp: string }
  | { type: 'planned'; workflowId: string; planId: string; taskCount: number; timestamp: string }
  | { type: 'started'; workflowId: string; runtime: string; timestamp: string }
  | { type: 'step_started'; workflowId: string; stepId: string; agentRole: string; timestamp: string }
  | { type: 'step_completed'; workflowId: string; stepId: string; agentRole: string; durationMs: number; timestamp: string }
  | { type: 'step_failed'; workflowId: string; stepId: string; agentRole: string; error: string; durationMs: number; timestamp: string }
  | { type: 'approval_required'; workflowId: string; approvalId: string; stepId?: string; riskLevel?: string; timestamp: string }
  | { type: 'approval_granted'; workflowId: string; approvalId: string; reviewedBy: string; timestamp: string }
  | { type: 'approval_rejected'; workflowId: string; approvalId: string; reviewedBy: string; reason?: string; timestamp: string }
  | { type: 'resumed'; workflowId: string; reason: 'approval' | 'manual'; timestamp: string }
  | { type: 'cancelled'; workflowId: string; reason?: string; cancelledBy?: string; timestamp: string }
  | { type: 'completed'; workflowId: string; finalStatus: WorkflowStatus; durationMs: number; timestamp: string }
  | { type: 'failed'; workflowId: string; error: string; durationMs?: number; timestamp: string };

/** Sink the runtime calls on every lifecycle transition. Must be infallible. */
export type WorkflowLifecycleEmitter = (event: WorkflowLifecycleEvent) => void;

/**
 * Default no-op emitter for runtimes constructed without an explicit sink.
 * Keeps the API total — every runtime has an emitter, even if it discards.
 */
export const NOOP_LIFECYCLE_EMITTER: WorkflowLifecycleEmitter = () => {};

/**
 * Helper to safely call an emitter without ever propagating its errors
 * back into the runtime path. Lifecycle telemetry must NEVER block
 * the workflow itself.
 */
export function safeEmitLifecycle(
  emitter: WorkflowLifecycleEmitter | undefined,
  event: WorkflowLifecycleEvent,
): void {
  if (!emitter) return;
  try {
    emitter(event);
  } catch {
    // Swallow — the alternative is breaking the workflow because the
    // audit logger crashed.
  }
}
