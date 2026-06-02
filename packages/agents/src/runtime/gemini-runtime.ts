/**
 * GeminiRuntime — LLMRuntime implementation using the Google Gemini API.
 *
 * Implements the same LLMRuntime interface as OpenAIRuntime, converting
 * between OpenAI message/tool format and Gemini format internally.
 * Output is mapped back to the ChatCompletion shape every existing caller
 * already knows, so switching an agent from OpenAIRuntime → GeminiRuntime
 * requires zero changes to that agent's parsing logic.
 *
 * Key differences from OpenAIRuntime:
 * - Uses `@google/generative-ai` SDK instead of `openai`
 * - Gemini's `responseSchema` is less strict than OpenAI's `json_schema`
 *   strict mode — zod validation catches any format drift
 * - Tool calls use `functionCall`/`functionResponse` parts instead of
 *   OpenAI's `tool_calls`/`role: 'tool'` message format
 * - No Responses API equivalent — uses `generateContent()` for all calls
 */

import type OpenAI from 'openai';
import type { ZodType } from 'zod';
import { calculateCost } from '@jak-swarm/shared';
import type { AgentContext } from '../base/agent-context.js';
import type {
  LLMRuntime,
  LLMCallOptions,
  ToolLoopOptions,
  ToolLoopResult,
  StructuredRespondOptions,
} from './llm-runtime.js';
import type { ProviderTier } from '../base/provider-router.js';
import { chatMessagesToGeminiContents } from './gemini-message-adapter.js';
import { chatToolsToFunctionDeclarations } from './gemini-tool-adapter.js';
import { geminiResponseToChatCompletion, geminiResponseIsBlocked } from './gemini-response-parser.js';
import { modelForGeminiTier, getDefaultGeminiModel } from './gemini-model-resolver.js';

const MAX_TOOL_LOOP_ITERATIONS_DEFAULT = 10;
const DEFAULT_TIER: ProviderTier = 2;
const GEMINI_MAX_RETRIES = 3;
const GEMINI_RETRY_BASE_MS = 1000;

// ─── Gemini SDK type stubs (loaded dynamically) ───────────────────────────────
// We import the SDK lazily so it's never loaded when LLM_PROVIDER=existing.

type GoogleGenerativeAI = import('@google/generative-ai').GoogleGenerativeAI;
type GenerativeModel = import('@google/generative-ai').GenerativeModel;
type GenerateContentResult = import('@google/generative-ai').GenerateContentResult;

export class GeminiRuntime implements LLMRuntime {
  readonly name = 'gemini';
  private readonly client: GoogleGenerativeAI;
  private readonly explicitModel: string | undefined;
  private readonly defaultTier: ProviderTier;
  private readonly requestTimeoutMs: number;

  constructor(opts: { apiKey?: string; model?: string; tier?: ProviderTier } = {}) {
    const apiKey = opts.apiKey ?? process.env['GEMINI_API_KEY'];
    if (!apiKey) {
      throw new Error(
        '[GeminiRuntime] GEMINI_API_KEY is required. Set it in env or pass to constructor.',
      );
    }
    // Dynamic import would be ideal but constructor needs synchronous init.
    // The @google/generative-ai package is imported at the top level but
    // only instantiated when GeminiRuntime is constructed (which only happens
    // when LLM_PROVIDER=gemini).
    const { GoogleGenerativeAI: GenAI } = require('@google/generative-ai') as typeof import('@google/generative-ai');
    this.client = new GenAI(apiKey);
    this.explicitModel = opts.model ?? (process.env['GEMINI_MODEL']?.trim() || undefined);
    this.defaultTier = opts.tier ?? DEFAULT_TIER;
    this.requestTimeoutMs = parseInt(process.env['GEMINI_REQUEST_TIMEOUT_MS'] ?? '60000', 10);
  }

  // ─── resolveModel ─────────────────────────────────────────────────────────

  private resolveModel(tier?: ProviderTier): string {
    return this.explicitModel ?? modelForGeminiTier(tier ?? this.defaultTier);
  }

  // ─── getModel ─────────────────────────────────────────────────────────────

  private getModel(model: string, systemInstruction?: { parts: [{ text: string }] }): GenerativeModel {
    return this.client.getGenerativeModel({
      model,
      ...(systemInstruction ? { systemInstruction } : {}),
    });
  }

  // ─── respond ──────────────────────────────────────────────────────────────

  async respond(
    messages: OpenAI.ChatCompletionMessageParam[],
    options: LLMCallOptions,
    context: AgentContext,
  ): Promise<OpenAI.ChatCompletion> {
    const model = this.resolveModel();
    const { contents, systemInstruction } = chatMessagesToGeminiContents(
      messages as Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | unknown[] | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }>,
    );

    const geminiModel = this.getModel(model, systemInstruction);
    const generationConfig: Record<string, unknown> = {};
    if (options.maxTokens) generationConfig.maxOutputTokens = options.maxTokens;
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.jsonMode) generationConfig.responseMimeType = 'application/json';

    const response = await this.callWithRetry(() =>
      geminiModel.generateContent({ contents, generationConfig }),
    );

    const chatCompletion = geminiResponseToChatCompletion(
      response.response as unknown as Record<string, unknown>,
      model,
    );

    // Record usage
    this.recordUsage(response.response as unknown as Record<string, unknown>, model, context);

    return chatCompletion as OpenAI.ChatCompletion;
  }

  // ─── callTools ─────────────────────────────────────────────────────────────

  async callTools(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[],
    options: ToolLoopOptions,
    context: AgentContext,
  ): Promise<ToolLoopResult> {
    const model = this.resolveModel();
    const maxIterations = options.maxIterations ?? MAX_TOOL_LOOP_ITERATIONS_DEFAULT;
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalCostUsd = 0;

    // Convert tools once
    const functionDeclarations = chatToolsToFunctionDeclarations(
      tools as Array<{ type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } }>,
    );

    // Working copy of messages for the loop
    const workingMessages = [...messages];

    // Lazy import to avoid circular dep
    const { getTenantToolRegistry } = await import('@jak-swarm/tools');

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const { contents, systemInstruction } = chatMessagesToGeminiContents(
        workingMessages as Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | unknown[] | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }>,
      );

      const geminiModel = this.getModel(model, systemInstruction);
      const generationConfig: Record<string, unknown> = {};
      if (options.maxTokens) generationConfig.maxOutputTokens = options.maxTokens;
      if (options.temperature !== undefined) generationConfig.temperature = options.temperature;

      const toolsConfig = functionDeclarations.length > 0
        ? { tools: [{ functionDeclarations }] }
        : undefined;

      const response = await this.callWithRetry(() =>
        geminiModel.generateContent({
          contents,
          generationConfig,
          ...(toolsConfig ?? {}),
        }),
      );

      const geminiResp = response.response as unknown as Record<string, unknown>;

      // Track usage
      const usage = (geminiResp as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? 0;
      const completionTokens = usage?.candidatesTokenCount ?? 0;
      totalPrompt += promptTokens;
      totalCompletion += completionTokens;
      totalCostUsd += calculateCost(model, promptTokens, completionTokens);

      // Check for tool calls
      const candidate = (geminiResp as { candidates?: Array<{ content?: { parts?: unknown[] } }> }).candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const hasToolCalls = parts.some(
        (part: unknown) => typeof part === 'object' && part !== null && 'functionCall' in (part as Record<string, unknown>),
      );

      if (!hasToolCalls) {
        // No tool calls — extract final text and return
        const textParts = parts.filter(
          (part: unknown) => typeof part === 'object' && part !== null && 'text' in (part as Record<string, unknown>),
        ) as Array<{ text: string }>;
        const content = textParts.map((p) => p.text).join('');

        this.recordUsage(geminiResp, model, context);

        return {
          content,
          toolCalls: [],
          totalTokens: { prompt: totalPrompt, completion: totalCompletion, total: totalPrompt + totalCompletion },
          totalCostUsd,
        };
      }

      // Execute tool calls
      const functionCalls = parts.filter(
        (part: unknown) => typeof part === 'object' && part !== null && 'functionCall' in (part as Record<string, unknown>),
      ) as Array<{ functionCall: { name: string; args: Record<string, unknown> } }>;

      for (const fc of functionCalls) {
        const toolName = fc.functionCall.name;
        const toolArgs = fc.functionCall.args;

        try {
          const tenantRegistry = getTenantToolRegistry(context.tenantId);
          const toolResult = await tenantRegistry.execute(toolName, toolArgs, {
            tenantId: context.tenantId,
            userId: context.userId,
            workflowId: context.workflowId,
            runId: context.runId,
          });

          // Append tool result as a function response message
          workingMessages.push({
            role: 'tool',
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            tool_call_id: `gemini_tc_${toolName}`,
            name: toolName,
          } as OpenAI.ChatCompletionMessageParam);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          workingMessages.push({
            role: 'tool',
            content: JSON.stringify({ error: errorMsg }),
            tool_call_id: `gemini_tc_${toolName}`,
            name: toolName,
          } as OpenAI.ChatCompletionMessageParam);
        }
      }
    }

    // Max iterations reached — return whatever we have
    this.recordUsage(
      (response.response as unknown as Record<string, unknown>),
      model,
      context,
    );

    return {
      content: '',
      toolCalls: [],
      totalTokens: { prompt: totalPrompt, completion: totalCompletion, total: totalPrompt + totalCompletion },
      totalCostUsd,
    };
  }

  // ─── respondStructured ────────────────────────────────────────────────────

  async respondStructured<T>(
    messages: OpenAI.ChatCompletionMessageParam[],
    schema: ZodType<T>,
    options: StructuredRespondOptions,
    context: AgentContext,
  ): Promise<T> {
    const model = this.resolveModel();
    const { contents, systemInstruction } = chatMessagesToGeminiContents(
      messages as Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | unknown[] | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }>,
    );

    const geminiModel = this.getModel(model, systemInstruction);

    // Convert zod schema to JSON Schema for Gemini's responseSchema
    // Use the same zod-to-json-schema package that OpenAIRuntime uses
    let jsonSchema: Record<string, unknown>;
    try {
      const zodToJsonSchema = await import('zod-to-json-schema');
      jsonSchema = zodToJsonSchema.default(schema, {
        name: options.schemaName ?? 'response',
        description: options.schemaDescription,
      }) as Record<string, unknown>;
      // Remove $schema — Gemini doesn't need it
      delete jsonSchema.$schema;
    } catch {
      throw new Error('[GeminiRuntime] Failed to convert zod schema to JSON Schema for structured output.');
    }

    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
      responseSchema: jsonSchema,
    };
    if (options.maxTokens) generationConfig.maxOutputTokens = options.maxTokens;
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;

    const response = await this.callWithRetry(() =>
      geminiModel.generateContent({ contents, generationConfig }),
    );

    const geminiResp = response.response as unknown as Record<string, unknown>;

    // Extract text and parse as JSON
    const candidate = (geminiResp as { candidates?: Array<{ content?: { parts?: unknown[] }; finishReason?: string }> }).candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const textParts = parts.filter(
      (part: unknown) => typeof part === 'object' && part !== null && 'text' in (part as Record<string, unknown>),
    ) as Array<{ text: string }>;
    const rawText = textParts.map((p) => p.text).join('');

    if (!rawText.trim()) {
      // Check if blocked by safety
      if (geminiResponseIsBlocked(geminiResp)) {
        throw new Error('[GeminiRuntime] Response blocked by safety filters during structured output generation.');
      }
      throw new Error('[GeminiRuntime] Empty response from Gemini during structured output generation.');
    }

    // Parse JSON — Gemini's responseSchema is best-effort, so we always
    // validate with zod on top (same as LegacyRuntime pattern)
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(`[GeminiRuntime] Failed to parse structured output as JSON. Raw: ${rawText.slice(0, 200)}`);
    }

    // Zod validation catches any format drift from Gemini's responseSchema
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `[GeminiRuntime] Structured output failed zod validation: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }

    // Record usage
    this.recordUsage(geminiResp, model, context);

    return result.data;
  }

  // ─── Usage recording ──────────────────────────────────────────────────────

  private recordUsage(
    geminiResponse: Record<string, unknown>,
    model: string,
    context: AgentContext,
  ): void {
    const usage = (geminiResponse as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
    if (!usage) return;

    const promptTokens = usage.promptTokenCount ?? 0;
    const completionTokens = usage.candidatesTokenCount ?? 0;
    const costUsd = calculateCost(model, promptTokens, completionTokens);

    context.recordLLMUsage({
      runtime: this.name,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cachedReadTokens: 0,
      reasoningTokens: 0,
      costUsd,
      timestamp: new Date().toISOString(),
    });

    context.emitActivity({
      type: 'cost_updated',
      runtime: this.name,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      runId: context.runId,
    });
  }

  // ─── Retry logic ──────────────────────────────────────────────────────────

  private async callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRetryable = this.isRetryableError(lastError);
        if (!isRetryable || attempt === GEMINI_MAX_RETRIES - 1) {
          throw lastError;
        }
        const delay = GEMINI_RETRY_BASE_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private isRetryableError(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('rate') ||
      msg.includes('quota') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('internal server error') ||
      msg.includes('overloaded') ||
      msg.includes('capacity')
    );
  }
}