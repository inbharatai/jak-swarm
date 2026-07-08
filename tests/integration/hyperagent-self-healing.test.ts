/**
 * hyperagent-self-healing.test.ts — HyperAgent Phase 14 integration proof.
 *
 * Composes the REAL pure cores end-to-end across the 9 spec scenarios
 * (§13 Phase 14): self-healing, learning, governance, and rollback. Every
 * scenario wires the actual deterministic modules — failure classifier,
 * counterfactual diagnostician, symbolic replanner + validator, learning
 * extractor + information-theoretic gate, approved-spec closed loop, Shield
 * MCP client, versioned-config lifecycle, and the R5 code-repair gate — and
 * asserts the honest, bounded behaviour the HyperAgent contract promises.
 *
 * No I/O is mocked beyond the injected seams the pure cores already define
 * (CounterfactualReExecutor, LlmProposeFn, Shield verdictFor). No live tenant,
 * DB, or Cloud Run worker is touched — the env-gated 12-step E2E + deploy gate
 * lives in tests/e2e and is never fake-passed here.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentRole,
  FailureClass,
  RepairLevel,
  RiskLevel,
  TaskStatus,
  HyperAgentMode,
  AutonomyLevel,
  AutonomyCapability,
  TaskVerdict,
  OutcomeVerdict,
  LearningKind,
  ConfigKind,
  ConfigVersionStatus,
  PromotionDecision,
  CodeRepairKind,
  CodeRepairStatus,
  CodeRepairSafetyClass,
  AcceptanceCriterionKind,
  AcceptanceVerdict,
} from '@jak-swarm/shared';
import type {
  WorkflowPlan,
  WorkflowTask,
  ExecutionFailure,
  FailureSignal,
  CounterfactualReplayHint,
  ReplanContext,
  OutcomeEvaluation,
  TaskOutcome,
  ContingencyTable,
  AgentExecutableSpec,
  RunEvidence,
  AcceptanceCriterion,
  ConfigVersion,
  RolloutMetrics,
  CodeRepairProposal,
} from '@jak-swarm/shared';
import { ShieldDecisionVerdict, evaluateForConfig } from '@jak-swarm/security';
import { ShieldMcpClient } from '../../packages/security/src/shield-gateway/shield-mcp-client.js';
import { generateShieldKeyPair } from '../../packages/security/src/shield-gateway/signed-decision.js';
import type { ShieldDecisionSubject } from '../../packages/security/src/shield-gateway/signed-decision.js';
import { classifyFailure } from '../../packages/swarm/src/recovery/failure-classifier.js';
import { diagnoseFailure } from '../../packages/swarm/src/hyperagent/failure-diagnostician.js';
import type { CounterfactualReExecutor } from '../../packages/swarm/src/hyperagent/failure-diagnostician.js';
import { replan } from '../../packages/swarm/src/hyperagent/replanner.js';
import { extractLearnings } from '../../packages/swarm/src/hyperagent/learning-extractor.js';
import { gateLearning } from '../../packages/swarm/src/hyperagent/learning-gate.js';
import { materializePlan, acceptanceCriteriaForSpec } from '../../packages/swarm/src/hyperagent/spec-executor.js';
import { measureAcceptance, acceptanceVerdict } from '../../packages/swarm/src/hyperagent/acceptance-checker.js';
import {
  createDraft,
  proposeVersion,
  startShadow,
  startCanary,
  promoteVersion,
  rollbackVersion,
  evaluateShadow,
  evaluateCanary,
  rampCanary,
} from '../../packages/swarm/src/hyperagent/config-lifecycle.js';
import {
  createProposal,
  classifyRepair,
  validateProposal,
  canAutoMerge,
  draftPrTitle,
  draftPrBody,
  advanceRepair,
  assertNotMain,
  CodeRepairError,
} from '../../packages/swarm/src/hyperagent/code-repair.js';
import {
  runFailureInjection,
  FailureKind,
  defaultInjectionContext,
} from '../../packages/swarm/src/hyperagent/failure-injection.js';

const NOW = '2026-07-08T12:00:00.000Z';
const SHIELD_NOW = Date.parse(NOW);

// ─── Helpers ────────────────────────────────────────────────────────────────

function task(over: Partial<WorkflowTask> & Pick<WorkflowTask, 'id' | 'agentRole' | 'toolsRequired'>): WorkflowTask {
  return {
    id: over.id,
    name: over.name ?? over.id,
    description: over.description ?? over.id,
    agentRole: over.agentRole,
    toolsRequired: over.toolsRequired,
    riskLevel: over.riskLevel ?? RiskLevel.LOW,
    requiresApproval: over.requiresApproval ?? false,
    status: over.status ?? TaskStatus.PENDING,
    dependsOn: over.dependsOn ?? [],
    retryable: over.retryable ?? true,
    maxRetries: over.maxRetries ?? 2,
  };
}

function plan(tasks: WorkflowTask[]): WorkflowPlan {
  return {
    id: 'plan-1',
    name: 'test-plan',
    goal: 'test goal',
    industry: 'general',
    tasks,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  };
}

function executionFailure(over: Partial<ExecutionFailure> & Pick<ExecutionFailure, 'taskId' | 'errorClass' | 'message'>): ExecutionFailure {
  return {
    workflowId: 'wf-1',
    taskId: over.taskId,
    agentRole: over.agentRole ?? AgentRole.WORKER_CRM,
    toolName: over.toolName,
    errorClass: over.errorClass,
    message: over.message,
    retryable: over.retryable ?? false,
    externalSideEffectPossible: over.externalSideEffectPossible ?? false,
    inputHash: over.inputHash ?? 'hash-1',
    stateVersion: over.stateVersion ?? 1,
    occurredAt: NOW,
  };
}

/** Counterfactual re-executor stub that isolates a chosen dimension. */
function reExecutorIsolating(dimension: 'agent-only' | 'tool-only' | 'model-only'): CounterfactualReExecutor {
  return {
    async replayVariant(input) {
      const passed = input.dimension === dimension;
      return { passed, note: passed ? `flipping ${input.dimension} made the task pass` : `flipping ${input.dimension} did not help` };
    },
  };
}

const L3_ASSISTED = { hyperAgentEnabled: true, hyperAgentMode: HyperAgentMode.ASSISTED, autonomyLevel: AutonomyLevel.L3 };

// ─── Scenario 1: worker failure → diagnosis → replan → success ─────────────

describe('Phase 14 integration — worker failure → diagnosis → replan → success', () => {
  it('classifies, counterfactually isolates the agent, repairs the plan, and preserves the completed task', async () => {
    const t1 = task({ id: 't_1', agentRole: AgentRole.WORKER_RESEARCH, toolsRequired: ['web_search'], status: TaskStatus.COMPLETED });
    const t2 = task({ id: 't_2', agentRole: AgentRole.WORKER_CRM, toolsRequired: ['crm_create_contact'], status: TaskStatus.FAILED, dependsOn: ['t_1'] });
    const originalPlan = plan([t1, t2]);

    // 1. Deterministic classification of the worker failure.
    const signal: FailureSignal = { message: 'ungrounded output — no citations found, hallucinated facts', toolName: 'crm_create_contact' };
    const classified = classifyFailure(signal);
    expect(classified.errorClass).toBe(FailureClass.GROUNDING_FAILURE);
    expect(classified.retryable).toBe(false);

    // 2. Counterfactual diagnosis — the agent-only variant flips the outcome.
    const hint: CounterfactualReplayHint = {
      taskId: 't_2',
      agentRole: AgentRole.WORKER_CRM,
      toolName: 'crm_create_contact',
      inputHash: 'hash-1',
      failureClass: FailureClass.GROUNDING_FAILURE,
      hypothesisSet: ['agent-only', 'tool-only', 'model-only'],
    };
    const diag = await diagnoseFailure({
      failure: executionFailure({ taskId: 't_2', agentRole: AgentRole.WORKER_CRM, toolName: 'crm_create_contact', errorClass: FailureClass.GROUNDING_FAILURE, message: signal.message }),
      signal,
      hint,
      verifierIssues: ['no citations'],
      tenantId: 'tenant-1',
      now: NOW,
      reExecutor: reExecutorIsolating('agent-only'),
    });
    expect(diag.diagnosis.failureClass).toBe(FailureClass.GROUNDING_FAILURE);
    expect(diag.counterfactual.isolatedDimension).toBe('agent-only');
    expect(diag.deterministicBlock).toBe(false);

    // 3. Replan — the symbolic proposer swaps the agent; the validator accepts.
    const ctx: ReplanContext = {
      originalGoal: 'test goal',
      originalPlan,
      currentPlanVersion: 1,
      successfulTaskOutputs: { t_1: { result: 'done' } },
      completedExternalTaskIds: [],
      failedTask: t2,
      verifierIssues: ['no citations'],
      diagnosis: diag.diagnosis,
      counterfactual: diag.counterfactual,
      permittedAgents: [AgentRole.WORKER_CRM, AgentRole.WORKER_RESEARCH],
      permittedTools: ['web_search', 'crm_create_contact'],
      budgetRemaining: { planRepairs: 1, executionRetries: 2, outputRepairs: 2, costUsd: 5, durationMs: 60000 },
      autonomy: evaluateForConfig(L3_ASSISTED, AutonomyCapability.REPLAN_WITHIN_APPROVED),
      relevantLearnings: [],
      maxTasks: 10,
    };
    const result = await replan(ctx, { knownToolNames: new Set(['web_search', 'crm_create_contact']) });

    // 4. The repaired plan is valid, not escalated, and swaps the agent.
    expect(result.escalated).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.repairType).toBe('REPLACE_AGENT');
    expect(result.autonomy?.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
    const repairedT2 = result.updatedPlan!.tasks.find((t) => t.id === 't_2');
    expect(repairedT2?.agentRole).toBe(AgentRole.WORKER_RESEARCH);
    expect(result.changedTaskIds).toContain('t_2');
    // The completed task's output is preserved — never re-executed.
    expect(result.retainedCompletedTaskIds).toContain('t_1');
  });
});

// ─── Scenario 2: plan failure → task split → success (LLM propose + validate) ─

describe('Phase 14 integration — plan failure → task split (LLM propose, symbolic validate)', () => {
  it('an LLM-proposed SPLIT_TASK plan is accepted only because it passes the symbolic validator', async () => {
    const t1 = task({ id: 't_1', agentRole: AgentRole.WORKER_RESEARCH, toolsRequired: ['web_search'], status: TaskStatus.COMPLETED });
    const tBig = task({ id: 't_big', agentRole: AgentRole.WORKER_CRM, toolsRequired: ['crm_create_contact'], status: TaskStatus.FAILED, dependsOn: ['t_1'] });
    const originalPlan = plan([t1, tBig]);

    const diag = await diagnoseFailure({
      failure: executionFailure({ taskId: 't_big', errorClass: FailureClass.PLAN_DEPENDENCY, message: 'task too large; dependency context missing' }),
      signal: { message: 'task too large; dependency context missing' },
      hint: { taskId: 't_big', agentRole: AgentRole.WORKER_CRM, inputHash: 'hash-big', failureClass: FailureClass.PLAN_DEPENDENCY, hypothesisSet: ['agent-only', 'tool-only', 'model-only'] },
      verifierIssues: [],
      tenantId: 'tenant-1',
      now: NOW,
    });

    // LLM proposes splitting the over-large task into a research sub-task + the original action.
    const splitPlan = plan([
      t1,
      task({ id: 't_big_a', agentRole: AgentRole.WORKER_RESEARCH, toolsRequired: ['web_search'], dependsOn: ['t_1'] }),
      task({ id: 't_big_b', agentRole: AgentRole.WORKER_CRM, toolsRequired: ['crm_create_contact'], dependsOn: ['t_big_a'] }),
    ]);

    const ctx: ReplanContext = {
      originalGoal: 'test goal',
      originalPlan,
      currentPlanVersion: 1,
      successfulTaskOutputs: { t_1: { result: 'done' } },
      completedExternalTaskIds: [],
      failedTask: tBig,
      verifierIssues: [],
      diagnosis: diag.diagnosis,
      permittedAgents: [AgentRole.WORKER_CRM, AgentRole.WORKER_RESEARCH],
      permittedTools: ['web_search', 'crm_create_contact'],
      budgetRemaining: { planRepairs: 1, executionRetries: 2, outputRepairs: 2, costUsd: 5, durationMs: 60000 },
      autonomy: evaluateForConfig(L3_ASSISTED, AutonomyCapability.REPLAN_WITHIN_APPROVED),
      relevantLearnings: [],
      maxTasks: 10,
    };
    const result = await replan(ctx, {
      knownToolNames: new Set(['web_search', 'crm_create_contact']),
      llmPropose: async () => ({
        repairType: 'SPLIT_TASK',
        updatedPlan: splitPlan,
        reason: 'split the over-large CRM task into research + action',
        expectedImprovement: 0.5,
      }),
    });

    expect(result.escalated).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.repairType).toBe('SPLIT_TASK');
    expect(result.changedTaskIds).toEqual(expect.arrayContaining(['t_big_a', 't_big_b']));
    expect(result.updatedPlan!.tasks.some((t) => t.id === 't_big')).toBe(false);
    expect(result.retainedCompletedTaskIds).toContain('t_1');
  });

  it('an LLM-proposed plan that violates the symbolic constraints is rejected (Innovation #3)', async () => {
    const tBig = task({ id: 't_big', agentRole: AgentRole.WORKER_CRM, toolsRequired: ['crm_create_contact'], status: TaskStatus.FAILED });
    const originalPlan = plan([tBig]);

    const diag = await diagnoseFailure({
      failure: executionFailure({ taskId: 't_big', errorClass: FailureClass.PLAN_DEPENDENCY, message: 'dependency missing' }),
      signal: { message: 'dependency missing' },
      hint: { taskId: 't_big', agentRole: AgentRole.WORKER_CRM, inputHash: 'h', failureClass: FailureClass.PLAN_DEPENDENCY, hypothesisSet: ['agent-only', 'tool-only', 'model-only'] },
      verifierIssues: [],
      tenantId: 'tenant-1',
      now: NOW,
    });

    // Malicious/negligent LLM: introduces a cycle (t_x depends on t_y, t_y depends on t_x).
    const cyclicPlan = plan([
      task({ id: 't_x', agentRole: AgentRole.WORKER_CRM, toolsRequired: ['crm_create_contact'], dependsOn: ['t_y'] }),
      task({ id: 't_y', agentRole: AgentRole.WORKER_CRM, toolsRequired: ['crm_create_contact'], dependsOn: ['t_x'] }),
    ]);

    const ctx: ReplanContext = {
      originalGoal: 'g',
      originalPlan,
      currentPlanVersion: 1,
      successfulTaskOutputs: {},
      completedExternalTaskIds: [],
      failedTask: tBig,
      verifierIssues: [],
      diagnosis: diag.diagnosis,
      permittedAgents: [AgentRole.WORKER_CRM],
      permittedTools: ['crm_create_contact'],
      budgetRemaining: { planRepairs: 1, executionRetries: 2, outputRepairs: 2, costUsd: 5, durationMs: 60000 },
      autonomy: evaluateForConfig(L3_ASSISTED, AutonomyCapability.REPLAN_WITHIN_APPROVED),
      relevantLearnings: [],
      maxTasks: 10,
    };
    const result = await replan(ctx, {
      knownToolNames: new Set(['crm_create_contact']),
      llmPropose: async () => ({ repairType: 'SPLIT_TASK', updatedPlan: cyclicPlan, reason: 'bad', expectedImprovement: 0.5 }),
    });

    expect(result.valid).toBe(false);
    expect(result.validationIssues.some((i) => i.code === 'CYCLE')).toBe(true);
  });
});

// ─── Scenario 3 + 4: learning extraction → gate → (promotion | quarantine) ──

function outcomeEvaluation(over: Pick<OutcomeEvaluation, 'verdict' | 'taskOutcomes'>): OutcomeEvaluation {
  return {
    workflowId: 'wf-1',
    tenantId: 'tenant-1',
    verdict: over.verdict,
    taskTotal: over.taskOutcomes.length,
    taskPassed: over.taskOutcomes.filter((t) => t.verdict === TaskVerdict.TASK_PASSED).length,
    taskFailed: over.taskOutcomes.filter((t) => t.verdict === TaskVerdict.TASK_FAILED).length,
    taskBlocked: over.taskOutcomes.filter((t) => t.verdict === TaskVerdict.TASK_BLOCKED).length,
    taskSkipped: over.taskOutcomes.filter((t) => t.verdict === TaskVerdict.TASK_SKIPPED).length,
    taskOutcomes: over.taskOutcomes,
    acceptanceResults: [],
    totalCostUsd: 0,
    durationMs: 0,
    counterfactualHints: [],
    summary: 'run',
  };
}

describe('Phase 14 integration — learning extraction → gate → promotion + future retrieval', () => {
  it('a verified-passed run yields a candidate that promotes once mutual information is measured', () => {
    const passed: TaskOutcome = { taskId: 'email_1', verdict: TaskVerdict.TASK_PASSED, verified: true, verificationConfidence: 0.9 };
    const candidates = extractLearnings({ outcome: outcomeEvaluation({ verdict: OutcomeVerdict.OUTCOME_SUCCESS, taskOutcomes: [passed] }), now: NOW, tenantId: 'tenant-1' });
    expect(candidates.length).toBeGreaterThan(0);
    const candidate = candidates[0];
    expect(candidate.kind).toBe(LearningKind.WORKFLOW);

    // A single observation never promotes on its own (MI = 0). Accumulate
    // across runs into a contingency with real correlation.
    const accumulated: ContingencyTable = { a: 30, b: 2, c: 5, d: 3 };
    const promotion = gateLearning({ key: candidate.key, contingency: accumulated });
    expect(promotion.promoted).toBe(true);
    expect(promotion.mutualInformation).toBeGreaterThanOrEqual(0.05);

    // Future retrieval: the promoted learning is available to a later replan.
    const relevantLearnings = [{ key: promotion.candidate.key, summary: 'config for email tasks passes verification', confidence: promotion.mutualInformation }];
    expect(relevantLearnings.some((l) => l.key === candidate.key)).toBe(true);
  });
});

describe('Phase 14 integration — negative learning (prompt injection) is quarantined, never promoted', () => {
  it('a PROMPT_INJECTION failure yields a POLICY candidate that the gate rejects (no present-successes)', () => {
    const failed: TaskOutcome = { taskId: 'chat_1', verdict: TaskVerdict.TASK_FAILED, verified: false, failureClass: FailureClass.PROMPT_INJECTION, error: 'jailbreak' };
    const candidates = extractLearnings({
      outcome: outcomeEvaluation({ verdict: OutcomeVerdict.OUTCOME_PARTIAL, taskOutcomes: [failed] }),
      diagnoses: {
        chat_1: {
          id: 'diag-1', tenantId: 'tenant-1', workflowId: 'wf-1', taskId: 'chat_1',
          failureClass: FailureClass.PROMPT_INJECTION, rootCause: 'jailbreak detected',
          evidence: {}, confidence: 1, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR,
          recommendedChanges: {}, createdAt: NOW,
        },
      },
      now: NOW, tenantId: 'tenant-1',
    });
    const candidate = candidates.find((c) => c.failureClass === FailureClass.PROMPT_INJECTION);
    expect(candidate).toBeDefined();
    expect(candidate?.kind).toBe(LearningKind.POLICY);

    // A failure-only learning accrues only present-failures (b); present-successes (a) stays 0.
    const accumulated: ContingencyTable = { a: 0, b: 12, c: 3, d: 5 };
    const promotion = gateLearning({ key: candidate!.key, contingency: accumulated });
    expect(promotion.promoted).toBe(false);
    expect(promotion.reason).toMatch(/present-successes|insufficient/i);

    // And the framework quarantines the injection at the action layer.
    const inj = runFailureInjection(FailureKind.PROMPT_INJECTION, defaultInjectionContext());
    expect(inj.classified?.quarantine).toBe(true);
    expect(inj.action).toBe('QUARANTINE');
  });
});

// ─── Scenario 5: approved spec → workflow → evidence → drift resolution ────

describe('Phase 14 integration — approved spec → workflow → evidence → drift resolution', () => {
  function approvedSpec(): AgentExecutableSpec {
    return {
      id: 'spec-1',
      tenantId: 'tenant-1',
      title: 'Send quarterly report',
      problemStatement: 'need to send a report',
      objective: 'send the quarterly report email',
      contextSummary: 'context',
      proposedApproach: 'compose + send',
      acceptanceCriteria: [
        { id: 'ac-1', description: 'report task verified-passed', kind: AcceptanceCriterionKind.TASK_VERIFIED, taskId: 'email_1' },
        { id: 'ac-2', description: 'no permission denials', kind: AcceptanceCriterionKind.NO_FAILURE_CLASS, failureClass: FailureClass.PERMISSION_DENIED },
      ],
      testPlan: {},
      agentTaskPlan: {
        tasks: [
          { id: 'email_1', name: 'send report', description: 'send the report', agentRole: AgentRole.WORKER_EMAIL, toolsRequired: ['send_email'] },
        ],
      },
      approvalGates: {},
      evidenceArtifactIds: [],
      evidenceEntityIds: [],
      status: 'approved',
      createdAt: NOW,
      updatedAt: NOW,
      approvedAt: NOW,
      approvedBy: 'reviewer-1',
    };
  }

  it('materialises an approved spec into a runnable plan with PENDING tasks', () => {
    const p = materializePlan({ spec: approvedSpec(), now: NOW });
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0].id).toBe('email_1');
    expect(p.tasks[0].status).toBe(TaskStatus.PENDING);
  });

  it('a non-approved spec is never materialised', () => {
    const spec = approvedSpec();
    spec.status = 'draft';
    expect(() => materializePlan({ spec, now: NOW })).toThrow();
  });

  it('a verifying run ⇒ MET; a drifted run ⇒ UNMET (drift detected, never faked as MET)', () => {
    const { criteria } = acceptanceCriteriaForSpec(approvedSpec());

    const goodEvidence: RunEvidence = {
      taskOutcomes: [{ taskId: 'email_1', verdict: TaskVerdict.TASK_PASSED, verified: true, verificationConfidence: 0.95 }],
      artifacts: [],
      metrics: {},
    };
    const goodResults = measureAcceptance(criteria, goodEvidence);
    expect(acceptanceVerdict(goodResults)).toBe(AcceptanceVerdict.MET);
    expect(goodResults.every((r) => r.wired)).toBe(true);

    // Drift: the task failed with a permission denial.
    const driftedEvidence: RunEvidence = {
      taskOutcomes: [{ taskId: 'email_1', verdict: TaskVerdict.TASK_FAILED, verified: false, failureClass: FailureClass.PERMISSION_DENIED }],
      artifacts: [],
      metrics: {},
    };
    const driftedResults = measureAcceptance(criteria, driftedEvidence);
    expect(acceptanceVerdict(driftedResults)).toBe(AcceptanceVerdict.UNMET);
    expect(driftedResults.some((r) => !r.satisfied)).toBe(true);
  });
});

// ─── Scenario 6: Shield unavailable / unverified → fail-closed ─────────────

describe('Phase 14 integration — Shield: signed verdicts + fail-closed on unavailable/unverified', () => {
  const { publicKeyPem, privateKeyPem } = generateShieldKeyPair();
  const subject: ShieldDecisionSubject = { kind: 'tool_call', tenantId: 'tenant-1', workflowId: 'wf-1', runId: 'run-1', requestHash: 'h1' };

  it('a BLOCK verdict is signed + verified; the agent must treat it as fail-closed', async () => {
    const client = new ShieldMcpClient({
      shieldId: 'shield-1',
      verificationKey: publicKeyPem,
      signingKey: privateKeyPem,
      verdictFor: () => ShieldDecisionVerdict.BLOCK,
    });
    const decision = await client.requestDecision(subject, SHIELD_NOW);
    expect(decision.verdict).toBe(ShieldDecisionVerdict.BLOCK);
    const verification = client.verify(decision, SHIELD_NOW);
    expect(verification.valid).toBe(true);
  });

  it('an APPROVE_REQUIRED verdict is signed (the agent cannot execute without a human)', async () => {
    const client = new ShieldMcpClient({
      shieldId: 'shield-1',
      verificationKey: publicKeyPem,
      signingKey: privateKeyPem,
      verdictFor: () => ShieldDecisionVerdict.APPROVE_REQUIRED,
    });
    const decision = await client.requestDecision(subject, SHIELD_NOW);
    expect(decision.verdict).toBe(ShieldDecisionVerdict.APPROVE_REQUIRED);
  });

  it('Shield unavailable (timeout) ⇒ fail-closed; the high-risk action is NOT executed', () => {
    const r = runFailureInjection(FailureKind.SHIELD_TIMEOUT, defaultInjectionContext({ shieldAvailable: false }));
    expect(r.shield.available).toBe(false);
    expect(r.shield.verdict).toBe('UNAVAILABLE');
    expect(r.action).toBe('FAIL_CLOSED_SHIELD');
  });

  it('Shield signature unverified ⇒ fail-closed', () => {
    const r = runFailureInjection(FailureKind.INVALID_SHIELD_SIGNATURE, defaultInjectionContext({ shieldSignatureValid: false }));
    expect(r.shield.verdict).toBe('UNVERIFIABLE');
    expect(r.action).toBe('FAIL_CLOSED_SHIELD');
  });
});

// ─── Scenario 7 + 8: versioned config — shadow → canary → promote | rollback ─

function draftConfig(): ConfigVersion {
  return createDraft({ id: 'cv-1', tenantId: 'tenant-1', kind: ConfigKind.TOOL_POLICY, version: 1, spec: { tool: 'send_email', maxRate: 100 }, now: NOW });
}

const goodMetrics: RolloutMetrics = { samples: 25, successRate: 0.95, failureRate: 0.05, safetyIncidentRate: 0 };
const baseline: RolloutMetrics = { samples: 100, successRate: 0.9, failureRate: 0.1, safetyIncidentRate: 0 };

describe('Phase 14 integration — prompt candidate → shadow → canary → promote', () => {
  it('walks the bounded lifecycle DRAFT→PROPOSED→SHADOW→CANARY→PROMOTED only on positive evidence', () => {
    let v = draftConfig();
    expect(v.status).toBe(ConfigVersionStatus.DRAFT);

    v = proposeVersion(v, NOW);
    expect(v.status).toBe(ConfigVersionStatus.PROPOSED);

    v = startShadow(v, NOW);
    expect(v.status).toBe(ConfigVersionStatus.SHADOW);

    // Shadow must ADVANCE only with enough samples + lift over baseline.
    const shadowEval = evaluateShadow(goodMetrics, baseline);
    expect(shadowEval.decision).toBe(PromotionDecision.ADVANCE);

    v = startCanary(v, NOW);
    expect(v.status).toBe(ConfigVersionStatus.CANARY);
    expect(v.rolloutPercent).toBe(1);

    // Ramp the canary up the ladder; each step requires ADVANCE.
    let ramps = 0;
    while (v.status === ConfigVersionStatus.CANARY && ramps < 10) {
      const ramp = rampCanary(v, goodMetrics, baseline, NOW);
      expect(ramp.decision).toBe(PromotionDecision.ADVANCE);
      v = ramp.nextVersion ?? v;
      ramps++;
    }
    expect(v.status).toBe(ConfigVersionStatus.PROMOTED);
    expect(v.rolloutPercent).toBe(100);
    expect(v.promotedAt).toBe(NOW);
  });

  it('insufficient shadow evidence ⇒ HOLD (never a fake advance)', () => {
    const thin: RolloutMetrics = { samples: 3, successRate: 0.95, failureRate: 0.05, safetyIncidentRate: 0 };
    const evalThin = evaluateShadow(thin, baseline);
    expect(evalThin.decision).toBe(PromotionDecision.HOLD);
    expect(evalThin.reasons.some((r) => r.includes('samples'))).toBe(true);
  });
});

describe('Phase 14 integration — bad candidate → rollback', () => {
  it('a safety-incident breach ⇒ ROLLBACK, and the version is retired', () => {
    let v = draftConfig();
    v = proposeVersion(v, NOW);
    v = startShadow(v, NOW);
    v = startCanary(v, NOW);

    const bad: RolloutMetrics = { samples: 25, successRate: 0.95, failureRate: 0.05, safetyIncidentRate: 0.5 };
    const evalBad = evaluateCanary(bad, baseline);
    expect(evalBad.decision).toBe(PromotionDecision.ROLLBACK);

    v = rollbackVersion(v, NOW, 'safety-incident rate breached zero-tolerance threshold');
    expect(v.status).toBe(ConfigVersionStatus.ROLLED_BACK);
    expect(v.rolloutPercent).toBe(0);
    expect(v.rolledBackAt).toBe(NOW);
  });
});

// ─── Scenario 9: code issue → branch → tests → draft PR (R5) ────────────────

describe('Phase 14 integration — code issue → isolated branch → draft PR (never auto-merge)', () => {
  it('a SAFE-area BUG_FIX creates an isolated branch + draft PR and stops at the human-owned terminal state', () => {
    const proposal = createProposal({
      id: 'cr-1',
      tenantId: 'tenant-1',
      kind: CodeRepairKind.BUG_FIX,
      targetFiles: ['apps/web/src/lib/utils.ts'],
      targetSymbol: 'formatDate',
      description: 'fix off-by-one in date formatting',
      patchDiff: '--- a/apps/web/src/lib/utils.ts\n+++ b/apps/web/src/lib/utils.ts\n@@\n-  return d.getDate();\n+  return d.getDate() + 1;\n',
      rationale: 'dates were one day behind; verifier reproduced the failure',
      risk: 'LOW',
      createdBy: 'hyperagent',
      now: NOW,
      failureDiagnosisId: 'diag-1',
    });

    // The branch is isolated + never a protected trunk.
    expect(proposal.branchName.startsWith('hyperagent/r5-')).toBe(true);
    expect(() => assertNotMain(proposal.branchName)).not.toThrow();

    // The gate classifies it NEEDS_REVIEW (human owns the merge) + structurally valid.
    const review = classifyRepair(proposal);
    expect(review.safety).toBe(CodeRepairSafetyClass.NEEDS_REVIEW);
    expect(review.valid).toBe(true);
    expect(validateProposal(proposal).valid).toBe(true);

    // Draft-PR metadata is produced.
    expect(draftPrTitle(proposal).length).toBeGreaterThan(0);
    expect(draftPrBody(proposal, review).length).toBeGreaterThan(0);

    // The agent NEVER auto-merges.
    expect(canAutoMerge()).toBe(false);

    // Walk the bounded lifecycle to the human-owned terminal state.
    let status = CodeRepairStatus.DRAFT;
    status = advanceRepair(status, CodeRepairStatus.BRANCH_CREATED);
    status = advanceRepair(status, CodeRepairStatus.PR_OPENED);
    status = advanceRepair(status, CodeRepairStatus.PR_DRAFT);
    expect(status).toBe(CodeRepairStatus.PR_DRAFT);

    // The agent may NOT advance PR_DRAFT any further toward merge.
    expect(() => advanceRepair(CodeRepairStatus.PR_DRAFT, CodeRepairStatus.MERGED)).toThrow(CodeRepairError);
  });

  it('a FORBIDDEN proposal (targets the Shield gateway) is blocked — no branch may be created', () => {
    const forbidden = createProposal({
      id: 'cr-2',
      tenantId: 'tenant-1',
      kind: CodeRepairKind.BUG_FIX,
      targetFiles: ['packages/security/src/shield-gateway/shield-mcp-client.ts'],
      targetSymbol: 'setShieldGateway',
      description: 'weaken the shield',
      patchDiff: 'diff',
      rationale: 'bypass',
      risk: 'LOW',
      createdBy: 'hyperagent',
      now: NOW,
    });
    const review = classifyRepair(forbidden);
    expect(review.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
    expect(review.valid).toBe(false);
    expect(review.blockReason).toMatch(/forbidden/);
  });
});

// ─── Cross-cutting: OBSERVE mode never acts; OFF is inert ───────────────────

describe('Phase 14 integration — autonomy mode boundaries hold end-to-end', () => {
  it('OBSERVE mode reports a retryable failure but never auto-retries it', () => {
    const r = runFailureInjection(
      FailureKind.PROVIDER_TIMEOUT,
      defaultInjectionContext({ config: { hyperAgentEnabled: true, hyperAgentMode: HyperAgentMode.OBSERVE, autonomyLevel: AutonomyLevel.L2 } }),
    );
    expect(r.action).toBe('OBSERVE_ONLY');
  });

  it('a REPLAN below L3 is approval-gated (the replanner respects autonomy)', async () => {
    const t = task({ id: 't_2', agentRole: AgentRole.WORKER_CRM, toolsRequired: ['crm_create_contact'], status: TaskStatus.FAILED });
    const diag = await diagnoseFailure({
      failure: executionFailure({ taskId: 't_2', errorClass: FailureClass.WRONG_TOOL, message: 'wrong tool' }),
      signal: { message: 'wrong tool used' },
      hint: { taskId: 't_2', agentRole: AgentRole.WORKER_CRM, inputHash: 'h', failureClass: FailureClass.WRONG_TOOL, hypothesisSet: ['agent-only', 'tool-only', 'model-only'] },
      verifierIssues: [],
      tenantId: 'tenant-1',
      now: NOW,
      reExecutor: reExecutorIsolating('tool-only'),
    });
    const ctx: ReplanContext = {
      originalGoal: 'g',
      originalPlan: plan([t]),
      currentPlanVersion: 1,
      successfulTaskOutputs: {},
      completedExternalTaskIds: [],
      failedTask: t,
      verifierIssues: [],
      diagnosis: diag.diagnosis,
      counterfactual: diag.counterfactual,
      permittedAgents: [AgentRole.WORKER_CRM, AgentRole.WORKER_RESEARCH],
      permittedTools: ['crm_create_contact', 'web_search'],
      toolAlternates: { crm_create_contact: ['web_search'] },
      budgetRemaining: { planRepairs: 1, executionRetries: 2, outputRepairs: 2, costUsd: 5, durationMs: 60000 },
      autonomy: evaluateForConfig({ hyperAgentEnabled: true, hyperAgentMode: HyperAgentMode.ASSISTED, autonomyLevel: AutonomyLevel.L2 }, AutonomyCapability.REPLAN_WITHIN_APPROVED),
      relevantLearnings: [],
      maxTasks: 10,
    };
    const result = await replan(ctx, { knownToolNames: new Set(['crm_create_contact', 'web_search']) });
    // At L2 the replan is approval-gated even when the plan is valid.
    expect(result.autonomy?.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });
});