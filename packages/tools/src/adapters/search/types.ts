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

/**
 * Structured knowledge-graph card. Populated only when the provider returns
 * one (Serper for Google-KG, Tavily does not expose this). Surface directly
 * to agents so they can answer factual questions without re-searching.
 */
export interface SearchKnowledgeGraph {
  /** Entity name, e.g. "Apollo 11". */
  title: string;
  /** Schema.org-ish type, e.g. "Space mission", "Company", "Person". */
  type?: string;
  /** Short description. Usually 1-3 sentences. */
  description?: string;
  /** Canonical website for the entity, if any. */
  website?: string;
  /** Freeform attribute pairs — e.g. {"Launch date": "July 16, 1969"}. */
  attributes?: Record<string, string>;
  /** Image URL, if the provider returned one. */
  imageUrl?: string;
}

/**
 * A "People Also Ask" block — related questions Google inferred from the
 * query. High-signal for agents deciding follow-up research directions.
 */
export interface RelatedQuestion {
  question: string;
  /** Snippet of the answer, if the provider returned one. */
  snippet?: string;
  /** Source URL of the snippet, if provided. */
  url?: string;
}

/**
 * Filter-mode for specialised Serper endpoints. The default search endpoint
 * returns organic web results; news-mode biases toward fresh reporting with
 * publication dates; images-mode returns visual results.
 *
 * Only Serper supports the non-default modes today — Tavily + DDG fall back
 * to their standard web search and ignore the hint.
 */
export type SearchMode = 'web' | 'news' | 'images';

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
  /** Structured knowledge-graph card (Serper only). */
  knowledgeGraph?: SearchKnowledgeGraph;
  /** People Also Ask block (Serper only). */
  peopleAlsoAsk?: RelatedQuestion[];
  /** Related searches surfaced by the provider (Serper only). */
  relatedSearches?: string[];
  resultCount: number;
  /** Which search mode was requested. Defaults to 'web'. */
  mode?: SearchMode;
  /** Human-readable note on what happened; surfaces to the LLM in error cases. */
  message?: string;
  /** Provider wall-clock latency for telemetry. */
  latencyMs?: number;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  /** If true, adapters that only return snippets (DDG) may fetch full page text. */
  fetchContent?: boolean;
  /**
   * Which search mode to run: plain web (default), news, or images. Only
   * Serper supports the non-default modes; Tavily + DDG fall back to web.
   */
  mode?: SearchMode;
  /**
   * Optional ISO country code for result geo-biasing (Serper `gl` param).
   * Example: 'in' biases toward India, 'us' toward US. Absent = global.
   */
  country?: string;
  /**
   * Optional UI language hint (Serper `hl` param). Example: 'en' for English
   * SERP strings, 'hi' for Hindi. Defaults to the provider's locale.
   */
  language?: string;
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
