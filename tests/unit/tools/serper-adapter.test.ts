import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for the hardened Serper adapter.
 *
 * Covers:
 *   - Retry on 5xx/429/timeout (single retry, jittered backoff)
 *   - Fail-fast on 401/403 (auth) and 400 (bad request)
 *   - News mode → /news endpoint, maps date + source into content
 *   - Images mode → /images endpoint, imageUrl populates content
 *   - Knowledge graph normalisation (title + website + attributes)
 *   - peopleAlsoAsk + relatedSearches propagation
 *   - country + language forwarded as gl + hl
 *   - latencyMs populated on success
 */

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env['SERPER_API_KEY'];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function installFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  });
  globalThis.fetch = mock as unknown as typeof globalThis.fetch;
  return mock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('searchSerper — mode routing', () => {
  it('hits /search for mode=web (default)', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    const mock = installFetch(async (url) => {
      expect(url).toBe('https://google.serper.dev/search');
      return jsonResponse({ organic: [{ title: 'A', link: 'https://a.example', snippet: 's' }] });
    });
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'hi' });
    expect(res.source).toBe('serper');
    expect(res.mode).toBe('web');
    expect(res.results[0]?.title).toBe('A');
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('hits /news for mode=news and merges date + source into content', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      expect(url).toBe('https://google.serper.dev/news');
      return jsonResponse({
        news: [
          { title: 'Breaking', link: 'https://n.example/1', snippet: 'headline', date: '2026-04-24', source: 'Reuters' },
        ],
      });
    });
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'market', mode: 'news' });
    expect(res.mode).toBe('news');
    expect(res.results[0]?.content).toContain('2026-04-24');
    expect(res.results[0]?.content).toContain('Reuters');
    expect(res.results[0]?.content).toContain('headline');
  });

  it('hits /images for mode=images and maps imageUrl into content', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      expect(url).toBe('https://google.serper.dev/images');
      return jsonResponse({
        images: [{ title: 'Pic', imageUrl: 'https://img.example/p.png', link: 'https://host.example' }],
      });
    });
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'logo', mode: 'images' });
    expect(res.mode).toBe('images');
    expect(res.results[0]?.content).toBe('https://img.example/p.png');
  });
});

describe('searchSerper — request body', () => {
  it('forwards country + language as gl + hl lowercase', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    let capturedBody: string | undefined;
    installFetch(async (_url, init) => {
      capturedBody = init?.body as string | undefined;
      return jsonResponse({ organic: [] });
    });
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    await searchSerper({ query: 'stocks', country: 'IN', language: 'EN' });
    const body = JSON.parse(capturedBody!);
    expect(body.gl).toBe('in');
    expect(body.hl).toBe('en');
    expect(body.q).toBe('stocks');
  });

  it('caps num between 1 and 10 regardless of maxResults', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    let capturedBody: string | undefined;
    installFetch(async (_url, init) => {
      capturedBody = init?.body as string | undefined;
      return jsonResponse({ organic: [] });
    });
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    await searchSerper({ query: 'q', maxResults: 100 });
    expect(JSON.parse(capturedBody!).num).toBe(10);

    await searchSerper({ query: 'q', maxResults: 0 });
    expect(JSON.parse(capturedBody!).num).toBe(1);
  });
});

describe('searchSerper — retry policy', () => {
  it('retries once on 500 and succeeds', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    const mock = installFetch(async () => {
      if (mock.mock.calls.length === 1) {
        return jsonResponse({ error: 'boom' }, 500);
      }
      return jsonResponse({ organic: [{ title: 'Retried', link: 'https://r.example', snippet: 's' }] });
    });
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'q' });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(res.results[0]?.title).toBe('Retried');
  });

  it('retries once on 429 and succeeds', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    const mock = installFetch(async () => {
      if (mock.mock.calls.length === 1) return jsonResponse({ error: 'rate' }, 429);
      return jsonResponse({ organic: [{ title: 'OK', link: 'https://o.example', snippet: 's' }] });
    });
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'q' });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(res.results[0]?.title).toBe('OK');
  });

  it('does NOT retry on 401 (auth) — fails fast so chain can fall over', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    const mock = installFetch(async () => jsonResponse({ error: 'unauthorized' }, 401));
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    await expect(searchSerper({ query: 'q' })).rejects.toMatchObject({ status: 401 });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 400 (bad request)', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    const mock = installFetch(async () => jsonResponse({ error: 'bad' }, 400));
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    await expect(searchSerper({ query: 'q' })).rejects.toMatchObject({ status: 400 });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('throws the last error after both attempts fail with 5xx', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    const mock = installFetch(async () => jsonResponse({ error: 'upstream down' }, 503));
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    await expect(searchSerper({ query: 'q' })).rejects.toMatchObject({ status: 503 });
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe('searchSerper — response enrichment', () => {
  it('populates knowledgeGraph from Google KG', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async () =>
      jsonResponse({
        organic: [{ title: 'x', link: 'https://x.example', snippet: 's' }],
        knowledgeGraph: {
          title: 'Apollo 11',
          type: 'Space mission',
          description: 'First crewed Moon landing',
          website: 'https://nasa.gov/apollo11',
          attributes: { 'Launch date': 'July 16, 1969', Duration: '8 days' },
        },
      }),
    );
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'apollo 11' });
    expect(res.knowledgeGraph?.title).toBe('Apollo 11');
    expect(res.knowledgeGraph?.type).toBe('Space mission');
    expect(res.knowledgeGraph?.website).toBe('https://nasa.gov/apollo11');
    expect(res.knowledgeGraph?.attributes?.['Launch date']).toBe('July 16, 1969');
  });

  it('populates peopleAlsoAsk + relatedSearches', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async () =>
      jsonResponse({
        organic: [{ title: 'x', link: 'https://x.example', snippet: 's' }],
        peopleAlsoAsk: [
          { question: 'When did Apollo 11 launch?', snippet: 'July 16, 1969', link: 'https://nasa.gov/a' },
        ],
        relatedSearches: [{ query: 'Apollo 11 crew' }, { query: 'Apollo 11 landing site' }],
      }),
    );
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'apollo 11' });
    expect(res.peopleAlsoAsk?.[0]?.question).toBe('When did Apollo 11 launch?');
    expect(res.peopleAlsoAsk?.[0]?.url).toBe('https://nasa.gov/a');
    expect(res.relatedSearches).toEqual(['Apollo 11 crew', 'Apollo 11 landing site']);
  });

  it('prefers answerBox.answer over knowledgeGraph.description for answer field', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async () =>
      jsonResponse({
        organic: [{ title: 'x', link: 'https://x.example', snippet: 's' }],
        answerBox: { answer: 'The direct answer' },
        knowledgeGraph: { title: 'Something', description: 'KG fallback description' },
      }),
    );
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'q' });
    expect(res.answer).toBe('The direct answer');
  });

  it('populates latencyMs', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async () => jsonResponse({ organic: [{ title: 't', link: 'https://u.example', snippet: 's' }] }));
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'q' });
    expect(typeof res.latencyMs).toBe('number');
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('omits knowledgeGraph when Google did not return one', async () => {
    process.env['SERPER_API_KEY'] = 'sk-test';
    installFetch(async () => jsonResponse({ organic: [{ title: 't', link: 'https://u.example', snippet: 's' }] }));
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'q' });
    expect(res.knowledgeGraph).toBeUndefined();
    expect(res.peopleAlsoAsk).toBeUndefined();
    expect(res.relatedSearches).toBeUndefined();
  });
});

describe('searchSerper — misconfiguration', () => {
  it('throws "not configured" with status=401 when SERPER_API_KEY is missing', async () => {
    delete process.env['SERPER_API_KEY'];
    const { searchSerper } = await import('../../../packages/tools/src/adapters/search/serper.js');
    await expect(searchSerper({ query: 'q' })).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining('not configured'),
    });
  });
});
