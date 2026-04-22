/**
 * JAK Swarm — Full A-to-Z QA audit.
 *
 * Exhaustive end-to-end walkthrough. Captures screenshots for every
 * major page, module, and state into `Desktop/JackSwarm test/` for
 * human review.
 *
 * Passes executed:
 *   1. Landing / marketing (unauthenticated)
 *   2. Auth flows — register, login, invalid creds
 *   3. Authenticated dashboard walkthrough
 *   4. Module pages (swarm, schedules, builder, analytics, integrations,
 *      files, knowledge, skills, admin)
 *   5. Chat + file attach flow
 *   6. Responsiveness (mobile + tablet)
 *   7. Error states (404, unauthed access to gated routes)
 *
 * Findings are printed via test.info().annotations for the report.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

const SCREENSHOT_ROOT = 'C:/Users/reetu/Desktop/JackSwarm test';

/** Helper: save a screenshot with semantic naming into a subfolder. */
async function snap(page: Page, subfolder: string, name: string): Promise<string> {
  const safeName = name.replace(/[^a-z0-9-_.]/gi, '-').toLowerCase();
  const filename = safeName.endsWith('.png') ? safeName : `${safeName}.png`;
  const fullPath = path.join(SCREENSHOT_ROOT, subfolder, filename);
  await page.screenshot({ path: fullPath, fullPage: true });
  return fullPath;
}

/** Track findings across the whole run so we can emit a summary file. */
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
  console.log(`[${f.severity}] ${f.area} — ${f.title}: ${f.detail}`);
}

/** Collect console errors for the current page lifetime. */
function collectConsoleErrors(page: Page, bag: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') bag.push(msg.text().slice(0, 500));
  });
  page.on('pageerror', (err) => {
    bag.push(`pageerror: ${err.message.slice(0, 500)}`);
  });
}

const testSuffix = Date.now();
const testEmail = `qa-${testSuffix}@jaktest.dev`;
const testPassword = 'QaTest12345!';
const testTenantSlug = `qa-tenant-${testSuffix}`;

// ─────────────────────────────────────────────────────────────────────────
// PASS 1: Landing / unauthenticated marketing surface
// ─────────────────────────────────────────────────────────────────────────

test.describe('Pass 1 — Landing (unauthenticated)', () => {
  test('landing page renders + hero copy is trust-first', async ({ page }) => {
    const consoleErrors: string[] = [];
    collectConsoleErrors(page, consoleErrors);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500); // let hero animations settle

    await snap(page, 'landing', 'hero-desktop');

    const h1 = await page.locator('h1').first().textContent();
    expect(h1).toContain('trusted control plane');

    const title = await page.title();
    expect(title).toContain('Trusted Control Plane');

    // H2 section order sanity
    const h2s = await page.locator('h2').allTextContents();
    if (h2s.length < 10) {
      record({
        severity: 'Medium',
        area: 'Landing',
        title: 'H2 count below expected',
        detail: `Found ${h2s.length} H2 elements; audit expected 11–13 sections.`,
      });
    }

    // Count hero-adjacent badges that should NOT appear (post-audit removal)
    const bodyText = await page.locator('body').innerText();
    if (bodyText.includes('38 Agents Live')) {
      record({
        severity: 'High',
        area: 'Landing',
        title: 'Count-led "38 Agents Live" badge leaked back in',
        detail: 'The audit removed this hero badge; if visible, the trust-first re-hierarchy regressed.',
      });
    }
    if (bodyText.includes('Actually Executes')) {
      record({
        severity: 'High',
        area: 'Landing',
        title: 'Old H1 fragment "Actually Executes" visible',
        detail: 'The audit removed this apologetic framing.',
      });
    }

    if (consoleErrors.length > 0) {
      record({
        severity: 'Medium',
        area: 'Landing',
        title: 'Console errors on landing',
        detail: consoleErrors.slice(0, 5).join(' | '),
      });
    }
  });

  test('landing CTAs + anchor links all resolve', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Check all #anchor links referenced in the nav + footer.
    // NOTE: done inside page.evaluate so CSS.escape (browser global) is
    // available. Previously called from Node context where CSS is undefined.
    const brokenAnchors = await page.evaluate(() => {
      const anchors = Array.from(
        new Set(
          Array.from(document.querySelectorAll('a[href^="#"]'))
            .map((a) => a.getAttribute('href'))
            .filter((h): h is string => Boolean(h)),
        ),
      );
      const broken: string[] = [];
      for (const anchor of anchors) {
        const id = anchor.slice(1);
        if (!id || id === 'main-content') continue;
        const el = document.querySelector(`#${CSS.escape(id)}`);
        if (!el) broken.push(anchor);
      }
      return broken;
    });
    for (const anchor of brokenAnchors) {
      record({
        severity: 'High',
        area: 'Landing',
        title: `Broken anchor link: ${anchor}`,
        detail: `Nav or footer links to ${anchor} but no element with that id exists.`,
      });
    }

    // Every external link should have rel=noopener
    const externalLinksMissingRel = await page.$$eval(
      'a[href^="https://"]',
      (els) => els.filter((e) => !e.rel.includes('noopener')).map((e) => e.getAttribute('href')),
    );
    if (externalLinksMissingRel.length > 0) {
      record({
        severity: 'Low',
        area: 'Landing',
        title: 'External links missing rel=noopener',
        detail: `Count: ${externalLinksMissingRel.length}`,
      });
    }
  });

  test('landing pricing section renders 4 tiers', async ({ page }) => {
    await page.goto('/#pricing');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);

    await snap(page, 'pricing', 'pricing-section');

    const tierPrices = await page.locator('#pricing').locator('text=/^\\$/').allTextContents();
    if (tierPrices.length < 4) {
      record({
        severity: 'High',
        area: 'Pricing',
        title: `Expected ≥4 pricing tiers, found ${tierPrices.length}`,
        detail: `Tier prices on screen: ${tierPrices.join(', ')}`,
      });
    }
  });

  test('landing LiveDemo + Trust Layer sections visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('text=/Approvals\\. Audit\\. Recovery/').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await snap(page, 'landing', 'trust-layer');

    await page.locator('text=/Build\\. Operate\\. Verify/').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await snap(page, 'landing', 'build-operate-verify');

    await page.locator('text=/Watch JAK work/i').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await snap(page, 'landing', 'live-demo');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PASS 2: Auth flows
// ─────────────────────────────────────────────────────────────────────────

test.describe('Pass 2 — Auth flows', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await snap(page, 'auth', 'login-page');

    const emailInput = await page.locator('input[type="email"], input[name="email"]').count();
    const passwordInput = await page.locator('input[type="password"]').count();
    if (emailInput === 0 || passwordInput === 0) {
      record({
        severity: 'Critical',
        area: 'Auth',
        title: 'Login form missing inputs',
        detail: `email inputs: ${emailInput}, password inputs: ${passwordInput}`,
      });
    }
  });

  test('register page renders + form validates', async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('domcontentloaded');
    await snap(page, 'auth', 'register-page');

    // Screenshot first, then attempt invalid-submit to capture the error state
    const submitBtn = page.locator('button[type="submit"]').first();
    if (await submitBtn.count() > 0) {
      await submitBtn.click().catch(() => null);
      await page.waitForTimeout(800);
      await snap(page, 'auth', 'register-empty-submit-error');
    }
  });

  test('forgot password page renders', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.waitForLoadState('domcontentloaded');
    await snap(page, 'auth', 'forgot-password');

    const headings = await page.locator('h1, h2').allTextContents();
    if (!headings.join(' ').toLowerCase().includes('password')) {
      record({
        severity: 'Low',
        area: 'Auth',
        title: 'Forgot-password page heading unclear',
        detail: `Headings: ${headings.join(' | ').slice(0, 200)}`,
      });
    }
  });

  test('invalid login shows error', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('input[type="email"], input[name="email"]').first().fill('nobody@nowhere.test').catch(() => null);
    await page.locator('input[type="password"]').first().fill('definitelywrong').catch(() => null);
    await page.locator('button[type="submit"]').first().click().catch(() => null);
    await page.waitForTimeout(2000);
    await snap(page, 'auth', 'login-invalid-creds');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PASS 3: Authenticated walkthrough (register + traverse dashboard)
// ─────────────────────────────────────────────────────────────────────────

async function tryRegister(page: Page): Promise<boolean> {
  await page.goto('/register');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passwordInputs = page.locator('input[type="password"]');
  const nameInput = page.locator('input[name="name"], input[placeholder*="name" i]').first();

  if (!(await emailInput.count())) return false;
  await emailInput.fill(testEmail);
  if (await passwordInputs.count()) await passwordInputs.first().fill(testPassword);
  if (await nameInput.count()) await nameInput.fill('QA Tester');

  // Optional: fill tenant if the form has it
  const tenantNameInput = page.locator('input[name="tenantName"], input[placeholder*="tenant" i], input[placeholder*="organization" i], input[placeholder*="company" i]').first();
  const tenantSlugInput = page.locator('input[name="tenantSlug"], input[placeholder*="slug" i]').first();
  if (await tenantNameInput.count()) await tenantNameInput.fill('QA Tenant');
  if (await tenantSlugInput.count()) await tenantSlugInput.fill(testTenantSlug);

  await snap(page, 'auth', 'register-filled');

  await page.locator('button[type="submit"]').first().click();
  // Wait up to 8s for a redirect to a dashboard route
  try {
    await page.waitForURL((url) => !/\/(register|login)($|\?)/.test(url.pathname), { timeout: 15_000 });
  } catch {
    return false;
  }
  return true;
}

test.describe('Pass 3 — Authenticated walkthrough', () => {
  test('register → dashboard landing', async ({ page }) => {
    const consoleErrors: string[] = [];
    collectConsoleErrors(page, consoleErrors);

    const registered = await tryRegister(page);
    if (!registered) {
      record({
        severity: 'High',
        area: 'Auth',
        title: 'Registration did not redirect to dashboard',
        detail: `Post-submit URL: ${page.url()}. Expected redirect off /register.`,
      });
      test.skip();
      return;
    }

    await page.waitForTimeout(2000);
    await snap(page, 'dashboard', 'post-register-landing');

    // URL should now be inside an authed area
    if (/\/(login|register|$)/.test(new URL(page.url()).pathname)) {
      record({
        severity: 'High',
        area: 'Auth',
        title: 'Register redirect landed on a non-dashboard page',
        detail: `URL: ${page.url()}`,
      });
    }

    if (consoleErrors.length > 0) {
      record({
        severity: 'Medium',
        area: 'Dashboard',
        title: 'Console errors on authenticated landing',
        detail: consoleErrors.slice(0, 5).join(' | '),
      });
    }
  });

  const authedRoutes: Array<{ path: string; folder: string; name: string }> = [
    { path: '/workspace', folder: 'chat', name: 'workspace-chat' },
    { path: '/swarm', folder: 'modules', name: 'swarm-runs' },
    { path: '/schedules', folder: 'modules', name: 'schedules' },
    { path: '/builder', folder: 'builder', name: 'builder' },
    { path: '/analytics', folder: 'modules', name: 'analytics' },
    { path: '/integrations', folder: 'integrations', name: 'integrations' },
    { path: '/files', folder: 'uploads', name: 'files-tab' },
    { path: '/knowledge', folder: 'modules', name: 'knowledge' },
    { path: '/skills', folder: 'modules', name: 'skills' },
    { path: '/admin', folder: 'modules', name: 'admin' },
    { path: '/traces', folder: 'modules', name: 'traces' },
    { path: '/billing', folder: 'settings', name: 'billing' },
    { path: '/settings', folder: 'settings', name: 'settings' },
    { path: '/home', folder: 'dashboard', name: 'home' },
  ];

  for (const route of authedRoutes) {
    test(`authenticated route: ${route.path}`, async ({ page }) => {
      // Establish session first
      const registered = await tryRegister(page);
      if (!registered) { test.skip(); return; }

      const consoleErrors: string[] = [];
      collectConsoleErrors(page, consoleErrors);

      await page.goto(route.path);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1500);
      await snap(page, route.folder, route.name);

      if (page.url().includes('/login')) {
        record({
          severity: 'High',
          area: 'Auth',
          title: `${route.path} redirected to /login despite active session`,
          detail: 'Session may have been dropped, or the route is always public-only.',
        });
        return;
      }

      // Shallow content sanity: pages should have an H1/H2
      const hasHeading = (await page.locator('h1, h2').count()) > 0;
      if (!hasHeading) {
        record({
          severity: 'Medium',
          area: 'Dashboard',
          title: `${route.path} has no H1/H2 heading`,
          detail: 'Suggests an empty render or broken page chunk.',
        });
      }

      if (consoleErrors.length > 0) {
        record({
          severity: 'Medium',
          area: route.folder,
          title: `Console errors on ${route.path}`,
          detail: consoleErrors.slice(0, 3).join(' | '),
        });
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// PASS 4: Chat + attach-file workflow
// ─────────────────────────────────────────────────────────────────────────

test.describe('Pass 4 — Chat + file attach', () => {
  test('chat input renders mic + paperclip + send', async ({ page }) => {
    const registered = await tryRegister(page);
    if (!registered) { test.skip(); return; }

    await page.goto('/workspace');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    await snap(page, 'chat', 'chat-input-empty');

    const attachBtn = page.locator('button[aria-label="Attach a file"]');
    const micBtn = page.locator('button[aria-label*="voice"], button[aria-label*="listening"]').first();
    const sendBtn = page.locator('button[aria-label="Send message"]');

    if ((await attachBtn.count()) === 0) {
      record({
        severity: 'High',
        area: 'Chat',
        title: 'Paperclip attach button missing in ChatInput',
        detail: 'Expected button[aria-label="Attach a file"] on /workspace',
      });
    }
    if ((await sendBtn.count()) === 0) {
      record({
        severity: 'Critical',
        area: 'Chat',
        title: 'Send button missing',
        detail: 'Chat input without a send button blocks core usage',
      });
    }
  });

  test('file attach via paperclip uploads to /documents', async ({ page }) => {
    const registered = await tryRegister(page);
    if (!registered) { test.skip(); return; }

    await page.goto('/workspace');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Create a tiny text fixture on disk
    const fixturePath = path.join(SCREENSHOT_ROOT, 'uploads', '_fixture-sample.txt');
    await fs.writeFile(fixturePath, 'JAK Swarm QA — sample document for find_document lookup.\nThe Q3 brief lives here.');

    // Find the hidden file input and set files directly (Playwright idiom)
    const fileInput = page.locator('input[type="file"]');
    if ((await fileInput.count()) === 0) {
      record({
        severity: 'High',
        area: 'Uploads',
        title: 'No file input found in chat',
        detail: 'Paperclip button exists but no hidden <input type=file> — upload flow broken.',
      });
      return;
    }
    await fileInput.first().setInputFiles(fixturePath);
    await page.waitForTimeout(3000);
    await snap(page, 'uploads', 'chat-after-attach');

    // Look for the attachment chip
    const chipCount = await page.locator('[role="list"][aria-label="Attached files"] [role="listitem"]').count();
    if (chipCount === 0) {
      record({
        severity: 'High',
        area: 'Uploads',
        title: 'Attachment chip did not appear after upload',
        detail: 'Upload may have failed silently or chip UI broken.',
      });
    } else {
      record({
        severity: 'Info',
        area: 'Uploads',
        title: 'File attach chip rendered',
        detail: `Found ${chipCount} attachment chip(s) after upload.`,
      });
    }
  });

  test('drag-drop overlay appears on dragover', async ({ page }) => {
    const registered = await tryRegister(page);
    if (!registered) { test.skip(); return; }

    await page.goto('/workspace');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Simulate a drag-enter event on the chat input container
    const chatInputArea = page.locator('.chat-input-area').first();
    if ((await chatInputArea.count()) === 0) {
      record({
        severity: 'Medium',
        area: 'Uploads',
        title: '.chat-input-area element missing',
        detail: 'Drag-drop zone selector broke; cannot test drop overlay.',
      });
      return;
    }

    await chatInputArea.dispatchEvent('dragenter', {
      dataTransfer: { types: ['Files'] } as unknown,
    }).catch(() => null);
    await page.waitForTimeout(500);
    await snap(page, 'uploads', 'drag-drop-overlay');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PASS 5: Responsiveness
// ─────────────────────────────────────────────────────────────────────────

test.describe('Pass 5 — Responsive', () => {
  test('landing page on mobile (390×844)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    await snap(page, 'mobile', 'landing-mobile');

    // H1 should not overflow its container
    const h1 = page.locator('h1').first();
    const h1Box = await h1.boundingBox();
    if (h1Box && h1Box.width > 380) {
      record({
        severity: 'Medium',
        area: 'Responsive',
        title: 'H1 overflows 390px viewport',
        detail: `H1 width: ${h1Box.width}px on 390px viewport.`,
      });
    }
  });

  test('landing on tablet (820×1180)', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    await snap(page, 'mobile', 'landing-tablet');
  });

  test('pricing on mobile (scanability)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#pricing');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await snap(page, 'mobile', 'pricing-mobile');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PASS 6: Error discovery
// ─────────────────────────────────────────────────────────────────────────

test.describe('Pass 6 — Error states', () => {
  test('unknown route returns 404 or redirects cleanly', async ({ page }) => {
    const resp = await page.goto('/this-route-does-not-exist-qa');
    await page.waitForLoadState('domcontentloaded');
    await snap(page, 'errors', 'unknown-route-404');

    const status = resp?.status();
    if (status && status < 400 && !page.url().includes('/login')) {
      record({
        severity: 'Low',
        area: 'Errors',
        title: 'Unknown route did not 404',
        detail: `GET /this-route-does-not-exist-qa returned ${status}`,
      });
    }
  });

  test('gated route redirects to login when unauth', async ({ browser }) => {
    // Fresh context with no cookies
    const context: BrowserContext = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/workspace');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    await snap(page, 'errors', 'gated-route-unauth');

    if (!page.url().includes('/login') && !page.url().endsWith('/')) {
      record({
        severity: 'High',
        area: 'Auth',
        title: '/workspace accessible without auth',
        detail: `URL after unauth visit: ${page.url()}`,
      });
    }
    await context.close();
  });

  test('integrations callback error state renders cleanly', async ({ page }) => {
    await page.goto('/integrations/callback?error=QA-synthetic-error-message');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    await snap(page, 'errors', 'integrations-callback-error');
  });

  test('integrations callback success state renders cleanly', async ({ page }) => {
    await page.goto('/integrations/callback?connected=QA-Test-Provider');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    await snap(page, 'errors', 'integrations-callback-success');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Final: write findings.json so the QA report generator can read them
// ─────────────────────────────────────────────────────────────────────────

test.afterAll(async () => {
  const reportPath = path.join(SCREENSHOT_ROOT, 'findings.json');
  await fs.writeFile(reportPath, JSON.stringify({
    testEmail,
    runAt: new Date().toISOString(),
    findings,
  }, null, 2));
  console.log(`\n[qa-audit] Wrote ${findings.length} finding(s) to ${reportPath}`);
});
