import { WorkflowStatus, TaskStatus } from '@jak-swarm/shared';
import { AgentContext, getReflectionMode, ToolApprovalRequiredError } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';
import { getCircuitBreaker, CircuitOpenError } from '../../supervisor/circuit-breaker.js';
import { getBreakerFactory } from '../../supervisor/breaker-registry.js';
import { getActivityEmitter } from '../../supervisor/activity-registry.js';
import { getLLMApiKey } from '../../supervisor/llm-key-registry.js';
import { createWorkerAgent } from './worker/agent-factory.js';
import { buildTaskInput } from './worker/task-input-builders.js';
import {
  needsSummarization,
  summarizeTaskResults,
  estimateTokens,
} from '../../context/context-summarizer.js';
import { defaultRepairService } from '../../recovery/repair-service.js';
import { getLifecycleEmitter } from '../../workflow-runtime/lifecycle-registry.js';

// ─── Public browser types + plan builder (preserved from pre-P5b worker-node.ts) ─
//
// External consumers (apps/web traces, @jak-swarm/swarm public API, and the
// worker-node-browser behavioral test) import these names from this file. The
// implementation now lives in ./worker/intent-inference/browser.ts.
export type {
  BrowserActionType,
  BrowserActionRisk,
  BrowserActionShape,
  BrowserExecutionPlan,
  BrowserIntentCandidate,
  IntentConfidence,
} from './worker/intent-inference/browser.js';
export { buildBrowserExecutionPlan } from './worker/intent-inference/browser.js';

/**
 * Worker node — orchestration only.
 *
 * Resolves the agent for the current task, builds the role-specific input,
 * executes through a circuit breaker (local or distributed), lets the agent
 * self-correct its output, and records the result on the task/state.
 *
 * Everything interesting about per-role behavior lives under ./worker/.
 */
export async function workerNode(state: SwarmState): Promise<Partial<SwarmState>> {
  const task = getCurrentTask(state);

  if (!task) {
    return {
      status: WorkflowStatus.FAILED,
      error: 'Worker node: no current task found',
    };
  }

  // Stage 2: wire the per-workflow activity emitter so BaseAgent's live
  // tool_called / tool_completed / cost_updated events flow through to
  // the SSE stream the chat cockpit subscribes to. Side-channel lookup
  // because SwarmState cannot carry Function values (persistence).
  const onActivity = getActivityEmitter(state.workflowId);

  // Bracket the task with worker_started / worker_completed so the cockpit
  // can render per-task IN_PROGRESS -> COMPLETED. These ride the same activity
  // side-channel the SSE bridge already forwards (onAgentActivity).
  const workerStartedAt = Date.now();
  if (onActivity) {
    onActivity({
      type: 'worker_started',
      taskId: task.id,
      ...(task.name ? { taskName: task.name } : {}),
      agentRole: task.agentRole,
      timestamp: new Date().toISOString(),
    });
  }

  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    idempotencyKey: state.idempotencyKey,
    browserAutomationEnabled: state.browserAutomationEnabled,
    allowedDomains: state.allowedDomains,
    restrictedCategories: state.restrictedCategories,
    disabledToolNames: state.disabledToolNames,
    // Item C (OpenClaw-inspired Phase 1) — StandingOrder whitelist
    // propagation. Empty array = no whitelist; non-empty = strict.
    allowedToolNames: state.allowedToolNames,
    connectedProviders: state.connectedProviders,
    subscriptionTier: state.subscriptionTier,
    ...(onActivity ? { onActivity } : {}),
    // Per-tenant LLM provider preference from TenantMemory
    ...(state.llmProvider ? { llmProvider: state.llmProvider } : {}),
    // API key from side-channel registry (never persisted to SwarmState)
    ...(state.llmProvider && getLLMApiKey(state.workflowId)
      ? { llmApiKey: getLLMApiKey(state.workflowId) }
      : {}),
    // Google grounding config (Gemini-only; ignored by OpenAI)
    ...(state.googleSearchGrounding !== undefined ? { googleSearchGrounding: state.googleSearchGrounding } : {}),
    ...(state.vertexAISearchDatastore !== undefined ? { vertexAISearchDatastore: state.vertexAISearchDatastore } : {}),
    ...(state.openaiWebSearch !== undefined ? { openaiWebSearch: state.openaiWebSearch } : {}),
  });

  let output: unknown;
  let taskFailed = false;
  let awaitingApproval = false;

  try {
    const agent = createWorkerAgent(task.agentRole);

    if (!agent) {
      taskFailed = true;
      output = {
        error: `No worker agent registered for role: ${task.agentRole}`,
        taskId: task.id,
      };
    } else {
      // Sprint 2.2 / Item H — context summarization for long DAGs.
      // When state.taskResults has accumulated past the configured budget
      // (default: 6+ tasks AND > 16k tokens), compress older non-protected
      // entries into key-value summaries so the agent input stays bounded.
      // The current task + its direct dependencies + the last 2 completed
      // tasks are protected from compression. Fire-and-forget cockpit
      // event so users see why later steps reference summarized inputs.
      let stateForInput = state;
      if (needsSummarization(state)) {
        const beforeStr = JSON.stringify(state.taskResults);
        const tokensBefore = estimateTokens(beforeStr);
        const summarizedResults = summarizeTaskResults(state);
        const afterStr = JSON.stringify(summarizedResults);
        const tokensAfter = estimateTokens(afterStr);
        stateForInput = { ...state, taskResults: summarizedResults };
        try {
          if (onActivity) {
            onActivity({
              type: 'context_summarized',
              taskId: task.id,
              ...(task.name ? { taskName: task.name } : {}),
              inputTaskResultCount: Object.keys(state.taskResults).length,
              estimatedTokensBefore: tokensBefore,
              estimatedTokensAfter: tokensAfter,
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
          // Telemetry failure must never break the worker.
        }
      }

      // ─── HyperAgent Phase 5 — R2 CORRECT_OUTPUT typed correction ──────────
      // When the verifier emitted a typed correction for THIS task (a
      // malformed-output failure the afterVerifier edge routed back here at
      // L2+), thread the correction into the next pass's prompt by appending
      // it to the task description. Every role's task-input builder consumes
      // `task.description`, so this is the single minimal seam that reaches the
      // agent's input without touching each builder or BaseAgent.
      // `taskForInput` is a LOCAL copy — the persisted plan task is never
      // mutated. No-op when there is no correction (default workflows / first
      // pass / non-malformed failures) — byte-for-byte the legacy path.
      const correction = state.outputCorrection;
      const correctionForThisTask =
        correction && correction.taskId === task.id ? correction : undefined;
      const taskForInput: typeof task = correctionForThisTask
        ? {
            ...task,
            description: `${task.description}\n\n[VERIFIER CORRECTION — R2 CORRECT_OUTPUT] ${correctionForThisTask.correctionPrompt}`,
          }
        : task;

      const taskInput = buildTaskInput(taskForInput, stateForInput);

      // Distributed breaker (shared across instances) if registered for this
      // workflow in the breaker-registry side-channel; else local per-process.
      // State cannot carry the factory directly — Function values crash Prisma
      // persistence (`[object Function]` serialization error).
      const breakerFactory = getBreakerFactory(state.workflowId);

      const breaker = breakerFactory
        ? breakerFactory(`worker:${task.agentRole}`, { failureThreshold: 5, resetTimeoutMs: 30_000 })
        : getCircuitBreaker(`worker:${task.agentRole}`, { failureThreshold: 5, resetTimeoutMs: 30_000, tenantId: state.tenantId });

      // P1-3: RepairService is now wired into the worker-node failure path.
      // Previously the service existed in apps/api/services/repair.service.ts
      // but was never invoked by the orchestration layer — a phantom feature.
      // Now: on failure, classify the error, emit repair_* lifecycle events,
      // and either retry in-place (with backoff) or hand off to the verifier
      // with a clean event trail. Destructive actions and unknown classes
      // never auto-retry — they emit `repair_escalated_to_human` and let the
      // verifier+approval gate take over. Retry budget is per-class
      // (transient/tool_unavailable: up to 3; missing_input/parse: 1; etc.)
      // matching the decision-tree in repair-service.ts.
      const onLifecycle = getLifecycleEmitter(state.workflowId);
      const MAX_REPAIR_LOOPS = 4; // belt-and-braces ceiling on retry attempts
      let priorAttempts = 0;
      let attemptOutcome: 'success' | 'circuit_open' | 'thrown' | 'approval_required' = 'success';
      let lastError: Error | undefined;

      for (let loop = 0; loop < MAX_REPAIR_LOOPS; loop += 1) {
        try {
          output = await breaker.call<unknown>(() => agent.execute(taskInput, context));
          attemptOutcome = 'success';
          if (loop > 0) {
            // We just succeeded after a repair-driven retry — record it.
            defaultRepairService.recordAttemptResult(
              { workflowId: state.workflowId, stepId: task.id, ...(onLifecycle ? { onLifecycle } : {}) },
              loop,
              true,
            );
          }
          break;
        } catch (err) {
          // Item 10 — a per-tool approval gate firing is NOT a retryable
          // failure. The agent's tool-execution loop threw
          // ToolApprovalRequiredError after emitting the
          // tool_approval_required activity (which persists an
          // ApprovalRequest row + fires the canonical lifecycle event).
          // Retrying would re-run the tool loop and re-block on the same
          // gate. Stop immediately with an honest 'approval_required'
          // outcome so the post-loop block marks the task
          // AWAITING_APPROVAL and the workflow state reflects "blocked on
          // human approval" instead of generic FAILED.
          if (err instanceof ToolApprovalRequiredError) {
            attemptOutcome = 'approval_required';
            lastError = err;
            break;
          }
          lastError = err instanceof Error ? err : new Error(String(err));
          if (err instanceof CircuitOpenError || lastError.message.includes('circuit breaker')) {
            attemptOutcome = 'circuit_open';
          } else {
            attemptOutcome = 'thrown';
          }

          // Ask the repair service: retry, escalate, or give up?
          const { decision } = defaultRepairService.evaluate({
            workflowId: state.workflowId,
            stepId: task.id,
            tenantId: state.tenantId,
            errorMessage: lastError.message,
            // requiresApproval flag on a task carries through to "is this
            // a destructive action" — verifier/approval gate already use it.
            isDestructive: task.requiresApproval === true,
            priorAttempts,
            ...(onLifecycle ? { onLifecycle } : {}),
          });

          if (decision.action === 'retry') {
            // Backoff per the decision strategy, then loop.
            await defaultRepairService.applyBackoff(decision.strategy);
            priorAttempts += 1;
            continue;
          }

          // escalate_to_human or give_up — record outcome and stop looping.
          if (loop > 0) {
            defaultRepairService.recordAttemptResult(
              { workflowId: state.workflowId, stepId: task.id, ...(onLifecycle ? { onLifecycle } : {}) },
              loop,
              false,
              lastError.message,
            );
          }
          break;
        }
      }

      if (attemptOutcome === 'approval_required' && lastError) {
        // Item 10 — honest "blocked on approval" state. The task is NOT
        // failed (the agent did its job by surfacing the gate); it is
        // AWAITING_APPROVAL pending a human decision in the cockpit
        // inbox. We carry the structured approval context through the
        // task output + workflow error so the verifier / API layer /
        // cockpit can surface exactly which tool was blocked and why,
        // without re-deriving it from the activity log. The workflow
        // status is set to AWAITING_APPROVAL below (NOT VERIFYING) so
        // the graph honestly reports it is paused, not "verifying a
        // failure".
        const approvalErr = lastError as ToolApprovalRequiredError;
        taskFailed = false;
        awaitingApproval = true;
        output = {
          awaitingApproval: true,
          toolName: approvalErr.toolName,
          category: approvalErr.category,
          reason: approvalErr.reason,
          inputSummary: approvalErr.inputSummary,
          taskId: task.id,
        };
      } else if (attemptOutcome !== 'success' && lastError) {
        taskFailed = true;
        output = {
          error: attemptOutcome === 'circuit_open'
            ? `Circuit breaker open for ${task.agentRole}: ${lastError.message}`
            : lastError.message,
          taskId: task.id,
        };
      }

      // Self-correction: agent reviews its own output before the verifier sees it.
      // Catches obvious errors early, reducing verifier retry loops. Skipped when
      // the task is blocked on approval — there is no agent output to correct.
      if (!taskFailed && !awaitingApproval && output && typeof output === 'object') {
        try {
          const outputStr = JSON.stringify(output);
          const { corrected, wasChanged } = await agent.reflectAndCorrect(
            outputStr,
            taskForInput.description,
            {
              maxTokens: 2048,
              mode: getReflectionMode(task.agentRole),
              maxReflectionPasses: 2,
            },
          );
          if (wasChanged) {
            try {
              output = JSON.parse(corrected);
            } catch {
              // Correction wasn't valid JSON — keep original
            }
          }
        } catch {
          // Self-reflection failed — continue with original output
        }
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    taskFailed = true;
    output = { error: errorMessage, taskId: task.id };
  }

  const traces = context.getTraces();

  const updatedPlan = state.plan
    ? {
        ...state.plan,
        tasks: state.plan.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: awaitingApproval
                  ? TaskStatus.AWAITING_APPROVAL
                  : taskFailed
                    ? TaskStatus.FAILED
                    : TaskStatus.COMPLETED,
                completedAt: awaitingApproval ? undefined : new Date(),
                error: awaitingApproval
                  ? `Tool approval required: ${String((output as Record<string, unknown>)['reason'] ?? 'unknown tool')}`
                  : taskFailed
                    ? String((output as Record<string, unknown>)['error'] ?? 'Unknown worker error')
                    : undefined,
              }
            : t,
        ),
      }
    : state.plan;

  if (onActivity) {
    onActivity({
      type: 'worker_completed',
      taskId: task.id,
      ...(task.name ? { taskName: task.name } : {}),
      agentRole: task.agentRole,
      success: !taskFailed && !awaitingApproval,
      durationMs: Date.now() - workerStartedAt,
      ...(awaitingApproval
        ? { awaitingApproval: true, toolName: String((output as Record<string, unknown>)['toolName'] ?? '') }
        : taskFailed
          ? { error: String((output as Record<string, unknown>)['error'] ?? 'Worker failed') }
          : {}),
      timestamp: new Date().toISOString(),
    });
  }

  return {
    taskResults: { [task.id]: output },
    outputs: [output],
    plan: updatedPlan,
    traces,
    // Item 10 — when a per-tool approval gate fired, honestly report the
    // workflow as AWAITING_APPROVAL (paused on human review) instead of
    // VERIFYING. The verifier edge still runs, but the workflow status
    // reflects the true blocked state so the cockpit / API can surface it.
    status: awaitingApproval ? WorkflowStatus.AWAITING_APPROVAL : WorkflowStatus.VERIFYING,
    error: awaitingApproval
      ? `Tool approval required: ${String((output as Record<string, unknown>)['reason'] ?? 'unknown tool')}`
      : taskFailed
        ? String((output as Record<string, unknown>)['error'] ?? 'Worker failed')
        : undefined,
  };
}
