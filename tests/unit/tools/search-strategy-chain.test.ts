import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Behavioral tests for the Wave 1 search strategy chain.
 *
 * The chain's contract (packages/tools/src/adapters/search/index.ts):
 *   - Serper (if SERPER_API_KEY set) → Tavily (if TAVILY_API_KEY set) → DDG scrape
 *   - auth/bad_request errors on a non-last provider fail fast (don't mask misconfig)
 *   - rate_limit / server_error / timeout / unknown on a non-last provider fail over
 *   - "not configured" from any adapter is a silent skip (don't treat as a failure)
 *   - Zero providers available → DDG always runs (last in chain)
 *   - All adapters failing terminally → `{results:[], source:'search_failed', message}`
 *
 * Strategy: mock fetch globally and script the responses per provider call.
 */

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Reset env between tests — the chain reads env at call time.
  delete process.env['SERPER_API_KEY'];
  delete process.env['TAVILY_API_KEY'];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = originalFetch;
});

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function installFetch(handler: FetchHandler) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as unknown as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// A minimal DDG HTML payload that the scraper can parse into one result.
const DDG_STUB_HTML = `
<html><body>
  <div class="result__body">
    <a class="result__a" href="https://duckduckgo.com/l/?kh=-1&uddg=https%3A%2F%2Fexample.com%2Fddg-stub">DDG Stub Title</a>
    <a class="result__snippet">DDG snippet text</a>
  </div>
</body></html>
`;

describe('searchStrategyChain — provider ordering', () => {
  it('Serper wins when SERPER_API_KEY is set', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return jsonResponse({
          organic: [
            { title: 'Serper Win', link: 'https://a.example', snippet: 'serper snippet' },
          ],
          answerBox: { answer: 'serper answer' },
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchStrategyChain({ query: 'hello', maxResults: 3 });

    expect(res.source).toBe('serper');
    expect(res.results).toHaveLength(1);
    expect(res.results[0]?.title).toBe('Serper Win');
    expect(res.answer).toBe('serper answer');
  });

  it('falls through to Tavily when Serper returns 429', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    process.env['TAVILY_API_KEY'] = 'tv-test';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return jsonResponse({ error: 'rate limited' }, { status: 429 });
      }
      if (url.includes('tavily.com')) {
        return jsonResponse({
          answer: 'tavily answer',
          results: [{ title: 'Tavily Win', url: 'https://b.example', content: 'x', score: 0.9 }],
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchStrategyChain({ query: 'hello', maxResults: 3 });

    expect(res.source).toBe('tavily');
    expect(res.results[0]?.title).toBe('Tavily Win');
  });

  it('falls through to DDG when Tavily absent and Serper 5xx', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return new Response('service unavailable', { status: 503 });
      }
      if (url.includes('duckduckgo.com')) {
        return new Response(DDG_STUB_HTML, { status: 200 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchStrategyChain({ query: 'hello', maxResults: 3, fetchContent: false });

    expect(res.source).toBe('duckduckgo');
    expect(res.results[0]?.title).toBe('DDG Stub Title');
  });

  it('zero configured keys → DDG always runs', async () => {
    installFetch(async (url) => {
      if (url.includes('duckduckgo.com')) {
        return new Response(DDG_STUB_HTML, { status: 200 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchStrategyChain({ query: 'hello', maxResults: 3, fetchContent: false });

    expect(res.source).toBe('duckduckgo');
    expect(res.results).toHaveLength(1);
  });
});

describe('searchStrategyChain — failure policy', () => {
  it('Serper 401 (auth_error) with Tavily + DDG behind it FAILS FAST — does not mask behind DDG', async () => {
    process.env['SERPER_API_KEY'] = 'sk-revoked';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return new Response('unauthorized', { status: 401 });
      }
      // Must not reach Tavily or DDG on a non-last auth error.
      throw new Error(`leak to ${url} — fail-fast policy violated`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');

    await expect(searchStrategyChain({ query: 'hello' })).rejects.toMatchObject({
      status: 401,
    });
  });

  it('Serper 400 (bad_request) with Tavily + DDG behind it FAILS FAST', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return new Response('bad request', { status: 400 });
      }
      throw new Error(`leak to ${url} — fail-fast policy violated`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');

    await expect(searchStrategyChain({ query: 'hello' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('all adapters fail terminally → source=search_failed with diagnostic message', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    process.env['TAVILY_API_KEY'] = 'tv-test';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) return new Response('oops', { status: 503 });
      if (url.includes('tavily.com')) return new Response('oops', { status: 503 });
      if (url.includes('duckduckgo.com')) return new Response('oops', { status: 503 });
      throw new Error(`unexpected fetch to ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchStrategyChain({ query: 'hello', fetchContent: false });

    expect(res.source).toBe('search_failed');
    expect(res.results).toHaveLength(0);
    expect(res.message).toMatch(/serper=server_error/);
    expect(res.message).toMatch(/tavily=server_error/);
    expect(res.message).toMatch(/duckduckgo=server_error/);
  });
});

describe('availableSearchProviders', () => {
  it('reports presence from env, DDG always available', async () => {
    const { availableSearchProviders } = await import('../../../packages/tools/src/adapters/search/index.js');

    expect(availableSearchProviders()).toEqual({
      serper: false,
      tavily: false,
      duckduckgo: true,
    });

    process.env['SERPER_API_KEY'] = 'x';
    expect(availableSearchProviders().serper).toBe(true);

    process.env['TAVILY_API_KEY'] = 'y';
    expect(availableSearchProviders().tavily).toBe(true);
  });

  it("subscriptionTier='free' forces paid providers off even when keys are set", async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    process.env['TAVILY_API_KEY'] = 'tv-test';
    const { availableSearchProviders } = await import('../../../packages/tools/src/adapters/search/index.js');

    expect(availableSearchProviders('free')).toEqual({
      serper: false,
      tavily: false,
      duckduckgo: true,
    });
    // 'paid' (or undefined) preserves normal behavior
    expect(availableSearchProviders('paid').serper).toBe(true);
    expect(availableSearchProviders().serper).toBe(true);
  });

  it('DISABLE_PAID_SEARCH=1 forces paid providers off regardless of tier', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    process.env['TAVILY_API_KEY'] = 'tv-test';
    process.env['DISABLE_PAID_SEARCH'] = '1';
    const { availableSearchProviders } = await import('../../../packages/tools/src/adapters/search/index.js');

    expect(availableSearchProviders('paid')).toEqual({
      serper: false,
      tavily: false,
      duckduckgo: true,
    });

    delete process.env['DISABLE_PAID_SEARCH'];
  });
});

describe('searchStrategyChain — subscription tier gating', () => {
  it("FREE plan: Serper key is set but chain goes straight to DDG", async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        throw new Error(`Serper hit on FREE plan — should have been skipped, url=${url}`);
      }
      if (url.includes('duckduckgo.com')) {
        return new Response(DDG_STUB_HTML, { status: 200 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchStrategyChain({
      query: 'cheap tenant',
      maxResults: 3,
      fetchContent: false,
      subscriptionTier: 'free',
    });

    expect(res.source).toBe('duckduckgo');
  });

  it("PAID plan: Serper is called even with tier='paid'", async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return jsonResponse({ organic: [{ title: 'Paid result', link: 'https://x.example', snippet: 'y' }] });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchStrategyChain({
      query: 'paid tenant',
      maxResults: 3,
      subscriptionTier: 'paid',
    });

    expect(res.source).toBe('serper');
  });

  it("subscriptionTier omitted: permissive default (admin scripts, bench)", async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return jsonResponse({ organic: [{ title: 'Admin run', link: 'https://x.example', snippet: 'y' }] });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchStrategyChain({ query: 'admin', maxResults: 3 });

    expect(res.source).toBe('serper');
  });
});

describe('searchLegacyWithChain — premium-tier helper', () => {
  it("FREE tier routes to DDG even with SERPER_API_KEY set", async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        throw new Error('Serper should not be called on FREE tier via searchLegacyWithChain');
      }
      if (url.includes('duckduckgo.com')) {
        return new Response(DDG_STUB_HTML, { status: 200 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const { searchLegacyWithChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchLegacyWithChain('free tenant query', 5, 'free');

    expect(res.source).toBe('duckduckgo');
    expect(res.results[0]?.snippet).toBe('DDG snippet text');
  });

  it("PAID tier routes through Serper", async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return jsonResponse({
          organic: [{ title: 'Paid result', link: 'https://x.example', snippet: 'serper snippet' }],
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const { searchLegacyWithChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchLegacyWithChain('paid tenant query', 5, 'paid');

    expect(res.source).toBe('serper');
    expect(res.results[0]?.snippet).toBe('serper snippet');
  });

  it("swallows hard errors (legacy contract: empty results, not throw)", async () => {
    process.env['SERPER_API_KEY'] = 'sk-bad';
    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return new Response('unauthorized', { status: 401 });
      }
      // DDG must NOT be called after an auth-error fail-fast.
      throw new Error(`leak to ${url}`);
    });

    const { searchLegacyWithChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const res = await searchLegacyWithChain('oops', 5, 'paid');

    expect(res.source).toBe('search_failed');
    expect(res.results).toHaveLength(0);
  });
});
