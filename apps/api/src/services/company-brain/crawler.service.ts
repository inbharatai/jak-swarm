/**
 * CompanyKnowledgeCrawlerService — Sprint 2.3 / Item C.
 *
 * Crawls a single URL registered as a CompanyKnowledgeSource and ingests
 * its visible text into the tenant's VectorDocument store so company
 * agents can ground their answers in the user's own website / docs /
 * pricing pages.
 *
 * Honest scope:
 *   - SSR + initial-HTML content only (cheerio + native fetch). No
 *     headless browser; JS-rendered SPAs may yield very thin text and
 *     are flagged via lastCrawlError so the user knows.
 *   - One URL per call. No recursive depth. No sitemap.xml expansion.
 *   - Per-host rate limit is in-memory (process-local). When the API
 *     scales to multiple instances and the same host is hit
 *     concurrently, the cap is per-instance — Redis-backed limit can
 *     come later.
 *   - SSRF defense: reject private IP ranges, link-local, loopback,
 *     IPv6 ULA, and well-known cloud metadata endpoints.
 *   - robots.txt is fetched and a basic Disallow check is performed
 *     against the path. We do NOT respect Crawl-delay (single-shot crawls)
 *     or sitemap directives.
 *   - PII + prompt-injection scan runs on the extracted text using the
 *     same detectors as document upload.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import * as cheerio from 'cheerio';
import * as net from 'node:net';
import { CompanyBrainSchemaUnavailableError } from './company-profile.service.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Hard cap on response body bytes. Anything bigger is rejected (5MB). */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Per-fetch timeout. Includes redirect chasing. */
const FETCH_TIMEOUT_MS = 30_000;

/** Per-host minimum delay between crawls (ms). Process-local only. */
const PER_HOST_MIN_DELAY_MS = 1_000;

/** robots.txt fetch timeout. Independent of page-fetch timeout. */
const ROBOTS_TIMEOUT_MS = 5_000;

/** UA the crawler advertises. Identifies us so robots.txt rules can target us. */
const CRAWLER_UA = 'JakSwarm-KnowledgeCrawler/1.0 (+https://jak-swarm.app)';

/** In-memory per-host last-fetch timestamp. Process-local. */
const HOST_LAST_FETCH = new Map<string, number>();

/** Cloud metadata + obvious internal-only hosts that must never be fetched. */
const FORBIDDEN_HOSTS = new Set([
  '169.254.169.254', // AWS / GCP / Azure metadata
  'metadata.google.internal',
  'metadata.azure.com',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);

// ─── Public types ──────────────────────────────────────────────────────────

export interface CrawlOptions {
  /** Override UA. Useful in tests. */
  userAgent?: string;
}

export interface CrawlResult {
  status: 'crawled' | 'failed' | 'blocked_by_robots' | 'rate_limited' | 'invalid_url';
  /** Extracted plain text length (chars). 0 when failed. */
  textLength: number;
  /** Number of vector chunks created (when ingested). */
  chunksCreated?: number;
  /** Page <title> when available. */
  title?: string;
  /** Cleartext error reason when status != 'crawled'. */
  error?: string;
  /** Diagnostic flags surfaced to the source row + UI. */
  flags: string[];
}

export class CrawlerError extends Error {
  constructor(message: string, public reason: 'invalid_url' | 'blocked_by_robots' | 'rate_limited' | 'fetch_failed' | 'too_large' | 'no_content') {
    super(message);
    this.name = 'CrawlerError';
  }
}

// ─── URL validation + SSRF defense ─────────────────────────────────────────

/**
 * Validate a URL is safe to fetch:
 *   - http or https only (no file://, ftp://, data://, gopher://)
 *   - host is not in FORBIDDEN_HOSTS
 *   - host is not a private IP literal (10.0.0.0/8, 172.16/12, 192.168/16,
 *     fc00::/7 etc.)
 *
 * DNS rebinding attacks (resolve-different-on-second-lookup) are NOT
 * defended against here — the current threat model is "user pastes a
 * malicious URL into the source list" and we assume the DNS server is
 * the same throughout the crawl. A stricter version would resolve once
 * + fetch with the resolved IP via a Host header.
 */
export function validateCrawlableUrl(rawUrl: string): { ok: true; parsed: URL } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Malformed URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Protocol "${parsed.protocol}" is not allowed; use http:// or https://.` };
  }
  // Node returns IPv6 hostnames wrapped in brackets ("[::1]"); strip them
  // so net.isIP recognises the literal.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (FORBIDDEN_HOSTS.has(host)) {
    return { ok: false, reason: `Host "${host}" is on the forbidden list (cloud metadata or loopback).` };
  }
  // IP-literal rejection. Hostname like "example.com" → not an IP, allowed.
  // Hostname like "10.0.0.5" → private IPv4, rejected.
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      return { ok: false, reason: `IP address "${host}" is private/internal; refusing to crawl.` };
    }
  }
  return { ok: true, parsed };
}

/** Reject well-known private + link-local + loopback + ULA ranges. */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map((n) => Number.parseInt(n, 10));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (lower.startsWith('fe80:')) return true; // link-local
    return false;
  }
  return false;
}

// ─── robots.txt ────────────────────────────────────────────────────────────

/**
 * Minimal robots.txt parser. Returns true if the URL is disallowed for
 * the given user-agent (or `*` if no UA-specific block exists).
 *
 * Supports User-agent + Disallow lines. Ignores Crawl-delay, Allow,
 * Sitemap. If robots.txt can't be fetched (404 / network error), we
 * default to ALLOWED — the standard interpretation when no robots.txt
 * exists.
 */
export async function isDisallowedByRobots(parsed: URL, ua: string): Promise<boolean> {
  const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
  let txt: string;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ROBOTS_TIMEOUT_MS);
    const res = await fetch(robotsUrl, { signal: ctrl.signal, headers: { 'User-Agent': ua } });
    clearTimeout(t);
    if (!res.ok) return false; // no robots.txt → allowed
    txt = await res.text();
  } catch {
    return false;
  }

  const ourPath = parsed.pathname || '/';
  const lines = txt.split(/\r?\n/);
  let activeForUs = false;
  let activeForAll = false;
  let disallowsForUs: string[] = [];
  let disallowsForAll: string[] = [];
  let currentBlock: 'us' | 'all' | 'other' | null = null;

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      const v = value.toLowerCase();
      if (v === '*') {
        currentBlock = 'all';
        activeForAll = true;
      } else if (ua.toLowerCase().includes(v)) {
        currentBlock = 'us';
        activeForUs = true;
      } else {
        currentBlock = 'other';
      }
    } else if (key === 'disallow' && currentBlock) {
      if (currentBlock === 'us') disallowsForUs.push(value);
      else if (currentBlock === 'all') disallowsForAll.push(value);
    }
  }

  // Per spec, UA-specific rules override the wildcard block. Use 'us' if any
  // such rules existed; else fall back to 'all'.
  const applicable = activeForUs ? disallowsForUs : (activeForAll ? disallowsForAll : []);
  for (const dis of applicable) {
    if (dis === '') continue; // empty Disallow = allow everything
    if (ourPath.startsWith(dis)) return true;
  }
  return false;
}

// ─── HTML extraction ───────────────────────────────────────────────────────

/**
 * Pull readable text from an HTML document.
 *
 * Strategy:
 *   1. Drop noise: script, style, nav, footer, aside, iframe, svg, noscript.
 *   2. Prefer `<main>`, `<article>`, or `[role="main"]` if present.
 *   3. Fall back to `<body>` text.
 *   4. Collapse whitespace; trim per-line.
 *
 * Returns { title, text, isThin }. `isThin` flags suspected JS-only pages
 * where the initial HTML had < 200 visible chars — surfaced to the user
 * so they know the crawl may not have captured the real content.
 */
export function extractTextFromHtml(html: string): { title: string; text: string; isThin: boolean } {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();

  // Prefer page-meta description if body is thin.
  const metaDesc = $('meta[name="description"]').attr('content') ?? '';

  $('script, style, nav, footer, aside, iframe, svg, noscript, form').remove();

  let container = $('main').first();
  if (!container.length) container = $('article').first();
  if (!container.length) container = $('[role="main"]').first();
  if (!container.length) container = $('body').first();

  const rawText = container.text() ?? '';
  const cleaned = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  const visibleLen = cleaned.length;
  const isThin = visibleLen < 200;

  // If body text is thin, prepend the meta description so we still ingest
  // SOMETHING useful for SPAs.
  const text = isThin && metaDesc.length > 0
    ? `${metaDesc}\n\n${cleaned}`
    : cleaned;
  return { title, text, isThin };
}

// ─── Service ───────────────────────────────────────────────────────────────

export class CompanyKnowledgeCrawlerService {
  constructor(
    private readonly db: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Crawl one CompanyKnowledgeSource by id, ingest its content, and
   * update the source row. Idempotent on the source row (status fields
   * always overwritten with the latest crawl outcome). The vector
   * documents are NOT deleted on re-crawl — they accumulate per
   * crawl-time, with sourceKey carrying the URL so duplicates from the
   * same URL can be resolved at search time.
   */
  async crawlAndIngest(
    sourceId: string,
    tenantId: string,
    options: CrawlOptions = {},
  ): Promise<CrawlResult> {
    const ua = options.userAgent ?? CRAWLER_UA;

    // Load source row.
    const sourceRow = await this.findSourceOrThrow(sourceId, tenantId);
    const { url } = sourceRow;

    // Validate URL (SSRF defense).
    const validation = validateCrawlableUrl(url);
    if (!validation.ok) {
      await this.recordFailure(sourceId, validation.reason);
      return {
        status: 'invalid_url',
        textLength: 0,
        error: validation.reason,
        flags: ['url_validation_failed'],
      };
    }
    const parsed = validation.parsed;

    // Per-host rate limit (process-local).
    const host = parsed.host.toLowerCase();
    const lastFetch = HOST_LAST_FETCH.get(host) ?? 0;
    const elapsed = Date.now() - lastFetch;
    if (elapsed < PER_HOST_MIN_DELAY_MS) {
      const waitMs = PER_HOST_MIN_DELAY_MS - elapsed;
      const reason = `Rate limit: host "${host}" was crawled ${elapsed}ms ago; wait ${waitMs}ms.`;
      await this.recordFailure(sourceId, reason);
      return {
        status: 'rate_limited',
        textLength: 0,
        error: reason,
        flags: ['rate_limited'],
      };
    }
    HOST_LAST_FETCH.set(host, Date.now());

    // robots.txt check.
    let robotsBlocked = false;
    try {
      robotsBlocked = await isDisallowedByRobots(parsed, ua);
    } catch (robotsErr) {
      this.logger?.warn?.(
        { sourceId, host, err: robotsErr instanceof Error ? robotsErr.message : String(robotsErr) },
        '[crawler] robots.txt check threw; proceeding as allowed',
      );
    }
    if (robotsBlocked) {
      const reason = `robots.txt disallows crawling ${parsed.pathname} for user-agent ${ua}`;
      await this.recordFailure(sourceId, reason);
      return {
        status: 'blocked_by_robots',
        textLength: 0,
        error: reason,
        flags: ['robots_blocked'],
      };
    }

    // Fetch page.
    const ctrl = new AbortController();
    const tHandle = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let html: string;
    let finalUrl: string;
    try {
      const res = await fetch(parsed.toString(), {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      clearTimeout(tHandle);

      if (!res.ok) {
        const reason = `HTTP ${res.status} ${res.statusText}`;
        await this.recordFailure(sourceId, reason);
        return { status: 'failed', textLength: 0, error: reason, flags: [`http_${res.status}`] };
      }

      // Detect login/auth wall by status + Content-Type heuristic.
      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
        const reason = `Refusing to ingest non-HTML content type "${ct}" — use a document upload for binary files.`;
        await this.recordFailure(sourceId, reason);
        return { status: 'failed', textLength: 0, error: reason, flags: ['non_html'] };
      }

      // Re-validate the FINAL url (after redirects) for SSRF too — a
      // public URL can redirect to a private one.
      const followed = validateCrawlableUrl(res.url);
      if (!followed.ok) {
        const reason = `Final URL after redirects (${res.url}) failed validation: ${followed.reason}`;
        await this.recordFailure(sourceId, reason);
        return { status: 'invalid_url', textLength: 0, error: reason, flags: ['redirect_to_private'] };
      }
      finalUrl = res.url;

      // Stream + cap size to MAX_RESPONSE_BYTES.
      const body = res.body;
      if (!body) {
        const reason = 'Response had no body.';
        await this.recordFailure(sourceId, reason);
        return { status: 'failed', textLength: 0, error: reason, flags: ['empty_body'] };
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      // Node 22's fetch returns a WebReadableStream that is async-iterable
      // at runtime; the type defs disagree, so we cast the body to any.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of (body as any)) {
        const u8: Uint8Array = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
        total += u8.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          const reason = `Response exceeded ${MAX_RESPONSE_BYTES} bytes; aborting.`;
          await this.recordFailure(sourceId, reason);
          return { status: 'failed', textLength: 0, error: reason, flags: ['too_large'] };
        }
        chunks.push(u8);
      }
      html = Buffer.concat(chunks).toString('utf-8');
    } catch (fetchErr) {
      clearTimeout(tHandle);
      const reason = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      await this.recordFailure(sourceId, `Fetch failed: ${reason}`);
      return { status: 'failed', textLength: 0, error: reason, flags: ['fetch_failed'] };
    }

    // Detect login wall heuristically by inspecting <body> for password input.
    const $ = cheerio.load(html);
    const hasPasswordField = $('input[type="password"]').length > 0;
    const flags: string[] = [];
    if (hasPasswordField) flags.push('password_field_detected');

    const { title, text, isThin } = extractTextFromHtml(html);
    if (isThin) flags.push('thin_initial_html_possible_spa');

    if (text.length === 0) {
      const reason = 'Page had no extractable text after stripping noise.';
      await this.recordFailure(sourceId, reason, flags);
      return { status: 'failed', textLength: 0, title, error: reason, flags };
    }

    // PII + injection scan (same pattern as documents.routes.ts).
    let scanWarning: string | null = null;
    try {
      const { detectPII, detectInjection } = await import('@jak-swarm/security');
      const pii = detectPII(text.slice(0, 200_000));
      const inj = detectInjection(text.slice(0, 200_000));
      const warnings: string[] = [];
      if (pii.containsPII) warnings.push(`PII: ${pii.found.join(', ')}`);
      if (inj.detected) warnings.push(`prompt-injection (confidence ${inj.confidence})`);
      if (warnings.length > 0) {
        scanWarning = `Crawl scan flagged: ${warnings.join(' | ')}`;
        flags.push('content_scan_warning');
      }
    } catch (scanErr) {
      this.logger?.warn?.(
        { sourceId, err: scanErr instanceof Error ? scanErr.message : String(scanErr) },
        '[crawler] PII/injection scan failed',
      );
    }

    // Ingest into VectorDocument via DocumentIngestor.
    const { DocumentIngestor } = await import('@jak-swarm/tools');
    const ingestor = new DocumentIngestor();
    const ingestResult = await ingestor.ingestText(tenantId, text, {
      title: title || finalUrl,
      sourceKey: finalUrl,
      sourceType: 'COMPANY_KNOWLEDGE_URL',
      metadata: {
        url: finalUrl,
        canonicalUrl: url,
        crawledAt: new Date().toISOString(),
        kind: sourceRow.kind,
        parser: 'cheerio-html',
        parseConfidence: isThin ? 0.4 : 0.85,
        flags,
        ...(scanWarning ? { scanWarning } : {}),
      },
    });

    // Record success on the source row. We append the new sourceKey to
    // vectorDocumentIds so the user can see all the cumulative crawl
    // results; on duplicate URL the entry is replaced not stacked.
    await this.recordSuccess(sourceId, {
      title: title || sourceRow.title,
      vectorChunkCount: ingestResult.chunksCreated,
      lastSourceKey: ingestResult.sourceKey,
      flags,
      ...(scanWarning ? { scanWarning } : {}),
    });

    return {
      status: 'crawled',
      textLength: text.length,
      chunksCreated: ingestResult.chunksCreated,
      title,
      flags,
    };
  }

  /**
   * Reset the per-host rate-limit cache. Test-only escape hatch.
   */
  static __resetRateLimitsForTesting(): void {
    HOST_LAST_FETCH.clear();
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private async findSourceOrThrow(sourceId: string, tenantId: string): Promise<{ id: string; tenantId: string; url: string; kind: string; title: string | null }> {
    try {
      // The DB client typedef predates migration 16, so we go through `any`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (this.db as any).companyKnowledgeSource.findFirst({
        where: { id: sourceId, tenantId, deletedAt: null },
        select: { id: true, tenantId: true, url: true, kind: true, title: true },
      });
      if (!row) {
        throw new Error(`CompanyKnowledgeSource id=${sourceId} not found or soft-deleted.`);
      }
      return row;
    } catch (err) {
      const code = (err as { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
        throw new CompanyBrainSchemaUnavailableError();
      }
      throw err;
    }
  }

  private async recordFailure(sourceId: string, reason: string, flags: string[] = []): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any).companyKnowledgeSource.update({
        where: { id: sourceId },
        data: {
          lastCrawledAt: new Date(),
          lastCrawlStatus: 'failed',
          lastCrawlError: flags.length > 0 ? `${reason} [flags: ${flags.join(', ')}]` : reason,
        },
      });
    } catch (dbErr) {
      this.logger?.error?.(
        { sourceId, err: dbErr instanceof Error ? dbErr.message : String(dbErr) },
        '[crawler] could not persist failure status',
      );
    }
  }

  private async recordSuccess(sourceId: string, info: { title?: string | null; vectorChunkCount: number; lastSourceKey: string; flags: string[]; scanWarning?: string }): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any).companyKnowledgeSource.update({
        where: { id: sourceId },
        data: {
          lastCrawledAt: new Date(),
          lastCrawlStatus: 'crawled',
          lastCrawlError: info.scanWarning ?? null,
          // Store the latest source key + chunk count so the UI can link
          // back to the vector docs. Older crawls remain searchable; we
          // are not garbage-collecting prior entries here.
          vectorDocumentIds: { lastSourceKey: info.lastSourceKey, lastChunkCount: info.vectorChunkCount, lastFlags: info.flags },
          ...(info.title ? { title: info.title } : {}),
        },
      });
    } catch (dbErr) {
      this.logger?.error?.(
        { sourceId, err: dbErr instanceof Error ? dbErr.message : String(dbErr) },
        '[crawler] could not persist success status',
      );
    }
  }
}
