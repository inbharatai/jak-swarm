/**
 * Activity-emitter side-channel registry.
 *
 * SwarmState is persisted to Postgres on every transition, which means
 * `state` cannot carry Function values (they serialize as `[object Function]`
 * and Prisma rejects them). The agent-run cockpit needs real-time
 * `tool_called` / `tool_completed` / `cost_updated` events from inside
 * `BaseAgent`, which happens several layers deep from the workflow
 * runtime — passing the emitter via state or through every function
 * signature would mean touching every node file.
 *
 * Mirrors the existing pattern at `supervisor/breaker-registry.ts`: a
 * per-workflow-id map, registered by the workflow runtime just before
 * `SwarmGraph.execute()` runs, consumed by worker nodes when they build
 * the `AgentContext`. The registry is process-local and ephemeral — it
 * is not persisted and does not cross instance boundaries. Cross-
 * instance visibility is already handled by the Redis pub/sub SSE relay
 * in `apps/api/src/routes/workflows.routes.ts`.
 *
 * Stage 2 of qa/client-agent-visibility-audit.md.
 */

import type { AgentActivityEmitter } from '@jak-swarm/agents';

const activityEmitters = new Map<string, AgentActivityEmitter>();

/**
 * Register an activity emitter for a given workflow. Called by the
 * workflow runtime just before `SwarmGraph.execute()`. Safe to call
 * multiple times — the latest wins.
 */
export function registerActivityEmitter(
  workflowId: string,
  emitter: AgentActivityEmitter,
): void {
  activityEmitters.set(workflowId, emitter);
}

/**
 * Look up the activity emitter for a workflow. Returns undefined when
 * no emitter is registered (e.g. unit tests, legacy callers) — worker
 * nodes treat that as "no-op, skip emission".
 */
export function getActivityEmitter(workflowId: string): AgentActivityEmitter | undefined {
  return activityEmitters.get(workflowId);
}

/**
 * Remove the activity emitter once the workflow terminates. Called by
 * the workflow runtime in `finally` so we don't leak memory across
 * long-running processes.
 */
export function clearActivityEmitter(workflowId: string): void {
  activityEmitters.delete(workflowId);
}
