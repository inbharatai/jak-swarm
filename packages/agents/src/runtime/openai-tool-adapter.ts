/**
 * Adapt ChatCompletionTool[] (the format every existing agent already uses)
 * into the Responses API tool spec.
 *
 * Function tools translate 1:1 — Responses uses a flatter `{ type: 'function',
 * name, description, parameters }` instead of Chat's nested
 * `{ type: 'function', function: { name, description, parameters } }`.
 *
 * Production hosted tools we support:
 *   - web_search        — OpenAI-hosted web search (stable since Responses API v2)
 *   - file_search       — OpenAI-hosted RAG over caller-supplied vector stores
 *   - code_interpreter  — sandboxed Python execution
 *
 * Provider-native search strategy:
 *   - Gemini: Google Search grounding ({ googleSearch: {} }) in GeminiRuntime
 *   - OpenAI: web_search hosted tool here
 *   - Both provide real-time web access without paid Serper/Tavily keys.
 *   - JAK's existing tool-registry web_search (Serper→Tavily→DDG) remains as
 *     the custom FunctionTool path for backward compatibility.
 */

import type OpenAI from 'openai';

/**
 * Hosted tools the OpenAIRuntime can expose. Opt-in per call site.
 * These tools execute server-side at OpenAI — no client-side execution.
 *
 * Every option here must be a STABLE (non-preview) Responses API feature.
 */
export interface HostedToolsConfig {
  /** Enable OpenAI's hosted web_search tool. Provides real-time web access
   *  natively — no Serper/Tavily API keys needed. Mirrors Gemini's
   *  Google Search grounding for provider parity. */
  webSearch?: boolean | { searchContextSize?: 'low' | 'medium' | 'high'; userLocation?: { city?: string; country?: string; region?: string; timezone?: string } };
  fileSearch?: { vectorStoreIds: string[]; maxNumResults?: number };
  codeInterpreter?: boolean | { container?: { type: 'auto' } };
}

/**
 * Combined Responses-API tool input. The OpenAI SDK accepts `Tool[]` which
 * is a union of FunctionTool, FileSearchTool, CodeInterpreterTool, etc.
 * We build that union from the Chat-style functions the caller already has
 * plus any hosted tools they've opted into.
 */
export type ResponsesTool = OpenAI.Responses.Tool;

export function adaptChatToolsToResponses(
  chatTools: OpenAI.ChatCompletionTool[] | undefined,
  hosted?: HostedToolsConfig,
): ResponsesTool[] {
  const out: ResponsesTool[] = [];

  // Chat-style function tools → Responses FunctionTool
  if (chatTools) {
    for (const t of chatTools) {
      if (t.type !== 'function' || !t.function) continue;
      out.push({
        type: 'function',
        name: t.function.name,
        description: t.function.description ?? null,
        parameters: (t.function.parameters as Record<string, unknown> | undefined) ?? {},
        strict: false,
      });
    }
  }

  // Hosted tools — stable surfaces only, included when caller explicitly opts in
  if (hosted?.webSearch) {
    const cfg = typeof hosted.webSearch === 'object' ? hosted.webSearch : {};
    out.push({
      type: 'web_search_preview',
      ...(cfg.searchContextSize ? { search_context_size: cfg.searchContextSize } : {}),
      ...(cfg.userLocation ? { user_location: cfg.userLocation } : {}),
    } as ResponsesTool);
  }
  if (hosted?.fileSearch) {
    out.push({
      type: 'file_search',
      vector_store_ids: hosted.fileSearch.vectorStoreIds,
      ...(hosted.fileSearch.maxNumResults !== undefined
        ? { max_num_results: hosted.fileSearch.maxNumResults }
        : {}),
    } as ResponsesTool);
  }
  if (hosted?.codeInterpreter) {
    const cfg = typeof hosted.codeInterpreter === 'object' ? hosted.codeInterpreter : {};
    out.push({
      type: 'code_interpreter',
      container: cfg.container ?? { type: 'auto' },
    } as ResponsesTool);
  }

  return out;
}
