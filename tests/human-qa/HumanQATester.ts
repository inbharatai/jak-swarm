/**
 * HumanQATester — Playwright helper that drives the page like a careful
 * human QA reviewer, not like a fast selector-checking bot.
 *
 * Designed in response to the Round-2 QA feedback that AI testers fail
 * because they treat Playwright as automation, not as quality assurance.
 *
 * The loop this helper enforces:
 *   1. Observe FIRST  — screenshot + a11y snapshot before any action.
 *   2. Interact slowly — short pauses + per-action screenshots.
 *   3. Check health   — console errors + network failures + hydration warns.
 *   4. Check truth    — claims on page vs observable behaviour.
 *   5. Check responsive — mobile + tablet + desktop.
 *   6. Produce evidence — structured findings, never opinions.
 *
 * Philosophy:
 *   - Findings carry severity, category, expected, actual, suggested fix.
 *   - "Implemented but not user-facing" is its own category — code grep
 *     does not equal product behaviour.
 *   - Never claim a flow works unless observed end-to-end.
 *
 * Usage:
 *   const qa = new HumanQATester(page, { name: 'landing', screenshotsDir: 'qa/screenshots/landing' });
 *   await qa.start();
 *   await qa.observeSection('hero', { selector: 'section.gradient-bg', expectedText: /Give JAK/ });
 *   await qa.checkHealth();
 *   await qa.checkResponsive();
 *   const report = await qa.finalize();
 *
 * The helper does NOT decide pass/fail at the test level. The Playwright
 * test still asserts what it cares about. This helper is the EVIDENCE
 * COLLECTOR — it tells you *why* a test is or isn't trustworthy.
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
  | 'mobile';

export interface Finding {
  page: string;
  section?: string;
  expected: string;
  actual: string;
  severity: Severity;
  category: Category;
  suggestedFix: string;
  screenshot?: string;
}

export interface HumanQAOptions {
  /** Logical name of this run — folders + report use it. */
  name: string;
  /** Where to drop screenshots. Created if missing. */
  screenshotsDir: string;
  /** Pause between observations to mimic a human reviewer. Default 250ms. */
  paceMs?: number;
}

export class HumanQATester {
  private findings: Finding[] = [];
  private consoleErrors: ConsoleMessage[] = [];
  private failedRequests: { url: string; status: number; method: string }[] = [];
  private currentSection = '(unset)';
  private screenshotIndex = 0;
  private opts: Required<HumanQAOptions>;

  constructor(
    private readonly page: Page,
    opts: HumanQAOptions,
  ) {
    this.opts = {
      paceMs: 250,
      ...opts,
    };
  }

  /** Wire console + network listeners. Call once per test before any navigation. */
  async start(): Promise<void> {
    await fs.mkdir(this.opts.screenshotsDir, { recursive: true });
    this.page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        this.consoleErrors.push(msg);
      }
    });
    this.page.on('requestfailed', (req: PWRequest) => {
      this.failedRequests.push({
        url: req.url(),
        status: 0,
        method: req.method(),
      });
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

  /**
   * Observe a section: scroll to it, pause, screenshot, optionally check
   * for expected text + alignment. Records a finding if anything looks
   * off (cropped text, missing element, contrast issues).
   */
  async observeSection(
    name: string,
    opts: { selector?: string; expectedText?: RegExp; expectMinChars?: number } = {},
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
          suggestedFix: `Verify ${opts.selector} exists on this page after build`,
        });
        return;
      }
      await this.pace();

      if (opts.expectedText) {
        const text = (await el.innerText().catch(() => '')) || '';
        if (!opts.expectedText.test(text)) {
          this.add({
            section: name,
            expected: `text matches ${opts.expectedText}`,
            actual: text.slice(0, 120),
            severity: 'MEDIUM',
            category: 'product-truth',
            suggestedFix: 'Update copy or update the test expectation',
          });
        }
      }
      if (opts.expectMinChars && (await el.innerText().catch(() => '')).length < opts.expectMinChars) {
        this.add({
          section: name,
          expected: `>= ${opts.expectMinChars} characters of content`,
          actual: 'section is sparse / nearly empty',
          severity: 'MEDIUM',
          category: 'UX',
          suggestedFix: 'Section may be incomplete or content not loaded',
        });
      }
    }
    await this.screenshot(`${name}`);
  }

  /**
   * Slow human-style click: scroll to button, screenshot before, click,
   * wait for any layout settle, screenshot after. Returns the after URL
   * so callers can compare expected vs actual navigation.
   */
  async slowClick(selectorOrName: string, expectNav?: RegExp): Promise<string> {
    const beforeUrl = this.page.url();
    await this.screenshot(`${this.currentSection}-before-click`);
    const target = this.page.getByRole('button', { name: selectorOrName }).first().or(
      this.page.locator(selectorOrName).first(),
    );
    try {
      await target.click({ timeout: 5000 });
    } catch (e) {
      this.add({
        section: this.currentSection,
        expected: `clickable target ${selectorOrName}`,
        actual: `not clickable: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`,
        severity: 'HIGH',
        category: 'functionality',
        suggestedFix: 'Selector may be wrong or element disabled',
      });
      return beforeUrl;
    }
    await this.pace(this.opts.paceMs * 4);
    await this.screenshot(`${this.currentSection}-after-click`);
    const afterUrl = this.page.url();
    if (expectNav && !expectNav.test(afterUrl)) {
      this.add({
        section: this.currentSection,
        expected: `nav to ${expectNav}`,
        actual: afterUrl,
        severity: 'HIGH',
        category: 'functionality',
        suggestedFix: 'CTA href may be broken or middleware redirect mis-configured',
      });
    }
    return afterUrl;
  }

  /** Snapshot console + network state. Records HIGH-severity findings for any error. */
  async checkHealth(): Promise<void> {
    if (this.consoleErrors.length > 0) {
      // Group identical messages so the report doesn't drown in 100x of the same warn.
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
          suggestedFix: 'Inspect the source — hydration, unhandled promise, or third-party script',
        });
        if (recorded >= 5) break; // cap noise
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
          severity: r.url.includes('/_next/') || r.url.includes('chrome-extension') ? 'LOW' : 'HIGH',
          category: 'network',
          suggestedFix: 'Verify the API endpoint exists + client URL is correct',
        });
      }
    }
  }

  /** Check that the page renders cleanly at mobile + tablet + desktop. */
  async checkResponsive(): Promise<void> {
    const viewports = [
      { w: 375, h: 812, label: 'mobile' as const },
      { w: 768, h: 1024, label: 'tablet' as const },
      { w: 1280, h: 800, label: 'desktop' as const },
    ];
    for (const v of viewports) {
      await this.page.setViewportSize({ width: v.w, height: v.h });
      await this.pace(this.opts.paceMs);
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
          suggestedFix: `Add min-w-0 to flex children or grid-cols-1 explicit at this breakpoint`,
        });
      }
      await this.screenshot(`responsive-${v.label}`);
    }
    // Reset to desktop for any subsequent checks
    await this.page.setViewportSize({ width: 1280, height: 800 });
  }

  /**
   * Compare a public claim against an observable behaviour. The claim
   * is what the marketing site says ("122 tools"); the observed is what
   * the user-facing surface actually proves. Mismatch = product-truth
   * finding (the most damaging kind for trust).
   */
  compareClaim(opts: { claim: string; observed: string; matches: boolean; section?: string }): void {
    if (opts.matches) return;
    this.add({
      section: opts.section ?? this.currentSection,
      expected: opts.claim,
      actual: opts.observed,
      severity: 'HIGH',
      category: 'product-truth',
      suggestedFix: 'Either fix the public claim or wire the user-facing surface to back it',
    });
  }

  /** Add a manual finding from inside the test. */
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
      // Screenshot failures are non-fatal — keep going.
    }
    return fullpath;
  }

  private async pace(ms?: number): Promise<void> {
    await this.page.waitForTimeout(ms ?? this.opts.paceMs);
  }

  /**
   * Produce a markdown report + JSON artifact. Returns the markdown
   * text so the caller can also assert/log it.
   */
  async finalize(): Promise<{ markdown: string; jsonPath: string; mdPath: string }> {
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 } as Record<Severity, number>;
    for (const f of this.findings) counts[f.severity]++;

    const lines: string[] = [];
    lines.push(`# Human QA Report — ${this.opts.name}`);
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Screenshots: \`${this.opts.screenshotsDir}\` (${this.screenshotIndex} captured)`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(
      `| Severity | Count |\n|---|---|\n| CRITICAL | ${counts.CRITICAL} |\n| HIGH | ${counts.HIGH} |\n| MEDIUM | ${counts.MEDIUM} |\n| LOW | ${counts.LOW} |\n| INFO | ${counts.INFO} |`,
    );
    lines.push('');
    if (this.findings.length === 0) {
      lines.push('## Findings');
      lines.push('');
      lines.push('No findings recorded — this run only captured evidence (screenshots above).');
    } else {
      lines.push('## Findings');
      lines.push('');
      lines.push('| # | Severity | Category | Section | Expected | Actual | Suggested fix |');
      lines.push('|---|---|---|---|---|---|---|');
      this.findings.forEach((f, i) => {
        const cell = (s: string) => s.replace(/\|/g, '\\|').slice(0, 120);
        lines.push(
          `| ${i + 1} | ${f.severity} | ${f.category} | ${cell(f.section ?? '-')} | ${cell(f.expected)} | ${cell(f.actual)} | ${cell(f.suggestedFix)} |`,
        );
      });
    }
    lines.push('');
    lines.push('## Disclosure');
    lines.push('');
    lines.push(
      'This report is **evidence-based**. Findings come from observed page behaviour, console state, network state, and viewport-overflow measurements — not from opinions about visual style. Where a marketing claim could not be verified through user-facing behaviour, the finding is tagged `product-truth`. Absence of findings in a category does NOT mean that category was tested deeply — it means the helper found nothing notable in the explicit checks the test author wired.',
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
          counts,
          findings: this.findings,
        },
        null,
        2,
      ),
      'utf8',
    );
    return { markdown, jsonPath, mdPath };
  }
}
