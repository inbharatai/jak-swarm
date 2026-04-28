/**
 * JAK Swarm — Live human-style E2E QA audit.
 *
 * Drives the LIVE jakswarm.com site as a real operator would, capturing
 * screenshots, console errors, network failures, and structured findings
 * for every flow surfaced by the product. Writes everything under
 * `qa/playwright-artifacts/` and emits a JSON findings report
 * `qa/live-findings.json` consumed by the markdown reports.
 *
 * Goals (per the user's audit brief):
 *   Phase 1 — discovery of unauthenticated surface
 *   Phase 2 — authentication flow
 *   Phase 3 — dashboard + workspace pages
 *   Phase 4 — role / agent testing (CEO/CTO/CMO/Engineer/Legal/Marketing)
 *   Phase 5 — workflow orchestration
 *   Phase 6 — integrations + tools surface
 *   Phase 7 — builder flow
 *   Phase 8 — failure hunting (invalid inputs, route manipulation, etc.)
 *
 * Captures evidence for every claim. Distinguishes:
 *   - working
 *   - partially working
 *   - visible-but-inert
 *   - misleading marketing
 */

import { test, type Page, type BrowserContext, type ConsoleMessage } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

const SITE = process.env['QA_SITE'] ?? 'https://jakswarm.com';
const ARTIFACTS = 'C:/Users/reetu/Desktop/JAK/jak-swarm/qa/playwright-artifacts';
const FINDINGS_PATH = 'C:/Users/reetu/Desktop/JAK/jak-swarm/qa/live-findings.json';
const SELECTORS_PATH = 'C:/Users/reetu/Desktop/JAK/jak-swarm/qa/_selectors.json';
const EMAIL = process.env['E2E_AUTH_EMAIL'] ?? 'reetu004@gmail.com';
const PASSWORD = process.env['E2E_AUTH_PASSWORD'] ?? 'Adubaby.004';

type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
type Verdict = 'working' | 'partial' | 'inert' | 'misleading' | 'broken' | 'blocked';

interface Finding {
  phase: number;
  area: string;
  title: string;
  severity: Severity;
  verdict: Verdict;
  evidence: string;
  url?: string;
  screenshot?: string;
  consoleErrors?: string[];
  networkErrors?: string[];
  timestamp: string;
}

const findings: Finding[] = [];

function record(f: Omit<Finding, 'timestamp'>) {
  const final: Finding = { ...f, timestamp: new Date().toISOString() };
  findings.push(final);
  const tag = f.severity === 'Info' ? 'INFO' : f.severity.toUpperCase();
  // eslint-disable-next-line no-console
  console.log(`[${tag}/${f.verdict}] P${f.phase}/${f.area} — ${f.title}: ${f.evidence.slice(0, 200)}`);
}

const selectorInventory: Array<{ page: string; selector: string; purpose: string; stable: boolean }> = [];
function noteSelector(pageName: string, selector: string, purpose: string, stable = true) {
  selectorInventory.push({ page: pageName, selector, purpose, stable });
}

async function snap(page: Page, subfolder: string, name: string): Promise<string> {
  const safe = name.replace(/[^a-z0-9-_.]/gi, '-').toLowerCase();
  const full = path.join(ARTIFACTS, subfolder, safe.endsWith('.png') ? safe : `${safe}.png`);
  await page.screenshot({ path: full, fullPage: true }).catch(() => {});
  return full;
}

let consoleErrorBuffer: string[] = [];
let networkErrorBuffer: string[] = [];
function attachLoggers(page: Page) {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrorBuffer.push(`${msg.text().slice(0, 300)}`);
  });
  page.on('pageerror', (err) => {
    consoleErrorBuffer.push(`[pageerror] ${err.message.slice(0, 300)}`);
  });
  page.on('response', (r) => {
    const status = r.status();
    if (status >= 400 && status < 600) {
      networkErrorBuffer.push(`[${status}] ${r.url().slice(0, 200)}`);
    }
  });
}
function flushBuffers() {
  const ce = [...consoleErrorBuffer];
  const ne = [...networkErrorBuffer];
  consoleErrorBuffer = [];
  networkErrorBuffer = [];
  return { consoleErrors: ce, networkErrors: ne };
}

let ctx: BrowserContext;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.describe('JAK Swarm — Live human-style E2E QA audit', () => {
  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      baseURL: SITE,
    });
    page = await ctx.newPage();
    attachLoggers(page);
  });

  test.afterAll(async () => {
    await fs.mkdir(path.dirname(FINDINGS_PATH), { recursive: true });
    await fs.writeFile(FINDINGS_PATH, JSON.stringify({ runAt: new Date().toISOString(), site: SITE, findings }, null, 2));
    await fs.writeFile(SELECTORS_PATH, JSON.stringify({ runAt: new Date().toISOString(), inventory: selectorInventory }, null, 2));
    const bySev = findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    }, {});
    // eslint-disable-next-line no-console
    console.log(`\n=== ${findings.length} findings written to ${FINDINGS_PATH} ===`);
    // eslint-disable-next-line no-console
    console.log('By severity:', JSON.stringify(bySev));
    await ctx?.close();
  });

  // ─── PHASE 1 — Discover unauthenticated surface ──────────────────────────
  test('P1.1 landing page renders + has Sign In + Get Started CTAs', async () => {
    flushBuffers();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const screenshot = await snap(page, 'p1-landing', 'landing-fold');
    const text = await page.locator('body').innerText();
    const buf = flushBuffers();

    if (text.length < 400) {
      record({ phase: 1, area: 'Landing', title: 'Landing page nearly empty', severity: 'Critical', verdict: 'broken', evidence: text.slice(0, 300), screenshot, url: page.url(), ...buf });
      return;
    }
    // Look for the major CTAs
    const signIn = page.locator('a:has-text("Sign in"), a:has-text("Sign In"), a:has-text("Login")').first();
    const getStarted = page.locator('a:has-text("Get Started"), a:has-text("Start Free"), a:has-text("Try")').first();
    const signInCount = await signIn.count();
    const getStartedCount = await getStarted.count();
    noteSelector('landing', 'a:has-text("Sign in")', 'login entry', signInCount > 0);
    noteSelector('landing', 'a:has-text("Get Started")', 'signup entry', getStartedCount > 0);
    record({
      phase: 1, area: 'Landing',
      title: `Landing rendered ${text.length} chars; SignIn=${signInCount}, GetStarted=${getStartedCount}`,
      severity: 'Info', verdict: signInCount > 0 ? 'working' : 'partial',
      evidence: text.slice(0, 200), screenshot, url: page.url(), ...buf,
    });
  });

  test('P1.2 landing page sections — capability map / agents / pricing / execution flow', async () => {
    flushBuffers();
    // Already on landing from P1.1 — re-navigate to ensure fresh
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const sectionTexts = await page.locator('section, [data-section], main > div').allInnerTexts().catch(() => []);
    const compactedSections = sectionTexts.map(t => t.slice(0, 80).replace(/\s+/g, ' '));
    const claims: Record<string, RegExp> = {
      capabilityMap: /tools|integration|capability/i,
      agents: /agent|specialist|worker/i,
      pricing: /pricing|plan|tier|free|pro/i,
      executionFlow: /execute|plan|verify|orchestrat/i,
      builder: /build|generator|vibe|app/i,
    };
    const present: Record<string, boolean> = {};
    const fullPageText = await page.locator('body').innerText();
    for (const [name, rx] of Object.entries(claims)) {
      present[name] = rx.test(fullPageText);
    }
    const screenshot = await snap(page, 'p1-landing', 'landing-full-scrolled');
    const buf = flushBuffers();

    record({
      phase: 1, area: 'Landing/Sections',
      title: `Detected sections: ${Object.entries(present).filter(([, v]) => v).map(([k]) => k).join(', ') || 'NONE'}`,
      severity: Object.values(present).every(v => v) ? 'Info' : 'Low',
      verdict: 'working',
      evidence: `present=${JSON.stringify(present)} sectionsFound=${compactedSections.length}`,
      screenshot, url: page.url(), ...buf,
    });
  });

  test('P1.3 navigation inventory — every clickable major entry point', async () => {
    flushBuffers();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const links = await page.locator('a[href]').evaluateAll((els) =>
      (els as HTMLAnchorElement[])
        .map(a => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 60) }))
        .filter(l => l.text.length > 0 && !l.href.startsWith('javascript:')),
    );
    const internalLinks = links.filter(l => l.href.includes('jakswarm.com') || l.href.startsWith('/'));
    const externalLinks = links.filter(l => !internalLinks.includes(l));
    const buf = flushBuffers();

    record({
      phase: 1, area: 'Navigation',
      title: `Navigation inventory: ${internalLinks.length} internal + ${externalLinks.length} external links`,
      severity: 'Info', verdict: 'working',
      evidence: internalLinks.slice(0, 15).map(l => `${l.text}→${l.href.replace(SITE, '')}`).join('; '),
      url: page.url(), ...buf,
    });
  });

  // ─── PHASE 2 — Authentication ────────────────────────────────────────────
  test('P2.1 invalid login is rejected with visible error', async () => {
    flushBuffers();
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await snap(page, 'p2-auth', 'login-form-empty');
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const pwInput = page.locator('input[type="password"]').first();
    const submitBtn = page.locator('button[type="submit"]').first();
    if (!(await emailInput.count())) {
      record({ phase: 2, area: 'Auth', title: 'No email input on /login', severity: 'Critical', verdict: 'broken', evidence: 'cannot proceed', url: page.url(), ...flushBuffers() });
      return;
    }
    await emailInput.fill('definitely-not-a-user@example.com');
    await pwInput.fill('wrong-password');
    await submitBtn.click();
    await page.waitForTimeout(3000);
    const screenshot = await snap(page, 'p2-auth', 'login-invalid-attempt');
    const text = await page.locator('body').innerText();
    const buf = flushBuffers();
    const sawError = /invalid|incorrect|wrong|denied|error|failed/i.test(text);
    record({
      phase: 2, area: 'Auth',
      title: sawError ? 'Invalid login rejected with visible error' : 'Invalid login NOT rejected with a clear error',
      severity: sawError ? 'Info' : 'High',
      verdict: sawError ? 'working' : 'broken',
      evidence: text.match(/.{0,80}(invalid|incorrect|wrong|denied|error|failed).{0,80}/i)?.[0] ?? text.slice(0, 200),
      screenshot, url: page.url(), ...buf,
    });
  });

  test('P2.2 valid login → redirect off /login + session persists across refresh', async () => {
    flushBuffers();
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    let redirected = false;
    try {
      await page.waitForURL((u) => !/\/(login|register|forgot-password)/.test(u.pathname), { timeout: 20_000 });
      redirected = true;
    } catch { /* will record below */ }
    await page.waitForTimeout(2500);
    const screenshot = await snap(page, 'p2-auth', 'login-after-valid');
    const buf = flushBuffers();
    if (!redirected) {
      record({ phase: 2, area: 'Auth', title: 'Valid login did NOT redirect off /login', severity: 'Critical', verdict: 'broken', evidence: `Still on ${page.url()}`, screenshot, url: page.url(), ...buf });
      return;
    }
    const landedUrl = page.url();
    // Refresh — session should persist
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const refreshUrl = page.url();
    const stillAuthed = !/\/(login|register)/.test(refreshUrl);
    record({
      phase: 2, area: 'Auth',
      title: `Valid login → ${landedUrl.replace(SITE, '')}; refresh ${stillAuthed ? 'kept session' : 'lost session'}`,
      severity: stillAuthed ? 'Info' : 'Critical',
      verdict: stillAuthed ? 'working' : 'broken',
      evidence: `landed=${landedUrl} refresh=${refreshUrl}`,
      screenshot, url: refreshUrl, ...buf,
    });
  });

  test('P2.3 protected route redirects when unauthenticated', async () => {
    flushBuffers();
    // Open a fresh context (no cookies) and try a protected route
    const tmpCtx = await ctx.browser()!.newContext();
    const tmpPage = await tmpCtx.newPage();
    await tmpPage.goto(`${SITE}/swarm`, { waitUntil: 'domcontentloaded' });
    await tmpPage.waitForTimeout(2500);
    const finalUrl = tmpPage.url();
    const text = await tmpPage.locator('body').innerText();
    const screenshot = await snap(tmpPage, 'p2-auth', 'protected-route-no-auth');
    await tmpCtx.close();
    const wasRedirected = /login|sign/i.test(finalUrl) || /sign in|log in|please log|need to be signed/i.test(text);
    record({
      phase: 2, area: 'Auth',
      title: wasRedirected ? 'Protected /swarm redirects unauthenticated users' : 'Protected /swarm does NOT block unauthenticated access',
      severity: wasRedirected ? 'Info' : 'Critical',
      verdict: wasRedirected ? 'working' : 'broken',
      evidence: `url=${finalUrl}, body~${text.slice(0, 200).replace(/\n+/g, ' | ')}`,
      screenshot, url: finalUrl,
    });
  });

  // ─── PHASE 3 — Dashboard / workspace audit ───────────────────────────────
  const NAV_TARGETS: Array<{ href: string; label: string; markers: RegExp[]; minMain: number }> = [
    { href: '/workspace', label: 'Workspace', markers: [/CEO|CMO|CTO|Coding|Research|Design|Auto|verify important|JAK Swarm may/i], minMain: 50 },
    { href: '/swarm', label: 'Runs/Inspector', markers: [/workflow|inspector|run|status|history|no workflows/i], minMain: 80 },
    { href: '/schedules', label: 'Schedules', markers: [/schedule|cron|recurring|no schedules/i], minMain: 80 },
    { href: '/builder', label: 'Builder', markers: [/build|project|generate|prompt|create|new project/i], minMain: 80 },
    { href: '/analytics', label: 'Analytics', markers: [/workflow|cost|usage|metric|period/i], minMain: 100 },
    { href: '/integrations', label: 'Integrations', markers: [/slack|github|gmail|notion|connect/i], minMain: 150 },
    { href: '/files', label: 'Files', markers: [/file|upload|no files|document/i], minMain: 80 },
    { href: '/knowledge', label: 'Knowledge/Memory', markers: [/knowledge|memory|fact|preference|add memory/i], minMain: 80 },
    { href: '/skills', label: 'Skills', markers: [/skill|capability|tool|agent/i], minMain: 80 },
    { href: '/settings', label: 'Settings', markers: [/backend|provider|model|account|profile|api key|billing/i], minMain: 100 },
  ];

  for (const t of NAV_TARGETS) {
    test(`P3 nav — ${t.label} (${t.href})`, async () => {
      flushBuffers();
      await page.goto(t.href, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4500); // SWR settle
      const screenshot = await snap(page, 'p3-nav', `${t.label.toLowerCase().replace(/[\/\s]+/g, '-')}-landing`);
      const fullText = await page.locator('body').innerText();
      const mainText = await page.locator('main').first().innerText().catch(() => fullText);
      const buf = flushBuffers();

      if (/access restricted|404|not found/i.test(mainText.slice(0, 300))) {
        record({ phase: 3, area: 'Nav', title: `${t.label} blocked or 404`, severity: 'Critical', verdict: 'broken', evidence: mainText.slice(0, 300), screenshot, url: page.url(), ...buf });
        return;
      }
      if (mainText.trim().length < t.minMain) {
        record({ phase: 3, area: 'Nav', title: `${t.label} main area too small (${mainText.length}<${t.minMain})`, severity: 'High', verdict: 'partial', evidence: mainText.slice(0, 300), screenshot, url: page.url(), ...buf });
        return;
      }
      const matched = t.markers.filter(rx => rx.test(mainText));
      if (matched.length === 0) {
        record({ phase: 3, area: 'Nav', title: `${t.label} renders but missing expected markers`, severity: 'Medium', verdict: 'partial', evidence: `expected ${t.markers[0]} got: ${mainText.slice(0, 250).replace(/\n+/g, ' | ')}`, screenshot, url: page.url(), ...buf });
        return;
      }
      // Scroll test
      const scroll = await page.evaluate(() => ({ h: document.scrollingElement?.scrollHeight ?? 0, v: window.innerHeight }));
      let scrollOk = true;
      if (scroll.h > scroll.v + 50) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(400);
        const scrolled = await page.evaluate(() => window.scrollY);
        if (scrolled < 50) scrollOk = false;
      }
      if (!scrollOk) {
        record({ phase: 3, area: 'Nav', title: `${t.label} content overflows but page does not scroll`, severity: 'High', verdict: 'partial', evidence: `scrollHeight=${scroll.h} viewport=${scroll.v} scrolled=0`, screenshot, url: page.url(), ...buf });
        return;
      }
      record({
        phase: 3, area: 'Nav',
        title: `${t.label} renders (${mainText.length} chars) + scrolls; markers matched [${matched.map(String).join(',')}]`,
        severity: 'Info', verdict: 'working',
        evidence: mainText.slice(0, 200).replace(/\n+/g, ' | '),
        screenshot, url: page.url(), ...buf,
      });
    });
  }

  // ─── PHASE 4 — Role / agent presence ─────────────────────────────────────
  test('P4.1 role picker shows all marketed roles after login', async () => {
    flushBuffers();
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const screenshot = await snap(page, 'p4-roles', 'role-picker');
    const expected = ['CEO', 'CMO', 'CTO', 'Coding', 'Research', 'Design', 'Auto', 'Engineer', 'Legal', 'Marketing'];
    const present: string[] = [];
    const missing: string[] = [];
    for (const role of expected) {
      const found = (await page.locator(`button:has-text("${role}"), [data-role="${role.toLowerCase()}"]`).count()) > 0;
      (found ? present : missing).push(role);
    }
    const buf = flushBuffers();
    record({
      phase: 4, area: 'Roles',
      title: `Role picker: present [${present.join(',')}] missing [${missing.join(',')}]`,
      severity: missing.length > 5 ? 'High' : 'Info',
      verdict: present.length >= 5 ? (missing.length > 0 ? 'partial' : 'working') : 'broken',
      evidence: `Landing claims CEO/CTO/CMO/Engineer/Legal/Marketing — actual product picker shows: ${present.join(', ')}`,
      screenshot, url: page.url(), ...buf,
    });
  });

  // ─── PHASE 5 — Workflow orchestration (single deterministic chat run) ────
  test('P5.1 plain-English chat → workflow executes → final answer renders', async () => {
    flushBuffers();
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const newChat = page.locator('button:has-text("New chat")').first();
    if ((await newChat.count()) > 0) { await newChat.click(); await page.waitForTimeout(800); }
    const textarea = page.locator('textarea').first();
    if (!(await textarea.count())) {
      record({ phase: 5, area: 'Chat', title: 'No textarea on /workspace', severity: 'Critical', verdict: 'broken', evidence: 'cannot send chat', url: page.url(), ...flushBuffers() });
      return;
    }
    const initialBubbles = await page.locator('[data-testid="assistant-message"]').count();
    await textarea.click();
    await textarea.fill('hi');
    const sendBtn = page.locator('button[aria-label="Send message"]').first();
    if (!(await sendBtn.count())) {
      record({ phase: 5, area: 'Chat', title: 'No Send button found', severity: 'Critical', verdict: 'broken', evidence: 'cannot dispatch', url: page.url(), ...flushBuffers() });
      return;
    }
    await sendBtn.click();
    await snap(page, 'p5-chat', 'chat-after-send');
    // Wait up to 60s for a substantive bubble (ignore status/⏳/✓/Workflow lines)
    const deadline = Date.now() + 60_000;
    let finalBubble = '';
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      const bubbles = await page.locator('[data-testid="assistant-message"] p.whitespace-pre-wrap').allInnerTexts().catch(() => []);
      if (bubbles.length > initialBubbles) {
        const newBubbles = bubbles.slice(initialBubbles);
        const subst = newBubbles.filter(b => !/^(⏳|✓|✗|Workflow (started|paused|completed|failed)|Live stream)/.test(b.trim()) && b.trim().length > 0);
        const last = subst[subst.length - 1] ?? '';
        const textareaDisabled = await textarea.isDisabled().catch(() => false);
        if (last.length > 0 && !textareaDisabled) { finalBubble = last; break; }
      }
    }
    const screenshot = await snap(page, 'p5-chat', 'chat-final');
    const buf = flushBuffers();
    if (!finalBubble) {
      record({ phase: 5, area: 'Chat', title: '"hi" produced no user-visible final answer in 60s', severity: 'Critical', verdict: 'broken', evidence: 'no substantive assistant bubble appeared', screenshot, url: page.url(), ...buf });
      return;
    }
    record({
      phase: 5, area: 'Chat',
      title: `"hi" → user-visible answer rendered (${finalBubble.length} chars)`,
      severity: 'Info', verdict: 'working',
      evidence: finalBubble.slice(0, 250),
      screenshot, url: page.url(), ...buf,
    });
  });

  test('P5.2 /swarm Inspector lists workflows + clicking a row expands trace', async () => {
    flushBuffers();
    await page.goto('/swarm', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const screenshot = await snap(page, 'p5-runs', 'inspector-list');
    const mainText = await page.locator('main').first().innerText();
    if (/no workflows|empty/i.test(mainText) && !/workflow.*\d/i.test(mainText)) {
      record({ phase: 5, area: 'Runs', title: '/swarm shows empty state', severity: 'Info', verdict: 'working', evidence: mainText.slice(0, 200), screenshot, url: page.url(), ...flushBuffers() });
      return;
    }
    const rows = page.locator('main button').filter({ hasText: /Failed|Completed|Pending|Running|Paused/i });
    const rowCount = await rows.count();
    if (rowCount === 0) {
      record({ phase: 5, area: 'Runs', title: 'No clickable workflow rows on /swarm', severity: 'Medium', verdict: 'partial', evidence: mainText.slice(0, 300), screenshot, url: page.url(), ...flushBuffers() });
      return;
    }
    await rows.first().click();
    await page.waitForTimeout(3000);
    const detailScreen = await snap(page, 'p5-runs', 'inspector-row-expanded');
    const detail = await page.locator('main').first().innerText();
    const buf = flushBuffers();
    const hasDetail = /timeline|trace|agent|completed|planner|commander/i.test(detail);
    record({
      phase: 5, area: 'Runs',
      title: hasDetail ? `Inspector row expand shows trace details (${rowCount} rows total)` : 'Inspector row expand showed no agent detail',
      severity: hasDetail ? 'Info' : 'High',
      verdict: hasDetail ? 'working' : 'partial',
      evidence: detail.slice(0, 250),
      screenshot: detailScreen, url: page.url(), ...buf,
    });
  });

  // ─── PHASE 6 — Integrations / tools surface ──────────────────────────────
  test('P6.1 /integrations classifies visible integrations', async () => {
    flushBuffers();
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const screenshot = await snap(page, 'p6-integrations', 'integrations');
    const text = (await page.locator('main').first().innerText()).toLowerCase();
    const expected = ['slack', 'github', 'gmail', 'notion', 'linkedin', 'google', 'calendar', 'drive', 'salesforce', 'hubspot'];
    const present = expected.filter(p => text.includes(p));
    const missing = expected.filter(p => !text.includes(p));
    const buf = flushBuffers();
    record({
      phase: 6, area: 'Integrations',
      title: `Visible integrations: ${present.length}/${expected.length} present`,
      severity: present.length < 3 ? 'High' : 'Info',
      verdict: present.length >= 5 ? 'working' : present.length >= 3 ? 'partial' : 'broken',
      evidence: `present: [${present.join(',')}], missing: [${missing.join(',')}]`,
      screenshot, url: page.url(), ...buf,
    });
  });

  test('P6.2 Skills page lists tools/capabilities by category', async () => {
    flushBuffers();
    await page.goto('/skills', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const screenshot = await snap(page, 'p6-skills', 'skills');
    const text = await page.locator('main').first().innerText();
    const buf = flushBuffers();
    const hasCategories = /category|tool|capability|email|browser|document|search|spreadsheet|calendar|crm/i.test(text);
    record({
      phase: 6, area: 'Tools',
      title: hasCategories ? `Skills page lists capabilities (${text.length} chars)` : 'Skills page does not list capabilities',
      severity: hasCategories ? 'Info' : 'Medium',
      verdict: hasCategories ? 'working' : 'partial',
      evidence: text.slice(0, 250),
      screenshot, url: page.url(), ...buf,
    });
  });

  // ─── PHASE 7 — Builder flow ──────────────────────────────────────────────
  test('P7.1 /builder shows project-list + New Project entry', async () => {
    flushBuffers();
    await page.goto('/builder', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const screenshot = await snap(page, 'p7-builder', 'builder-list');
    const newProj = page.locator('button:has-text("New Project"), button:has-text("Create Project")').first();
    const hasButton = (await newProj.count()) > 0;
    const text = await page.locator('main').first().innerText();
    const buf = flushBuffers();
    record({
      phase: 7, area: 'Builder',
      title: hasButton ? 'Builder shows project list + New Project CTA' : 'Builder has no New Project button',
      severity: hasButton ? 'Info' : 'High',
      verdict: hasButton ? 'working' : 'partial',
      evidence: text.slice(0, 250),
      screenshot, url: page.url(), ...buf,
    });
  });

  // ─── PHASE 8 — Failure hunting ───────────────────────────────────────────
  test('P8.1 empty chat submit is rejected gracefully', async () => {
    flushBuffers();
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const sendBtn = page.locator('button[aria-label="Send message"]').first();
    if (!(await sendBtn.count())) {
      record({ phase: 8, area: 'Failure', title: 'No Send button to test empty submit', severity: 'Medium', verdict: 'partial', evidence: 'cannot test', url: page.url(), ...flushBuffers() });
      return;
    }
    const disabledBefore = await sendBtn.isDisabled().catch(() => false);
    await sendBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1500);
    const disabledAfter = await sendBtn.isDisabled().catch(() => false);
    const screenshot = await snap(page, 'p8-failures', 'empty-submit');
    const buf = flushBuffers();
    record({
      phase: 8, area: 'Failure',
      title: `Empty submit handling: disabled=${disabledBefore}/${disabledAfter}`,
      severity: 'Info', verdict: disabledBefore ? 'working' : 'partial',
      evidence: `Send button ${disabledBefore ? 'is disabled when empty (correct)' : 'allows empty click'}`,
      screenshot, url: page.url(), ...buf,
    });
  });

  test('P8.2 unknown route /this-does-not-exist 404s cleanly', async () => {
    flushBuffers();
    await page.goto('/this-does-not-exist-xyz', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const screenshot = await snap(page, 'p8-failures', 'unknown-route');
    const text = await page.locator('body').innerText();
    const buf = flushBuffers();
    const looks404 = /404|not found|page not found|does not exist/i.test(text);
    record({
      phase: 8, area: 'Failure',
      title: looks404 ? 'Unknown route renders 404' : 'Unknown route does not render a 404 — silently empty or redirected',
      severity: looks404 ? 'Info' : 'Medium',
      verdict: looks404 ? 'working' : 'partial',
      evidence: text.slice(0, 250).replace(/\n+/g, ' | '),
      screenshot, url: page.url(), ...buf,
    });
  });

  test('P8.3 oversized chat input does not crash UI', async () => {
    flushBuffers();
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const textarea = page.locator('textarea').first();
    if (!(await textarea.count())) {
      record({ phase: 8, area: 'Failure', title: 'No textarea for oversize test', severity: 'Medium', verdict: 'partial', evidence: '', url: page.url(), ...flushBuffers() });
      return;
    }
    await textarea.click();
    const giant = 'A'.repeat(20000);
    await textarea.fill(giant).catch(() => {});
    await page.waitForTimeout(1500);
    const screenshot = await snap(page, 'p8-failures', 'oversize-input');
    const buf = flushBuffers();
    const ueAlive = (await textarea.count()) > 0;
    record({
      phase: 8, area: 'Failure',
      title: ueAlive ? '20k-char paste did not crash the UI' : 'UI broke on oversize input',
      severity: ueAlive ? 'Info' : 'High',
      verdict: ueAlive ? 'working' : 'broken',
      evidence: `console errors during fill: ${buf.consoleErrors.length}`,
      screenshot, url: page.url(), ...buf,
    });
  });

  test('P8.4 Sign out clears session', async () => {
    flushBuffers();
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const signOut = page.locator('button[aria-label="Sign out"]').first();
    if (!(await signOut.count())) {
      record({ phase: 8, area: 'Failure', title: 'No Sign out button found', severity: 'High', verdict: 'partial', evidence: 'no logout discoverable', url: page.url(), ...flushBuffers() });
      return;
    }
    await signOut.click();
    await page.waitForTimeout(3500);
    const afterUrl = page.url();
    const screenshot = await snap(page, 'p8-failures', 'after-signout');
    const buf = flushBuffers();
    const onLogin = /login|sign|root/i.test(afterUrl) || afterUrl.endsWith('/');
    record({
      phase: 8, area: 'Failure',
      title: onLogin ? `Sign out → ${afterUrl.replace(SITE, '')}` : `Sign out did NOT navigate away (${afterUrl})`,
      severity: onLogin ? 'Info' : 'High',
      verdict: onLogin ? 'working' : 'partial',
      evidence: `landed on ${afterUrl}`,
      screenshot, url: afterUrl, ...buf,
    });
  });
});
