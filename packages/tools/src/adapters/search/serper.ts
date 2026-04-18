import type { SearchAdapter } from './types.js';

/**
 * Serper adapter — https://serper.dev
 *
 * Production primary. Paid; key via `SERPER_API_KEY`. Returns Google-grade
 * results (organic + knowledge graph + answer box). Typically materially
 * better relevance than DuckDuckGo scraping and better freshness than
 * Tavily for fast-moving news.
 *
 * Failure policy: throws on non-2xx so the strategy chain can classify the
 * error (401/403 = misconfigured key → fail fast; 429 = rate limit → fail
 * over; 5xx = transient → fail over). Mirrors the error shape used by
 * packages/agents/src/base/provider-router.ts classifyProviderError().
 */

interface SerperOrganic {
  title: string;
  link: string;
  snippet?: string;
  date?: string;
  position?: number;
}

interface SerperResponse {
  organic?: SerperOrganic[];
  answerBox?: { answer?: string; snippet?: string };
  knowledgeGraph?: { title?: string; description?: string };
}

export const searchSerper: SearchAdapter = async ({ query, maxResults = 5 }) => {
  const apiKey = process.env['SERPER_API_KEY'];
  if (!apiKey) {
    const err = new Error('SERPER_API_KEY not configured') as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({
        q: query,
        num: Math.min(maxResults, 10),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const err = new Error(`Serper returned ${response.status}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  const data = (await response.json()) as SerperResponse;
  const organic = (data.organic ?? []).slice(0, maxResults);

  // Prefer the answer box, fall back to knowledge-graph description.
  const answer =
    data.answerBox?.answer ??
    data.answerBox?.snippet ??
    data.knowledgeGraph?.description ??
    null;

  return {
    results: organic.map((r, i) => ({
      title: r.title,
      url: r.link,
      content: r.snippet ?? '',
      // Serper doesn't provide a 0..1 score. Rank-based: 1.0 for first, decay by 0.1.
      relevanceScore: Math.max(0.1, 1 - i * 0.1),
    })),
    source: 'serper',
    query,
    answer,
    resultCount: organic.length,
  };
};
