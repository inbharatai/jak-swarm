/**
 * Crawler unit tests — Sprint 2.3 / Item C.
 *
 * Covers the pure helpers (URL validation, robots.txt parser, HTML
 * extraction). The full crawlAndIngest flow is exercised end-to-end via
 * a separate integration test that mocks fetch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateCrawlableUrl,
  isDisallowedByRobots,
  extractTextFromHtml,
  CompanyKnowledgeCrawlerService,
} from '../../../apps/api/src/services/company-brain/crawler.service.js';

describe('validateCrawlableUrl — SSRF defense', () => {
  it('accepts plain https URLs', () => {
    const r = validateCrawlableUrl('https://example.com/about');
    expect(r.ok).toBe(true);
  });

  it('accepts plain http URLs', () => {
    const r = validateCrawlableUrl('http://example.com/');
    expect(r.ok).toBe(true);
  });

  it('rejects malformed URLs', () => {
    const r = validateCrawlableUrl('not a url');
    expect(r.ok).toBe(false);
  });

  it('rejects file:// URLs', () => {
    const r = validateCrawlableUrl('file:///etc/passwd');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Protocol');
  });

  it('rejects ftp:// URLs', () => {
    const r = validateCrawlableUrl('ftp://example.com/file');
    expect(r.ok).toBe(false);
  });

  it('rejects AWS metadata IP', () => {
    const r = validateCrawlableUrl('http://169.254.169.254/latest/meta-data/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('forbidden');
  });

  it('rejects metadata.google.internal', () => {
    const r = validateCrawlableUrl('http://metadata.google.internal/computeMetadata/');
    expect(r.ok).toBe(false);
  });

  it('rejects localhost', () => {
    expect(validateCrawlableUrl('http://localhost/').ok).toBe(false);
    expect(validateCrawlableUrl('http://127.0.0.1/').ok).toBe(false);
    expect(validateCrawlableUrl('http://0.0.0.0/').ok).toBe(false);
  });

  it('rejects private IPv4 ranges (10/8, 172.16/12, 192.168/16)', () => {
    expect(validateCrawlableUrl('http://10.0.0.1/').ok).toBe(false);
    expect(validateCrawlableUrl('http://10.255.255.255/').ok).toBe(false);
    expect(validateCrawlableUrl('http://172.16.0.1/').ok).toBe(false);
    expect(validateCrawlableUrl('http://172.31.255.255/').ok).toBe(false);
    expect(validateCrawlableUrl('http://192.168.1.1/').ok).toBe(false);
  });

  it('accepts public IPv4 outside private ranges', () => {
    expect(validateCrawlableUrl('http://172.15.0.1/').ok).toBe(true); // just below 172.16
    expect(validateCrawlableUrl('http://172.32.0.1/').ok).toBe(true); // just above 172.31
    expect(validateCrawlableUrl('http://8.8.8.8/').ok).toBe(true);
  });

  it('rejects IPv6 loopback + ULA + link-local', () => {
    expect(validateCrawlableUrl('http://[::1]/').ok).toBe(false);
    expect(validateCrawlableUrl('http://[fc00::1]/').ok).toBe(false);
    expect(validateCrawlableUrl('http://[fd12:3456:789a::1]/').ok).toBe(false);
    expect(validateCrawlableUrl('http://[fe80::1]/').ok).toBe(false);
  });
});

describe('isDisallowedByRobots — robots.txt parser', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  function mockRobotsResponse(robotsTxt: string) {
    global.fetch = vi.fn(async () => new Response(robotsTxt, { status: 200, headers: { 'content-type': 'text/plain' } }));
  }

  function restoreFetch() {
    global.fetch = originalFetch;
  }

  it('returns false when robots.txt is missing (404)', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 404 }));
    const url = new URL('https://example.com/some/path');
    const r = await isDisallowedByRobots(url, 'JakSwarm-KnowledgeCrawler/1.0');
    expect(r).toBe(false);
    restoreFetch();
  });

  it('respects User-agent: * Disallow rules', async () => {
    mockRobotsResponse('User-agent: *\nDisallow: /private/\n');
    expect(await isDisallowedByRobots(new URL('https://example.com/private/secret'), 'JakSwarm/1.0')).toBe(true);
    expect(await isDisallowedByRobots(new URL('https://example.com/public/page'), 'JakSwarm/1.0')).toBe(false);
    restoreFetch();
  });

  it('UA-specific block overrides wildcard', async () => {
    mockRobotsResponse(`User-agent: *
Disallow:

User-agent: jakswarm
Disallow: /
`);
    // Wildcard says allow-all, but jakswarm-specific block disallows everything
    expect(await isDisallowedByRobots(new URL('https://example.com/page'), 'JakSwarm-KnowledgeCrawler/1.0')).toBe(true);
    restoreFetch();
  });

  it('empty Disallow means allow', async () => {
    mockRobotsResponse('User-agent: *\nDisallow:\n');
    expect(await isDisallowedByRobots(new URL('https://example.com/'), 'JakSwarm/1.0')).toBe(false);
    restoreFetch();
  });

  it('handles comments + blank lines', async () => {
    mockRobotsResponse(`# comment
User-agent: *

Disallow: /admin
`);
    expect(await isDisallowedByRobots(new URL('https://example.com/admin'), 'JakSwarm/1.0')).toBe(true);
    expect(await isDisallowedByRobots(new URL('https://example.com/about'), 'JakSwarm/1.0')).toBe(false);
    restoreFetch();
  });

  it('treats fetch failure as allowed (defensive)', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down'); });
    expect(await isDisallowedByRobots(new URL('https://example.com/page'), 'JakSwarm/1.0')).toBe(false);
    restoreFetch();
  });
});

describe('extractTextFromHtml', () => {
  it('extracts title + body content, dropping noise tags', () => {
    const html = `
      <html>
      <head><title>About Us</title></head>
      <body>
        <nav>Home | About | Contact</nav>
        <main>
          <h1>Welcome to Acme Widgets</h1>
          <p>We make widgets in seven colors and three sizes for industrial customers across North America.</p>
          <p>Our flagship product is the Mark IV widget which has been deployed in over 200 manufacturing plants since 2018.</p>
          <p>Customers include Fortune 500 manufacturers, regional fabricators, and university research labs.</p>
        </main>
        <script>console.log('tracking')</script>
        <footer>(c) 2026</footer>
      </body>
      </html>
    `;
    const r = extractTextFromHtml(html);
    expect(r.title).toBe('About Us');
    expect(r.text).toContain('Welcome to Acme Widgets');
    expect(r.text).toContain('seven colors');
    expect(r.text).not.toContain('console.log');
    expect(r.text).not.toContain('(c) 2026'); // footer dropped
    expect(r.text).not.toContain('Home | About'); // nav dropped
    expect(r.isThin).toBe(false);
  });

  it('falls back to body when <main> + <article> absent', () => {
    const html = '<html><head><title>X</title></head><body><div><p>Hello there from a div</p></div></body></html>';
    const r = extractTextFromHtml(html);
    expect(r.text).toContain('Hello there from a div');
  });

  it('flags isThin when body is empty + meta description fills in', () => {
    const html = `<html>
      <head>
        <title>SPA App</title>
        <meta name="description" content="A single-page app for managing widgets">
      </head>
      <body><div id="root"></div></body>
    </html>`;
    const r = extractTextFromHtml(html);
    expect(r.isThin).toBe(true);
    expect(r.text).toContain('A single-page app');
  });

  it('returns empty text honestly when there is nothing to extract', () => {
    const html = '<html><head></head><body></body></html>';
    const r = extractTextFromHtml(html);
    expect(r.text).toBe('');
    expect(r.isThin).toBe(true);
  });

  it('preserves <article> over <main> when only article is present', () => {
    const html = '<html><body><article><p>Article content</p></article><div>Other stuff</div></body></html>';
    const r = extractTextFromHtml(html);
    expect(r.text).toContain('Article content');
    expect(r.text).not.toContain('Other stuff'); // article wins
  });
});

describe('CompanyKnowledgeCrawlerService.crawlAndIngest — DB stub', () => {
  beforeEach(() => {
    CompanyKnowledgeCrawlerService.__resetRateLimitsForTesting();
  });

  it('returns invalid_url + persists failure when source URL is forbidden', async () => {
    const updates: unknown[] = [];
    const db = {
      companyKnowledgeSource: {
        findFirst: vi.fn(async () => ({ id: 's1', tenantId: 't1', url: 'http://10.0.0.5/', kind: 'website', title: null })),
        update: vi.fn(async (args: unknown) => { updates.push(args); }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new CompanyKnowledgeCrawlerService(db as any);
    const result = await svc.crawlAndIngest('s1', 't1');
    expect(result.status).toBe('invalid_url');
    expect(result.flags).toContain('url_validation_failed');
    expect(updates.length).toBe(1);
  });

  it('returns rate_limited when same host hit twice in <1s', async () => {
    const db = {
      companyKnowledgeSource: {
        findFirst: vi.fn(async () => ({ id: 's1', tenantId: 't1', url: 'https://example.com/', kind: 'website', title: null })),
        update: vi.fn(async () => undefined),
      },
    };
    // Mock fetch to a benign HTML page so the first call goes through.
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('robots.txt')) return new Response('', { status: 404 });
      return new Response('<html><head><title>x</title></head><body><p>hi</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new CompanyKnowledgeCrawlerService(db as any);
    // First call may succeed or fail at the ingest step (no DocumentIngestor wired) — we don't care here, only that it sets the rate-limit timestamp.
    try { await svc.crawlAndIngest('s1', 't1'); } catch { /* ingest failure not relevant */ }
    // Second call within 1s must rate-limit.
    const r2 = await svc.crawlAndIngest('s1', 't1');
    expect(r2.status).toBe('rate_limited');
    expect(r2.flags).toContain('rate_limited');
  });
});
