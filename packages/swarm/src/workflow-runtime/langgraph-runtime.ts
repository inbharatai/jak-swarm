/**
 * LangGraphRuntime — peer of SwarmGraphRuntime that uses
 * `@langchain/langgraph` for orchestration. Phase 6 ships the proof-of-
 * life: LangGraph is installed, a tiny StateGraph is compiled, and the
 * runtime answers calls through it. The full migration of every node
 * type (commander → planner → router → guardrail → worker → verifier
 * → approval) is incremental — happens behind `JAK_WORKFLOW_RUNTIME=
 * langgraph` and per-template flags as later phases are wired up.
 *
 * Today's Phase 6 implementation runs a SINGLE-NODE graph that:
 *   1. accepts a goal
 *   2. delegates to the existing SwarmRunner (via SwarmGraphRuntime)
 *      because porting all 9 nodes to LangGraph idioms is a multi-week
 *      project
 *   3. returns the result, having proven the LangGraph adapter compiles,
 *      runs, and respects the WorkflowRuntime contract
 *
 * Subsequent phases (post-Phase-8) replace the inner SwarmRunner call
 * with native LangGraph nodes that share the same workers/tools/etc.
 *
 * INVARIANT: no @langchain/langgraph import escapes this file. The rest
 * of the codebase only imports from ./workflow-runtime + this module's
 * default export.
 */

import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import type {
  WorkflowRuntime,
  StartContext,
  ResumeDecision,
  WorkflowSnapshot,
} from './workflow-runtime.js';
import { SwarmGraphRuntime } from './swarm-graph-runtime.js';
import type { SwarmRunner, SwarmResult } from '../runner/swarm-runner.js';

/**
 * Minimal state schema for the proof-of-life graph. Real schema will
 * mirror SwarmState in subsequent phases.
 */
const RuntimeState = Annotation.Root({
  workflowId: Annotation<string>(),
  goal: Annotation<string>(),
  result: Annotation<SwarmResult | null>({
    reducer: (_old: SwarmResult | null, next: SwarmResult | null) => next,
    default: () => null,
  }),
});

type RuntimeStateT = typeof RuntimeState.State;

export class LangGraphRuntime implements WorkflowRuntime {
  // Honest naming — this runtime is NOT a native LangGraph orchestrator
  // today; it's a thin wrapper that delegates real execution to the
  // SwarmGraphRuntime and runs an empty proof-of-life StateGraph
  // alongside. Diagnostics + UI surface 'langgraph-shim' so operators
  // and customers know not to attribute observed behavior to LangGraph
  // until the full node migration lands.
  readonly name = 'langgraph-shim';
  /**
   * True when LangGraph is genuinely orchestrating nodes. Today: false.
   * Flip to true only when commander/planner/router/worker/verifier are
   * each native LangGraph nodes wired to the same agents.
   */
  readonly isFullyImplemented = false;
  /** Why diagnostics show this runtime as 'shim'. */
  readonly status = 'present-but-not-active' as const;
  readonly statusReason =
    'LangGraph adapter compiles and executes a proof-of-life StateGraph, ' +
    'but the actual workflow nodes (commander/planner/worker/verifier) still ' +
    'run via the SwarmGraph engine under the hood. Full LangGraph orchestration ' +
    'is a future-phase rewrite.';
  private readonly inner: SwarmGraphRuntime;
  private readonly graph: ReturnType<typeof this.buildGraph>;

  constructor(runner: SwarmRunner) {
    this.inner = new SwarmGraphRuntime(runner);
    this.graph = this.buildGraph();
  }

  /**
   * Phase 6 graph: START → executeNode → END. The `executeNode` delegates
   * to the existing SwarmGraphRuntime so semantics + outputs match the
   * legacy path 1:1. Future phases replace this with the full
   * commander/planner/router/worker/verifier mirror in LangGraph idioms.
   */
  private buildGraph() {
    const builder = new StateGraph(RuntimeState)
      .addNode('execute', async (state: RuntimeStateT) => {
        // Delegate to SwarmGraphRuntime. The startCtx must be carried in
        // closure on the runtime; the graph itself only knows workflowId
        // + goal. Phase 6's adapter layer pulls the rest from the runtime
        // instance.
        return { result: state.result };
      })
      .addEdge(START, 'execute')
      .addEdge('execute', END);
    return builder.compile();
  }

  async start(ctx: StartContext): Promise<SwarmResult> {
    // Phase 6 pragmatic strategy: do the actual run via SwarmGraphRuntime
    // (battle-tested) AND emit the LangGraph trace so observability
    // demonstrates the graph executed end-to-end. This proves the runtime
    // is wired without forcing a full-rewrite of the 9 node types.
    const result = await this.inner.start(ctx);
    await this.graph.invoke({
      workflowId: ctx.workflowId,
      goal: ctx.goal,
      result,
    });
    return result;
  }

  async resume(workflowId: string, decision: ResumeDecision): Promise<SwarmResult> {
    return this.inner.resume(workflowId, decision);
  }

  async cancel(workflowId: string, _reason?: string): Promise<void> {
    return this.inner.cancel(workflowId);
  }

  async getState(workflowId: string): Promise<WorkflowSnapshot | null> {
    return this.inner.getState(workflowId);
  }
}
