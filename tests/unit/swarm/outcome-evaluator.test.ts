import { describe, it, expect } from 'vitest';
import {
  TaskStatus,
  OutcomeVerdict,
  TaskVerdict,
  FailureClass,
  AcceptanceCriterionKind,
} from '../../../packages/shared/src/index.js';
import type { WorkflowPlan, WorkflowTask, RunEvidence } from '../../../packages/shared/src/index.js';
import type { VerificationResult } from '../../../packages/agents/src/roles/verifier.agent.js';
import {
  evaluateOutcome,
  taskDefinitionHash,
  type OutcomeEvaluatorInput,
} from '../../../packages/swarm/src/hyperagent/outcome-evaluator.js';

function task(overrides: Partial<WorkflowTask> & { id: string }): WorkflowTask {
  return {
    id: overrides.id,
    name: overrides.name ?? `task-${overrides.id}`,
    description: overrides.description ?? 'does a thing',
    agentRole: overrides.agentRole ?? ('researcher' as unknown as WorkflowTask['agentRole']),
    toolsRequired: overrides.toolsRequired ?? [],
    riskLevel: overrides.riskLevel ?? ('LOW' as unknown as WorkflowTask['riskLevel']),
    requiresApproval: overrides.requiresApproval ?? false,
    status: overrides.status ?? TaskStatus.COMPLETED,
    dependsOn: overrides.dependsOn ?? [],
    retryable: overrides.retryable ?? true,
    maxRetries: overrides.maxRetries ?? 2,
  };
}

function plan(tasks: WorkflowTask[]): WorkflowPlan {
  return {
    id: 'plan-1',
    name: 'test-plan',
    goal: 'g',
    industry: 'general',
    tasks,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function baseInput(over: Partial<OutcomeEvaluatorInput> = {}): OutcomeEvaluatorInput {
  return {
    workflowId: 'wf-1',
    tenantId: 't-1',
    plan: plan([]),
    verificationResults: {},
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:01:00Z',
    ...over,
  };
}

const vPass = (confidence = 1): VerificationResult => ({ passed: true, issues: [], confidence, needsRetry: false });
const vFail = (issues = ['bad']): VerificationResult => ({ passed: false, issues, confidence: 0.4, needsRetry: true });

describe('outcome-evaluator — verdict logic', () => {
  it('all tasks completed + verified-passed → OUTCOME_SUCCESS', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' }), task({ id: 'b' })]),
      verificationResults: { a: vPass(), b: vPass(0.9) },
    }));
    expect(r.verdict).toBe(OutcomeVerdict.OUTCOME_SUCCESS);
    expect(r.taskPassed).toBe(2);
    expect(r.taskFailed).toBe(0);
    expect(r.taskBlocked).toBe(0);
  });

  it('completed with no verifier result → TASK_PASSED (accepted worker output)', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' })]),
      verificationResults: {},
    }));
    expect(r.verdict).toBe(OutcomeVerdict.OUTCOME_SUCCESS);
    expect(r.taskOutcomes[0].verified).toBe(false);
  });

  it('one passed, one verifier-failed → OUTCOME_PARTIAL', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' }), task({ id: 'b' })]),
      verificationResults: { a: vPass(), b: vFail() },
    }));
    expect(r.verdict).toBe(OutcomeVerdict.OUTCOME_PARTIAL);
    expect(r.taskPassed).toBe(1);
    expect(r.taskFailed).toBe(1);
    expect(r.taskOutcomes[1].verdict).toBe(TaskVerdict.TASK_FAILED);
    expect(r.taskOutcomes[1].verified).toBe(true);
  });

  it('all failed → OUTCOME_FAILED', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a', status: TaskStatus.FAILED }), task({ id: 'b' })]),
      verificationResults: { b: vFail() },
    }));
    expect(r.verdict).toBe(OutcomeVerdict.OUTCOME_FAILED);
    expect(r.taskPassed).toBe(0);
    expect(r.taskFailed).toBe(2);
  });

  it('run-level block → OUTCOME_BLOCKED regardless of task states', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' }), task({ id: 'b' })]),
      verificationResults: { a: vPass(), b: vPass() },
      blocked: true,
    }));
    expect(r.verdict).toBe(OutcomeVerdict.OUTCOME_BLOCKED);
  });

  it('a task still AWAITING_APPROVAL at run end → OUTCOME_BLOCKED', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' }), task({ id: 'b', status: TaskStatus.AWAITING_APPROVAL })]),
      verificationResults: { a: vPass() },
    }));
    expect(r.verdict).toBe(OutcomeVerdict.OUTCOME_BLOCKED);
    expect(r.taskBlocked).toBe(1);
  });

  it('SKIPPED tasks are excluded from the active denominator', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' }), task({ id: 'b', status: TaskStatus.SKIPPED })]),
      verificationResults: { a: vPass() },
    }));
    expect(r.verdict).toBe(OutcomeVerdict.OUTCOME_SUCCESS);
    expect(r.taskSkipped).toBe(1);
    expect(r.taskTotal).toBe(2);
  });

  it('incomplete task at run end with no block → TASK_FAILED', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a', status: TaskStatus.IN_PROGRESS })]),
      verificationResults: {},
    }));
    expect(r.verdict).toBe(OutcomeVerdict.OUTCOME_FAILED);
    expect(r.taskOutcomes[0].verdict).toBe(TaskVerdict.TASK_FAILED);
  });

  it('incomplete task at run end WITH block → TASK_BLOCKED', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a', status: TaskStatus.PENDING })]),
      verificationResults: {},
      blocked: true,
    }));
    expect(r.verdict).toBe(OutcomeVerdict.OUTCOME_BLOCKED);
    expect(r.taskOutcomes[0].verdict).toBe(TaskVerdict.TASK_BLOCKED);
  });
});

describe('outcome-evaluator — honest acceptance-criteria seam', () => {
  it('records criteria but never marks them satisfied (wired=false) until Phase 6', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' })]),
      verificationResults: { a: vPass() },
      acceptanceCriteria: ['must cite 3 sources', 'must be under 500 words'],
    }));
    expect(r.acceptanceResults).toHaveLength(2);
    for (const a of r.acceptanceResults) {
      expect(a.satisfied).toBe(false);
      expect(a.evidence).toBeNull();
      expect(a.wired).toBe(false);
    }
  });

  it('a successful run with unwired criteria is still SUCCESS, but criteria stay unsatisfied', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' })]),
      verificationResults: { a: vPass() },
      acceptanceCriteria: ['c1'],
    }));
    expect(r.verdict).toBe(OutcomeVerdict.OUTCOME_SUCCESS);
    expect(r.acceptanceResults[0].satisfied).toBe(false);
  });
});

describe('outcome-evaluator — Phase 6 wired acceptance seam', () => {
  it('measures structured criteria against run evidence (wired=true, real evidence)', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' })]),
      verificationResults: { a: vPass() },
      acceptanceCriteria: [
        { id: 'c1', description: 'task a passed', kind: AcceptanceCriterionKind.TASK_VERIFIED, taskId: 'a' },
        { id: 'c2', description: 'artifact present', kind: AcceptanceCriterionKind.ARTIFACT_PRESENT, artifactId: 'art-1' },
      ],
      acceptanceEvidence: { taskOutcomes: [], artifacts: ['art-1'], metrics: {} } as RunEvidence,
    }));
    // TASK_VERIFIED binds against the evaluator's own triage (a passed + verified).
    expect(r.acceptanceResults[0].wired).toBe(true);
    expect(r.acceptanceResults[0].satisfied).toBe(true);
    // ARTIFACT_PRESENT binds against the supplied artifact set.
    expect(r.acceptanceResults[1].wired).toBe(true);
    expect(r.acceptanceResults[1].satisfied).toBe(true);
  });

  it('reports an unsatisfied wired criterion when evidence does not meet it', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' })]),
      verificationResults: { a: vPass() },
      acceptanceCriteria: [
        { id: 'c1', description: 'artifact present', kind: AcceptanceCriterionKind.ARTIFACT_PRESENT, artifactId: 'missing' },
      ],
      acceptanceEvidence: { taskOutcomes: [], artifacts: [], metrics: {} } as RunEvidence,
    }));
    expect(r.acceptanceResults[0].wired).toBe(true);
    expect(r.acceptanceResults[0].satisfied).toBe(false);
  });

  it('keeps structured criteria unwired when no evidence is supplied (honest stub)', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' })]),
      verificationResults: { a: vPass() },
      acceptanceCriteria: [
        { id: 'c1', description: 'task a passed', kind: AcceptanceCriterionKind.TASK_VERIFIED, taskId: 'a' },
      ],
    }));
    expect(r.acceptanceResults[0].wired).toBe(false);
    expect(r.acceptanceResults[0].satisfied).toBe(false);
    expect(r.acceptanceResults[0].evidence).toBeNull();
  });

  it('keeps legacy string criteria unwired even when evidence is supplied', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' })]),
      verificationResults: { a: vPass() },
      acceptanceCriteria: ['must be well written'],
      acceptanceEvidence: { taskOutcomes: [], artifacts: [], metrics: {} } as RunEvidence,
    }));
    expect(r.acceptanceResults[0].wired).toBe(false);
    expect(r.acceptanceResults[0].satisfied).toBe(false);
  });
});

describe('outcome-evaluator — counterfactual replay hints (innovation #1)', () => {
  it('emits a hint for every failed task with the three single-variable hypotheses', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a', toolsRequired: ['search'] }), task({ id: 'b' })]),
      verificationResults: { a: vFail(), b: vPass() },
      failureClassByTask: { a: FailureClass.GROUNDING_FAILURE },
    }));
    expect(r.counterfactualHints).toHaveLength(1);
    const h = r.counterfactualHints[0];
    expect(h.taskId).toBe('a');
    expect(h.failureClass).toBe(FailureClass.GROUNDING_FAILURE);
    expect(h.toolName).toBe('search');
    expect([...h.hypothesisSet]).toEqual(['agent-only', 'tool-only', 'model-only']);
    expect(h.inputHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('emits no hints when all tasks pass', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' })]),
      verificationResults: { a: vPass() },
    }));
    expect(r.counterfactualHints).toEqual([]);
  });

  it('taskDefinitionHash is deterministic for the same definition', () => {
    const t = task({ id: 'a', toolsRequired: ['x'], description: 'd' });
    expect(taskDefinitionHash(t)).toBe(taskDefinitionHash(t));
    const t2 = task({ id: 'a', toolsRequired: ['x'], description: 'd' });
    expect(taskDefinitionHash(t)).toBe(taskDefinitionHash(t2));
    const t3 = task({ id: 'a', toolsRequired: ['y'], description: 'd' });
    expect(taskDefinitionHash(t)).not.toBe(taskDefinitionHash(t3));
  });
});

describe('outcome-evaluator — cost + duration', () => {
  it('computes duration from started/completed and surfaces accumulated cost', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' })]),
      verificationResults: { a: vPass() },
      accumulatedCostUsd: 0.42,
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:02:30Z', // 150000ms
    }));
    expect(r.durationMs).toBe(150_000);
    expect(r.totalCostUsd).toBe(0.42);
  });

  it('clamps negative duration to zero (clock skew safety)', () => {
    const r = evaluateOutcome(baseInput({
      plan: plan([task({ id: 'a' })]),
      verificationResults: { a: vPass() },
      startedAt: '2026-01-01T00:02:00Z',
      completedAt: '2026-01-01T00:00:00Z',
    }));
    expect(r.durationMs).toBe(0);
  });
});