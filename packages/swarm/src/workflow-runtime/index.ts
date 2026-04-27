/**
 * Workflow runtime — JAK-owned interface for the LangGraph orchestrator.
 *
 * Sprint 2.5 / A.6 deleted SwarmGraph + SwarmGraphRuntime. The factory
 * always returns LangGraphRuntime; the JAK_WORKFLOW_RUNTIME env flag
 * is no longer honored. Setting it logs a warning but is otherwise a
 * no-op.
 *
 * INVARIANT: no `@langchain/langgraph` import escapes this directory.
 */

import type { SwarmRunner } from '../runner/swarm-runner.js';
import type { WorkflowRuntime } from './workflow-runtime.js';
import type { CheckpointPrismaClient } from './postgres-checkpointer.js';
import { LangGraphRuntime } from './langgraph-runtime.js';

export {
  WorkflowPausedError,
} from './workflow-runtime.js';
export type {
  WorkflowRuntime,
  StartContext,
  ResumeDecision,
  WorkflowSnapshot,
} from './workflow-runtime.js';
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

let warnedAboutLegacyEnv = false;

/**
 * Factory — always returns LangGraphRuntime.
 *
 * The legacy JAK_WORKFLOW_RUNTIME env var is no longer honored.
 * Setting it to anything other than 'langgraph' logs a one-time
 * warning so operators discover the change in their server logs
 * rather than silently.
 */
export function getWorkflowRuntime(
  runner: SwarmRunner,
  db: CheckpointPrismaClient,
): WorkflowRuntime {
  const envFlag = process.env['JAK_WORKFLOW_RUNTIME']?.trim().toLowerCase();
  if (envFlag && envFlag !== 'langgraph' && !warnedAboutLegacyEnv) {
    warnedAboutLegacyEnv = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[getWorkflowRuntime] JAK_WORKFLOW_RUNTIME=${envFlag} is no longer honored. ` +
        `SwarmGraph was deleted in Sprint 2.5 / A.6. Always running LangGraph runtime. ` +
        `Remove this env var from your deployment.`,
    );
  }
  if (!db) {
    throw new Error(
      '[getWorkflowRuntime] CheckpointPrismaClient is required (LangGraph PostgresCheckpointSaver dep).',
    );
  }
  return new LangGraphRuntime(runner, db);
}
