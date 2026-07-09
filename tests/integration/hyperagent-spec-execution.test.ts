/**
 * hyperagent-spec-execution.test.ts — HyperAgent Phase 6 closed-loop proof.
 *
 * Drives the REAL `executeApprovedSpec` orchestration (guard → materialise →
 * run → harvest → measure → verdict) end-to-end with the agent/LLM layer
 * stubbed via a deterministic `runPlan`. This proves the closed-loop LOGIC:
 *
 *   - the REAL `materializePlan` guard (SpecNotApprovedError / SpecPlanValidationError);
 *   - the REAL `evaluateOutcome` harvester (triages taskOutcomes from the
 *     finished plan + verificationResults + failureClassByTask);
 *   - the REAL `measureAcceptanceSeam` + `checkCriterion` (binds every
 *     structured criterion kind to runtime evidence — wired=true, never faked);
 *   - the REAL `acceptanceVerdict` reducer (MET / UNMET / UNVERIFIABLE);
 *   - the REAL `resolvedDrift` reporting (driftFindingId + resolved=MET).
 *
 * What is stubbed (and why that's honest):
 *   - `runPlan` returns a deterministic `FinishedRun` for each scenario. The
 *     REAL `runPlanViaLangGraph` (production) drives the spec-execution graph
 *     and is env-blocked at every agent call (GuardrailAgent / worker /
 *     VerifierAgent / validator) — wired-into-runtime, NOT production-proven
 *     here. The closed-loop LOGIC that consumes the run is what this test proves.
 *
 * Honest framing: integration-logic-proven, NOT production-proven (the live
 * LangGraph + LLM E2E is env-blocked).
 */
import { describe, it, expect } from 'vitest';
import {
  AgentRole,
  AcceptanceCriterionKind,
  AcceptanceVerdict,
  FailureClass,
  RiskLevel,
  TaskStatus,
} from '../../packages/shared/src/index.js';
import type {
  AcceptanceCriterion,
  AgentExecutableSpec,
  FailureClass as FailureClassType,
  SpecTaskDescriptor,
  WorkflowPlan,
  WorkflowTask,
} from '../../packages/shared/src/index.js';
import type { VerificationResult } from '../../packages/agents/src/index.js';
import {
  executeApprovedSpec,
  SpecNotApprovedError,
  SpecPlanValidationError,
  type FinishedRun,
  type RunPlanInput,
} from '../../packages/swarm/src/hyperagent/spec-executor.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

// ─── Spec / task builders ───────────────────────────────────────────────────

function desc(over: Partial<SpecTaskDescriptor> & { id: string }): SpecTaskDescriptor {
  return {
    id: over.id,
    name: `task-${over.id}`,
    description: 'd',
    agentRole: AgentRole.WORKER_RESEARCH,
    toolsRequired: ['web_search'],
    riskLevel: RiskLevel.LOW,
    dependsOn: [],
    requiresApproval: false,
    retryable: true,
    maxRetries: 2,
    ...over,
  } as SpecTaskDescriptor;
}

function spec(over: Partial<AgentExecutableSpec> & { tasks: SpecTaskDescriptor[] }): AgentExecutableSpec {
  const { tasks, ...rest } = over;
  return {
    id: 'spec-1',
    tenantId: 't1',
    driftFindingId: 'drift-9',
    title: 'Ship feature X',
    problemStatement: 'p',
    objective: 'o',
    contextSummary: 'c',
    proposedApproach: 'a',
    acceptanceCriteria: [],
    testPlan: {},
    agentTaskPlan: { tasks },
    approvalGates: {},
    evidenceArtifactIds: ['art-1'],
    evidenceEntityIds: [],
    status: 'approved',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
    approvedBy: 'rev',
    ...rest,
  } as AgentExecutableSpec;
}

function criterion(over: Partial<AcceptanceCriterion> & { id: string }): AcceptanceCriterion {
  return {
    id: over.id,
    description: `criterion-${over.id}`,
    kind: AcceptanceCriterionKind.TASK_COMPLETED,
    ...over,
  } as AcceptanceCriterion;
}

// ─── Stub runPlan — builds a deterministic FinishedRun from a scenario ─────────

interface Scenario {
  /** Terminal task status per task id (default COMPLETED). */
  taskStatus?: Record<string, TaskStatus>;
  /** Verifier passed per task id (default true). */
  verified?: Record<string, boolean>;
  /** Artifacts the run produced/referenced. */
  artifacts?: string[];
  /** Named metrics the run reported. */
  metrics?: Record<string, number>;
  /** Pre-classified failure class per failed task. */
  failureClassByTask?: Record<string, FailureClassType>;
}

function stubRunPlan(scenario: Scenario = {}) {
  return async (input: RunPlanInput): Promise<FinishedRun> => {
    const plan: WorkflowPlan = {
      ...input.plan,
      tasks: input.plan.tasks.map((t) => {
        const status = scenario.taskStatus?.[t.id] ?? TaskStatus.COMPLETED;
        return {
          ...t,
          status,
          ...(status === TaskStatus.FAILED ? { error: 'task failed' } : {}),
        } satisfies WorkflowTask;
      }),
    };
    const verificationResults: Record<string, VerificationResult> = {};
    for (const t of input.plan.tasks) {
      const verified = scenario.verified?.[t.id] ?? true;
      verificationResults[t.id] = verified
        ? { passed: true, issues: [], confidence: 0.9, needsRetry: false }
        : { passed: false, issues: ['verification failed'], confidence: 0.3, needsRetry: false };
    }
    const completedTaskIds = plan.tasks.filter((t) => t.status === TaskStatus.COMPLETED).map((t) => t.id);
    const failedTaskIds = plan.tasks.filter((t) => t.status === TaskStatus.FAILED).map((t) => t.id);
    return {
      plan,
      verificationResults,
      completedTaskIds,
      failedTaskIds,
      blocked: false,
      artifacts: scenario.artifacts ?? [],
      metrics: scenario.metrics ?? {},
      ...(scenario.failureClassByTask ? { failureClassByTask: scenario.failureClassByTask } : {}),
      startedAt: input.now,
      completedAt: input.now,
    };
  };
}

async function run(spec_: AgentExecutableSpec, scenario: Scenario = {}) {
  return executeApprovedSpec({
    spec: spec_,
    tenantId: 't1',
    userId: 'u1',
    now: NOW,
    deps: { runPlan: stubRunPlan(scenario) },
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Phase 6 — executeApprovedSpec closed loop (integration)', () => {
  it('MET: a TASK_COMPLETED criterion is satisfied when the task passes', async () => {
    const s = spec({
      tasks: [desc({ id: 't1' })],
      acceptanceCriteria: [criterion({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 't1' })],
    });
    const r = await run(s, { taskStatus: { t1: TaskStatus.COMPLETED }, verified: { t1: true } });
    expect(r.verdict).toBe(AcceptanceVerdict.MET);
    expect(r.acceptanceResults[0].wired).toBe(true);
    expect(r.acceptanceResults[0].satisfied).toBe(true);
    expect(r.outcome.taskPassed).toBe(1);
    expect(r.resolvedDrift).toEqual({ driftFindingId: 'drift-9', resolved: true });
  });

  it('MET: a TASK_VERIFIED criterion requires verifier-passed AND task passed', async () => {
    const s = spec({
      tasks: [desc({ id: 't1' })],
      acceptanceCriteria: [criterion({ id: 'c1', kind: AcceptanceCriterionKind.TASK_VERIFIED, taskId: 't1' })],
    });
    const r = await run(s, { taskStatus: { t1: TaskStatus.COMPLETED }, verified: { t1: true } });
    expect(r.verdict).toBe(AcceptanceVerdict.MET);
    // Verifier ran but failed → the task is TASK_FAILED (not verified-passed).
    const r2 = await run(s, { taskStatus: { t1: TaskStatus.COMPLETED }, verified: { t1: false } });
    expect(r2.verdict).toBe(AcceptanceVerdict.UNMET);
  });

  it('UNMET: a TASK_COMPLETED criterion is unsatisfied when the task fails', async () => {
    const s = spec({
      tasks: [desc({ id: 't1' })],
      acceptanceCriteria: [criterion({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 't1' })],
    });
    const r = await run(s, { taskStatus: { t1: TaskStatus.FAILED }, verified: { t1: false } });
    expect(r.verdict).toBe(AcceptanceVerdict.UNMET);
    expect(r.acceptanceResults[0].wired).toBe(true);
    expect(r.acceptanceResults[0].satisfied).toBe(false);
    expect(r.resolvedDrift.resolved).toBe(false);
  });

  it('MET/UNMET: an ARTIFACT_PRESENT criterion binds to the run\'s harvested artifacts', async () => {
    const s = spec({
      tasks: [desc({ id: 't1' })],
      acceptanceCriteria: [criterion({ id: 'c1', kind: AcceptanceCriterionKind.ARTIFACT_PRESENT, artifactId: 'art-1' })],
    });
    const met = await run(s, { artifacts: ['art-1'] });
    expect(met.verdict).toBe(AcceptanceVerdict.MET);
    const unmet = await run(s, { artifacts: [] });
    expect(unmet.verdict).toBe(AcceptanceVerdict.UNMET);
    // Honest open edge: the real graph does not harvest artifact ids, so an
    // ARTIFACT_PRESENT criterion is UNMET unless the run produces the artifact.
  });

  it('MET/UNMET: a METRIC_THRESHOLD criterion binds to the run\'s metrics', async () => {
    const s = spec({
      tasks: [desc({ id: 't1' })],
      acceptanceCriteria: [
        criterion({
          id: 'c1',
          kind: AcceptanceCriterionKind.METRIC_THRESHOLD,
          metric: { name: 'costUsd', operator: 'lte', threshold: 1 },
        }),
      ],
    });
    const met = await run(s, { metrics: { costUsd: 0.5 } });
    expect(met.verdict).toBe(AcceptanceVerdict.MET);
    const unmet = await run(s, { metrics: { costUsd: 2 } });
    expect(unmet.verdict).toBe(AcceptanceVerdict.UNMET);
  });

  it('MET/UNMET: a NO_FAILURE_CLASS criterion binds to classified failures', async () => {
    const s = spec({
      tasks: [desc({ id: 't1' })],
      acceptanceCriteria: [
        criterion({ id: 'c1', kind: AcceptanceCriterionKind.NO_FAILURE_CLASS, failureClass: FailureClass.HALLUCINATION }),
      ],
    });
    // No HALLUCINATION failure → satisfied.
    const met = await run(s, { taskStatus: { t1: TaskStatus.FAILED }, failureClassByTask: { t1: FailureClass.GROUNDING_FAILURE } });
    expect(met.verdict).toBe(AcceptanceVerdict.MET);
    // A HALLUCINATION failure → unsatisfied.
    const unmet = await run(s, { taskStatus: { t1: TaskStatus.FAILED }, failureClassByTask: { t1: FailureClass.HALLUCINATION } });
    expect(unmet.verdict).toBe(AcceptanceVerdict.UNMET);
  });

  it('UNVERIFIABLE: a CUSTOM criterion has no deterministic binding (a human must sign off)', async () => {
    const s = spec({
      tasks: [desc({ id: 't1' })],
      acceptanceCriteria: [criterion({ id: 'c1', kind: AcceptanceCriterionKind.CUSTOM })],
    });
    const r = await run(s, { taskStatus: { t1: TaskStatus.COMPLETED }, verified: { t1: true } });
    expect(r.verdict).toBe(AcceptanceVerdict.UNVERIFIABLE);
    expect(r.acceptanceResults[0].wired).toBe(false);
    expect(r.acceptanceResults[0].satisfied).toBe(false);
    expect(r.resolvedDrift.resolved).toBe(false);
  });

  it('UNVERIFIABLE: legacy plain-string criteria (no structured binding) stay UNVERIFIABLE', async () => {
    const s = spec({
      tasks: [desc({ id: 't1' })],
      acceptanceCriteria: ['the output reads well to a human'],
    });
    const r = await run(s, { taskStatus: { t1: TaskStatus.COMPLETED }, verified: { t1: true } });
    expect(r.verdict).toBe(AcceptanceVerdict.UNVERIFIABLE);
    expect(r.acceptanceResults[0].wired).toBe(false);
  });

  it('MET: multiple wired criteria all satisfied → MET', async () => {
    const s = spec({
      tasks: [desc({ id: 't1' }), desc({ id: 't2', dependsOn: ['t1'] })],
      acceptanceCriteria: [
        criterion({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 't1' }),
        criterion({ id: 'c2', kind: AcceptanceCriterionKind.TASK_VERIFIED, taskId: 't2' }),
        criterion({ id: 'c3', kind: AcceptanceCriterionKind.ARTIFACT_PRESENT, artifactId: 'art-1' }),
      ],
    });
    const r = await run(s, {
      taskStatus: { t1: TaskStatus.COMPLETED, t2: TaskStatus.COMPLETED },
      verified: { t1: true, t2: true },
      artifacts: ['art-1'],
    });
    expect(r.verdict).toBe(AcceptanceVerdict.MET);
    expect(r.acceptanceResults).toHaveLength(3);
    expect(r.acceptanceResults.every((a) => a.satisfied)).toBe(true);
  });

  it('throws SpecNotApprovedError for a draft spec (never silently runs an unapproved spec)', async () => {
    const s = spec({ tasks: [desc({ id: 't1' })], status: 'draft' });
    await expect(run(s)).rejects.toBeInstanceOf(SpecNotApprovedError);
  });

  it('throws SpecNotApprovedError for a rejected spec', async () => {
    const s = spec({ tasks: [desc({ id: 't1' })], status: 'rejected' });
    await expect(run(s)).rejects.toBeInstanceOf(SpecNotApprovedError);
  });

  it('throws SpecPlanValidationError for a spec with no tasks (a bad spec never reaches the runner)', async () => {
    const s = spec({ tasks: [] as SpecTaskDescriptor[] });
    await expect(run(s)).rejects.toBeInstanceOf(SpecPlanValidationError);
  });

  it('throws SpecPlanValidationError for a cyclic plan', async () => {
    const cyclic = [desc({ id: 'a', dependsOn: ['b'] }), desc({ id: 'b', dependsOn: ['a'] })];
    const s = spec({ tasks: cyclic });
    await expect(run(s)).rejects.toBeInstanceOf(SpecPlanValidationError);
  });

  it('the verdict + workflow id are deterministic given the spec + run', async () => {
    const s = spec({
      tasks: [desc({ id: 't1' })],
      acceptanceCriteria: [criterion({ id: 'c1', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 't1' })],
    });
    const a = await run(s, { taskStatus: { t1: TaskStatus.COMPLETED }, verified: { t1: true } });
    const b = await run(s, { taskStatus: { t1: TaskStatus.COMPLETED }, verified: { t1: true } });
    expect(a.workflowId).toBe('wf_spec_spec-1');
    expect(a.verdict).toBe(b.verdict);
    expect(a.acceptanceResults).toEqual(b.acceptanceResults);
  });
});