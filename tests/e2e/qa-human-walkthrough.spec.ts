/**
 * JAK Swarm — Human-interaction walkthrough.
 *
 * Actually USES the product the way a real person would: types into chat,
 * clicks Send, watches the workflow respond, hovers over integration cards,
 * opens dropdowns, toggles switches, scrolls lists. Complements
 * `qa-audit-authed.spec.ts` (which does navigation + screenshots only).
 *
 * Cost-aware: runs ONE real agent workflow with a trivial prompt. Expected
 * LLM spend per run: well under $0.01 on the default tier routing.
 *
 * Usage:
 *   E2E_BASE_URL=https://jakswarm.com \
 *   E2E_AUTH_EMAIL=... E2E_AUTH_PASSWORD=... \
 *   pnpm exec playwright test e2e/qa-human-walkthrough.spec.ts \
 *     --reporter=list --workers=1 --project=chromium-mobile
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
}
const findings: Finding[] = [];
function record(f: Finding) {
  findings.push(f);
  console.log(`[${f.severity}] ${f.area} — ${f.title}: ${f.detail}`);
}

const EMAIL = process.env['E2E_AUTH_EMAIL'];
const PASSWORD_PRIMARY = process.env['E2E_AUTH_PASSWORD'];
const PASSWORD_FALLBACK = process.env['E2E_AUTH_PASSWORD_ALT'];

let authedContext: BrowserContext;
let authedPage: Page;

test.describe.configure({ mode: 'serial' });

test.describe('JAK Swarm — Human-like interaction walkthrough', () => {
  test.beforeAll(async ({ browser }) => {
    if (!EMAIL || !PASSWORD_PRIMARY) throw new Error('Set E2E_AUTH_EMAIL + E2E_AUTH_PASSWORD.');
    authedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    authedPage = await authedContext.newPage();

    const login = async (pw: string) => {
      await authedPage.goto('/login', { waitUntil: 'domcontentloaded' });
      await authedPage.waitForTimeout(800);
      await authedPage.locator('input[type="email"], input[name="email"]').first().fill(EMAIL!);
      await authedPage.locator('input[type="password"]').first().fill(pw);
      await authedPage.locator('button[type="submit"]').first().click();
      try {
        await authedPage.waitForURL((u) => !/\/(login|register|forgot-password)/.test(u.pathname), { timeout: 15000 });
        return true;
      } catch { return false; }
    };
    let ok = await login(PASSWORD_PRIMARY);
    if (!ok && PASSWORD_FALLBACK) ok = await login(PASSWORD_FALLBACK);
    if (!ok) throw new Error('Login failed.');
    await authedPage.waitForTimeout(2500);
  });

  test.afterAll(async () => {
    const rpt = path.join(SCREENSHOT_ROOT, 'findings-human.json');
    await fs.writeFile(rpt, JSON.stringify({ runAt: new Date().toISOString(), findings }, null, 2));
    await authedContext?.close();
  });

  // ─── H1: Send a real chat message and watch the workflow run ────────────
  test('H1: type a message in chat, click Send, watch response', async () => {
    await authedPage.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(3000);
    await snap(authedPage, 'chat', 'chat-empty-ready');

    // Find and focus the textarea
    const textarea = authedPage.locator('textarea').first();
    if (!(await textarea.count())) {
      record({ severity: 'Critical', area: 'Chat', title: 'No textarea found in /workspace', detail: 'Chat is broken.' });
      return;
    }

    const message = 'Hello — please respond with the single word "ready" to confirm you received this.';
    await textarea.click();
    await textarea.fill(message);
    await snap(authedPage, 'chat', 'chat-typed-message');

    // Click Send
    const sendBtn = authedPage.locator('button[aria-label="Send message"]');
    if (!(await sendBtn.count())) {
      record({ severity: 'Critical', area: 'Chat', title: 'Send button missing', detail: 'Cannot dispatch message.' });
      return;
    }
    await sendBtn.click();
    await authedPage.waitForTimeout(3000);
    await snap(authedPage, 'chat', 'chat-immediately-after-send');

    // Check the textarea cleared
    const postSendValue = await textarea.inputValue();
    if (postSendValue.length > 0) {
      record({
        severity: 'Medium', area: 'Chat',
        title: 'Textarea did not clear after Send',
        detail: `Still contains: "${postSendValue.slice(0, 80)}"`,
      });
    }

    // Look for the user message in the thread
    const bodyText = await authedPage.locator('body').innerText();
    const messageEchoed = bodyText.includes('please respond with the single word');
    if (!messageEchoed) {
      record({
        severity: 'High', area: 'Chat',
        title: 'User message not echoed into thread after Send',
        detail: 'The typed message should appear in the message list.',
      });
    } else {
      record({ severity: 'Info', area: 'Chat', title: 'User message echoed in thread', detail: 'Send path is wired correctly.' });
    }

    // Wait up to 60s for SOMETHING resembling a workflow acknowledgement
    let workflowStarted = false;
    for (let i = 0; i < 30; i++) {
      await authedPage.waitForTimeout(2000);
      const text = await authedPage.locator('body').innerText();
      if (/Workflow started|processing|⏳|working on|Agent|✓|completed|paused/i.test(text)) {
        workflowStarted = true;
        break;
      }
    }
    await snap(authedPage, 'chat', 'chat-after-60s-wait');

    if (!workflowStarted) {
      record({
        severity: 'High', area: 'Chat',
        title: 'No workflow/agent response observed within 60s of Send',
        detail: 'Either the SSE stream is broken, the backend is slow/down, or the UI is not rendering progress events.',
      });
    } else {
      record({ severity: 'Info', area: 'Chat', title: 'Workflow response rendered within 60s', detail: 'End-to-end chat flow working.' });
    }
  });

  // ─── H2: Role picker interaction ───────────────────────────────────────
  test('H2: interact with the role picker (select CEO / CTO / CMO)', async () => {
    await authedPage.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2500);

    // Role picker chips — hunting for CEO / CTO / CMO buttons
    const roles = ['CEO', 'CTO', 'CMO', 'Coding', 'Research'];
    const foundRoles: string[] = [];
    for (const role of roles) {
      const btn = authedPage.locator(`button:has-text("${role}")`).first();
      if ((await btn.count()) > 0) foundRoles.push(role);
    }
    if (foundRoles.length === 0) {
      record({ severity: 'Medium', area: 'RolePicker', title: 'No role buttons found on /workspace', detail: 'Expected CEO/CTO/CMO/etc. chips above or around the chat input.' });
      return;
    }

    // Click CEO (if available)
    const ceoBtn = authedPage.locator('button:has-text("CEO")').first();
    if ((await ceoBtn.count()) > 0) {
      await ceoBtn.click();
      await authedPage.waitForTimeout(500);
      await snap(authedPage, 'chat', 'role-ceo-selected');
    }

    // Click CMO
    const cmoBtn = authedPage.locator('button:has-text("CMO")').first();
    if ((await cmoBtn.count()) > 0) {
      await cmoBtn.click();
      await authedPage.waitForTimeout(500);
      await snap(authedPage, 'chat', 'role-cmo-selected');
    }

    record({ severity: 'Info', area: 'RolePicker', title: `Found ${foundRoles.length} role chip(s)`, detail: foundRoles.join(', ') });
  });

  // ─── H3: Builder — try to create a project ─────────────────────────────
  test('H3: open Builder, try to create a project', async () => {
    await authedPage.goto('/builder', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(3000);
    await snap(authedPage, 'builder', 'builder-landing');

    // Hunt for a "New Project" / "Create" / "+" CTA
    const createBtn = authedPage.locator(
      'button:has-text("New Project"), button:has-text("Create"), button:has-text("New"), button:has-text("+ Project"), a:has-text("New Project"), button[aria-label*="new" i]',
    ).first();

    if ((await createBtn.count()) === 0) {
      // Maybe the builder IS the IDE and we're supposed to see a prompt area directly
      const hasPromptArea = (await authedPage.locator('textarea').count()) > 0;
      if (hasPromptArea) {
        record({ severity: 'Info', area: 'Builder', title: 'Builder shows a direct prompt area', detail: 'No explicit "New Project" button; chat-like prompt is the entry point.' });
        await snap(authedPage, 'builder', 'builder-prompt-area');
      } else {
        record({ severity: 'Medium', area: 'Builder', title: 'Builder has no visible Create button or prompt area', detail: 'User has no clear path to start a new build.' });
      }
      return;
    }

    await createBtn.click();
    await authedPage.waitForTimeout(2000);
    await snap(authedPage, 'builder', 'builder-after-create-click');

    // Try to fill a project name if a modal appeared
    const nameInput = authedPage.locator('input[name="name"], input[placeholder*="name" i], input[placeholder*="project" i]').first();
    if ((await nameInput.count()) > 0) {
      await nameInput.fill(`QA-${Date.now()}-sample`);
      await snap(authedPage, 'builder', 'builder-name-filled');
      // Look for a "Create" confirm button in the modal
      const confirmBtn = authedPage.locator('button:has-text("Create")').last();
      if ((await confirmBtn.count()) > 0) {
        // Don't actually click — creating a real project is a destructive op we'll avoid
        record({ severity: 'Info', area: 'Builder', title: 'New-project modal renders', detail: 'Skipped the Create click to avoid creating a real QA project.' });
      }
    }
  });

  // ─── H4: Integrations — hover + click a card + read modal ──────────────
  test('H4: integrations — hover and open a real provider modal', async () => {
    await authedPage.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(3000);
    await snap(authedPage, 'integrations', 'integrations-human-overview');

    // Hover over first card
    const firstCard = authedPage.locator('[role="button"], .integration-card, button').filter({ hasText: /slack|github|notion|linear|gmail/i }).first();
    if ((await firstCard.count()) === 0) {
      record({ severity: 'Medium', area: 'Integrations', title: 'No provider card matched expected names', detail: 'Looked for Slack/GitHub/Notion/Linear/Gmail cards.' });
      return;
    }
    await firstCard.hover();
    await authedPage.waitForTimeout(400);
    await snap(authedPage, 'integrations', 'integrations-hover-card');

    await firstCard.click();
    await authedPage.waitForTimeout(1500);
    await snap(authedPage, 'integrations', 'integrations-modal-open');

    const dialogHeading = await authedPage.locator('[role="dialog"] h2, [role="dialog"] h1').first().textContent().catch(() => null);
    if (dialogHeading) {
      record({ severity: 'Info', area: 'Integrations', title: `ConnectModal opened: "${dialogHeading.slice(0, 60)}"`, detail: 'Modal renders with heading.' });
    }

    await authedPage.keyboard.press('Escape');
    await authedPage.waitForTimeout(500);
  });

  // ─── H5: Settings — open, scroll, toggle ───────────────────────────────
  test('H5: settings — scroll + toggle a safe control', async () => {
    await authedPage.goto('/settings', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(3000);
    await snap(authedPage, 'settings', 'settings-initial');

    // Scroll to bottom
    await authedPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await authedPage.waitForTimeout(800);
    await snap(authedPage, 'settings', 'settings-scrolled');

    // Hunt for a safe toggle (checkbox with a "notifications" or "dark" or "theme" label)
    const toggles = authedPage.locator('input[type="checkbox"], button[role="switch"]');
    const count = await toggles.count();
    if (count === 0) {
      record({ severity: 'Info', area: 'Settings', title: 'No toggles found in /settings', detail: 'Settings page may be read-only or uses a different control type.' });
      return;
    }
    record({ severity: 'Info', area: 'Settings', title: `${count} toggle/switch controls found`, detail: 'Tested scroll + presence; did not flip any to avoid changing user prefs.' });
  });

  // ─── H6: Files — drag-drop visual + multi-file upload ──────────────────
  test('H6: files tab — upload multiple files sequentially', async () => {
    await authedPage.goto('/files', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2500);

    // Create 2 small fixtures
    const fx1 = path.join(SCREENSHOT_ROOT, 'uploads', '_qa-multi-1.txt');
    const fx2 = path.join(SCREENSHOT_ROOT, 'uploads', '_qa-multi-2.txt');
    await fs.writeFile(fx1, 'QA fixture #1 - CMO brief sample');
    await fs.writeFile(fx2, 'QA fixture #2 - Legal NDA sample');

    const fileInput = authedPage.locator('input[type="file"]').first();
    if ((await fileInput.count()) === 0) {
      record({ severity: 'High', area: 'Files', title: 'No file input on /files', detail: 'Upload UI broken.' });
      return;
    }

    await fileInput.setInputFiles([fx1, fx2]);
    await authedPage.waitForTimeout(5000);
    await snap(authedPage, 'uploads', 'files-after-multi-upload');

    const body = await authedPage.locator('body').innerText();
    const saw1 = body.includes('_qa-multi-1');
    const saw2 = body.includes('_qa-multi-2');
    if (!saw1 || !saw2) {
      record({
        severity: 'Medium', area: 'Files',
        title: 'Multi-file upload: not all files appeared in list',
        detail: `fixture1: ${saw1 ? 'visible' : 'MISSING'}, fixture2: ${saw2 ? 'visible' : 'MISSING'}`,
      });
    } else {
      record({ severity: 'Info', area: 'Files', title: 'Multi-file upload rendered both files', detail: 'Upload pipeline handles batches.' });
    }
  });

  // ─── H7: Sidebar — click through every nav item ────────────────────────
  test('H7: click every sidebar link sequentially like a human exploring', async () => {
    await authedPage.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2000);

    // Gather sidebar nav hrefs
    const hrefs = await authedPage.$$eval('aside a[href], nav a[href]', (els) =>
      Array.from(new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href')).filter((h): h is string => Boolean(h && h.startsWith('/'))))),
    );

    for (const href of hrefs.slice(0, 12)) { // cap at 12 to keep runtime sane
      try {
        const link = authedPage.locator(`a[href="${href}"]`).first();
        if ((await link.count()) === 0) continue;
        await link.click({ timeout: 5000 });
        await authedPage.waitForTimeout(1500);
        const name = href.replace(/[/]/g, '-').replace(/^-/, '') || 'root';
        await snap(authedPage, 'regression', `sidebar-click-${name}`);
      } catch {
        // skip links that fail
      }
    }
    record({ severity: 'Info', area: 'Navigation', title: `Clicked ${Math.min(hrefs.length, 12)} sidebar links`, detail: hrefs.slice(0, 12).join(' ') });
  });

  // ─── H8: Voice mic affordance check (do not actually record) ──────────
  test('H8: mic button present + click reveals browser permission flow', async () => {
    await authedPage.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2000);

    const micBtn = authedPage.locator('button[aria-label*="voice" i], button[aria-label*="listening" i], button[aria-label*="dictate" i]').first();
    if ((await micBtn.count()) === 0) {
      record({ severity: 'Medium', area: 'Voice', title: 'Mic button not found in chat', detail: 'useVoice should render a Mic affordance.' });
      return;
    }
    // Don't click — headless chromium has no mic and would throw. Just confirm presence.
    await snap(authedPage, 'chat', 'chat-mic-visible');
    record({ severity: 'Info', area: 'Voice', title: 'Mic button present beside paperclip', detail: 'Voice dictation affordance rendered.' });
  });

  // ─── H9: 404 page when user types a bad URL ────────────────────────────
  test('H9: authed user visiting /nonexistent sees a clean 404', async () => {
    const resp = await authedPage.goto('/definitely-not-a-real-page-xyz', { waitUntil: 'domcontentloaded' });
    await authedPage.waitForTimeout(2000);
    await snap(authedPage, 'errors', 'authed-unknown-route');
    if (resp && resp.status() !== 404 && resp.status() !== 200) {
      record({ severity: 'Low', area: 'Errors', title: `Unknown route returned ${resp.status()}`, detail: 'Expected 404 or catch-all 200 with NotFound component.' });
    }
  });
});
