/**
 * LLM Provider abstraction — allows swapping between OpenAI, Anthropic, and other providers.
 */

// ─── Multi-modal vision content types ────────────────────────────────────────

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export type MessageContent = TextContent | ImageContent;

// ─────────────────────────────────────────────────────────────────────────────

export interface LLMResponse {
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason: string;
}

export interface LLMProvider {
  /** Human-readable provider name (e.g. 'openai', 'anthropic') */
  name: string;

  /**
   * Send a chat completion request to the LLM.
   */
  chatCompletion(params: {
    messages: Array<{ role: string; content: string | MessageContent[] | unknown }>;
    tools?: unknown[];
    maxTokens?: number;
    temperature?: number;
    /**
     * When true, instruct the provider to return a strict JSON object.
     * OpenAI uses `response_format: { type: 'json_object' }`. Gemini's
     * OpenAI-compatible endpoint supports the same. Providers that don't
     * support it may ignore it — agents always re-parse defensively.
     */
    jsonMode?: boolean;
  }): Promise<LLMResponse>;
}
