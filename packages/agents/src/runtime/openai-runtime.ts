/**
 * OpenAIRuntime — Phase 3 implementation of LLMRuntime using the OpenAI
 * Responses API (`/v1/responses`) plus optional hosted tools (web_search,
 * file_search, code_interpreter, computer_use).
 *
 * Output is mapped back to the ChatCompletion shape every existing caller
 * already knows, so flipping an agent from LegacyRuntime → OpenAIRuntime in
 * Phase 4 requires zero changes to that agent's parsing logic.
 *
 * Tool loop (`callTools`) is implemented inline here — not delegated back
 * to BaseAgent — because the Responses API expects a different `previous_
 * response_id` continuation pattern than Chat Completions' message-array
 * appending. We use the message-array pattern (input: messages) with each
 * round, which the Responses API also accepts and is closer to what the
 * legacy executeWithTools loop already does.
 */

import OpenAI from 'openai';
import { calculateCost } from '@jak-swarm/shared';
import type { AgentContext } from '../base/agent-context.js';
import type {
  LLMRuntime,
  LLMCallOptions,
  ToolLoopOptions,
  ToolLoopResult,
} from './llm-runtime.js';
import {
  adaptChatToolsToResponses,
  type HostedToolsConfig,
} from './openai-tool-adapter.js';
import { responsesToChatCompletion } from './openai-response-parser.js';

const DEFAULT_MODEL = process.env['OPENAI_MODEL'] ?? 'gpt-4o';
const MAX_TOOL_LOOP_ITERATIONS_DEFAULT = 5;

/**
 * Per-call hosted-tool opt-in. Pass through `options.hostedTools` on
 * `respond` / `callTools` to enable web_search / file_search / etc.
 * Zero impact on existing function-tool callers that don't set it.
 */
export interface OpenAIRuntimeCallOptions extends LLMCallOptions {
  hostedTools?: HostedToolsConfig;
  /** Override the default OpenAI model for this call. */
  model?: string;
}

export interface OpenAIRuntimeToolLoopOptions extends ToolLoopOptions {
  hostedTools?: HostedToolsConfig;
  model?: string;
}

export class OpenAIRuntime implements LLMRuntime {
  readonly name = 'openai-responses';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error(
        '[OpenAIRuntime] OPENAI_API_KEY is required. Set it in env or pass to constructor.',
      );
    }
    this.client = new OpenAI({ apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  async respond(
    messages: OpenAI.ChatCompletionMessageParam[],
    options: LLMCallOptions,
    _context: AgentContext,
  ): Promise<OpenAI.ChatCompletion> {
    const opts = options as OpenAIRuntimeCallOptions;
    const tools = adaptChatToolsToResponses(undefined, opts.hostedTools);
    const resp = await this.client.responses.create({
      model: opts.model ?? this.model,
      input: chatMessagesToResponsesInput(messages),
      ...(tools.length > 0 ? { tools } : {}),
      ...(opts.maxTokens !== undefined ? { max_output_tokens: opts.maxTokens } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.jsonMode ? { text: { format: { type: 'json_object' as const } } } : {}),
    });
    return responsesToChatCompletion(resp);
  }

  /**
   * Multi-turn tool loop. Mirrors BaseAgent.executeWithTools semantics:
   * call → execute tool calls → append results → call again → ... until
   * LLM emits a final text response or maxIterations reached.
   *
   * Tool execution is delegated to the caller via `context` carrying the
   * tool registry — the runtime itself never invokes a tool. Phase 3
   * keeps the tool execution contract identical to the legacy path so
   * callers pass through unchanged.
   */
  async callTools(
    initialMessages: OpenAI.ChatCompletionMessageParam[],
    chatTools: OpenAI.ChatCompletionTool[],
    options: ToolLoopOptions,
    context: AgentContext,
  ): Promise<ToolLoopResult> {
    const opts = options as OpenAIRuntimeToolLoopOptions;
    const responsesTools = adaptChatToolsToResponses(chatTools, opts.hostedTools);
    const maxIter = opts.maxIterations ?? MAX_TOOL_LOOP_ITERATIONS_DEFAULT;

    const messages: OpenAI.ChatCompletionMessageParam[] = [...initialMessages];
    const allToolCalls: ToolLoopResult['toolCalls'] = [];
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalCostUsd = 0;
    let lastContent = '';

    // Tool execution must come from the caller's context. We import the
    // tenant-scoped registry lazily to avoid a hard dep on @jak-swarm/tools.
    const { getTenantToolRegistry } = await import('@jak-swarm/tools');
    const tenantRegistry = getTenantToolRegistry(
      context.tenantId ?? '',
      context.connectedProviders,
      {
        browserAutomationEnabled: context.browserAutomationEnabled,
        restrictedCategories: context.restrictedCategories,
        disabledToolNames: context.disabledToolNames,
      },
    );
    const toolExecContext = {
      tenantId: context.tenantId ?? '',
      userId: context.userId ?? '',
      workflowId: context.workflowId ?? '',
      runId: context.runId,
      approvalId: context.approvalId,
      idempotencyKey: context.idempotencyKey,
      allowedDomains: context.allowedDomains,
      subscriptionTier: context.subscriptionTier,
    };

    for (let iter = 0; iter < maxIter; iter++) {
      const resp = await this.client.responses.create({
        model: opts.model ?? this.model,
        input: chatMessagesToResponsesInput(messages),
        ...(responsesTools.length > 0 ? { tools: responsesTools } : {}),
        ...(opts.maxTokens !== undefined ? { max_output_tokens: opts.maxTokens } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.jsonMode ? { text: { format: { type: 'json_object' as const } } } : {}),
      });

      if (resp.usage) {
        totalPrompt += resp.usage.input_tokens ?? 0;
        totalCompletion += resp.usage.output_tokens ?? 0;
        totalCostUsd += calculateCost(
          resp.model,
          resp.usage.input_tokens ?? 0,
          resp.usage.output_tokens ?? 0,
        );
      }

      const completion = responsesToChatCompletion(resp);
      const choice = completion.choices[0];
      const assistantMsg = choice?.message;
      if (!assistantMsg) break;

      // If no tool calls, this is the final response — we're done.
      const toolCalls = assistantMsg.tool_calls ?? [];
      if (toolCalls.length === 0) {
        lastContent = assistantMsg.content ?? '';
        break;
      }

      // Append the assistant message (with tool_calls) to the conversation
      messages.push({
        role: 'assistant',
        content: assistantMsg.content ?? null,
        tool_calls: toolCalls,
      });

      // Execute each tool call through the tenant registry, append result.
      for (const tc of toolCalls) {
        const startedAt = new Date();
        let resultContent: string;
        let parsedArgs: Record<string, unknown> = {};
        let resultObj: unknown = null;
        let toolError: string | undefined;
        try {
          parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          if (!tenantRegistry.has(tc.function.name)) {
            toolError = `Tool '${tc.function.name}' is not available for this tenant`;
            resultObj = { error: toolError };
            resultContent = JSON.stringify(resultObj);
          } else {
            resultObj = await tenantRegistry.execute(tc.function.name, parsedArgs, toolExecContext);
            resultContent = typeof resultObj === 'string' ? resultObj : JSON.stringify(resultObj);
          }
        } catch (err) {
          toolError = err instanceof Error ? err.message : String(err);
          resultObj = { error: toolError };
          resultContent = JSON.stringify(resultObj);
        }
        const completedAt = new Date();

        allToolCalls.push({
          toolName: tc.function.name,
          input: parsedArgs,
          output: resultObj,
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          ...(toolError ? { error: toolError } : {}),
        });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultContent,
        });
      }

      // Loop continues — next iteration sends accumulated messages back.
    }

    return {
      content: lastContent,
      toolCalls: allToolCalls,
      totalTokens: { prompt: totalPrompt, completion: totalCompletion, total: totalPrompt + totalCompletion },
      totalCostUsd,
    };
  }
}

/**
 * Convert ChatCompletion message array into the Responses-API `input` shape.
 * The Responses API accepts either a string or an `EasyInputMessage[]` /
 * `ResponseInputItem[]`. Easiest 1:1 mapping: turn each chat message into
 * an EasyInputMessage with the same role + content. Tool messages become
 * `function_call_output` items.
 */
function chatMessagesToResponsesInput(
  messages: OpenAI.ChatCompletionMessageParam[],
): OpenAI.Responses.ResponseInput {
  const input: OpenAI.Responses.ResponseInput = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: m.tool_call_id,
        output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      // Emit each tool_call as a function_call item; assistant text (if any)
      // emitted as a separate message before the calls.
      if (m.content && typeof m.content === 'string' && m.content.length > 0) {
        input.push({ type: 'message', role: 'assistant', content: m.content } as OpenAI.Responses.EasyInputMessage);
      }
      for (const tc of m.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
      continue;
    }
    // Plain message (system / user / assistant text)
    const role = m.role as 'system' | 'user' | 'assistant' | 'developer';
    input.push({
      type: 'message',
      role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
    } as OpenAI.Responses.EasyInputMessage);
  }
  return input;
}
