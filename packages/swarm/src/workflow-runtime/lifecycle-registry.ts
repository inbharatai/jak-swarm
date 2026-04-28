/**
 * Lifecycle-emitter side-channel registry.
 *
 * Mirrors `supervisor/activity-registry.ts` but for the workflow
 * lifecycle event stream (`workflow_started`, `step_completed`,
 * `repair_needed`, `approval_required`, …) rather than the cockpit
 * activity stream (`tool_called`, `cost_updated`, …).
 *
 * The worker-node calls `RepairService.evaluate()` on failure, which
 * needs a `WorkflowLifecycleEmitter` to publish `repair_*` events to.
 * SwarmState cannot carry the emitter (Function values fail Prisma
 * checkpoint serialization), and threading it through every node
 * signature would touch every file. The runtime registers the
 * per-workflow emitter here just before graph execution; the worker
 * node looks it up by workflowId on failure.
 *
 * The registry is process-local and ephemeral; cross-instance
 * visibility is already handled by the Redis pub/sub SSE relay in
 * `apps/api/src/routes/workflows.routes.ts`.
 *
 * Added: P1-3 (RepairService wiring) of the launch-readiness audit.
 */

import type { WorkflowLifecycleEmitter } from './lifecycle-events.js';

const lifecycleEmitters = new Map<string, WorkflowLifecycleEmitter>();

/**
 * Register a lifecycle emitter for a given workflow. Called by the
 * workflow runtime just before graph execution. Safe to call multiple
 * times — the latest wins.
 */
export function registerLifecycleEmitter(
  workflowId: string,
  emitter: WorkflowLifecycleEmitter,
): void {
  lifecycleEmitters.set(workflowId, emitter);
}

/**
 * Look up the lifecycle emitter for a workflow. Returns undefined when
 * no emitter is registered (legacy callers, unit tests, in-memory
 * runs) — `RepairService.evaluate()` treats undefined as "no-op,
 * skip emission".
 */
export function getLifecycleEmitter(workflowId: string): WorkflowLifecycleEmitter | undefined {
  return lifecycleEmitters.get(workflowId);
}

/**
 * Remove the lifecycle emitter once the workflow terminates. Called by
 * the workflow runtime in `finally` so the registry doesn't leak
 * memory across long-running processes.
 */
export function clearLifecycleEmitter(workflowId: string): void {
  lifecycleEmitters.delete(workflowId);
}
