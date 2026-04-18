import { searchSerper } from './serper.js';
import { searchTavily } from './tavily.js';
import { searchDuckDuckGo, searchDuckDuckGoRaw } from './duckduckgo.js';
import type { DdgRawResult } from './duckduckgo.js';
import type { SearchAdapter, SearchOptions, SearchResponse } from './types.js';

/**
 * Local search-error classifier. Intentionally inlined instead of importing
 * from `@jak-swarm/agents` because `agents` depends on `tools` (circular).
 * Mirrors the taxonomy used by `packages/agents/src/base/provider-router.ts`
 * so the search chain's failover decisions match the LLM chain's.
 */
type SearchErrorKind =
  | 'auth_error'
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'bad_request'
  | 'unknown';

function classifySearchError(err: unknown): SearchErrorKind {
  if (!(err instanceof Error)) return 'unknown';
  const message = err.message.toLowerCase();
  const status = (err as { status?: number }).status;

  if (status === 429 || /rate limit|too many requests/i.test(message)) return 'rate_limit';
  if (/timeout|timed out|etimedout|aborted/i.test(message)) return 'timeout';
  if ((typeof status === 'number' && status >= 500) || /\b(500|502|503|504)\b/.test(message) || /service unavailable|bad gateway/i.test(message)) return 'server_error';
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api key/i.test(message)) return 'auth_error';
  if (status === 400 || /\bbad request\b|invalid request/i.test(message)) return 'bad_request';
  return 'unknown';
}

/** Transient / provider-scoped kinds fail over; auth/bad_request fail fast. */
function shouldFailoverSearch(kind: SearchErrorKind): boolean {
  return kind === 'rate_limit' || kind === 'server_error' || kind === 'timeout' || kind === 'unknown';
}

export type { SearchAdapter, SearchOptions, SearchResponse, SearchProviderSource, SearchResult } from './types.js';
export { searchSerper } from './serper.js';
export { searchTavily } from './tavily.js';
export { searchDuckDuckGo, fetchPageContent } from './duckduckgo.js';

/**
 * Global kill switch. When truthy, the strategy chain skips paid providers
 * (Serper + Tavily) and uses DuckDuckGo only — regardless of which keys are
 * configured. Intended as an instant cost-protection lever for production:
 * set `DISABLE_PAID_SEARCH=1` to force every search to the free tier until
 * the bill or traffic pattern is understood. No code deploy needed.
 */
function paidSearchDisabled(): boolean {
  const v = process.env['DISABLE_PAID_SEARCH'];
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Which providers are available right now. Used by callers (e.g. the benchmark
 * harness) to skip providers that have no key configured.
 *
 * Gates paid providers on three independent signals, any of which flips them off:
 *   1. `DISABLE_PAID_SEARCH` env var (global kill switch)
 *   2. `subscriptionTier === 'free'` (per-tenant plan gate)
 *   3. missing API key (config gate)
 *
 * DuckDuckGo is always on — the free fallback.
 */
export function availableSearchProviders(subscriptionTier?: 'free' | 'paid'): {
  serper: boolean;
  tavily: boolean;
  duckduckgo: boolean;
} {
  if (paidSearchDisabled() || subscriptionTier === 'free') {
    return { serper: false, tavily: false, duckduckgo: true };
  }
  return {
    serper: Boolean(process.env['SERPER_API_KEY']),
    tavily: Boolean(process.env['TAVILY_API_KEY']),
    duckduckgo: true, // always available (free scrape)
  };
}

/**
 * Cost-tracking hook. When `SEARCH_PROVIDER_LOG=1` is set, every paid search
 * call (Serper, Tavily) is logged to stderr with provider, query, and latency.
 * Intended for offline cost modeling — pipe to a file and bucket by day/week.
 *
 * Free DDG calls are NOT logged (they have no cost signal).
 */
function logPaidSearch(provider: 'serper' | 'tavily', query: string, latencyMs: number, ok: boolean): void {
  if (process.env['SEARCH_PROVIDER_LOG'] !== '1' && process.env['SEARCH_PROVIDER_LOG'] !== 'true') return;
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      event: 'paid_search',
      provider,
      ok,
      latencyMs,
      query: query.slice(0, 200),
      ts: new Date().toISOString(),
    }),
  );
}

interface ChainAttempt {
  name: 'serper' | 'tavily' | 'duckduckgo';
  adapter: SearchAdapter;
}

/**
 * Production strategy chain — Serper → Tavily → DuckDuckGo.
 *
 * Ordering rationale:
 * - Serper: highest-quality Google-graded results + answer box + freshness.
 *   Primary when `SERPER_API_KEY` is configured.
 * - Tavily: strong research-oriented quality with answer synthesis. Secondary
 *   because Serper's freshness and breadth are typically better.
 * - DuckDuckGo scrape: honest free fallback. Lower quality, brittle to markup
 *   changes, but zero cost and no key. Keeps JAK working in dev + cost-
 *   sensitive tenants.
 *
 * Failure policy uses the same taxonomy as the LLM provider router:
 *   classifyProviderError → shouldFailover
 * 'auth_error' / 'config_error' / 'bad_request' / 'model_not_found' fail FAST
 * (don't waste the chain on a bad key or malformed query). 'rate_limit' /
 * 'server_error' / 'timeout' / unknown key-absent (we use status=401 as the
 * "no key" sentinel so it looks like auth) → fail over.
 *
 * The single exception: status=401 + message 'not configured' is treated as
 * "no key available, skip cleanly" — distinguished from real auth failures
 * by message content so a mis-configured real key still fails fast loudly.
 */
export async function searchStrategyChain(opts: SearchOptions): Promise<SearchResponse> {
  const available = availableSearchProviders(opts.subscriptionTier);
  const chain: ChainAttempt[] = [];
  if (available.serper) chain.push({ name: 'serper', adapter: searchSerper });
  if (available.tavily) chain.push({ name: 'tavily', adapter: searchTavily });
  chain.push({ name: 'duckduckgo', adapter: searchDuckDuckGo });

  const errors: Array<{ provider: string; kind: string; message: string }> = [];

  for (let i = 0; i < chain.length; i++) {
    const { name, adapter } = chain[i]!;
    const startedAt = Date.now();
    try {
      const result = await adapter(opts);
      if (name === 'serper' || name === 'tavily') {
        logPaidSearch(name, opts.query, Date.now() - startedAt, true);
      }
      return result;
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      if (name === 'serper' || name === 'tavily') {
        logPaidSearch(name, opts.query, latencyMs, false);
      }
      const kind = classifySearchError(err);
      const message = err instanceof Error ? err.message : String(err);

      // Treat "not configured" as a silent skip, not a failure — the chain was
      // built assuming the key exists; if the adapter disagrees (e.g. env var
      // blanked between availability check and call), slip to next provider.
      const isNotConfigured = /not configured/i.test(message);

      errors.push({ provider: name, kind, message });

      if (isNotConfigured) continue;

      // Real auth/bad_request errors on a non-last provider fail fast — the next
      // provider can't fix a revoked key on THIS provider, and we don't want to
      // mask a production misconfiguration behind DDG fallback.
      const isLastInChain = i === chain.length - 1;
      if (!shouldFailoverSearch(kind) && !isLastInChain) {
        throw err;
      }
      // Transient / last-chain — continue to next attempt (or fall through on last).
    }
  }

  // Every adapter failed (or was absent). Return a structured empty response
  // so the tool's JSON contract stays consistent.
  return {
    results: [],
    source: 'search_failed',
    query: opts.query,
    resultCount: 0,
    message:
      'All search providers failed or are unavailable. Configure SERPER_API_KEY or TAVILY_API_KEY for production-grade search. Errors: ' +
      errors.map((e) => `${e.provider}=${e.kind}`).join(', '),
  };
}

/**
 * Legacy-shape helper — routes through the full strategy chain (Serper →
 * Tavily → DDG) when the tenant is on a paid plan, DDG-only when on the
 * free plan. Returns the `{title, url, snippet}` shape so the 6 premium
 * internal tools (enrich_contact, enrich_company, analyze_serp,
 * research_keywords, search_deals, find_decision_makers) keep their
 * existing call-site contract.
 *
 * Error policy: on strategy-chain fail-fast errors (auth_error on a non-last
 * provider), returns empty results + source='search_failed' rather than
 * throwing — preserves the "legacy tools never raise" contract so a
 * mis-configured SERPER_API_KEY doesn't cascade-break CRM / SEO / research
 * tool chains.
 */
export async function searchLegacyWithChain(
  query: string,
  maxResults: number,
  subscriptionTier?: 'free' | 'paid',
): Promise<{ results: DdgRawResult[]; source: string }> {
  try {
    const response = await searchStrategyChain({
      query,
      maxResults,
      fetchContent: false,
      subscriptionTier,
    });
    return {
      results: response.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
      })),
      source: response.source,
    };
  } catch {
    return { results: [], source: 'search_failed' };
  }
}

/**
 * Legacy-shape helper — DDG-scrape only. Used by ~9 high-volume "free tier"
 * internal tools (monitor_rankings, monitor_brand_mentions,
 * monitor_company_signals, auto_reply_reddit / auto_reply_twitter /
 * auto_reply_linkedin, auto_engage_reddit / auto_engage_twitter /
 * auto_engage_linkedin, discover_posting_platforms) where volume + cron
 * polling make per-call Serper cost prohibitive and the quality delta is
 * marginal.
 *
 * Premium-tier internal tools (enrich_contact, enrich_company, analyze_serp,
 * research_keywords, find_decision_makers, search_deals) use
 * `searchStrategyChainLegacy` below instead — same shape, chained providers.
 *
 * Routing decision documented in docs/search-stack.md "Internal tool cost tiers".
 */
export async function searchDuckDuckGoLegacy(
  query: string,
  maxResults: number,
): Promise<{ results: DdgRawResult[]; source: string }> {
  const results = await searchDuckDuckGoRaw(query, maxResults);
  return { results, source: 'duckduckgo' };
}
