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
import type { ToolMetadata, ToolExecutionContext } from '@jak-swarm/shared';
import { buildAdkPipeline, buildSimpleAdkPipeline, type AdkPipelineConfig } from './adk-pipeline.js';
import { setJakExecutionContext, clearJakExecutionContext } from '../bridge/jak-tool-bridge.js';
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
  } = params;

  // 1. Set the JAK execution context for tool bridge callbacks
  setJakExecutionContext(toolContext);

  try {
    // 2. Build the ADK pipeline
    const pipelineConfig: AdkPipelineConfig = {
      provider,
      jakToolMetadata,
      workerRoles: workerRoles ?? ['CEO'],
      allowedToolNames,
      includeSearch: googleSearchGrounding || openaiWebSearch || true, // Search on by default in ADK mode
    };

    const pipeline = workerRoles && workerRoles.length > 1
      ? buildAdkPipeline(pipelineConfig)
      : buildSimpleAdkPipeline(pipelineConfig);

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
  } finally {
    // Always clear the execution context
    clearJakExecutionContext();
  }
}

/**
 * Check if ADK mode is enabled via environment variable.
 */
export function isAdkModeEnabled(): boolean {
  return process.env['JAK_ADK_MODE']?.trim() === '1';
}