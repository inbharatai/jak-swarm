/**
 * Benchmark harness — runtime parity testing for the OpenAI-first migration.
 *
 * Phase 8 of the migration. Required to gate the deletion of Gemini and
 * Anthropic adapters per docs/architecture/execution-engines.md.
 *
 * Public API:
 *   - runHarness({ scenarios, runtimes, buildContext }) → BenchmarkReport
 *   - PERSONA_CORE_SCENARIOS — first batch (7 scenarios) covering trivial
 *     Q&A, CMO post, CEO SWOT, Research, Coding
 *
 * To run:
 *   import { runHarness, PERSONA_CORE_SCENARIOS, LegacyRuntime, OpenAIRuntime } from '@jak-swarm/agents';
 *   const report = await runHarness({
 *     scenarios: PERSONA_CORE_SCENARIOS,
 *     runtimes: [
 *       { name: 'legacy', impl: new LegacyRuntime(...) },
 *       { name: 'openai', impl: new OpenAIRuntime() },
 *     ],
 *     buildContext: () => new AgentContext({ tenantId: 'bench', userId: 'bench', ... }),
 *   });
 *
 * The report includes pass/fail counts per runtime, p50/p95 latency, and
 * total cost. Adapter deletion (Phase 8 exit) requires:
 *   - OpenAI ≥ 90% pass rate on at least 30 scenarios
 *   - p95 latency within 1.5× of legacy
 *   - cost within 1.5× of legacy
 *   - zero break-glass activations in prod for ≥2 weeks
 */

export { runHarness } from './harness.js';
export type {
  BenchmarkScenario,
  BenchmarkResult,
  BenchmarkReport,
} from './harness.js';
export { PERSONA_CORE_SCENARIOS } from './scenarios/persona-core.js';
export {
  HARDENING_PASS_SCENARIOS,
  partitionByMode,
} from './scenarios/hardening-pass.js';
export type {
  HardeningScenario,
  ScenarioRunMode,
} from './scenarios/hardening-pass.js';
export { renderMarkdownReport } from './report.js';
