/**
 * Markdown report generator for the benchmark harness.
 *
 * Produces a copy-paste-ready report with:
 *   - Per-runtime summary table (pass/fail/p50/p95/cost)
 *   - Per-scenario row with status + reason
 *   - Optional integration-deferred section
 *   - Honest notes for any unverified claims
 */

import type { BenchmarkReport } from './harness.js';
import type { HardeningScenario } from './scenarios/hardening-pass.js';

export interface ReportOptions {
  /** Title for the top of the report (e.g. 'Hardening pass — 2026-04-25'). */
  title?: string;
  /**
   * Integration scenarios that were NOT run by the harness because they
   * require the full DB+queue+API stack. Listed in a separate section
   * with their `integrationNote` so the reader knows what's pending.
   */
  integrationDeferred?: HardeningScenario[];
}

export function renderMarkdownReport(
  report: BenchmarkReport,
  opts: ReportOptions = {},
): string {
  const lines: string[] = [];
  const title = opts.title ?? `Benchmark report — ${report.generatedAt}`;
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`Generated at: \`${report.generatedAt}\`  `);
  lines.push(`Scenarios run: **${report.scenarioCount}**`);
  lines.push('');

  // ── Per-runtime summary ─────────────────────────────────────────────
  lines.push('## Per-runtime summary');
  lines.push('');
  lines.push('| Runtime | Pass | Fail | Quota-blocked | Real fails | p50 (ms) | p95 (ms) | Cost (USD) |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [name, stats] of Object.entries(report.byRuntime)) {
    const quotaBlocked =
      (stats.failuresByKind?.['OPENAI_QUOTA_EXHAUSTED'] ?? 0) +
      (stats.failuresByKind?.['GEMINI_QUOTA_EXHAUSTED'] ?? 0);
    const rateLimited =
      (stats.failuresByKind?.['OPENAI_RATE_LIMITED'] ?? 0) +
      (stats.failuresByKind?.['GEMINI_RATE_LIMITED'] ?? 0);
    const blocked = quotaBlocked + rateLimited;
    const realFails = stats.fail - blocked;
    lines.push(
      `| ${name} | ${stats.pass} | ${stats.fail} | ${blocked} | ${realFails} | ${stats.p50LatencyMs} | ${stats.p95LatencyMs} | $${stats.totalCostUsd.toFixed(4)} |`,
    );
  }
  lines.push('');

  // Honest verdict line
  const totalFail = Object.values(report.byRuntime).reduce((s, r) => s + r.fail, 0);
  const totalBlocked = Object.values(report.byRuntime).reduce((s, r) => {
    return s + (r.failuresByKind?.['OPENAI_QUOTA_EXHAUSTED'] ?? 0)
             + (r.failuresByKind?.['OPENAI_RATE_LIMITED'] ?? 0)
             + (r.failuresByKind?.['GEMINI_QUOTA_EXHAUSTED'] ?? 0)
             + (r.failuresByKind?.['GEMINI_RATE_LIMITED'] ?? 0);
  }, 0);
  const totalSafetyBlocked = Object.values(report.byRuntime).reduce((s, r) => {
    return s + (r.failuresByKind?.['GEMINI_SAFETY_BLOCKED'] ?? 0);
  }, 0);
  if (totalBlocked > 0 && totalBlocked === totalFail) {
    lines.push(`> ⚠️ **All ${totalFail} failures were quota / rate-limit issues, not model or runtime problems.** ` +
      `The harness reached the provider API and the API rejected the calls for billing or rate-limit reasons. ` +
      `Top up the relevant account and re-run.`);
    lines.push('');
  }
  if (totalSafetyBlocked > 0 && totalBlocked === 0) {
    lines.push(`> ⚠️ **${totalSafetyBlocked} scenario(s) were blocked by Gemini safety filters, not model or runtime failures.** ` +
      `These are not real failures — the model declined to generate content that triggered safety guardrails.`);
    lines.push('');
  }

  // ── Per-scenario rows ───────────────────────────────────────────────
  lines.push('## Per-scenario results');
  lines.push('');
  lines.push('| Scenario | Runtime | Status | Kind | Latency (ms) | Tool calls (matched/observed) | Reason |');
  lines.push('|---|---|:---:|---|---:|---:|---|');
  for (const r of report.scenarios) {
    const status = r.ok ? '✅' : '❌';
    const kind = r.failureKind ?? '';
    const reason = r.ok ? '' : (r.failureReason ?? '').replace(/\n/g, ' ').slice(0, 120);
    lines.push(
      `| ${r.scenarioId} | ${r.runtime} | ${status} | ${kind} | ${r.latencyMs} | ${r.toolCallsMatched}/${r.toolCallsObserved} | ${reason} |`,
    );
  }
  lines.push('');

  // ── Deferred integration scenarios ──────────────────────────────────
  if (opts.integrationDeferred && opts.integrationDeferred.length > 0) {
    lines.push('## Integration scenarios — deferred (require full stack)');
    lines.push('');
    lines.push(
      'The following scenarios from the user-listed proof set require the full ' +
      'workflow stack (DB + queue worker + approval-node + SSE route + browser) and cannot ' +
      'be exercised by the in-process LLM harness. Each is documented with the human ' +
      'verification recipe below.',
    );
    lines.push('');
    for (const s of opts.integrationDeferred) {
      lines.push(`### ${s.name}`);
      lines.push('');
      lines.push(`**runMode:** \`${s.runMode}\`  `);
      lines.push(`**verification:** ${s.integrationNote ?? '(no note)'}`);
      lines.push('');
    }
  }

  // ── Honesty footer ──────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push(
    '_This report is generated by the in-process benchmark harness. ' +
    'It does NOT prove production behavior — it only proves that the runtimes ' +
    'satisfy their LLM-level interface contracts on the chosen scenarios. ' +
    'For end-to-end production verification, the integration scenarios above ' +
    'must be run against staging or production via the documented recipes._',
  );

  return lines.join('\n');
}
