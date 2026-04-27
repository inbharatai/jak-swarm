import { WorkflowStatus, TaskStatus } from '@jak-swarm/shared';
import { VerifierAgent, AgentContext } from '@jak-swarm/agents';
import type { VerifierInput } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';
import { getActivityEmitter } from '../../supervisor/activity-registry.js';

const MAX_RETRIES = 2;  // max worker retries per task before accepting the result as-is

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

  const agent = new VerifierAgent();

  const context = new AgentContext({
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

  const result = await agent.execute(verifierInput, context);
  const traces = context.getTraces();

  // Count how many times this task has been retried
  const retryKey = `${task.id}_retries`;
  const currentRetries = (state.taskResults[retryKey] as number | undefined) ?? 0;

  if (!result.passed && result.needsRetry && currentRetries < MAX_RETRIES) {
    // Budget remaining — schedule a retry. Store the raw result (needsRetry:true)
    // so afterVerifier() correctly routes back to the worker node.
    // Sprint 2.1 / Item K: emit `verification_completed` with passed=false
    // so the cockpit reflects the retry trigger; the next verifier pass
    // will emit a fresh `verification_started` + `verification_completed`.
    emitVerificationCompleted(state.workflowId, task, {
      passed: false, confidence: result.confidence, issues: result.issues,
    });
    return {
      verificationResults: { [task.id]: result },
      taskResults: { [retryKey]: currentRetries + 1 },
      traces,
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
    // VERIFYING tells the graph runner "routing should decide what happens next".
    // afterVerifier() reads finalResult.needsRetry (now false) → advances correctly.
    status: WorkflowStatus.VERIFYING,
    // Surface error only when task ultimately failed after exhausting all retries
    error: !finalResult.passed
      ? `Task '${task.name}' failed verification after ${currentRetries + 1} attempt(s): ${finalResult.issues.join('; ')}`
      : undefined,
  };
}
