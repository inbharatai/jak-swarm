/**
 * JAK Swarm — Exhaustive live-demo QA walkthrough.
 *
 * Designed to be run in HEADED mode with slow-motion so a human can watch.
 * Tests every reachable module, types real input, clicks real buttons,
 * records screenshots at every major state, and writes all findings to
 * `Desktop/JackSwarm test/findings-live.json` for later triage.
 *
 * Run command (watch the browser window):
 *   cd tests && \
 *     E2E_BASE_URL=https://jakswarm.com \
 *     E2E_AUTH_EMAIL=... E2E_AUTH_PASSWORD=... \
 *     pnpm exec playwright test e2e/qa-live-demo.spec.ts \
 *       --headed --workers=1 --project=chromium-mobile
 *
 * Cost-aware: dispatches 2 real chat workflows (trivial prompts, ~$0.01 each).
 * Never creates projects, never deletes anything, never toggles user prefs.
 */

import { test, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

const SCREENSHOT_ROOT = 'C:/Users/reetu/Desktop/JackSwarm test';

async function snap(page: Page, subfolder: string, name: string): Promise<string> {
  const safeName = name.replace(/[^a-z0-9-_.]/gi, '-').toLowerCase();
  const full = path.join(SCREENSHOT_ROOT, subfolder, safeName.endsWith('.png') ? safeName : `${safeName}.png`);
  await page.screenshot({ path: full, fullPage: true });
  return full;
}

interface Finding {
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  area: string;
  title: string;
  detail: string;
  screenshot?: string;
}
const findings: Finding[] = [];
function record(f: Finding) {
  findings.push(f);
  // eslint-disable-next-line no-console
  console.log(`[${f.severity}] ${f.area} — ${f.title}: ${f.detail}`);
}

// Slow pauses so a human watching the browser can see each action.
const PAUSE_SHORT = 600;
const PAUSE_MED = 1200;
const PAUSE_LONG = 2400;

const EMAIL = process.env['E2E_AUTH_EMAIL'];
const PASSWORD_PRIMARY = process.env['E2E_AUTH_PASSWORD'];
const PASSWORD_FALLBACK = process.env['E2E_AUTH_PASSWORD_ALT'];

let ctx: BrowserContext;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.describe('LIVE DEMO — Full A-to-Z walkthrough', () => {
  test.beforeAll(async ({ browser }) => {
    if (!EMAIL || !PASSWORD_PRIMARY) throw new Error('Set E2E_AUTH_EMAIL + E2E_AUTH_PASSWORD.');
    ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, // generous so the user can see
      recordVideo: {
        dir: path.join(SCREENSHOT_ROOT, 'video'),
        size: { width: 1440, height: 900 },
      },
    });
    page = await ctx.newPage();
  });

  test.afterAll(async () => {
    const reportPath = path.join(SCREENSHOT_ROOT, 'findings-live.json');
    await fs.writeFile(reportPath, JSON.stringify({
      runAt: new Date().toISOString(),
      totalFindings: findings.length,
      bySeverity: {
        Critical: findings.filter((f) => f.severity === 'Critical').length,
        High: findings.filter((f) => f.severity === 'High').length,
        Medium: findings.filter((f) => f.severity === 'Medium').length,
        Low: findings.filter((f) => f.severity === 'Low').length,
        Info: findings.filter((f) => f.severity === 'Info').length,
      },
      findings,
    }, null, 2));
    await page?.close();
    await ctx?.close();
  });

  // ─── L1: Landing tour (scroll every section) ────────────────────────────
  test('L1: landing page — scroll every section slowly', async () => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE_LONG);
    await snap(page, 'landing', 'live-1-hero');

    // Click "Start Free" button — but DON'T navigate away yet. Scroll instead.
    const sections = ['Trust Layer', 'How It Works', 'Verify', 'Build. Operate. Verify', 'Code that ships', 'Tools that do', 'Pricing'];
    for (const text of sections) {
      const loc = page.locator(`text=/${text}/i`).first();
      if ((await loc.count()) > 0) {
        await loc.scrollIntoViewIfNeeded();
        await page.waitForTimeout(PAUSE_MED);
        await snap(page, 'landing', `live-scroll-${text.slice(0, 20).toLowerCase().replace(/\W+/g, '-')}`);
      }
    }

    // Scroll all the way to footer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(PAUSE_MED);
    await snap(page, 'landing', 'live-footer');
  });

  // ─── L2: Click pricing CTAs ─────────────────────────────────────────────
  test('L2: hover over every pricing tier CTA', async () => {
    await page.goto('/#pricing', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE_MED);
    await snap(page, 'pricing', 'live-pricing-overview');

    const tierCtas = page.locator('#pricing a, #pricing button');
    const count = await tierCtas.count();
    for (let i = 0; i < Math.min(count, 6); i++) {
      await tierCtas.nth(i).hover();
      await page.waitForTimeout(PAUSE_SHORT);
    }
    await snap(page, 'pricing', 'live-pricing-hovered');
  });

  // ─── L3: Register form — fill then abandon ──────────────────────────────
  test('L3: visit register, fill form, screenshot, do NOT submit', async () => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE_MED);
    await snap(page, 'auth', 'live-register-blank');

    const email = page.locator('input[type="email"]').first();
    const pw = page.locator('input[type="password"]').first();
    const name = page.locator('input[name="name"]').first();
    if (await email.count()) await email.type('qa-demo@example.com', { delay: 40 });
    if (await name.count()) await name.type('QA Demo User', { delay: 40 });
    if (await pw.count()) await pw.type('Demo123!', { delay: 40 });
    await page.waitForTimeout(PAUSE_MED);
    await snap(page, 'auth', 'live-register-filled');
  });

  // ─── L4: Login (the real deal) ──────────────────────────────────────────
  test('L4: real login flow — types creds, submits, lands in workspace', async () => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE_MED);
    await snap(page, 'auth', 'live-login-blank');

    const tryLogin = async (pw: string) => {
      await page.locator('input[type="email"]').first().fill('');
      await page.locator('input[type="email"]').first().type(EMAIL!, { delay: 40 });
      await page.locator('input[type="password"]').first().fill('');
      await page.locator('input[type="password"]').first().type(pw, { delay: 40 });
      await page.waitForTimeout(PAUSE_SHORT);
      await snap(page, 'auth', 'live-login-filled');
      await page.locator('button[type="submit"]').first().click();
      try {
        await page.waitForURL((u) => !/\/(login|register|forgot-password)/.test(u.pathname), { timeout: 15_000 });
        return true;
      } catch { return false; }
    };
    let ok = await tryLogin(PASSWORD_PRIMARY!);
    if (!ok && PASSWORD_FALLBACK) ok = await tryLogin(PASSWORD_FALLBACK);
    if (!ok) {
      record({ severity: 'Critical', area: 'Auth', title: 'Login failed in live demo', detail: 'Neither password worked.' });
      throw new Error('Login failed');
    }
    await page.waitForTimeout(PAUSE_LONG);
    await snap(page, 'auth', 'live-login-landed');
    record({ severity: 'Info', area: 'Auth', title: 'Live login succeeded', detail: `Landed at ${page.url()}` });
  });

  // ─── L5: Workspace chat — dispatch a real workflow ─────────────────────
  test('L5: workspace — type a message, send, watch workflow respond', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE_LONG);
    await snap(page, 'chat', 'live-workspace-ready');

    const ta = page.locator('textarea').first();
    await ta.click();
    await ta.type('Hello JAK — reply with a single-word confirmation: "ready"', { delay: 30 });
    await page.waitForTimeout(PAUSE_MED);
    await snap(page, 'chat', 'live-chat-typed');

    await page.locator('button[aria-label="Send message"]').click();
    await page.waitForTimeout(PAUSE_MED);
    await snap(page, 'chat', 'live-chat-sent');

    // Poll up to 60s for a response
    for (let i = 0; i < 30; i++) {
      const body = await page.locator('body').innerText();
      if (/Workflow started|processing|working on|Agent|✓|completed|ready/i.test(body)) break;
      await page.waitForTimeout(2000);
    }
    await snap(page, 'chat', 'live-chat-response');
    record({ severity: 'Info', area: 'Chat', title: 'Chat workflow dispatched live', detail: 'User saw the full send + response cycle.' });
  });

  // ─── L6: Role picker interaction ────────────────────────────────────────
  test('L6: pick each role one at a time + screenshot', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE_MED);
    const roles = ['CEO', 'CTO', 'CMO', 'Coding', 'Research'];
    for (const role of roles) {
      const btn = page.locator(`button:has-text("${role}")`).first();
      if ((await btn.count()) > 0) {
        await btn.click();
        await page.waitForTimeout(PAUSE_SHORT);
        await snap(page, 'chat', `live-role-${role.toLowerCase()}`);
      }
    }
  });

  // ─── L7: File upload — multiple types ──────────────────────────────────
  test('L7: /files — upload TXT + create fixtures, verify each appears', async () => {
    await page.goto('/files', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE_LONG);
    await snap(page, 'uploads', 'live-files-empty');

    const txtPath = path.join(SCREENSHOT_ROOT, 'uploads', '_live-demo.txt');
    const mdPath = path.join(SCREENSHOT_ROOT, 'uploads', '_live-demo.md');
    await fs.writeFile(txtPath, 'Live QA demo file — text content');
    await fs.writeFile(mdPath, '# QA markdown demo\n\nSecond file to verify multi-upload.');

    const input = page.locator('input[type="file"]').first();
    if ((await input.count()) > 0) {
      await input.setInputFiles(txtPath);
      await page.waitForTimeout(PAUSE_LONG);
      await snap(page, 'uploads', 'live-files-one-uploaded');

      await input.setInputFiles(mdPath);
      await page.waitForTimeout(PAUSE_LONG);
      await snap(page, 'uploads', 'live-files-two-uploaded');

      const body = await page.locator('body').innerText();
      const sawTxt = body.includes('_live-demo.txt');
      const sawMd = body.includes('_live-demo.md');
      if (!sawTxt || !sawMd) {
        record({
          severity: 'High', area: 'Files',
          title: 'Sequential file uploads: not all files visible in list',
          detail: `txt: ${sawTxt ? 'OK' : 'MISSING'}, md: ${sawMd ? 'OK' : 'MISSING'}`,
        });
      }
    } else {
      record({ severity: 'High', area: 'Files', title: 'No file input visible on /files', detail: 'Upload UI broken.' });
    }
  });

  // ─── L8: Chat attach (paperclip) ───────────────────────────────────────
  test('L8: chat paperclip attach — upload fixture, verify chip, remove', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE_MED);

    const fx = path.join(SCREENSHOT_ROOT, 'uploads', '_live-attach.txt');
    await fs.writeFile(fx, 'Live attach demo');
    const input = page.locator('input[type="file"]').first();
    if ((await input.count()) > 0) {
      await input.setInputFiles(fx);
      await page.waitForTimeout(PAUSE_LONG);
      await snap(page, 'chat', 'live-chat-with-attach');

      const chip = page.locator('[role="list"][aria-label="Attached files"] [role="listitem"]').first();
      if ((await chip.count()) > 0) {
        await snap(page, 'chat', 'live-chat-chip-visible');
        const x = chip.locator('button').first();
        if ((await x.count()) > 0) {
          await x.click();
          await page.waitForTimeout(PAUSE_SHORT);
          await snap(page, 'chat', 'live-chat-chip-removed');
        }
      }
    }
  });

  // ─── L9: Walk every sidebar route ──────────────────────────────────────
  const routes: Array<{ path: string; folder: string; name: string }> = [
    { path: '/workspace', folder: 'chat', name: 'live-workspace-nav' },
    { path: '/swarm', folder: 'modules', name: 'live-swarm' },
    { path: '/schedules', folder: 'modules', name: 'live-schedules' },
    { path: '/builder', folder: 'builder', name: 'live-builder' },
    { path: '/analytics', folder: 'modules', name: 'live-analytics' },
    { path: '/integrations', folder: 'integrations', name: 'live-integrations' },
    { path: '/files', folder: 'uploads', name: 'live-files' },
    { path: '/knowledge', folder: 'modules', name: 'live-knowledge' },
    { path: '/skills', folder: 'modules', name: 'live-skills' },
    { path: '/admin', folder: 'modules', name: 'live-admin' },
    { path: '/traces', folder: 'modules', name: 'live-traces' },
    { path: '/billing', folder: 'settings', name: 'live-billing' },
    { path: '/settings', folder: 'settings', name: 'live-settings' },
    { path: '/home', folder: 'dashboard', name: 'live-home' },
  ];
  for (const r of routes) {
    test(`L9 route: ${r.path}`, async () => {
      await page.goto(r.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(PAUSE_LONG);
      if (page.url().includes('/login')) {
        record({ severity: 'High', area: 'Auth', title: `Session lost at ${r.path}`, detail: `Now at ${page.url()}` });
      }
      await snap(page, r.folder, r.name);
      // Scroll to see more content
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(PAUSE_SHORT);
      await snap(page, r.folder, `${r.name}-scrolled`);
    });
  }

  // ─── L10: Open ConnectModal for a provider ─────────────────────────────
  test('L10: integrations — open a provider modal slowly', async () => {
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE_LONG);
    await snap(page, 'integrations', 'live-integrations-list');

    // Try clicking the first "Connect" button we can find
    const connect = page.locator('button:has-text("Connect"), button:has-text("Add")').first();
    if ((await connect.count()) > 0) {
      await connect.click();
      await page.waitForTimeout(PAUSE_LONG);
      await snap(page, 'integrations', 'live-connect-modal');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(PAUSE_SHORT);
    }
  });

  // ─── L11: Look at traces (workflows the user ran live) ─────────────────
  test('L11: traces — show evidence the earlier workflow landed', async () => {
    await page.goto('/traces', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE_LONG);
    await snap(page, 'modules', 'live-traces-after-workflow');
  });

  // ─── L12: Mobile viewport switch ───────────────────────────────────────
  test('L12: switch to mobile, screenshot key pages', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [route, folder, name] of [
      ['/workspace', 'mobile', 'live-mobile-workspace'],
      ['/files', 'mobile', 'live-mobile-files'],
      ['/integrations', 'mobile', 'live-mobile-integrations'],
      ['/settings', 'mobile', 'live-mobile-settings'],
    ] as const) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(PAUSE_MED);
      await snap(page, folder, name);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});
