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
 *   - Approval-gated spec tasks (`requiresApproval: true`) interrupt the graph
 *     via LangGraph's native `interrupt()`. This seam now CATCHES the
 *     `GraphInterrupt` (previously it would throw — audit §A0 #1), reads the
 *     pending approvals off the checkpoint, and returns a `FinishedRun` with
 *     `awaitingApproval: true` + the `approvalRequestId`. The orchestrator
 *     (`executeApprovedSpec`) then returns AWAITING_APPROVAL instead of a
 *     verdict, and the service persists the execution row as
 *     `awaiting_approval` for a later `resumeSpecExecution` (Command(resume)
 *     against the SAME Postgres-checkpointed thread). The live interrupt +
 *     resume E2E is env-blocked (no provider keys here); the signal
 *     propagation is unit-tested with a stub `runPlan`.
 *   - Artifact harvesting remains an OPEN EDGE: the real graph does not yet
 *     extract artifact ids from `taskResults`, so `artifacts` is `[]` and an
 *     ARTIFACT_PRESENT criterion will be UNMET unless the run explicitly
 *     produces one. Metrics are limited to `accumulatedCostUsd` (the one
 *     metric SwarmState tracks). Wiring richer artifact/metric harvesting is a
 *     separate, migration/feature-gated step — not claimed here.
 */
import { WorkflowStatus } from '@jak-swarm/shared';
import { GraphInterrupt, isInterrupted } from '@langchain/langgraph';
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
 * a `FinishedRun`. Env-blocked at every agent call (see file header). When the
 * run interrupts at an approval gate, returns a `FinishedRun` with
 * `awaitingApproval: true` (no terminal plan) instead of throwing.
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
  let finalState: SwarmState;
  try {
    finalState = (await graph.invoke(
      initialState as Parameters<typeof graph.invoke>[0],
      config,
    )) as unknown as SwarmState;
  } catch (err) {
    // GraphInterrupt → the run paused at an approval-gated task. Read the
    // pending approvals off the checkpoint and surface an AWAITING_APPROVAL
    // FinishedRun (do NOT throw — the closed loop returns a tri-state signal,
    // never an exception, for an expected approval pause). Mirrors the
    // LangGraphRuntime.runOrPause handling (langgraph-runtime.ts:211-244).
    if (err instanceof GraphInterrupt || isInterrupted(err)) {
      const snapshot = await graph.getState(config);
      const state = ((snapshot?.values ?? {}) as unknown as SwarmState);
      const pending = state.pendingApprovals ?? [];
      const approvalRequestId = pending.length > 0 ? pending[0]?.id : undefined;
      return {
        plan: state.plan ?? plan,
        verificationResults: state.verificationResults ?? {},
        failedTaskIds: state.failedTaskIds,
        completedTaskIds: state.completedTaskIds,
        blocked: state.blocked,
        artifacts: [],
        metrics: { accumulatedCostUsd: state.accumulatedCostUsd ?? 0 },
        accumulatedCostUsd: state.accumulatedCostUsd,
        awaitingApproval: true,
        ...(approvalRequestId ? { approvalRequestId } : {}),
        startedAt: now,
        completedAt: new Date(),
      };
    }
    // Non-interrupt error: surface as a FAILED run (no verdict, the orchestrator
    // turns a failed/empty run into UNMET/UNVERIFIABLE). Do not swallow.
    throw err;
  }

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