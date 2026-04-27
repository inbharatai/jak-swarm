/**
 * Workflow runtime — JAK-owned interface for orchestration engines.
 *
 * Sprint 2.5 / A.3 made `LangGraphRuntime` the real native-LangGraph
 * orchestrator backed by the Postgres checkpointer. The factory still
 * honors `JAK_WORKFLOW_RUNTIME` so operators can fall back to
 * `'swarmgraph'` during the transition window if a regression appears,
 * but the default is now `'langgraph'`.
 *
 * The `db` parameter is required when LangGraph is selected because
 * the Postgres checkpointer needs Prisma-shaped access to the
 * `workflow_checkpoints` table.
 *
 * INVARIANT: no `@langchain/langgraph` import escapes this directory.
 */

import type { SwarmRunner } from '../runner/swarm-runner.js';
import type { WorkflowRuntime } from './workflow-runtime.js';
import { SwarmGraphRuntime } from './swarm-graph-runtime.js';
import type { CheckpointPrismaClient } from './postgres-checkpointer.js';

export {
  WorkflowPausedError,
} from './workflow-runtime.js';
export type {
  WorkflowRuntime,
  StartContext,
  ResumeDecision,
  WorkflowSnapshot,
} from './workflow-runtime.js';
export { SwarmGraphRuntime } from './swarm-graph-runtime.js';
export { LangGraphRuntime } from './langgraph-runtime.js';
export {
  PostgresCheckpointSaver,
  type CheckpointPrismaClient,
} from './postgres-checkpointer.js';
export {
  buildLangGraph,
  makeRunnableConfig,
  SwarmStateAnnotation,
  type SwarmAnnotationT,
  type CompiledLangGraph,
  type BuildLangGraphParams,
} from './langgraph-graph-builder.js';
export {
  NOOP_LIFECYCLE_EMITTER,
  safeEmitLifecycle,
} from './lifecycle-events.js';
export type {
  WorkflowLifecycleEvent,
  WorkflowLifecycleEmitter,
} from './lifecycle-events.js';

/**
 * Factory — picks the runtime based on JAK_WORKFLOW_RUNTIME env var.
 *
 * Sprint 2.5 cutover:
 *   - default = 'langgraph' (real native LangGraph, Postgres checkpoints)
 *   - 'swarmgraph' is the explicit one-release fallback during transition
 *
 * Lazy-imports LangGraphRuntime to keep the @langchain/langgraph runtime
 * dep off the hot path when the operator pinned 'swarmgraph'.
 */
export function getWorkflowRuntime(
  runner: SwarmRunner,
  db?: CheckpointPrismaClient,
): WorkflowRuntime {
  const flag = (process.env['JAK_WORKFLOW_RUNTIME'] ?? 'langgraph').trim().toLowerCase();
  if (flag === 'swarmgraph') {
    return new SwarmGraphRuntime(runner);
  }
  if (!db) {
    // LangGraph requires the Prisma client. Fail loudly rather than
    // silently dropping back to SwarmGraph — that would mask deployment
    // misconfiguration.
    throw new Error(
      '[getWorkflowRuntime] LangGraph runtime requires a CheckpointPrismaClient. ' +
        'Pass `db` to getWorkflowRuntime, or set JAK_WORKFLOW_RUNTIME=swarmgraph for the legacy path.',
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LangGraphRuntime } = require('./langgraph-runtime.js') as typeof import('./langgraph-runtime.js');
  return new LangGraphRuntime(runner, db);
}
