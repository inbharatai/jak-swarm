/**
 * replanner-node.ts — HyperAgent Phase 4 graph node.
 *
 * Reached from the diagnosis node when a failure is R3-repairable and the
 * autonomy policy permits replanning. Consumes the pending diagnosis, builds a
 * `ReplanContext`, calls the pure `replan()` (Innovation #3: deterministic
 * proposer + symbolic validator), and — only when the result is valid, not
 * escalated, and autonomy allows — applies the revised plan: bumps the plan
 * version, appends to plan history, rewinds `currentTaskIndex` to the failed
 * task, and routes back to the guardrail to re-execute only invalidated work.
 *
 * Escalated / approval-required / invalid results do NOT mutate the plan; they
 * surface a human-escalation error and route to END. Completed external actions
 * are never re-scheduled (the symbolic validator rejects any such attempt).
 */

import { ToolRegistry } from '@jak-swarm/tools';
import { evaluateForConfig } from '@jak-swarm/security';
import {
  AgentRole,
  AutonomyCapability,
  AutonomyLevel,
  DEFAULT_HYPERAGENT_BUDGET,
  FailureClass,
  HyperAgentMode,
  TaskStatus,
  WorkflowStatus,
} from '@jak-swarm/shared';
import type { ReplanContext, WorkflowPlan } from '@jak-swarm/shared';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';
import { replan } from '../../hyperagent/replanner.js';
import type { LlmProposeFn } from '../../hyperagent/replanner.js';
import { getReadyTasks } from '../task-scheduler.js';

/** Tools whose execution has an irreversible external side effect. */
const EXTERNAL_TOOLS: ReadonlySet<string> = new Set([
  'send_email',
  'send_webhook',
  'browser_submit',
  'submit_payment',
  'deploy_to_vercel',
  'github_push_files',
]);

export interface ReplannerNodeDeps {
  /** Tool-name snapshot for validation. Defaults to the live ToolRegistry. */
  knownToolNames?: ReadonlySet<string>;
  /** Optional LLM proposer (deterministic proposer runs when absent). */
  llmPropose?: LlmProposeFn;
  /** Optional tenant tool-equivalence map for REPLACE_TOOL. */
  toolAlternates?: Readonly<Record<string, string[]>>;
}

/** All worker AgentRole values, used as the default permitted-agent set. */
const WORKER_ROLES: AgentRole[] = Object.values(AgentRole).filter((r) =>
  String(r).startsWith('WORKER_'),
) as AgentRole[];

export async function replannerNode(
  state: SwarmState,
  deps: ReplannerNodeDeps = {},
): Promise<Partial<SwarmState>> {
  const task = getCurrentTask(state);
  if (!task) {
    return { status: state.status };
  }

  const pending = state.pendingDiagnoses?.[task.id];
  if (!pending || !state.plan) {
    // Nothing to replan on — escalate.
    return {
      status: WorkflowStatus.FAILED,
      error: `Replanner invoked for task '${task.id}' with no pending diagnosis.`,
    };
  }

  const budget = state.repairBudget ?? DEFAULT_HYPERAGENT_BUDGET;
  const repairState = state.taskRepairState?.[task.id] ?? freshRepair(task.id);
  const knownToolNames =
    deps.knownToolNames ?? new Set(ToolRegistry.getInstance().list().map((m) => m.name));
  const permittedTools =
    state.allowedToolNames && state.allowedToolNames.length > 0
      ? state.allowedToolNames
      : Array.from(knownToolNames);

  // Tasks that completed with an external side effect — must never re-run.
  const completedExternalTaskIds = state.plan.tasks
    .filter((t) => t.status === TaskStatus.COMPLETED && (t.toolsRequired ?? []).some((tool) => EXTERNAL_TOOLS.has(tool)))
    .map((t) => t.id);

  // Successful outputs to preserve (completed, non-failed).
  const successfulTaskOutputs: Record<string, unknown> = {};
  for (const t of state.plan.tasks) {
    if (t.id !== task.id && t.status === TaskStatus.COMPLETED) {
      successfulTaskOutputs[t.id] = state.taskResults[t.id];
    }
  }

  const autonomy = evaluateForConfig(
    {
      hyperAgentEnabled: state.hyperAgentEnabled ?? false,
      hyperAgentMode: state.hyperAgentMode ?? HyperAgentMode.OFF,
      autonomyLevel: state.autonomyLevel ?? AutonomyLevel.L0,
    },
    AutonomyCapability.REPLAN_WITHIN_APPROVED,
  );

  const ctx: ReplanContext = {
    originalGoal: state.goal,
    originalPlan: state.plan,
    currentPlanVersion: state.activePlanVersion ?? 0,
    successfulTaskOutputs,
    completedExternalTaskIds,
    failedTask: task,
    verifierIssues: state.verificationResults[task.id]?.issues ?? [],
    diagnosis: pending.diagnosis,
    counterfactual: pending.counterfactual,
    permittedAgents: WORKER_ROLES,
    permittedTools,
    toolAlternates: deps.toolAlternates,
    budgetRemaining: {
      planRepairs: Math.max(0, budget.maxPlanRepairs - repairState.planRepairAttempts),
      executionRetries: Math.max(0, budget.maxExecutionRetries - repairState.executionAttempts),
      outputRepairs: Math.max(0, budget.maxOutputRepairs - repairState.outputRepairAttempts),
      costUsd: Math.max(0, budget.maxTotalCostUsd - (state.accumulatedCostUsd ?? 0)),
      durationMs: Math.max(0, budget.maxDurationMs),
    },
    autonomy,
    // Phase 3: prior PROMOTED learnings recalled for this run's task types are
    // fed to the replanner so a known-good config / known-bad failure class
    // informs the proposed repair. Empty until the planner recall step
    // populates state.relevantLearnings (HyperAgent ON + recall db injected).
    relevantLearnings: state.relevantLearnings ?? [],
    maxTasks: 50,
  };

  const result = await replan(ctx, {
    knownToolNames,
    llmPropose: deps.llmPropose,
  });

  // Escalated / invalid / approval-required → do NOT mutate the plan.
  if (result.escalated || !result.valid || !result.updatedPlan) {
    return {
      repairProposals: [result],
      taskRepairState: {
        [task.id]: { ...repairState, planRepairAttempts: repairState.planRepairAttempts + 1, lastFailureClass: pending.diagnosis.failureClass, lastDiagnosisId: pending.diagnosis.id },
      },
      status: WorkflowStatus.FAILED,
      error: result.escalated
        ? `HyperAgent escalated task '${task.id}': ${result.reason}`
        : `Replan rejected for task '${task.id}': ${result.validationIssues.map((i) => i.code).join(', ') || result.reason}`,
    };
  }

  // Approval required (autonomy not allowed) → pause for a human.
  if (result.requiresApproval) {
    return {
      repairProposals: [result],
      status: WorkflowStatus.AWAITING_APPROVAL,
      error: `Replan for task '${task.id}' requires human approval (${autonomy.reason}).`,
    };
  }

  // Apply the revised plan. Version it, then set the execution cursor via
  // dependency-aware scheduling (getReadyTasks) — NOT the failed task's old
  // index. The failed task may now depend on a freshly-added prerequisite
  // (ADD_PREREQUISITE), its original deps may have been invalidated and need to
  // re-run first, or a SPLIT_TASK may have replaced the failed task with new
  // sub-tasks (so its old id no longer exists in the plan). Rewinding to the
  // old index in any of those cases points the cursor at a completed task or a
  // task whose deps are not yet met, re-running unaffected downstream work.
  const newVersion = (state.activePlanVersion ?? 0) + 1;
  const updatedPlan: WorkflowPlan = {
    ...result.updatedPlan,
    // Mark invalidated/changed tasks back to PENDING so they re-execute;
    // retain completed external actions as COMPLETED.
    tasks: result.updatedPlan.tasks.map((t) => {
      if (result.retainedCompletedTaskIds.includes(t.id)) {
        return { ...t, status: TaskStatus.COMPLETED };
      }
      if (result.changedTaskIds.includes(t.id) || result.invalidatedTaskIds.includes(t.id)) {
        return { ...t, status: TaskStatus.PENDING, error: undefined, result: undefined };
      }
      return t;
    }),
  };

  // Dependency-aware cursor (Phase 4). A task is READY when all its deps are
  // COMPLETED and it is neither completed/failed/skipped nor on a cycle. Prefer
  // a ready task among the invalidated/changed set (the work this replan
  // actually touched); fall back to the first ready task overall (e.g. an
  // unmet dependency of the failed task that itself became ready). If nothing is
  // runnable, the revised plan is recorded but the run goes to the validator —
  // never silently rewind to a task that cannot legally execute next.
  const completedIds = new Set(
    updatedPlan.tasks.filter((t) => t.status === TaskStatus.COMPLETED).map((t) => t.id),
  );
  const failedIds = new Set(
    updatedPlan.tasks.filter((t) => t.status === TaskStatus.FAILED).map((t) => t.id),
  );
  const readyTasks = getReadyTasks(updatedPlan, completedIds, failedIds);
  const reExecuted = new Set([...result.changedTaskIds, ...result.invalidatedTaskIds]);
  const cursorTask = readyTasks.find((t) => reExecuted.has(t.id)) ?? readyTasks[0];
  const replayIndex = cursorTask
    ? updatedPlan.tasks.findIndex((t) => t.id === cursorTask.id)
    : -1;
  const nothingReady = readyTasks.length === 0;

  return {
    plan: updatedPlan,
    activePlanVersion: newVersion,
    planHistory: [
      {
        version: newVersion,
        planId: updatedPlan.id,
        plan: updatedPlan,
        parentVersionId: state.activePlanVersion ?? 0,
        changeReason: result.reason,
        triggeringDiagnosisId: pending.diagnosis.id,
        repairType: result.repairType,
        changedTaskIds: result.changedTaskIds,
        invalidatedTaskIds: result.invalidatedTaskIds,
        createdAt: new Date().toISOString(),
      },
    ],
    repairProposals: [result],
    taskRepairState: {
      [task.id]: {
        ...repairState,
        planRepairAttempts: repairState.planRepairAttempts + 1,
        lastFailureClass: pending.diagnosis.failureClass,
        lastDiagnosisId: pending.diagnosis.id,
      },
    },
    failureDiagnoses: { [task.id]: pending.diagnosis },
    // Reset the same-input (R1/R2) retry budget for every task being re-executed
    // under the revised plan. The prior counters were spent on the OLD plan
    // version — and the failed task's counter is at MAX_TASK_RETRIES after the
    // R1/R2 exhaustion that routed it to diagnosis in the first place. Without
    // this reset, a replanned task starts at the ceiling and gets ZERO same-input
    // retries, so even a minor output defect jumps straight back into another
    // expensive plan-repair iteration instead of the cheap R1/R2 retry a fresh
    // task would get. mergeReducer merges per-key, so only the re-executed tasks
    // are reset; other tasks' counters are preserved.
    taskRetryCount: Object.fromEntries(
      [...result.changedTaskIds, ...result.invalidatedTaskIds].map((id) => [id, 0]),
    ) as Record<string, number>,
    // Rewind to the first READY task (deps satisfied) — prefer one this replan
    // touched — so the guardrail re-executes only invalidated work and never a
    // task whose inputs are still pending. When nothing is runnable, leave the
    // cursor and route to the validator (terminal).
    currentTaskIndex: nothingReady ? (state.currentTaskIndex ?? 0) : replayIndex,
    hyperAgentIteration: (state.hyperAgentIteration ?? 0) + 1,
    status: nothingReady ? WorkflowStatus.FAILED : WorkflowStatus.EXECUTING,
    error: nothingReady
      ? `Replan for task '${task.id}' left no ready tasks to execute (all remaining tasks are blocked or failed).`
      : undefined,
  };
}

function freshRepair(taskId: string) {
  return {
    taskId,
    executionAttempts: 0,
    outputRepairAttempts: 0,
    planRepairAttempts: 0,
    capabilityRepairAttempts: 0,
    exhausted: false,
  };
}

// Re-export so callers can construct the worker-role set without re-deriving.
export { WORKER_ROLES, FailureClass };