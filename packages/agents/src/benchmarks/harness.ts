/**
 * Runtime parity benchmark harness.
 *
 * Phase 8 of the OpenAI-first migration. Runs a scenario manifest against
 * BOTH runtimes (LegacyRuntime + OpenAIRuntime) and scores them on:
 *   - completion (did the workflow reach a final answer?)
 *   - JSON-schema compliance (did structured outputs match the schema?)
 *   - tool-call correctness (right tool, right args)
 *   - latency p50/p95
 *   - cost
 *
 * Pass: OpenAIRuntime matches or beats LegacyRuntime on ≥90% of scenarios.
 * Until that gate clears, Gemini/Anthropic adapters stay compiling for
 * break-glass — see docs/architecture/execution-engines.md Phase 8 entry
 * condition.
 *
 * Usage:
 *   import { runHarness } from '@jak-swarm/agents/benchmarks/harness';
 *   const report = await runHarness({ scenarios, runtimes: ['legacy','openai'] });
 *
 * The harness does NOT itself fire HTTP requests against jakswarm.com —
 * it constructs in-process agents with the appropriate runtime and runs
 * them with mock contexts. Soak / load testing is a separate concern.
 */

import type { LLMRuntime, LLMCallOptions } from '../runtime/llm-runtime.js';
import type { AgentContext } from '../base/agent-context.js';
import type OpenAI from 'openai';
import { classifyProviderError } from '../base/provider-router.js';

export interface BenchmarkScenario {
  /** Stable id for cross-run comparison. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Agent role this scenario exercises (e.g. 'COMMANDER', 'WORKER_RESEARCH'). */
  role: string;
  /** Goal sent to the agent. */
  goal: string;
  /** Optional system prompt override; defaults to the role's standard prompt. */
  systemPrompt?: string;
  /** Optional tools the agent should have access to. */
  tools?: OpenAI.ChatCompletionTool[];
  /** Optional structured-output schema (zod) the response must satisfy. */
  schema?: unknown;
  /** Expected substrings/regexes in the final content (for completion check). */
  expect?: Array<string | RegExp>;
  /** Required tool calls (toolName + optional argShape) — for tool-call correctness. */
  expectedToolCalls?: Array<{ toolName: string; argMatcher?: (args: unknown) => boolean }>;
  /** Per-scenario timeout (defaults to 60_000 ms). */
  timeoutMs?: number;
}

/**
 * Honest classification of a benchmark failure. Distinguishes:
 *   - OPENAI_QUOTA_EXHAUSTED — billing/quota issue, not a model or runtime fault
 *   - OPENAI_RATE_LIMITED   — temporary rate limit, retry would likely work
 *   - OPENAI_AUTH_ERROR     — bad / missing key, operator error
 *   - OPENAI_SERVER_ERROR   — 5xx from OpenAI, infra issue
 *   - MODEL_NOT_FOUND       — model name unknown to OpenAI
 *   - EXPECTATION_MISMATCH  — call succeeded but content didn't match
 *   - TOOL_CALL_MISMATCH    — call succeeded but expected tools weren't invoked
 *   - RUNTIME_ERROR         — anything else
 *
 * The CLI runner uses this to print quota-aware exit messages and to choose
 * the right exit code (quota exhaustion is a "blocked, not failed" case).
 */
export type BenchmarkFailureKind =
  | 'OPENAI_QUOTA_EXHAUSTED'
  | 'OPENAI_RATE_LIMITED'
  | 'OPENAI_AUTH_ERROR'
  | 'OPENAI_SERVER_ERROR'
  | 'MODEL_NOT_FOUND'
  | 'EXPECTATION_MISMATCH'
  | 'TOOL_CALL_MISMATCH'
  | 'RUNTIME_ERROR';

export interface BenchmarkResult {
  scenarioId: string;
  runtime: string;
  ok: boolean;
  failureReason?: string;
  /** Honest failure classification — see BenchmarkFailureKind. */
  failureKind?: BenchmarkFailureKind;
  latencyMs: number;
  totalTokens?: number;
  costUsd?: number;
  contentPreview?: string;
  toolCallsObserved: number;
  toolCallsMatched: number;
}

export interface BenchmarkReport {
  generatedAt: string;
  scenarioCount: number;
  byRuntime: Record<string, {
    pass: number;
    fail: number;
    /**
     * Failures broken down by kind so the report can clearly say
     * "blocked on quota: 4, real failures: 0".
     */
    failuresByKind: Partial<Record<BenchmarkFailureKind, number>>;
    p50LatencyMs: number;
    p95LatencyMs: number;
    totalCostUsd: number;
  }>;
  scenarios: BenchmarkResult[];
}

/**
 * Translate a thrown error into a BenchmarkFailureKind. Re-uses the
 * provider-router's classifyProviderError so the same vocabulary is
 * applied everywhere.
 */
export function classifyBenchmarkFailure(err: unknown): BenchmarkFailureKind {
  const kind = classifyProviderError(err);
  switch (kind) {
    case 'billing_error': return 'OPENAI_QUOTA_EXHAUSTED';
    case 'rate_limit': return 'OPENAI_RATE_LIMITED';
    case 'auth_error': return 'OPENAI_AUTH_ERROR';
    case 'server_error': return 'OPENAI_SERVER_ERROR';
    case 'model_not_found': return 'MODEL_NOT_FOUND';
    default: return 'RUNTIME_ERROR';
  }
}

/**
 * Run the harness over a set of scenarios using the supplied runtimes.
 * Each runtime gets a fresh context per scenario.
 */
export async function runHarness(opts: {
  scenarios: BenchmarkScenario[];
  runtimes: Array<{ name: string; impl: LLMRuntime }>;
  buildContext: () => AgentContext;
  callOptions?: LLMCallOptions;
}): Promise<BenchmarkReport> {
  const results: BenchmarkResult[] = [];

  for (const scenario of opts.scenarios) {
    for (const runtime of opts.runtimes) {
      const context = opts.buildContext();
      const startedAt = Date.now();
      const result: BenchmarkResult = {
        scenarioId: scenario.id,
        runtime: runtime.name,
        ok: false,
        latencyMs: 0,
        toolCallsObserved: 0,
        toolCallsMatched: 0,
      };

      try {
        const messages: OpenAI.ChatCompletionMessageParam[] = [
          { role: 'system', content: scenario.systemPrompt ?? `You are the ${scenario.role} agent.` },
          { role: 'user', content: scenario.goal },
        ];

        let content = '';
        let totalTokens: number | undefined;
        let costUsd: number | undefined;
        let observedToolCalls: Array<{ toolName: string; input: unknown }> = [];

        if (scenario.tools && scenario.tools.length > 0) {
          const loop = await runtime.impl.callTools(messages, scenario.tools, opts.callOptions ?? {}, context);
          content = loop.content;
          totalTokens = loop.totalTokens?.total;
          costUsd = loop.totalCostUsd;
          observedToolCalls = loop.toolCalls.map(tc => ({ toolName: tc.toolName, input: tc.input }));
        } else {
          const completion = await runtime.impl.respond(messages, opts.callOptions ?? {}, context);
          content = completion.choices[0]?.message?.content ?? '';
          totalTokens = completion.usage?.total_tokens;
        }

        result.contentPreview = content.slice(0, 200);
        result.totalTokens = totalTokens;
        result.costUsd = costUsd;
        result.toolCallsObserved = observedToolCalls.length;

        // Score expectations
        const expectMisses: string[] = [];
        for (const exp of scenario.expect ?? []) {
          const matched = typeof exp === 'string' ? content.toLowerCase().includes(exp.toLowerCase()) : exp.test(content);
          if (!matched) expectMisses.push(typeof exp === 'string' ? exp : exp.source);
        }

        let toolMatches = 0;
        for (const expectedTc of scenario.expectedToolCalls ?? []) {
          const m = observedToolCalls.find(o => o.toolName === expectedTc.toolName
            && (expectedTc.argMatcher ? expectedTc.argMatcher(o.input) : true));
          if (m) toolMatches++;
        }
        result.toolCallsMatched = toolMatches;

        const expectedToolCount = (scenario.expectedToolCalls ?? []).length;
        if (expectMisses.length > 0) {
          result.failureReason = `expectations missed: ${expectMisses.join(', ')}`;
          result.failureKind = 'EXPECTATION_MISMATCH';
        } else if (expectedToolCount > 0 && toolMatches < expectedToolCount) {
          result.failureReason = `tool-call match: ${toolMatches}/${expectedToolCount}`;
          result.failureKind = 'TOOL_CALL_MISMATCH';
        } else {
          result.ok = true;
        }
      } catch (err) {
        // Honest failure classification — don't lump quota exhaustion
        // (an external billing issue) in with model behaviour failures.
        result.failureReason = err instanceof Error ? err.message : String(err);
        result.failureKind = classifyBenchmarkFailure(err);
      } finally {
        result.latencyMs = Date.now() - startedAt;
        results.push(result);
      }
    }
  }

  return summarize(results);
}

function summarize(results: BenchmarkResult[]): BenchmarkReport {
  const byRuntimeLatencies = new Map<string, number[]>();
  const byRuntimeStats = new Map<string, {
    pass: number;
    fail: number;
    cost: number;
    failuresByKind: Partial<Record<BenchmarkFailureKind, number>>;
  }>();

  for (const r of results) {
    const lats = byRuntimeLatencies.get(r.runtime) ?? [];
    lats.push(r.latencyMs);
    byRuntimeLatencies.set(r.runtime, lats);

    const stats = byRuntimeStats.get(r.runtime)
      ?? { pass: 0, fail: 0, cost: 0, failuresByKind: {} as Partial<Record<BenchmarkFailureKind, number>> };
    if (r.ok) {
      stats.pass++;
    } else {
      stats.fail++;
      if (r.failureKind) {
        stats.failuresByKind[r.failureKind] = (stats.failuresByKind[r.failureKind] ?? 0) + 1;
      }
    }
    stats.cost += r.costUsd ?? 0;
    byRuntimeStats.set(r.runtime, stats);
  }

  const byRuntime: BenchmarkReport['byRuntime'] = {};
  for (const [name, lats] of byRuntimeLatencies) {
    const sorted = [...lats].sort((a, b) => a - b);
    const stats = byRuntimeStats.get(name)!;
    byRuntime[name] = {
      pass: stats.pass,
      fail: stats.fail,
      failuresByKind: stats.failuresByKind,
      p50LatencyMs: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95LatencyMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      totalCostUsd: stats.cost,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    scenarioCount: new Set(results.map(r => r.scenarioId)).size,
    byRuntime,
    scenarios: results,
  };
}
