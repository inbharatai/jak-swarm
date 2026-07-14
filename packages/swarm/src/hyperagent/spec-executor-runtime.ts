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
 *   - Artifact + failure-class harvesting is WIRED (truth-doc D1/D2): the pure
          harvestRunEvidence helper extracts per-task failure classes from
          state.failureDiagnoses and best-effort artifact ids workers emit into
          taskResults (artifactId | artifactIds | artifacts). When the graph
          emits none, artifacts is [] and failureClassByTask is undefined --
          unchanged behaviour. Full worker artifact emission is the remaining
          wiring. Metrics are still limited to accumulatedCostUsd (the one
          metric SwarmState tracks); richer metrics are a separate wiring
 */
import { WorkflowStatus } from '@jak-swarm/shared';
import type { FailureClass } from '@jak-swarm/shared';
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
 * harvestRunEvidence — pure harvest of a run terminal-state evidence.
 *
 * Closes truth-doc open edges D1 (artifact harvesting) and D2 (failure-class
 * propagation) for the live runPlanViaLangGraph seam:
 *   - failureClassByTask is derived from state.failureDiagnoses (the same map
 *     the learning node builds), so NO_FAILURE_CLASS acceptance criteria bind
 *     to real classified failures instead of a vacuous "no offenders".
 *   - artifacts is a best-effort harvest of artifact ids workers emit into
 *     taskResults under the conventional keys artifactId | artifactIds |
 *     artifacts. When no worker emitted any, returns [] (unchanged behaviour).
 *     Full worker artifact emission is the remaining wiring, tracked separately.
 *
 * Pure: no I/O, no LLM, no Date. Deterministic from state alone so the
 * harvested run is auditable/replayable (same contract as evaluateOutcome).
 */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function buildFailureClassByTask(state: SwarmState): Record<string, FailureClass> | undefined {
  const diagnoses = state.failureDiagnoses;
  if (!diagnoses || Object.keys(diagnoses).length === 0) return undefined;
  const map: Record<string, FailureClass> = {};
  for (const [taskId, diag] of Object.entries(diagnoses)) {
    if (diag?.failureClass) map[taskId] = diag.failureClass;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

function harvestArtifacts(taskResults: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const result of Object.values(taskResults)) {
    if (!result || typeof result !== 'object') continue;
    const r = result as Record<string, unknown>;
    const single = r['artifactId'];
    if (typeof single === 'string' && single.length > 0) ids.add(single);
    const arr = r['artifactIds'];
    if (isStringArray(arr)) for (const x of arr) if (x.length > 0) ids.add(x);
    const nested = r['artifacts'];
    if (isStringArray(nested)) for (const x of nested) if (x.length > 0) ids.add(x);
  }
  return [...ids];
}

export function harvestRunEvidence(state: SwarmState): {
  artifacts: string[];
  failureClassByTask?: Record<string, FailureClass>;
} {
  const failureClassByTask = buildFailureClassByTask(state);
  return {
    artifacts: harvestArtifacts(state.taskResults),
    ...(failureClassByTask ? { failureClassByTask } : {}),
  };
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
        ...harvestRunEvidence(state),
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
    // D1/D2 wired: harvest artifact ids + per-task failure classes from the
    // terminal state via the pure harvestRunEvidence helper. When the graph
    // emits none, this is [] / undefined (unchanged behaviour).
    ...harvestRunEvidence(finalState),
    // The one metric SwarmState tracks; richer metrics are a separate wiring.
    metrics: { accumulatedCostUsd: finalState.accumulatedCostUsd ?? 0 },
    accumulatedCostUsd: finalState.accumulatedCostUsd,
    startedAt: now,
    completedAt: new Date(),
  };
}