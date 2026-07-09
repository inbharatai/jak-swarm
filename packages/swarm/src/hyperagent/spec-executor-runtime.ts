/**
 * spec-executor-runtime.ts — HyperAgent Phase 6 production run seam.
 *
 * The PRODUCTION `runPlan` for `executeApprovedSpec`: drives the REAL spec-
 * execution graph (guardrail → worker → verifier → validator, built via
 * `buildSpecExecutionGraph`) against the materialised `WorkflowPlan` and
 * harvests a `FinishedRun` from the terminal state.
 *
 * HONEST SCOPE — wired-into-runtime, NOT production-proven here:
 *   - Every node in the spec-execution graph calls an LLM agent (GuardrailAgent,
 *     the worker agent, VerifierAgent, the validator agent). Invoking this
 *     function is env-blocked without provider keys — the same bar as every
 *     live-graph HyperAgent seam. The closed-loop LOGIC that consumes this
 *     function's output is proven by the integration test with a STUB runPlan.
 *   - Artifact harvesting is an OPEN EDGE: the real graph does not yet extract
 *     artifact ids from `taskResults`, so `artifacts` is `[]` and an
 *     ARTIFACT_PRESENT criterion will be UNMET unless the run explicitly
 *     produces one. Metrics are limited to `accumulatedCostUsd` (the one
 *     metric SwarmState tracks). Wiring richer artifact/metric harvesting is a
 *     separate, migration/feature-gated step — not claimed here.
 *   - Approval-gated spec tasks (`requiresApproval: true`) interrupt the graph
 *     for human review; the closed loop would then return AWAITING_APPROVAL
 *     rather than a verdict. That path is NOT handled here — the default spec
 *     execution assumes non-approval tasks. (Open edge.)
 */
import { WorkflowStatus } from '@jak-swarm/shared';
import type { SwarmState } from '../state/swarm-state.js';
import { createInitialSwarmState } from '../state/swarm-state.js';
import {
  buildSpecExecutionGraph,
  makeRunnableConfig,
  type CheckpointPrismaClient,
} from '../workflow-runtime/index.js';
import type { RunPlanInput, FinishedRun } from './spec-executor.js';

/** Deps the production run seam needs (the Postgres checkpointer + cancel/pause
 *  flags, same shape as `BuildLangGraphParams` minus the HyperAgent half). */
export interface RunPlanViaLangGraphDeps {
  db: CheckpointPrismaClient;
  shouldStop?: (workflowId: string) => boolean;
  shouldPause?: (workflowId: string) => boolean;
}

/**
 * Run a materialised spec plan through the REAL spec-execution graph and harvest
 * a `FinishedRun`. Env-blocked at every agent call (see file header).
 */
export async function runPlanViaLangGraph(
  input: RunPlanInput,
  deps: RunPlanViaLangGraphDeps,
): Promise<FinishedRun> {
  const { plan, tenantId, userId, workflowId, now } = input;

  const graph = buildSpecExecutionGraph({
    db: deps.db,
    shouldStop: deps.shouldStop,
    shouldPause: deps.shouldPause,
  });

  // Seed the state with the materialised plan + EXECUTING so the graph starts
  // at the guardrail (START → guardrail) and runs the spec's tasks — NOT a
  // commander/planner-rederived plan (which would break the task-id binding).
  const base = createInitialSwarmState({
    goal: plan.goal,
    tenantId,
    userId,
    workflowId,
    industry: plan.industry,
  });
  const initialState: SwarmState = {
    ...base,
    plan,
    currentTaskIndex: 0,
    status: WorkflowStatus.EXECUTING,
  };

  const config = makeRunnableConfig(workflowId, tenantId, plan.tasks.length);
  const finalState = (await graph.invoke(
    initialState as Parameters<typeof graph.invoke>[0],
    config,
  )) as unknown as SwarmState;

  return {
    plan: finalState.plan ?? plan,
    verificationResults: finalState.verificationResults ?? {},
    failedTaskIds: finalState.failedTaskIds,
    completedTaskIds: finalState.completedTaskIds,
    blocked: finalState.blocked,
    // Open edge: the real graph does not harvest artifact ids from taskResults.
    artifacts: [],
    // The one metric SwarmState tracks; richer metrics are a separate wiring.
    metrics: { accumulatedCostUsd: finalState.accumulatedCostUsd ?? 0 },
    accumulatedCostUsd: finalState.accumulatedCostUsd,
    startedAt: now,
    completedAt: new Date(),
  };
}