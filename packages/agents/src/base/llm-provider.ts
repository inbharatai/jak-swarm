/**
 * LLM Provider abstraction — retained for testability while production execution is OpenAI-only.
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
  model?: string;
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason: string;
}

export interface LLMProvider {
  /** Human-readable provider name. OpenAI is the only execution provider. */
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
     * OpenAI uses structured output / JSON mode. Agents still re-parse
     * defensively so malformed model output becomes a safe error path.
     */
    jsonMode?: boolean;
  }): Promise<LLMResponse>;
}
