/**
 * Shared result shape across every search provider adapter.
 *
 * The `web_search` tool returns this shape verbatim (plus a few extra fields for
 * backwards compat with the pre-extraction response). Each provider adapter is
 * responsible for normalising its own API's response into this shape so callers
 * don't need to branch on source.
 */

export type SearchProviderSource = 'serper' | 'tavily' | 'duckduckgo' | 'search_failed';

export interface SearchResult {
  title: string;
  url: string;
  /** Page content — may be the provider's snippet or fetched page text. */
  content: string;
  /** 0..1, higher is more relevant. Provider-specific scoring. */
  relevanceScore: number;
}

export interface SearchResponse {
  results: SearchResult[];
  source: SearchProviderSource;
  query: string;
  /** Optional direct-answer string (Serper "answerBox", Tavily "answer"). */
  answer?: string | null;
  resultCount: number;
  /** Human-readable note on what happened; surfaces to the LLM in error cases. */
  message?: string;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  /** If true, adapters that only return snippets (DDG) may fetch full page text. */
  fetchContent?: boolean;
}

/**
 * Adapter contract. Throws on hard errors (auth, rate limit, 5xx) so the strategy
 * chain can classify the error and decide failover. Returns a normalised response
 * on success (even if `results.length === 0`).
 */
export type SearchAdapter = (opts: SearchOptions) => Promise<SearchResponse>;
