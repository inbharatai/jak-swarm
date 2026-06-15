#!/usr/bin/env npx tsx
/**
 * scripts/bench-adk.ts
 *
 * ADK multi-agent pipeline benchmark. Runs benchmark scenarios through
 * the full ADK orchestration pipeline (Commander → Planner → Workers →
 * Synthesis → Verifier) and produces a JSON + Markdown report.
 *
 * This is fundamentally different from bench-runtime.ts, which tests
 * single-agent LLM responses. This script tests the end-to-end ADK
 * pipeline including multi-agent coordination, tool calls, and
 * Google Search grounding.
 *
 * Run:
 *   GEMINI_API_KEY=<key> pnpm bench:adk
 *   GEMINI_API_KEY=<key> pnpm bench:adk -- --core
 *   GEMINI_API_KEY=<key> pnpm bench:adk -- --yc-wedge
 *
 * Required env:
 *   GEMINI_API_KEY  — for Gemini model access in the ADK pipeline
 *
 * Optional env:
 *   JAK_ADK_MODE     — set to '1' (forced by this script)
 *   OPENAI_API_KEY   — needed if ADK pipeline falls back to OpenAI
 *
 * Output:
 *   qa/_generated/bench-adk.json         — machine-readable
 *   qa/benchmark-results-adk.md          — copy-paste-ready
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSONA_CORE_SCENARIOS } from '../packages/agents/src/benchmarks/scenarios/persona-core.js';
import {
  HARDENING_PASS_SCENARIOS,
  partitionByMode,
} from '../packages/agents/src/benchmarks/scenarios/hardening-pass.js';
import { YC_WEDGE_SCENARIOS } from '../packages/agents/src/benchmarks/scenarios/yc-wedge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = resolve(repoRoot, 'qa/_generated');

const args = new Set(process.argv.slice(2));
const useCore = args.has('--core');
const useYcWedge = args.has('--yc-wedge');

// ─── ADK Benchmark Types ──────────────────────────────────────────────────

interface AdkBenchmarkResult {
  scenarioId: string;
  scenarioName: string;
  ok: boolean;
  failureReason?: string;
  latencyMs: number;
  agentCount: number;
  eventCount: number;
  finalContentPreview?: string;
  toolCallsObserved: number;
  groundingUsed: boolean;
}

interface AdkBenchmarkReport {
  generatedAt: string;
  mode: string;
  scenarioCount: number;
  provider: string;
  pipelineType: string;
  results: AdkBenchmarkResult[];
  summary: {
    pass: number;
    fail: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    avgAgentCount: number;
    avgToolCalls: number;
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Force ADK mode
  process.env['JAK_ADK_MODE'] = '1';

  if (!process.env['GEMINI_API_KEY']) {
    console.error('FAIL: GEMINI_API_KEY is not set. The ADK pipeline requires Gemini.');
    console.error('      Set it in your shell (export GEMINI_API_KEY=...) and re-run.');
    process.exit(2);
  }

  const mode = useYcWedge ? 'yc-wedge' : useCore ? 'persona-core' : 'hardening-pass';
  const allScenarios = useYcWedge
    ? YC_WEDGE_SCENARIOS
    : useCore
    ? PERSONA_CORE_SCENARIOS
    : HARDENING_PASS_SCENARIOS;

  // Filter to LLM-only scenarios (integration scenarios need the full stack)
  const partitioned = mode === 'hardening-pass'
    ? partitionByMode(allScenarios as never)
    : { llm: allScenarios, integration: [] };
  const scenarios = partitioned.llm;

  console.log(`[bench-adk] starting at ${new Date().toISOString()}`);
  console.log(`  mode: ${mode}`);
  console.log(`  scenarios: ${scenarios.length} LLM (integration deferred: ${partitioned.integration.length})`);
  console.log(`  provider: gemini (ADK pipeline)`);
  console.log(`  pipeline: Commander → Planner → Workers → Synthesis → Verifier`);
  console.log('');

  // Import ADK runner dynamically (lazy-loaded)
  const { runWithAdk } = await import('../packages/adk/src/orchestration/adk-runner.js');
  const { toolRegistry } = await import('@jak-swarm/tools');

  const results: AdkBenchmarkResult[] = [];

  for (const scenario of scenarios) {
    console.log(`  Running: ${scenario.id} (${scenario.name})...`);
    const startedAt = Date.now();

    try {
      const adkResult = await runWithAdk({
        workflowId: `bench-adk-${Date.now()}-${scenario.id}`,
        goal: scenario.goal,
        tenantId: 'bench-tenant',
        userId: 'bench-user',
        provider: 'gemini',
        jakToolMetadata: toolRegistry.list(),
        toolContext: {
          tenantId: 'bench-tenant',
          userId: 'bench-user',
          workflowId: `bench-adk-${Date.now()}`,
          runId: `bench-adk-run-${Date.now()}`,
        },
        workerRoles: scenario.role === 'COMMANDER' ? ['CEO'] : [scenario.role],
        googleSearchGrounding: true,
      });

      const latencyMs = Date.now() - startedAt;
      const finalContent = adkResult.state.outputs?.[0] ?? adkResult.state.error ?? '';
      const eventCount = adkResult.events.length;

      // Check expectations
      let expectMatch = true;
      let expectMisses: string[] = [];
      for (const exp of scenario.expect ?? []) {
        const matched = typeof exp === 'string'
          ? finalContent.toLowerCase().includes(exp.toLowerCase())
          : exp.test(finalContent);
        if (!matched) {
          expectMatch = false;
          expectMisses.push(typeof exp === 'string' ? exp : exp.source);
        }
      }

      const result: AdkBenchmarkResult = {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        ok: adkResult.success && expectMatch,
        failureReason: !adkResult.success
          ? adkResult.error ?? 'ADK pipeline failed'
          : !expectMatch
          ? `expectations missed: ${expectMisses.join(', ')}`
          : undefined,
        latencyMs,
        agentCount: new Set(adkResult.events.map(e => e.author)).size,
        eventCount,
        finalContentPreview: finalContent.slice(0, 200),
        toolCallsObserved: adkResult.state.traces?.reduce((sum, t) => sum + (t.toolCalls?.length ?? 0), 0) ?? 0,
        groundingUsed: true, // ADK pipeline always uses Google Search grounding
      };

      results.push(result);

      const status = result.ok ? '✅' : '❌';
      console.log(`    ${status} ${latencyMs}ms, ${eventCount} events, ${result.agentCount} agents`);

    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const errorMessage = err instanceof Error ? err.message : String(err);
      results.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        ok: false,
        failureReason: errorMessage.slice(0, 200),
        latencyMs,
        agentCount: 0,
        eventCount: 0,
        toolCallsObserved: 0,
        groundingUsed: false,
      });
      console.log(`    ❌ ERROR: ${errorMessage.slice(0, 100)}`);
    }
  }

  // ─── Build report ──────────────────────────────────────────────────────
  const passCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  const report: AdkBenchmarkReport = {
    generatedAt: new Date().toISOString(),
    mode,
    scenarioCount: scenarios.length,
    provider: 'gemini',
    pipelineType: 'adk-full-pipeline',
    results,
    summary: {
      pass: passCount,
      fail: failCount,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      avgAgentCount: results.reduce((s, r) => s + r.agentCount, 0) / (results.length || 1),
      avgToolCalls: results.reduce((s, r) => s + r.toolCallsObserved, 0) / (results.length || 1),
    },
  };

  // ─── Write JSON ────────────────────────────────────────────────────────
  mkdirSync(outDir, { recursive: true });
  const outJson = resolve(outDir, 'bench-adk.json');
  writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n[bench-adk] JSON  → ${outJson}`);

  // ─── Write Markdown ────────────────────────────────────────────────────
  const outMarkdown = resolve(repoRoot, 'qa/benchmark-results-adk.md');
  const md = renderAdkMarkdown(report);
  writeFileSync(outMarkdown, md, 'utf8');
  console.log(`[bench-adk] MD    → ${outMarkdown}`);

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log('\n──────── ADK Pipeline Summary ────────');
  console.log(`  Scenarios: ${scenarios.length}`);
  console.log(`  Pass: ${passCount} / ${results.length}`);
  console.log(`  Fail: ${failCount}`);
  console.log(`  p50 latency: ${p50}ms`);
  console.log(`  p95 latency: ${p95}ms`);
  console.log(`  Avg agents per scenario: ${report.summary.avgAgentCount.toFixed(1)}`);
  console.log(`  Avg tool calls per scenario: ${report.summary.avgToolCalls.toFixed(1)}`);
  console.log('');

  // Exit codes
  if (failCount > 0 && passCount === 0) {
    console.error('[bench-adk] FAIL: all scenarios failed.');
    process.exit(1);
  }
  process.exit(0);
}

function renderAdkMarkdown(report: AdkBenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`# ADK Multi-Agent Pipeline Benchmark — ${report.mode}`);
  lines.push('');
  lines.push(`Generated at: \`${report.generatedAt}\`  `);
  lines.push(`Provider: **${report.provider}**  `);
  lines.push(`Pipeline: **${report.pipelineType}** (Commander → Planner → Workers → Synthesis → Verifier)  `);
  lines.push(`Scenarios: **${report.scenarioCount}**  `);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---:|');
  lines.push(`| Pass | ${report.summary.pass} |`);
  lines.push(`| Fail | ${report.summary.fail} |`);
  lines.push(`| p50 latency | ${report.summary.p50LatencyMs}ms |`);
  lines.push(`| p95 latency | ${report.summary.p95LatencyMs}ms |`);
  lines.push(`| Avg agents | ${report.summary.avgAgentCount.toFixed(1)} |`);
  lines.push(`| Avg tool calls | ${report.summary.avgToolCalls.toFixed(1)} |`);
  lines.push('');

  // Per-scenario results
  lines.push('## Per-scenario results');
  lines.push('');
  lines.push('| Scenario | Status | Latency (ms) | Agents | Events | Tool calls | Reason |');
  lines.push('|---|:---:|---:|---:|---:|---:|---|');
  for (const r of report.results) {
    const status = r.ok ? '✅' : '❌';
    const reason = r.ok ? '' : (r.failureReason ?? '').slice(0, 80);
    lines.push(
      `| ${r.scenarioName} | ${status} | ${r.latencyMs} | ${r.agentCount} | ${r.eventCount} | ${r.toolCallsObserved} | ${reason} |`,
    );
  }
  lines.push('');

  // Honesty footer
  lines.push('---');
  lines.push('');
  lines.push(
    '_This report is generated by the ADK multi-agent benchmark harness. ' +
    'It exercises the full Commander → Planner → Workers → Synthesis → Verifier pipeline ' +
    'using Google Gemini with Search Grounding. Results depend on the model\'s live behavior ' +
    'and may vary between runs. For reproducible single-agent benchmarks, see bench-runtime._',
  );

  return lines.join('\n');
}

main().catch(err => {
  console.error('[bench-adk] failed:', err instanceof Error ? err.stack : String(err));
  process.exit(2);
});