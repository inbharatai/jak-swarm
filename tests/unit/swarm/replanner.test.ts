/**
 * replanner.test.ts — HyperAgent Phase 4 genuine plan repair (Innovation #3).
 *
 * Pins the spec §6 Step 4 / §13 Phase 4 invariants:
 *   - the deterministic proposer maps failure class → repair (REPLACE_AGENT,
 *     REPLACE_TOOL, ADD_PREREQUISITE, REDUCE_SCOPE) or ESCALATE for
 *     security/capability/credential/unknown/external-state;
 *   - every applied plan passes the symbolic validator (cyclic/invalid/unsafe
 *     plans are rejected, never applied);
 *   - completed external actions are retained, never re-scheduled;
 *   - the plan-repair budget gate escalates when exhausted;
 *   - autonomy.allowed=false ⇒ requiresApproval=true (human stays in the loop);
 *   - an injected LLM proposer is tried first and falls back to the
 *     deterministic proposer on failure.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentRole,
  FailureClass,
  HyperAgentMode,
  AutonomyCapability,
  AutonomyLevel,
  RepairLevel,
  RiskLevel,
  TaskStatus,
} from '../../../packages/shared/src/index.js';
import type {
  ReplanContext,
  WorkflowPlan,
  WorkflowTask,
  FailureDiagnosis,
  AutonomyDecision,
} from '../../../packages/shared/src/index.js';
import { replan } from '../../../packages/swarm/src/hyperagent/replanner.js';

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

function diagnosis(cls: FailureClass): FailureDiagnosis {
  return {
    id: 'diag_1',
    tenantId: 't-1',
    workflowId: 'wf-1',
    taskId: 'fail',
    failureClass: cls,
    rootCause: 'rc',
    evidence: {},
    confidence: 0.9,
    recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR,
    recommendedChanges: {},
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function autonomy(allowed: boolean, requiresApproval = false): AutonomyDecision {
  return {
    capability: AutonomyCapability.REPLAN_WITHIN_APPROVED,
    level: AutonomyLevel.L3,
    allowed,
    requiresApproval,
    reason: allowed ? 'permitted at L3' : 'denied — human approval required',
  };
}

function ctx(over: Partial<ReplanContext> & { failedTask: WorkflowTask; diagnosis: FailureDiagnosis } ): ReplanContext {
  const failedTask = over.failedTask;
  const originalPlan = over.originalPlan ?? plan([failedTask]);
  return {
    originalGoal: 'g',
    originalPlan,
    currentPlanVersion: 0,
    successfulTaskOutputs: over.successfulTaskOutputs ?? {},
    completedExternalTaskIds: over.completedExternalTaskIds ?? [],
    failedTask,
    verifierIssues: over.verifierIssues ?? [],
    diagnosis: over.diagnosis,
    counterfactual: over.counterfactual,
    permittedAgents: over.permittedAgents ?? [AgentRole.WORKER_RESEARCH, AgentRole.WORKER_BROWSER, AgentRole.WORKER_CODER],
    permittedTools: over.permittedTools ?? ['web_search', 'alt_tool'],
    toolAlternates: over.toolAlternates,
    budgetRemaining: over.budgetRemaining ?? {
      planRepairs: 3,
      executionRetries: 3,
      outputRepairs: 3,
      costUsd: 100,
      durationMs: 100_000,
    },
    autonomy: over.autonomy ?? autonomy(true),
    relevantLearnings: [],
    maxTasks: over.maxTasks ?? 50,
  };
}

const knownTools = new Set(['web_search', 'alt_tool', 'unavailable_tool']);

describe('replanner — deterministic repairs', () => {
  it('WRONG_AGENT → REPLACE_AGENT with a permitted alternate agent', async () => {
    const failed = task({ id: 'fail', agentRole: AgentRole.WORKER_CODER });
    const r = await replan(ctx({ failedTask: failed, diagnosis: diagnosis(FailureClass.WRONG_AGENT) }), { knownToolNames: knownTools });
    expect(r.repairType).toBe('REPLACE_AGENT');
    expect(r.valid).toBe(true);
    expect(r.escalated).toBe(false);
    expect(r.updatedPlan?.tasks.find((t) => t.id === 'fail')?.agentRole).not.toBe(AgentRole.WORKER_CODER);
    expect(r.changedTaskIds).toContain('fail');
  });

  it('TOOL_UNAVAILABLE → REPLACE_TOOL using the tenant equivalence map', async () => {
    const failed = task({ id: 'fail', toolsRequired: ['unavailable_tool'] });
    const r = await replan(
      ctx({
        failedTask: failed,
        diagnosis: diagnosis(FailureClass.TOOL_UNAVAILABLE),
        toolAlternates: { unavailable_tool: ['alt_tool'] },
        permittedTools: ['web_search', 'alt_tool'],
      }),
      { knownToolNames: knownTools },
    );
    expect(r.repairType).toBe('REPLACE_TOOL');
    expect(r.valid).toBe(true);
    expect(r.updatedPlan?.tasks.find((t) => t.id === 'fail')?.toolsRequired).toEqual(['alt_tool']);
  });

  it('MISSING_CONTEXT → ADD_PREREQUISITE inserts a research task before the failed task', async () => {
    const failed = task({ id: 'fail' });
    const r = await replan(ctx({ failedTask: failed, diagnosis: diagnosis(FailureClass.MISSING_CONTEXT) }), { knownToolNames: knownTools });
    expect(r.repairType).toBe('ADD_PREREQUISITE');
    expect(r.valid).toBe(true);
    const prereq = r.updatedPlan?.tasks.find((t) => t.id.startsWith('prereq_'));
    expect(prereq).toBeDefined();
    expect(prereq?.agentRole).toBe(AgentRole.WORKER_RESEARCH);
    // The failed task now depends on the prerequisite.
    expect(r.updatedPlan?.tasks.find((t) => t.id === 'fail')?.dependsOn).toContain(prereq?.id);
    expect(r.changedTaskIds).toContain(prereq?.id);
  });

  it('BUDGET_EXCEEDED with multiple tools → REDUCE_SCOPE drops the highest-risk tool', async () => {
    const failed = task({ id: 'fail', toolsRequired: ['web_search', 'alt_tool'] });
    const r = await replan(ctx({ failedTask: failed, diagnosis: diagnosis(FailureClass.BUDGET_EXCEEDED) }), { knownToolNames: knownTools });
    expect(r.repairType).toBe('REDUCE_SCOPE');
    expect(r.valid).toBe(true);
    expect(r.updatedPlan?.tasks.find((t) => t.id === 'fail')?.toolsRequired).toEqual(['web_search']);
  });
});

describe('replanner — escalations', () => {
  it('PERMISSION_DENIED → ESCALATE (security class, no plan change)', async () => {
    const failed = task({ id: 'fail' });
    const r = await replan(ctx({ failedTask: failed, diagnosis: diagnosis(FailureClass.PERMISSION_DENIED) }), { knownToolNames: knownTools });
    expect(r.repairType).toBe('ESCALATE');
    expect(r.escalated).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.updatedPlan).toBeUndefined();
    expect(r.requiresApproval).toBe(true);
  });

  it('CAPABILITY_GAP → ESCALATE', async () => {
    const failed = task({ id: 'fail' });
    const r = await replan(ctx({ failedTask: failed, diagnosis: diagnosis(FailureClass.CAPABILITY_GAP) }), { knownToolNames: knownTools });
    expect(r.escalated).toBe(true);
    expect(r.repairType).toBe('ESCALATE');
  });

  it('plan-repair budget exhausted → ESCALATE immediately', async () => {
    const failed = task({ id: 'fail' });
    const r = await replan(
      ctx({
        failedTask: failed,
        diagnosis: diagnosis(FailureClass.WRONG_AGENT),
        budgetRemaining: { planRepairs: 0, executionRetries: 0, outputRepairs: 0, costUsd: 0, durationMs: 0 },
      }),
      { knownToolNames: knownTools },
    );
    expect(r.escalated).toBe(true);
    expect(r.reason).toMatch(/budget/i);
  });
});

describe('replanner — symbolic validation is the constraint layer', () => {
  it('rejects an LLM-proposed cyclic plan (CYCLE), never applies it', async () => {
    const failed = task({ id: 'fail' });
    const cyclicPlan: WorkflowPlan = plan([
      task({ id: 'a', dependsOn: ['b'] }),
      task({ id: 'b', dependsOn: ['a'] }),
    ]);
    const r = await replan(
      ctx({ failedTask: failed, diagnosis: diagnosis(FailureClass.WRONG_AGENT) }),
      {
        knownToolNames: knownTools,
        llmPropose: async () => ({
          repairType: 'MODIFY_TASK',
          updatedPlan: cyclicPlan,
          reason: 'llm cyclic proposal',
          expectedImprovement: 0.5,
        }),
      },
    );
    expect(r.valid).toBe(false);
    expect(r.validationIssues.map((i) => i.code)).toContain('CYCLE');
    // Not escalated (the LLM proposed something) but NOT valid either — the
    // graph node treats this as a failed replan and surfaces the issues.
    expect(r.escalated).toBe(false);
  });
});

describe('replanner — autonomy + retention invariants', () => {
  it('autonomy.allowed=false ⇒ requiresApproval=true (human stays in the loop)', async () => {
    const failed = task({ id: 'fail', agentRole: AgentRole.WORKER_CODER });
    const r = await replan(
      ctx({ failedTask: failed, diagnosis: diagnosis(FailureClass.WRONG_AGENT), autonomy: autonomy(false) }),
      { knownToolNames: knownTools },
    );
    expect(r.valid).toBe(true);
    expect(r.escalated).toBe(false);
    expect(r.requiresApproval).toBe(true);
  });

  it('retains completed external tasks that are not downstream of the change', async () => {
    const external = task({ id: 'ext', toolsRequired: ['send_email'], status: TaskStatus.COMPLETED });
    const failed = task({ id: 'fail', agentRole: AgentRole.WORKER_CODER, dependsOn: [] });
    const originalPlan = plan([external, failed]);
    const r = await replan(
      ctx({
        failedTask: failed,
        diagnosis: diagnosis(FailureClass.WRONG_AGENT),
        originalPlan,
        successfulTaskOutputs: { ext: 'sent' },
        completedExternalTaskIds: ['ext'],
        permittedTools: ['web_search', 'alt_tool', 'send_email'],
      }),
      { knownToolNames: new Set(['web_search', 'send_email', 'alt_tool', 'unavailable_tool']) },
    );
    expect(r.valid).toBe(true);
    expect(r.retainedCompletedTaskIds).toContain('ext');
    // The external task is NOT in the invalidated/changed set.
    expect(r.changedTaskIds).not.toContain('ext');
    expect(r.invalidatedTaskIds).not.toContain('ext');
  });

  it('invalidates downstream dependents of a changed task', async () => {
    const upstream = task({ id: 'up', agentRole: AgentRole.WORKER_CODER });
    const down = task({ id: 'down', dependsOn: ['up'] });
    const originalPlan = plan([upstream, down]);
    const r = await replan(
      ctx({ failedTask: upstream, diagnosis: diagnosis(FailureClass.WRONG_AGENT), originalPlan }),
      { knownToolNames: knownTools },
    );
    expect(r.changedTaskIds).toContain('up');
    expect(r.invalidatedTaskIds).toContain('down');
  });
});

describe('replanner — LLM proposer fallback', () => {
  it('uses the LLM proposal when it returns a valid plan', async () => {
    const failed = task({ id: 'fail', agentRole: AgentRole.WORKER_CODER });
    const llmPlan: WorkflowPlan = plan([task({ id: 'fail', agentRole: AgentRole.WORKER_BROWSER })]);
    const r = await replan(
      ctx({ failedTask: failed, diagnosis: diagnosis(FailureClass.WRONG_AGENT) }),
      {
        knownToolNames: knownTools,
        llmPropose: async () => ({
          repairType: 'REPLACE_AGENT',
          updatedPlan: llmPlan,
          reason: 'llm chose browser agent',
          expectedImprovement: 0.7,
        }),
      },
    );
    expect(r.repairType).toBe('REPLACE_AGENT');
    expect(r.valid).toBe(true);
    expect(r.updatedPlan?.tasks.find((t) => t.id === 'fail')?.agentRole).toBe(AgentRole.WORKER_BROWSER);
    expect(r.reason).toBe('llm chose browser agent');
  });

  it('falls back to the deterministic proposer when the LLM throws', async () => {
    const failed = task({ id: 'fail', agentRole: AgentRole.WORKER_CODER });
    const r = await replan(
      ctx({ failedTask: failed, diagnosis: diagnosis(FailureClass.WRONG_AGENT) }),
      {
        knownToolNames: knownTools,
        llmPropose: async () => {
          throw new Error('llm unavailable');
        },
      },
    );
    expect(r.repairType).toBe('REPLACE_AGENT');
    expect(r.valid).toBe(true);
  });

  it('falls back to the deterministic proposer when the LLM returns null', async () => {
    const failed = task({ id: 'fail', agentRole: AgentRole.WORKER_CODER });
    const r = await replan(
      ctx({ failedTask: failed, diagnosis: diagnosis(FailureClass.WRONG_AGENT) }),
      { knownToolNames: knownTools, llmPropose: async () => null },
    );
    expect(r.repairType).toBe('REPLACE_AGENT');
    expect(r.valid).toBe(true);
  });
});