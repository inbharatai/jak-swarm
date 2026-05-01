/**
 * Human QA — A-Z product audit (rigorous version).
 *
 * Each page now has SPECIFIC content checks, primary-action verification,
 * and where applicable an interaction test. A "page renders" check is
 * the weakest evidence; I want the score to reflect whether a buyer
 * could actually USE the page.
 */

import { test, expect, chromium } from '@playwright/test';
import { HumanQATesterAgent, newQAContext, type QATargetSpec } from '../human-qa/HumanQATesterAgent.js';

test.describe.configure({ mode: 'serial' });

test('Human QA — A-Z product audit (rigorous)', async () => {
  test.setTimeout(900_000);

  const browser = await chromium.launch({ headless: process.env['PWHEADLESS'] !== '0' });
  const context = await newQAContext(browser);

  const warmup = await context.newPage();
  await warmup.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 60_000 });
  await warmup.waitForTimeout(2500);
  await warmup.close();

  const targets: QATargetSpec[] = [
    // ─── PUBLIC ──────────────────────────────────────────────────────
    {
      name: 'landing',
      url: 'http://localhost:3000/',
      run: async (qa) => {
        await qa.inspectOnboardingClarity();
        await qa.inspectTrustSignals({ requirePricingLink: true, requireGitHubLink: true, requireContactLink: true });
        await qa.observeSection('hero', { selector: 'section.gradient-bg', expectedText: /Give JAK a task/i, expectMinChars: 200, checkDescenderClipping: true });
        await qa.observeSection('pain', { selector: 'section[aria-label*="Why chat" i]', expectedText: /AI chat gives answers/i });
        await qa.observeSection('how-it-works', { selector: '#how-it-works', expectedText: /Seven steps/i });
        await qa.observeSection('cockpit-mockup', { selector: '#cockpit', expectedText: /one operating surface/i });
        await qa.observeSection('outcomes', { selector: '#outcomes', expectedText: /Finished work/i });
        await qa.observeSection('trust', { selector: '#trust', expectedText: /controlled autonomy/i });
        await qa.observeSection('audit', { selector: '#audit', expectedText: /Enterprise-grade/i });
        await qa.observeSection('pricing', { selector: '#pricing', expectedText: /Transparent/i });
        await qa.checkResponsive();
        await qa.checkHealth();
      },
    },
    {
      name: 'register',
      url: 'http://localhost:3000/register',
      run: async (qa, page) => {
        await page.waitForTimeout(2000);
        await qa.observeSection('register-form', { selector: 'form', expectMinChars: 30 });
        // Required form fields
        const emailInput = await page.locator('input[type="email"]').first().count();
        if (emailInput === 0) {
          qa.add({ section: 'register-form', expected: 'email input present', actual: 'no input[type=email]', severity: 'CRITICAL', category: 'functionality', status: 'not-implemented', suggestedFix: 'Add an email input to the register form' });
        }
        const submitBtn = await page.locator('button[type="submit"]').first().count();
        if (submitBtn === 0) {
          qa.add({ section: 'register-form', expected: 'submit button present', actual: 'no button[type=submit]', severity: 'CRITICAL', category: 'functionality', status: 'not-implemented', suggestedFix: 'Add a submit button' });
        }
        await qa.checkHealth();
      },
    },
    {
      name: 'login',
      url: 'http://localhost:3000/login',
      run: async (qa, page) => {
        await page.waitForTimeout(2000);
        await qa.observeSection('login-form', { selector: 'form', expectMinChars: 30 });
        const emailInput = await page.locator('input[type="email"]').first().count();
        const submitBtn = await page.locator('button[type="submit"]').first().count();
        if (emailInput === 0 || submitBtn === 0) {
          qa.add({ section: 'login-form', expected: 'email + submit', actual: `email=${emailInput}, submit=${submitBtn}`, severity: 'CRITICAL', category: 'functionality', status: 'not-implemented', suggestedFix: 'Both required for login' });
        }
        // Magic-link option as a trust signal
        const magicLink = await page.locator('a[href*="magic"], button:has-text("magic")').first().count();
        if (magicLink === 0) {
          qa.note({ observation: 'No magic-link login option visible — passwordless is a buyer trust signal worth adding', category: 'UX' });
        }
        await qa.checkHealth();
      },
    },

    // ─── DASHBOARD ───────────────────────────────────────────────────
    {
      name: 'workspace',
      url: 'http://localhost:3000/workspace',
      run: async (qa, page) => {
        await page.waitForTimeout(3500);
        // The workspace is the main cockpit. A buyer expects: chat input,
        // recent runs / empty state, and a way to start a new workflow.
        const chatInput = await page.locator('textarea, input[type="text"], [contenteditable="true"]').count();
        if (chatInput === 0) {
          qa.add({ section: 'workspace-input', expected: 'chat / command input', actual: 'no input element found', severity: 'HIGH', category: 'functionality', status: 'present-but-not-wired', suggestedFix: 'Workspace must have a chat input — this is the primary action' });
        } else {
          qa.note({ observation: `Workspace has ${chatInput} input element(s)`, category: 'UX' });
        }
        // Verify cockpit nav / sidebar exists
        const nav = await page.locator('nav, aside').count();
        if (nav === 0) {
          qa.add({ section: 'workspace-nav', expected: 'nav or sidebar visible', actual: 'absent', severity: 'HIGH', category: 'UX', status: 'partially-working', suggestedFix: 'Add a sidebar / nav so the user can move between dashboard surfaces' });
        }
        await qa.observeSection('workspace-page', { selector: 'main' });
        await qa.checkHealth();
      },
    },
    {
      name: 'social-drafts',
      url: 'http://localhost:3000/social-drafts',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('social-drafts-initial', { selector: 'main' });
        // Required: 4 platform pickers + topic input + generate button
        const linkedinBtn = await page.locator('[data-testid="social-draft-platform-linkedin"]').count();
        const topicInput = await page.locator('[data-testid="social-draft-topic-input"]').count();
        const generateBtn = await page.locator('[data-testid="social-draft-generate-btn"]').count();
        if (linkedinBtn === 0 || topicInput === 0 || generateBtn === 0) {
          qa.add({ section: 'social-drafts-form', expected: 'platform picker + topic input + generate button', actual: `linkedin=${linkedinBtn}, topic=${topicInput}, generate=${generateBtn}`, severity: 'CRITICAL', category: 'functionality', status: 'not-implemented', suggestedFix: 'Form elements are required for the primary flow' });
          await qa.checkHealth();
          return;
        }
        await qa.hoverThenClick('[data-testid="social-draft-platform-linkedin"]');
        await qa.fillSlowly('[data-testid="social-draft-topic-input"]', 'AI agents');
        await qa.observeNetworkAfter(
          async () => { await qa.hoverThenClick('[data-testid="social-draft-generate-btn"]'); },
          { urlMatch: /\/social-drafts/, methodMatch: 'POST', expectedStatusOk: true },
        );
        // Did the result card appear?
        const resultCard = await page.locator('[data-testid="social-draft-result-card"]').isVisible().catch(() => false);
        if (!resultCard) {
          qa.add({ section: 'social-drafts-result', expected: 'result card visible after Generate', actual: 'result card not visible', severity: 'HIGH', category: 'functionality', status: 'present-but-not-wired', suggestedFix: 'API responded but UI did not render the result card' });
        } else {
          qa.note({ observation: 'Result card rendered after Generate — full happy path works', category: 'UX' });
        }
        await qa.checkHealth();
      },
    },
    {
      name: 'tool-installer',
      url: 'http://localhost:3000/tool-installer',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('tool-installer-initial', { selector: 'main' });
        const taskInput = await page.locator('[data-testid="tool-installer-task-input"]').count();
        const detectBtn = await page.locator('[data-testid="tool-installer-detect-btn"]').count();
        if (taskInput === 0 || detectBtn === 0) {
          qa.add({ section: 'tool-installer-form', expected: 'task input + detect button', actual: `input=${taskInput}, detect=${detectBtn}`, severity: 'CRITICAL', category: 'functionality', status: 'not-implemented', suggestedFix: 'Required for primary flow' });
          await qa.checkHealth();
          return;
        }
        await qa.fillSlowly('[data-testid="tool-installer-task-input"]', 'I need a PDF parser');
        await qa.observeNetworkAfter(
          async () => { await qa.hoverThenClick('[data-testid="tool-installer-detect-btn"]'); },
          { urlMatch: /\/tool-installer/, methodMatch: 'POST', expectedStatusOk: true },
        );
        // Requirements card should appear with the detected tool
        const reqCard = await page.locator('[data-testid="tool-installer-requirements-card"]').isVisible().catch(() => false);
        if (!reqCard) {
          qa.add({ section: 'tool-installer-result', expected: 'requirements card after detect', actual: 'absent', severity: 'HIGH', category: 'functionality', status: 'present-but-not-wired', suggestedFix: 'Detect API responded but UI did not render the requirements card' });
        }
        await qa.checkHealth();
      },
    },
    {
      name: 'standing-orders',
      url: 'http://localhost:3000/standing-orders',
      run: async (qa, page) => {
        await page.waitForTimeout(2000);
        await qa.observeSection('standing-orders-page', { selector: 'main' });
        const heading = await page.locator('h1, h2').first().innerText().catch(() => '');
        if (!/standing order/i.test(heading)) {
          qa.add({ section: 'standing-orders-heading', expected: 'heading mentions Standing Orders', actual: heading.slice(0, 80), severity: 'MEDIUM', category: 'copy', status: 'partially-working', suggestedFix: 'Heading should orient the user' });
        }
        // Empty state or list
        const bodyText = (await page.locator('main').innerText().catch(() => '')) || '';
        if (bodyText.length < 50) {
          qa.add({ section: 'standing-orders-content', expected: 'page has visible content', actual: `${bodyText.length} chars`, severity: 'MEDIUM', category: 'UX', status: 'partially-working', suggestedFix: 'Show empty state copy or list view' });
        }
        await qa.checkHealth();
      },
    },
    {
      name: 'audit',
      url: 'http://localhost:3000/audit',
      run: async (qa, page) => {
        await page.waitForTimeout(2000);
        await qa.observeSection('audit-page', { selector: 'main' });
        const heading = await page.locator('h1, h2').first().innerText().catch(() => '');
        if (!/audit|compliance|control|evidence/i.test(heading)) {
          qa.add({ section: 'audit-heading', expected: 'audit-related heading', actual: heading.slice(0, 80), severity: 'MEDIUM', category: 'copy', status: 'partially-working', suggestedFix: 'Heading should orient the user to audit/compliance' });
        }
        // Tabs are an audit-page convention
        const tabs = await page.locator('[role="tab"], button[aria-selected]').count();
        qa.note({ observation: `Audit page has ${tabs} tab(s)`, category: 'UX' });
        await qa.checkHealth();
      },
    },
    {
      name: 'integrations',
      url: 'http://localhost:3000/integrations',
      run: async (qa, page) => {
        await page.waitForTimeout(2000);
        await qa.observeSection('integrations-page', { selector: 'main' });
        // Should show a grid of connectors
        const cards = await page.locator('[role="button"], button:has-text("Connect"), .grid > div').count();
        if (cards === 0) {
          qa.add({ section: 'integrations-grid', expected: 'integration / connector cards', actual: 'no cards visible', severity: 'HIGH', category: 'functionality', status: 'present-but-not-wired', suggestedFix: 'Show the grid of available connectors' });
        } else {
          qa.note({ observation: `Integrations page shows ${cards} clickable card(s)`, category: 'UX' });
        }
        await qa.checkHealth();
      },
    },
    {
      name: 'knowledge',
      url: 'http://localhost:3000/knowledge',
      run: async (qa, page) => {
        await page.waitForTimeout(2000);
        await qa.observeSection('knowledge-page', { selector: 'main' });
        const upload = await page.locator('input[type="file"], button:has-text("Upload"), button:has-text("Add")').count();
        if (upload === 0) {
          qa.add({ section: 'knowledge-upload', expected: 'document upload affordance', actual: 'no upload button / file input', severity: 'MEDIUM', category: 'UX', status: 'partially-working', suggestedFix: 'Knowledge base needs an upload action' });
        }
        await qa.checkHealth();
      },
    },
    {
      name: 'skills',
      url: 'http://localhost:3000/skills',
      run: async (qa, page) => {
        await page.waitForTimeout(2000);
        await qa.observeSection('skills-page', { selector: 'main' });
        const heading = await page.locator('h1, h2').first().innerText().catch(() => '');
        if (!/skill/i.test(heading)) {
          qa.add({ section: 'skills-heading', expected: 'heading mentions Skills', actual: heading.slice(0, 80), severity: 'MEDIUM', category: 'copy', status: 'partially-working', suggestedFix: 'Heading should orient the user' });
        }
        await qa.checkHealth();
      },
    },
    {
      name: 'inbox',
      url: 'http://localhost:3000/inbox',
      run: async (qa, page) => {
        await page.waitForTimeout(2000);
        await qa.observeSection('inbox-page', { selector: 'main' });
        const heading = await page.locator('h1, h2').first().innerText().catch(() => '');
        if (!/inbox|approval|notification/i.test(heading)) {
          qa.add({ section: 'inbox-heading', expected: 'inbox/approval-related heading', actual: heading.slice(0, 80), severity: 'MEDIUM', category: 'copy', status: 'partially-working', suggestedFix: 'Heading should orient the user' });
        }
        await qa.checkHealth();
      },
    },
    {
      name: 'schedules',
      url: 'http://localhost:3000/schedules',
      run: async (qa, page) => {
        await page.waitForTimeout(2000);
        await qa.observeSection('schedules-page', { selector: 'main' });
        const createBtn = await page.locator('button:has-text("Create"), button:has-text("New"), button:has-text("Add")').count();
        if (createBtn === 0) {
          qa.add({ section: 'schedules-action', expected: 'create-schedule button', actual: 'no create action visible', severity: 'MEDIUM', category: 'UX', status: 'partially-working', suggestedFix: 'Schedules page needs a create button' });
        }
        await qa.checkHealth();
      },
    },
    {
      name: 'traces',
      url: 'http://localhost:3000/traces',
      run: async (qa, page) => {
        await page.waitForTimeout(2000);
        await qa.observeSection('traces-page', { selector: 'main' });
        const heading = await page.locator('h1, h2').first().innerText().catch(() => '');
        if (!/trace|run|execution/i.test(heading)) {
          qa.add({ section: 'traces-heading', expected: 'traces/runs-related heading', actual: heading.slice(0, 80), severity: 'MEDIUM', category: 'copy', status: 'partially-working', suggestedFix: 'Heading should orient the user' });
        }
        await qa.checkHealth();
      },
    },
  ];

  const agent = new HumanQATesterAgent({
    sessionName: 'a-z-audit',
    context,
    targets,
    paceMs: 200,
  });

  const report = await agent.run();
  console.log(`\n══ A-Z AUDIT COMPLETE ══`);
  console.log(`Session score: ${report.sessionScore}/10`);
  console.log(`Buyer verdict: ${report.buyerVerdict}`);
  console.log(`Severity: ${JSON.stringify(report.severityCounts)}`);
  console.log(`Status:   ${JSON.stringify(report.statusCounts)}`);
  console.log(`Per-page scores:`);
  for (const p of report.perPage) {
    const flag = p.score < 8 ? '🔴' : p.score < 9 ? '🟡' : '🟢';
    console.log(`  ${flag} ${p.score}/10  ${p.name.padEnd(22)} — ${p.scoreReason}`);
  }
  console.log(`\nReports at qa/human-qa-reports/a-z-audit/`);

  await context.close();
  await browser.close();
  expect(report.pagesTested.length).toBeGreaterThan(0);
});
