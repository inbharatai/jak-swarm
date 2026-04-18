import type { SearchAdapter } from './types.js';

/**
 * Tavily adapter — https://tavily.com
 *
 * Paid; key via `TAVILY_API_KEY`. Secondary provider in the strategy chain
 * (runs after Serper if both keys are present). Throws on non-2xx so the
 * chain can classify the error and decide failover.
 *
 * Extracted verbatim from the pre-Wave-1 inline path in
 * packages/tools/src/builtin/index.ts:749-787.
 */

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  answer?: string | null;
  results?: TavilyResult[];
}

export const searchTavily: SearchAdapter = async ({ query, maxResults = 5 }) => {
  const apiKey = process.env['TAVILY_API_KEY'];
  if (!apiKey) {
    // Signal "no key" distinctly from an HTTP failure so the chain can skip silently.
    const err = new Error('TAVILY_API_KEY not configured') as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: true,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const err = new Error(`Tavily returned ${response.status}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  const data = (await response.json()) as TavilyResponse;
  const rows = data.results ?? [];

  return {
    results: rows.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      relevanceScore: r.score,
    })),
    source: 'tavily',
    query,
    answer: data.answer ?? null,
    resultCount: rows.length,
  };
};
