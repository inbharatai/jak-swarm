import type { SearchAdapter, SearchResponse } from './types.js';

/**
 * DuckDuckGo HTML-scrape adapter.
 *
 * Free, no API key. Hits `html.duckduckgo.com/html/` and parses the result
 * blocks. Quality and stability are materially worse than Serper/Tavily —
 * used as the free-tier fallback when no paid keys are configured. NOT a
 * branded product.
 *
 * Extracted from packages/tools/src/builtin/index.ts (pre-Wave-1 inline
 * helpers) to sit behind the search strategy chain alongside Serper + Tavily.
 */

export interface DdgRawResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Internal-only. Hits DuckDuckGo HTML directly and returns the legacy
 * `{title, url, snippet}` shape. Used by:
 *   - the `searchDuckDuckGo` adapter below (content enrichment path)
 *   - the strategy-chain-aware `searchDuckDuckGoLegacy` in ./index.ts
 *     (which prefers Serper/Tavily and only lands here as fallback)
 */
export async function searchDuckDuckGoRaw(
  query: string,
  maxResults: number,
): Promise<DdgRawResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  let response: Response;
  try {
    response = await fetch(`https://html.duckduckgo.com/html/?q=${encodedQuery}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: `q=${encodedQuery}`,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const err = new Error(`DuckDuckGo returned ${response.status}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  const html = await response.text();
  const results: DdgRawResult[] = [];
  const resultBlocks = html.split('class="result__body"');

  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i]!;

    const titleMatch = block.match(/class="result__a"[^>]*>([^<]*)</);
    const title = titleMatch?.[1]
      ?.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .trim() ?? '';

    const urlMatch = block.match(/href="([^"]*uddg=([^&"]*))/);
    let url = '';
    if (urlMatch?.[2]) {
      try {
        url = decodeURIComponent(urlMatch[2]);
      } catch {
        url = urlMatch[2];
      }
    } else {
      const directUrlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
      url = directUrlMatch?.[1] ?? '';
    }

    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch?.[1]
      ?.replace(/<\/?[^>]+(>|$)/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .trim() ?? '';

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

/**
 * Fetch a URL and extract readable text. Used to enrich DDG snippets with
 * page content for the top-N results (since DDG snippets are terse).
 * Extracted from builtin/index.ts.
 */
export async function fetchPageContent(url: string, maxChars: number = 3000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) return '';

    const html = await response.text();

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

    return text.slice(0, maxChars);
  } catch {
    clearTimeout(timeout);
    return '';
  }
}

/**
 * DDG adapter conforming to `SearchAdapter`. Optionally enriches the top 3
 * results with full page content (controlled via `fetchContent`) so callers
 * have more than a snippet to reason over.
 */
export const searchDuckDuckGo: SearchAdapter = async ({
  query,
  maxResults = 5,
  fetchContent = true,
}) => {
  const raw = await searchDuckDuckGoRaw(query, maxResults);

  const enriched: SearchResponse['results'] = [];
  for (const r of raw) {
    let content = r.snippet;
    if (fetchContent && enriched.length < 3) {
      const page = await fetchPageContent(r.url);
      if (page.length > content.length) content = page;
    }
    enriched.push({
      title: r.title,
      url: r.url,
      content,
      relevanceScore: 1 - enriched.length * 0.1,
    });
  }

  return {
    results: enriched,
    source: 'duckduckgo',
    query,
    resultCount: enriched.length,
    message:
      enriched.length > 0
        ? `Found ${enriched.length} results via DuckDuckGo HTML scrape (free fallback, no API key)`
        : 'No results found. Try rephrasing your query, or configure SERPER_API_KEY / TAVILY_API_KEY for better quality.',
  };
};
