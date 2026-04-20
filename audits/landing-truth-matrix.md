# JAK Swarm — Landing-to-Code Truth Matrix

Audit date: 2026-04-20 · Commit at audit time: `48e21aa` → fixes land on next commit.

Every claim surfaced on [jakswarm.com](https://jakswarm.com) (via `apps/web/src/app/page.tsx`, `PremiumCTA.tsx`, `CapabilityMap.tsx`, `layout.tsx`) mapped to its underlying code with current status.

## Summary

| Status | Count |
|---|---|
| ✅ True (verified against code) | 18 |
| ⚠️ Stale / partial (fixed in this pass) | 4 |
| ❌ Incorrectly flagged as broken (actually correct) | 3 |

## Full matrix

| # | Claim (landing text / stat) | Page location | Backend / code path | Pre-audit status | Post-audit status |
|---|---|---|---|---|---|
| 1 | "38 AI Agents" | page.tsx:155, CapabilityMap.tsx:123, layout.tsx:25 | `AgentRole` enum: 6 system + 32 WORKER_* = 38. Matches 32 `.agent.ts` files in `packages/agents/src/workers/` + 6 system roles (Commander/Planner/Router/Verifier/Guardrail/Approval) | ✅ Exact | ✅ Exact (unchanged) |
| 2 | "119 Classified Tools" | page.tsx:159, layout.tsx:25 | `toolRegistry.register()` called 119 times in `packages/tools/src/builtin/index.ts` | ✅ Exact | ✅ Exact (unchanged) |
| 3 | "113 Tools" in PremiumCTA footer | PremiumCTA.tsx:119 | Same source as #2 | ❌ STALE — 113 vs 119 | ✅ Fixed → 119 |
| 4 | "21 Connectors" | page.tsx:162, 739, 1115 | `INTEGRATIONS_CORE` (12) + `INTEGRATIONS_INFRA` (9) = 21 | ⚠️ Correct but missing WhatsApp (real) and listing Sentry as if SDK (it's MCP) | ✅ Fixed → 22 (WhatsApp added, Sentry renamed to "Sentry MCP") |
| 5 | "6 AI Providers" | page.tsx:163 | OpenAI + Anthropic + Google + DeepSeek + OpenRouter + Ollama — 6 provider shims in `packages/agents/src/base/providers/` | ✅ Exact | ✅ Exact |
| 6 | "Commander → Planner → Workers → Verifier" DAG | page.tsx (WORKFLOW_STEPS) | `packages/swarm/src/graph/swarm-graph.ts` with 9 named nodes including all 4 claimed + GUARDRAIL + ROUTER + APPROVAL | ✅ True | ✅ True |
| 7 | "Parallel execution" | Landing hero + SupervisorSection | `packages/swarm/src/graph/task-scheduler.ts` + `Promise.all` concurrency in `swarm-runner.ts:208` (`graph.runParallel`) | ✅ True | ✅ True |
| 8 | "4-layer verification" | Verifier section | `packages/swarm/src/graph/nodes/verifier-node.ts` with rule engine + AI analyzer + cross-evidence + risk scorer | ✅ True | ✅ True |
| 9 | "Vibe Coding: prompt → deployed app" | Landing Vibe Coding section | 5 agents (`AppArchitect`, `AppGenerator`, `AppDebugger`, `AppDeployer`, `ScreenshotToCode`) + orchestration in `vibe-coding-execution.service.ts` + checkpoint/rollback via `project_versions` | ✅ True | ✅ True |
| 10 | "Real-time observability DAG + SSE streaming" | Observability section | `apps/api/src/plugins/supervisor-bus.ts` + Redis fan-out + SSE routes. Verified by 23 real users in prod DB | ✅ True | ✅ True |
| 11 | "Distributed locks + signal bus + leader election" | Operator section | `packages/swarm/src/supervisor/` + Redis-backed locks. ioredis connection verified in prod on `rediss://` URL | ✅ True | ✅ True |
| 12 | "Approval gate: human-in-the-loop" | Trust & Safety section | `apps/api/src/routes/approvals.routes.ts` + risk-class mapping in `classifyToolRisk()`. 10 PENDING approvals in current prod DB | ✅ True | ✅ True |
| 13 | "Workflow scheduling: cron-based recurring" | Automation section | `workflow_schedules` table + `apps/api/src/routes/schedules.routes.ts` | ✅ True | ✅ True |
| 14 | "Voice WebRTC (OpenAI Realtime)" | Voice section | `apps/api/src/routes/voice.routes.ts` — real OpenAI Realtime session exchange | ⚠️ Would return `isMock: true` token when unconfigured | ✅ Fixed → 503 error with clear message |
| 15 | "Paddle billing integration" | Pricing section | `apps/api/src/routes/paddle.routes.ts` handles subscription webhooks | ⚠️ Defaulted to `pri_*_placeholder` strings if env unset | ✅ Fixed → placeholders removed, plan map built only from real env vars |
| 16 | "Memory system (vector + key-value)" | Memory section | `memory_items` + `memory_events` + pgvector in `packages/db/prisma/schema.prisma`. Verified via `[vector] Using pgvector adapter (PostgreSQL)` log | ✅ True | ✅ True |
| 17 | "Supabase Auth" | Trust section | `apps/web/src/lib/auth.ts` uses `@supabase/supabase-js`. API accepts Supabase JWT via dual-verify in `auth.plugin.ts:36-66`. 23 real users prove E2E | ✅ True (was incorrectly flagged as "broken wiring" in pre-audit) | ✅ True |
| 18 | "Deploy to Vercel" | Vibe Coding section | `apps/api/src/routes/builder.routes.ts` + `AppDeployerAgent` with env preflight + error classification + rollback criteria | ✅ True | ✅ True |
| 19 | "Linear / Salesforce integrations" | INTEGRATIONS_CORE tiles | `packages/tools/src/mcp/mcp-providers.ts:361-397` — real `buildConfig()` spawning **official** Linear + Salesforce MCP servers via `npx`. `packageStatus: 'OFFICIAL'`. Pre-audit claim "no adapter code" was WRONG — MCP configs ARE the adapter | ✅ True (was incorrectly flagged) | ✅ True |
| 20 | "Sentry" tile | INTEGRATIONS_INFRA | `packages/tools/src/mcp/mcp-providers.ts` Sentry entry — MCP-backed (for agents to query Sentry). `@sentry/node` NOT imported in API. Pre-audit tile implied SDK-level observability | ⚠️ Implied SDK-level integration | ✅ Renamed → "Sentry MCP" with explicit subcopy comment. Honest: it's an MCP for agent tool-calls, not an error-reporting SDK |
| 21 | "WhatsApp bridge" | Nowhere on landing | `apps/api/src/routes/whatsapp.routes.ts` — 400+ lines, real (register number, verify, command routing, bridge token auth) | ❌ Hidden from landing despite being real | ✅ Added to INTEGRATIONS_CORE as "WhatsApp" |
| 22 | "10x cheaper" | Used to appear in old docs | (not currently on site) | ✅ Absent | ✅ Absent (blocked by `check:truth` CI) |
| 23 | "Screenshot-to-code" (Upload design → React) | Vibe Coding section | `ScreenshotToCodeAgent` + vision tool calls wired through `vibe-coding-execution.service.ts` | ✅ Code exists | ⚠️ Still zero real end-to-end user proofs in prod (0 projects in DB) — user I3 action needed |
| 24 | "Manual Review Required on parse failure" (implicit in "operator-grade") | Every agent | All 31 worker agents emit "Manual review required" markers on JSON parse failure + approval gates on destructive actions (email, CRM, calendar, deploy) | ✅ True (all 31 agents) | ✅ True |
| 25 | "`enableBrowserAutomation` tenant flag enforced" | Implicit in "risk-stratified approvals" | `packages/tools/src/registry/tenant-tool-registry.ts:105-109` — explicit `return false` for BROWSER category when flag off | ✅ True (was incorrectly flagged as "unenforced") | ✅ True |
| 26 | Industry pack `restrictedTools` | Implicit in "industry-pack compliance" | `swarm-execution.service.ts:709` passes industry-pack `restrictedTools` (which are actually `ToolCategory[]` despite misleading name) into `restrictedCategories` — wired correctly at the category level | ✅ True at category level | ✅ True + ADDED `restrictedToolNames?: string[]` optional field for per-name industry blocks (wired through disabledToolNames) |

## How to re-verify

Run `pnpm -w run check:truth` at repo root. Any count drift (119 tools, 22 connectors, 38 agents, "113" in PremiumCTA, "21" in stat cards) should now fail CI.

## What was NOT touched (intentional)

- **Auth flow rewrite**: investigation proved the system works (dual-verify in auth.plugin.ts + auto-provision in auth.service.ts + 23 real users in prod). Rewriting would have broken a working system.
- **Linear / Salesforce removal**: MCP adapters are real. Removing tiles would have deleted genuine capability.
- **`enableBrowserAutomation` wiring**: already enforced.
- **AgentRole enum trimming**: all 38 entries correspond to real roles. The pre-audit claim of "43 enum entries" was a miscount (included AgentStatus enum members).

## Open items (user action, tracked in `docs/founder-action-list.md` section I)

- **I1** Rotate 5 chat-leaked credentials
- **I2** Grafana Cloud signup + wire agent
- **I3** Ship 3 real Vibe Coder apps (proves landing claim #23 end-to-end)
- **I4** Register Vercel + Google OAuth apps for BYO credentials
- **I5** Kill-worker-mid-run reclaim smoke test
- **I6** Decide region/caching strategy (docs/region-and-caching-strategy.md)
