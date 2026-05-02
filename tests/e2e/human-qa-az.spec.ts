/**
 * Human QA — A-Z product audit (deep version).
 *
 * Five priority surfaces (landing / login / register / social-drafts /
 * tool-installer) get FULL 12-category coverage including form
 * validation, loading state, error state, empty state, backend wiring,
 * product-truth, visual quality. They can earn 9-10.
 *
 * The other nine surfaces get the structural sweep only — explicitly
 * capped at 7 by the new scoring rule (< 6 categories tested → cap 7).
 * This is the honest framing the user asked for: do not score 10/10
 * for "heading visible".
 */

import { test, expect, chromium } from '@playwright/test';
import { HumanQATesterAgent, newQAContext, type QATargetSpec } from '../human-qa/HumanQATesterAgent.js';

test.describe.configure({ mode: 'serial' });

test('Human QA — A-Z product audit (deep)', async () => {
  test.setTimeout(900_000);

  const browser = await chromium.launch({ headless: process.env['PWHEADLESS'] !== '0' });
  const context = await newQAContext(browser);

  const warmup = await context.newPage();
  await warmup.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 60_000 });
  await warmup.waitForTimeout(2500);
  await warmup.close();

  const targets: QATargetSpec[] = [
    // ════════════════════════════════════════════════════════════════
    // PRIORITY SURFACES (DEEP — can earn 9-10)
    // ════════════════════════════════════════════════════════════════
    {
      name: 'landing',
      url: 'http://localhost:3000/',
      run: async (qa, page) => {
        // Categories: render-health, console-network, responsive,
        //             primary-interaction (CTA hover), product-truth,
        //             visual-quality, evidence-screenshots
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

        // Primary interaction — hover the hero CTA, verify it points where it claims
        await qa.hoverThenClick('a[href="/register"]', { expectNav: /\/register/ });
        await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        // Visual-quality heuristic across all headings
        await qa.checkVisualQualityHeuristics();

        // Product-truth: 122-tools claim vs README
        await qa.verifyLandingClaim({
          claim: '122 classified tools',
          landingSelector: 'section[aria-label*="Get started" i]',
          landingTextRegex: /122/,
          dashboardCheck: async () => {
            const r = await page.context().request.get('https://raw.githubusercontent.com/inbharatai/jak-swarm/main/README.md').catch(() => null);
            if (!r || !r.ok()) return { ok: false, evidence: 'README not reachable' };
            const text = await r.text();
            const ok = /Classified[_-]Tools[_-]?\d*[_-]?122|122 (?:Classified|Production) Tools/.test(text);
            return { ok, evidence: ok ? 'README badge / headline reads 122' : 'README does not match 122' };
          },
        });

        await qa.checkResponsive();
        await qa.checkHealth();
      },
    },
    {
      name: 'register',
      url: 'http://localhost:3000/register',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('register-form', { selector: 'form', expectMinChars: 30 });

        // form-validation: empty submit
        const submitSelector = 'button[type="submit"]';
        const submitExists = (await page.locator(submitSelector).count()) > 0;
        if (!submitExists) {
          qa.add({
            section: 'register-form', expected: 'submit button present', actual: 'absent',
            severity: 'CRITICAL', category: 'functionality', status: 'not-implemented',
            suggestedFix: 'Add a submit button to the register form',
          });
          await qa.checkHealth();
          return;
        }

        await qa.expectValidationError({
          submitSelector,
          expectErrorRegex: /required|enter|valid|empty|missing/i,
          scenario: 'empty form',
        });

        // form-validation: invalid email
        const emailInput = 'input[type="email"]';
        const emailExists = (await page.locator(emailInput).count()) > 0;
        if (emailExists) {
          await qa.fillSlowly(emailInput, 'not-an-email');
          await qa.expectValidationError({
            submitSelector,
            expectErrorRegex: /valid|invalid|email/i,
            scenario: 'invalid email',
          });
        }

        // empty-state — register has no list, but its initial state IS the empty state
        await qa.expectEmptyState({ selector: 'form', expectCopyRegex: /sign up|create|get started|register/i });

        // backend-wiring — Supabase auth is a real signal even if we don't actually create an account
        // We CAN'T submit a real account create without polluting Supabase prod, so skip the actual backend hit.
        // Mark backend-wiring as explicitly NOT tested (won't claim coverage we don't have).

        await qa.checkResponsive();
        await qa.checkHealth();
      },
    },
    {
      name: 'login',
      url: 'http://localhost:3000/login',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('login-form', { selector: 'form', expectMinChars: 30 });

        const submitSelector = 'button[type="submit"]';
        const submitExists = (await page.locator(submitSelector).count()) > 0;
        if (!submitExists) {
          qa.add({
            section: 'login-form', expected: 'submit button present', actual: 'absent',
            severity: 'CRITICAL', category: 'functionality', status: 'not-implemented',
            suggestedFix: 'Add a submit button',
          });
          await qa.checkHealth();
          return;
        }

        await qa.expectValidationError({
          submitSelector,
          expectErrorRegex: /required|enter|valid|empty|missing/i,
          scenario: 'empty login form',
        });

        const emailInput = 'input[type="email"]';
        if ((await page.locator(emailInput).count()) > 0) {
          await qa.fillSlowly(emailInput, 'invalid');
          await qa.expectValidationError({
            submitSelector,
            expectErrorRegex: /valid|invalid|email/i,
            scenario: 'invalid email',
          });
        }

        await qa.expectEmptyState({ selector: 'form', expectCopyRegex: /sign in|log in|welcome|continue/i });
        await qa.checkResponsive();
        await qa.checkHealth();
      },
    },
    {
      name: 'social-drafts',
      url: 'http://localhost:3000/social-drafts',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('social-drafts-initial', { selector: 'main' });

        // Empty state — page should hint what to do before the user picks anything
        await qa.expectEmptyState({
          selector: 'main',
          expectCopyRegex: /platform|topic|generate|draft|select/i,
        });

        // form-validation — try generating with empty topic
        const generateBtn = '[data-testid="social-draft-generate-btn"]';
        const generateExists = (await page.locator(generateBtn).count()) > 0;
        if (!generateExists) {
          qa.add({
            section: 'social-drafts', expected: 'Generate button present', actual: 'absent',
            severity: 'CRITICAL', category: 'functionality', status: 'not-implemented',
            suggestedFix: 'Required for the primary flow',
          });
          await qa.checkHealth();
          return;
        }
        // Pick LinkedIn first so the platform is set, then verify topic-required
        await qa.hoverThenClick('[data-testid="social-draft-platform-linkedin"]');
        const generateDisabledForEmpty = await page.locator(`${generateBtn}[disabled]`).first().isVisible({ timeout: 1000 }).catch(() => false);
        if (generateDisabledForEmpty) {
          qa.recordCoverage('form-validation', true, 'Generate disabled when topic is empty');
        } else {
          qa.add({
            section: 'social-drafts-validation',
            expected: 'Generate button disabled when topic is empty',
            actual: 'Generate is clickable with empty topic',
            severity: 'MEDIUM',
            category: 'UX',
            status: 'partially-working',
            suggestedFix: 'Disable Generate or surface a "topic required" message',
          });
          qa.recordCoverage('form-validation', false, 'no validation on empty topic');
        }

        // Loading state — fill a topic then click Generate, watch for loading indicator
        await qa.fillSlowly('[data-testid="social-draft-topic-input"]', 'AI agents at scale');
        await qa.expectLoadingState({
          triggerAction: async () => { await qa.hoverThenClick(generateBtn); },
          loadingIndicatorRegex: /loading|generating|sending|please wait/i,
          disabledButtonSelector: generateBtn,
        });

        // Backend wiring + success state — the Generate POST should return 2xx and a result card should appear
        await page.waitForTimeout(3000);
        const resultCard = await page.locator('[data-testid="social-draft-result-card"]').first().isVisible().catch(() => false);
        if (resultCard) {
          qa.recordCoverage('backend-wiring', true, 'POST /social-drafts produced a visible result card');
          // Manual handoff disclosure
          const handoff = (await page.locator('[data-testid="social-draft-handoff"]').first().innerText().catch(() => '')) || '';
          if (/never auto[- ]publish|manual/i.test(handoff)) {
            qa.recordCoverage('product-truth', true, `manual-handoff disclosure visible: "${handoff.slice(0, 80)}"`);
          } else {
            qa.add({
              section: 'social-drafts-handoff', expected: 'manual-handoff disclosure visible',
              actual: handoff.slice(0, 100) || '(no handoff card visible)',
              severity: 'HIGH', category: 'product-truth', status: 'present-but-not-wired',
              suggestedFix: 'Confirm the never-auto-publish disclosure renders post-generate',
            });
            qa.recordCoverage('product-truth', false, 'no manual-handoff disclosure');
          }
        } else {
          qa.add({
            section: 'social-drafts-success', expected: 'result card visible after Generate',
            actual: 'absent', severity: 'HIGH', category: 'functionality', status: 'present-but-not-wired',
            suggestedFix: 'API responded but UI did not render the result card',
          });
          qa.recordCoverage('backend-wiring', false, 'no result card');
        }

        // Visual quality + responsive
        await qa.checkVisualQualityHeuristics();
        await qa.checkResponsive();
        await qa.checkHealth();
      },
    },
    {
      name: 'tool-installer',
      url: 'http://localhost:3000/tool-installer',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('tool-installer-initial', { selector: 'main' });

        await qa.expectEmptyState({
          selector: 'main',
          expectCopyRegex: /task|describe|detect|tool|install/i,
        });

        const detectBtn = '[data-testid="tool-installer-detect-btn"]';
        if ((await page.locator(detectBtn).count()) === 0) {
          qa.add({
            section: 'tool-installer', expected: 'Detect button present', actual: 'absent',
            severity: 'CRITICAL', category: 'functionality', status: 'not-implemented',
            suggestedFix: 'Required for primary flow',
          });
          await qa.checkHealth();
          return;
        }

        // form-validation: empty task — Detect should be disabled or surface a hint
        const detectDisabled = await page.locator(`${detectBtn}[disabled]`).first().isVisible({ timeout: 1000 }).catch(() => false);
        if (detectDisabled) {
          qa.recordCoverage('form-validation', true, 'Detect disabled when task is empty');
        } else {
          qa.add({
            section: 'tool-installer-validation',
            expected: 'Detect disabled when task is empty',
            actual: 'Detect clickable with empty task',
            severity: 'MEDIUM', category: 'UX', status: 'partially-working',
            suggestedFix: 'Disable Detect when task input is empty',
          });
          qa.recordCoverage('form-validation', false, 'no validation on empty task');
        }

        // Loading + backend wiring + success state
        await qa.fillSlowly('[data-testid="tool-installer-task-input"]', 'I need a PDF parser to extract text');
        await qa.expectLoadingState({
          triggerAction: async () => { await qa.hoverThenClick(detectBtn); },
          loadingIndicatorRegex: /loading|detecting|sending/i,
          disabledButtonSelector: detectBtn,
        });

        await page.waitForTimeout(2500);
        const reqCard = await page.locator('[data-testid="tool-installer-requirements-card"]').first().isVisible().catch(() => false);
        if (reqCard) {
          qa.recordCoverage('backend-wiring', true, 'POST /tool-installer/detect produced requirements card');
          // product-truth: requirement card should disclose approval/sandbox safety
          const reqText = (await page.locator('[data-testid="tool-installer-requirements-card"]').first().innerText().catch(() => '')) || '';
          if (/sandbox|approval|reviewer|safe/i.test(reqText)) {
            qa.recordCoverage('product-truth', true, 'safety disclosure visible in requirements card');
          } else {
            qa.add({
              section: 'tool-installer-truth', expected: 'safety disclosure (sandbox / approval / reviewer) in requirements',
              actual: reqText.slice(0, 100), severity: 'HIGH', category: 'product-truth', status: 'present-but-not-wired',
              suggestedFix: 'Surface the sandbox + approval-required disclosure on the detect result',
            });
            qa.recordCoverage('product-truth', false, 'no safety disclosure');
          }
        } else {
          qa.add({
            section: 'tool-installer-success', expected: 'requirements card after Detect',
            actual: 'absent', severity: 'HIGH', category: 'functionality', status: 'present-but-not-wired',
            suggestedFix: 'API responded but UI did not render the requirements card',
          });
          qa.recordCoverage('backend-wiring', false, 'no requirements card');
        }

        await qa.checkVisualQualityHeuristics();
        await qa.checkResponsive();
        await qa.checkHealth();
      },
    },

    // ════════════════════════════════════════════════════════════════
    // STRUCTURAL SURFACES (capped at 7 — sweep only, no deep flow)
    // ════════════════════════════════════════════════════════════════
    {
      name: 'workspace',
      url: 'http://localhost:3000/workspace',
      run: async (qa, page) => {
        await page.waitForTimeout(3500);
        await qa.observeSection('workspace-page', { selector: 'main' });
        await qa.checkResponsive();
        await qa.checkHealth();
      },
    },
    {
      name: 'standing-orders',
      url: 'http://localhost:3000/standing-orders',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('standing-orders-page', { selector: 'main' });
        await qa.checkHealth();
      },
    },
    {
      name: 'audit',
      url: 'http://localhost:3000/audit',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('audit-page', { selector: 'main' });
        await qa.checkHealth();
      },
    },
    {
      name: 'integrations',
      url: 'http://localhost:3000/integrations',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('integrations-page', { selector: 'main' });
        await qa.checkHealth();
      },
    },
    {
      name: 'knowledge',
      url: 'http://localhost:3000/knowledge',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('knowledge-page', { selector: 'main' });
        await qa.checkHealth();
      },
    },
    {
      name: 'skills',
      url: 'http://localhost:3000/skills',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('skills-page', { selector: 'main' });
        await qa.checkHealth();
      },
    },
    {
      name: 'inbox',
      url: 'http://localhost:3000/inbox',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('inbox-page', { selector: 'main' });
        await qa.checkHealth();
      },
    },
    {
      name: 'schedules',
      url: 'http://localhost:3000/schedules',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('schedules-page', { selector: 'main' });
        await qa.checkHealth();
      },
    },
    {
      name: 'traces',
      url: 'http://localhost:3000/traces',
      run: async (qa, page) => {
        await page.waitForTimeout(2500);
        await qa.observeSection('traces-page', { selector: 'main' });
        await qa.checkHealth();
      },
    },
  ];

  const agent = new HumanQATesterAgent({
    sessionName: 'a-z-deep',
    context,
    targets,
    paceMs: 200,
  });

  const report = await agent.run();
  console.log(`\n══ A-Z DEEP AUDIT COMPLETE ══`);
  console.log(`Session score: ${report.sessionScore}/10`);
  console.log(`Buyer verdict: ${report.buyerVerdict}`);
  console.log(`Severity: ${JSON.stringify(report.severityCounts)}`);
  console.log(`Status:   ${JSON.stringify(report.statusCounts)}`);
  console.log(`Per-page scores:`);
  for (const p of report.perPage) {
    const flag = p.score < 7 ? '🔴' : p.score < 9 ? '🟡' : '🟢';
    console.log(`  ${flag} ${p.score}/10  ${p.name.padEnd(22)} — ${p.scoreReason}`);
  }
  console.log(`\nReports at qa/human-qa-reports/a-z-deep/`);

  await context.close();
  await browser.close();
  expect(report.pagesTested.length).toBeGreaterThan(0);
});
