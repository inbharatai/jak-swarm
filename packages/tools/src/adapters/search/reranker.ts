import type { SearchResult } from './types.js';

/**
 * LLM re-ranker for search results.
 *
 * After the strategy chain returns N raw results, we hand them to a cheap LLM
 * (Claude Haiku primary, GPT-4o-mini fallback) with the query and ask for a
 * 0-1 relevance score per result. We drop results below the threshold and
 * re-sort by score. This is the single biggest accuracy lift on top of any
 * search API — raw Serper/Tavily/DDG results are ranked by their own signal,
 * which doesn't know the user's specific intent.
 *
 * Fails safe: any error (no LLM key, timeout, malformed JSON, kill switch)
 * returns the original results unchanged. Re-ranking must never break search.
 *
 * Cost (per re-rank call):
 *   Claude Haiku 4.5  ~$0.0015 input + $0.00015 output = ~$0.0017
 *   GPT-4o-mini       ~$0.0002 input + $0.0001 output = ~$0.0003
 * Gated to paid-tier tenants only (gated in the caller, not here).
 */

export type QueryIntent = 'informational' | 'navigational' | 'time_sensitive' | 'technical';

export interface RerankerOptions {
  query: string;
  results: SearchResult[];
  /** Drop results whose score falls below this. 0-1. Default 0.25. */
  threshold?: number;
  /** Cap the returned list. Default = results.length. */
  maxResults?: number;
  /** Abort the LLM call if it takes longer than this. Default 5000ms. */
  timeoutMs?: number;
  /** Intent hint — helps the LLM weight criteria differently. */
  intent?: QueryIntent;
}

export type RerankerFn = (opts: RerankerOptions) => Promise<SearchResult[]>;

function rerankerDisabled(): boolean {
  const v = process.env['DISABLE_SEARCH_RERANKER'];
  return v === '1' || v === 'true' || v === 'yes';
}

function logRerankCall(
  provider: string,
  query: string,
  latencyMs: number,
  ok: boolean,
  resultCount: number,
): void {
  if (process.env['SEARCH_PROVIDER_LOG'] !== '1' && process.env['SEARCH_PROVIDER_LOG'] !== 'true') return;
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      event: 'search_rerank',
      provider,
      ok,
      latencyMs,
      resultCount,
      query: query.slice(0, 200),
      ts: new Date().toISOString(),
    }),
  );
}

/**
 * Heuristic auto-intent detection. Used when the caller doesn't provide one.
 * Tiny + deterministic — just keyword rules, no LLM call.
 */
export function inferQueryIntent(query: string): QueryIntent {
  const q = query.toLowerCase();
  // Time-sensitive signals
  if (/\b(latest|today|now|recent|this (week|month|year)|20(2[5-9]|3\d)|news about|update on)\b/.test(q)) {
    return 'time_sensitive';
  }
  // Navigational — single brand/product-ish
  if (/\b(docs|pricing|login|dashboard|homepage|official site)\b/.test(q)) {
    return 'navigational';
  }
  // Technical
  if (/\b(how to|api|error|docker|kubernetes|postgres|typescript|python|function|install|debug|error code|stack trace)\b/.test(q)) {
    return 'technical';
  }
  return 'informational';
}

function buildRerankPrompt(query: string, results: SearchResult[], intent: QueryIntent): string {
  const items = results
    .map((r, i) => {
      const snippet = (r.content || '').slice(0, 280).replace(/\s+/g, ' ').trim();
      return `${i + 1}. ${r.title}\n   ${snippet}\n   URL: ${r.url}`;
    })
    .join('\n\n');

  const criteria: Record<QueryIntent, string> = {
    informational: 'Favor authoritative sources (official docs, reputable publications). Penalize thin/spam content.',
    navigational: 'Favor the single best match (usually the official site or primary doc). Penalize tangential results.',
    time_sensitive: 'Favor freshness. Penalize results older than a year unless evergreen. Favor news and official announcements.',
    technical: 'Favor official docs, GitHub, Stack Overflow, and high-quality technical blogs. Penalize SEO-spam how-tos.',
  };

  return `You are a search-result re-ranker. Score each result from 0.0 (useless) to 1.0 (perfect match) based on how well it answers the user's query.

Query intent: ${intent}
Ranking criteria: ${criteria[intent]}

User query: "${query}"

Results:
${items}

Respond ONLY with JSON, no prose, no markdown code fences:
{"scores": [<score for result 1>, <score for result 2>, ...]}

The scores array MUST contain exactly ${results.length} numbers in the same order as the results above.`;
}

async function rerankViaAnthropic(
  prompt: string,
  timeoutMs: number,
): Promise<number[] | null> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text ?? '';
    return parseScores(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function rerankViaOpenAI(
  prompt: string,
  timeoutMs: number,
): Promise<number[] | null> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    return parseScores(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseScores(text: string): number[] | null {
  // The LLM may wrap JSON in prose or code fences. Extract the {...} block.
  const match = text.match(/\{[\s\S]*?"scores"[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { scores?: unknown };
    if (!Array.isArray(parsed.scores)) return null;
    return parsed.scores.map((s) => (typeof s === 'number' ? s : 0));
  } catch {
    return null;
  }
}

/**
 * Default LLM re-ranker. Tries Claude Haiku first (best JSON adherence +
 * reasoning per cent), falls back to GPT-4o-mini, then passes through
 * unchanged if neither key is available.
 */
export const defaultReranker: RerankerFn = async ({
  query,
  results,
  threshold = 0.25,
  maxResults,
  timeoutMs = 5000,
  intent,
}) => {
  if (rerankerDisabled() || results.length <= 1) {
    return maxResults ? results.slice(0, maxResults) : results;
  }

  const effectiveIntent = intent ?? inferQueryIntent(query);
  const prompt = buildRerankPrompt(query, results, effectiveIntent);
  const startedAt = Date.now();

  let provider = 'none';
  let scores: number[] | null = null;

  if (process.env['ANTHROPIC_API_KEY']) {
    provider = 'anthropic-haiku';
    scores = await rerankViaAnthropic(prompt, timeoutMs);
  }
  if (!scores && process.env['OPENAI_API_KEY']) {
    provider = 'openai-gpt4o-mini';
    scores = await rerankViaOpenAI(prompt, timeoutMs);
  }

  const ok = scores !== null && scores.length === results.length;
  logRerankCall(provider, query, Date.now() - startedAt, ok, results.length);

  if (!ok || !scores) {
    return maxResults ? results.slice(0, maxResults) : results;
  }

  const scored = results.map((r, i) => ({ result: r, score: scores[i] ?? 0 }));
  const filtered = scored.filter((s) => s.score >= threshold);
  filtered.sort((a, b) => b.score - a.score);

  const reordered = filtered.map((s) => ({
    ...s.result,
    relevanceScore: s.score,
  }));

  return maxResults ? reordered.slice(0, maxResults) : reordered;
};
