/**
 * JAK Swarm — World-Class End-to-End QA.
 *
 * Tests the product the way a CEO/CMO/CTO/Coder/Researcher would. Every
 * scenario asserts on OUTPUT QUALITY, not just navigation. Stub responses
 * ("see key points", JSON dumps, empty findings) are recorded as findings.
 *
 * Screenshots → C:/Users/reetu/Desktop/JackSwarm test/world-class/<area>/
 * JSON report  → C:/Users/reetu/Desktop/JackSwarm test/findings-world-class.json
 *
 * Usage:
 *   E2E_BASE_URL=https://jakswarm.com \
 *   E2E_AUTH_EMAIL=<your-email> E2E_AUTH_PASSWORD=<your-password> \
 *   pnpm exec playwright test e2e/qa-world-class.spec.ts \
 *     --reporter=list --workers=1 --project=chromium-mobile
 *
 * NEVER inline real credentials in this file. Use placeholders only — the
 * password value is supplied by the operator at run time, not by source code.
 */

import { test, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

const SCREENSHOT_ROOT = 'C:/Users/reetu/Desktop/JackSwarm test/world-class';

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
  evidence?: string;
}
const findings: Finding[] = [];
function record(f: Finding) {
  findings.push(f);
  const tag = f.severity === 'Info' ? 'INFO' : f.severity.toUpperCase();
  console.log(`[${tag}] ${f.area} — ${f.title}: ${f.detail}`);
}

const EMAIL = process.env['E2E_AUTH_EMAIL'];
const PASSWORD = process.env['E2E_AUTH_PASSWORD'];

let ctx: BrowserContext;
let page: Page;

/**
 * Send a chat message and wait until either the workflow completes
 * (a final assistant message appears that isn't a status line) or the
 * timeout expires. Returns the final user-facing assistant text and
 * a list of every assistant bubble that appeared.
 */
async function sendChatAndWait(
  message: string,
  opts: { selectRoles?: string[]; timeoutMs?: number } = {},
): Promise<{ finalAnswer: string; bubbles: string[]; durationMs: number }> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  // Always start with a fresh conversation so initialAssistantCount = 0
  const newChatBtn = page.locator('button:has-text("New chat")').first();
  if ((await newChatBtn.count()) > 0) {
    await newChatBtn.click();
    await page.waitForTimeout(800);
  }

  // Pre-select roles if any
  if (opts.selectRoles?.length) {
    for (const role of opts.selectRoles) {
      const btn = page.locator(`button:has-text("${role}")`).first();
      if ((await btn.count()) > 0) {
        await btn.click();
        await page.waitForTimeout(200);
      }
    }
  }

  const textarea = page.locator('textarea').first();
  await textarea.click();
  await textarea.fill(message);

  const sendBtn = page.locator('button[aria-label="Send message"]').first();
  await sendBtn.click();

  // Wait for the final assistant bubble. Heuristic: the LAST bubble that
  // does NOT start with ⏳/✓/✗/Workflow status indicators counts as the
  // user-facing answer. Direct-answer (Commander short-circuit) only
  // produces ONE bubble. Multi-agent runs produce multiple.
  const deadline = Date.now() + timeoutMs;
  let finalAnswer = '';
  let bubbles: string[] = [];

  // Capture how many assistant bubbles existed BEFORE we sent — so we
  // only wait for new ones to arrive after our send.
  const initialAssistantCount = await page.locator('[data-testid="assistant-message"]').count();

  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    bubbles = await page.locator('[data-testid="assistant-message"] p.whitespace-pre-wrap').allInnerTexts().catch(() => []);

    if (bubbles.length <= initialAssistantCount) continue;

    const newBubbles = bubbles.slice(initialAssistantCount);
    // Find the last non-status bubble (status lines start with ⏳/✓/✗/Workflow/Live)
    const nonStatus = newBubbles.filter(
      (b) =>
        b.trim().length > 0 &&
        !/^(⏳|✓|✗|Workflow (started|paused|completed|failed)|Live stream)/.test(b.trim()),
    );
    const last = nonStatus[nonStatus.length - 1] ?? '';
    if (last.length === 0) continue;

    // Workflow done when textarea is re-enabled AND we have a substantive new bubble.
    const textareaDisabled = await textarea.isDisabled().catch(() => false);
    if (!textareaDisabled) {
      finalAnswer = last;
      break;
    }
  }

  return {
    finalAnswer,
    bubbles,
    durationMs: Date.now() - startedAt,
  };
}

function isStubAnswer(text: string): boolean {
  if (!text || text.trim().length < 10) return true;
  const stubs = [
    /^research completed\.?\s*see (key points|details)/i,
    /^task completed\.?\s*see (key points|details)/i,
    /^see (key points|details) for/i,
    /^Agents completed their work but did not produce/i,
    /^Workflow completed without/i,
    /^\{[\s\S]*\}$/, // raw JSON dump
    /^\[[\s\S]*\]$/, // raw JSON array
  ];
  return stubs.some((rx) => rx.test(text.trim()));
}

function isJsonLeak(text: string): boolean {
  // Detect untransformed JSON in user-facing answer
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return true;
  if (/"\w+"\s*:\s*"/.test(trimmed) && trimmed.includes('}')) return true;
  return false;
}

test.describe.configure({ mode: 'serial' });

test.describe('JAK Swarm — World-Class QA', () => {
  test.beforeAll(async ({ browser }) => {
    if (!EMAIL || !PASSWORD) throw new Error('Set E2E_AUTH_EMAIL + E2E_AUTH_PASSWORD');
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await ctx.newPage();

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !/\/(login|register|forgot-password)/.test(u.pathname), { timeout: 20_000 });
    await page.waitForTimeout(2500);
    // Clear conversation localStorage so prior test runs don't pollute the
    // assistant-message count baseline. We keep auth tokens (sb-*).
    await page.evaluate(() => {
      const keep = new Map<string, string>();
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^sb-/.test(k)) keep.set(k, localStorage.getItem(k) ?? '');
      }
      localStorage.clear();
      keep.forEach((v, k) => localStorage.setItem(k, v));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await snap(page, 'auth', 'logged-in-landing');
    record({ severity: 'Info', area: 'Auth', title: 'Logged in successfully', detail: `User: ${EMAIL}` });
  });

  test.afterAll(async () => {
    const rpt = path.join('C:/Users/reetu/Desktop/JackSwarm test', 'findings-world-class.json');
    await fs.writeFile(rpt, JSON.stringify({ runAt: new Date().toISOString(), findings }, null, 2));
    console.log(`\n=== ${findings.length} findings written to ${rpt} ===`);
    const bySev = findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc;
    }, {});
    console.log('By severity:', JSON.stringify(bySev));
    await ctx?.close();
  });

  // ─── 1. Trivial inputs: Commander short-circuit ──────────────────────────
  test('1a. "hi" returns a direct greeting in under 10s (no orchestration)', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const result = await sendChatAndWait('hi', { timeoutMs: 30_000 });
    await snap(page, 'trivial', 'hi-response');

    if (result.finalAnswer.length === 0) {
      record({ severity: 'Critical', area: 'Commander', title: '"hi" produced no response', detail: `bubbles=${result.bubbles.length}, took ${result.durationMs}ms` });
      return;
    }
    if (isStubAnswer(result.finalAnswer) || isJsonLeak(result.finalAnswer)) {
      record({ severity: 'High', area: 'Commander', title: '"hi" got stub/JSON response', detail: result.finalAnswer.slice(0, 200), evidence: result.finalAnswer });
      return;
    }
    if (result.durationMs > 15_000) {
      record({ severity: 'Medium', area: 'Commander', title: '"hi" took longer than 15s', detail: `${result.durationMs}ms — short-circuit may not be working; full pipeline likely ran`, evidence: result.finalAnswer.slice(0, 200) });
      return;
    }
    if (result.bubbles.some((b) => /COMMANDER (working|completed)/i.test(b))) {
      record({ severity: 'Medium', area: 'Commander', title: '"hi" exposed Commander stage to user', detail: 'User shouldn\'t see internal stage badges for trivial responses' });
    }
    record({ severity: 'Info', area: 'Commander', title: '"hi" handled correctly', detail: `${result.durationMs}ms, answer: "${result.finalAnswer.slice(0, 80)}"` });
  });

  test('1b. "what is 2+2?" returns "4" or contains 4', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const result = await sendChatAndWait('what is 2+2?', { timeoutMs: 30_000 });
    await snap(page, 'trivial', 'arithmetic-response');

    if (!result.finalAnswer.includes('4')) {
      record({ severity: 'High', area: 'Commander', title: '"2+2" did not return 4', detail: result.finalAnswer.slice(0, 200) });
      return;
    }
    if (result.durationMs > 15_000) {
      record({ severity: 'Medium', area: 'Commander', title: '"2+2" took longer than 15s', detail: `${result.durationMs}ms` });
    }
    record({ severity: 'Info', area: 'Commander', title: '"2+2" answered correctly', detail: `${result.durationMs}ms` });
  });

  test('1c. "capital of France" returns Paris', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const result = await sendChatAndWait('what is the capital of France?', { timeoutMs: 30_000 });
    await snap(page, 'trivial', 'capital-response');

    if (!/paris/i.test(result.finalAnswer)) {
      record({ severity: 'High', area: 'Commander', title: '"Capital of France" did not return Paris', detail: result.finalAnswer.slice(0, 200) });
      return;
    }
    record({ severity: 'Info', area: 'Commander', title: '"Capital of France" → Paris', detail: `${result.durationMs}ms` });
  });

  // ─── 2. Persona: CMO ─────────────────────────────────────────────────────
  test('2a. CMO persona — write a LinkedIn post for JAK Swarm launch', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const prompt = 'I am the CMO of JAK Swarm, an AI multi-agent platform. Write a compelling LinkedIn announcement post (200-300 words) introducing our launch to enterprise buyers. Hook with a tension, list 3 concrete capabilities, end with a CTA.';
    const result = await sendChatAndWait(prompt, { selectRoles: ['CMO'], timeoutMs: 180_000 });
    await snap(page, 'cmo', 'linkedin-post-output');

    if (isStubAnswer(result.finalAnswer)) {
      record({ severity: 'Critical', area: 'CMO', title: 'LinkedIn post returned stub', detail: result.finalAnswer.slice(0, 300), evidence: result.finalAnswer });
      return;
    }
    if (isJsonLeak(result.finalAnswer)) {
      record({ severity: 'Critical', area: 'CMO', title: 'LinkedIn post leaked raw JSON', detail: result.finalAnswer.slice(0, 300), evidence: result.finalAnswer });
      return;
    }
    const wc = result.finalAnswer.split(/\s+/).filter(Boolean).length;
    if (wc < 100) {
      record({ severity: 'High', area: 'CMO', title: `LinkedIn post too short (${wc} words)`, detail: 'Asked for 200-300 words; got too little', evidence: result.finalAnswer });
      return;
    }
    if (!/JAK\s*Swarm|multi-agent|AI/i.test(result.finalAnswer)) {
      record({ severity: 'Medium', area: 'CMO', title: 'LinkedIn post missing key brand terms', detail: 'No mention of JAK Swarm / multi-agent / AI', evidence: result.finalAnswer.slice(0, 400) });
    }
    record({ severity: 'Info', area: 'CMO', title: `LinkedIn post produced (${wc} words, ${result.durationMs}ms)`, detail: result.finalAnswer.slice(0, 200) });
  });

  test('2b. CMO persona — auto-post to LinkedIn (tools available?)', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const prompt = 'Post the following text to my LinkedIn account: "Testing JAK Swarm auto-posting integration."';
    const result = await sendChatAndWait(prompt, { selectRoles: ['CMO'], timeoutMs: 120_000 });
    await snap(page, 'cmo', 'linkedin-autopost-attempt');

    // Expected behavior: either (a) the system attempts the post and hits a clean
    // "LinkedIn not connected" error, or (b) it actually posts. Either is valid.
    // Bad behavior: returns a fake "Posted!" without doing anything.
    if (/posted|published|success/i.test(result.finalAnswer) && !/connect|integration|not connected|requires/i.test(result.finalAnswer)) {
      record({ severity: 'High', area: 'CMO', title: 'LinkedIn auto-post claimed success without integration', detail: 'Possibly hallucinated — verify Integrations page shows LinkedIn as connected first', evidence: result.finalAnswer.slice(0, 300) });
      return;
    }
    if (/connect|integration|not (connected|configured)/i.test(result.finalAnswer)) {
      record({ severity: 'Info', area: 'CMO', title: 'Auto-post correctly required LinkedIn integration', detail: result.finalAnswer.slice(0, 200) });
      return;
    }
    record({ severity: 'Medium', area: 'CMO', title: 'Auto-post response unclear', detail: result.finalAnswer.slice(0, 300) });
  });

  // ─── 3. Persona: CTO ─────────────────────────────────────────────────────
  // Builder is a project-list page; the prompt textarea lives inside a
  // specific project (/builder/:projectId), so the CTO scenario must
  // create a project first, then drive the prompt + build flow.
  test('3a. CTO persona — Builder creates project + generates a landing page', async () => {
    await page.goto('/builder', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    await snap(page, 'cto', 'builder-list');

    // Click "New Project" CTA (could be the empty-state action or top-bar button)
    const newProjectBtn = page.locator('button:has-text("New Project"), button:has-text("Create Project")').first();
    if ((await newProjectBtn.count()) === 0) {
      record({ severity: 'Critical', area: 'CTO', title: 'Builder has no "New Project" button', detail: 'CTO has no way to start a build' });
      return;
    }
    await newProjectBtn.click();
    await page.waitForTimeout(800);
    await snap(page, 'cto', 'builder-new-project-modal');

    // Fill the project name input inside the modal
    const nameInput = page.locator('input[placeholder*="name" i], input[name="name"], [role="dialog"] input').first();
    if ((await nameInput.count()) === 0) {
      record({ severity: 'High', area: 'CTO', title: 'New Project modal missing name input', detail: 'No name input found in dialog' });
      return;
    }
    const projectName = `qa-numina-${Date.now()}`;
    await nameInput.fill(projectName);
    await snap(page, 'cto', 'builder-name-filled');

    // Confirm create — usually a "Create" button inside the dialog
    const confirmBtn = page.locator('[role="dialog"] button:has-text("Create"), button:has-text("Create Project")').last();
    await confirmBtn.click();
    // Navigation to /builder/:projectId may take a moment
    try {
      await page.waitForURL(/\/builder\/[a-z0-9]+/, { timeout: 15_000 });
    } catch {
      record({ severity: 'High', area: 'CTO', title: 'Project create did not navigate to /builder/:projectId', detail: `Still on ${page.url()}` });
      return;
    }
    await page.waitForTimeout(3000);
    await snap(page, 'cto', 'builder-project-detail');

    // Find the prompt textarea on the project detail page
    const textarea = page.locator('textarea').first();
    if ((await textarea.count()) === 0) {
      record({ severity: 'Critical', area: 'CTO', title: 'Project detail page has no prompt textarea', detail: `URL: ${page.url()}` });
      return;
    }

    const prompt = 'Build a single-page landing for an AI tool called "Numina" — a hero with headline + CTA, a 3-feature grid, and a footer. Use Tailwind. Keep it under 200 lines.';
    await textarea.fill(prompt);
    await snap(page, 'cto', 'builder-prompt-typed');

    // Send the prompt — Builder uses a paper-airplane Send button
    const sendBtn = page.locator('button[aria-label*="send" i], button:has(svg.lucide-send), button[type="submit"]').first();
    if ((await sendBtn.count()) === 0) {
      record({ severity: 'High', area: 'CTO', title: 'No Send button on Builder project page', detail: 'Cannot dispatch build prompt' });
      return;
    }
    await sendBtn.click();
    await snap(page, 'cto', 'builder-after-send');

    // Wait up to 4 minutes for code to appear in the file tree / editor
    const deadline = Date.now() + 240_000;
    let generated = false;
    let snippet = '';
    while (Date.now() < deadline) {
      await page.waitForTimeout(5000);
      const text = await page.locator('main').innerText().catch(() => '');
      // Heuristics: tree shows a file like "page.tsx" or editor shows code
      if (/page\.tsx|index\.html|app\.tsx|className=|<section|<div|tailwind/i.test(text) && text.length > 600) {
        generated = true;
        snippet = text.slice(0, 800);
        break;
      }
    }
    await snap(page, 'cto', 'builder-after-generation');

    if (!generated) {
      record({ severity: 'Critical', area: 'CTO', title: 'Builder did not produce code within 4min', detail: 'Build pipeline appears broken — check vibe-coder workflow trace' });
      return;
    }
    record({ severity: 'Info', area: 'CTO', title: 'Builder created project + produced code', detail: snippet.slice(0, 200) });
  });

  // ─── 4. Persona: CEO ─────────────────────────────────────────────────────
  test('4. CEO persona — SWOT for an AI startup', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const prompt = 'I am the CEO of an early-stage AI agent platform. Do a brief SWOT analysis (Strengths/Weaknesses/Opportunities/Threats) for our company in the multi-agent orchestration space. Be specific and honest, not generic.';
    const result = await sendChatAndWait(prompt, { selectRoles: ['CEO'], timeoutMs: 180_000 });
    await snap(page, 'ceo', 'swot-output');

    if (isStubAnswer(result.finalAnswer) || isJsonLeak(result.finalAnswer)) {
      record({ severity: 'Critical', area: 'CEO', title: 'SWOT returned stub/JSON', detail: result.finalAnswer.slice(0, 300), evidence: result.finalAnswer });
      return;
    }
    const hasAllFour = /strength/i.test(result.finalAnswer) && /weakness/i.test(result.finalAnswer)
      && /opportunit/i.test(result.finalAnswer) && /threat/i.test(result.finalAnswer);
    if (!hasAllFour) {
      record({ severity: 'High', area: 'CEO', title: 'SWOT missing one of the 4 quadrants', detail: result.finalAnswer.slice(0, 400), evidence: result.finalAnswer });
      return;
    }
    const wc = result.finalAnswer.split(/\s+/).filter(Boolean).length;
    record({ severity: 'Info', area: 'CEO', title: `SWOT produced (${wc} words, ${result.durationMs}ms)`, detail: result.finalAnswer.slice(0, 200) });
  });

  // ─── 5. Persona: Research worker ─────────────────────────────────────────
  test('5. Research persona — give actual findings, not stub', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const prompt = 'Research the current state of LangGraph vs CrewAI vs AutoGen as of 2025. Compare on: developer ergonomics, production-readiness, community size. Cite sources.';
    const result = await sendChatAndWait(prompt, { selectRoles: ['Research'], timeoutMs: 240_000 });
    await snap(page, 'research', 'research-output');

    if (isStubAnswer(result.finalAnswer)) {
      record({ severity: 'Critical', area: 'Research', title: 'Research returned stub answer', detail: result.finalAnswer.slice(0, 300), evidence: result.finalAnswer });
      return;
    }
    if (isJsonLeak(result.finalAnswer)) {
      record({ severity: 'Critical', area: 'Research', title: 'Research leaked JSON to user', detail: result.finalAnswer.slice(0, 300), evidence: result.finalAnswer });
      return;
    }
    const wc = result.finalAnswer.split(/\s+/).filter(Boolean).length;
    if (wc < 100) {
      record({ severity: 'High', area: 'Research', title: `Research too short (${wc} words)`, detail: 'Real research answer should be 150+ words', evidence: result.finalAnswer });
      return;
    }
    const mentionsAll = /langgraph/i.test(result.finalAnswer) && /crewai/i.test(result.finalAnswer) && /autogen/i.test(result.finalAnswer);
    if (!mentionsAll) {
      record({ severity: 'Medium', area: 'Research', title: 'Research missing one or more frameworks asked about', detail: result.finalAnswer.slice(0, 400) });
    }
    record({ severity: 'Info', area: 'Research', title: `Research produced ${wc} words in ${result.durationMs}ms`, detail: result.finalAnswer.slice(0, 200) });
  });

  // ─── 6. Coding worker ────────────────────────────────────────────────────
  test('6. Coding persona — write a working Python script', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const prompt = 'Write a Python script that takes a CSV file path as a CLI arg, reads it, and prints the top 5 rows by a column called "revenue" descending. Use pandas. Include error handling for missing file.';
    const result = await sendChatAndWait(prompt, { selectRoles: ['Code'], timeoutMs: 180_000 });
    await snap(page, 'coding', 'python-script-output');

    if (isStubAnswer(result.finalAnswer) || isJsonLeak(result.finalAnswer)) {
      record({ severity: 'Critical', area: 'Coding', title: 'Coding returned stub/JSON', detail: result.finalAnswer.slice(0, 300), evidence: result.finalAnswer });
      return;
    }
    const hasCode = /pandas|read_csv|sort_values|argparse|sys\.argv/i.test(result.finalAnswer);
    if (!hasCode) {
      record({ severity: 'High', area: 'Coding', title: 'Coding answer has no Python/pandas code', detail: 'Expected pandas.read_csv + sort_values + CLI parsing', evidence: result.finalAnswer.slice(0, 500) });
      return;
    }
    record({ severity: 'Info', area: 'Coding', title: 'Coding produced working-shaped Python', detail: result.finalAnswer.slice(0, 200) });
  });

  // ─── 7. Automation: schedule a workflow ──────────────────────────────────
  test('7. /schedules page renders + can create a schedule', async () => {
    await page.goto('/schedules', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await snap(page, 'schedules', 'schedules-landing');

    const bodyText = await page.locator('body').innerText();
    if (/access restricted|not authorized|404/i.test(bodyText)) {
      record({ severity: 'Critical', area: 'Schedules', title: '/schedules blocked or missing', detail: bodyText.slice(0, 200) });
      return;
    }
    if (bodyText.length < 100) {
      record({ severity: 'High', area: 'Schedules', title: '/schedules nearly empty', detail: bodyText });
      return;
    }
    record({ severity: 'Info', area: 'Schedules', title: '/schedules renders', detail: bodyText.slice(0, 150) });
  });

  // ─── 8. Nav audit: every sidebar page loads + has real content ──────────
  test('8. nav audit — every sidebar page loads + has real page content', async () => {
    // Each target declares at least one marker — a string (or regex) that MUST
    // appear on the page for the test to consider it genuinely rendered. Without
    // this, "sidebar chrome only" passes the length check and hides real bugs.
    const targets: Array<{
      href: string; label: string;
      markers: Array<string | RegExp>;
      minMainChars?: number;
    }> = [
      // /workspace placeholder ("Message CTO…") is an attribute not innerText,
      // so we match on persona role labels + the disclaimer that always renders.
      { href: '/workspace', label: 'Workspace', markers: [/CEO|CMO|CTO|Coding|Research|Design|Auto|JAK Swarm may produce|verify important/i], minMainChars: 50 },
      { href: '/swarm', label: 'Runs', markers: [/workflow|run|status|history|no workflows/i], minMainChars: 100 },
      { href: '/schedules', label: 'Schedules', markers: [/schedule|cron|recurring|no schedules|upcoming/i], minMainChars: 100 },
      { href: '/builder', label: 'Builder', markers: [/build|project|generate|prompt|create/i], minMainChars: 100 },
      { href: '/analytics', label: 'Analytics', markers: [/workflow|cost|usage|success|metric|period/i], minMainChars: 150 },
      { href: '/integrations', label: 'Integrations', markers: [/slack|github|gmail|notion|connect/i], minMainChars: 200 },
      { href: '/files', label: 'Files', markers: [/file|upload|no files|document/i], minMainChars: 100 },
      { href: '/knowledge', label: 'Knowledge', markers: [/knowledge|memory|fact|preference|add memory/i], minMainChars: 100 },
      { href: '/skills', label: 'Skills', markers: [/skill|capability|tool|agent/i], minMainChars: 100 },
      { href: '/settings', label: 'Settings', markers: [/backend|provider|model|account|profile|api key|billing/i], minMainChars: 150 },
    ];
    for (const t of targets) {
      await page.goto(t.href, { waitUntil: 'domcontentloaded' });
      // 4500ms — pages with SWR data fetching need 3-4s to render content
      // after domcontentloaded; 2500ms captures loading-spinner state and
      // mis-reports pages as blank.
      await page.waitForTimeout(4500);
      await snap(page, 'nav', `${t.label.toLowerCase()}-landing`);

      const fullText = await page.locator('body').innerText();
      // <main> selector captures the page body (excluding sidebar + top nav)
      const mainText = await page.locator('main').first().innerText().catch(() => fullText);

      if (/access restricted|404|not found/i.test(mainText.slice(0, 300))) {
        record({ severity: 'Critical', area: 'Nav', title: `${t.label} page blocked or 404'd`, detail: mainText.slice(0, 200) });
        continue;
      }

      const minChars = t.minMainChars ?? 80;
      if (mainText.trim().length < minChars) {
        record({ severity: 'High', area: 'Nav', title: `${t.label} main area too small (${mainText.length} chars, expected ≥${minChars})`, detail: mainText.slice(0, 300) });
        continue;
      }

      const matchedMarkers = t.markers.filter((m) => typeof m === 'string' ? mainText.toLowerCase().includes(m.toLowerCase()) : m.test(mainText));
      if (matchedMarkers.length === 0) {
        record({
          severity: 'High', area: 'Nav',
          title: `${t.label} page renders but missing all expected markers`,
          detail: `expected one of: ${t.markers.map(String).join(' | ')}; got: ${mainText.slice(0, 300).replace(/\n+/g, ' | ')}`,
        });
        continue;
      }

      // Scroll test
      const scrollInfo = await page.evaluate(() => ({
        scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
        viewport: window.innerHeight,
      }));
      if (scrollInfo.scrollHeight > scrollInfo.viewport + 50) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(500);
        const scrolled = await page.evaluate(() => window.scrollY);
        if (scrolled < 50) {
          record({ severity: 'High', area: 'Nav', title: `${t.label} content overflows but does not scroll`, detail: `scrollHeight=${scrollInfo.scrollHeight}, viewport=${scrollInfo.viewport}, scrolled=${scrolled}` });
          continue;
        }
        await snap(page, 'nav', `${t.label.toLowerCase()}-scrolled`);
      }
      record({ severity: 'Info', area: 'Nav', title: `${t.label} renders + has content + scrolls`, detail: `main=${mainText.length}chars, markers=[${matchedMarkers.map(String).join(',')}]` });
    }
  });

  // ─── 9. Sidebar interactions ─────────────────────────────────────────────
  test('9. sidebar — past conversation click navigates to /workspace', async () => {
    // Send a quick chat to seed at least one conversation
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await sendChatAndWait('hello world test', { timeoutMs: 30_000 });
    await page.waitForTimeout(1500);

    // Now navigate AWAY to /swarm
    await page.goto('/swarm', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await snap(page, 'sidebar', 'on-swarm-before-conv-click');

    // Click the first conversation in the sidebar's "Recent" section
    const convBtn = page.locator('aside button:has(svg.lucide-message-square)').first();
    if ((await convBtn.count()) === 0) {
      record({ severity: 'Medium', area: 'Sidebar', title: 'No past conversation found in sidebar', detail: 'Skipping click test' });
      return;
    }
    await convBtn.click();
    await page.waitForTimeout(2500);
    await snap(page, 'sidebar', 'after-conv-click');

    const url = page.url();
    if (!url.includes('/workspace')) {
      record({ severity: 'Critical', area: 'Sidebar', title: 'Past conversation click did NOT navigate to /workspace', detail: `Current URL: ${url}` });
      return;
    }
    record({ severity: 'Info', area: 'Sidebar', title: 'Past conversation click navigates correctly', detail: url });
  });

  // ─── 11. Runs page — workflow list + detail view ─────────────────────────
  test('11. /swarm — workflow list + detail view + trace content', async () => {
    await page.goto('/swarm', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    await snap(page, 'runs', 'runs-list');

    const mainText = await page.locator('main').first().innerText();
    if (/no workflows|empty/i.test(mainText) && !/workflow.*\d/i.test(mainText)) {
      record({ severity: 'Info', area: 'Runs', title: '/swarm shows empty state', detail: mainText.slice(0, 200) });
      return;
    }

    // Click the first workflow row to expand it — on /swarm these are
    // <button> elements wrapping the status/id/goal summary.
    const rows = page.locator('main button').filter({ hasText: /Failed|Completed|Pending|Running|Paused/i });
    const rowCount = await rows.count();
    if (rowCount === 0) {
      record({ severity: 'Medium', area: 'Runs', title: 'No workflow rows matched status-badge pattern', detail: mainText.slice(0, 300) });
      return;
    }

    await rows.first().click();
    await page.waitForTimeout(3500);
    await snap(page, 'runs', 'runs-detail-expanded');

    const detailText = await page.locator('main').first().innerText();
    // Expanded row should surface agent timeline OR trace list OR empty-state text
    const hasDetail = /timeline|trace|agent|no traces|completed|planner|commander/i.test(detailText);
    if (!hasDetail) {
      record({ severity: 'High', area: 'Runs', title: 'Workflow row expanded but no detail content visible', detail: detailText.slice(0, 400) });
      return;
    }
    record({ severity: 'Info', area: 'Runs', title: `Workflow detail view renders (${rowCount} rows found)`, detail: detailText.slice(0, 200) });
  });

  // ─── 12. Analytics — real numbers or labeled empty ───────────────────────
  test('12. /analytics — either real numbers or honest empty state', async () => {
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await snap(page, 'analytics', 'analytics-landing');

    const mainText = await page.locator('main').first().innerText();
    const hasRealData = /\$\d|\d+\s*(workflow|run|task)|[1-9]\d*%/i.test(mainText);
    const hasEmptyLabel = /no (data|workflows|activity|runs)|get started|empty/i.test(mainText);

    if (!hasRealData && !hasEmptyLabel) {
      record({ severity: 'High', area: 'Analytics', title: 'Analytics shows neither data nor empty state', detail: mainText.slice(0, 400) });
      return;
    }
    if (hasRealData) {
      record({ severity: 'Info', area: 'Analytics', title: 'Analytics shows real numbers', detail: mainText.slice(0, 300) });
    } else {
      record({ severity: 'Info', area: 'Analytics', title: 'Analytics empty state (labeled)', detail: mainText.slice(0, 200) });
    }
  });

  // ─── 13. Integrations — all expected providers listed ────────────────────
  test('13. /integrations — expected providers are listed', async () => {
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    await snap(page, 'integrations', 'integrations-landing');

    const mainText = (await page.locator('main').first().innerText()).toLowerCase();
    const expected = ['slack', 'github', 'gmail', 'notion', 'linkedin', 'google'];
    const missing = expected.filter((p) => !mainText.includes(p));
    if (missing.length > 2) {
      record({ severity: 'High', area: 'Integrations', title: `Missing ${missing.length} expected providers`, detail: `Expected: ${expected.join(', ')}. Missing: ${missing.join(', ')}` });
      return;
    }
    record({ severity: 'Info', area: 'Integrations', title: `${expected.length - missing.length}/${expected.length} expected providers present`, detail: missing.length > 0 ? `Missing (minor): ${missing.join(', ')}` : 'all present' });
  });

  // ─── 14. Role picker on /workspace — all expected roles ──────────────────
  test('14. /workspace role picker has CEO/CMO/CTO/Coding/Research/Design/Auto', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const expected = ['CEO', 'CMO', 'CTO', 'Coding', 'Research', 'Design', 'Auto'];
    const missing: string[] = [];
    for (const role of expected) {
      const btn = page.locator(`button:has-text("${role}")`).first();
      const found = (await btn.count()) > 0;
      if (!found) missing.push(role);
    }
    if (missing.length > 0) {
      record({ severity: 'High', area: 'RolePicker', title: `Missing roles: ${missing.join(', ')}`, detail: `Expected all of: ${expected.join(', ')}` });
      return;
    }
    record({ severity: 'Info', area: 'RolePicker', title: `All ${expected.length} roles present`, detail: expected.join(', ') });
  });

  // ─── 15. Settings — API key never leaked in any UI element ───────────────
  test('15. /settings — API key fingerprints/full keys never appear', async () => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    await snap(page, 'settings', 'settings-rest');

    const allText = await page.locator('body').innerText();
    // Look for patterns that would indicate a leaked API key:
    //   - sk-... (OpenAI), sk-proj-... (OpenAI project key)
    //   - sk-ant-... (Anthropic)
    //   - AIzaSy... (Google AI key)
    //   - rnd_... (Render API)
    //   - keyPreview snippets (e.g., "sk-XXXX...XXXX")
    const leakPatterns: Array<{ rx: RegExp; name: string }> = [
      { rx: /sk-[a-zA-Z0-9]{20,}/, name: 'OpenAI key prefix' },
      { rx: /sk-ant-[a-zA-Z0-9_\-]{20,}/, name: 'Anthropic key' },
      { rx: /AIzaSy[a-zA-Z0-9_\-]{20,}/, name: 'Google AI key' },
      { rx: /rnd_[a-zA-Z0-9]{20,}/, name: 'Render API key' },
      // Last-N-chars preview pattern (sk-XXXX...wxyz)
      { rx: /sk-[A-Z0-9]{2,4}\.\.\.\w{4,}/i, name: 'Key fingerprint' },
    ];
    const leaks = leakPatterns.filter((p) => p.rx.test(allText));
    if (leaks.length > 0) {
      record({
        severity: 'Critical', area: 'Settings',
        title: `API key leaked in Settings UI: ${leaks.map((l) => l.name).join(', ')}`,
        detail: 'Inspect screenshot at settings/settings-rest.png',
      });
      return;
    }
    // Also confirm masked dots ARE shown (the safe representation)
    const hasMaskedRepresentation = /•{4,}|\*{4,}|••• \(\d+ chars\)/.test(allText);
    record({
      severity: 'Info', area: 'Settings',
      title: 'No API key leak detected in Settings UI',
      detail: hasMaskedRepresentation ? 'Mask dots present (correct)' : 'No mask dots — verify keys are stored elsewhere',
    });
  });

  // ─── 16. Knowledge — Add memory dialog opens ──────────────────────────────
  test('16. /knowledge — Add memory button opens dialog', async () => {
    await page.goto('/knowledge', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);

    // SWR-backed pages sometimes defer the header button until the first
    // data fetch resolves. Explicit wait-for so the spec doesn't race SWR.
    const addBtn = page.locator('button:has-text("Add Memory")').first();
    try {
      await addBtn.waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      record({ severity: 'High', area: 'Knowledge', title: 'No "Add Memory" button found after 12.5s', detail: 'Knowledge page CRUD entry-point missing or SWR fetch never resolved' });
      return;
    }
    if ((await addBtn.count()) === 0) {
      record({ severity: 'High', area: 'Knowledge', title: 'No "Add Memory" button found', detail: 'Knowledge page CRUD entry-point missing' });
      return;
    }
    await addBtn.click();
    await page.waitForTimeout(800);
    await snap(page, 'knowledge', 'add-memory-dialog');

    const dialog = page.locator('[role="dialog"]').first();
    if ((await dialog.count()) === 0) {
      record({ severity: 'High', area: 'Knowledge', title: '"Add Memory" click did not open dialog', detail: 'Modal not rendered' });
      return;
    }
    const dialogText = await dialog.innerText();
    if (!/key|value|type/i.test(dialogText)) {
      record({ severity: 'Medium', area: 'Knowledge', title: 'Add Memory dialog missing expected fields', detail: dialogText.slice(0, 300) });
      return;
    }

    // Close dialog (Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    record({ severity: 'Info', area: 'Knowledge', title: 'Add Memory dialog opens with key/value/type fields', detail: dialogText.slice(0, 200) });
  });

  // ─── 17. Files — upload UI is reachable ───────────────────────────────────
  test('17. /files — upload UI reachable', async () => {
    await page.goto('/files', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    await snap(page, 'files', 'files-landing');

    const uploadBtn = page.locator('button:has-text("Upload"), label:has-text("Upload"), input[type="file"]').first();
    const hasFileInput = (await page.locator('input[type="file"]').count()) > 0;

    if ((await uploadBtn.count()) === 0 && !hasFileInput) {
      record({ severity: 'High', area: 'Files', title: 'No upload button or file input on /files', detail: 'Users have no way to upload files' });
      return;
    }
    record({ severity: 'Info', area: 'Files', title: 'Files upload UI reachable', detail: hasFileInput ? 'file input present' : 'upload button present' });
  });

  test('10. sidebar — Sign out is discoverable + works', async () => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const signOutBtn = page.locator('button[aria-label="Sign out"]').first();
    if ((await signOutBtn.count()) === 0) {
      record({ severity: 'High', area: 'Sidebar', title: 'No Sign out button found in sidebar', detail: 'Logout not discoverable' });
      return;
    }
    await snap(page, 'sidebar', 'signout-visible');
    record({ severity: 'Info', area: 'Sidebar', title: 'Sign out button discoverable', detail: 'Skipping click to keep session for other tests' });
  });
});
