/**
 * JAK Swarm — Authenticated A-to-Z QA audit.
 *
 * Runs AFTER a successful login with credentials supplied via
 * E2E_AUTH_EMAIL + E2E_AUTH_PASSWORD env vars. Never hardcode
 * credentials in this file.
 *
 * Once logged in, walks every authenticated module, captures
 * screenshots, tests UI behaviors that don't burn LLM credits
 * (no actual workflow dispatch — just navigation + form render
 * + attach flow + integration modal).
 *
 * Usage:
 *   E2E_BASE_URL=https://jakswarm.com \
 *   E2E_AUTH_EMAIL=xxx E2E_AUTH_PASSWORD=xxx \
 *   pnpm exec playwright test qa-audit-authed.spec.ts --project=chromium-mobile
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

const SCREENSHOT_ROOT = 'C:/Users/reetu/Desktop/JackSwarm test';

async function snap(page: Page, subfolder: string, name: string): Promise<string> {
  const safeName = name.replace(/[^a-z0-9-_.]/gi, '-').toLowerCase();
  const filename = safeName.endsWith('.png') ? safeName : `${safeName}.png`;
  const fullPath = path.join(SCREENSHOT_ROOT, subfolder, filename);
  await page.screenshot({ path: fullPath, fullPage: true });
  return fullPath;
}

interface Finding {
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  area: string;
  title: string;
  detail: string;
}
const findings: Finding[] = [];
function record(f: Finding) {
  findings.push(f);
  console.log(`[${f.severity}] ${f.area} — ${f.title}: ${f.detail}`);
}

function collectConsoleErrors(page: Page, bag: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') bag.push(msg.text().slice(0, 400));
  });
  page.on('pageerror', (err) => {
    bag.push(`pageerror: ${err.message.slice(0, 400)}`);
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    if (failure && !req.url().includes('analytics') && !req.url().includes('_next/static')) {
      bag.push(`[network] ${req.method()} ${req.url().slice(0, 120)} — ${failure.errorText}`);
    }
  });
}

const EMAIL = process.env['E2E_AUTH_EMAIL'];
const PASSWORD_PRIMARY = process.env['E2E_AUTH_PASSWORD'];
const PASSWORD_FALLBACK = process.env['E2E_AUTH_PASSWORD_ALT'];

/**
 * Log in once at beforeAll and share the authenticated page across tests.
 * Tries PRIMARY password first, falls back to ALT if provided.
 */
let authedContext: BrowserContext;
let authedPage: Page;
const consoleErrors: string[] = [];

test.describe.configure({ mode: 'serial' });

test.describe('JAK Swarm — Authed QA (logged-in user)', () => {
  test.beforeAll(async ({ browser }) => {
    if (!EMAIL || !PASSWORD_PRIMARY) {
      throw new Error('Set E2E_AUTH_EMAIL + E2E_AUTH_PASSWORD env vars before running this spec.');
    }
    authedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    authedPage = await authedContext.newPage();
    collectConsoleErrors(authedPage, consoleErrors);

    const tryLogin = async (pw: string): Promise<boolean> => {
      await authedPage.goto('/login', { waitUntil: 'domcontentloaded' });
      await authedPage.waitForTimeout(800);
      await authedPage.locator('input[type="email"], input[name="email"]').first().fill(EMAIL!);
      await authedPage.locator('input[type="password"]').first().fill(pw);
      await authedPage.locator('button[type="submit"]').first().click();
      try {
        await authedPage.waitForURL((url) => !/\/(login|register|forgot-password)/.test(url.pathname), { timeout: 15_000 });
        return true;
      } catch {
        return false;
      }
    };

    let ok = await tryLogin(PASSWORD_PRIMARY);
    if (!ok && PASSWORD_FALLBACK) {
      ok = await tryLogin(PASSWORD_FALLBACK);
    }
    if (!ok) {
      await snap(authedPage, 'auth', 'login-failed-authed-suite');
      throw new Error('Login failed with the provided credentials — cannot run authed QA pass.');
    }

    await authedPage.waitForTimeout(2500);
    await snap(authedPage, 'auth', 'login-success-landing');
    record({
      severity: 'Info',
      area: 'Auth',
      title: 'Login succeeded',
      detail: `Landed on: ${authedPage.url()}`,
    });
  });

  test.afterAll(async () => {
    if (consoleErrors.length > 0) {
      record({
        severity: 'Medium',
        area: 'Console',
        title: `${consoleErrors.length} console/network issues during authed pass`,
        detail: consoleErrors.slice(0, 8).join(' | '),
      });
    }
    const reportPath = path.join(SCREENSHOT_ROOT, 'findings-authed.json');
    await fs.writeFile(reportPath, JSON.stringify({
      runAt: new Date().toISOString(),
      email: EMAIL ? EMAIL.replace(/(.{2}).*(@.*)/, '$1***$2') : 'unknown',
      consoleErrorCount: consoleErrors.length,
      consoleErrorsSample: consoleErrors.slice(0, 20),
      findings,
    }, null, 2));
    await authedContext?.close();
  });

  // ─── Dashboard home / nav sanity ───────────────────────────────────────
  test('A1: dashboard landing renders with sidebar', async () => {
    const url = authedPage.url();
    await snap(authedPage, 'dashboard', 'landing-overview');

    // Sidebar expected
    const sidebarLinks = await authedPage.locator('aside a, nav a').count();
    if (sidebarLinks < 5) {
      record({
        severity: 'High',
        area: 'Dashboard',
        title: 'Sidebar shows too few navigation items',
        detail: `Found ${sidebarLinks} nav links on ${url}. Expected at least 5 (Runs, Schedules, Builder, Files, Integrations).`,
      });
    }
  });

  // ─── Module walk-through ───────────────────────────────────────────────
  const routes: Array<{ path: string; folder: string; name: string; expectText?: string }> = [
    { path: '/workspace', folder: 'chat', name: 'workspace' },
    { path: '/swarm', folder: 'modules', name: 'runs' },
    { path: '/schedules', folder: 'modules', name: 'schedules' },
    { path: '/builder', folder: 'builder', name: 'builder' },
    { path: '/analytics', folder: 'modules', name: 'analytics' },
    { path: '/integrations', folder: 'integrations', name: 'integrations-list' },
    { path: '/files', folder: 'uploads', name: 'files-tab' },
    { path: '/knowledge', folder: 'modules', name: 'knowledge' },
    { path: '/skills', folder: 'modules', name: 'skills' },
    { path: '/admin', folder: 'modules', name: 'admin' },
    { path: '/traces', folder: 'modules', name: 'traces' },
    { path: '/billing', folder: 'settings', name: 'billing' },
    { path: '/settings', folder: 'settings', name: 'settings' },
    { path: '/home', folder: 'dashboard', name: 'home' },
  ];

  for (const route of routes) {
    test(`A2 ${route.path} — renders without error`, async () => {
      await authedPage.goto(route.path, { waitUntil: 'domcontentloaded' });
      await authedPage.waitForTimeout(2500);
      await snap(authedPage, route.folder, route.name);

      if (authedPage.url().includes('/login')) {
        record({
          severity: 'High',
          area: 'Auth',
          title: `Session dropped while navigating to ${route.path}`,
          detail: `URL is now ${authedPage.url()}. Auth may have expired mid-run.`,
        });
        return;
      }

      const hasHeading = (await authedPage.locator('h1, h2').count()) > 0;
      if (!hasHeading) {
        record({
          severity: 'Medium',
          area: route.folder,
          title: `${route.path} has no H1/H2 heading`,
          detail: 'Empty render or missing page shell.',
        });
      }

      // Check for obvious error boundaries (Next.js error overlay, blank errors)
      const bodyText = await authedPage.locator('body').innerText();
      if (/application error|something went wrong/i.test(bodyText) && bodyText.length < 500) {
        record({
          severity: 'Critical',
          area: route.folder,
          title: `${route.path} shows error boundary`,
          detail: bodyText.slice(0, 200),
        });
      }
    });
  }

  // ─── Workspace: chat input, mic, paperclip visible ─────────────────────
  test('A3: workspace chat input renders mic + paperclip + send', async () => {
    await authedPage.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2500);
    await snap(authedPage, 'chat', 'workspace-chat-input');

    const send = await authedPage.locator('button[aria-label="Send message"]').count();
    const attach = await authedPage.locator('button[aria-label="Attach a file"]').count();
    if (send === 0) {
      record({
        severity: 'Critical',
        area: 'Chat',
        title: 'Send button missing from chat input',
        detail: 'Cannot send chat messages — blocks core usage.',
      });
    }
    if (attach === 0) {
      record({
        severity: 'High',
        area: 'Chat',
        title: 'Paperclip attach button missing',
        detail: 'Expected button[aria-label="Attach a file"] beside the mic/send.',
      });
    }
  });

  // ─── /files: real upload via drag-drop path using setInputFiles ────────
  test('A4: /files upload path works end-to-end', async () => {
    await authedPage.goto('/files', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2000);
    await snap(authedPage, 'uploads', 'files-before-upload');

    // Make a small fixture
    const fixturePath = path.join(SCREENSHOT_ROOT, 'uploads', '_qa-sample.txt');
    await fs.writeFile(fixturePath, `JAK QA sample ${new Date().toISOString()}\nThis is the Q3 briefing file for the CMO agent.`);

    const fileInput = authedPage.locator('input[type="file"]').first();
    if ((await fileInput.count()) === 0) {
      record({
        severity: 'High',
        area: 'Files',
        title: '/files page has no file input',
        detail: 'Upload UI appears broken or CSS hides the input beyond reach.',
      });
      return;
    }
    await fileInput.setInputFiles(fixturePath);
    await authedPage.waitForTimeout(4000); // let the upload round-trip + status poll
    await snap(authedPage, 'uploads', 'files-after-upload');

    // Look for the filename or "INDEXED" / "PENDING" status chip
    const bodyText = await authedPage.locator('body').innerText();
    const sawFileName = bodyText.includes('_qa-sample.txt');
    const sawStatus = /INDEXED|Indexed|PENDING|Indexing/.test(bodyText);
    if (!sawFileName) {
      record({
        severity: 'High',
        area: 'Files',
        title: 'Uploaded file does not appear in list',
        detail: 'File upload POST may have failed or the list did not refresh.',
      });
    }
    if (!sawStatus) {
      record({
        severity: 'Medium',
        area: 'Files',
        title: 'No status chip after upload',
        detail: 'Expected INDEXED or PENDING state to appear.',
      });
    } else {
      record({
        severity: 'Info',
        area: 'Files',
        title: 'File upload pipeline end-to-end works',
        detail: `Saw filename and status chip in the list after upload.`,
      });
    }
  });

  // ─── Chat attach: upload + chip render + removal ───────────────────────
  test('A5: chat attach via paperclip uploads + shows chip + removes', async () => {
    await authedPage.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2500);

    const fixturePath = path.join(SCREENSHOT_ROOT, 'uploads', '_qa-chat-attach.txt');
    await fs.writeFile(fixturePath, 'JAK chat QA — attach-flow-fixture');

    const fileInput = authedPage.locator('input[type="file"]').first();
    if ((await fileInput.count()) === 0) {
      record({ severity: 'High', area: 'Chat', title: 'No file input in chat', detail: 'Cannot test attach flow.' });
      return;
    }
    await fileInput.setInputFiles(fixturePath);
    await authedPage.waitForTimeout(4000);
    await snap(authedPage, 'chat', 'chat-after-paperclip-attach');

    const chipCount = await authedPage.locator('[role="list"][aria-label="Attached files"] [role="listitem"]').count();
    if (chipCount === 0) {
      record({ severity: 'High', area: 'Chat', title: 'Attach chip did not render after upload', detail: 'Silent failure in chat upload flow.' });
      return;
    }

    // Try removing the chip via its X button
    const removeBtn = authedPage.locator('[role="list"][aria-label="Attached files"] [role="listitem"] button').first();
    if ((await removeBtn.count()) > 0) {
      await removeBtn.click();
      await authedPage.waitForTimeout(600);
      await snap(authedPage, 'chat', 'chat-after-chip-remove');
      const remainingChips = await authedPage.locator('[role="list"][aria-label="Attached files"] [role="listitem"]').count();
      if (remainingChips >= chipCount) {
        record({ severity: 'Medium', area: 'Chat', title: 'Chip remove button did not decrement chip count', detail: `Before: ${chipCount}, after: ${remainingChips}` });
      }
    }
  });

  // ─── Integrations: ConnectModal renders for at least one provider ─────
  test('A6: integrations list shows providers and ConnectModal opens', async () => {
    await authedPage.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(3000);
    await snap(authedPage, 'integrations', 'integrations-list');

    // Look for any "Connect" / "Add" button
    const connectButtons = authedPage.locator('button:has-text("Connect"), button:has-text("Add"), a:has-text("Connect")');
    const count = await connectButtons.count();
    if (count === 0) {
      record({ severity: 'Medium', area: 'Integrations', title: 'No Connect button found on /integrations', detail: 'Expected provider cards with Connect/Add CTAs.' });
      return;
    }

    await connectButtons.first().click();
    await authedPage.waitForTimeout(1500);
    await snap(authedPage, 'integrations', 'connect-modal');

    // ConnectModal should have visible credentials form or OAuth button
    const modalHeading = await authedPage.locator('[role="dialog"] h2, [role="dialog"] h1').first().textContent().catch(() => null);
    if (!modalHeading) {
      record({ severity: 'Medium', area: 'Integrations', title: 'ConnectModal heading not readable', detail: 'Modal may not have rendered.' });
    }

    // Close modal with Escape
    await authedPage.keyboard.press('Escape');
    await authedPage.waitForTimeout(500);
  });

  // ─── Pricing page link from settings (if present) ─────────────────────
  test('A7: settings page is reachable and renders', async () => {
    await authedPage.goto('/settings', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2000);
    await snap(authedPage, 'settings', 'settings-main');
    // No destructive actions — just capture
  });

  // ─── Mobile responsiveness on key authed pages ────────────────────────
  test('A8: mobile views of authed pages (workspace, files, integrations)', async () => {
    await authedPage.setViewportSize({ width: 390, height: 844 });

    await authedPage.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2000);
    await snap(authedPage, 'mobile', 'workspace-mobile');

    await authedPage.goto('/files', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2000);
    await snap(authedPage, 'mobile', 'files-mobile');

    await authedPage.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2000);
    await snap(authedPage, 'mobile', 'integrations-mobile');

    // Restore desktop
    await authedPage.setViewportSize({ width: 1280, height: 800 });
  });

  // ─── Logout flow ──────────────────────────────────────────────────────
  test('A9: logout returns user to landing / login', async () => {
    await authedPage.goto('/', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(1500);

    // Try common logout selectors
    const logoutBtn = authedPage.locator(
      'button:has-text("Sign out"), button:has-text("Log out"), button:has-text("Logout"), a:has-text("Sign out"), a:has-text("Log out")',
    );
    const count = await logoutBtn.count();
    if (count === 0) {
      // Some UIs hide logout in a settings dropdown — open /settings
      await authedPage.goto('/settings', { waitUntil: 'domcontentloaded' });
      await authedPage.waitForTimeout(1500);
      const count2 = await authedPage.locator(
        'button:has-text("Sign out"), button:has-text("Log out"), button:has-text("Logout"), a:has-text("Sign out")',
      ).count();
      if (count2 === 0) {
        record({ severity: 'Medium', area: 'Auth', title: 'No Logout control found', detail: 'Looked on landing + settings. Users may be unable to log out from the UI.' });
        return;
      }
      await authedPage.locator(
        'button:has-text("Sign out"), button:has-text("Log out"), a:has-text("Sign out")',
      ).first().click();
    } else {
      await logoutBtn.first().click();
    }

    await authedPage.waitForTimeout(2500);
    await snap(authedPage, 'auth', 'after-logout');
  });
});
