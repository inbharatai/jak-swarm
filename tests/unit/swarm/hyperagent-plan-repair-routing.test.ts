/**
 * hyperagent-plan-repair-routing.test.ts — HyperAgent Phase 4 integration.
 *
 * Exercises the spec §13 Phase 4 scenarios end-to-end across the graph edges
 * + the diagnosis/replanner nodes (the pure cores are covered by their own
 * unit tests; this file wires them together the way the LangGraph builder
 * does). The non-regression gating (HyperAgent OFF ⇒ legacy routing) is pinned
 * so default workflows stay byte-for-byte unchanged.
 *
 * Scenarios (spec §13 Phase 4):
 *   1. wrong-agent failure → REPLACE_AGENT → re-execute
 *   2. tool-unavailable failure → REPLACE_TOOL → re-execute
 *   3. missing-context failure → ADD_PREREQUISITE → re-execute
 *   4. cyclic replan → rejected (CYCLE), never applied
 *   5. destructive / security failure → never auto-retried (ESCALATE / block)
 *   6. completed external action → never duplicated (retained / re-schedule rejected)
 *   7. plan-repair budget → enforced (exhausted ⇒ escalate)
 *   8. cost budget → enforced (auction cap)
 *   9. unknown failure → escalated (never silently retried)
 *   10. repaired workflow → plan versioned + rewound for re-execution
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
import { createInitialSwarmState, getCurrentTask } from '../../../packages/swarm/src/state/swarm-state.js';
import type { SwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import { afterVerifier, afterDiagnosis, afterReplanner } from '../../../packages/swarm/src/graph/edges.js';
import { failureDiagnosisNode } from '../../../packages/swarm/src/graph/nodes/failure-diagnosis-node.js';
import { replannerNode } from '../../../packages/swarm/src/graph/nodes/replanner-node.js';
import { auctionRepairs, type RepairCandidate } from '../../../packages/swarm/src/hyperagent/repair-budget-auction.js';
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
    // Security seal (Phase 3) — derived from the class so the fixture's seal
    // matches what the real diagnostician would surface.
    ...securityFieldsForClass(cls),
  };
}

function hint(taskId = 'fail'): CounterfactualReplayHint {
  return { taskId, agentRole: 'WORKER_RESEARCH', toolName: 'web_search', inputHash: 'h', hypothesisSet: ['agent-only', 'tool-only', 'model-only'] };
}

function pendingRecord(cls: FailureClass, taskId = 'fail'): DiagnosisRecord {
  return { diagnosis: diagnosis(cls, taskId), hint: hint(taskId) };
}

const vFail = (issues = ['bad']): VerificationResult => ({ passed: false, issues, confidence: 0.4, needsRetry: false });

/**
 * Build a SwarmState with a failed task at currentTaskIndex and HyperAgent ON.
 * `over` patches arbitrary fields (pendingDiagnoses, repairBudget, etc.).
 */
function stateWithFailedTask(over: Partial<SwarmState> & { tasks?: WorkflowTask[]; failedId?: string } = {}): SwarmState {
  const failedId = over.failedId ?? 'fail';
  const tasks = over.tasks ?? [task({ id: failedId, agentRole: AgentRole.WORKER_CODER, toolsRequired: ['web_search'] })];
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
    pendingDiagnoses: { [failedId]: pendingRecord(FailureClass.WRONG_AGENT, failedId) },
    status: WorkflowStatus.VERIFYING,
    ...over,
  } as SwarmState;
}

const KNOWN_TOOLS = new Set(['web_search', 'alt_tool', 'send_email', 'unavailable_tool']);

// ─── Non-regression gating (HyperAgent OFF ⇒ legacy routing) ───────────────

describe('Phase 4 routing — non-regression gating', () => {
  it('afterVerifier NEVER routes to diagnosis when HyperAgent is OFF (legacy unchanged)', () => {
    const s = stateWithFailedTask({ hyperAgentEnabled: false, hyperAgentMode: HyperAgentMode.OFF });
    // Failed task, retries exhausted (needsRetry false) → legacy would advance.
    expect(afterVerifier(s)).not.toBe('diagnosis');
    // With more tasks it advances to guardrail; without, to __end__ (validator).
    expect(['guardrail', '__end__']).toContain(afterVerifier(s));
  });

  it('afterVerifier routes to diagnosis when HyperAgent is ON + task failed + budget remains', () => {
    const s = stateWithFailedTask({});
    expect(afterVerifier(s)).toBe('diagnosis');
  });

  it('afterVerifier skips diagnosis when the HyperAgent iteration budget is exhausted', () => {
    const s = stateWithFailedTask({ hyperAgentIteration: 3, maxHyperAgentIterations: 3 });
    expect(afterVerifier(s)).not.toBe('diagnosis');
  });

  it('afterDiagnosis routes R3 → replanner, non-R3 → validator', () => {
    const s = stateWithFailedTask({});
    expect(afterDiagnosis(s)).toBe('replanner');
    const r1 = stateWithFailedTask({
      pendingDiagnoses: { fail: { diagnosis: { ...diagnosis(FailureClass.TRANSIENT_PROVIDER), recommendedRepairLevel: RepairLevel.R1_EXECUTION_RETRY }, hint: hint() } },
    });
    expect(afterDiagnosis(r1)).toBe('validator');
  });

  it('afterReplanner routes EXECUTING → guardrail, FAILED → validator, AWAITING_APPROVAL → __end__', () => {
    expect(afterReplanner({ ...stateWithFailedTask({}), status: WorkflowStatus.EXECUTING } as SwarmState)).toBe('guardrail');
    expect(afterReplanner({ ...stateWithFailedTask({}), status: WorkflowStatus.FAILED } as SwarmState)).toBe('validator');
    expect(afterReplanner({ ...stateWithFailedTask({}), status: WorkflowStatus.AWAITING_APPROVAL } as SwarmState)).toBe('__end__');
  });
});

// ─── Diagnosis node ────────────────────────────────────────────────────────

describe('Phase 4 diagnosis node — writes pendingDiagnoses for the replanner', () => {
  it('produces a deterministic-block diagnosis for a permission-denied failure and stays non-terminal', async () => {
    const s = stateWithFailedTask({
      tasks: [task({ id: 'fail', toolsRequired: ['send_email'] })],
      verificationResults: { fail: vFail(['403 Forbidden: access denied']) },
    });
    const out = await failureDiagnosisNode(s, {});
    expect(out.status).not.toBe(WorkflowStatus.FAILED);
    expect(out.pendingDiagnoses?.fail).toBeDefined();
    expect(out.pendingDiagnoses?.fail.diagnosis.failureClass).toBe(FailureClass.PERMISSION_DENIED);
    expect(out.failureDiagnoses?.fail).toBeDefined();
  });

  it('honestly records counterfactual.executed=false when no re-executor is injected', async () => {
    const s = stateWithFailedTask({});
    const out = await failureDiagnosisNode(s, {});
    expect(out.pendingDiagnoses?.fail.counterfactual?.executed).toBe(false);
  });
});

// ─── The 10 spec scenarios ─────────────────────────────────────────────────

describe('Phase 4 spec scenarios', () => {
  it('1. WRONG_AGENT → REPLACE_AGENT → re-execute (routes to guardrail)', async () => {
    const s = stateWithFailedTask({ pendingDiagnoses: { fail: pendingRecord(FailureClass.WRONG_AGENT) } });
    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.status).toBe(WorkflowStatus.EXECUTING);
    expect(out.repairProposals?.[0].repairType).toBe('REPLACE_AGENT');
    expect(out.repairProposals?.[0].valid).toBe(true);
    // The failed task's agent changed to a permitted alternate.
    const newPlan = out.plan as WorkflowPlan;
    expect(newPlan.tasks.find((t) => t.id === 'fail')?.agentRole).not.toBe(AgentRole.WORKER_CODER);
    // Routed back to re-execute.
    expect(afterReplanner({ ...s, ...out } as SwarmState)).toBe('guardrail');
  });

  it('1b. resets the per-task R1/R2 retry budget for the re-executed task on a successful replan', async () => {
    // The failed task reached diagnosis BECAUSE its R1/R2 budget exhausted
    // (taskRetryCount[fail] = MAX = 2). Before the fix the replanner rewound
    // currentTaskIndex but left the counter at 2, so the revised task got zero
    // same-input retries and any minor defect jumped straight back to diagnosis.
    const s = stateWithFailedTask({
      pendingDiagnoses: { fail: pendingRecord(FailureClass.WRONG_AGENT) },
      taskRetryCount: { fail: 2 },
    });
    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.status).toBe(WorkflowStatus.EXECUTING);
    expect(out.taskRetryCount?.fail).toBe(0);
    // Other tasks' counters (if any) are preserved — only re-executed tasks reset.
    const s2 = stateWithFailedTask({
      tasks: [task({ id: 'fail', agentRole: AgentRole.WORKER_CODER, toolsRequired: ['web_search'] }), task({ id: 'other' })],
      pendingDiagnoses: { fail: pendingRecord(FailureClass.WRONG_AGENT) },
      taskRetryCount: { fail: 2, other: 1 },
    });
    const out2 = await replannerNode(s2, { knownToolNames: KNOWN_TOOLS });
    // The node returns a per-key DELTA (merged by the LangGraph reducer), so it
    // resets only the re-executed task and does not clobber `other`'s counter.
    expect(out2.taskRetryCount).toEqual({ fail: 0 });
  });

  it('2. TOOL_UNAVAILABLE → REPLACE_TOOL → re-execute', async () => {
    const s = stateWithFailedTask({
      tasks: [task({ id: 'fail', toolsRequired: ['unavailable_tool'] })],
      pendingDiagnoses: { fail: pendingRecord(FailureClass.TOOL_UNAVAILABLE) },
    });
    const out = await replannerNode(s, {
      knownToolNames: KNOWN_TOOLS,
      toolAlternates: { unavailable_tool: ['alt_tool'] },
    });
    expect(out.status).toBe(WorkflowStatus.EXECUTING);
    expect(out.repairProposals?.[0].repairType).toBe('REPLACE_TOOL');
    expect((out.plan as WorkflowPlan).tasks.find((t) => t.id === 'fail')?.toolsRequired).toEqual(['alt_tool']);
  });

  it('3. MISSING_CONTEXT → ADD_PREREQUISITE → re-execute', async () => {
    const s = stateWithFailedTask({ pendingDiagnoses: { fail: pendingRecord(FailureClass.MISSING_CONTEXT) } });
    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.repairProposals?.[0].repairType).toBe('ADD_PREREQUISITE');
    expect(out.status).toBe(WorkflowStatus.EXECUTING);
    const newPlan = out.plan as WorkflowPlan;
    expect(newPlan.tasks.some((t) => t.id.startsWith('prereq_'))).toBe(true);
  });

  it('4. cyclic replan → rejected (CYCLE), never applied (FAILED)', async () => {
    const s = stateWithFailedTask({ pendingDiagnoses: { fail: pendingRecord(FailureClass.WRONG_AGENT) } });
    const cyclic: WorkflowPlan = plan([
      task({ id: 'a', dependsOn: ['b'] }),
      task({ id: 'b', dependsOn: ['a'] }),
    ]);
    const out = await replannerNode(s, {
      knownToolNames: KNOWN_TOOLS,
      llmPropose: async () => ({
        repairType: 'MODIFY_TASK',
        updatedPlan: cyclic,
        reason: 'cyclic',
        expectedImprovement: 0.5,
      }) as never,
    });
    expect(out.status).toBe(WorkflowStatus.FAILED);
    expect(out.repairProposals?.[0].valid).toBe(false);
    expect(out.repairProposals?.[0].validationIssues.map((i) => i.code)).toContain('CYCLE');
    // The cyclic plan was NOT applied.
    expect(out.plan).toBeUndefined();
    expect(afterReplanner({ ...s, ...out } as SwarmState)).toBe('validator');
  });

  it('5. PERMISSION_DENIED → never auto-retried (ESCALATE, FAILED)', async () => {
    const s = stateWithFailedTask({ pendingDiagnoses: { fail: pendingRecord(FailureClass.PERMISSION_DENIED) } });
    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.repairProposals?.[0].escalated).toBe(true);
    expect(out.repairProposals?.[0].repairType).toBe('ESCALATE');
    expect(out.status).toBe(WorkflowStatus.FAILED);
    // No plan mutation — the failed task is unchanged.
    expect(out.plan).toBeUndefined();
  });

  it('5b. an LLM proposal that strips approval from a destructive task → DESTRUCTIVE_AUTO_APPROVED → rejected', async () => {
    const prev = task({ id: 'fail', requiresApproval: true, riskLevel: RiskLevel.HIGH });
    const s = stateWithFailedTask({
      tasks: [prev],
      pendingDiagnoses: { fail: pendingRecord(FailureClass.WRONG_AGENT) },
    });
    const stripped: WorkflowPlan = plan([task({ id: 'fail', requiresApproval: false, riskLevel: RiskLevel.HIGH })]);
    const out = await replannerNode(s, {
      knownToolNames: KNOWN_TOOLS,
      llmPropose: async () => ({
        repairType: 'MODIFY_TASK',
        updatedPlan: stripped,
        reason: 'stripped approval',
        expectedImprovement: 0.5,
      }) as never,
    });
    expect(out.status).toBe(WorkflowStatus.FAILED);
    expect(out.repairProposals?.[0].validationIssues.map((i) => i.code)).toContain('DESTRUCTIVE_AUTO_APPROVED');
  });

  it('6. completed external action → retained, never duplicated', async () => {
    const ext = task({ id: 'ext', toolsRequired: ['send_email'], status: TaskStatus.COMPLETED });
    const failed = task({ id: 'fail', agentRole: AgentRole.WORKER_CODER });
    const s = stateWithFailedTask({
      tasks: [ext, failed],
      failedId: 'fail',
      pendingDiagnoses: { fail: pendingRecord(FailureClass.WRONG_AGENT) },
      taskResults: { ext: 'sent', fail: { partial: true } },
    });
    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.status).toBe(WorkflowStatus.EXECUTING);
    const newPlan = out.plan as WorkflowPlan;
    // The external task is still COMPLETED in the revised plan.
    expect(newPlan.tasks.find((t) => t.id === 'ext')?.status).toBe(TaskStatus.COMPLETED);
    expect(out.repairProposals?.[0].retainedCompletedTaskIds).toContain('ext');
  });

  it('6b. an LLM proposal that re-schedules a completed external action → COMPLETED_EXTERNAL_REPEATED → rejected', async () => {
    const ext = task({ id: 'ext', toolsRequired: ['send_email'], status: TaskStatus.COMPLETED });
    const failed = task({ id: 'fail', agentRole: AgentRole.WORKER_CODER });
    const s = stateWithFailedTask({
      tasks: [ext, failed],
      failedId: 'fail',
      pendingDiagnoses: { fail: pendingRecord(FailureClass.WRONG_AGENT) },
      taskResults: { ext: 'sent', fail: { partial: true } },
    });
    // Tampered plan: the external task is flipped back to PENDING.
    const tampered: WorkflowPlan = plan([
      task({ id: 'ext', toolsRequired: ['send_email'], status: TaskStatus.PENDING }),
      task({ id: 'fail', agentRole: AgentRole.WORKER_BROWSER }),
    ]);
    const out = await replannerNode(s, {
      knownToolNames: KNOWN_TOOLS,
      // Mark ext as a completed external task via the context by injecting a
      // proposer; the replanner derives completedExternalTaskIds from the
      // CURRENT plan's COMPLETED external-tool tasks, so ext is captured.
      llmPropose: async () => ({
        repairType: 'MODIFY_TASK',
        updatedPlan: tampered,
        reason: 're-schedule ext',
        expectedImprovement: 0.5,
      }) as never,
    });
    expect(out.status).toBe(WorkflowStatus.FAILED);
    expect(out.repairProposals?.[0].validationIssues.map((i) => i.code)).toContain('COMPLETED_EXTERNAL_REPEATED');
  });

  it('7. plan-repair budget exhausted → ESCALATE (FAILED)', async () => {
    const s = stateWithFailedTask({
      pendingDiagnoses: { fail: pendingRecord(FailureClass.WRONG_AGENT) },
      taskRepairState: { fail: { taskId: 'fail', executionAttempts: 0, outputRepairAttempts: 0, planRepairAttempts: 1, capabilityRepairAttempts: 0, exhausted: false } },
      repairBudget: { maxExecutionRetries: 2, maxOutputRepairs: 2, maxPlanRepairs: 1, maxCapabilityRepairs: 1, maxTotalCostUsd: 100, maxDurationMs: 100_000 },
    });
    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.repairProposals?.[0].escalated).toBe(true);
    expect(out.status).toBe(WorkflowStatus.FAILED);
    expect(out.repairProposals?.[0].reason).toMatch(/budget/i);
  });

  it('8. cost budget enforced — auction rejects candidates over the cost cap', () => {
    const a: RepairCandidate = {
      taskId: 'a', repairType: 'REPLACE_TOOL', repairLevel: RepairLevel.R3_PLAN_REPAIR,
      probabilityOfSuccess: 0.9, value: 100, costUsd: 60, durationMs: 100, requiresApproval: false,
    };
    const b: RepairCandidate = { ...a, taskId: 'b', costUsd: 60 };
    const r = auctionRepairs([a, b], {
      costUsd: 100, durationMs: 100_000,
      maxPlanRepairs: 3, maxExecutionRetries: 3, maxOutputRepairs: 3, maxCapabilityRepairs: 3,
    });
    expect(r.winners.map((w) => w.taskId)).toEqual(['a']);
    expect(r.rejected.find((x) => x.candidate.taskId === 'b')?.reason).toMatch(/cost/);
  });

  it('9. UNKNOWN failure → escalated (never silently retried)', async () => {
    const s = stateWithFailedTask({ pendingDiagnoses: { fail: pendingRecord(FailureClass.UNKNOWN) } });
    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.repairProposals?.[0].escalated).toBe(true);
    expect(out.repairProposals?.[0].repairType).toBe('ESCALATE');
    expect(out.status).toBe(WorkflowStatus.FAILED);
  });

  it('10. repaired workflow → plan versioned + rewound for re-execution', async () => {
    const s = stateWithFailedTask({ pendingDiagnoses: { fail: pendingRecord(FailureClass.WRONG_AGENT) } });
    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.status).toBe(WorkflowStatus.EXECUTING);
    expect(out.activePlanVersion).toBe(1);
    expect(out.planHistory).toHaveLength(1);
    expect(out.planHistory?.[0].version).toBe(1);
    expect(out.planHistory?.[0].repairType).toBe('REPLACE_AGENT');
    expect(out.planHistory?.[0].triggeringDiagnosisId).toBe(diagnosis(FailureClass.WRONG_AGENT).id);
    expect(out.hyperAgentIteration).toBe(1);
    // Rewound to the failed task so only invalidated work re-executes.
    const newPlan = out.plan as WorkflowPlan;
    const failedIndex = newPlan.tasks.findIndex((t) => t.id === 'fail');
    expect(out.currentTaskIndex).toBe(failedIndex);
    // The failed task is reset to PENDING for re-execution.
    expect(newPlan.tasks.find((t) => t.id === 'fail')?.status).toBe(TaskStatus.PENDING);
  });

  it('autonomy below L3 → replan pauses for human approval (AWAITING_APPROVAL)', async () => {
    const s = stateWithFailedTask({
      pendingDiagnoses: { fail: pendingRecord(FailureClass.WRONG_AGENT) },
      autonomyLevel: AutonomyLevel.L1,
    });
    const out = await replannerNode(s, { knownToolNames: KNOWN_TOOLS });
    expect(out.status).toBe(WorkflowStatus.AWAITING_APPROVAL);
    expect(out.repairProposals?.[0].requiresApproval).toBe(true);
    expect(afterReplanner({ ...s, ...out } as SwarmState)).toBe('__end__');
  });
});