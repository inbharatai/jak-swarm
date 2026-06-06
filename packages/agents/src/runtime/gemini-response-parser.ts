/**
 * Gemini Response Parser — converts Gemini API responses to OpenAI shapes.
 *
 * Pure functions with no SDK dependency. Converts
 * `GenerateContentResponse` shapes to `OpenAI.ChatCompletion` so callers
 * can parse Gemini results using the same code they use for OpenAI.
 */

// ─── Gemini response types (mirrored to avoid eager import) ───────────────────

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
    role?: string;
  };
  finishReason?: string;
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } };

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

// ─── OpenAI response types (subset needed for conversion) ─────────────────────

interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Finish reason mapping ───────────────────────────────────────────────────

const FINISH_REASON_MAP: Record<string, string> = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
  RECITATION: 'content_filter',
  OTHER: 'stop',
};

// ─── Conversion ──────────────────────────────────────────────────────────────

/**
 * Convert a Gemini GenerateContentResponse to an OpenAI ChatCompletion shape.
 *
 * This is the core bridge: every GeminiRuntime method that returns
 * ChatCompletion uses this parser.
 */
export function geminiResponseToChatCompletion(
  response: GeminiGenerateContentResponse,
  model: string,
): OpenAIChatCompletion {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const finishReason = candidate?.finishReason ?? 'STOP';

  // Extract text and tool calls from parts
  let textContent: string | null = null;
  const toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if ('text' in part && part.text) {
      textContent = (textContent ?? '') + part.text;
    } else if ('functionCall' in part && part.functionCall) {
      toolCalls.push({
        id: `gemini_tc_${i}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args),
        },
      });
    }
  }

  // Map Gemini finish reason to OpenAI finish_reason
  const mappedFinish = toolCalls.length > 0
    ? 'tool_calls'
    : (FINISH_REASON_MAP[finishReason] ?? 'stop');

  // Map usage metadata
  const usage = response.usageMetadata ?? {};
  const promptTokens = usage.promptTokenCount ?? 0;
  const completionTokens = usage.candidatesTokenCount ?? 0;
  const totalTokens = usage.totalTokenCount ?? (promptTokens + completionTokens);

  return {
    id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: textContent,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: mappedFinish,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
  };
}

/**
 * Extract just the text content from a Gemini response.
 * Used for simple respond() calls where tool calls aren't expected.
 */
export function extractTextFromGeminiResponse(
  response: GeminiGenerateContentResponse,
): string {
  const candidate = response.candidates?.[0];
  if (!candidate?.content?.parts) return '';

  return candidate.content.parts
    .filter((part): part is { text: string } => 'text' in part && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

/**
 * Extract function calls from a Gemini response.
 * Returns empty array if no function calls present.
 */
export function extractFunctionCallsFromGeminiResponse(
  response: GeminiGenerateContentResponse,
): Array<{ name: string; args: Record<string, unknown> }> {
  const candidate = response.candidates?.[0];
  if (!candidate?.content?.parts) return [];

  return candidate.content.parts
    .filter((part): part is { functionCall: { name: string; args: Record<string, unknown> } } =>
      'functionCall' in part && part.functionCall != null,
    )
    .map((part) => ({
      name: part.functionCall.name,
      args: part.functionCall.args,
    }));
}

/**
 * Check if a Gemini response contains function calls (tool calls).
 */
export function geminiResponseHasToolCalls(
  response: GeminiGenerateContentResponse,
): boolean {
  const candidate = response.candidates?.[0];
  if (!candidate?.content?.parts) return false;
  return candidate.content.parts.some((part) => 'functionCall' in part && part.functionCall != null);
}

/**
 * Check if a Gemini response was blocked by safety filters.
 */
export function geminiResponseIsBlocked(
  response: GeminiGenerateContentResponse,
): boolean {
  const finishReason = response.candidates?.[0]?.finishReason;
  return finishReason === 'SAFETY' || finishReason === 'RECITATION';
}

// ─── Grounding metadata ───────────────────────────────────────────────────
// When Google Search grounding or Vertex AI Search is enabled, the Gemini
// API returns groundingMetadata on the candidate. This includes web search
// queries, source URLs (grounding chunks), and per-claim support mapping.
// All fields are optional — older Gemini models or non-grounded calls omit them.

export interface GeminiGroundingMetadata {
  /** Search queries the model executed internally via Google Search. */
  webSearchQueries?: string[];
  /** Source URLs and titles from grounding. */
  groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  /** Links response text segments to specific grounding chunks. */
  groundingSupports?: Array<{
    groundingChunkIndices: number[];
    segment: { start_index: number; end_index: number; text: string };
    confidenceScore?: number;
  }>;
  /** HTML/CSS rendered content for Google Search Suggestions (ToS requirement). */
  searchEntryPoint?: { renderedContent?: string };
}

/**
 * Extract grounding metadata from a Gemini response.
 * Returns undefined if no grounding metadata is present (non-grounded calls).
 */
export function extractGroundingMetadata(
  response: Record<string, unknown>,
): GeminiGroundingMetadata | undefined {
  const candidate = (response as { candidates?: Array<Record<string, unknown>> }).candidates?.[0];
  if (!candidate) return undefined;

  const gm = candidate.groundingMetadata as Record<string, unknown> | undefined;
  if (!gm) return undefined;

  return {
    webSearchQueries: Array.isArray(gm.webSearchQueries)
      ? gm.webSearchQueries as string[]
      : undefined,
    groundingChunks: Array.isArray(gm.groundingChunks)
      ? gm.groundingChunks as GeminiGroundingMetadata['groundingChunks']
      : undefined,
    groundingSupports: Array.isArray(gm.groundingSupports)
      ? gm.groundingSupports as GeminiGroundingMetadata['groundingSupports']
      : undefined,
    searchEntryPoint: gm.searchEntryPoint as GeminiGroundingMetadata['searchEntryPoint'] ?? undefined,
  };
}