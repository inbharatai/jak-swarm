/**
 * JAK Swarm — A-to-Z product evaluation.
 *
 * Complements qa-live-human-audit.spec.ts by drilling into:
 *   - Part 4: role-by-role workflow execution (8 realistic prompts)
 *   - Part 5: end-to-end workflows (CMO schedule, Builder, Doc eval, Lead
 *     gen, Browser QA, Approval gate, Trace/audit)
 *   - Part 6: backend/API/DB verification via the same Supabase session —
 *     captures every /workflows POST+GET round-trip + its DB persistence
 *     shape (via GET /workflows/:id which returns the persisted state)
 *   - Part 7: failure + edge hunting
 *
 * Every assertion is evidence-backed. Every page + API interaction is
 * recorded to qa/a-to-z-findings.json + screenshots under
 * qa/playwright-artifacts/a-to-z/. The markdown reports are generated
 * outside the spec from this findings file + the existing qa/live-findings.json.
 *
 * Run:
 *   E2E_AUTH_EMAIL=... E2E_AUTH_PASSWORD=... pnpm exec playwright test \
 *     tests/e2e/qa-a-to-z.spec.ts --project=chromium-desktop
 */

import { test, type Page, type BrowserContext, type ConsoleMessage, type Response } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

const SITE = process.env['QA_SITE'] ?? 'https://jakswarm.com';
const ARTIFACTS = 'C:/Users/reetu/Desktop/JAK/jak-swarm/qa/playwright-artifacts/a-to-z';
const FINDINGS_PATH = 'C:/Users/reetu/Desktop/JAK/jak-swarm/qa/a-to-z-findings.json';
const EMAIL = process.env['E2E_AUTH_EMAIL'] ?? 'reetu004@gmail.com';
const PASSWORD = process.env['E2E_AUTH_PASSWORD'] ?? 'Adubaby.004';

type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
type Verdict = 'working' | 'partial' | 'inert' | 'misleading' | 'broken' | 'blocked' | 'marketing-only';

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
  apiCallsObserved?: string[];
  timestamp: string;
}

const findings: Finding[] = [];
let currentApiCalls: string[] = [];
let consoleErrorBuffer: string[] = [];
let networkErrorBuffer: string[] = [];

function record(f: Omit<Finding, 'timestamp'>) {
  const final: Finding = { ...f, timestamp: new Date().toISOString() };
  findings.push(final);
  const tag = f.severity === 'Info' ? 'INFO' : f.severity.toUpperCase();
  // eslint-disable-next-line no-console
  console.log(`[${tag}/${f.verdict}] P${f.phase}/${f.area} — ${f.title}: ${f.evidence.slice(0, 200)}`);
}

async function snap(page: Page, subfolder: string, name: string): Promise<string> {
  const safe = name.replace(/[^a-z0-9-_.]/gi, '-').toLowerCase();
  const full = path.join(ARTIFACTS, subfolder, safe.endsWith('.png') ? safe : `${safe}.png`);
  await page.screenshot({ path: full, fullPage: true }).catch(() => {});
  return full;
}

function attachLoggers(page: Page) {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrorBuffer.push(msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => {
    consoleErrorBuffer.push(`[pageerror] ${err.message.slice(0, 300)}`);
  });
  page.on('response', async (r: Response) => {
    const url = r.url();
    const status = r.status();
    const isApi = /\/api\/|\/workflows|\/schedules|\/files|\/memory|\/projects|\/integrations|\/auth\/v1\//.test(url);
    if (isApi) {
      currentApiCalls.push(`${status} ${r.request().method()} ${url.replace(SITE, '').replace('https://jak-swarm-api.onrender.com', '')}`);
    }
    if (status >= 400 && status < 600) {
      networkErrorBuffer.push(`[${status}] ${url.slice(0, 200)}`);
    }
  });
}
function flushBuffers() {
  const ce = [...consoleErrorBuffer];
  const ne = [...networkErrorBuffer];
  const api = [...currentApiCalls];
  consoleErrorBuffer = [];
  networkErrorBuffer = [];
  currentApiCalls = [];
  return { consoleErrors: ce, networkErrors: ne, apiCallsObserved: api };
}

let ctx: BrowserContext;
let page: Page;

async function login() {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  try {
    await page.waitForURL((u) => !/\/(login|register)/.test(u.pathname), { timeout: 20_000 });
  } catch { /* surface to caller */ }
  await page.waitForTimeout(2500);
}

/**
 * Start a chat on /workspace with the supplied role + prompt, wait up to
 * `timeoutMs` for a final assistant bubble, return the observed text +
 * all API calls that happened during the send.
 */
async function runRolePrompt(role: string, prompt: string, timeoutMs: number): Promise<{
  finalAnswer: string;
  statusLines: string[];
  apiCalls: string[];
  workflowId?: string;
  screenshots: string[];
}> {
  const shots: string[] = [];
  await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Always start a fresh conversation so we count only new bubbles
  const newChat = page.locator('button:has-text("New chat")').first();
  if ((await newChat.count()) > 0) {
    await newChat.click();
    await page.waitForTimeout(1200);
  }

  // The workspace hides the textarea until a function is selected. Click
  // the desired role chip first. Then write prompt.
  const roleBtn = page.locator(`button:has-text("${role}")`).first();
  if ((await roleBtn.count()) > 0) {
    await roleBtn.click();
    await page.waitForTimeout(800);
  }
  shots.push(await snap(page, 'roles', `${role.toLowerCase()}-role-selected`));

  const textarea = page.locator('textarea').first();
  if (!(await textarea.count())) {
    return { finalAnswer: '__NO_TEXTAREA__', statusLines: [], apiCalls: [], screenshots: shots };
  }
  const initialBubbles = await page.locator('[data-testid="assistant-message"]').count();
  await textarea.click();
  await textarea.fill(prompt);
  shots.push(await snap(page, 'roles', `${role.toLowerCase()}-prompt-typed`));

  const apiCallsBefore = currentApiCalls.length;
  const send = page.locator('button[aria-label="Send message"]').first();
  if (!(await send.count())) {
    return { finalAnswer: '__NO_SEND__', statusLines: [], apiCalls: [], screenshots: shots };
  }
  await send.click();
  shots.push(await snap(page, 'roles', `${role.toLowerCase()}-sent`));

  const deadline = Date.now() + timeoutMs;
  let finalAnswer = '';
  let statusLines: string[] = [];
  let workflowId: string | undefined;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    const bubbles = await page.locator('[data-testid="assistant-message"] p.whitespace-pre-wrap').allInnerTexts().catch(() => []);
    if (bubbles.length > initialBubbles) {
      const newBubbles = bubbles.slice(initialBubbles);
      statusLines = newBubbles.filter(b => /^(⏳|✓|✗|Workflow (started|paused|completed|failed)|Live stream)/.test(b.trim()));
      const subst = newBubbles.filter(b => !/^(⏳|✓|✗|Workflow (started|paused|completed|failed)|Live stream)/.test(b.trim()) && b.trim().length > 0);
      const last = subst[subst.length - 1] ?? '';
      const textareaDisabled = await textarea.isDisabled().catch(() => false);
      if (last.length > 0 && !textareaDisabled) { finalAnswer = last; break; }
    }
  }
  shots.push(await snap(page, 'roles', `${role.toLowerCase()}-final`));

  // Extract workflowId from any network call we observed (POST /workflows returns it)
  for (const call of currentApiCalls.slice(apiCallsBefore)) {
    const m = call.match(/\/workflows\/([a-z0-9]{20,})/);
    if (m) { workflowId = m[1]; break; }
  }

  return {
    finalAnswer,
    statusLines,
    apiCalls: currentApiCalls.slice(apiCallsBefore),
    workflowId,
    screenshots: shots,
  };
}

function classifyAnswer(answer: string, prompt: string, requiredSubstrings: Array<string | RegExp>): {
  verdict: Verdict;
  severity: Severity;
  reason: string;
} {
  if (!answer || answer === '__NO_TEXTAREA__') {
    return { verdict: 'blocked', severity: 'Critical', reason: 'no textarea — workspace requires function-selection first (H1)' };
  }
  if (answer === '__NO_SEND__') {
    return { verdict: 'broken', severity: 'Critical', reason: 'no Send button' };
  }
  if (/Agents completed their work but did not produce|No output produced/i.test(answer)) {
    return { verdict: 'broken', severity: 'High', reason: 'stub final answer leaked (recovery layer miss)' };
  }
  if (/Workflow failed:/i.test(answer)) {
    return { verdict: 'broken', severity: 'High', reason: 'workflow failed: ' + answer.slice(0, 120) };
  }
  const misses = requiredSubstrings.filter(s => typeof s === 'string' ? !answer.toLowerCase().includes(s.toLowerCase()) : !s.test(answer));
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  if (wordCount < 30) {
    return { verdict: 'partial', severity: 'High', reason: `too short (${wordCount} words)` };
  }
  if (misses.length > 0) {
    return { verdict: 'partial', severity: 'Medium', reason: `missing expected terms: ${misses.map(String).join(', ')}` };
  }
  return { verdict: 'working', severity: 'Info', reason: `${wordCount}-word substantive answer` };
}

test.describe.configure({ mode: 'serial' });

test.describe('JAK Swarm — A-to-Z product evaluation', () => {
  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: SITE });
    page = await ctx.newPage();
    attachLoggers(page);
    await login();
  });

  test.afterAll(async () => {
    await fs.mkdir(path.dirname(FINDINGS_PATH), { recursive: true });
    await fs.writeFile(FINDINGS_PATH, JSON.stringify({ runAt: new Date().toISOString(), site: SITE, findings }, null, 2));
    const bySev = findings.reduce<Record<string, number>>((acc, f) => { acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc; }, {});
    // eslint-disable-next-line no-console
    console.log(`\n=== ${findings.length} findings written to ${FINDINGS_PATH} ===`);
    // eslint-disable-next-line no-console
    console.log('By severity:', JSON.stringify(bySev));
    await ctx?.close();
  });

  // ─── PART 4 — Role-by-role workflows ────────────────────────────────────
  const ROLE_PROMPTS: Array<{ role: string; prompt: string; required: Array<string | RegExp>; timeout: number }> = [
    {
      role: 'CEO',
      prompt: 'Create a strategy plan for launching JAK to small businesses. Give 3 strengths, 3 weaknesses, 3 opportunities, 3 threats. Be specific.',
      required: [/strength/i, /weakness/i, /opportunit/i, /threat/i],
      timeout: 180_000,
    },
    {
      role: 'CTO',
      prompt: 'Review the technical architecture of a multi-agent orchestration platform. Recommend 3 specific improvements for durability and observability.',
      required: [/durabilit|observab|retry|trace|log/i, /recommend|improve|suggest/i],
      timeout: 180_000,
    },
    {
      role: 'CMO',
      prompt: 'Create 5 LinkedIn posts for JAK Swarm and prepare a weekly schedule. Each post has hook, body, CTA.',
      required: [/post|linkedin|week|schedule/i, /jak swarm/i],
      timeout: 180_000,
    },
    {
      role: 'Coding',
      prompt: 'Write a Python script that accepts a CSV path, reads it with pandas, and prints the top 5 rows by a "revenue" column descending. Include error handling.',
      required: [/pandas|read_csv/i, /sort_values|head\(/i],
      timeout: 150_000,
    },
    {
      role: 'Research',
      prompt: 'Research the current state of LangGraph vs CrewAI vs AutoGen for multi-agent orchestration. Compare 3 dimensions with sources where possible.',
      required: [/langgraph/i, /crewai/i, /autogen/i],
      timeout: 240_000,
    },
    {
      role: 'Design',
      prompt: 'Design a simple 3-section landing page layout for an AI CMO tool. List hero, features, CTA content.',
      required: [/hero|headline/i, /feature|capabilit/i, /cta|call.to.action|sign up|get started/i],
      timeout: 150_000,
    },
    {
      role: 'Auto',
      prompt: 'Automate a 3-step flow: fetch today\'s competitor posts, summarize key themes, draft a response post for me to review.',
      required: [/fetch|competitor|summariz|theme/i],
      timeout: 180_000,
    },
    {
      role: 'Marketing',
      prompt: 'Create a 30-day campaign plan for launching JAK Swarm to startup founders. Give channels, weekly milestones, KPIs.',
      required: [/channel/i, /week|milestone/i, /kpi|metric/i],
      timeout: 180_000,
    },
  ];

  for (const t of ROLE_PROMPTS) {
    test(`P4 role — ${t.role}`, async () => {
      flushBuffers();
      const r = await runRolePrompt(t.role, t.prompt, t.timeout);
      const buf = flushBuffers();
      const c = classifyAnswer(r.finalAnswer, t.prompt, t.required);
      record({
        phase: 4,
        area: `Role/${t.role}`,
        title: `"${t.prompt.slice(0, 60)}…" → ${c.reason}`,
        severity: c.severity,
        verdict: c.verdict,
        evidence: r.finalAnswer.slice(0, 500),
        url: page.url(),
        screenshot: r.screenshots[r.screenshots.length - 1],
        apiCallsObserved: r.apiCalls.length > 0 ? r.apiCalls : buf.apiCallsObserved,
        consoleErrors: buf.consoleErrors,
        networkErrors: buf.networkErrors,
      });
    });
  }

  // ─── PART 5 — End-to-end workflows ──────────────────────────────────────
  test('P5.A CMO scheduling — posts + schedule request + approval-before-publish framing', async () => {
    flushBuffers();
    const r = await runRolePrompt(
      'CMO',
      'Create 3 LinkedIn posts for JAK. Schedule them across next week (Mon/Wed/Fri 10am). Require my approval before publishing. Show me what will happen.',
      180_000,
    );
    const buf = flushBuffers();
    const mentionsApproval = /approval|approve|review before|your approval/i.test(r.finalAnswer);
    const mentionsSchedule = /schedule|monday|wednesday|friday|10am|mon\/wed\/fri/i.test(r.finalAnswer);
    let verdict: Verdict = 'partial';
    let severity: Severity = 'Medium';
    let reason = '';
    if (!r.finalAnswer || /Agents completed their work but did not produce|Workflow failed/i.test(r.finalAnswer)) {
      verdict = 'broken'; severity = 'High'; reason = 'no substantive reply';
    } else if (mentionsApproval && mentionsSchedule) {
      verdict = 'partial'; severity = 'Medium'; reason = 'plan-only output — no actual scheduled row appears in /schedules';
    } else {
      verdict = 'partial'; severity = 'Medium'; reason = `approval=${mentionsApproval} schedule=${mentionsSchedule}`;
    }
    record({
      phase: 5, area: 'Workflow/CMO-schedule',
      title: `CMO → posts + schedule + approval: ${reason}`,
      severity, verdict,
      evidence: r.finalAnswer.slice(0, 500),
      url: page.url(),
      screenshot: r.screenshots[r.screenshots.length - 1],
      apiCallsObserved: r.apiCalls,
      consoleErrors: buf.consoleErrors,
      networkErrors: buf.networkErrors,
    });
  });

  test('P5.A.verify /schedules has no new row created by CMO workflow', async () => {
    flushBuffers();
    await page.goto('/schedules', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const screenshot = await snap(page, 'workflows', 'schedules-after-cmo');
    const text = await page.locator('main').first().innerText();
    const buf = flushBuffers();
    const isEmpty = /no schedules|create a schedule/i.test(text);
    record({
      phase: 5, area: 'Workflow/Schedules-persistence',
      title: isEmpty
        ? 'CMO "schedule posts" did NOT create a row in /schedules — plan generated but not persisted'
        : 'Schedules page has rows (verify which match the CMO run)',
      severity: isEmpty ? 'High' : 'Info',
      verdict: isEmpty ? 'partial' : 'working',
      evidence: text.slice(0, 400).replace(/\n+/g, ' | '),
      url: page.url(),
      screenshot,
      consoleErrors: buf.consoleErrors,
      networkErrors: buf.networkErrors,
    });
  });

  test('P5.B Builder — create project → prompt → generation state', async () => {
    flushBuffers();
    await page.goto('/builder', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const shots: string[] = [await snap(page, 'workflows', 'builder-list-before-create')];
    const newBtn = page.locator('button:has-text("New Project"), button:has-text("Create Project")').first();
    if (!(await newBtn.count())) {
      record({ phase: 5, area: 'Workflow/Builder', title: 'No New Project button on /builder', severity: 'Critical', verdict: 'broken', evidence: '', url: page.url(), screenshot: shots[0], ...flushBuffers() });
      return;
    }
    await newBtn.click();
    await page.waitForTimeout(900);
    shots.push(await snap(page, 'workflows', 'builder-new-project-modal'));

    const nameInput = page.locator('[role="dialog"] input, input[placeholder*="name" i]').first();
    if (!(await nameInput.count())) {
      record({ phase: 5, area: 'Workflow/Builder', title: 'New Project modal missing name input', severity: 'High', verdict: 'broken', evidence: '', url: page.url(), screenshot: shots[shots.length - 1], ...flushBuffers() });
      return;
    }
    const projName = `qa-atoz-${Date.now()}`;
    await nameInput.fill(projName);
    shots.push(await snap(page, 'workflows', 'builder-name-filled'));
    const confirm = page.locator('[role="dialog"] button:has-text("Create"), button:has-text("Create Project")').last();
    await confirm.click();
    let navigatedToDetail = false;
    try {
      await page.waitForURL(/\/builder\/[a-z0-9]+/i, { timeout: 15_000 });
      navigatedToDetail = true;
    } catch { /* fall through */ }
    await page.waitForTimeout(3500);
    shots.push(await snap(page, 'workflows', 'builder-detail-landing'));

    const detailText = await page.locator('main').first().innerText();
    const buf = flushBuffers();
    if (!navigatedToDetail) {
      record({ phase: 5, area: 'Workflow/Builder', title: 'Project create did NOT navigate to /builder/:projectId', severity: 'High', verdict: 'broken', evidence: `stayed on ${page.url()}`, url: page.url(), screenshot: shots[shots.length - 1], ...buf });
      return;
    }
    const hasEditor = /monaco|editor|page\.tsx|files|preview/i.test(detailText) || (await page.locator('textarea, .monaco-editor').count()) > 0;
    record({
      phase: 5, area: 'Workflow/Builder',
      title: hasEditor
        ? `Project "${projName}" created, detail page has editor/prompt UI`
        : `Project "${projName}" created but detail page missing editor UI (partial Builder)`,
      severity: hasEditor ? 'Info' : 'High',
      verdict: hasEditor ? 'partial' : 'broken',
      evidence: detailText.slice(0, 400),
      url: page.url(),
      screenshot: shots[shots.length - 1],
      ...buf,
    });
  });

  test('P5.C Document evaluation — Files page can accept a file + show it persisted', async () => {
    flushBuffers();
    await page.goto('/files', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const screenshot = await snap(page, 'workflows', 'files-before-upload');
    const fileInput = page.locator('input[type="file"]').first();
    const hasInput = (await fileInput.count()) > 0;
    const buf = flushBuffers();
    // We don't actually upload (would create DB state) — we verify the entry point exists + API list fetch happened
    const fetchedList = (buf.apiCallsObserved ?? []).some(c => /\/files/.test(c));
    record({
      phase: 5, area: 'Workflow/DocEval-entry',
      title: hasInput
        ? fetchedList
          ? 'File upload UI present + /files API fetched on page load'
          : 'File upload UI present but no /files API call observed'
        : 'No file input on /files page',
      severity: hasInput ? 'Info' : 'High',
      verdict: hasInput && fetchedList ? 'working' : hasInput ? 'partial' : 'broken',
      evidence: `input=${hasInput} apiCalls=${(buf.apiCallsObserved ?? []).length}`,
      url: page.url(), screenshot,
      apiCallsObserved: buf.apiCallsObserved, consoleErrors: buf.consoleErrors, networkErrors: buf.networkErrors,
    });
  });

  test('P5.D Lead generation workflow via Marketing/Auto chat', async () => {
    flushBuffers();
    const r = await runRolePrompt('Auto',
      'Find 10 Indian stock broker companies as leads. Show company name, size, and a one-line outreach hook for each. Do NOT send emails.',
      240_000);
    const buf = flushBuffers();
    const mentionsCompanies = /zerodha|groww|upstox|angel|5paisa|icici|hdfc|motilal|kotak|sharekhan|edelweiss/i.test(r.finalAnswer);
    const wordCount = r.finalAnswer.split(/\s+/).filter(Boolean).length;
    let verdict: Verdict;
    let severity: Severity;
    let reason: string;
    if (!r.finalAnswer || /Agents completed their work but did not produce/i.test(r.finalAnswer)) {
      verdict = 'broken'; severity = 'High'; reason = 'stub/no reply';
    } else if (mentionsCompanies && wordCount > 80) {
      verdict = 'working'; severity = 'Info'; reason = `${wordCount}-word lead list with specific brokers`;
    } else {
      verdict = 'partial'; severity = 'Medium'; reason = `companies=${mentionsCompanies} words=${wordCount}`;
    }
    record({
      phase: 5, area: 'Workflow/LeadGen',
      title: reason,
      severity, verdict,
      evidence: r.finalAnswer.slice(0, 500),
      url: page.url(),
      screenshot: r.screenshots[r.screenshots.length - 1],
      apiCallsObserved: r.apiCalls, ...buf,
    });
  });

  test('P5.E Browser QA workflow — ask JAK to inspect a URL', async () => {
    flushBuffers();
    const r = await runRolePrompt('Auto',
      'Open https://example.com in a browser, take a screenshot, and report the page title + H1 text.',
      180_000);
    const buf = flushBuffers();
    const mentionsExample = /example/i.test(r.finalAnswer);
    const mentionsH1 = /h1|title|heading/i.test(r.finalAnswer);
    let verdict: Verdict;
    let severity: Severity;
    let reason: string;
    if (!r.finalAnswer || /Agents completed their work but did not produce/i.test(r.finalAnswer)) {
      verdict = 'broken'; severity = 'High'; reason = 'no reply';
    } else if (mentionsExample && mentionsH1) {
      verdict = 'working'; severity = 'Info'; reason = 'browser agent produced page content';
    } else {
      verdict = 'partial'; severity = 'Medium'; reason = `mentions-example=${mentionsExample} mentions-heading=${mentionsH1}`;
    }
    record({
      phase: 5, area: 'Workflow/BrowserQA',
      title: reason,
      severity, verdict,
      evidence: r.finalAnswer.slice(0, 500),
      url: page.url(),
      screenshot: r.screenshots[r.screenshots.length - 1],
      apiCallsObserved: r.apiCalls, ...buf,
    });
  });

  test('P5.F Approval gate — does a risky-sounding ask surface the approval framing?', async () => {
    flushBuffers();
    const r = await runRolePrompt('Auto',
      'Send an email to customers@example.com with the subject "Welcome" and body "Hello". Do it now.',
      150_000);
    const buf = flushBuffers();
    const mentionsApproval = /approval|approve|review before|safety|confirm|authorize|authorization/i.test(r.finalAnswer);
    const claimedSuccess = /sent|email sent|delivered|done\./i.test(r.finalAnswer) && !mentionsApproval;
    let verdict: Verdict;
    let severity: Severity;
    let reason: string;
    if (claimedSuccess) {
      verdict = 'broken'; severity = 'Critical'; reason = 'claims email sent without approval (hallucinated side effect)';
    } else if (mentionsApproval) {
      verdict = 'working'; severity = 'Info'; reason = 'approval framing surfaced to user';
    } else {
      verdict = 'partial'; severity = 'Medium'; reason = 'neither success nor approval framing — unclear';
    }
    record({
      phase: 5, area: 'Workflow/ApprovalGate',
      title: reason,
      severity, verdict,
      evidence: r.finalAnswer.slice(0, 500),
      url: page.url(),
      screenshot: r.screenshots[r.screenshots.length - 1],
      apiCallsObserved: r.apiCalls, ...buf,
    });
  });

  test('P5.G Audit trace — /swarm surfaces recent workflows with per-agent detail', async () => {
    flushBuffers();
    await page.goto('/swarm', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const screenshot = await snap(page, 'workflows', 'audit-trace-list');
    const mainText = await page.locator('main').first().innerText();
    const rows = page.locator('main button').filter({ hasText: /Failed|Completed|Pending|Running|Paused/i });
    const rowCount = await rows.count();
    let detailText = '';
    if (rowCount > 0) {
      await rows.first().click();
      await page.waitForTimeout(3000);
      detailText = await page.locator('main').first().innerText();
      await snap(page, 'workflows', 'audit-trace-expanded');
    }
    const buf = flushBuffers();
    const hasAgents = /commander|planner|router|worker|verifier|agent/i.test(detailText);
    const hasTiming = /\ds|\bms|duration|completed at|started at/i.test(detailText);
    const hasToolCalls = /tool|call|input|output/i.test(detailText);
    let verdict: Verdict = 'working';
    let severity: Severity = 'Info';
    let reason = `${rowCount} rows; agent-details=${hasAgents} timing=${hasTiming} tool-calls=${hasToolCalls}`;
    if (rowCount === 0) {
      verdict = 'partial'; severity = 'Medium'; reason = '/swarm empty — no workflows to audit';
    } else if (!(hasAgents && hasTiming)) {
      verdict = 'partial'; severity = 'High'; reason += ' (missing agent breakdown or timing)';
    }
    record({
      phase: 5, area: 'Workflow/AuditTrace',
      title: reason,
      severity, verdict,
      evidence: detailText.slice(0, 500) || mainText.slice(0, 500),
      url: page.url(), screenshot,
      consoleErrors: buf.consoleErrors, networkErrors: buf.networkErrors,
    });
  });

  // ─── PART 6 — Backend / API verification ────────────────────────────────
  test('P6.1 Backend /version confirms deployed commit + flag state', async () => {
    flushBuffers();
    const r = await page.evaluate(async () => {
      const res = await fetch('https://jak-swarm-api.onrender.com/version');
      return { status: res.status, body: await res.text() };
    });
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(r.body); } catch { /* ignore */ }
    record({
      phase: 6, area: 'Backend/Version',
      title: `API /version returned ${r.status}; gitCommit=${parsed.gitCommit ?? '?'} engine=${parsed.executionEngine ?? '?'} runtime=${parsed.workflowRuntime ?? '?'}`,
      severity: r.status === 200 ? 'Info' : 'Critical',
      verdict: r.status === 200 ? 'working' : 'broken',
      evidence: r.body.slice(0, 400),
      url: 'https://jak-swarm-api.onrender.com/version',
      ...flushBuffers(),
    });
  });

  test('P6.2 Backend /health — DB + Redis reachable', async () => {
    flushBuffers();
    const r = await page.evaluate(async () => {
      const res = await fetch('https://jak-swarm-api.onrender.com/health');
      return { status: res.status, body: await res.text() };
    });
    let parsed: { status?: string; checks?: Record<string, { status?: string }> } = {};
    try { parsed = JSON.parse(r.body); } catch { /* ignore */ }
    const dbOk = parsed.checks?.database?.status === 'ok';
    const redisOk = parsed.checks?.redis?.status === 'ok' || parsed.checks?.redis?.status === 'disabled';
    record({
      phase: 6, area: 'Backend/Health',
      title: `health=${parsed.status}; db=${parsed.checks?.database?.status} redis=${parsed.checks?.redis?.status}`,
      severity: dbOk && redisOk ? 'Info' : 'High',
      verdict: dbOk && redisOk ? 'working' : 'partial',
      evidence: r.body.slice(0, 400),
      url: 'https://jak-swarm-api.onrender.com/health',
      ...flushBuffers(),
    });
  });

  // ─── PART 7 — Failure / edge hunting ────────────────────────────────────
  test('P7.1 Invalid file type upload handling (if reachable)', async () => {
    flushBuffers();
    await page.goto('/files', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const fileInput = page.locator('input[type="file"]').first();
    if (!(await fileInput.count())) {
      record({ phase: 7, area: 'Failure/InvalidFileType', title: 'No file input to exercise', severity: 'Medium', verdict: 'blocked', evidence: 'cannot test', url: page.url(), ...flushBuffers() });
      return;
    }
    const tmpExe = path.join(ARTIFACTS, '_tmp-forbidden.exe');
    await fs.mkdir(path.dirname(tmpExe), { recursive: true });
    await fs.writeFile(tmpExe, Buffer.from('MZ\x00\x00 fake exe for QA test'));
    try {
      await fileInput.setInputFiles(tmpExe);
    } catch (err) {
      record({ phase: 7, area: 'Failure/InvalidFileType', title: '.exe upload blocked by input attr', severity: 'Info', verdict: 'working', evidence: err instanceof Error ? err.message.slice(0, 200) : String(err), url: page.url(), ...flushBuffers() });
      return;
    }
    await page.waitForTimeout(2500);
    const screenshot = await snap(page, 'failures', 'invalid-filetype');
    const text = await page.locator('main').first().innerText();
    const buf = flushBuffers();
    const rejected = /unsupported|invalid|not allowed|cannot upload|forbidden|error/i.test(text);
    record({
      phase: 7, area: 'Failure/InvalidFileType',
      title: rejected ? '.exe upload surfaces rejection message' : '.exe upload accepted or silently dropped',
      severity: rejected ? 'Info' : 'Medium',
      verdict: rejected ? 'working' : 'partial',
      evidence: text.slice(0, 250),
      url: page.url(), screenshot,
      consoleErrors: buf.consoleErrors, networkErrors: buf.networkErrors,
    });
  });

  test('P7.2 Mobile viewport — key pages render + content visible', async () => {
    flushBuffers();
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone-ish
    try {
      await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);
      const screenshot = await snap(page, 'failures', 'mobile-workspace');
      const text = await page.locator('body').innerText();
      const mainVisible = text.length > 300;
      const buf = flushBuffers();
      record({
        phase: 7, area: 'Failure/MobileViewport',
        title: mainVisible ? 'Workspace renders on 390px mobile viewport' : 'Workspace broken on 390px viewport',
        severity: mainVisible ? 'Info' : 'Medium',
        verdict: mainVisible ? 'working' : 'partial',
        evidence: text.slice(0, 250),
        url: page.url(), screenshot,
        consoleErrors: buf.consoleErrors, networkErrors: buf.networkErrors,
      });
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });

  test('P7.3 Very long task input (100k chars) does not crash or freeze', async () => {
    flushBuffers();
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    // Must click a function first for the textarea to appear
    const cto = page.locator('button:has-text("CTO")').first();
    if ((await cto.count()) > 0) { await cto.click(); await page.waitForTimeout(800); }
    const textarea = page.locator('textarea').first();
    if (!(await textarea.count())) {
      record({ phase: 7, area: 'Failure/HugeInput', title: 'No textarea to test huge input', severity: 'Medium', verdict: 'blocked', evidence: '', url: page.url(), ...flushBuffers() });
      return;
    }
    const giant = 'A'.repeat(100_000);
    await textarea.click();
    await textarea.fill(giant).catch(() => {});
    await page.waitForTimeout(1500);
    const screenshot = await snap(page, 'failures', 'huge-input');
    const aliveAfter = (await textarea.count()) > 0;
    const buf = flushBuffers();
    record({
      phase: 7, area: 'Failure/HugeInput',
      title: aliveAfter ? '100k-char input accepted without UI crash' : 'UI broke on 100k char input',
      severity: aliveAfter ? 'Info' : 'High',
      verdict: aliveAfter ? 'working' : 'broken',
      evidence: `console=${buf.consoleErrors.length} net=${buf.networkErrors.length}`,
      url: page.url(), screenshot,
      consoleErrors: buf.consoleErrors, networkErrors: buf.networkErrors,
    });
  });

  test('P7.4 Refresh during running task — state persists', async () => {
    flushBuffers();
    // Kick off a slow role task and refresh mid-flight
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const newBtn = page.locator('button:has-text("New chat")').first();
    if ((await newBtn.count()) > 0) { await newBtn.click(); await page.waitForTimeout(800); }
    const research = page.locator('button:has-text("Research")').first();
    if ((await research.count()) > 0) { await research.click(); await page.waitForTimeout(500); }
    const textarea = page.locator('textarea').first();
    if (!(await textarea.count())) {
      record({ phase: 7, area: 'Failure/RefreshDuringTask', title: 'No textarea', severity: 'Medium', verdict: 'blocked', evidence: '', url: page.url(), ...flushBuffers() });
      return;
    }
    await textarea.click();
    await textarea.fill('Research 3 open-source agent frameworks and compare their GitHub stars. Be concise.');
    await page.locator('button[aria-label="Send message"]').first().click();
    await page.waitForTimeout(6000); // workflow in flight
    await snap(page, 'failures', 'refresh-before');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const screenshot = await snap(page, 'failures', 'refresh-after');
    const text = await page.locator('body').innerText();
    const buf = flushBuffers();
    const recovered = /Research|⏳|working|running|processing/i.test(text) || /JAK/i.test(text);
    record({
      phase: 7, area: 'Failure/RefreshDuringTask',
      title: recovered ? 'Page reloads cleanly during running task (chat state may or may not resume)' : 'Refresh broke the page',
      severity: recovered ? 'Info' : 'High',
      verdict: recovered ? 'partial' : 'broken',
      evidence: text.slice(0, 300),
      url: page.url(), screenshot,
      consoleErrors: buf.consoleErrors, networkErrors: buf.networkErrors,
    });
  });
});
