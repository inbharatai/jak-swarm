/**
 * GeminiProvider — LLMProvider implementation using the Google Gemini API.
 *
 * Implements the same LLMProvider interface as OpenAIProvider, used by
 * LLMCallService for the legacy callLLM path (Verifier, Planner-replan,
 * reflectAndCorrect). Converts between OpenAI message/tool format and
 * Gemini format internally.
 */

import type { LLMProvider, LLMResponse, MessageContent } from '../llm-provider.js';
import type { ProviderTier } from '../provider-router.js';
import { chatMessagesToGeminiContents, type OpenAIMessage } from '../../runtime/gemini-message-adapter.js';
import { chatToolsToFunctionDeclarations } from '../../runtime/gemini-tool-adapter.js';
import { modelForGeminiTier } from '../../runtime/gemini-model-resolver.js';

const GEMINI_MAX_RETRIES = 3;
const GEMINI_RETRY_BASE_MS = 1000;

export class GeminiProvider implements LLMProvider {
  readonly name = 'google';
  private readonly client: import('@google/generative-ai').GoogleGenerativeAI;
  private readonly explicitModel: string | undefined;
  private readonly defaultTier: ProviderTier;

  constructor(
    apiKey?: string,
    model?: string,
    opts: { tier?: ProviderTier } = {},
  ) {
    const key = apiKey ?? process.env['GEMINI_API_KEY'];
    if (!key) {
      throw new Error('[GeminiProvider] GEMINI_API_KEY is required.');
    }
    const { GoogleGenerativeAI } = require('@google/generative-ai') as typeof import('@google/generative-ai');
    this.client = new GoogleGenerativeAI(key);
    this.explicitModel = model ?? (process.env['GEMINI_MODEL']?.trim() || undefined);
    this.defaultTier = opts.tier ?? 2;
  }

  private resolveModel(): string {
    return this.explicitModel ?? modelForGeminiTier(this.defaultTier);
  }

  async chatCompletion(params: {
    messages: Array<{ role: string; content: string | MessageContent[] | unknown }>;
    tools?: unknown[];
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  }): Promise<LLMResponse> {
    const model = this.resolveModel();

    // Convert messages
    const { contents, systemInstruction } = chatMessagesToGeminiContents(
      params.messages as OpenAIMessage[],
    );

    // systemInstruction is { parts: [{ text }] } — extract the text string
    // because the Gemini SDK's ModelParams.systemInstruction expects
    // string | Part | Content (Content needs role, so plain string is safest).
    const systemText = systemInstruction?.parts?.[0]?.text;
    const geminiModel = this.client.getGenerativeModel({
      model,
      ...(systemText ? { systemInstruction: systemText } : {}),
    });

    const generationConfig: Record<string, unknown> = {};
    if (params.maxTokens) generationConfig.maxOutputTokens = params.maxTokens;
    if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
    if (params.jsonMode) generationConfig.responseMimeType = 'application/json';

    // Convert tools if present
    const toolsConfig = params.tools && Array.isArray(params.tools) && params.tools.length > 0
      ? { tools: [{ functionDeclarations: chatToolsToFunctionDeclarations(params.tools as Array<{ type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } }>) }] }
      : undefined;

    const response = await this.callWithRetry(() =>
      geminiModel.generateContent({
        contents,
        generationConfig,
        ...(toolsConfig ?? {}),
      } as any),
    );

    const geminiResp = response.response as unknown as Record<string, unknown>;
    const candidate = (geminiResp as { candidates?: Array<{ content?: { parts?: unknown[] }; finishReason?: string }> }).candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    // Extract text content
    const textParts = parts.filter(
      (part: unknown) => typeof part === 'object' && part !== null && 'text' in (part as Record<string, unknown>),
    ) as Array<{ text: string }>;
    const content = textParts.map((p) => p.text).join('') || null;

    // Extract tool calls
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    const functionCallParts = parts.filter(
      (part: unknown) => typeof part === 'object' && part !== null && 'functionCall' in (part as Record<string, unknown>),
    ) as Array<{ functionCall: { name: string; args: Record<string, unknown> } }>;
    functionCallParts.forEach((fc, i) => {
      toolCalls.push({
        id: `gemini_tc_${i}`,
        name: fc.functionCall.name,
        arguments: JSON.stringify(fc.functionCall.args),
      });
    });

    // Map finish reason
    const finishReason = candidate?.finishReason ?? 'STOP';
    const finishMap: Record<string, string> = {
      STOP: 'stop',
      MAX_TOKENS: 'length',
      SAFETY: 'content_filter',
      RECITATION: 'content_filter',
    };

    // Map usage
    const usage = (geminiResp as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }).usageMetadata;
    const promptTokens = usage?.promptTokenCount ?? 0;
    const completionTokens = usage?.candidatesTokenCount ?? 0;

    return {
      model,
      content,
      toolCalls,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      finishReason: toolCalls.length > 0 ? 'tool_calls' : (finishMap[finishReason] ?? 'stop'),
    };
  }

  private async callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message.toLowerCase();
        const isRetryable =
          msg.includes('429') || msg.includes('rate') || msg.includes('quota') ||
          msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504');
        if (!isRetryable || attempt === GEMINI_MAX_RETRIES - 1) throw lastError;
        await new Promise((resolve) => setTimeout(resolve, GEMINI_RETRY_BASE_MS * Math.pow(2, attempt)));
      }
    }
    throw lastError;
  }
}