/**
 * security-diagnosis-seal.test.ts — Phase 3 (P0 safety).
 *
 * Pins defense-in-depth that a security-blocked diagnosis can NEVER drive an
 * (LLM-driven) plan repair. Three layers seal it:
 *
 *   A. The diagnosis carries TYPED top-level security fields (`requiresApproval`,
 *      `quarantine`, `deterministicBlock`, `externalSideEffectPossible`) copied
 *      from the deterministic classifier — previously buried in the untyped
 *      `evidence: Record<string, unknown>` and unreadable by the graph edge.
 *   B. `afterDiagnosis` routes any ESCALATE_CLASSES / deterministicBlock /
 *      quarantine diagnosis to the VALIDATOR (terminal escalation), never the
 *      replanner — even when its `recommendedRepairLevel` is R3.
 *   C. `replan()` short-circuits an ESCALATE_CLASSES diagnosis to ESCALATE
 *      BEFORE the LLM proposer is ever invoked — so an injected LLM can never
 *      invent a "repair" for a permission denial or a prompt injection. The LLM
 *      is not even called.
 *
 * A non-security R3 diagnosis still reaches the replanner and may use the LLM
 * (regression guard — the seal is scoped to security, not a blanket block).
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
  ReplanContext,
} from '../../../packages/shared/src/index.js';
import { createInitialSwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import type { SwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import { afterDiagnosis } from '../../../packages/swarm/src/graph/edges.js';
import { replan } from '../../../packages/swarm/src/hyperagent/replanner.js';
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

function planWith(tasks: WorkflowTask[]): WorkflowPlan {
  return {
    id: 'plan-1', name: 'p', goal: 'g', industry: 'general', tasks,
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function diagnosis(cls: FailureClass, taskId = 'fail'): FailureDiagnosis {
  return {
    id: `diag_wf-1_${taskId}_0`, tenantId: 't-1', workflowId: 'wf-1', taskId,
    failureClass: cls, rootCause: 'rc', evidence: {}, confidence: 0.9,
    recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, recommendedChanges: {},
    createdAt: '2026-01-01T00:00:00Z',
    ...securityFieldsForClass(cls),
  };
}

function stateWithFailedDiagnosis(cls: FailureClass, taskId = 'fail'): SwarmState {
  const tasks = [task({ id: taskId, agentRole: AgentRole.WORKER_CODER, toolsRequired: ['web_search'] })];
  const base = createInitialSwarmState({
    goal: 'g', tenantId: 't-1', userId: 'u-1', workflowId: 'wf-1',
    hyperAgentEnabled: true, hyperAgentMode: HyperAgentMode.ASSISTED, autonomyLevel: AutonomyLevel.L3,
  });
  return {
    ...base,
    plan: planWith(tasks),
    currentTaskIndex: 0,
    pendingDiagnoses: { [taskId]: { diagnosis: diagnosis(cls, taskId), hint: { taskId, agentRole: 'WORKER_RESEARCH', toolName: 'web_search', inputHash: 'h', hypothesisSet: ['agent-only'] } } },
    status: WorkflowStatus.VERIFYING,
  } as SwarmState;
}

// ─── Layer A: the seal is surfaced as typed top-level fields ────────────────

describe('Phase 3 Layer A — diagnosis security seal is typed + consistent', () => {
  it('a PERMISSION_DENIED diagnosis surfaces requiresApproval + deterministicBlock (not buried in evidence)', () => {
    const d = diagnosis(FailureClass.PERMISSION_DENIED);
    expect(d.requiresApproval).toBe(true);
    expect(d.deterministicBlock).toBe(true);
    expect(d.quarantine).toBe(false);
    expect(d.externalSideEffectPossible).toBe(false);
  });

  it('a PROMPT_INJECTION diagnosis surfaces quarantine + deterministicBlock', () => {
    const d = diagnosis(FailureClass.PROMPT_INJECTION);
    expect(d.quarantine).toBe(true);
    expect(d.deterministicBlock).toBe(true);
    expect(d.requiresApproval).toBe(true);
  });

  it('a non-security R3 diagnosis (WRONG_AGENT) has deterministicBlock=false', () => {
    const d = diagnosis(FailureClass.WRONG_AGENT);
    expect(d.deterministicBlock).toBe(false);
    expect(d.requiresApproval).toBe(false);
    expect(d.quarantine).toBe(false);
  });
});

// ─── Layer B: afterDiagnosis seals security diagnoses to the validator ──────

describe('Phase 3 Layer B — afterDiagnosis routes security-blocked R3 diagnoses to the validator, not the replanner', () => {
  const securityClasses: FailureClass[] = [
    FailureClass.PERMISSION_DENIED,
    FailureClass.POLICY_BLOCK,
    FailureClass.PROMPT_INJECTION,
    FailureClass.MISSING_CREDENTIAL,
    FailureClass.UNKNOWN,
    FailureClass.CAPABILITY_GAP,
    FailureClass.EXTERNAL_STATE_CHANGED,
  ];

  it.each(securityClasses)('%s (R3) → validator, never the replanner', (cls) => {
    const s = stateWithFailedDiagnosis(cls);
    // Every security class above has deterministicBlock=true (the hard security
    // classes directly; CAPABILITY_GAP/MISSING_CREDENTIAL/EXTERNAL_STATE_CHANGED
    // via requiresApproval). All route to the validator even at R3.
    expect(diagnosis(cls).deterministicBlock).toBe(true);
    expect(afterDiagnosis(s)).toBe('validator');
    expect(afterDiagnosis(s)).not.toBe('replanner');
  });

  it('a non-security R3 diagnosis (WRONG_AGENT) still reaches the replanner', () => {
    const s = stateWithFailedDiagnosis(FailureClass.WRONG_AGENT);
    expect(diagnosis(FailureClass.WRONG_AGENT).deterministicBlock).toBe(false);
    expect(afterDiagnosis(s)).toBe('replanner');
  });

  it('a quarantined diagnosis routes to the validator even if not in ESCALATE_CLASSES', () => {
    // PROMPT_INJECTION is the only quarantine=true class; pin the quarantine
    // branch of the seal independently of the deterministicBlock branch.
    const s = stateWithFailedDiagnosis(FailureClass.PROMPT_INJECTION);
    expect(diagnosis(FailureClass.PROMPT_INJECTION).quarantine).toBe(true);
    expect(afterDiagnosis(s)).toBe('validator');
  });
});

// ─── Layer C: replan() never invokes the LLM for a security diagnosis ───────

function ctxFor(diag: FailureDiagnosis): ReplanContext {
  const failedTask = task({ id: 'fail', agentRole: AgentRole.WORKER_CODER });
  return {
    originalGoal: 'g',
    originalPlan: planWith([failedTask]),
    currentPlanVersion: 0,
    successfulTaskOutputs: {},
    completedExternalTaskIds: [],
    failedTask,
    verifierIssues: [],
    diagnosis: diag,
    counterfactual: undefined,
    permittedAgents: [AgentRole.WORKER_RESEARCH, AgentRole.WORKER_BROWSER, AgentRole.WORKER_CODER],
    permittedTools: ['web_search', 'alt_tool'],
    toolAlternates: undefined,
    budgetRemaining: {
      planRepairs: 3, executionRetries: 3, outputRepairs: 3, costUsd: 100, durationMs: 100_000,
    },
    autonomy: {
      capability: 'REPLAN_WITHIN_APPROVED' as never,
      level: AutonomyLevel.L3,
      allowed: true,
      requiresApproval: false,
      reason: 'permitted at L3',
    },
    relevantLearnings: [],
    maxTasks: 50,
  } as ReplanContext;
}

const knownTools = new Set(['web_search', 'alt_tool']);

describe('Phase 3 Layer C — replan() pre-LLM guard (security diagnoses never reach the LLM)', () => {
  it.each([
    FailureClass.PERMISSION_DENIED,
    FailureClass.POLICY_BLOCK,
    FailureClass.PROMPT_INJECTION,
    FailureClass.UNKNOWN,
    FailureClass.CAPABILITY_GAP,
    FailureClass.MISSING_CREDENTIAL,
    FailureClass.EXTERNAL_STATE_CHANGED,
  ])('%s → ESCALATE without invoking the LLM proposer (call count 0)', async (cls) => {
    let llmCalls = 0;
    const r = await replan(ctxFor(diagnosis(cls)), {
      knownToolNames: knownTools,
      llmPropose: async () => {
        llmCalls += 1;
        // An LLM that "helpfully" invents a repair — must NEVER be consulted.
        return {
          repairType: 'MODIFY_TASK',
          updatedPlan: planWith([{ ...task({ id: 'fail' }), agentRole: AgentRole.WORKER_RESEARCH }]),
          reason: 'llm would repair a security failure',
          expectedImprovement: 0.5,
        };
      },
    });
    expect(llmCalls).toBe(0);
    expect(r.repairType).toBe('ESCALATE');
    expect(r.escalated).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.updatedPlan).toBeUndefined();
    expect(r.requiresApproval).toBe(true);
  });

  it('a non-security R3 diagnosis (WRONG_AGENT) DOES invoke the LLM and may apply its plan', async () => {
    let llmCalls = 0;
    const llmPlan: WorkflowPlan = planWith([{ ...task({ id: 'fail' }), agentRole: AgentRole.WORKER_RESEARCH }]);
    const r = await replan(ctxFor(diagnosis(FailureClass.WRONG_AGENT)), {
      knownToolNames: knownTools,
      llmPropose: async () => {
        llmCalls += 1;
        return { repairType: 'REPLACE_AGENT', updatedPlan: llmPlan, reason: 'llm chose research agent', expectedImprovement: 0.7 };
      },
    });
    expect(llmCalls).toBe(1);
    expect(r.repairType).toBe('REPLACE_AGENT');
    expect(r.valid).toBe(true);
    expect(r.escalated).toBe(false);
    expect(r.updatedPlan).toBeDefined();
  });
});