import type { SearchAdapter, SearchOptions, SearchResponse, SearchMode, SearchKnowledgeGraph, RelatedQuestion } from './types.js';

/**
 * Serper adapter — https://serper.dev
 *
 * Production primary. Paid; key via `SERPER_API_KEY`. Returns Google-grade
 * results with the full SERP richness: organic + knowledgeGraph + answerBox
 * + peopleAlsoAsk + relatedSearches, across web/news/images modes.
 *
 * Design choices:
 *   - Retries once on transient failure (429 / 5xx / network timeout) with
 *     jittered backoff. Auth errors + 4xx-except-429 do not retry —
 *     the strategy chain upstream will fail over to Tavily/DDG instead.
 *   - Typed error shape — `Error & { status?: number }` so the strategy chain's
 *     classifier picks the right kind (auth/rate_limit/server/timeout).
 *   - Request-wall timeout of 10s total (includes both attempts). Individual
 *     attempt timeout of 5s so a slow first request doesn't starve the retry.
 *   - `mode: 'news'` hits `/news` for time-sensitive queries (returns dates
 *     + source names). `mode: 'images'` hits `/images` for visual searches.
 *     `mode: 'web'` (default) hits `/search` — the standard Google SERP.
 *   - Country + language biasing forwarded as `gl` + `hl` when set.
 *
 * Error contract: throws on non-2xx so the strategy chain can classify the
 * error (401/403 = misconfigured key → fail fast; 429 = rate limit → fail
 * over; 5xx/timeout = transient → fail over). Mirrors the taxonomy in
 * `classifySearchError` (index.ts) and the upstream `classifyProviderError`
 * used by the LLM router.
 */

interface SerperOrganic {
  title: string;
  link: string;
  snippet?: string;
  date?: string;
  position?: number;
  sitelinks?: Array<{ title: string; link: string }>;
}

interface SerperKnowledgeGraph {
  title?: string;
  type?: string;
  description?: string;
  website?: string;
  imageUrl?: string;
  attributes?: Record<string, string>;
}

interface SerperPeopleAlsoAsk {
  question: string;
  snippet?: string;
  title?: string;
  link?: string;
}

interface SerperRelatedSearch {
  query: string;
}

interface SerperResponse {
  organic?: SerperOrganic[];
  answerBox?: { answer?: string; snippet?: string; title?: string; link?: string };
  knowledgeGraph?: SerperKnowledgeGraph;
  peopleAlsoAsk?: SerperPeopleAlsoAsk[];
  relatedSearches?: SerperRelatedSearch[];
  news?: Array<{ title: string; link: string; snippet?: string; date?: string; source?: string; imageUrl?: string }>;
  images?: Array<{ title: string; imageUrl: string; link?: string; source?: string }>;
}

const SERPER_ENDPOINTS: Record<SearchMode, string> = {
  web: 'https://google.serper.dev/search',
  news: 'https://google.serper.dev/news',
  images: 'https://google.serper.dev/images',
};

const ATTEMPT_TIMEOUT_MS = 5_000;
const OVERALL_BUDGET_MS = 10_000;
const MAX_ATTEMPTS = 2;

class SerperError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SerperError';
    if (status !== undefined) this.status = status;
  }
}

/** True if an error should be retried before we give up on Serper. */
function isRetryable(status: number | undefined, kind: 'timeout' | 'network' | 'http'): boolean {
  if (kind === 'timeout' || kind === 'network') return true;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  return false;
}

/**
 * Single HTTP attempt against Serper. Throws a typed `SerperError` on any
 * non-2xx, timeout, or network error — the caller decides retry vs fail.
 */
async function attemptSerperFetch(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<SerperResponse> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // AbortError = timeout. Anything else = network failure.
    const isAbort = err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
    throw new SerperError(
      isAbort ? 'Serper request timed out' : `Serper network error: ${err instanceof Error ? err.message : String(err)}`,
      isAbort ? 408 : undefined,
    );
  }

  if (!response.ok) {
    let bodyText = '';
    try {
      bodyText = (await response.text()).slice(0, 280);
    } catch {
      /* response body unreadable — keep just the status */
    }
    throw new SerperError(
      `Serper returned ${response.status}${bodyText ? `: ${bodyText}` : ''}`,
      response.status,
    );
  }

  return (await response.json()) as SerperResponse;
}

function normaliseKnowledgeGraph(kg: SerperKnowledgeGraph | undefined): SearchKnowledgeGraph | undefined {
  if (!kg || !kg.title) return undefined;
  const out: SearchKnowledgeGraph = { title: kg.title };
  if (kg.type) out.type = kg.type;
  if (kg.description) out.description = kg.description;
  if (kg.website) out.website = kg.website;
  if (kg.imageUrl) out.imageUrl = kg.imageUrl;
  if (kg.attributes && Object.keys(kg.attributes).length > 0) out.attributes = kg.attributes;
  return out;
}

function normalisePeopleAlsoAsk(paa: SerperPeopleAlsoAsk[] | undefined): RelatedQuestion[] | undefined {
  if (!paa || paa.length === 0) return undefined;
  return paa.map((q) => {
    const out: RelatedQuestion = { question: q.question };
    if (q.snippet) out.snippet = q.snippet;
    if (q.link) out.url = q.link;
    return out;
  });
}

export const searchSerper: SearchAdapter = async (opts: SearchOptions): Promise<SearchResponse> => {
  const { query, maxResults = 5, mode = 'web', country, language } = opts;

  const apiKey = process.env['SERPER_API_KEY'];
  if (!apiKey) {
    throw new SerperError('SERPER_API_KEY not configured', 401);
  }

  const endpoint = SERPER_ENDPOINTS[mode];
  const body: Record<string, unknown> = {
    q: query,
    num: Math.min(Math.max(maxResults, 1), 10),
  };
  if (country) body['gl'] = country.toLowerCase();
  if (language) body['hl'] = language.toLowerCase();

  const startedAt = Date.now();
  const overallDeadline = startedAt + OVERALL_BUDGET_MS;

  // Retry loop — single retry on transient errors, jittered backoff.
  let lastError: SerperError | undefined;
  let data: SerperResponse | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const timeLeft = overallDeadline - Date.now();
    if (timeLeft <= 0) break;
    const attemptTimeout = Math.min(ATTEMPT_TIMEOUT_MS, timeLeft);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptTimeout);
    try {
      data = await attemptSerperFetch(endpoint, apiKey, body, controller.signal);
      break;
    } catch (err) {
      lastError = err instanceof SerperError ? err : new SerperError(err instanceof Error ? err.message : String(err));
      const retryable = isRetryable(
        lastError.status,
        lastError.status === 408 ? 'timeout' : lastError.status === undefined ? 'network' : 'http',
      );
      if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
      // Jittered backoff — 150-350 ms before the retry. Keeps us inside
      // the overall budget on the common case of a single 5xx blip.
      const delay = 150 + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      clearTimeout(timer);
    }
  }

  if (!data) {
    // Unreachable: the loop either sets `data` or throws. This is a belt-
    // and-braces guard so TypeScript's narrowing stays happy.
    throw lastError ?? new SerperError('Serper request failed with no response');
  }

  const latencyMs = Date.now() - startedAt;

  // Mode-specific result extraction. News/images use different arrays.
  let rawItems: Array<{ title: string; link: string; snippet?: string; date?: string; imageUrl?: string; source?: string }> = [];
  if (mode === 'news') {
    rawItems = (data.news ?? []).slice(0, maxResults);
  } else if (mode === 'images') {
    rawItems = (data.images ?? [])
      .slice(0, maxResults)
      .map((i) => ({ title: i.title, link: i.link ?? i.imageUrl, imageUrl: i.imageUrl, source: i.source }));
  } else {
    rawItems = (data.organic ?? []).slice(0, maxResults);
  }

  const results = rawItems.map((r, i) => ({
    title: r.title,
    url: r.link,
    // For images, prefer the image URL as the content marker so downstream
    // renderers can embed; for news, prefix with date + source so the LLM
    // doesn't need to look up freshness from a separate field.
    content:
      mode === 'images'
        ? (r.imageUrl ?? '')
        : mode === 'news'
          ? [r.date, r.source, r.snippet].filter(Boolean).join(' · ')
          : (r.snippet ?? ''),
    relevanceScore: Math.max(0.1, 1 - i * 0.1),
  }));

  // Prefer answer box, fall back to knowledge-graph description.
  const answer =
    data.answerBox?.answer ??
    data.answerBox?.snippet ??
    data.knowledgeGraph?.description ??
    null;

  const response: SearchResponse = {
    results,
    source: 'serper',
    query,
    answer,
    resultCount: results.length,
    mode,
    latencyMs,
  };

  const kg = normaliseKnowledgeGraph(data.knowledgeGraph);
  if (kg) response.knowledgeGraph = kg;
  const paa = normalisePeopleAlsoAsk(data.peopleAlsoAsk);
  if (paa) response.peopleAlsoAsk = paa;
  if (data.relatedSearches && data.relatedSearches.length > 0) {
    response.relatedSearches = data.relatedSearches.map((r) => r.query).filter(Boolean);
  }

  return response;
};
