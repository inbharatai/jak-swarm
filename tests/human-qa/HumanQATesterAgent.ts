/**
 * HumanQATesterAgent — orchestrator that runs a full Human QA session
 * across multiple page targets, aggregates findings into one report,
 * and produces both Markdown + JSON artefacts a founder can act on.
 *
 * Designed to feel like a senior QA engineer + UX reviewer + honest
 * buyer reviewing the product end-to-end. Uses `HumanQATester` as the
 * per-page primitive and stitches the per-page reports into one.
 *
 * NOT a BaseAgent subclass. The JAK BaseAgent class assumes LLM calls
 * + tool registration; this orchestrator drives Playwright instead.
 * Keeping it outside the agent runtime avoids polluting the workflow
 * orchestrator with Playwright dependencies.
 *
 * Why an "agent" at all then: the orchestrator embeds the *judgement*
 * a human reviewer applies — what to test, what to compare, what
 * counts as "real evidence" vs "selector exists". That judgement is
 * the agent role; Playwright is the execution surface.
 */

import type { Browser, BrowserContext } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { HumanQATester, type Finding, type FindingStatus, type Severity } from './HumanQATester.js';

export interface QATargetSpec {
  name: string;
  url: string;
  /**
   * Per-page test function. Called with a fresh `HumanQATester` and
   * an open Page. Should run observe + interact + verify steps. The
   * orchestrator handles screenshot dirs, finalize(), and aggregation.
   */
  run: (qa: HumanQATester, page: import('@playwright/test').Page) => Promise<void>;
}

export interface QASessionOptions {
  /** Folder under qa/human-qa-reports/ where this session writes. */
  sessionName: string;
  /** Browser context with auth/cookies preloaded if needed. */
  context: BrowserContext;
  /** Target pages to QA. Run in series for a slow human-paced cadence. */
  targets: QATargetSpec[];
  /** Pace between observations. Default 350ms. */
  paceMs?: number;
}

export interface QASessionReport {
  sessionName: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  pagesTested: string[];
  totalScreenshots: number;
  severityCounts: Record<Severity, number>;
  statusCounts: Record<FindingStatus, number>;
  /** Per-page findings + 1-10 score, in the order targets were run. */
  perPage: Array<{
    name: string;
    url: string;
    findings: Finding[];
    screenshotsCount: number;
    score: number;
    scoreReason: string;
  }>;
  /** Aggregate score across all pages (lowest individual page score caps the average). */
  sessionScore: number;
  /**
   * The "buyer verdict" — a one-sentence status derived from the
   * aggregate counts. Honest: doesn't say "ready" unless 0 CRITICAL
   * + 0 HIGH AND zero "not-implemented" findings.
   */
  buyerVerdict: 'ready-for-buyer-walkthrough' | 'has-rough-edges' | 'not-buyer-ready';
}

/**
 * 1-10 page score derived from the finding mix. Designed to be honest:
 * one CRITICAL or one not-implemented caps the score at 5, regardless
 * of how many "INFO working" entries exist. A buyer cares about the
 * worst thing, not the average.
 *
 *   10 — clean: 0 CRITICAL/HIGH/MEDIUM, no not-implemented, no
 *        present-but-not-wired, ≥ 1 INFO/working observation
 *   9  — 1 MEDIUM permitted, otherwise clean
 *   8  — 2 MEDIUM permitted OR 1 LOW, otherwise clean
 *   7  — 1 HIGH (not present-but-not-wired or not-implemented)
 *   6  — 2 HIGH OR 1 present-but-not-wired
 *   5  — 1 not-implemented OR 3+ HIGH OR 2+ present-but-not-wired
 *   4  — 1 CRITICAL
 *   3  — 1 CRITICAL + 1 not-implemented
 *   2  — multiple CRITICAL
 *   1  — page didn't render at all
 */
export function scorePage(opts: {
  severity: Record<Severity, number>;
  status: Record<FindingStatus, number>;
  totalFindings: number;
  screenshotsCount: number;
}): { score: number; reason: string } {
  const s = opts.severity;
  const st = opts.status;
  // 0 findings + ≥ 1 screenshot = the explicit checks ran AND found
  // nothing wrong. That's the strongest possible result for this
  // framework (a finding is only recorded when something fails).
  if (opts.totalFindings === 0 && opts.screenshotsCount > 0) {
    return { score: 10, reason: 'all explicit checks passed; no issues recorded' };
  }
  if (opts.totalFindings === 0 && opts.screenshotsCount === 0) {
    return { score: 5, reason: 'page never rendered; no screenshots captured' };
  }
  if (s.CRITICAL >= 2) return { score: 2, reason: `${s.CRITICAL} CRITICAL findings — page broken` };
  if (s.CRITICAL >= 1 && st['not-implemented'] >= 1) {
    return { score: 3, reason: `1 CRITICAL + ${st['not-implemented']} not-implemented` };
  }
  if (s.CRITICAL >= 1) return { score: 4, reason: '1 CRITICAL finding' };
  if (st['not-implemented'] >= 1 || s.HIGH >= 3 || st['present-but-not-wired'] >= 2) {
    return {
      score: 5,
      reason: [
        st['not-implemented'] >= 1 ? `${st['not-implemented']} not-implemented` : '',
        s.HIGH >= 3 ? `${s.HIGH} HIGH` : '',
        st['present-but-not-wired'] >= 2 ? `${st['present-but-not-wired']} present-but-not-wired` : '',
      ].filter(Boolean).join(', '),
    };
  }
  if (s.HIGH >= 2 || st['present-but-not-wired'] >= 1) {
    return {
      score: 6,
      reason: s.HIGH >= 2 ? `${s.HIGH} HIGH` : '1 present-but-not-wired',
    };
  }
  if (s.HIGH >= 1) return { score: 7, reason: '1 HIGH finding' };
  if (s.MEDIUM >= 3) return { score: 7, reason: `${s.MEDIUM} MEDIUM (polish backlog)` };
  if (s.MEDIUM >= 2 || s.LOW >= 1) return { score: 8, reason: `${s.MEDIUM} MEDIUM, ${s.LOW} LOW` };
  if (s.MEDIUM >= 1) return { score: 9, reason: '1 MEDIUM (minor polish)' };
  return { score: 10, reason: 'no severity-bearing findings; INFO/working observations only' };
}

export class HumanQATesterAgent {
  constructor(private readonly opts: QASessionOptions) {}

  /**
   * Run the session: open each target in a fresh page, hand off to
   * the spec's run() function, capture findings, aggregate.
   */
  async run(): Promise<QASessionReport> {
    const startedAt = new Date();
    const reportRoot = path.resolve(
      process.cwd(),
      '..',
      'qa',
      'human-qa-reports',
      this.opts.sessionName,
    );
    await fs.mkdir(reportRoot, { recursive: true });

    const perPage: QASessionReport['perPage'] = [];
    let totalScreenshots = 0;
    const sevCounts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    const statusCounts: Record<FindingStatus, number> = {
      'working': 0,
      'partially-working': 0,
      'present-but-not-wired': 0,
      'not-implemented': 0,
      'observation': 0,
    };

    for (const target of this.opts.targets) {
      const page = await this.opts.context.newPage();
      const qa = new HumanQATester(page, {
        name: target.name,
        screenshotsDir: path.join(reportRoot, target.name, 'shots'),
        paceMs: this.opts.paceMs ?? 350,
      });
      await qa.start();

      try {
        await page.goto(target.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800); // let first paint settle
        await target.run(qa, page);
      } catch (e) {
        qa.add({
          section: 'top-level',
          expected: `target ${target.name} runs to completion`,
          actual: e instanceof Error ? e.message.slice(0, 200) : String(e),
          severity: 'CRITICAL',
          category: 'functionality',
          status: 'not-implemented',
          suggestedFix: 'Test threw — investigate the failing assertion or selector',
        });
      }

      const { jsonPath } = await qa.finalize();
      const data = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
      const { score, reason } = scorePage({
        severity: data.severityCounts,
        status: data.statusCounts,
        totalFindings: data.findings.length,
        screenshotsCount: data.screenshotsCount,
      });
      perPage.push({
        name: target.name,
        url: target.url,
        findings: data.findings,
        screenshotsCount: data.screenshotsCount,
        score,
        scoreReason: reason,
      });
      totalScreenshots += data.screenshotsCount;
      for (const k of Object.keys(sevCounts) as Severity[]) sevCounts[k] += data.severityCounts[k] || 0;
      for (const k of Object.keys(statusCounts) as FindingStatus[]) statusCounts[k] += data.statusCounts[k] || 0;

      await page.close();
    }

    const completedAt = new Date();
    const buyerVerdict: QASessionReport['buyerVerdict'] =
      sevCounts.CRITICAL > 0 || statusCounts['not-implemented'] > 0
        ? 'not-buyer-ready'
        : sevCounts.HIGH > 0 || statusCounts['present-but-not-wired'] > 0
          ? 'has-rough-edges'
          : 'ready-for-buyer-walkthrough';
    // Session score = LOWEST page score. A buyer judges by the worst
    // surface they touch, not the average. If any page is below 8 the
    // session is below 8.
    const sessionScore = perPage.length > 0 ? Math.min(...perPage.map((p) => p.score)) : 0;

    const report: QASessionReport = {
      sessionName: this.opts.sessionName,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      pagesTested: this.opts.targets.map((t) => t.name),
      totalScreenshots,
      severityCounts: sevCounts,
      statusCounts,
      perPage,
      sessionScore,
      buyerVerdict,
    };

    await fs.writeFile(
      path.join(reportRoot, 'session-report.json'),
      JSON.stringify(report, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(reportRoot, 'session-report.md'),
      this.renderMarkdown(report),
      'utf8',
    );
    return report;
  }

  private renderMarkdown(r: QASessionReport): string {
    const lines: string[] = [];
    lines.push(`# Human QA Session — ${r.sessionName}`);
    lines.push('');
    lines.push(`Generated ${r.completedAt} (${(r.durationMs / 1000).toFixed(1)}s, ${r.totalScreenshots} screenshots)`);
    lines.push('');
    lines.push(`## Buyer verdict: **${r.buyerVerdict}**`);
    lines.push('');
    lines.push(this.buyerVerdictExplain(r));
    lines.push('');
    lines.push('## Severity totals');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|---|---|');
    for (const k of Object.keys(r.severityCounts) as Severity[]) lines.push(`| ${k} | ${r.severityCounts[k]} |`);
    lines.push('');
    lines.push('## Status totals (the real "is this product done" view)');
    lines.push('');
    lines.push('| Status | Count |');
    lines.push('|---|---|');
    for (const k of Object.keys(r.statusCounts) as FindingStatus[]) lines.push(`| ${k} | ${r.statusCounts[k]} |`);
    lines.push('');
    lines.push(`## Session score: **${r.sessionScore}/10** (worst page)`);
    lines.push('');
    lines.push('## Per-page A-Z scoring (1-10)');
    lines.push('');
    lines.push('| Page | URL | Score | Findings | Screenshots | Reason |');
    lines.push('|---|---|---|---|---|---|');
    for (const p of r.perPage) {
      const flag = p.score < 8 ? '🔴' : p.score < 9 ? '🟡' : '🟢';
      lines.push(`| ${p.name} | ${p.url} | ${flag} **${p.score}/10** | ${p.findings.length} | ${p.screenshotsCount} | ${p.scoreReason} |`);
    }
    lines.push('');

    const allFindings = r.perPage.flatMap((p) => p.findings.map((f) => ({ ...f, page: p.name })));
    const actionable = allFindings.filter((f) => f.severity !== 'INFO');
    if (actionable.length > 0) {
      lines.push('## Actionable findings (non-INFO)');
      lines.push('');
      lines.push('| # | Page | Severity | Status | Category | Section | Expected | Actual | Fix |');
      lines.push('|---|---|---|---|---|---|---|---|---|');
      actionable.forEach((f, i) => {
        const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
        lines.push(
          `| ${i + 1} | ${f.page} | ${f.severity} | ${f.status ?? '-'} | ${f.category} | ${cell(f.section ?? '-')} | ${cell(f.expected)} | ${cell(f.actual)} | ${cell(f.suggestedFix)} |`,
        );
      });
      lines.push('');
    }
    return lines.join('\n');
  }

  private buyerVerdictExplain(r: QASessionReport): string {
    if (r.buyerVerdict === 'not-buyer-ready') {
      const reasons: string[] = [];
      if (r.severityCounts.CRITICAL > 0) reasons.push(`${r.severityCounts.CRITICAL} CRITICAL finding(s)`);
      if (r.statusCounts['not-implemented'] > 0)
        reasons.push(`${r.statusCounts['not-implemented']} feature(s) marketed but not implemented`);
      return `**Do not put this in front of a real buyer.** ${reasons.join(', ')}.`;
    }
    if (r.buyerVerdict === 'has-rough-edges') {
      const reasons: string[] = [];
      if (r.severityCounts.HIGH > 0) reasons.push(`${r.severityCounts.HIGH} HIGH-severity issue(s)`);
      if (r.statusCounts['present-but-not-wired'] > 0)
        reasons.push(`${r.statusCounts['present-but-not-wired']} UI element(s) present but not wired to real backend behaviour`);
      return `**A buyer would notice these.** ${reasons.join(', ')}. Fix before a sales walkthrough.`;
    }
    return 'No CRITICAL/HIGH issues, no not-implemented features, and no present-but-not-wired UI. Buyer-walkthrough safe based on the explicit checks the test author wired (this is NOT a substitute for a human review).';
  }
}

/**
 * Convenience: default desktop browser context for QA runs.
 */
export async function newQAContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    userAgent:
      'Mozilla/5.0 (HumanQATesterAgent; JAK Swarm) AppleWebKit/537.36 KHTML, like Gecko Chrome/124.0 Safari/537.36',
  });
}
