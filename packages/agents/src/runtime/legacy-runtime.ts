/**
 * LegacyRuntime — wraps the existing BaseAgent.callLLM + executeWithTools
 * path so the rest of the codebase can call through `LLMRuntime` without
 * any behavior change. Phase 2 only ships this implementation.
 *
 * Implementation note: the current BaseAgent owns its own `callLLM` and
 * `executeWithTools` methods which encapsulate retry, provider failover,
 * cost tracking, JSON-mode detection, etc. Rather than duplicating that
 * logic here, LegacyRuntime is constructed AROUND a BaseAgent instance
 * — agents that opt into the runtime simply forward calls to the new
 * surface, and the runtime forwards back to the same private methods.
 *
 * This circular look-up is intentional and minimal-risk for Phase 2. In
 * Phase 4+ we'll start moving call sites OFF `this.callLLM(…)` and ONTO
 * `this.runtime.respond(…)`. At that point LegacyRuntime can stop
 * delegating into BaseAgent and own the logic itself, allowing
 * BaseAgent to shrink.
 */

import type OpenAI from 'openai';
import type { ZodType } from 'zod';
import type { AgentContext } from '../base/agent-context.js';
import type {
  LLMRuntime,
  LLMCallOptions,
  ToolLoopOptions,
  ToolLoopResult,
  StructuredRespondOptions,
} from './llm-runtime.js';

/**
 * Minimal surface BaseAgent must expose for LegacyRuntime to delegate.
 * Avoids importing BaseAgent directly to prevent a circular dep at module
 * load time. BaseAgent satisfies this interface via duck typing.
 */
export interface LegacyAgentBackend {
  callLLMPublic(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[] | undefined,
    options: LLMCallOptions,
  ): Promise<OpenAI.ChatCompletion>;
  executeWithToolsPublic(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[],
    context: AgentContext,
    options: ToolLoopOptions,
  ): Promise<ToolLoopResult>;
}

export class LegacyRuntime implements LLMRuntime {
  readonly name = 'legacy';

  constructor(private readonly backend: LegacyAgentBackend) {}

  async respond(
    messages: OpenAI.ChatCompletionMessageParam[],
    options: LLMCallOptions,
    _context: AgentContext,
  ): Promise<OpenAI.ChatCompletion> {
    return this.backend.callLLMPublic(messages, undefined, options);
  }

  async callTools(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[],
    options: ToolLoopOptions,
    context: AgentContext,
  ): Promise<ToolLoopResult> {
    return this.backend.executeWithToolsPublic(messages, tools, context, options);
  }

  async respondStructured<T>(
    messages: OpenAI.ChatCompletionMessageParam[],
    schema: ZodType<T>,
    options: StructuredRespondOptions,
    context: AgentContext,
  ): Promise<T> {
    // Legacy path: enable JSON mode (provider returns valid JSON), parse,
    // validate against the schema. Throws ZodError on schema mismatch.
    const completion = await this.respond(messages, { ...options, jsonMode: true }, context);
    const raw = completion.choices[0]?.message?.content ?? '';
    const trimmed = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `[LegacyRuntime.respondStructured] LLM did not return valid JSON despite jsonMode. Preview: ${trimmed.slice(0, 200)}. Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return schema.parse(parsed);
  }
}
