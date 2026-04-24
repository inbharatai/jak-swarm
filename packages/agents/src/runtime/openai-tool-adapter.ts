/**
 * Adapt ChatCompletionTool[] (the format every existing agent already uses)
 * into the Responses API tool spec.
 *
 * Function tools translate 1:1 — Responses uses a flatter `{ type: 'function',
 * name, description, parameters }` instead of Chat's nested
 * `{ type: 'function', function: { name, description, parameters } }`.
 *
 * Production hosted tools we support (STABLE only — no preview surfaces):
 *   - file_search       — OpenAI-hosted RAG over caller-supplied vector stores
 *   - code_interpreter  — sandboxed Python execution
 *
 * Notable exclusions and WHY:
 *   - web_search_preview — PREVIEW API. JAK Swarm's production web search is
 *     the Serper-primary strategy chain in `packages/tools/src/adapters/search/`
 *     (Serper → Tavily → DuckDuckGo). That path gives Google-grade SERP data
 *     (answerBox, knowledgeGraph, peopleAlsoAsk) the OpenAI hosted tool does
 *     not surface, plus an explicit fallback chain and a paid/free tier gate.
 *     Route every agent web-search call through `web_search` in the tool
 *     registry, not through this hosted surface.
 *   - computer-preview — PREVIEW API. Not wired; browser automation goes
 *     through the Playwright adapter in `packages/tools/src/adapters/browser/`
 *     which is stable and observable.
 *
 * If OpenAI promotes web_search or computer-use to stable, re-evaluate.
 * Until then, keep this surface preview-free so we never ship an agent that
 * silently depends on an un-SLA'd API.
 */

import type OpenAI from 'openai';

/**
 * Hosted tools the OpenAIRuntime can expose. Opt-in per call site.
 * These tools execute server-side at OpenAI — no client-side execution.
 *
 * Every option here must be a STABLE (non-preview) Responses API feature.
 */
export interface HostedToolsConfig {
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
