/**
 * r2-correct-output-routing.test.ts — HyperAgent Phase 5 unit proof.
 *
 * Pins the `decideVerifierRouting` decision matrix for the R2 CORRECT_OUTPUT
 * typed-correction path. The pure edge function is the single source of truth
 * both `afterVerifier` and the verifier wrapper (`wrapVerifierNode`) read, so
 * the routing decision and the counter-bumping decision can never disagree —
 * the same property the legacy R1/R2 loop has after its unification on
 * `taskRetryCount` + `MAX_TASK_RETRIES`.
 *
 * Matrix pinned (the spec contract for R2):
 *   - L0 / HyperAgent OFF + malformed failure → legacy same-input retry
 *     (default workflows byte-for-byte unchanged; the typed path is inert).
 *   - L2+ / HyperAgent ON + malformed failure + budget → typed correction.
 *   - L2+ / typed budget exhausted → escalate to R3 diagnosis (NOT another
 *     blind legacy retry — a guided correction already failed).
 *   - L1 / HyperAgent ON + malformed → legacy retry (CORRECT_OUTPUT needs L2).
 *   - L2+ / non-malformed failure (no correction) → legacy retry (unchanged).
 *   - L2+ / typed correction is INDEPENDENT of taskRetryCount: a task that has
 *     burned 2 legacy retries still gets 2 typed corrections for a malformed
 *     failure (and vice versa) — distinct counters, shared ceiling.
 *
 * The full worker↔verifier loop (real LLM, real worker agent) is env-blocked
 * and exercised at the integration level by hyperagent-r2-correct-output.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentRole,
  AutonomyLevel,
  FailureClass,
  HyperAgentMode,
  RiskLevel,
  TaskStatus,
  WorkflowStatus,
} from '../../../packages/shared/src/index.js';
import type { WorkflowPlan, WorkflowTask, OutputCorrection, RepairBudget } from '../../../packages/shared/src/index.js';
import type { VerificationResult } from '../../../packages/agents/src/roles/verifier.agent.js';
import { createInitialSwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import type { SwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import { decideVerifierRouting, MAX_TASK_RETRIES } from '../../../packages/swarm/src/graph/edges.js';

function task(id: string): WorkflowTask {
  return {
    id,
    name: `task-${id}`,
    description: 'do it',
    agentRole: AgentRole.WORKER_RESEARCH,
    toolsRequired: ['web_search'],
    riskLevel: RiskLevel.LOW,
    requiresApproval: false,
    status: TaskStatus.PENDING,
    dependsOn: [],
    retryable: true,
    maxRetries: 2,
  };
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

const vFailMalformed = (): VerificationResult => ({
  passed: false,
  issues: ['Output failed schema validation: expected object, got string'],
  confidence: 0.3,
  needsRetry: true,
  retryReason: 'malformed output',
});

const vFailNonMalformed = (): VerificationResult => ({
  passed: false,
  issues: ['no citations found for claims'],
  confidence: 0.3,
  needsRetry: true,
  retryReason: 'grounding failure',
});

function correction(taskId: string): OutputCorrection {
  return {
    taskId,
    failureClass: FailureClass.OUTPUT_SCHEMA,
    issues: ['Output failed schema validation: expected object, got string'],
    correctionPrompt: 'Produce a well-formed JSON object matching the expected schema.',
  };
}

const FULL_BUDGET: RepairBudget = {
  maxExecutionRetries: 2,
  maxOutputRepairs: 2,
  maxPlanRepairs: 1,
  maxCapabilityRepairs: 1,
  maxTotalCostUsd: 100,
  maxDurationMs: 100_000,
};

interface BuildOpts {
  hyperAgentEnabled?: boolean;
  hyperAgentMode?: HyperAgentMode;
  autonomyLevel?: AutonomyLevel;
  result?: VerificationResult;
  outputCorrection?: OutputCorrection | undefined;
  taskRetryCount?: number;
  outputRepairAttempts?: number;
  repairBudget?: RepairBudget;
  hyperAgentIteration?: number;
  maxHyperAgentIterations?: number;
  moreTasks?: boolean;
}

function buildState(opts: BuildOpts = {}): SwarmState {
  const taskId = 'fail';
  const tasks = opts.moreTasks ? [task(taskId), task('next')] : [task(taskId)];
  const base = createInitialSwarmState({
    goal: 'g',
    tenantId: 't-1',
    userId: 'u-1',
    workflowId: 'wf-1',
    hyperAgentEnabled: opts.hyperAgentEnabled ?? true,
    hyperAgentMode: opts.hyperAgentMode ?? HyperAgentMode.ASSISTED,
    autonomyLevel: opts.autonomyLevel ?? AutonomyLevel.L2,
    repairBudget: opts.repairBudget ?? FULL_BUDGET,
    maxHyperAgentIterations: opts.maxHyperAgentIterations ?? 3,
  });
  return {
    ...base,
    plan: plan(tasks),
    currentTaskIndex: 0,
    verificationResults: { [taskId]: opts.result ?? vFailMalformed() },
    taskResults: { [taskId]: { partial: true } },
    taskRetryCount: opts.taskRetryCount ? { [taskId]: opts.taskRetryCount } : {},
    taskRepairState: opts.outputRepairAttempts
      ? { [taskId]: { taskId, executionAttempts: 0, outputRepairAttempts: opts.outputRepairAttempts, planRepairAttempts: 0, capabilityRepairAttempts: 0, exhausted: false } }
      : {},
    outputCorrection: opts.outputCorrection,
    status: WorkflowStatus.VERIFYING,
    hyperAgentIteration: opts.hyperAgentIteration ?? 0,
  } as SwarmState;
}

describe('Phase 5 — decideVerifierRouting R2 CORRECT_OUTPUT matrix', () => {
  it('L0 / HyperAgent OFF + malformed failure → legacy same-input retry (default unchanged)', () => {
    // The typed path is inert at L0/OFF: the autonomy gate returns false, so
    // the function falls straight to the legacy retry block.
    const s = buildState({
      hyperAgentEnabled: false,
      hyperAgentMode: HyperAgentMode.OFF,
      autonomyLevel: AutonomyLevel.L0,
      outputCorrection: correction('fail'),
      taskRetryCount: 0,
    });
    const d = decideVerifierRouting(s);
    expect(d.next).toBe('worker');
    expect(d.reason).toBe('legacy-retry');
  });

  it('L2 / HyperAgent ON + malformed failure + budget → typed correction', () => {
    const s = buildState({
      autonomyLevel: AutonomyLevel.L2,
      outputCorrection: correction('fail'),
      outputRepairAttempts: 0,
    });
    const d = decideVerifierRouting(s);
    expect(d.next).toBe('worker');
    expect(d.reason).toBe('typed-correction');
  });

  it('L2 / typed budget exhausted → escalate to R3 diagnosis (NOT legacy retry)', () => {
    // A guided correction already failed twice; re-sending identical input
    // would burn budget without new information. Escalate to plan repair.
    const s = buildState({
      autonomyLevel: AutonomyLevel.L2,
      outputCorrection: correction('fail'),
      outputRepairAttempts: FULL_BUDGET.maxOutputRepairs, // 2 → exhausted
      taskRetryCount: 0, // legacy budget still has room — must be SKIPPED
    });
    const d = decideVerifierRouting(s);
    expect(d.next).toBe('diagnosis');
    expect(d.reason).toBe('diagnosis');
  });

  it('L2 / typed exhausted + HyperAgent iteration budget also exhausted → next task (no diagnosis)', () => {
    // Both budgets gone → no diagnosis; advance to the next task.
    const s = buildState({
      autonomyLevel: AutonomyLevel.L2,
      outputCorrection: correction('fail'),
      outputRepairAttempts: FULL_BUDGET.maxOutputRepairs,
      hyperAgentIteration: 3,
      maxHyperAgentIterations: 3,
      moreTasks: true,
    });
    const d = decideVerifierRouting(s);
    expect(d.next).toBe('guardrail');
    expect(d.reason).toBe('next-task');
  });

  it('L1 / HyperAgent ON + malformed failure → legacy retry (CORRECT_OUTPUT requires L2)', () => {
    // L1 can PROPOSE repairs but cannot CORRECT_OUTPUT autonomously, so the
    // typed path is not allowed → fall through to the legacy same-input retry.
    const s = buildState({
      autonomyLevel: AutonomyLevel.L1,
      outputCorrection: correction('fail'),
      taskRetryCount: 0,
    });
    const d = decideVerifierRouting(s);
    expect(d.next).toBe('worker');
    expect(d.reason).toBe('legacy-retry');
  });

  it('L2 / non-malformed failure (no correction) → legacy retry (unchanged)', () => {
    // A grounding failure is not malformed-output, so no outputCorrection is
    // emitted. The typed block is skipped; the legacy retry runs.
    const s = buildState({
      autonomyLevel: AutonomyLevel.L2,
      result: vFailNonMalformed(),
      outputCorrection: undefined,
      taskRetryCount: 0,
    });
    const d = decideVerifierRouting(s);
    expect(d.next).toBe('worker');
    expect(d.reason).toBe('legacy-retry');
  });

  it('L2 / typed correction is INDEPENDENT of taskRetryCount (distinct counters)', () => {
    // A task that already burned 2 LEGACY retries still gets typed corrections
    // for a malformed failure — the two counters are distinct. The typed path
    // fires because outputRepairAttempts (0) < maxOutputRepairs (2).
    const s = buildState({
      autonomyLevel: AutonomyLevel.L2,
      outputCorrection: correction('fail'),
      taskRetryCount: MAX_TASK_RETRIES, // legacy exhausted
      outputRepairAttempts: 0, // typed budget fresh
    });
    const d = decideVerifierRouting(s);
    expect(d.next).toBe('worker');
    expect(d.reason).toBe('typed-correction');
  });

  it('L0 / OFF + needsRetry=false (final) + more tasks → next task (guardrail)', () => {
    // Default workflow, retries exhausted, more tasks remain → advance. The
    // typed/diagnosis paths are unreachable (HyperAgent OFF).
    const s = buildState({
      hyperAgentEnabled: false,
      hyperAgentMode: HyperAgentMode.OFF,
      autonomyLevel: AutonomyLevel.L0,
      result: { ...vFailMalformed(), needsRetry: false },
      outputCorrection: undefined,
      taskRetryCount: MAX_TASK_RETRIES,
      moreTasks: true,
    });
    const d = decideVerifierRouting(s);
    expect(d.next).toBe('guardrail');
    expect(d.reason).toBe('next-task');
  });

  it('L2 / maxOutputRepairs configured above MAX_TASK_RETRIES is capped at the shared ceiling', () => {
    // Belt-and-braces: even if a tenant config asks for maxOutputRepairs=10,
    // the typed loop can never spin past MAX_TASK_RETRIES=2. With
    // outputRepairAttempts=2 (== cap), the typed path is exhausted → diagnosis.
    const s = buildState({
      autonomyLevel: AutonomyLevel.L2,
      outputCorrection: correction('fail'),
      outputRepairAttempts: 2,
      repairBudget: { ...FULL_BUDGET, maxOutputRepairs: 10 },
    });
    const d = decideVerifierRouting(s);
    // 2 >= min(10, MAX_TASK_RETRIES=2) → exhausted → diagnosis.
    expect(d.next).toBe('diagnosis');
    expect(d.reason).toBe('diagnosis');
  });

  it('a stale outputCorrection for a DIFFERENT task is ignored (taskId guard)', () => {
    // If a correction lingers from a prior task (not cleared), it must NOT
    // drive a typed-correction retry for the current task.
    const s = buildState({
      autonomyLevel: AutonomyLevel.L2,
      outputCorrection: correction('other-task'), // different taskId
      taskRetryCount: 0,
    });
    const d = decideVerifierRouting(s);
    expect(d.next).toBe('worker');
    expect(d.reason).toBe('legacy-retry');
  });
});