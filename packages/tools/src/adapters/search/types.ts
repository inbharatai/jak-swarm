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
  /** The query actually sent to the provider chain (post-rewrite if enabled). */
  query: string;
  /**
   * When the query rewriter produced a different query than the caller asked
   * for, this is the original. Useful for traces + UI surfacing so operators
   * can see why the search returned these specific results.
   */
  rewrittenFrom?: string;
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
  /**
   * Subscription tier for gating paid providers (Serper, Tavily). When 'free',
   * the strategy chain skips paid providers regardless of whether their keys
   * are configured. When 'paid' or undefined, the full chain runs.
   *
   * Populated from `ToolExecutionContext.subscriptionTier` (which is in turn
   * populated from `Subscription.maxModelTier >= 2` at workflow creation).
   */
  subscriptionTier?: 'free' | 'paid';
  /**
   * When true, pipe chain results through an LLM re-ranker (Claude Haiku
   * preferred, GPT-4o-mini fallback) that scores each result 0-1 on query
   * relevance, drops low-score results, and re-orders by score. Fails safe:
   * any error returns original results unchanged.
   *
   * Gated by caller (typically paid-tier only — re-ranking free DDG scrapes
   * is pointless) and by DISABLE_SEARCH_RERANKER env var.
   *
   * Can also be a custom function if the caller wants to inject a different
   * re-ranker implementation.
   */
  rerank?: boolean;
  /**
   * Optional query-intent hint for the re-ranker. When omitted, the re-ranker
   * auto-detects via keyword heuristics. Useful when the caller already knows
   * the intent (e.g., `monitor_brand_mentions` is always time_sensitive).
   */
  rerankIntent?: 'informational' | 'navigational' | 'time_sensitive' | 'technical';
  /**
   * When true, pre-rewrite the query via a cheap LLM before hitting the
   * provider chain. Uses the same Haiku-primary / GPT-4o-mini-fallback path
   * as the re-ranker. Smart-gated by `needsRewrite()` — already-focused
   * keyword queries pass through untouched to save cost and latency.
   *
   * Gated by caller (typically paid-tier only) and by DISABLE_SEARCH_REWRITER
   * env var. Fails safe: any error uses the original query.
   */
  rewrite?: boolean;
}

/**
 * Adapter contract. Throws on hard errors (auth, rate limit, 5xx) so the strategy
 * chain can classify the error and decide failover. Returns a normalised response
 * on success (even if `results.length === 0`).
 */
export type SearchAdapter = (opts: SearchOptions) => Promise<SearchResponse>;
