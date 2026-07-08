/**
 * ADK Runner Bridge — executes ADK pipelines and converts results back
 * to JAK's SwarmState shape.
 *
 * This is the runtime bridge that makes ADK orchestration work inside
 * JAK's existing infrastructure. When JAK_ADK_MODE=1:
 *   1. Build an ADK pipeline from the workflow config
 *   2. Run it via ADK's Runner + InMemorySessionService
 *   3. Collect events and extract agent outputs from session state
 *   4. Convert to Partial<SwarmState> so persistence + SSE work unchanged
 *
 * The existing LangGraph path is NEVER touched — this is purely additive.
 */

import { Runner, InMemorySessionService } from '@google/adk';
import { WorkflowStatus, AgentRole } from '@jak-swarm/shared';
import type { ToolMetadata, ToolExecutionContext, WorkflowPlan } from '@jak-swarm/shared';
import { buildAdkPipeline, buildSimpleAdkPipeline, buildWavedPipeline, type AdkPipelineConfig } from './adk-pipeline.js';
import { withJakExecutionContext, withApprovalGate } from '../bridge/jak-tool-bridge.js';
import {
  rolesFromPlan,
  partitionRolesIntoWaves,
  type ApprovalGate,
} from './adk-parity.js';
import type { SwarmState } from '@jak-swarm/swarm';

// ─── ADK run result ─────────────────────────────────────────────────────────

export interface AdkRunResult {
  /** Final SwarmState-compatible output. */
  state: Partial<SwarmState>;
  /** ADK events collected during the run (for debugging/display). */
  events: Array<{ author: string; content?: string; timestamp?: string }>;
  /** Whether the run completed successfully. */
  success: boolean;
  /** Error message if the run failed. */
  error?: string;
}

// ─── ADK event → JAK activity mapper (cockpit parity) ──────────────────────

/**
 * Map an ADK streaming event into 0+ JAK `onAgentActivity` payloads so the
 * cockpit SSE + audit log see real-time ADK progress through the SAME
 * translation the LangGraph path uses (worker_started → step_started,
 * worker_completed → step_completed / step_failed).
 *
 * ADK's event model is coarser than JAK's LangGraph nodes: ADK emits
 * `{ author, content, errorCode, errorMessage }` chunks as the agent
 * streams — there is no first-class plan_created / verification / context-
 * summarized signal. We therefore map FAITHFULLY (no fabricated plan or
 * verification events):
 *   - non-user content chunk → worker_started THEN worker_completed for
 *     that author (the cockpit sees a start+complete pair per chunk,
 *     which is honest real-time progress).
 *   - error event → worker_completed with success=false (the existing
 *     translator routes this to step_failed).
 *   - user / empty chunks → nothing.
 *
 * `author` is mapped to a JAK AgentRole when the uppercased name matches
 * the enum, else 'COMMANDER' as the conservative fallback (matches the
 * trace-mapping logic below).
 *
 * Exported (pure, no I/O) so tests can lock the mapping without a live LLM.
 */
export interface AdkEventLike {
  author?: string;
  content?: { parts?: Array<{ text?: string }> };
  errorCode?: string;
  errorMessage?: string;
}

export function mapAdkEventToActivities(
  event: AdkEventLike,
  _workflowId: string,
): Array<Record<string, unknown>> {
  const author = event.author ?? 'unknown';
  const authorUpper = author.toUpperCase();
  const agentRole = Object.values(AgentRole).includes(authorUpper as AgentRole)
    ? (authorUpper as AgentRole)
    : AgentRole.COMMANDER;

  // Error event → step_failed (via worker_completed success=false).
  if (event.errorCode) {
    return [{
      type: 'worker_completed',
      agentRole,
      taskName: author,
      success: false,
      error: event.errorMessage ?? event.errorCode,
      durationMs: 0,
    }];
  }

  // Extract text content from the ADK parts shape.
  const content = event.content?.parts
    ?.map((p) => p?.text ?? '')
    .join('') ?? '';

  if (!content.trim() || author === 'user') return [];

  const contentPreview = content.slice(0, 200);
  return [
    {
      type: 'worker_started',
      agentRole,
      taskName: author,
    },
    {
      type: 'worker_completed',
      agentRole,
      taskName: author,
      success: true,
      contentPreview,
      durationMs: 0,
    },
  ];
}

// ─── ADK runner ─────────────────────────────────────────────────────────────

/**
 * Run a JAK workflow through the ADK orchestration pipeline.
 *
 * @param params.workflowId - JAK workflow ID
 * @param params.goal - User's goal string
 * @param params.tenantId - Tenant ID for tool context
 * @param params.userId - User ID for tool context
 * @param params.provider - LLM provider ('gemini' | 'openai')
 * @param params.jakToolMetadata - JAK tools to bridge as FunctionTools
 * @param params.toolContext - JAK execution context for tool calls
 * @param params.workerRoles - Worker roles to create (from the plan)
 * @param params.allowedToolNames - Optional tool whitelist
 * @returns AdkRunResult with SwarmState-compatible output
 */
export async function runWithAdk(params: {
  workflowId: string;
  goal: string;
  tenantId: string;
  userId: string;
  provider: 'gemini' | 'openai';
  jakToolMetadata: ToolMetadata[];
  toolContext: ToolExecutionContext;
  workerRoles?: string[];
  allowedToolNames?: string[];
  googleSearchGrounding?: boolean;
  openaiWebSearch?: boolean;
  /**
   * HyperAgent Phase 11 — the Planner's structured plan. When supplied, the
   * runner derives worker roles FROM THE PLAN (rolesFromPlan, the parity fix
   * for "ADK roles from caller roleModes not Planner plan") and builds a WAVED
   * pipeline (partitionRolesIntoWaves → buildWavedPipeline) so a depended-on
   * role's wave runs before its dependents'. When omitted, the runner uses
   * `workerRoles` / the simple pipeline exactly as before (non-regressing).
   */
  plannerPlan?: WorkflowPlan;
  /**
   * HyperAgent Phase 11 — the approval gate. When supplied, the bridged
   * FunctionTool handler PAUSES before executing a high-risk tool and awaits
   * this gate (which may itself await a human) — real pause/resume at the
   * tool-call boundary, honest parity with LangGraph's per-tool approval gate
   * within ADK's synchronous-event constraint. On `deny` / `approval_required`
   * the tool does NOT execute (recorded-for-review outcome returned). When
   * omitted, high-risk tools run and self-report via their own outcome (prior
   * behavior, non-regressing).
   */
  approvalGate?: ApprovalGate;
  /**
   * Cockpit parity (Phase 3) — optional callback invoked with each ADK
   * event mapped to the JAK `onAgentActivity` vocabulary. The swarm-
   * execution service passes the SAME translator the LangGraph path uses
   * (emit on the workflow SSE channel + translate to canonical lifecycle
   * events + audit rows). When omitted, the ADK run is silent to the
   * cockpit until the final SwarmState is returned — which is the prior
   * behavior and remains correct for headless/bench runs.
   */
  onAgentActivity?: (data: unknown) => void;
}): Promise<AdkRunResult> {
  const {
    workflowId,
    goal,
    tenantId: _tenantId,
    userId,
    provider,
    jakToolMetadata,
    toolContext,
    workerRoles,
    allowedToolNames,
    googleSearchGrounding,
    openaiWebSearch,
    plannerPlan,
    approvalGate,
    onAgentActivity,
  } = params;

  // Thread the JAK execution context + the optional approval gate via
  // AsyncLocalStorage so concurrent ADK runs each see their own context + gate.
  // The whole run body executes inside this scope; tool-bridge callbacks read
  // them via getJakExecutionContext() / getApprovalGate().
  return withJakExecutionContext(toolContext, () =>
    withApprovalGate(approvalGate ?? null, async () => {
    // 2. Derive worker roles from the Planner plan (Phase 11 parity) when
    //    supplied; otherwise fall back to the caller's workerRoles / ['CEO'].
    const derivedRoles = plannerPlan
      ? rolesFromPlan(plannerPlan)
      : (workerRoles ?? ['CEO']);

    // 2b. Build the ADK pipeline. When a Planner plan is supplied, build a
    //     WAVED pipeline (dependency-ordered waves — Phase 11 parity with the
    //     LangGraph path). Otherwise use the flat / simple pipeline as before.
    const pipelineConfig: AdkPipelineConfig = {
      provider,
      jakToolMetadata,
      workerRoles: derivedRoles,
      allowedToolNames,
      // Search is on by default in ADK mode; either flag opts in, and
      // googleSearchGrounding defaults true (opt out via env = '0').
      // The prior `|| true` made this always true and the env var dead.
      includeSearch: Boolean(googleSearchGrounding) || Boolean(openaiWebSearch),
    };

    const pipeline = plannerPlan
      ? buildWavedPipeline(pipelineConfig, partitionRolesIntoWaves(plannerPlan))
      : (workerRoles && workerRoles.length > 1
        ? buildAdkPipeline(pipelineConfig)
        : buildSimpleAdkPipeline(pipelineConfig));

    // 3. Create ADK Runner with in-memory sessions
    const sessionService = new InMemorySessionService();
    const runner = new Runner({
      appName: 'jak-swarm-adk',
      agent: pipeline,
      sessionService,
    });

    // 4. Create a session and run the pipeline
    const session = await sessionService.createSession({
      appName: 'jak-swarm-adk',
      userId,
    });

    const collectedEvents: Array<{ author: string; content?: string; timestamp?: string }> = [];
    let finalContent = '';
    let hasError = false;
    let errorMessage: string | undefined;

    try {
      // Run the ADK pipeline and collect events
      for await (const event of runner.runAsync({
        userId,
        sessionId: session.id,
        newMessage: {
          parts: [{ text: goal }],
          role: 'user',
        },
      })) {
        // Collect events for debugging/display
        const author = event.author ?? 'unknown';
        const content = event.content?.parts
          ?.map((p: unknown) => {
            const part = p as { text?: string };
            return part.text ?? '';
          })
          .join('') ?? '';

        if (content) {
          collectedEvents.push({
            author,
            content: content.slice(0, 500), // Truncate for storage
            timestamp: new Date().toISOString(),
          });

          // The last non-user content is the final output
          if (author !== 'user' && content.trim()) {
            finalContent = content;
          }
        }

        // Check for error events
        if (event.errorCode) {
          hasError = true;
          errorMessage = event.errorMessage ?? event.errorCode;
        }

        // Cockpit parity — map the ADK event to JAK activity payloads and
        // forward to the caller's onAgentActivity (if provided). The caller
        // (swarm-execution.service) attaches the SAME translator the
        // LangGraph path uses, so the cockpit SSE + audit log see real-time
        // ADK progress. See mapAdkEventToActivities for the faithful-
        // mapping rationale + the approval-pause caveat.
        if (onAgentActivity) {
          for (const activity of mapAdkEventToActivities(event, workflowId)) {
            try {
              onAgentActivity(activity);
            } catch {
              // A misbehaving activity callback must never break the run.
            }
          }
        }
      }
    } catch (err) {
      hasError = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // 5. Convert to SwarmState-compatible result
    const state: Partial<SwarmState> = {
      status: hasError ? WorkflowStatus.FAILED : WorkflowStatus.COMPLETED,
      error: errorMessage,
      outputs: finalContent ? [finalContent] : [],
      traces: collectedEvents.map((e, i) => {
        // Map ADK event author to AgentRole enum.
        // ADK agents use names like 'Commander', 'Planner', 'CEO_Worker', etc.
        // AgentRole enum has COMMANDER, PLANNER, VERIFIER, WORKER_* etc.
        const authorUpper = e.author.toUpperCase();
        const agentRole = Object.values(AgentRole).includes(authorUpper as AgentRole)
          ? (authorUpper as AgentRole)
          : AgentRole.COMMANDER; // fallback for unknown roles
        return {
          traceId: `adk_${workflowId}`,
          runId: `adk_run_${workflowId}`,
          agentRole,
          stepIndex: i,
          input: goal,
          output: e.content ?? '',
          toolCalls: [],
          handoffs: [],
          startedAt: new Date(),
          completedAt: new Date(),
          durationMs: 0,
        };
      }),
      accumulatedCostUsd: 0,
    };

    return {
      state,
      events: collectedEvents,
      success: !hasError,
      error: errorMessage,
    };
  })); // close withApprovalGate + withJakExecutionContext
}