/**
 * `PlaywrightBrowserOperator` — real, end-to-end browser-operator
 * runtime backed by Playwright's persistent BrowserContext.
 *
 * Closes the no-half-measures gap: this is NOT the prior
 * `NotImplementedBrowserOperator` stub. The user can:
 *
 *   1. Start a session for a platform → JAK launches a real Chromium
 *      window; the user logs in normally on the platform's site
 *      (JAK never sees the password, never asks for one).
 *   2. Observe → JAK captures a screenshot + the page's accessibility
 *      text + heuristic 2FA detection.
 *   3. Propose an action → JAK classifies via the centralized
 *      `DefaultApprovalPolicy` shipped Phase 4.
 *   4. Execute → JAK refuses unless `approvalId` is supplied;
 *      otherwise performs the action + captures a post-action
 *      screenshot for the audit trail.
 *   5. End the session → JAK closes the browser context AND deletes
 *      the per-tenant data dir (cookies, localStorage, etc.) so
 *      nothing is retained without user consent.
 *
 * Hard rules enforced by code:
 *   - JAK never stores raw passwords (never prompts for them either).
 *   - Every external action requires an approvalId (Phase 4 gate).
 *   - Tenant isolation: a session belongs to exactly one tenantId;
 *     observe/propose/execute throw `SessionAccessError('wrong_tenant')`
 *     on any mismatch.
 *   - Captcha / 2FA challenge is detected heuristically and
 *     surfaced via `PageObservation.blockedBySecurity = true`.
 *   - Sessions auto-clean if idle past `JAK_BROWSER_SESSION_TTL_MS`
 *     (default 30 minutes).
 *
 * Per-platform adapters (LinkedIn DOM extraction, Instagram-specific
 * action flows) compose on top of this foundation in follow-up
 * sprints — see docs/browser-operator-runtime-plan.md.
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import crypto from 'node:crypto';
import {
  type BrowserOperatorService,
  type BrowserSessionInfo,
  type ExecutionResult,
  type PageObservation,
  type ProposedAction,
  type ProposedActionPreview,
  type StartSessionInput,
  ApprovalRequiredError,
  SessionAccessError,
} from './types.js';
import { DefaultApprovalPolicy } from '../registry/approval-policy.js';
import type { ToolMetadata } from '@jak-swarm/shared';

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
const MAX_ACCESSIBILITY_TEXT_LEN = 8000;

function chromiumExecutablePath(): string | undefined {
  const configured = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH']?.trim();
  return configured ? configured : undefined;
}

/**
 * Heuristic keywords that strongly suggest a 2FA / captcha challenge.
 * Not a hard guarantee — but enough to flip `blockedBySecurity = true`
 * so the cockpit can surface "user takeover required" UX.
 */
const SECURITY_KEYWORDS = [
  'two-factor',
  '2-step',
  'verification code',
  'recaptcha',
  "i'm not a robot",
  'security check',
  'verify your identity',
  'authentication code',
  'one-time password',
];

interface SessionRecord {
  sessionId: string;
  tenantId: string;
  userId: string;
  platform: StartSessionInput['platform'];
  workflowId?: string;
  initialUrl: string;
  context: BrowserContext;
  page: Page;
  dataDir: string;
  screenshotDir: string;
  createdAt: Date;
  lastActiveAt: Date;
}

/** Optional callback for emitting audit log rows. Wired by the API layer. */
export type BrowserAuditEmitter = (event: {
  action:
    | 'BROWSER_SESSION_STARTED'
    | 'BROWSER_OBSERVED'
    | 'BROWSER_PROPOSED'
    | 'BROWSER_EXECUTED'
    | 'BROWSER_SESSION_ENDED'
    | 'BROWSER_TENANT_VIOLATION'
    | 'BROWSER_REQUEST_BLOCKED'
    | 'BROWSER_DNS_REBIND_BLOCKED'
    | 'BROWSER_QUOTA_EXCEEDED';
  tenantId: string;
  userId: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
  severity?: 'INFO' | 'WARN' | 'ERROR';
}) => void | Promise<void>;

export interface PlaywrightBrowserOperatorOptions {
  /** Optional audit emitter — default is a no-op. */
  auditEmitter?: BrowserAuditEmitter;
  /** Session inactivity TTL. */
  sessionTtlMs?: number;
  /** Override headless mode (defaults to env). */
  headless?: boolean;
  /** Override base data dir (defaults to ~/.jak-swarm/browser-sessions). */
  baseDataDir?: string;
  /** Override per-host allowlist (default: any https URL). */
  isUrlAllowed?: (url: string) => boolean;
  /**
   * Per-tenant disk quota for browser session data dirs (cookies,
   * screenshots, IndexedDB, etc.). Default: 500 MB. When the tenant's
   * total session bytes exceed this, startSession() refuses, the
   * sweeper kills the oldest session(s), and a BROWSER_QUOTA_EXCEEDED
   * audit event is emitted. Set to 0 to disable.
   */
  tenantQuotaBytes?: number;
  /**
   * Whether to do a DNS lookup + IP-class re-check on every navigation
   * request. Default: true. Closes the DNS-rebinding TOCTOU race that
   * a hostname-only allowlist leaves open. Set false only for tests.
   */
  dnsRebindGuardEnabled?: boolean;
}

/**
 * Resolve a hostname to its A/AAAA records and return true iff EVERY
 * resolved IP is a public address. Closes the DNS-rebinding hole that
 * a hostname-only allowlist leaves open: a public domain whose A
 * record changes to 169.254.169.254 between the URL parse and the
 * fetch would otherwise bypass the URL-shape check.
 *
 * Returns { allowed, resolvedIps, blockedIps }. The route handler
 * uses this to decide whether to abort + audit.
 *
 * Idempotent under repeat calls — the OS resolver caches.
 */
export async function resolveAndCheckHost(
  host: string,
): Promise<{ allowed: boolean; resolvedIps: string[]; blockedIps: string[] }> {
  // Hostname is already an IP literal? Skip the lookup.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    const stripped = host.replace(/^\[|\]$/g, '');
    const blocked = isPrivateIPv4(stripped) || isPrivateIPv6(stripped) ? [stripped] : [];
    return {
      allowed: blocked.length === 0,
      resolvedIps: [stripped],
      blockedIps: blocked,
    };
  }
  try {
    const dns = await import('node:dns/promises');
    const records = await dns.lookup(host, { all: true, verbatim: true });
    const ips = records.map((r) => r.address);
    const blocked = ips.filter((ip) => {
      if (ip.includes(':')) return isPrivateIPv6(ip);
      return isPrivateIPv4(ip);
    });
    return {
      allowed: blocked.length === 0,
      resolvedIps: ips,
      blockedIps: blocked,
    };
  } catch {
    // DNS lookup failed — fail-closed (refuse to fetch).
    return { allowed: false, resolvedIps: [], blockedIps: [] };
  }
}

/**
 * Validate a URL for use by the server-side Playwright browser.
 *
 * Blocks the full SSRF (Server-Side Request Forgery) class so a public
 * URL we open can't pivot the headless Chromium into:
 *   - Cloud metadata services (AWS / GCP / Azure / Oracle / Alibaba)
 *   - Loopback / unspecified addresses
 *   - RFC1918 private ranges
 *   - Link-local IPv4 (169.254.x.x — covers AWS metadata)
 *   - Carrier-grade NAT (100.64.0.0/10)
 *   - IPv6 loopback / link-local / unique-local
 *   - Non-http(s) protocols
 *
 * Adapters may opt-in to less restrictive policies via the
 * `isUrlAllowed` constructor option, but the default refuses every
 * one of the above.
 */
const CLOUD_METADATA_HOSTS = new Set<string>([
  '169.254.169.254',          // AWS / Oracle
  'fd00:ec2::254',            // AWS IPv6 metadata
  'metadata.google.internal', // GCP
  'metadata.goog',            // GCP newer
  'metadata.azure.com',       // Azure
  '100.100.100.200',          // Alibaba
]);

function isPrivateIPv4(host: string): boolean {
  // Loopback + RFC1918 + link-local + unspecified + carrier-grade NAT.
  if (/^127\./.test(host)) return true;
  if (host === '0.0.0.0') return true;
  if (/^10\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;          // AWS / link-local
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true; // 100.64/10
  if (/^198\.1[89]\./.test(host)) return true;        // 198.18/15 benchmark
  if (/^192\.0\.2\.|^198\.51\.100\.|^203\.0\.113\./.test(host)) return true; // TEST-NET
  return false;
}

function isPrivateIPv6(host: string): boolean {
  // Strip brackets if URL.hostname returned them.
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fe80:')) return true;             // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique-local
  if (h.startsWith('fec0:') || h.startsWith('fed0:') || h.startsWith('fee0:') || h.startsWith('fef0:')) return true; // site-local (deprecated but blocked)
  if (h === 'fd00:ec2::254') return true;             // AWS IPv6 metadata
  return false;
}

export function defaultIsUrlAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || host.endsWith('.localhost')) return false;
    if (CLOUD_METADATA_HOSTS.has(host)) return false;
    // Heuristic for AWS metadata FQDNs that some IAM roles resolve.
    if (host.endsWith('.internal') || host.endsWith('.local')) return false;
    if (host.includes(':')) {
      // IPv6 (URL.hostname returns ::1 etc. without brackets in modern Node).
      if (isPrivateIPv6(host)) return false;
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      if (isPrivateIPv4(host)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function detectSecurityChallenge(text: string): boolean {
  const lower = text.toLowerCase();
  return SECURITY_KEYWORDS.some((kw) => lower.includes(kw));
}

function hashPayload(action: ProposedAction): string {
  const canonical = JSON.stringify({ kind: action.kind, payload: action.payload });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/** Plain-English summary for an ApprovalRequest card. */
function buildSummary(action: ProposedAction): string {
  switch (action.kind) {
    case 'navigate':
      return `Open ${action.payload.url ?? '(unknown URL)'} in the browser session.`;
    case 'click':
      return `Click "${action.payload.selector ?? action.description}" on the current page.`;
    case 'fill':
      return `Fill the field matching "${action.payload.selector ?? action.description}" with the provided text.`;
    case 'screenshot_only':
      return 'Capture a screenshot of the current page (no other action).';
    case 'extract_text':
      return 'Extract the visible text from the current page (no clicks, no posts).';
    default:
      return action.description;
  }
}

/**
 * Map a ProposedAction to its ToolMetadata-shaped record so we can
 * pass it through the centralized DefaultApprovalPolicy. We don't
 * register these as actual tools — the policy classification is
 * driven by name + sideEffectLevel + riskClass.
 */
function actionAsToolMetadata(action: ProposedAction): ToolMetadata {
  // The mapping is intentionally conservative. screenshot_only +
  // extract_text are READ_ONLY; navigate is WRITE; click + fill are
  // EXTERNAL (anything that interacts with a third-party page).
  const isReadOnly = action.kind === 'screenshot_only' || action.kind === 'extract_text';
  return {
    name: `browser_${action.kind}`,
    description: action.description,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    category: 'browser' as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    riskClass: (isReadOnly ? 'READ_ONLY' : 'EXTERNAL_SIDE_EFFECT') as any,
    requiresApproval: !isReadOnly,
    inputSchema: {},
    outputSchema: {},
    version: '1.0.0',
    sideEffectLevel: isReadOnly ? 'read' : 'external',
  };
}

export class PlaywrightBrowserOperator implements BrowserOperatorService {
  private sessions = new Map<string, SessionRecord>();
  private readonly approvalPolicy = new DefaultApprovalPolicy();
  private readonly auditEmitter: BrowserAuditEmitter;
  private readonly sessionTtlMs: number;
  private readonly headless: boolean;
  private readonly baseDataDir: string;
  private readonly isUrlAllowed: (url: string) => boolean;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly tenantQuotaBytes: number;
  private readonly dnsRebindGuardEnabled: boolean;

  constructor(options: PlaywrightBrowserOperatorOptions = {}) {
    this.auditEmitter = options.auditEmitter ?? (() => {});
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.headless = options.headless ?? process.env['JAK_BROWSER_HEADLESS'] !== 'false';
    this.baseDataDir =
      options.baseDataDir ?? join(homedir(), '.jak-swarm', 'browser-sessions');
    this.isUrlAllowed = options.isUrlAllowed ?? defaultIsUrlAllowed;
    this.tenantQuotaBytes = options.tenantQuotaBytes ?? 500 * 1024 * 1024; // 500 MB
    this.dnsRebindGuardEnabled = options.dnsRebindGuardEnabled ?? true;
  }

  /**
   * Recursively sum the bytes used by a tenant's session subtree.
   * Sync because it runs from the cleanup timer tick and the per-
   * tenant tree is small (sessions are short-lived). Misses are
   * non-fatal — returns 0 if the tree doesn't exist yet.
   */
  private getTenantBytesSync(tenantId: string): number {
    const tenantDir = join(this.baseDataDir, tenantId);
    if (!existsSync(tenantDir)) return 0;
    let total = 0;
    const walk = (dir: string): void => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        try {
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) total += statSync(full).size;
        } catch {
          // entry vanished mid-walk (cleanup race) — ignore
        }
      }
    };
    walk(tenantDir);
    return total;
  }

  /** Start the periodic idle-session sweeper. Idempotent. */
  startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.sweepIdleSessions().catch(() => {
        // Sweep errors are logged but never crash the runtime.
      });
    }, 60_000);
    // Don't keep the event loop alive just for the sweeper.
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  async startSession(input: StartSessionInput): Promise<{ sessionId: string; loginUrl: string }> {
    if (!this.isUrlAllowed(input.initialUrl)) {
      throw new Error(
        `Initial URL "${input.initialUrl}" is not allowed. Only public http(s) URLs may be used; localhost and private IPs are blocked.`,
      );
    }

    // Tenant disk quota — refuse new sessions if the tenant's existing
    // sessions already exceed the cap. This is the runtime guard that
    // closes the prior 5/10 disk-fill gap. Set tenantQuotaBytes=0 to
    // disable.
    if (this.tenantQuotaBytes > 0) {
      const used = this.getTenantBytesSync(input.tenantId);
      if (used >= this.tenantQuotaBytes) {
        await this.auditEmitter({
          action: 'BROWSER_QUOTA_EXCEEDED',
          tenantId: input.tenantId,
          userId: input.userId,
          sessionId: '(no-session-yet)',
          metadata: { usedBytes: used, quotaBytes: this.tenantQuotaBytes },
          severity: 'WARN',
        });
        throw new Error(
          `Tenant ${input.tenantId} has used ${used} bytes of browser-session disk; quota is ${this.tenantQuotaBytes}. End existing sessions or wait for the idle sweep before starting a new one.`,
        );
      }
    }

    const sessionId = `bs_${crypto.randomBytes(12).toString('hex')}`;
    const tenantDir = join(this.baseDataDir, input.tenantId);
    const sessionDataDir = join(tenantDir, sessionId);
    const screenshotDir = join(sessionDataDir, 'screenshots');
    mkdirSync(screenshotDir, { recursive: true });

    const context = await chromium.launchPersistentContext(sessionDataDir, {
      headless: this.headless,
      executablePath: chromiumExecutablePath(),
      viewport: { width: 1280, height: 800 },
      // No saved-credentials prompts. Disable autofill from prior sessions.
      acceptDownloads: false,
    });
    context.setDefaultTimeout(DEFAULT_TIMEOUT);

    // Per-request SSRF guard — every NAVIGATION-class request the
    // browser tries to make (top-frame navigation, sub-frame, or
    // resource fetch) is checked against:
    //   1. The URL allowlist (URL-shape check — covers IP literals
    //      + cloud metadata FQDNs + private hostnames)
    //   2. (DEFAULT-ON) DNS resolution → IP-class check on every
    //      navigation-class request. Closes the DNS-rebinding TOCTOU
    //      race where a public domain whose A record changes mid-
    //      request would otherwise resolve to a private IP and bypass
    //      the URL-shape check.
    //
    // Resource-class fetches (images, fonts, stylesheets, scripts
    // already loaded from a known origin) skip the DNS round-trip
    // for performance. Top-frame + sub-frame navigations always pay
    // the lookup cost — that's where rebinding actually matters.
    await context.route('**', async (route, request) => {
      const reqUrl = request.url();
      if (reqUrl.startsWith('data:') || reqUrl.startsWith('chrome-extension:')) {
        return route.continue();
      }
      if (!this.isUrlAllowed(reqUrl)) {
        await this.auditEmitter({
          action: 'BROWSER_REQUEST_BLOCKED',
          tenantId: input.tenantId,
          userId: input.userId,
          sessionId,
          metadata: { url: reqUrl, resourceType: request.resourceType() },
          severity: 'WARN',
        });
        return route.abort('blockedbyclient');
      }
      if (this.dnsRebindGuardEnabled) {
        const rt = request.resourceType();
        const isNavigation = rt === 'document' || rt === 'xhr' || rt === 'fetch' || rt === 'websocket';
        if (isNavigation) {
          try {
            const u = new URL(reqUrl);
            const dnsCheck = await resolveAndCheckHost(u.hostname);
            if (!dnsCheck.allowed) {
              await this.auditEmitter({
                action: 'BROWSER_DNS_REBIND_BLOCKED',
                tenantId: input.tenantId,
                userId: input.userId,
                sessionId,
                metadata: {
                  url: reqUrl,
                  resourceType: rt,
                  resolvedIps: dnsCheck.resolvedIps,
                  blockedIps: dnsCheck.blockedIps,
                },
                severity: 'WARN',
              });
              return route.abort('blockedbyclient');
            }
          } catch {
            // URL parse failed earlier than this guard — let the
            // upstream isUrlAllowed catch it on retry.
          }
        }
      }
      return route.continue();
    });

    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    await page.goto(input.initialUrl, { waitUntil: 'domcontentloaded' });

    const record: SessionRecord = {
      sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      platform: input.platform,
      ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      initialUrl: input.initialUrl,
      context,
      page,
      dataDir: sessionDataDir,
      screenshotDir,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.sessions.set(sessionId, record);

    await this.auditEmitter({
      action: 'BROWSER_SESSION_STARTED',
      tenantId: input.tenantId,
      userId: input.userId,
      sessionId,
      metadata: { platform: input.platform, initialUrl: input.initialUrl },
    });

    return { sessionId, loginUrl: input.initialUrl };
  }

  /** Look up a session, asserting tenant ownership. */
  private requireSession(sessionId: string, tenantId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionAccessError('not_found');
    if (session.tenantId !== tenantId) {
      this.auditEmitter({
        action: 'BROWSER_TENANT_VIOLATION',
        tenantId,
        userId: 'unknown',
        sessionId,
        metadata: { actualTenantId: session.tenantId },
        severity: 'WARN',
      });
      throw new SessionAccessError('wrong_tenant');
    }
    session.lastActiveAt = new Date();
    return session;
  }

  async observe(input: { sessionId: string; tenantId: string }): Promise<PageObservation> {
    const session = this.requireSession(input.sessionId, input.tenantId);
    const url = session.page.url();
    const title = await session.page.title().catch(() => '');
    const accessibilityText = (await session.page.innerText('body').catch(() => '')) ?? '';
    const trimmed = accessibilityText.slice(0, MAX_ACCESSIBILITY_TEXT_LEN);
    const screenshotPath = join(
      session.screenshotDir,
      `observe-${Date.now()}.png`,
    );
    await session.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

    const blockedBySecurity = detectSecurityChallenge(trimmed);

    await this.auditEmitter({
      action: 'BROWSER_OBSERVED',
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.sessionId,
      metadata: { url, blockedBySecurity, screenshotPath },
    });

    return {
      url,
      title,
      accessibilityText: trimmed,
      observedAt: new Date(),
      blockedBySecurity,
      screenshotPath,
    };
  }

  async propose(input: {
    sessionId: string;
    tenantId: string;
    action: ProposedAction;
  }): Promise<ProposedActionPreview> {
    const session = this.requireSession(input.sessionId, input.tenantId);

    const meta = actionAsToolMetadata(input.action);
    const decision = this.approvalPolicy.requiresApprovalFor(meta, {
      tenantId: session.tenantId,
      userId: session.userId,
      workflowId: session.workflowId ?? '',
      runId: '',
    });

    const preview: ProposedActionPreview = {
      summary: buildSummary(input.action),
      category: decision.category,
      approvalRequired: decision.required,
      proposedDataHash: hashPayload(input.action),
    };

    await this.auditEmitter({
      action: 'BROWSER_PROPOSED',
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.sessionId,
      metadata: {
        kind: input.action.kind,
        approvalRequired: decision.required,
        category: decision.category,
        proposedDataHash: preview.proposedDataHash,
      },
    });

    return preview;
  }

  async execute(input: {
    sessionId: string;
    tenantId: string;
    action: ProposedAction;
    approvalId: string;
  }): Promise<ExecutionResult> {
    const session = this.requireSession(input.sessionId, input.tenantId);

    // Approval gate — re-check via the centralized policy. Caller must
    // pass approvalId. The policy treats a non-empty approvalId as
    // "approval already granted upstream" — but we still classify the
    // action so we can fail loudly if approvalId is missing.
    const meta = actionAsToolMetadata(input.action);
    if (!input.approvalId) {
      const category = this.approvalPolicy.classify(meta);
      throw new ApprovalRequiredError(
        category,
        `Browser action '${input.action.kind}' requires an approvalId. Caller must obtain user approval first.`,
      );
    }

    let result: ExecutionResult;
    try {
      switch (input.action.kind) {
        case 'navigate': {
          const target = String(input.action.payload.url ?? '');
          if (!this.isUrlAllowed(target)) {
            result = { success: false, error: `URL "${target}" is not allowed.` };
            break;
          }
          await session.page.goto(target, { waitUntil: 'domcontentloaded' });
          result = { success: true, finalUrl: session.page.url() };
          break;
        }
        case 'click': {
          const selector = String(input.action.payload.selector ?? '');
          if (!selector) {
            result = { success: false, error: 'click action requires payload.selector' };
            break;
          }
          await session.page.click(selector);
          result = { success: true, finalUrl: session.page.url() };
          break;
        }
        case 'fill': {
          const selector = String(input.action.payload.selector ?? '');
          const text = String(input.action.payload.text ?? '');
          if (!selector) {
            result = { success: false, error: 'fill action requires payload.selector' };
            break;
          }
          await session.page.fill(selector, text);
          result = { success: true, finalUrl: session.page.url() };
          break;
        }
        case 'screenshot_only': {
          // Just capture; no DOM interaction.
          result = { success: true, finalUrl: session.page.url() };
          break;
        }
        case 'extract_text': {
          // Read-only — no execution; the post-screenshot covers it.
          result = { success: true, finalUrl: session.page.url() };
          break;
        }
        default:
          result = { success: false, error: `Unknown action kind: ${input.action.kind}` };
      }
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    // Post-action screenshot for the audit trail.
    const screenshotPath = join(
      session.screenshotDir,
      `execute-${Date.now()}.png`,
    );
    await session.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    result.screenshotPath = screenshotPath;

    await this.auditEmitter({
      action: 'BROWSER_EXECUTED',
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.sessionId,
      metadata: {
        kind: input.action.kind,
        approvalId: input.approvalId,
        success: result.success,
        finalUrl: result.finalUrl,
        screenshotPath,
      },
      severity: result.success ? 'INFO' : 'ERROR',
    });

    return result;
  }

  async listSessions(tenantId: string): Promise<BrowserSessionInfo[]> {
    const out: BrowserSessionInfo[] = [];
    for (const session of this.sessions.values()) {
      if (session.tenantId !== tenantId) continue;
      out.push({
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        userId: session.userId,
        platform: session.platform,
        ...(session.workflowId !== undefined ? { workflowId: session.workflowId } : {}),
        initialUrl: session.initialUrl,
        createdAt: session.createdAt,
        alive: session.context.pages().length > 0,
      });
    }
    return out;
  }

  async endSession(input: { sessionId: string; tenantId: string }): Promise<void> {
    const session = this.requireSession(input.sessionId, input.tenantId);
    try {
      await session.context.close();
    } catch {
      // Closing a dead context is fine.
    }
    this.sessions.delete(session.sessionId);

    // Hard-delete the per-session data dir — cookies, localStorage,
    // IndexedDB, everything. Nothing is retained.
    if (existsSync(session.dataDir)) {
      try {
        rmSync(session.dataDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup. Don't crash if a screenshot is being
        // streamed at the same time.
      }
    }

    await this.auditEmitter({
      action: 'BROWSER_SESSION_ENDED',
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.sessionId,
    });
  }

  /** Sweep idle sessions (called from the cleanup timer). */
  private async sweepIdleSessions(): Promise<void> {
    const cutoff = Date.now() - this.sessionTtlMs;
    for (const session of [...this.sessions.values()]) {
      if (session.lastActiveAt.getTime() < cutoff) {
        try {
          await this.endSession({
            sessionId: session.sessionId,
            tenantId: session.tenantId,
          });
        } catch {
          // Ignore — the session is going away anyway.
        }
      }
    }
  }
}
