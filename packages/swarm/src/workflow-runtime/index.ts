/**
 * Workflow runtime — JAK-owned interface for orchestration engines.
 *
 * Phase 6 of the OpenAI-first migration. Two adapters ship here:
 *   - SwarmGraphRuntime: wraps the existing custom SwarmRunner
 *   - LangGraphRuntime: uses @langchain/langgraph (proof-of-life today;
 *     fuller node migration in subsequent phases)
 *
 * The factory honors JAK_WORKFLOW_RUNTIME = 'swarmgraph' | 'langgraph'.
 * Default is swarmgraph so existing traffic is unchanged.
 *
 * INVARIANT: no `@langchain/langgraph` import escapes this directory.
 * Callers (apps/api/src/services/swarm-execution.service.ts,
 * apps/api/src/routes/approvals.routes.ts) only import the
 * `WorkflowRuntime` interface.
 */

import type { SwarmRunner } from '../runner/swarm-runner.js';
import type { WorkflowRuntime } from './workflow-runtime.js';
import { SwarmGraphRuntime } from './swarm-graph-runtime.js';

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
 * Lazy-imports LangGraphRuntime so the cost (and the @langchain/
 * langgraph runtime dep) only loads when the flag selects it.
 */
export function getWorkflowRuntime(runner: SwarmRunner): WorkflowRuntime {
  const flag = (process.env['JAK_WORKFLOW_RUNTIME'] ?? 'swarmgraph').trim().toLowerCase();
  if (flag === 'langgraph') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LangGraphRuntime } = require('./langgraph-runtime.js') as typeof import('./langgraph-runtime.js');
    return new LangGraphRuntime(runner);
  }
  return new SwarmGraphRuntime(runner);
}
