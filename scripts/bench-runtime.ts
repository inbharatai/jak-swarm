/**
 * scripts/bench-runtime.ts
 *
 * Runtime parity benchmark CLI. Runs the hardening-pass scenarios
 * through the OpenAIRuntime (and optionally GeminiRuntime or ADK pipeline)
 * and writes a JSON + Markdown report.
 *
 * Run:
 *   pnpm bench:runtime                 — runs the LLM scenarios against OpenAI only
 *   pnpm bench:runtime -- --legacy     — also runs LegacyRuntime for comparison
 *   pnpm bench:runtime -- --gemini     — also runs GeminiRuntime alongside OpenAI
 *   pnpm bench:runtime -- --adk        — runs through the full ADK multi-agent pipeline
 *   pnpm bench:runtime -- --core       — uses PERSONA_CORE_SCENARIOS instead
 *
 * Required env:
 *   OPENAI_API_KEY  — for the OpenAI runtime (always required)
 *   GEMINI_API_KEY  — for the Gemini runtime (required with --gemini or --adk)
 *
 * Output:
 *   qa/_generated/bench-runtime.json              — machine-readable (OpenAI)
 *   qa/_generated/bench-runtime-gemini.json        — machine-readable (Gemini, if --gemini)
 *   qa/benchmark-results-openai-first.md           — copy-paste-ready (overwrites prior run)
 *
 * Cost: each LLM scenario fires one provider call. With the default 4 LLM
 *       scenarios at gpt-5.4 / gemini-2.5-flash prices that's roughly $0.01-0.05 per run.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHarness } from '../packages/agents/src/benchmarks/harness.js';
import type { LLMRuntime } from '../packages/agents/src/runtime/llm-runtime.js';
import { PERSONA_CORE_SCENARIOS } from '../packages/agents/src/benchmarks/scenarios/persona-core.js';
import {
  HARDENING_PASS_SCENARIOS,
  partitionByMode,
} from '../packages/agents/src/benchmarks/scenarios/hardening-pass.js';
import { YC_WEDGE_SCENARIOS } from '../packages/agents/src/benchmarks/scenarios/yc-wedge.js';
import { renderMarkdownReport } from '../packages/agents/src/benchmarks/report.js';
import { OpenAIRuntime } from '../packages/agents/src/runtime/openai-runtime.js';
import { AgentContext } from '../packages/agents/src/base/agent-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = resolve(repoRoot, 'qa/_generated');

const args = new Set(process.argv.slice(2));
const useLegacy = args.has('--legacy');
const useCore = args.has('--core');
const useYcWedge = args.has('--yc-wedge');
const useGemini = args.has('--gemini');
const useAdk = args.has('--adk');

if (!process.env['OPENAI_API_KEY'] && !useGemini && !useAdk) {
  console.error('FAIL: OPENAI_API_KEY is not set. The OpenAIRuntime cannot construct without it.');
  console.error('      Set it in your shell (export OPENAI_API_KEY=sk-...) and re-run.');
  console.error('      Or use --gemini / --adk to run without OpenAI.');
  process.exit(2);
}

async function main() {
  // Mode resolution: explicit --yc-wedge wins, then --core, then default
  // hardening-pass. The flags are mutually exclusive — if more than one
  // is set, --yc-wedge takes precedence (designed for the YC application
  // demo measurement), then --core (the broader 7-scenario persona set).
  const mode = useYcWedge ? 'yc-wedge' : useCore ? 'persona-core' : 'hardening-pass';

  console.log(`[bench-runtime] starting at ${new Date().toISOString()}`);
  console.log(`  mode: ${mode}`);

  const allScenarios =
    mode === 'yc-wedge'
      ? YC_WEDGE_SCENARIOS
      : mode === 'persona-core'
      ? PERSONA_CORE_SCENARIOS
      : HARDENING_PASS_SCENARIOS;
  // partitionByMode only exists for hardening-pass scenarios — the other
  // two are flat lists so treat all as 'llm'.
  const partitioned =
    mode === 'hardening-pass'
      ? partitionByMode(allScenarios as never)
      : { llm: allScenarios, integration: [] };

  console.log(`  llm scenarios: ${partitioned.llm.length}`);
  console.log(`  integration scenarios (deferred): ${partitioned.integration.length}`);
  console.log('');

  // ─── Build runtimes ──────────────────────────────────────────────────
  const runtimes: Array<{ name: string; impl: LLMRuntime }> = [];
  const runtimeLabels: string[] = [];

  // OpenAI runtime (default, requires OPENAI_API_KEY)
  if (process.env['OPENAI_API_KEY']) {
    runtimes.push({ name: 'openai-responses', impl: new OpenAIRuntime() });
    runtimeLabels.push('openai');
  }

  // Gemini runtime (requires --gemini flag and GEMINI_API_KEY)
  if (useGemini && process.env['GEMINI_API_KEY']) {
    const { GeminiRuntime } = await import('../packages/agents/src/runtime/gemini-runtime.js');
    runtimes.push({ name: 'gemini-flash', impl: new GeminiRuntime() });
    runtimeLabels.push('gemini');
  } else if (useGemini) {
    console.warn('[bench-runtime] --gemini requested but GEMINI_API_KEY is not set. Skipping Gemini runtime.');
  }

  // ADK pipeline (requires --adk flag and GEMINI_API_KEY)
  // Note: ADK mode runs through the full multi-agent pipeline, not through
  // the single-agent LLMRuntime interface. See scripts/bench-adk.ts for the
  // dedicated ADK benchmark runner.
  if (useAdk) {
    console.warn('[bench-runtime] --adk runs the full multi-agent pipeline. For dedicated ADK benchmarks, use: pnpm bench:adk');
    if (process.env['GEMINI_API_KEY']) {
      const { GeminiRuntime } = await import('../packages/agents/src/runtime/gemini-runtime.js');
      runtimes.push({ name: 'adk-gemini', impl: new GeminiRuntime() });
      runtimeLabels.push('adk');
    } else {
      console.warn('[bench-runtime] --adk requires GEMINI_API_KEY. Skipping ADK runtime.');
    }
  }

  // LegacyRuntime would need a backend — not bothering to wire that here
  // unless explicitly requested. It's dead-code-detectable from bench output.
  if (useLegacy) {
    console.warn('[bench-runtime] --legacy requested but LegacyRuntime needs a BaseAgent backend');
    console.warn('  to wrap. Phase 7+ migration. Skipping legacy comparison this run.');
  }

  if (runtimes.length === 0) {
    console.error('FAIL: No runtimes available. Set OPENAI_API_KEY and/or GEMINI_API_KEY.');
    process.exit(2);
  }

  console.log(`  runtimes: ${runtimeLabels.join(' + ')}`);
  console.log('');

  const report = await runHarness({
    scenarios: partitioned.llm,
    runtimes,
    buildContext: () => new AgentContext({
      tenantId: 'bench-tenant',
      userId: 'bench-user',
      workflowId: `bench-${Date.now()}`,
      industry: 'GENERAL',
    }),
    callOptions: { maxTokens: 1024, temperature: 0.2 },
  });

  // Print summary to stdout
  console.log('\n──────── Summary ────────');
  let anyRealFailure = false;
  let anyQuotaBlocked = false;
  for (const [name, stats] of Object.entries(report.byRuntime)) {
    const total = stats.pass + stats.fail;
    const passPct = total > 0 ? Math.round((stats.pass / total) * 100) : 0;
    const openaiQuotaBlocked = stats.failuresByKind?.['OPENAI_QUOTA_EXHAUSTED'] ?? 0;
    const openaiRateLimited = stats.failuresByKind?.['OPENAI_RATE_LIMITED'] ?? 0;
    const geminiQuotaBlocked = stats.failuresByKind?.['GEMINI_QUOTA_EXHAUSTED'] ?? 0;
    const geminiRateLimited = stats.failuresByKind?.['GEMINI_RATE_LIMITED'] ?? 0;
    const geminiSafetyBlocked = stats.failuresByKind?.['GEMINI_SAFETY_BLOCKED'] ?? 0;
    const blocked = openaiQuotaBlocked + openaiRateLimited + geminiQuotaBlocked + geminiRateLimited;
    const realFails = stats.fail - blocked - geminiSafetyBlocked;
    if (realFails > 0) anyRealFailure = true;
    if (blocked > 0) anyQuotaBlocked = true;
    console.log(
      `  ${name.padEnd(20)} ${stats.pass}/${total} pass (${passPct}%) ` +
      `· quota-blocked ${blocked} · safety-blocked ${geminiSafetyBlocked} · real fails ${realFails} ` +
      `· p50 ${stats.p50LatencyMs}ms · p95 ${stats.p95LatencyMs}ms ` +
      `· $${stats.totalCostUsd.toFixed(4)}`,
    );
  }
  console.log('');

  // Write outputs
  const suffix = runtimeLabels.length > 1 || runtimeLabels.includes('gemini')
    ? runtimeLabels.join('-')
    : 'openai-first';
  const outJson = resolve(outDir, `bench-runtime-${suffix}.json`);
  const outMarkdown = resolve(repoRoot, `qa/benchmark-results-${suffix}.md`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[bench-runtime] JSON  → ${outJson}`);

  const md = renderMarkdownReport(report, {
    title: `Benchmark results — ${mode} — ${runtimeLabels.join(' + ')} — ${new Date().toISOString()}`,
    integrationDeferred: useCore ? [] : (partitioned.integration as never),
  });
  writeFileSync(outMarkdown, md, 'utf8');
  console.log(`[bench-runtime] MD    → ${outMarkdown}`);

  // Exit codes:
  //   0 — every scenario passed
  //   1 — at least one real failure (model behavior, tool-call mismatch, etc.)
  //   2 — only quota / rate-limit failures — blocked by provider account state,
  //       NOT a code regression. CI should treat this as "skipped, not red".
  if (anyRealFailure) {
    console.error('[bench-runtime] FAIL: at least one real failure (not quota-blocked).');
    process.exit(1);
  }
  if (anyQuotaBlocked) {
    console.error(
      '[bench-runtime] BLOCKED: all failures are quota-exhausted or rate-limited. ' +
      'Top up the relevant provider account and re-run.',
    );
    process.exit(2);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('[bench-runtime] failed:', err instanceof Error ? err.stack : String(err));
  process.exit(2);
});
