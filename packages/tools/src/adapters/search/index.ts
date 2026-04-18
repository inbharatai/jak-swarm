import { searchSerper } from './serper.js';
import { searchTavily } from './tavily.js';
import { searchDuckDuckGo } from './duckduckgo.js';
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
export { searchDuckDuckGo, searchDuckDuckGoLegacy, fetchPageContent } from './duckduckgo.js';

/**
 * Which providers are available right now. Used by callers (e.g. the benchmark
 * harness) to skip providers that have no key configured.
 */
export function availableSearchProviders(): {
  serper: boolean;
  tavily: boolean;
  duckduckgo: boolean;
} {
  return {
    serper: Boolean(process.env['SERPER_API_KEY']),
    tavily: Boolean(process.env['TAVILY_API_KEY']),
    duckduckgo: true, // always available (free scrape)
  };
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
  const available = availableSearchProviders();
  const chain: ChainAttempt[] = [];
  if (available.serper) chain.push({ name: 'serper', adapter: searchSerper });
  if (available.tavily) chain.push({ name: 'tavily', adapter: searchTavily });
  chain.push({ name: 'duckduckgo', adapter: searchDuckDuckGo });

  const errors: Array<{ provider: string; kind: string; message: string }> = [];

  for (let i = 0; i < chain.length; i++) {
    const { name, adapter } = chain[i]!;
    try {
      const result = await adapter(opts);
      // Adapters returning zero results on success are NOT a failure — surface as-is.
      return result;
    } catch (err) {
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
