/**
 * hyperagent-r2-correct-output.test.ts — HyperAgent Phase 5 integration proof.
 *
 * Drives the REAL worker node + REAL verifier node + REAL `decideVerifierRouting`
 * edge + the counter-bump logic from `wrapVerifierNode`, around the R2
 * CORRECT_OUTPUT loop, with the agent layer mocked (no LLM). This proves the
 * live-graph wiring end-to-end at the node/edge level:
 *
 *   - At L2 (HyperAgent ON): a malformed-output task is re-run with the typed
 *     correction threaded into the worker's input, the R2 budget
 *     (`outputRepairAttempts`) is bumped (NOT `taskRetryCount`), and the task
 *     passes within the budget WITHOUT escalating to R3 diagnosis.
 *   - At L0 (HyperAgent OFF): the SAME malformed failure runs the LEGACY
 *     same-input retry path — `taskRetryCount` bumps, `outputRepairAttempts`
 *     stays 0, and the typed correction is never applied. Default unchanged.
 *
 * What is exercised against the REAL code (no stubs for these):
 *   - the real `workerNode` (reads `state.outputCorrection`, threads it into
 *     the next pass's task description via the `taskForInput` seam);
 *   - the real `verifierNode` (builds the `outputCorrection` via the real
 *     `classifyFailure` + emits it; clears it on pass);
 *   - the real `decideVerifierRouting` (autonomy-gated typed vs legacy routing);
 *   - the real counter-bump logic (replicated from `wrapVerifierNode` — the
 *     reason drives which counter increments).
 *
 * What is stubbed (and why that's honest):
 *   - `createWorkerAgent` returns a deterministic agent that produces a
 *     malformed string when no correction is present in its input and a
 *     well-formed object when the correction marker is present. This is the
 *     exact contract the typed correction relies on: the worker sees the
 *     correction and fixes its output shape.
 *   - `VerifierAgent.execute` returns pass/fail from the output shape (string
 *     → malformed-output fail with schema issues; object → pass). This is the
 *     real VerifierAgent's job; the LLM judgment is env-blocked here.
 *
 * Honest framing: integration-node-graph-proven, NOT production-proven (the
 * full LangGraph orchestration + live LLM E2E is env-blocked; the loop here is
 * driven manually so the real node/edge/counter functions are exercised
 * without the commander/planner/router LLM dependency).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AgentRole,
  AutonomyLevel,
  HyperAgentMode,
  RiskLevel,
  TaskStatus,
  WorkflowStatus,
} from '../../packages/shared/src/index.js';
import type { WorkflowPlan, WorkflowTask, RepairBudget } from '../../packages/shared/src/index.js';
import type { VerificationResult } from '../../packages/agents/src/roles/verifier.agent.js';
import { createInitialSwarmState } from '../../packages/swarm/src/state/swarm-state.js';

// ─── Mocks (hoisted so they apply before the node imports resolve) ──────────

// The worker agent: returns a malformed STRING when no correction marker is
// present in its input, and a well-formed OBJECT when the correction is
// threaded in. The RESEARCH role's input carries `query: task.description`, so
// the worker sees the `[VERIFIER CORRECTION]` marker exactly when the verifier
// emitted a correction for this task.
vi.mock('../../packages/swarm/src/graph/nodes/worker/agent-factory.js', () => ({
  createWorkerAgent: () => ({
    execute: async (input: unknown) => {
      const q = (input as { query?: string } | null)?.query ?? '';
      // The worker-node threads the correction in as
      // `[VERIFIER CORRECTION — R2 CORRECT_OUTPUT] <prompt>`. Detect the prefix
      // (without the closing bracket, which sits after CORRECT_OUTPUT).
      if (typeof q === 'string' && q.includes('[VERIFIER CORRECTION')) {
        // Second pass — the correction reached the worker; produce well-formed output.
        return { summary: 'fixed output', sources: ['https://example.com'] };
      }
      // First pass — malformed: a string where an object was expected.
      return 'malformed string output';
    },
    reflectAndCorrect: async (outputStr: string) => ({ corrected: outputStr, wasChanged: false }),
  }),
}));

// The verifier agent: pass/fail from the output shape. A string output is a
// malformed-output failure (schema issues) → needsRetry; an object passes.
vi.mock('@jak-swarm/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jak-swarm/agents')>();
  return {
    ...actual,
    VerifierAgent: class {
      async execute(input: unknown): Promise<VerificationResult> {
        const agentOutput = (input as { agentOutput?: unknown }).agentOutput;
        if (typeof agentOutput === 'string') {
          return {
            passed: false,
            issues: ['Output failed schema validation: expected object, got string'],
            confidence: 0.3,
            needsRetry: true,
            retryReason: 'malformed output',
          };
        }
        return { passed: true, issues: [], confidence: 0.9, needsRetry: false };
      }
    },
  };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const FULL_BUDGET: RepairBudget = {
  maxExecutionRetries: 2,
  maxOutputRepairs: 2,
  maxPlanRepairs: 1,
  maxCapabilityRepairs: 1,
  maxTotalCostUsd: 100,
  maxDurationMs: 100_000,
};

function task(id: string): WorkflowTask {
  return {
    id,
    name: `task-${id}`,
    description: 'research the topic',
    agentRole: AgentRole.WORKER_RESEARCH,
    toolsRequired: ['web_search'],
    // HIGH risk forces the verifier to run (no auto-pass), so the loop is real.
    riskLevel: RiskLevel.HIGH,
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

interface LoopOpts {
  hyperAgentEnabled: boolean;
  hyperAgentMode: HyperAgentMode;
  autonomyLevel: AutonomyLevel;
}

function initialState(opts: LoopOpts) {
  const base = createInitialSwarmState({
    goal: 'g',
    tenantId: 't-1',
    userId: 'u-1',
    workflowId: 'wf-r2',
    hyperAgentEnabled: opts.hyperAgentEnabled,
    hyperAgentMode: opts.hyperAgentMode,
    autonomyLevel: opts.autonomyLevel,
    repairBudget: FULL_BUDGET,
    maxHyperAgentIterations: 3,
  });
  return {
    ...base,
    plan: plan([task('research_1')]),
    currentTaskIndex: 0,
  };
}

/** Shallow-merge a node's partial update into state, replicating the LangGraph
 *  reducers: taskResults / verificationResults / taskRetryCount / taskRepairState
 *  merge per-key; everything else is last-writer-wins; `outputCorrection` is
 *  clearable (undefined wins). */
function mergeUpdates(state: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  const mergeKeys = ['taskResults', 'verificationResults', 'taskRetryCount', 'taskRepairState'];
  const out: Record<string, unknown> = { ...state };
  for (const [k, v] of Object.entries(updates)) {
    if (mergeKeys.includes(k) && out[k] && v && typeof v === 'object') {
      out[k] = { ...(out[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else {
      out[k] = v; // lww + clearable (outputCorrection: undefined wins)
    }
  }
  return out;
}

/** Replicate `wrapVerifierNode`'s counter bump: the routing reason decides
 *  which counter increments. typed-correction → outputRepairAttempts++;
 *  legacy-retry → taskRetryCount++. */
function applyCounterBump(
  merged: Record<string, unknown>,
  decision: { next: string; reason: string },
): Record<string, unknown> {
  if (decision.next !== 'worker') return merged;
  const taskRepairState = (merged.taskRepairState ?? {}) as Record<string, unknown>;
  const taskRetryCount = (merged.taskRetryCount ?? {}) as Record<string, number>;
  const taskId = 'research_1';
  if (decision.reason === 'typed-correction') {
    const prev = (taskRepairState[taskId] ?? {
      taskId, executionAttempts: 0, outputRepairAttempts: 0, planRepairAttempts: 0, capabilityRepairAttempts: 0, exhausted: false,
    }) as Record<string, unknown>;
    const correction = merged.outputCorrection as { failureClass?: string } | undefined;
    return {
      ...merged,
      taskRepairState: {
        ...taskRepairState,
        [taskId]: {
          ...prev,
          outputRepairAttempts: ((prev.outputRepairAttempts as number) ?? 0) + 1,
          ...(correction?.failureClass ? { lastFailureClass: correction.failureClass } : {}),
        },
      },
    };
  }
  // legacy-retry
  return {
    ...merged,
    taskRetryCount: { ...taskRetryCount, [taskId]: (taskRetryCount[taskId] ?? 0) + 1 },
  };
}

// ─── The loop driver ────────────────────────────────────────────────────────

interface LoopResult {
  passes: number;
  typedCorrections: number;
  legacyRetries: number;
  escalatedToDiagnosis: boolean;
  finalStatus: WorkflowStatus;
  outputCorrectionPresentAfterFirstVerifier: boolean;
  correctionReachedWorker: boolean;
}

async function driveLoop(opts: LoopOpts, maxPasses = 5): Promise<LoopResult> {
  const { workerNode } = await import('../../packages/swarm/src/graph/nodes/worker-node.js');
  const { verifierNode } = await import('../../packages/swarm/src/graph/nodes/verifier-node.js');
  const { decideVerifierRouting } = await import('../../packages/swarm/src/graph/edges.js');

  let state = initialState(opts) as Record<string, unknown>;
  let passes = 0;
  let typedCorrections = 0;
  let legacyRetries = 0;
  let escalatedToDiagnosis = false;
  let correctionReachedWorker = false;
  let outputCorrectionPresentAfterFirstVerifier = false;

  while (passes < maxPasses) {
    passes += 1;
    // Worker pass.
    const wOut = (await workerNode(state as never)) as Record<string, unknown>;
    // Detect the correction reached the worker by checking the worker produced
    // well-formed output (object) — which only happens when the marker was in input.
    const wOutput = (wOut.taskResults as Record<string, unknown>)?.['research_1'];
    if (wOutput && typeof wOutput === 'object') correctionReachedWorker = true;
    state = mergeUpdates(state, wOut);

    // Verifier pass.
    const vOut = (await verifierNode(state as never)) as Record<string, unknown>;
    state = mergeUpdates(state, vOut);
    if (passes === 1 && state.outputCorrection !== undefined) {
      outputCorrectionPresentAfterFirstVerifier = true;
    }

    // Edge decision + counter bump (replicates wrapVerifierNode).
    const decision = decideVerifierRouting(state as never) as { next: string; reason: string };
    if (decision.next === 'diagnosis') {
      escalatedToDiagnosis = true;
      break;
    }
    if (decision.next === 'worker') {
      if (decision.reason === 'typed-correction') typedCorrections += 1;
      else if (decision.reason === 'legacy-retry') legacyRetries += 1;
      state = applyCounterBump(state, decision);
      continue; // re-run the worker with the correction
    }
    // next-task / end → loop complete.
    break;
  }

  return {
    passes,
    typedCorrections,
    legacyRetries,
    escalatedToDiagnosis,
    finalStatus: state.status as WorkflowStatus,
    outputCorrectionPresentAfterFirstVerifier,
    correctionReachedWorker,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Phase 5 — R2 CORRECT_OUTPUT loop (integration)', () => {
  beforeEach(() => {
    // Ensure the verifier runs (no env-gated auto-pass shortcut beyond the
    // HIGH-risk task already set). Clear any leak from other test files.
    delete process.env.JAK_VERIFIER_ALWAYS_ON;
  });

  it('L2 / HyperAgent ON: malformed output → typed correction → passes within R2 budget (no R3)', async () => {
    const r = await driveLoop({
      hyperAgentEnabled: true,
      hyperAgentMode: HyperAgentMode.ASSISTED,
      autonomyLevel: AutonomyLevel.L2,
    });
    // The verifier emitted a typed correction for the malformed failure.
    expect(r.outputCorrectionPresentAfterFirstVerifier).toBe(true);
    // Exactly one typed-correction re-run, then the task passed on the second
    // verifier pass — so the loop took 2 worker passes total.
    expect(r.typedCorrections).toBe(1);
    expect(r.legacyRetries).toBe(0); // the typed path replaced the legacy retry
    // The correction reached the worker (it produced well-formed output on
    // pass 2 because the marker was in its input).
    expect(r.correctionReachedWorker).toBe(true);
    // The task passed WITHOUT escalating to R3 diagnosis.
    expect(r.escalatedToDiagnosis).toBe(false);
    expect(r.passes).toBe(2);
  });

  it('L0 / HyperAgent OFF: same malformed failure → blind legacy same-input retry (default unchanged)', async () => {
    const r = await driveLoop({
      hyperAgentEnabled: false,
      hyperAgentMode: HyperAgentMode.OFF,
      autonomyLevel: AutonomyLevel.L0,
    });
    // The verifier does NOT emit a correction at L0 (emission is autonomy-
    // gated on HyperAgent ON + L2+), so the worker re-runs with the IDENTICAL
    // input — a blind same-input retry, byte-for-byte the legacy behaviour.
    expect(r.outputCorrectionPresentAfterFirstVerifier).toBe(false);
    // Legacy retry path runs to exhaustion (MAX_TASK_RETRIES=2): taskRetryCount
    // bumps each pass, NOT outputRepairAttempts. The worker keeps producing
    // the same malformed string (no correction is ever applied at L0), so it
    // never passes — the legacy budget exhausts.
    expect(r.legacyRetries).toBe(2);
    expect(r.typedCorrections).toBe(0);
    expect(r.correctionReachedWorker).toBe(false);
    // After the legacy budget exhausts, HyperAgent OFF → no R3 diagnosis;
    // the run advances/ends (no escalation).
    expect(r.escalatedToDiagnosis).toBe(false);
  });

  it('L1 / HyperAgent ON: CORRECT_OUTPUT requires L2, so a malformed failure uses the blind legacy retry then escalates', async () => {
    // L1 can propose repairs but cannot autonomously correct output, so the
    // typed path is not allowed → no correction is emitted → blind legacy same-
    // input retry runs (the default), exhausting the legacy budget without
    // ever applying the correction. HyperAgent is ON, so once the legacy budget
    // exhausts the run escalates to R3 diagnosis (which at L1 pauses for human
    // approval in the replanner — exercised by the Phase 4 routing tests).
    const r = await driveLoop({
      hyperAgentEnabled: true,
      hyperAgentMode: HyperAgentMode.ASSISTED,
      autonomyLevel: AutonomyLevel.L1,
    });
    expect(r.outputCorrectionPresentAfterFirstVerifier).toBe(false);
    expect(r.typedCorrections).toBe(0);
    expect(r.legacyRetries).toBe(2);
    expect(r.correctionReachedWorker).toBe(false);
    expect(r.escalatedToDiagnosis).toBe(true);
  });
});