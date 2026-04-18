/**
 * Query rewriter for search.
 *
 * Before hitting Serper/Tavily/DDG, take the user's raw question and use a
 * cheap LLM to produce a sharper, keyword-optimised search query. This is
 * the "prompt engineering in reverse" step — Claude/ChatGPT-style search
 * doesn't pass your exact words to the search engine; it generates better
 * queries first.
 *
 * Smart gate: `needsRewrite()` inspects the query and skips the LLM call
 * entirely for already-focused keyword queries (e.g., `postgres FOR UPDATE
 * SKIP LOCKED`). Only vague / conversational / long queries get rewritten.
 * Saves ~60-70% of rewrite LLM calls on realistic traffic.
 *
 * Fails safe: any error (no LLM key, timeout, malformed JSON, kill switch)
 * returns `[originalQuery]` so search never fails due to rewriting.
 *
 * Cost (per rewrite, when the gate lets it through):
 *   Claude Haiku 4.5  ~$0.0015
 *   GPT-4o-mini       ~$0.0003
 */

export interface RewriterOptions {
  query: string;
  /** Abort the LLM call if it takes longer than this. Default 4000ms. */
  timeoutMs?: number;
  /** Optional intent hint to help the rewriter weight criteria. */
  intent?: 'informational' | 'navigational' | 'time_sensitive' | 'technical';
  /** Max number of rewritten queries to return. Default 3 (LLM may return fewer). */
  maxRewrites?: number;
}

export type RewriterFn = (opts: RewriterOptions) => Promise<string[]>;

function rewriterDisabled(): boolean {
  const v = process.env['DISABLE_SEARCH_REWRITER'];
  return v === '1' || v === 'true' || v === 'yes';
}

function logRewriteCall(
  provider: string,
  original: string,
  rewritten: string[],
  latencyMs: number,
  ok: boolean,
): void {
  if (process.env['SEARCH_PROVIDER_LOG'] !== '1' && process.env['SEARCH_PROVIDER_LOG'] !== 'true') return;
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      event: 'search_rewrite',
      provider,
      ok,
      latencyMs,
      original: original.slice(0, 200),
      rewritten: rewritten.slice(0, 3).map((q) => q.slice(0, 200)),
      ts: new Date().toISOString(),
    }),
  );
}

/**
 * Heuristic gate — returns true if the query is likely to benefit from
 * LLM rewriting. Already-focused keyword queries skip the LLM call entirely.
 *
 * Rules (all cheap, no LLM):
 *   - Very short queries (<= 3 words): already focused, skip
 *   - Contains question words (how, why, what, when, ...): needs rewrite
 *   - Contains conversational phrasing ("best way to", "tell me about"): needs
 *   - Long queries (>= 8 words): benefit from tightening
 *   - Otherwise: skip (pass through)
 */
export function needsRewrite(query: string): boolean {
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);

  if (words.length <= 3) return false;
  if (/\b(how|why|what|when|where|which|whose|should i|can i|is it|are there|best way to|tell me about)\b/.test(q)) return true;
  if (/\b(help me|i want|i need|looking for)\b/.test(q)) return true;
  if (words.length >= 8) return true;
  return false;
}

function buildRewritePrompt(query: string, intent?: string, maxRewrites: number = 3): string {
  const intentHint = intent
    ? `\nQuery intent: ${intent} (weight criteria accordingly — e.g., time_sensitive favors explicit year/recency terms; technical favors doc-site-specific keywords).`
    : '';

  return `You are a search query optimizer. Take the user's raw question and produce 1-${maxRewrites} improved search queries that would find better results on a Google-style search engine.

Rules:
- If the query is already specific and keyword-focused, return it essentially unchanged (1 entry).
- If vague or conversational, rewrite into a precise keyword-heavy query.
- If the query has multiple independent aspects, split into 2-3 focused queries — NEVER more than ${maxRewrites}.
- Keep each query under 12 words. Prefer nouns + qualifiers over full sentences.
- The FIRST query in your list should be the single best-bet rewrite.
- Never add speculative aspects the user didn't ask about.${intentHint}

User query: "${query}"

Respond ONLY with JSON, no prose, no markdown code fences:
{"queries": ["best rewrite", "alternative 1 if relevant", "alternative 2 if relevant"]}

The queries array must contain 1 to ${maxRewrites} strings.`;
}

async function rewriteViaAnthropic(prompt: string, timeoutMs: number): Promise<string[] | null> {
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
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text ?? '';
    return parseQueries(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function rewriteViaOpenAI(prompt: string, timeoutMs: number): Promise<string[] | null> {
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
        max_tokens: 300,
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
    return parseQueries(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseQueries(text: string): string[] | null {
  const match = text.match(/\{[\s\S]*?"queries"[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { queries?: unknown };
    if (!Array.isArray(parsed.queries)) return null;
    const cleaned = parsed.queries
      .filter((q): q is string => typeof q === 'string')
      .map((q) => q.trim())
      .filter((q) => q.length > 0 && q.length <= 300);
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

/**
 * Default LLM query rewriter. Tries Claude Haiku first (best JSON adherence +
 * reasoning per cent), falls back to GPT-4o-mini, then returns `[originalQuery]`
 * if neither key is available.
 *
 * Returns an array sorted by the LLM's confidence (first = best). Callers can
 * take just `result[0]` for single-query mode or fan-out all of them.
 *
 * NOTE: this function does NOT apply the `needsRewrite` gate — callers decide
 * whether to call it at all. Keeps the gate check cheap and out of the LLM
 * call path.
 */
export const defaultRewriter: RewriterFn = async ({
  query,
  timeoutMs = 4000,
  intent,
  maxRewrites = 3,
}) => {
  if (rewriterDisabled()) return [query];

  const prompt = buildRewritePrompt(query, intent, maxRewrites);
  const startedAt = Date.now();

  let provider = 'none';
  let rewrites: string[] | null = null;

  if (process.env['ANTHROPIC_API_KEY']) {
    provider = 'anthropic-haiku';
    rewrites = await rewriteViaAnthropic(prompt, timeoutMs);
  }
  if (!rewrites && process.env['OPENAI_API_KEY']) {
    provider = 'openai-gpt4o-mini';
    rewrites = await rewriteViaOpenAI(prompt, timeoutMs);
  }

  const ok = rewrites !== null && rewrites.length > 0;
  logRewriteCall(provider, query, ok ? rewrites! : [], Date.now() - startedAt, ok);

  if (!ok || !rewrites) return [query];
  return rewrites.slice(0, maxRewrites);
};
