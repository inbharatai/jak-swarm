/**
 * Smoke-test helper for the OpenAI Responses API.
 *
 * Lives in `@jak-swarm/agents` rather than `@jak-swarm/api` because the
 * API package does not directly depend on `openai` — it's a transitive
 * dep via this package. Re-exposing the SDK through a typed helper
 * keeps the API bundle free of ambiguous module-format issues on
 * Node 25 (ERR_AMBIGUOUS_MODULE_SYNTAX when a module has both top-level
 * `require('openai')` and top-level await anywhere in the graph).
 */

import OpenAI from 'openai';

export interface ResponsesSmokeResult {
  model: string;
  ok: boolean;
  latencyMs: number;
  /** First 80 chars of the model's reply, or null on failure. */
  sample: string | null;
  /** Full error message when the call failed; null on success. */
  error: string | null;
}

/**
 * Hit `/v1/responses` against each model in `models` with a fixed trivial
 * prompt ("Reply with exactly: SMOKE_OK"). Returns per-model pass/fail
 * with latency + a sliver of the response text.
 *
 * Uses OPENAI_API_KEY + optional OPENAI_BASE_URL from env. Callers are
 * responsible for validating the key exists before invoking.
 */
export async function smokeResponsesApi(
  models: string[],
  opts: { apiKey?: string; baseURL?: string } = {},
): Promise<ResponsesSmokeResult[]> {
  const apiKey = opts.apiKey ?? process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('smokeResponsesApi: OPENAI_API_KEY not set');
  }
  const baseURL = opts.baseURL ?? process.env['OPENAI_BASE_URL']?.trim() ?? undefined;
  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  const results: ResponsesSmokeResult[] = [];
  for (const model of models) {
    const startedAt = Date.now();
    try {
      const resp = await client.responses.create({
        model,
        input: [
          {
            type: 'message',
            role: 'user',
            content: 'Reply with exactly: SMOKE_OK',
          },
        ],
        max_output_tokens: 32,
        temperature: 0,
      });
      const text = (resp as { output_text?: string }).output_text ?? '';
      results.push({
        model,
        ok: text.trim().length > 0,
        latencyMs: Date.now() - startedAt,
        sample: text.slice(0, 80),
        error: null,
      });
    } catch (e) {
      results.push({
        model,
        ok: false,
        latencyMs: Date.now() - startedAt,
        sample: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
