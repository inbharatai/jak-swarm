/**
 * Adapt ChatCompletionTool[] (the format every existing agent already uses)
 * into the Responses API tool spec.
 *
 * Function tools translate 1:1 — Responses uses a flatter `{ type: 'function',
 * name, description, parameters }` instead of Chat's nested
 * `{ type: 'function', function: { name, description, parameters } }`.
 *
 * Hosted tools (web_search, file_search, code_interpreter, computer_use) are
 * Responses-API-only. Phase 3 supports opt-in via a parallel `hostedTools`
 * argument so callers don't have to touch their existing tool declarations.
 */

import type OpenAI from 'openai';

/**
 * Hosted tools the OpenAIRuntime can expose. Opt-in per call site.
 * These tools execute server-side at OpenAI — no client-side execution.
 */
export interface HostedToolsConfig {
  webSearch?: boolean | { searchContextSize?: 'low' | 'medium' | 'high' };
  fileSearch?: { vectorStoreIds: string[]; maxNumResults?: number };
  codeInterpreter?: boolean | { container?: { type: 'auto' } };
  computerUse?:
    | boolean
    | {
        environment: 'browser' | 'mac' | 'windows' | 'ubuntu';
        displayWidth: number;
        displayHeight: number;
      };
}

/**
 * Combined Responses-API tool input. The OpenAI SDK accepts `Tool[]` which
 * is a union of FunctionTool, FileSearchTool, WebSearchTool, ComputerTool,
 * CodeInterpreterTool. We build that union from the Chat-style functions
 * the caller already has plus any hosted tools they've opted into.
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

  // Hosted tools — only included when caller explicitly opts in
  if (hosted?.webSearch) {
    const cfg = typeof hosted.webSearch === 'object' ? hosted.webSearch : {};
    out.push({
      type: 'web_search_preview',
      ...(cfg.searchContextSize ? { search_context_size: cfg.searchContextSize } : {}),
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
  if (hosted?.computerUse && typeof hosted.computerUse === 'object') {
    out.push({
      type: 'computer-preview',
      environment: hosted.computerUse.environment,
      display_width: hosted.computerUse.displayWidth,
      display_height: hosted.computerUse.displayHeight,
    } as unknown as ResponsesTool);
  }

  return out;
}
