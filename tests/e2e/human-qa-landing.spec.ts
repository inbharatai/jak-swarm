/**
 * Human QA — landing page sweep.
 *
 * Demonstrates the `HumanQATester` helper. The test does NOT assert
 * pass/fail on every detail; it CAPTURES evidence and produces a
 * structured report at `qa/human-qa-reports/`. The Playwright test
 * itself only fails if the page is so broken the helper cannot run
 * (e.g. nav crashes, no `<h1>`).
 *
 * Run with:
 *   pnpm --filter @jak-swarm/tests exec playwright test e2e/human-qa-landing.spec.ts --project=chromium-desktop
 */

import { test, expect } from '@playwright/test';
import { HumanQATester } from '../human-qa/HumanQATester.js';
import * as path from 'node:path';

const REPORT_ROOT = path.resolve(__dirname, '../../qa/human-qa-reports');

test.describe('HumanQA — landing page', () => {
  test('walk landing slowly, observe, and produce report', async ({ page }) => {
    const qa = new HumanQATester(page, {
      name: 'landing-desktop',
      screenshotsDir: path.join(REPORT_ROOT, 'landing-desktop', 'shots'),
      paceMs: 300,
    });
    await qa.start();

    // 1. Hit landing.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000); // let first-paint settle for evidence

    // 2. Walk every section. Each section: scroll into view, screenshot,
    //    spot-check the headline copy + content density.
    await qa.observeSection('hero', {
      selector: 'section.gradient-bg',
      expectedText: /Turn company context|JAK Shield/i,
      expectMinChars: 200,
    });
    await qa.observeSection('pain', {
      selector: 'section[aria-label*="Why closed-loop execution matters" i]',
      expectedText: /Scattered context creates drift/i,
      expectMinChars: 400,
    });
    await qa.observeSection('how-it-works', {
      selector: '#how-it-works',
      expectedText: /Seven steps/i,
      expectMinChars: 400,
    });
    await qa.observeSection('cockpit', {
      selector: '#cockpit',
      expectedText: /one operating surface/i,
      expectMinChars: 200,
    });
    await qa.observeSection('outcomes', {
      selector: '#outcomes',
      expectedText: /Evidence-backed artifacts/i,
    });
    await qa.observeSection('trust', {
      selector: '#trust',
      expectedText: /controlled autonomy/i,
    });
    await qa.observeSection('audit', {
      selector: '#audit',
      expectedText: /Enterprise-grade auditability/i,
    });
    await qa.observeSection('pricing', {
      selector: '#pricing',
      expectedText: /Transparent pricing/i,
    });

    // 3. Verify each marketing CTA actually resolves to a real route
    //    (DOM-level, not navigated — clicking would leave the landing).
    await qa.observeSection('hero-ctas', { selector: 'section.gradient-bg' });
    const heroCtaHref = await page
      .locator('section.gradient-bg a[href="/trial"]')
      .first()
      .getAttribute('href');
    qa.compareClaim({
      claim: 'Hero trial CTA points at /trial',
      observed: String(heroCtaHref),
      matches: heroCtaHref === '/trial',
      section: 'hero-ctas',
    });
    const githubHref = await page
      .locator('section.gradient-bg a[href*="inbharatai/jak-swarm"]')
      .first()
      .getAttribute('href');
    qa.compareClaim({
      claim: 'Hero "JAK Swarm Repo" CTA points at the canonical repo',
      observed: String(githubHref),
      matches: !!githubHref && githubHref.includes('inbharatai/jak-swarm'),
      section: 'hero-ctas',
    });
    const shieldHref = await page
      .locator('section.gradient-bg a[href*="inbharatai/jak-shield"]')
      .first()
      .getAttribute('href');
    qa.compareClaim({
      claim: 'Hero "JAK Shield Repo" CTA points at the trust-layer repo',
      observed: String(shieldHref),
      matches: !!shieldHref && shieldHref.includes('inbharatai/jak-shield'),
      section: 'hero-ctas',
    });

    // 4. Public stats consistency — landing claims vs codebase truth.
    //    We only check what's literally on the page; deeper truth-vs-
    //    code comparison is the job of `pnpm check:truth`.
    const finalCtaText = (await page.locator('section[aria-label*="Get started"]').innerText()) ?? '';
    qa.compareClaim({
      claim: 'CTA stats display 38 / 122 / 20+ / MIT',
      observed: finalCtaText.replace(/\s+/g, ' ').slice(0, 200),
      matches: /38/.test(finalCtaText) && /122/.test(finalCtaText) && /20\+/.test(finalCtaText),
      section: 'final-cta-stats',
    });

    // 5. Health: collect any console errors / failed network requests.
    await qa.checkHealth();

    // 6. Responsive sweep — mobile / tablet / desktop overflow check.
    await qa.checkResponsive();

    // 7. Produce evidence package.
    const { mdPath, jsonPath } = await qa.finalize();
    console.log(`[human-qa] report: ${mdPath}`);
    console.log(`[human-qa] json:   ${jsonPath}`);

    // The Playwright test only fails if a CRITICAL finding was logged
    // OR the page is so broken we couldn't even render the hero.
    const heroH1 = await page.locator('h1').first().innerText().catch(() => '');
    expect(heroH1.length, 'hero h1 must render').toBeGreaterThan(5);
  });
});
