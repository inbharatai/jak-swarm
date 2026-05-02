/**
 * HumanQATester — a Playwright orchestrator that behaves like a careful
 * human QA reviewer + product manager + UX critic + honest buyer.
 *
 * Replaces the Sprint-2 structural-only helper with a proper
 * interaction + claim-verification + buyer-trust framework.
 *
 * Design principles:
 *   1. **Observe before you touch.** Screenshot + a11y snapshot before any
 *      action. The "before" image is the proof of the page state the user
 *      reviewer would see; the "after" image proves what changed.
 *   2. **Slow, human-paced interaction.** Hover → wait → screenshot →
 *      click → wait for layout settle → screenshot → verify. No fast
 *      robotic clicks.
 *   3. **Four-state findings, not boolean pass/fail.** A finding is one
 *      of: working / partially-working / present-but-not-wired /
 *      not-implemented. The boolean "passed selector visible" is the
 *      weakest possible evidence.
 *   4. **Compare claim to behaviour.** A landing-page promise that
 *      isn't observable in the dashboard is a `product-truth` finding,
 *      regardless of test pass.
 *   5. **Test like a buyer.** Trust signals (pricing visible, contact
 *      info, audit pack links), onboarding clarity, mobile trust.
 *   6. **Evidence, not opinion.** Every finding carries: page, section,
 *      expected, actual, severity, category, status, suggestedFix,
 *      screenshot path, retest hint.
 *
 * What this CANNOT do (honest scope):
 *   - LLM-based visual judgement of screenshots (would need a vision
 *     model + per-frame analysis cost). Heuristic-coded checks only.
 *   - Cross-browser parity beyond what Playwright's project matrix gives.
 *   - True empathy. A human still has to read the report.
 */

import type { Page, ConsoleMessage, Request as PWRequest } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type Category =
  | 'UI'
  | 'UX'
  | 'functionality'
  | 'backend-wiring'
  | 'product-truth'
  | 'performance'
  | 'accessibility'
  | 'console'
  | 'network'
  | 'mobile'
  | 'copy'
  | 'trust';

/**
 * Four-state finding status — captures the gap between "selector exists"
 * and "real user can complete this flow".
 */
export type FindingStatus =
  | 'working'                 // observable + complete + matches claim
  | 'partially-working'       // observable but with caveats / missing edge cases
  | 'present-but-not-wired'   // UI is rendered but the action does nothing real
  | 'not-implemented'         // claimed in landing/copy but absent from product
  | 'observation';            // an evidence-only note (severity INFO)

/**
 * The 12 categories an expert human QA reviewer covers per page.
 * A page that didn't test a category cannot earn credit for it; the
 * scorer caps the page's possible score by the number of categories
 * actually exercised. This eliminates the "10/10 from a shallow
 * heading check" anti-pattern.
 */
export type TestCategory =
  | 'render-health'
  | 'console-network-health'
  | 'responsive'
  | 'primary-interaction'
  | 'form-validation'
  | 'loading-state'
  | 'error-state'
  | 'empty-state'
  | 'backend-wiring'
  | 'product-truth'
  | 'visual-quality'
  | 'evidence-screenshots';

/** Coverage record: which categories were exercised + did they pass. */
export interface CoverageRecord {
  category: TestCategory;
  passed: boolean;
  detail?: string;
}

export interface Finding {
  page: string;
  section?: string;
  expected: string;
  actual: string;
  severity: Severity;
  category: Category;
  status?: FindingStatus;
  suggestedFix: string;
  screenshot?: string;
  /** Hint the next QA run can use to confirm a fix landed. */
  retestHint?: string;
}

export interface HumanQAOptions {
  name: string;
  screenshotsDir: string;
  /** Pause between observations to mimic a human reviewer. Default 350ms. */
  paceMs?: number;
  /** Per-character typing delay for fillSlowly. Default 30ms. */
  typingDelayMs?: number;
}

export class HumanQATester {
  private findings: Finding[] = [];
  private consoleErrors: ConsoleMessage[] = [];
  private failedRequests: { url: string; status: number; method: string }[] = [];
  private currentSection = '(unset)';
  private screenshotIndex = 0;
  private opts: Required<HumanQAOptions>;
  /** Coverage map: which 12 categories the test author actually exercised. */
  private coverage = new Map<TestCategory, CoverageRecord>();

  /** Mark a test category as exercised. Pass true if it succeeded. */
  recordCoverage(category: TestCategory, passed: boolean, detail?: string): void {
    this.coverage.set(category, { category, passed, detail });
  }

  getCoverage(): CoverageRecord[] {
    return Array.from(this.coverage.values());
  }

  constructor(
    private readonly page: Page,
    opts: HumanQAOptions,
  ) {
    this.opts = {
      paceMs: 350,
      typingDelayMs: 30,
      ...opts,
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await fs.mkdir(this.opts.screenshotsDir, { recursive: true });
    this.page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        this.consoleErrors.push(msg);
      }
    });
    this.page.on('requestfailed', (req: PWRequest) => {
      this.failedRequests.push({ url: req.url(), status: 0, method: req.method() });
    });
    this.page.on('response', (resp) => {
      if (resp.status() >= 400) {
        this.failedRequests.push({
          url: resp.url(),
          status: resp.status(),
          method: resp.request().method(),
        });
      }
    });
  }

  // ─── Section observation (Step 1: Observe first) ──────────────────────

  /**
   * Scroll to a section, pause, screenshot, optionally check for expected
   * text + content density. Records a finding if anything looks off
   * (cropped text, missing element).
   */
  async observeSection(
    name: string,
    opts: {
      selector?: string;
      expectedText?: RegExp;
      expectMinChars?: number;
      // NEW — cropped-text guards
      checkDescenderClipping?: boolean;
    } = {},
  ): Promise<void> {
    this.currentSection = name;
    if (opts.selector) {
      const el = this.page.locator(opts.selector).first();
      try {
        await el.scrollIntoViewIfNeeded({ timeout: 5000 });
      } catch {
        this.add({
          section: name,
          expected: `section ${opts.selector} renders`,
          actual: 'selector not found / not visible',
          severity: 'HIGH',
          category: 'UI',
          status: 'not-implemented',
          suggestedFix: `Verify ${opts.selector} exists on this page after build`,
          retestHint: `Re-run this test; the selector should be visible.`,
        });
        return;
      }
      await this.pace();

      const text = (await el.innerText().catch(() => '')) || '';
      this.recordCoverage('render-health', true, `${opts.selector} renders ${text.length} chars`);
      if (opts.expectedText && !opts.expectedText.test(text)) {
        this.add({
          section: name,
          expected: `text matches ${opts.expectedText}`,
          actual: text.slice(0, 120),
          severity: 'MEDIUM',
          category: 'product-truth',
          status: 'present-but-not-wired',
          suggestedFix: 'Update copy or update the test expectation',
        });
      }
      if (opts.expectMinChars && text.length < opts.expectMinChars) {
        this.add({
          section: name,
          expected: `>= ${opts.expectMinChars} characters of content`,
          actual: `${text.length} chars (sparse)`,
          severity: 'MEDIUM',
          category: 'UX',
          status: 'partially-working',
          suggestedFix: 'Section may be incomplete or content not loaded',
        });
      }
      if (opts.checkDescenderClipping) {
        await this.checkDescenderClipping(name, opts.selector);
      }
    }
    await this.screenshot(`${name}`);
    this.recordCoverage('evidence-screenshots', true, `${name} captured`);
  }

  /**
   * Heuristic for descender clipping on gradient-clipped headlines:
   * if any heading inside the section has overflow=hidden + line-height
   * < 1.15 + a font-size ≥ 24px, the descender of g/p/y is at risk.
   * Not a perfect check, but catches the common Tailwind-default-gotcha.
   */
  private async checkDescenderClipping(name: string, selector: string): Promise<void> {
    const issues = await this.page.locator(`${selector} :is(h1,h2,h3)`).evaluateAll((nodes) =>
      nodes
        .map((n) => {
          const el = n as HTMLElement;
          const cs = getComputedStyle(el);
          const lh = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
          return {
            text: (el.textContent ?? '').slice(0, 50),
            fontSize: parseFloat(cs.fontSize),
            lineHeightRatio: lh,
            overflow: cs.overflow,
            paddingBottom: cs.paddingBottom,
          };
        })
        .filter((h) => h.fontSize >= 24 && h.lineHeightRatio < 1.15 && h.overflow === 'hidden'),
    );
    for (const i of issues) {
      this.add({
        section: name,
        expected: `headline has line-height >= 1.15 OR overflow visible (descender safety)`,
        actual: `"${i.text}" font-size ${i.fontSize}px, line-height-ratio ${i.lineHeightRatio.toFixed(2)}, overflow ${i.overflow}`,
        severity: 'MEDIUM',
        category: 'UI',
        status: 'partially-working',
        suggestedFix: `Add overflow:visible + padding-bottom: 0.22em + line-height: 1.18 (the .landing-gradient-text rule)`,
      });
    }
  }

  // ─── Slow human interactions (Step 2) ────────────────────────────────

  /**
   * Hover before click, pause, screenshot, click, wait for layout settle.
   * Records a finding if the target is not actionable.
   */
  async hoverThenClick(
    locatorOrName: string,
    opts: { expectNav?: RegExp; expectStateChange?: RegExp; expectInDOMAfter?: string } = {},
  ): Promise<{ ok: boolean; afterUrl: string }> {
    const beforeUrl = this.page.url();
    await this.screenshot(`${this.currentSection}-before-click`);
    const target = this.page
      .getByRole('button', { name: locatorOrName })
      .first()
      .or(this.page.locator(locatorOrName).first());

    try {
      await target.hover({ timeout: 3000 });
      await this.pace();
    } catch {
      // hover failed — element may be off-screen or blocked
    }

    try {
      await target.click({ timeout: 5000 });
    } catch (e) {
      this.add({
        section: this.currentSection,
        expected: `clickable target ${locatorOrName}`,
        actual: `not clickable: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`,
        severity: 'HIGH',
        category: 'functionality',
        status: 'present-but-not-wired',
        suggestedFix: 'Selector may be wrong, element disabled, or blocked by an overlay',
      });
      return { ok: false, afterUrl: beforeUrl };
    }

    await this.pace(this.opts.paceMs * 4);
    await this.screenshot(`${this.currentSection}-after-click`);
    this.recordCoverage('primary-interaction', true, `clicked ${locatorOrName}`);
    const afterUrl = this.page.url();

    if (opts.expectNav && !opts.expectNav.test(afterUrl)) {
      this.add({
        section: this.currentSection,
        expected: `nav matches ${opts.expectNav}`,
        actual: afterUrl,
        severity: 'HIGH',
        category: 'functionality',
        status: 'present-but-not-wired',
        suggestedFix: 'CTA href may be broken or middleware redirect mis-configured',
      });
      return { ok: false, afterUrl };
    }

    if (opts.expectStateChange) {
      const bodyText = (await this.page.locator('body').innerText().catch(() => '')) || '';
      if (!opts.expectStateChange.test(bodyText)) {
        this.add({
          section: this.currentSection,
          expected: `page text after click matches ${opts.expectStateChange}`,
          actual: bodyText.slice(0, 200),
          severity: 'HIGH',
          category: 'functionality',
          status: 'present-but-not-wired',
          suggestedFix: 'Click registered but expected UI change did not occur',
        });
        return { ok: false, afterUrl };
      }
    }

    if (opts.expectInDOMAfter) {
      const visible = await this.page.locator(opts.expectInDOMAfter).first().isVisible().catch(() => false);
      if (!visible) {
        this.add({
          section: this.currentSection,
          expected: `${opts.expectInDOMAfter} visible after click`,
          actual: 'expected element absent / not visible',
          severity: 'HIGH',
          category: 'functionality',
          status: 'present-but-not-wired',
          suggestedFix: 'Click handler did not surface the expected element',
        });
        return { ok: false, afterUrl };
      }
    }
    return { ok: true, afterUrl };
  }

  /** Type into an input with realistic per-character delay. */
  async fillSlowly(selector: string, value: string): Promise<void> {
    const el = this.page.locator(selector).first();
    try {
      await el.click({ timeout: 3000 });
      await this.pace(80);
      await el.fill('');
      await el.pressSequentially(value, { delay: this.opts.typingDelayMs });
      await this.pace(120);
    } catch (e) {
      this.add({
        section: this.currentSection,
        expected: `fill ${selector} with ${value.length} chars`,
        actual: `fill failed: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`,
        severity: 'HIGH',
        category: 'functionality',
        status: 'present-but-not-wired',
        suggestedFix: 'Input may be missing, disabled, or readonly',
      });
    }
  }

  /**
   * Run an action that should produce a network request, observe both
   * the response code and the post-action UI state.
   */
  async observeNetworkAfter(
    action: () => Promise<void>,
    opts: { urlMatch: RegExp; methodMatch?: 'GET' | 'POST' | 'PUT' | 'DELETE'; expectedStatusOk?: boolean },
  ): Promise<{ url?: string; status?: number; bodySnippet?: string }> {
    const responseP = this.page.waitForResponse(
      (r) => opts.urlMatch.test(r.url()) && (!opts.methodMatch || r.request().method() === opts.methodMatch),
      { timeout: 15_000 },
    );
    await action();
    try {
      const resp = await responseP;
      const status = resp.status();
      const body = (await resp.text().catch(() => '')).slice(0, 500);
      if (opts.expectedStatusOk && status >= 400) {
        this.add({
          section: this.currentSection,
          expected: `${opts.urlMatch} returns < 400`,
          actual: `HTTP ${status}: ${body.slice(0, 200)}`,
          severity: 'HIGH',
          category: 'backend-wiring',
          status: 'present-but-not-wired',
          suggestedFix: 'API call failed — verify route, auth, payload shape',
        });
      }
      return { url: resp.url(), status, bodySnippet: body };
    } catch {
      this.add({
        section: this.currentSection,
        expected: `network request matching ${opts.urlMatch}`,
        actual: 'no matching request observed within 15s',
        severity: 'HIGH',
        category: 'backend-wiring',
        status: 'present-but-not-wired',
        suggestedFix: 'UI action may not be triggering the API call. Check console for errors.',
      });
      return {};
    }
  }

  // ─── Health (Step 3) ──────────────────────────────────────────────────

  async checkHealth(): Promise<void> {
    const startingFindings = this.findings.length;
    if (this.consoleErrors.length > 0) {
      const seen = new Set<string>();
      let recorded = 0;
      for (const msg of this.consoleErrors) {
        const key = msg.text().slice(0, 100);
        if (seen.has(key)) continue;
        seen.add(key);
        recorded++;
        this.add({
          section: this.currentSection,
          expected: 'no console errors / warnings',
          actual: `${msg.type()}: ${msg.text().slice(0, 200)}`,
          severity: msg.type() === 'error' ? 'HIGH' : 'MEDIUM',
          category: 'console',
          status: 'partially-working',
          suggestedFix: 'Inspect the source — hydration, unhandled promise, third-party script',
        });
        if (recorded >= 5) break;
      }
    }
    if (this.failedRequests.length > 0) {
      const seen = new Set<string>();
      for (const r of this.failedRequests) {
        const key = `${r.method} ${r.url} ${r.status}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.add({
          section: this.currentSection,
          expected: `${r.method} ${r.url} returns < 400`,
          actual: r.status === 0 ? 'request failed (no response)' : `HTTP ${r.status}`,
          severity:
            r.url.includes('/_next/') || r.url.includes('chrome-extension') || r.url.includes('hot-update')
              ? 'LOW'
              : 'HIGH',
          category: 'network',
          status: 'present-but-not-wired',
          suggestedFix: 'Verify the API endpoint exists + client URL is correct',
        });
      }
    }
    const introducedFindings = this.findings.length - startingFindings;
    this.recordCoverage('console-network-health', introducedFindings === 0, `${introducedFindings} new finding(s)`);
  }

  // ─── Responsive (Step 4) ─────────────────────────────────────────────

  async checkResponsive(): Promise<void> {
    const viewports = [
      { w: 375, h: 812, label: 'mobile' as const },
      { w: 768, h: 1024, label: 'tablet' as const },
      { w: 1280, h: 800, label: 'desktop' as const },
    ];
    for (const v of viewports) {
      await this.page.setViewportSize({ width: v.w, height: v.h });
      await this.pace();
      await this.page.evaluate(() => window.scrollTo(0, 0));
      const overflow = await this.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 0) {
        this.add({
          section: `responsive-${v.label}`,
          expected: '0 horizontal overflow',
          actual: `${overflow}px overflow`,
          severity: 'HIGH',
          category: 'mobile',
          status: 'partially-working',
          suggestedFix: 'Add min-w-0 to flex children or grid-cols-1 explicit at this breakpoint',
        });
      }
      await this.screenshot(`responsive-${v.label}`);
    }
    await this.page.setViewportSize({ width: 1280, height: 800 });
    this.recordCoverage('responsive', true, '375 / 768 / 1280 viewports checked');
  }

  // ─── Form validation + state primitives (deep-test layer) ──────────

  /**
   * Submit a form and assert it surfaces a visible error message.
   * Records form-validation coverage. Use after `fillSlowly` with
   * intentionally invalid input.
   */
  async expectValidationError(opts: {
    submitSelector: string;
    /** Regex matching the error copy expected somewhere visible. */
    expectErrorRegex: RegExp;
    /** What scenario you're testing — "empty form" / "invalid email" / etc. */
    scenario: string;
  }): Promise<void> {
    await this.hoverThenClick(opts.submitSelector);
    await this.pace(800);
    const bodyText = (await this.page.locator('body').innerText().catch(() => '')) || '';
    const matched = opts.expectErrorRegex.test(bodyText);
    if (!matched) {
      this.add({
        section: this.currentSection,
        expected: `validation error "${opts.expectErrorRegex}" after submitting ${opts.scenario}`,
        actual: 'no visible error message after submit',
        severity: 'HIGH',
        category: 'functionality',
        status: 'present-but-not-wired',
        suggestedFix: 'Surface validation feedback so the user knows what went wrong',
      });
      this.recordCoverage('form-validation', false, `${opts.scenario}: no error surfaced`);
    } else {
      this.recordCoverage('form-validation', true, `${opts.scenario}: error visible`);
    }
  }

  /**
   * Verify the page surfaces a loading state (spinner, "Loading…",
   * disabled button, animate-spin element) while an action is in flight.
   *
   * Uses Promise.race so the indicator check observes the FIRST
   * mid-flight render instead of waiting for the action to complete
   * (which on local dev was finishing in <50ms — faster than the
   * polling could observe the disabled state).
   *
   * Also accepts a generic spinner selector (`.animate-spin`,
   * `[role="progressbar"]`, `svg[aria-busy="true"]`) since most
   * modern UIs use icon spinners without text.
   */
  async expectLoadingState(opts: {
    triggerAction: () => Promise<void>;
    loadingIndicatorRegex?: RegExp;
    disabledButtonSelector?: string;
    /** Extra selectors to consider as "loading visible". */
    loadingSelectors?: string[];
  }): Promise<void> {
    const selectors: string[] = [];
    if (opts.disabledButtonSelector) selectors.push(`${opts.disabledButtonSelector}[disabled]`);
    selectors.push('.animate-spin');
    selectors.push('[role="progressbar"]');
    selectors.push('svg[aria-busy="true"]');
    if (opts.loadingSelectors) selectors.push(...opts.loadingSelectors);

    let observed = false;
    const triggerP = opts.triggerAction();

    // Race a tight polling loop against the trigger completion. We poll
    // every 25ms for up to 4s OR until the trigger resolves OR until we
    // see any loading signal. This catches sub-100ms flashes that the
    // previous "wait 50ms then check" approach missed.
    const observerP = (async () => {
      const start = Date.now();
      while (Date.now() - start < 4000 && !observed) {
        for (const sel of selectors) {
          try {
            if (await this.page.locator(sel).first().isVisible({ timeout: 25 })) {
              observed = true;
              return;
            }
          } catch {
            // selector not present — continue
          }
        }
        if (opts.loadingIndicatorRegex) {
          const bodyText = (await this.page.locator('body').innerText().catch(() => '')) || '';
          if (opts.loadingIndicatorRegex.test(bodyText)) {
            observed = true;
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    })();

    await Promise.race([triggerP, observerP]);
    // Make sure both finish before we report (so the action settles
    // for downstream assertions).
    await triggerP;
    await observerP.catch(() => {});

    if (observed) {
      this.recordCoverage('loading-state', true, 'loading indicator observed mid-flight');
    } else {
      this.add({
        section: this.currentSection,
        expected: 'loading state visible while action is in flight',
        actual: 'no spinner / disabled button / aria-busy / "Loading" text observed across 4s window',
        severity: 'MEDIUM',
        category: 'UX',
        status: 'partially-working',
        suggestedFix: 'Show a spinner (e.g. animate-spin class), disable the submit button, or surface "Loading…" while the request is in flight',
      });
      this.recordCoverage('loading-state', false, 'no loading state observed');
    }
  }

  /**
   * Trigger an action that should fail and verify a useful error
   * message reaches the user (not a stack trace, not silence).
   */
  async expectErrorState(opts: {
    triggerAction: () => Promise<void>;
    expectErrorRegex: RegExp;
    scenario: string;
  }): Promise<void> {
    await opts.triggerAction();
    await this.pace(1500);
    const bodyText = (await this.page.locator('body').innerText().catch(() => '')) || '';
    const matched = opts.expectErrorRegex.test(bodyText);
    if (matched) {
      this.recordCoverage('error-state', true, `${opts.scenario}: error message reached the user`);
    } else {
      this.add({
        section: this.currentSection,
        expected: `error message matching ${opts.expectErrorRegex} for ${opts.scenario}`,
        actual: 'no user-facing error message',
        severity: 'HIGH',
        category: 'UX',
        status: 'present-but-not-wired',
        suggestedFix: 'Catch the error and surface a human-readable message — silent failures destroy trust',
      });
      this.recordCoverage('error-state', false, `${opts.scenario}: silent failure`);
    }
  }

  /**
   * Verify the page presents a useful empty state when there's no data
   * (rather than a blank panel).
   */
  async expectEmptyState(opts: {
    selector?: string;
    expectCopyRegex: RegExp;
  }): Promise<void> {
    const target = opts.selector ? this.page.locator(opts.selector) : this.page.locator('main');
    const text = (await target.innerText().catch(() => '')) || '';
    if (opts.expectCopyRegex.test(text)) {
      this.recordCoverage('empty-state', true, 'empty-state copy visible');
    } else {
      this.add({
        section: this.currentSection,
        expected: `empty-state copy matching ${opts.expectCopyRegex}`,
        actual: text.slice(0, 200) || '(empty section)',
        severity: 'MEDIUM',
        category: 'UX',
        status: 'partially-working',
        suggestedFix: 'When the list is empty, show guidance copy ("No workflows yet — try…") instead of a blank panel',
      });
      this.recordCoverage('empty-state', false, 'no empty-state copy');
    }
  }

  /**
   * Confirm a backend API call was made + returned 2xx as part of an
   * action. Use this to differentiate "button works visually" from
   * "button actually does the thing it claims".
   */
  async expectBackendWiring(opts: {
    triggerAction: () => Promise<void>;
    urlMatch: RegExp;
    methodMatch?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    label: string;
  }): Promise<void> {
    const result = await this.observeNetworkAfter(opts.triggerAction, {
      urlMatch: opts.urlMatch,
      methodMatch: opts.methodMatch,
      expectedStatusOk: true,
    });
    if (result.status && result.status < 400) {
      this.recordCoverage('backend-wiring', true, `${opts.label}: HTTP ${result.status}`);
    } else {
      this.recordCoverage('backend-wiring', false, `${opts.label}: ${result.status ? `HTTP ${result.status}` : 'no request observed'}`);
    }
  }

  /**
   * Mark visual quality coverage. The framework can only check
   * mechanical properties (descender clipping, overflow, contrast
   * heuristics). Real aesthetic judgement is human-only.
   */
  async checkVisualQualityHeuristics(): Promise<void> {
    // Re-runs descender clipping across every h1/h2/h3 on the page
    // (not just inside one section).
    const issues = await this.page.locator(':is(h1,h2,h3)').evaluateAll((nodes) =>
      nodes
        .map((n) => {
          const el = n as HTMLElement;
          const cs = getComputedStyle(el);
          const lh = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
          return {
            text: (el.textContent ?? '').slice(0, 40),
            fontSize: parseFloat(cs.fontSize),
            lineHeightRatio: lh,
            overflow: cs.overflow,
          };
        })
        .filter((h) => h.fontSize >= 24 && h.lineHeightRatio < 1.15 && h.overflow === 'hidden'),
    );
    if (issues.length === 0) {
      this.recordCoverage('visual-quality', true, 'no descender-clipping risks across page headings');
    } else {
      for (const i of issues.slice(0, 3)) {
        this.add({
          section: 'visual-quality-page-wide',
          expected: 'no descender-clipping risk on any heading',
          actual: `"${i.text}" font-size ${i.fontSize}px line-height-ratio ${i.lineHeightRatio.toFixed(2)} overflow ${i.overflow}`,
          severity: 'MEDIUM',
          category: 'UI',
          status: 'partially-working',
          suggestedFix: 'Add overflow:visible + padding-bottom: 0.22em + line-height: 1.18 to gradient-clipped headlines',
        });
      }
      this.recordCoverage('visual-quality', false, `${issues.length} descender-clipping risk(s)`);
    }
  }

  // ─── Claim verification (Step 5) ─────────────────────────────────────

  /**
   * Cheap version: a public claim either matches or it doesn't.
   * Used for static-stat assertions.
   */
  compareClaim(opts: { claim: string; observed: string; matches: boolean; section?: string }): void {
    if (opts.matches) return;
    this.add({
      section: opts.section ?? this.currentSection,
      expected: opts.claim,
      actual: opts.observed,
      severity: 'HIGH',
      category: 'product-truth',
      status: 'present-but-not-wired',
      suggestedFix: 'Either fix the public claim or wire the user-facing surface to back it',
    });
  }

  /**
   * Full claim-vs-behaviour: a marketing claim like "122 tools" must be
   * observable somewhere in the dashboard / API. The caller passes a
   * verifier function that returns true if the dashboard backs the claim.
   */
  async verifyLandingClaim(opts: {
    claim: string;
    landingSelector?: string;
    landingTextRegex?: RegExp;
    dashboardCheck: () => Promise<{ ok: boolean; evidence: string }>;
  }): Promise<void> {
    let landingSeen = true;
    if (opts.landingSelector && opts.landingTextRegex) {
      const text = (await this.page.locator(opts.landingSelector).first().innerText().catch(() => '')) || '';
      landingSeen = opts.landingTextRegex.test(text);
    }
    const dash = await opts.dashboardCheck();
    if (landingSeen && !dash.ok) {
      this.add({
        section: 'claim-vs-behaviour',
        expected: `Landing claims "${opts.claim}" — dashboard should back it (${dash.evidence})`,
        actual: 'Dashboard / API did not surface evidence for the claim',
        severity: 'HIGH',
        category: 'product-truth',
        status: 'present-but-not-wired',
        suggestedFix: 'Either remove the public claim or wire the user-facing surface to back it',
        retestHint: 'Re-run after fixing wiring; the dashboardCheck() should return ok:true',
      });
    } else if (landingSeen && dash.ok) {
      this.add({
        section: 'claim-vs-behaviour',
        expected: opts.claim,
        actual: `Backed by dashboard evidence: ${dash.evidence}`,
        severity: 'INFO',
        category: 'product-truth',
        status: 'working',
        suggestedFix: '(no action — claim verified)',
      });
    }
    this.recordCoverage('product-truth', dash.ok, `claim "${opts.claim}" → ${dash.evidence}`);
  }

  // ─── Test like a buyer (Step 5 continued) ────────────────────────────

  /**
   * Trust signals a real buyer scans for in the first 30 seconds.
   * Each missing signal is a finding; each present signal is an INFO
   * observation so the report shows what's good too.
   */
  async inspectTrustSignals(opts: {
    requirePricingLink?: boolean;
    requireGitHubLink?: boolean;
    requireContactLink?: boolean;
    requireSecurityLink?: boolean;
    requireAuditLink?: boolean;
  } = {}): Promise<void> {
    const checks: Array<{ key: string; required: boolean; finder: () => Promise<boolean> }> = [
      {
        key: 'pricing link visible',
        required: opts.requirePricingLink ?? true,
        finder: () => this.page.locator('a[href*="pricing"], a:has-text("Pricing")').first().isVisible().catch(() => false),
      },
      {
        key: 'GitHub link visible',
        required: opts.requireGitHubLink ?? true,
        finder: () => this.page.locator('a[href*="github.com"]').first().isVisible().catch(() => false),
      },
      {
        key: 'contact / email link visible',
        required: opts.requireContactLink ?? true,
        finder: () => this.page.locator('a[href^="mailto:"], a:has-text("Contact")').first().isVisible().catch(() => false),
      },
      {
        key: 'security / privacy link visible',
        required: opts.requireSecurityLink ?? false,
        finder: () => this.page.locator('a[href*="privacy"], a[href*="security"], a:has-text("Privacy"), a:has-text("Security")').first().isVisible().catch(() => false),
      },
      {
        key: 'audit / compliance link visible',
        required: opts.requireAuditLink ?? false,
        finder: () => this.page.locator('a[href*="audit"], a:has-text("Audit")').first().isVisible().catch(() => false),
      },
    ];
    for (const c of checks) {
      const present = await c.finder();
      if (!present && c.required) {
        this.add({
          section: 'trust-signals',
          expected: c.key,
          actual: 'absent',
          severity: 'MEDIUM',
          category: 'trust',
          status: 'not-implemented',
          suggestedFix: `A buyer scanning for trust signals expects this link in the nav or footer`,
        });
      } else if (present) {
        this.add({
          section: 'trust-signals',
          expected: c.key,
          actual: 'present',
          severity: 'INFO',
          category: 'trust',
          status: 'working',
          suggestedFix: '(no action — trust signal present)',
        });
      }
    }
  }

  /**
   * Onboarding clarity check: in the first fold can a buyer answer
   * "what does this do" + "what do I do next"?
   */
  async inspectOnboardingClarity(): Promise<void> {
    const h1 = (await this.page.locator('h1').first().innerText().catch(() => '')) || '';
    const subText = (await this.page.locator('h1 ~ p, h1 + p').first().innerText().catch(() => '')) || '';
    const ctas = await this.page.locator('a[href="/register"], a[href="/login"], a:has-text("Get Started"), a:has-text("Start Free")').count();

    if (h1.length < 10) {
      this.add({
        section: 'first-fold-clarity',
        expected: 'Hero h1 explains what the product does',
        actual: `h1 length ${h1.length} chars`,
        severity: 'CRITICAL',
        category: 'copy',
        status: 'not-implemented',
        suggestedFix: 'Add a clear value-prop headline as the hero h1',
      });
    }
    if (subText.length < 20) {
      this.add({
        section: 'first-fold-clarity',
        expected: 'Hero subhead expands on the headline',
        actual: `subhead length ${subText.length} chars`,
        severity: 'HIGH',
        category: 'copy',
        status: 'partially-working',
        suggestedFix: 'Add a 1-2 sentence subhead immediately after the h1',
      });
    }
    if (ctas === 0) {
      this.add({
        section: 'first-fold-clarity',
        expected: 'At least one primary CTA visible above the fold',
        actual: '0 CTAs found',
        severity: 'CRITICAL',
        category: 'UX',
        status: 'not-implemented',
        suggestedFix: 'Add a Start Free / Get Started CTA in the hero',
      });
    }
  }

  // ─── Note an observation without a hard assertion ────────────────────

  note(opts: { observation: string; category?: Category }): void {
    this.add({
      section: this.currentSection,
      expected: '(observation only)',
      actual: opts.observation,
      severity: 'INFO',
      category: opts.category ?? 'UX',
      status: 'observation',
      suggestedFix: '(none — observation only)',
    });
  }

  add(f: Omit<Finding, 'page' | 'screenshot'> & { screenshot?: string }): void {
    this.findings.push({
      page: this.opts.name,
      ...f,
    });
  }

  private async screenshot(label: string): Promise<string> {
    const idx = String(++this.screenshotIndex).padStart(3, '0');
    const filename = `${idx}-${label.replace(/[^a-z0-9-_]/gi, '_')}.png`;
    const fullpath = path.join(this.opts.screenshotsDir, filename);
    try {
      await this.page.screenshot({ path: fullpath, fullPage: false });
    } catch {
      // non-fatal
    }
    return fullpath;
  }

  private async pace(ms?: number): Promise<void> {
    await this.page.waitForTimeout(ms ?? this.opts.paceMs);
  }

  /**
   * Produce the report. Status counts are now tracked alongside severity
   * because a buyer cares about "is this real" as much as "is this loud".
   */
  async finalize(): Promise<{ markdown: string; jsonPath: string; mdPath: string }> {
    const sevCounts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    const statusCounts: Record<FindingStatus, number> = {
      'working': 0,
      'partially-working': 0,
      'present-but-not-wired': 0,
      'not-implemented': 0,
      'observation': 0,
    };
    for (const f of this.findings) {
      sevCounts[f.severity]++;
      if (f.status) statusCounts[f.status]++;
    }

    const lines: string[] = [];
    lines.push(`# Human QA Report — ${this.opts.name}`);
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Screenshots: \`${this.opts.screenshotsDir}\` (${this.screenshotIndex} captured)`);
    lines.push('');
    lines.push('## Severity summary');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|---|---|');
    for (const k of Object.keys(sevCounts) as Severity[]) lines.push(`| ${k} | ${sevCounts[k]} |`);
    lines.push('');
    lines.push('## Status summary');
    lines.push('');
    lines.push('| Status | Count |');
    lines.push('|---|---|');
    for (const k of Object.keys(statusCounts) as FindingStatus[]) lines.push(`| ${k} | ${statusCounts[k]} |`);
    lines.push('');

    if (this.findings.length === 0) {
      lines.push('## Findings');
      lines.push('');
      lines.push('No findings recorded.');
    } else {
      lines.push('## Findings');
      lines.push('');
      lines.push('| # | Severity | Status | Category | Section | Expected | Actual | Suggested fix |');
      lines.push('|---|---|---|---|---|---|---|---|');
      this.findings.forEach((f, i) => {
        const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 140);
        lines.push(
          `| ${i + 1} | ${f.severity} | ${f.status ?? '-'} | ${f.category} | ${cell(f.section ?? '-')} | ${cell(f.expected)} | ${cell(f.actual)} | ${cell(f.suggestedFix)} |`,
        );
      });
    }

    lines.push('');
    lines.push('## Disclosure');
    lines.push('');
    lines.push(
      'This report uses the Human QA Tester framework: observe-first, slow-interact, claim-vs-behaviour, four-state status. Status meanings: **working** = observable + complete; **partially-working** = observable but with caveats; **present-but-not-wired** = UI rendered but action does nothing real; **not-implemented** = claimed but absent; **observation** = INFO only. Absence of findings does NOT mean a category was tested deeply — it means the explicit checks the test author wired returned clean.',
    );

    const markdown = lines.join('\n');
    const reportDir = path.join(this.opts.screenshotsDir, '..');
    const mdPath = path.join(reportDir, `qa-report-${this.opts.name}.md`);
    const jsonPath = path.join(reportDir, `qa-report-${this.opts.name}.json`);
    await fs.writeFile(mdPath, markdown, 'utf8');
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          name: this.opts.name,
          generatedAt: new Date().toISOString(),
          screenshotsDir: this.opts.screenshotsDir,
          screenshotsCount: this.screenshotIndex,
          severityCounts: sevCounts,
          statusCounts,
          findings: this.findings,
          coverage: this.getCoverage(),
        },
        null,
        2,
      ),
      'utf8',
    );
    return { markdown, jsonPath, mdPath };
  }
}
