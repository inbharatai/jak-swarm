import {
  AutonomyCapability,
  AutonomyLevel,
  FailureClass,
  HyperAgentMode,
  OutputCorrection,
  TaskStatus,
  WorkflowStatus,
} from '@jak-swarm/shared';
import { VerifierAgent, AgentContext } from '@jak-swarm/agents';
import { evaluateForConfig } from '@jak-swarm/security';
import { scoreRubricFloor } from '@jak-swarm/verification';
import type { VerifierInput, VerificationResult } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';
import { getActivityEmitter } from '../../supervisor/activity-registry.js';
import { classifyFailure } from '../../recovery/failure-classifier.js';
import { hyperAgentActive, MAX_TASK_RETRIES } from '../edges.js';

/**
 * Sprint 2.1 / Item K — `verification_completed` emit helper.
 *
 * Centralised so every return path of `verifierNode` (auto-pass, retry,
 * final pass, final fail) emits the same shape. Fire-and-forget; never
 * blocks the verification decision.
 */
function emitVerificationCompleted(
  workflowId: string,
  task: { id: string; name?: string },
  result: { passed: boolean; confidence?: number; issues?: string[]; citationDensity?: number },
): void {
  try {
    const emitter = getActivityEmitter(workflowId);
    if (!emitter) return;
    // Sprint 2.4 / Item F — when the verifier computed a citationDensity,
    // surface it as the groundingScore (replaces the legacy "confidence"
    // value for roles that need grounding). Otherwise fall back to
    // confidence so legacy behavior is preserved.
    const groundingScore = typeof result.citationDensity === 'number'
      ? result.citationDensity
      : result.confidence;
    emitter({
      type: 'verification_completed',
      taskId: task.id,
      ...(task.name ? { taskName: task.name } : {}),
      passed: result.passed,
      ...(typeof groundingScore === 'number' ? { groundingScore } : {}),
      ...(Array.isArray(result.issues) ? { issueCount: result.issues.length } : {}),
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Emission failure must never break verification.
  }
}

/**
 * Build an R2 CORRECT_OUTPUT typed correction for a failed verification, when
 * the failure classifies as a malformed-output class (`OUTPUT_SCHEMA` /
 * `TOOL_BAD_INPUT`). Returns `undefined` otherwise (passed, or a non-malformed
 * failure class like GROUNDING_FAILURE / HALLUCINATION) — the caller returns
 * `outputCorrection: undefined` to clear any prior correction via the
 * clearable reducer, so a stale correction can never leak across passes or
 * tasks. Pure given (task, result).
 *
 * Classification reuses the deterministic `classifyFailure` (no LLM): the
 * verifier's `issues` joined as the signal message map cleanly to
 * OUTPUT_SCHEMA (schema/parse/validation keywords) or TOOL_BAD_INPUT. This is
 * the R2 territory the HyperAgent spec reserves for typed correction.
 */
function buildOutputCorrection(
  task: { id: string; name?: string; description: string },
  result: VerificationResult,
): OutputCorrection | undefined {
  if (result.passed) return undefined;
  const message = result.issues.join('; ');
  if (!message) return undefined;
  const classification = classifyFailure({ message });
  if (
    classification.errorClass !== FailureClass.OUTPUT_SCHEMA &&
    classification.errorClass !== FailureClass.TOOL_BAD_INPUT
  ) {
    return undefined;
  }
  const retryHint = result.retryReason ? ` Retry reason: ${result.retryReason}.` : '';
  const correctionPrompt =
    `The previous attempt failed verification and was classified as ${classification.errorClass}. ` +
    `Issues found: ${result.issues.join('; ')}.${retryHint} ` +
    `Re-run the task and produce well-formed output that directly fixes every issue above. ` +
    `Do not repeat the malformed shape; match the expected structure exactly.`;
  return {
    taskId: task.id,
    failureClass: classification.errorClass,
    issues: [...result.issues],
    correctionPrompt,
  };
}

/**
 * Emit a typed correction ONLY when the R2 CORRECT_OUTPUT path is usable for
 * this run: HyperAgent ON AND the autonomy policy permits CORRECT_OUTPUT
 * (L2+). This gate is what keeps default workflows (HyperAgent OFF / L0–L1)
 * byte-for-byte unchanged — at those levels no correction is emitted, so the
 * worker re-runs with the identical input (a blind same-input retry) exactly
 * as before. The `afterVerifier` edge re-checks the same autonomy condition
 * before routing on the correction, so emission and routing can never
 * disagree on whether the typed path is active.
 */
function maybeOutputCorrection(
  state: SwarmState,
  task: { id: string; name?: string; description: string },
  result: VerificationResult,
): OutputCorrection | undefined {
  if (!hyperAgentActive(state)) return undefined;
  const allowed = evaluateForConfig(
    {
      hyperAgentEnabled: state.hyperAgentEnabled ?? false,
      hyperAgentMode: state.hyperAgentMode ?? HyperAgentMode.OFF,
      autonomyLevel: state.autonomyLevel ?? AutonomyLevel.L0,
    },
    AutonomyCapability.CORRECT_OUTPUT,
  ).allowed;
  if (!allowed) return undefined;
  return buildOutputCorrection(task, result);
}

export async function verifierNode(state: SwarmState): Promise<Partial<SwarmState>> {
  const task = getCurrentTask(state);

  if (!task) {
    return { status: WorkflowStatus.COMPLETED };
  }

  // Sprint 2.1 / Item K — emit `verification_started` at entry. We emit
  // even for the auto-pass branch below so the cockpit shows verification
  // ran (and then completed instantly), rather than going silent on
  // skipped verifications.
  try {
    const emitter = getActivityEmitter(state.workflowId);
    if (emitter) {
      emitter({
        type: 'verification_started',
        taskId: task.id,
        ...(task.name ? { taskName: task.name } : {}),
        timestamp: new Date().toISOString(),
      });
    }
  } catch {
    // ignore — never block verification on telemetry
  }

  const taskOutput = state.taskResults[task.id];

  // Stage 3.1 cost optimization: skip the Verifier for low-risk routine
  // tasks. Previously every workflow — including trivial "hi" chats —
  // ran through a tier-3 Verifier call costing ~$0.02 per. We only
  // verify when the task is HIGH risk, a task the user must approve
  // before anything ships, or when the task output is missing (which is
  // itself a failure signal worth re-examining). LOW-risk routine work
  // (summary queries, lookups, trivial drafts) returns auto-passed.
  // Operators can force the verifier back on via
  // JAK_VERIFIER_ALWAYS_ON=1 for debugging.
  const forceVerifier =
    process.env['JAK_VERIFIER_ALWAYS_ON'] === '1' ||
    process.env['JAK_VERIFIER_ALWAYS_ON'] === 'true';
  const needsVerifier =
    forceVerifier ||
    task.riskLevel === 'HIGH' ||
    task.requiresApproval === true ||
    taskOutput === undefined ||
    taskOutput === null;

  if (!needsVerifier) {
    // Auto-pass — persist a light-weight verification result so the
    // trace still shows a Verifier decision for audit, but with zero
    // LLM call. Uses the existing VerificationResult shape; the
    // retryReason field carries the skip reason for trace clarity.
    emitVerificationCompleted(state.workflowId, task, {
      passed: true, confidence: 1, issues: [],
    });
    return {
      verificationResults: {
        [task.id]: {
          passed: true,
          issues: [],
          confidence: 1,
          needsRetry: false,
          retryReason: `Auto-verified: ${task.riskLevel ?? 'LOW'} risk, no approval required — Verifier skipped per JAK_VERIFIER gating`,
        },
      },
      completedTaskIds: [...(state.completedTaskIds ?? []), task.id],
      taskResults: {
        [`${task.id}_status`]: TaskStatus.COMPLETED,
      },
    };
  }

  // Accuracy pass — calibrated abstention short-circuit. When the worker
  // abstained (output.abstained === true, HyperAgent-gated in worker-node),
  // the verifier must NOT verify the abstention as if it were a completion:
  // an abstain is an honest decline, so we record a non-pass / non-retry
  // result, set the task to ABSTAINED (not FAILED), and route FORWARD without
  // burning a same-input retry (re-running would just produce another guess).
  // The outcome evaluator triages TASK_ABSTAINED — never a failure, never a
  // silent pass; acceptance criteria see it as a wired-unsatisfied task.
  const outputRecord = taskOutput && typeof taskOutput === 'object'
    ? (taskOutput as Record<string, unknown>)
    : undefined;
  if (outputRecord?.abstained === true) {
    const reason = typeof outputRecord.reason === 'string' ? outputRecord.reason : 'worker abstained';
    const abstainResult: VerificationResult = {
      passed: false,
      issues: [`Worker abstained rather than produce an ungrounded answer: ${reason}`],
      confidence: typeof outputRecord.confidence === 'number' ? (outputRecord.confidence as number) : 0.3,
      needsRetry: false,
      retryReason: 'Abstention is terminal — re-running would produce another guess, not evidence.',
    };
    const abstainedPlan = state.plan
      ? {
          ...state.plan,
          tasks: state.plan.tasks.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  status: TaskStatus.ABSTAINED,
                  error: `Abstained: ${reason}`,
                  abstention: {
                    reason,
                    ...(typeof outputRecord.confidence === 'number' ? { confidence: outputRecord.confidence as number } : {}),
                    ...(typeof outputRecord.partialEvidence === 'string' ? { partialEvidence: outputRecord.partialEvidence as string } : {}),
                  },
                }
              : t,
          ),
        }
      : state.plan;
    emitVerificationCompleted(state.workflowId, task, {
      passed: false, confidence: abstainResult.confidence, issues: abstainResult.issues,
    });
    return {
      verificationResults: { [task.id]: abstainResult },
      plan: abstainedPlan,
      // Neither completed nor failed — abstained. afterVerifier advances to
      // the next task (needsRetry=false) and the outcome evaluator reads
      // TaskStatus.ABSTAINED off the plan.
      taskResults: {
        [`${task.id}_status`]: TaskStatus.ABSTAINED,
      },
      status: WorkflowStatus.VERIFYING,
      error: `Task '${task.name}' abstained: ${reason}`,
    };
  }

  const agent = new VerifierAgent();

  const context = new AgentContext({
    agentRole: 'VERIFIER',
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    idempotencyKey: state.idempotencyKey,
    allowedDomains: state.allowedDomains,
  });

  const verifierInput: VerifierInput = {
    task,
    agentOutput: taskOutput,
  };

  const result = await agent.execute(verifierInput, context) as VerificationResult;
  const traces = context.getTraces();

  // Accuracy pass — deterministic rubric quality floor. The floor scores
  // instruction-following (sub-ask engagement + task-term completeness),
  // citation presence, and format conformity at zero LLM cost, and CAPS the
  // composite verification confidence at its score. Posture mirrors the
  // citation-density gate: the floor never flips a pass to a fail on its own
  // (quality below par is a confidence signal + reviewable issues, not a
  // blocking verdict) and it can never RAISE the verifier's confidence — a
  // fluent-sounding LLM verdict cannot paper over an output that structurally
  // failed to do what the task asked. `evidenceServed` is inferred from a
  // citation density having been computed (grounded role), so the citation
  // dimension only bites when evidence was actually available to cite.
  const outputForFloor =
    typeof taskOutput === 'string' ? taskOutput : JSON.stringify(taskOutput ?? '');
  const floor = scoreRubricFloor(outputForFloor, {
    taskName: task.name,
    taskDescription: task.description,
    evidenceServed: result.citationDensity !== undefined,
  });
  if (floor.floorScore < 1) {
    result.confidence = Math.min(result.confidence, floor.floorScore);
    result.issues = [...result.issues, ...floor.issues];
    result.qualityScore = floor.floorScore;
    result.qualityDimensions = floor.dimensions.map((d) => ({
      name: d.name,
      score: d.score,
      note: d.note,
    }));
  }

  // Same-input (R1/R2) retry budget — single source of truth: `taskRetryCount`
  // on state, incremented by wrapVerifierNode when afterVerifier routes back to
  // the worker. The verifier and the afterVerifier edge both read this field
  // against the shared MAX_TASK_RETRIES ceiling, so their decisions agree.
  const currentRetries = state.taskRetryCount[task.id] ?? 0;

  if (!result.passed && result.needsRetry && currentRetries < MAX_TASK_RETRIES) {
    // Budget remaining — schedule a retry. Store the raw result (needsRetry:true)
    // so afterVerifier() correctly routes back to the worker node (which then
    // bumps taskRetryCount via wrapVerifierNode).
    // Sprint 2.1 / Item K: emit `verification_completed` with passed=false
    // so the cockpit reflects the retry trigger; the next verifier pass
    // will emit a fresh `verification_started` + `verification_completed`.
    emitVerificationCompleted(state.workflowId, task, {
      passed: false, confidence: result.confidence, issues: result.issues,
    });
    return {
      verificationResults: { [task.id]: result },
      traces,
      // R2 CORRECT_OUTPUT: emit the typed correction (or clear it). The
      // afterVerifier edge consults the autonomy policy + outputRepairAttempts
      // budget to decide whether to route back to the worker with this
      // correction (L2+ + HyperAgent ON) or fall through to the legacy
      // same-input retry (default). `undefined` clears a stale prior correction.
      outputCorrection: maybeOutputCorrection(state, task, result),
      // Status stays VERIFYING so the graph goes back to worker
    };
  }

  // ── Retries exhausted (or task passed, or needsRetry was false) ───────────────
  // CRITICAL FIX: force needsRetry=false on the stored result.
  // The raw agent result may still carry needsRetry:true, but we must NOT honour
  // it once the retry budget is spent — otherwise afterVerifier() re-routes to
  // the worker indefinitely.
  const finalResult = {
    ...result,
    needsRetry: false,
  };

  // Update task status in the plan
  const updatedPlan = state.plan
    ? {
        ...state.plan,
        tasks: state.plan.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: finalResult.passed ? TaskStatus.COMPLETED : TaskStatus.FAILED,
                error: finalResult.passed ? undefined : finalResult.issues.join('; '),
              }
            : t,
        ),
      }
    : state.plan;

  // Sprint 2.1 / Item K: final `verification_completed` (after retry budget
  // exhausted, or initial pass that didn't request retry).
  emitVerificationCompleted(state.workflowId, task, {
    passed: finalResult.passed, confidence: finalResult.confidence, issues: finalResult.issues,
  });

  return {
    verificationResults: { [task.id]: finalResult },
    plan: updatedPlan,
    traces,
    completedTaskIds: finalResult.passed ? [task.id] : [],
    failedTaskIds: finalResult.passed ? [] : [task.id],
    taskResults: {
      [`${task.id}_status`]: finalResult.passed ? TaskStatus.COMPLETED : TaskStatus.FAILED,
    },
    // Clear any stale typed correction (the task is done — passed, or failed
    // and advancing/escalating). Returning `undefined` clears via the
    // clearable reducer so a correction from a prior pass can never leak.
    outputCorrection: maybeOutputCorrection(state, task, finalResult),
    // VERIFYING tells the graph runner "routing should decide what happens next".
    // afterVerifier() reads finalResult.needsRetry (now false) → advances correctly.
    status: WorkflowStatus.VERIFYING,
    // Surface error only when task ultimately failed after exhausting all retries
    error: !finalResult.passed
      ? `Task '${task.name}' failed verification after ${currentRetries + 1} attempt(s): ${finalResult.issues.join('; ')}`
      : undefined,
  };
}
