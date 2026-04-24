import { describe, it, expect } from 'vitest';

/**
 * Live Serper integration test — hits the real `google.serper.dev` endpoint.
 *
 * Gated behind `RUN_LIVE_SEARCH=1` so CI doesn't burn real quota. Runs on
 * demand to verify:
 *   - The Serper API contract hasn't changed
 *   - Our typed response shape still maps cleanly
 *   - Real-world latency is within the adapter's 10s overall budget
 *   - Knowledge graph + answer box are populated for known-good queries
 *   - News mode returns dated results
 *
 * Run locally:
 *   SERPER_API_KEY=sk-... RUN_LIVE_SEARCH=1 pnpm test -- --run integration/serper-live.test.ts
 *
 * This is the "does Serper actually work in prod" safety net the mocked
 * unit suite can't provide. Five extra minutes per quarterly release.
 */

const SHOULD_RUN =
  process.env['RUN_LIVE_SEARCH'] === '1' || process.env['RUN_LIVE_SEARCH'] === 'true';
const HAS_KEY = Boolean(process.env['SERPER_API_KEY']);

const runIf = SHOULD_RUN && HAS_KEY ? describe : describe.skip;

runIf('Serper — LIVE integration (hits google.serper.dev)', () => {
  it('returns real organic results for a stable query', async () => {
    const { searchSerper } = await import('../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'openai chatgpt', maxResults: 5 });

    expect(res.source).toBe('serper');
    expect(res.query).toBe('openai chatgpt');
    expect(res.mode).toBe('web');
    expect(res.results.length).toBeGreaterThanOrEqual(3);
    expect(res.results.length).toBeLessThanOrEqual(5);
    for (const r of res.results) {
      expect(r.title).toBeTruthy();
      expect(r.url).toMatch(/^https?:\/\//);
      expect(typeof r.relevanceScore).toBe('number');
    }
    // The "openai chatgpt" query reliably returns a knowledge-graph card
    expect(res.knowledgeGraph?.title).toBeTruthy();
    expect(typeof res.latencyMs).toBe('number');
    expect(res.latencyMs).toBeLessThan(10_000);
  }, 20_000);

  it('returns peopleAlsoAsk for a conversational query', async () => {
    const { searchSerper } = await import('../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'what is langgraph used for', maxResults: 3 });
    expect(res.source).toBe('serper');
    // PAA is common on question-shape queries but not guaranteed. Don't fail
    // the test if it's absent — just assert shape when present.
    if (res.peopleAlsoAsk && res.peopleAlsoAsk.length > 0) {
      expect(res.peopleAlsoAsk[0]?.question).toBeTruthy();
    }
  }, 20_000);

  it('returns dated news results for mode=news', async () => {
    const { searchSerper } = await import('../../packages/tools/src/adapters/search/serper.js');
    const res = await searchSerper({ query: 'stock market today', mode: 'news', maxResults: 5 });
    expect(res.source).toBe('serper');
    expect(res.mode).toBe('news');
    expect(res.results.length).toBeGreaterThan(0);
    // News content has the `date · source · snippet` format — at minimum one should contain a common source
    // or a recognisable date-ish token.
    const hasDateOrSource = res.results.some((r) =>
      /\b(2024|2025|2026|ago|today|yesterday|AM|PM|EST|UTC|·)\b/.test(r.content),
    );
    expect(hasDateOrSource).toBe(true);
  }, 20_000);

  it('respects country + language biasing', async () => {
    const { searchSerper } = await import('../../packages/tools/src/adapters/search/serper.js');
    const indiaRes = await searchSerper({
      query: 'stock broker',
      country: 'in',
      language: 'en',
      maxResults: 5,
    });
    expect(indiaRes.source).toBe('serper');
    expect(indiaRes.results.length).toBeGreaterThan(0);
    // Rough heuristic — India-biased SERP for this query usually surfaces at
    // least one Indian broker (Zerodha / Upstox / Groww / ICICI / Angel).
    const body = indiaRes.results.map((r) => (r.title + ' ' + r.content).toLowerCase()).join(' ');
    const hasIndianBroker = /zerodha|upstox|groww|icici|angel|hdfc|sharekhan|kotak|motilal/.test(body);
    expect(hasIndianBroker).toBe(true);
  }, 20_000);
});
