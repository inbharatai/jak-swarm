/**
 * scripts/bench-runtime.ts
 *
 * Runtime parity benchmark CLI. Runs the hardening-pass scenarios
 * through the OpenAIRuntime (and optionally LegacyRuntime) and writes
 * a JSON + Markdown report.
 *
 * Run:
 *   pnpm bench:runtime                 — runs the LLM scenarios against OpenAI only
 *   pnpm bench:runtime -- --legacy     — also runs LegacyRuntime for comparison
 *   pnpm bench:runtime -- --core       — uses PERSONA_CORE_SCENARIOS instead
 *
 * Required env: OPENAI_API_KEY for the OpenAI runtime to construct.
 *
 * Output:
 *   qa/_generated/bench-runtime.json   — machine-readable
 *   qa/benchmark-results-openai-first.md — copy-paste-ready (overwrites prior run)
 *
 * Cost: each LLM scenario fires one OpenAI call. With the default 4 LLM
 *       scenarios at gpt-5.4 prices that's roughly $0.01-0.05 per run.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runHarness,
  HARDENING_PASS_SCENARIOS,
  PERSONA_CORE_SCENARIOS,
  partitionByMode,
  renderMarkdownReport,
  OpenAIRuntime,
  AgentContext,
} from '../packages/agents/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = resolve(repoRoot, 'qa/_generated');
const outJson = resolve(outDir, 'bench-runtime.json');
const outMarkdown = resolve(repoRoot, 'qa/benchmark-results-openai-first.md');

const args = new Set(process.argv.slice(2));
const useLegacy = args.has('--legacy');
const useCore = args.has('--core');

if (!process.env['OPENAI_API_KEY']) {
  console.error('FAIL: OPENAI_API_KEY is not set. The OpenAIRuntime cannot construct without it.');
  console.error('      Set it in your shell (export OPENAI_API_KEY=sk-...) and re-run.');
  process.exit(2);
}

async function main() {
  console.log(`[bench-runtime] starting at ${new Date().toISOString()}`);
  console.log(`  mode: ${useCore ? 'persona-core' : 'hardening-pass'}`);
  console.log(`  runtimes: openai${useLegacy ? ' + legacy' : ''}`);
  console.log('');

  const allScenarios = useCore ? PERSONA_CORE_SCENARIOS : HARDENING_PASS_SCENARIOS;
  // partitionByMode only exists for hardening-pass scenarios — persona-core
  // is a flat list so treat all as 'llm'.
  const partitioned = useCore
    ? { llm: allScenarios, integration: [] }
    : partitionByMode(allScenarios as never);

  console.log(`  llm scenarios: ${partitioned.llm.length}`);
  console.log(`  integration scenarios (deferred): ${partitioned.integration.length}`);
  console.log('');

  const runtimes: Array<{ name: string; impl: OpenAIRuntime }> = [
    { name: 'openai-responses', impl: new OpenAIRuntime() },
  ];

  // LegacyRuntime would need a backend — not bothering to wire that here
  // unless explicitly requested. It's dead-code-detectable from bench output.
  if (useLegacy) {
    console.warn('[bench-runtime] --legacy requested but LegacyRuntime needs a BaseAgent backend');
    console.warn('  to wrap. Phase 7+ migration. Skipping legacy comparison this run.');
  }

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
  for (const [name, stats] of Object.entries(report.byRuntime)) {
    const total = stats.pass + stats.fail;
    const passPct = total > 0 ? Math.round((stats.pass / total) * 100) : 0;
    console.log(
      `  ${name.padEnd(20)} ${stats.pass}/${total} pass (${passPct}%) ` +
      `· p50 ${stats.p50LatencyMs}ms · p95 ${stats.p95LatencyMs}ms ` +
      `· $${stats.totalCostUsd.toFixed(4)}`,
    );
  }
  console.log('');

  // Write outputs
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[bench-runtime] JSON  → ${outJson}`);

  const md = renderMarkdownReport(report, {
    title: `Benchmark results — ${useCore ? 'persona-core' : 'hardening pass'} — ${new Date().toISOString()}`,
    integrationDeferred: useCore ? [] : (partitioned.integration as never),
  });
  writeFileSync(outMarkdown, md, 'utf8');
  console.log(`[bench-runtime] MD    → ${outMarkdown}`);

  // Exit code: 0 if every LLM scenario passed on at least one runtime; 1 otherwise.
  const anyFailed = Object.values(report.byRuntime).some(s => s.fail > 0);
  process.exit(anyFailed ? 1 : 0);
}

main().catch(err => {
  console.error('[bench-runtime] failed:', err instanceof Error ? err.stack : String(err));
  process.exit(2);
});
