/**
 * LLMRuntime — JAK-owned interface for all LLM calls.
 *
 * Phase 2 of the OpenAI-first migration introduces this as the single
 * abstraction every agent will eventually call through. The current legacy
 * path (BaseAgent.callLLM + ProviderRouter + 6 providers) lives behind
 * `LegacyRuntime`. Phase 3 adds `OpenAIRuntime` (Responses API + hosted
 * tools). Phases 4 and 7 flip agents from Legacy → OpenAI one by one.
 *
 * Invariant: agents never import the OpenAI SDK directly. They get an
 * `LLMRuntime` from `getRuntime(role)` and call `respond` / `callTools`.
 */

import type OpenAI from 'openai';
import type { AgentContext } from '../base/agent-context.js';

/**
 * Options accepted by every runtime call. Mirror the shape `BaseAgent.callLLM`
 * already accepts so wrapping the legacy path is a pure passthrough.
 */
export interface LLMCallOptions {
  maxTokens?: number;
  temperature?: number;
  /**
   * When true, instruct the provider to return a strict JSON object.
   * OpenAI uses `response_format: { type: 'json_object' }`. Gemini's
   * OpenAI-compatible endpoint supports the same. Providers that don't
   * support it may ignore it — agents always re-parse defensively.
   */
  jsonMode?: boolean;
}

/**
 * Tool-loop options accepted by `callTools`. Same shape `executeWithTools`
 * uses today so the runtime swap is wire-compatible.
 */
export interface ToolLoopOptions extends LLMCallOptions {
  maxIterations?: number;
  /**
   * When true, after the loop finishes the agent reflects on its own output
   * and may produce a corrected response. Used by content-heavy agents.
   */
  selfCorrect?: boolean;
}

/**
 * `ToolLoopResult` mirrors the shape BaseAgent already returns from
 * `executeWithTools`. Defined here (not imported from BaseAgent) to avoid
 * a circular module dep — TS structural typing makes the two interfaces
 * interchangeable as long as the fields stay aligned. Phase 6 will lift
 * this into `@jak-swarm/shared` and have BaseAgent import from there.
 */
import type { ToolCall } from '@jak-swarm/shared';
export type { ToolCall as ToolCallTrace } from '@jak-swarm/shared';

export interface ToolLoopResult {
  /** Final text content from the LLM after all tool calls complete */
  content: string;
  /** All tool calls executed during the loop */
  toolCalls: ToolCall[];
  /** Total tokens used across all LLM calls */
  totalTokens: { prompt: number; completion: number; total: number };
  /** Total estimated cost in USD across all LLM calls */
  totalCostUsd: number;
}

/**
 * The single LLM execution interface every agent uses.
 *
 * Today only `respond` and `callTools` are implemented — those map 1:1 to
 * the legacy `callLLM` and `executeWithTools` methods. `plan` and
 * `executeSandboxTask` are reserved for future migration phases (Phase 4
 * adds structured-output planning via Responses API; Phase 6 adds sandbox
 * agent execution). Implementations may throw `NotImplementedError` for
 * the unused methods until those phases land.
 */
export interface LLMRuntime {
  /** Human-readable runtime name for telemetry (e.g. 'legacy', 'openai-responses'). */
  readonly name: string;

  /**
   * Single-turn LLM call with no tools. Returns the OpenAI ChatCompletion
   * shape so existing callers don't need to change parsing logic.
   */
  respond(
    messages: OpenAI.ChatCompletionMessageParam[],
    options: LLMCallOptions,
    context: AgentContext,
  ): Promise<OpenAI.ChatCompletion>;

  /**
   * Multi-turn tool loop: send messages + tools, execute tool calls, send
   * results back, repeat until the LLM emits a final text response.
   */
  callTools(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[],
    options: ToolLoopOptions,
    context: AgentContext,
  ): Promise<ToolLoopResult>;
}

export class NotImplementedError extends Error {
  constructor(method: string, runtime: string) {
    super(`LLMRuntime '${runtime}' does not implement ${method}() yet.`);
    this.name = 'NotImplementedError';
  }
}
