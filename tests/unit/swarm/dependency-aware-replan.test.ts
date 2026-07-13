/**
 * dependency-aware-replan.test.ts — Phase 4 (P0 execution correctness).
 *
 * Pins that after a plan repair the execution cursor is set via DEPENDENCY-
 * AWARE scheduling (`getReadyTasks`), not the failed task's old index. The
 * prior index-based replay (`failedIndex`/`replayIndex`) pointed the cursor at
 * the failed task's position regardless of whether its inputs were ready,
 * which broke in three real repair shapes:
 *
 *   - ADD_PREREQUISITE: a new grounding task is inserted before the failed
 *     task and the failed task is made to depend on it. The failed task is now
 *     NOT ready (its new dep is unmet); the cursor must point at the new
 *     prerequisite (the unmet dep, now the only ready task), not the failed
 *     task's new position one slot down.
 *   - A failed task with downstream dependents: after REPLACE_AGENT the failed
 *     task is the first READY task; its downstream dependents stay PENDING
 *     until it completes. The cursor must point at the ready task, and the
 *     downstream tasks must NOT be the cursor.
 *   - Nothing runnable: when the only remaining work depends on a FAILED task,
 *     `getReadyTasks` returns empty; the revised plan is recorded but the run
 *     routes to the validator (status FAILED), never silently rewinding to a
 *     task that cannot legally execute next.
 *
 * The non-regression guard (single failed task, REPLACE_AGENT → cursor stays at
 * the failed task's index) is covered by scenario 10 of
 * hyperagent-plan-repair-routing.test.ts; this file covers the cases the old
 * index-based replay got wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentRole,
  AutonomyLevel,
  FailureClass,
  HyperAgentMode,
  RepairLevel,
  RiskLevel,
  TaskStatus,
  WorkflowStatus,
} from '../../../packages/shared/src/index.js';
import type {
  WorkflowPlan,
  WorkflowTask,
  FailureDiagnosis,
  DiagnosisRecord,
  CounterfactualReplayHint,
} from '../../../packages/shared/src/index.js';
import type { VerificationResult } from '../../../packages/agents/src/roles/verifier.agent.js';
import { createInitialSwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import type { SwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import { afterReplanner } from '../../../packages/swarm/src/graph/edges.js';
import { replannerNode } from '../../../packages/swarm/src/graph/nodes/replanner-node.js';
import { getReadyTasks } from '../../../packages/swarm/src/graph/task-scheduler.js';
import { securityFieldsForClass } from '../../../packages/swarm/src/recovery/failure-classifier.js';

function task(over: Partial<WorkflowTask> & { id: string }): WorkflowTask {
  return {
    name: `task-${over.id}`,
    description: 'd',
    agentRole: AgentRole.WORKER_RESEARCH,
    toolsRequired: ['web_search'],
    riskLevel: RiskLevel.LOW,
    requiresApproval: false,
    status: TaskStatus.PENDING,
    dependsOn: [],
    retryable: true,
    maxRetries: 2,
    ...over,
  } as WorkflowTask;
}

function plan(tasks: WorkflowTask[]): WorkflowPlan {
  return {
    id: 'plan-1',
    name: 'p',
    goal: 'g',
    industry: 'general',
    tasks,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function diagnosis(cls: FailureClass, taskId = 'fail'): FailureDiagnosis {
  return {
    id: `diag_wf-1_${taskId}_0`,
    tenantId: 't-1',
    workflowId: 'wf-1',
    taskId,
    failureClass: cls,
    rootCause: 'rc',
    evidence: {},
    confidence: 0.9,
    recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR,
    recommendedChanges: {},
    createdAt: '2026-01-01T00:00:00Z',
    ...securityFieldsForClass(cls),
  };
}

function hint(taskId = 'fail'): CounterfactualReplayHint {
  return { taskId, agentRole: 'WORKER_RESEARCH', toolName: 'web_search', inputHash: 'h', hypothesisSet: ['agent-only', 'tool-only', 'model-only'] };
}

function pendingRecord(cls: FailureClass, taskId = 'fail'): DiagnosisRecord {
  return { diagnosis: diagnosis(cls, taskId), hint: hint(taskId) };
}

const vFail = (): VerificationResult => ({ passed: false, issues: ['bad'], confidence: 0.4, needsRetry: false });

/**
 * Build a SwarmState with HyperAgent ON (ASSISTED + L3, the mutating path) and
 * a failed task at `failedId` carrying the given diagnosis class.
 */
function stateWith(
  tasks: WorkflowTask[],
  failedId: string,
  cls: FailureClass,
  over: Partial<SwarmState> = {},
): SwarmState {
  const p = plan(tasks);
  const base = createInitialSwarmState({
    goal: 'g',
    tenantId: 't-1',
    userId: 'u-1',
    workflowId: 'wf-1',
    hyperAgentEnabled: true,
    hyperAgentMode: HyperAgentMode.ASSISTED,
    autonomyLevel: AutonomyLevel.L3,
    allowedToolNames: ['web_search', 'alt_tool', 'send_email'],
  });
  const failedIndex = Math.max(0, tasks.findIndex((t) => t.id === failedId));
  return {
    ...base,
    plan: p,
    currentTaskIndex: failedIndex,
    verificationResults: { [failedId]: vFail() },
    taskResults: { [failedId]: { partial: true } },
    pendingDiagnoses: { [failedId]: pendingRecord(cls, failedId) },
    status: WorkflowStatus.VERIFYING,
    ...over,
  } as SwarmState;
}

const KNOWN_TOOLS = new Set(['web_search', 'alt_tool', 'send_email']);

// ─── ADD_PREREQUISITE: cursor points at the new prerequisite (the unmet dep) ──

describe('Phase 4 dependency-aware scheduling — ADD_PREREQUISITE routes the cursor to the unmet dependency', () => {
  it('after adding a prerequisite, the cursor points at the prerequisite (ready), NOT the failed task (whose deps are now unmet)', async () => {
    // Single failed task. MISSING_CONTEXT → the deterministic proposer inserts a
    // research prerequisite before it and makes the failed task depend on it.
    const failed = task({ id: 'fail', agentRole: AgentRole.WORKER_CODER, toolsRequired: ['web_search'] });
    const s = stateWith([failed], 'fail', FailureClass.MISSING_CONTEXT);

    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.status).toBe(WorkflowStatus.EXECUTING);

    const newPlan = out.plan as WorkflowPlan;
    // The prerequisite was inserted before the failed task.
    const prereqIdx = newPlan.tasks.findIndex((t) => t.id.startsWith('prereq_'));
    const failedIdx = newPlan.tasks.findIndex((t) => t.id === 'fail');
    expect(prereqIdx).toBe(0);
    expect(failedIdx).toBe(1);
    // The failed task now depends on the prerequisite.
    const prereqId = newPlan.tasks[prereqIdx].id;
    expect(newPlan.tasks[failedIdx].dependsOn).toContain(prereqId);

    // ─── The Phase 4 fix ───
    // The prerequisite is the only READY task (no deps); the failed task is NOT
    // ready (its new dep is unmet). The cursor must point at the prerequisite,
    // not at the failed task's new position (1) — which is where the old
    // index-based replay (`failedIndex = findIndex(id === 'fail')`) would have
    // pointed, scheduling a task whose inputs are still pending.
    expect(out.currentTaskIndex).toBe(prereqIdx);
    expect(out.currentTaskIndex).not.toBe(failedIdx);

    // Independently verify the readiness computation the node now consults.
    const completedIds = new Set(
      newPlan.tasks.filter((t) => t.status === TaskStatus.COMPLETED).map((t) => t.id),
    );
    const failedIds = new Set(
      newPlan.tasks.filter((t) => t.status === TaskStatus.FAILED).map((t) => t.id),
    );
    const ready = getReadyTasks(newPlan, completedIds, failedIds);
    expect(ready.map((t) => t.id)).toEqual([prereqId]);
    expect(ready.find((t) => t.id === 'fail')).toBeUndefined();

    // Routes back to the guardrail to execute the prerequisite first.
    expect(afterReplanner({ ...s, ...out } as SwarmState)).toBe('guardrail');
  });
});

// ─── Downstream dependents stay PENDING until their deps complete ──────────────

describe('Phase 4 dependency-aware scheduling — downstream dependents stay PENDING', () => {
  it('a failed task with a downstream dependent: cursor → the failed task (now ready); the dependent stays PENDING (its dep unmet)', async () => {
    // t1 fails (WRONG_AGENT → REPLACE_AGENT). t2 depends on t1. After replan:
    //   - t1 is changed → PENDING, no unmet deps → READY (the cursor).
    //   - t2 is invalidated (downstream of t1) → PENDING, but depends on t1
    //     which is NOT completed → NOT ready. It must not be the cursor.
    const t1 = task({ id: 't1', agentRole: AgentRole.WORKER_CODER, toolsRequired: ['web_search'] });
    const t2 = task({ id: 't2', dependsOn: ['t1'] });
    const s = stateWith([t1, t2], 't1', FailureClass.WRONG_AGENT);

    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.status).toBe(WorkflowStatus.EXECUTING);

    const newPlan = out.plan as WorkflowPlan;
    const t1Idx = newPlan.tasks.findIndex((t) => t.id === 't1');
    const t2Idx = newPlan.tasks.findIndex((t) => t.id === 't2');

    // The cursor points at t1 (the first READY task among the invalidated/changed
    // set), never at t2 (which is PENDING with an unmet dep).
    expect(out.currentTaskIndex).toBe(t1Idx);
    expect(out.currentTaskIndex).not.toBe(t2Idx);

    // t1 was reset to PENDING for re-execution; t2 is PENDING but NOT ready.
    expect(newPlan.tasks[t1Idx].status).toBe(TaskStatus.PENDING);
    expect(newPlan.tasks[t2Idx].status).toBe(TaskStatus.PENDING);

    const completedIds = new Set(
      newPlan.tasks.filter((t) => t.status === TaskStatus.COMPLETED).map((t) => t.id),
    );
    const failedIds = new Set(
      newPlan.tasks.filter((t) => t.status === TaskStatus.FAILED).map((t) => t.id),
    );
    const ready = getReadyTasks(newPlan, completedIds, failedIds);
    expect(ready.map((t) => t.id)).toEqual(['t1']);
    expect(ready.find((t) => t.id === 't2')).toBeUndefined();
  });

  it('a completed predecessor is not re-run; the cursor advances to the failed task whose dep is already met', async () => {
    // [t0 COMPLETED] → [t1 fails, dependsOn t0] → [t2 dependsOn t1].
    // WRONG_AGENT on t1: t0 is retained COMPLETED, t1 changed → PENDING (deps
    // met via t0 → READY), t2 invalidated → PENDING (dep t1 unmet → NOT ready).
    // Cursor → t1; t0 stays COMPLETED (never re-run); t2 stays PENDING.
    const t0 = task({ id: 't0', status: TaskStatus.COMPLETED });
    const t1 = task({ id: 't1', agentRole: AgentRole.WORKER_CODER, toolsRequired: ['web_search'], dependsOn: ['t0'] });
    const t2 = task({ id: 't2', dependsOn: ['t1'] });
    const s = stateWith([t0, t1, t2], 't1', FailureClass.WRONG_AGENT, {
      taskResults: { t0: 'done', t1: { partial: true } },
    });

    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.status).toBe(WorkflowStatus.EXECUTING);

    const newPlan = out.plan as WorkflowPlan;
    const t0Idx = newPlan.tasks.findIndex((t) => t.id === 't0');
    const t1Idx = newPlan.tasks.findIndex((t) => t.id === 't1');
    const t2Idx = newPlan.tasks.findIndex((t) => t.id === 't2');

    // The completed predecessor is retained (never re-run).
    expect(newPlan.tasks[t0Idx].status).toBe(TaskStatus.COMPLETED);
    expect(out.repairProposals?.[0].retainedCompletedTaskIds).toContain('t0');

    // The cursor points at t1 — its dep (t0) is met so it is the first ready
    // task — not at t2 (whose dep t1 is unmet) and not back at t0 (completed).
    expect(out.currentTaskIndex).toBe(t1Idx);
    expect(out.currentTaskIndex).not.toBe(t2Idx);
    expect(out.currentTaskIndex).not.toBe(t0Idx);

    const completedIds = new Set(
      newPlan.tasks.filter((t) => t.status === TaskStatus.COMPLETED).map((t) => t.id),
    );
    const failedIds = new Set(
      newPlan.tasks.filter((t) => t.status === TaskStatus.FAILED).map((t) => t.id),
    );
    const ready = getReadyTasks(newPlan, completedIds, failedIds);
    expect(ready.map((t) => t.id)).toEqual(['t1']);
  });
});

// ─── Nothing runnable → FAILED (routes to the validator) ───────────────────────

describe('Phase 4 dependency-aware scheduling — nothing runnable routes to the validator', () => {
  it('when the failed task depends on a FAILED task, getReadyTasks is empty → status FAILED (no silent rewind to an un-runnable task)', async () => {
    // t1 is FAILED. t2 (the current failed task) depends on t1. WRONG_AGENT on
    // t2 → REPLACE_AGENT: t2 is changed → PENDING, but its dep t1 is FAILED so
    // it is skipped (transitive skip from a failed dep). No task is ready. The
    // revised plan is recorded (versioned) but the run goes to the validator —
    // status FAILED, never EXECUTING with a cursor at a task that cannot run.
    const t1 = task({ id: 't1', status: TaskStatus.FAILED });
    const t2 = task({ id: 't2', agentRole: AgentRole.WORKER_CODER, toolsRequired: ['web_search'], dependsOn: ['t1'] });
    const s = stateWith([t1, t2], 't2', FailureClass.WRONG_AGENT);

    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });

    // The revised plan is recorded (versioned into history) even though nothing
    // is runnable — the repair proposal is preserved for auditability.
    expect(out.plan).toBeDefined();
    expect(out.activePlanVersion).toBe(1);
    expect(out.planHistory).toHaveLength(1);
    expect(out.repairProposals?.[0].repairType).toBe('REPLACE_AGENT');
    expect(out.repairProposals?.[0].valid).toBe(true);

    // But the run is terminal: nothing is ready to execute.
    expect(out.status).toBe(WorkflowStatus.FAILED);
    expect(out.status).not.toBe(WorkflowStatus.EXECUTING);
    expect(typeof out.error).toBe('string');
    expect(out.error).toMatch(/no ready tasks/i);

    const newPlan = out.plan as WorkflowPlan;
    const completedIds = new Set(
      newPlan.tasks.filter((t) => t.status === TaskStatus.COMPLETED).map((t) => t.id),
    );
    const failedIds = new Set(
      newPlan.tasks.filter((t) => t.status === TaskStatus.FAILED).map((t) => t.id),
    );
    expect(getReadyTasks(newPlan, completedIds, failedIds)).toEqual([]);

    // Routes to the validator (terminal), never back to the guardrail.
    expect(afterReplanner({ ...s, ...out } as SwarmState)).toBe('validator');
  });
});