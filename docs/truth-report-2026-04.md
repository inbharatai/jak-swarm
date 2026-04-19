# JAK Swarm — Truth Report (April 2026)

Covers Waves 1-4 of the repo-ownership plan. Honest accounting of what changed, what's real now, and what is still pending — no hype, no softening.

Generated after commit `cd7ecbd`.

---

## 1. Executive truth summary

### What JAK Swarm is now

An **operator-grade multi-agent control plane**: durable queue, cross-instance signal bus, risk-stratified approvals, tool-maturity manifest with CI enforcement, LLM tier routing, end-to-end Vibe Coder chain with auto-repair + checkpoint-revert, and honest per-role depth classification.

### What changed (Waves 1-4 + follow-ons)

- **Search stack** (earlier waves): extracted Serper / Tavily / DDG adapters, strategy chain picks primary by env, benchmark harness `pnpm bench:search`.
- **Vibe Coder end-to-end** (earlier waves): `runVibeCoderWorkflow` runs Architect → Generator → Build-check → Debugger ↻ → Deployer as a single durable workflow. Queue-driven, SSE-streamed.
- **Static build checker** (Session 3): TypeScript compiler API in-memory verification — sub-second, no Docker required. 12 unit tests.
- **Docker-backed build checker** (Session 4): real `npm install` + `next build` inside a disposable container. Injectable runner for tests. Graceful skip when Docker absent. 15 unit tests.
- **Checkpoint-revert backend** (Session 5): `CheckpointService` auto-snapshots at each workflow stage with structural diff; restore creates a new rollback version so restores are themselves reversible. 16 unit tests.
- **Checkpoint timeline UI** (Session 6): builder sidebar renders stage badges, +N ~M -K diff summary, expandable file list, inline-confirm restore button.
- **Tool maturity classification** (Session 7): 40 previously-unclassified tools now carry honest labels — **real: 17, heuristic: 12, llm_passthrough: 8, config_dependent: 2, experimental: 1** (verified at runtime by `scripts/verify-session7-counts.ts`). `pnpm check:truth` fails CI on any bucket drift.
- **Role depth** (Session 8): Email / CRM / Research / Calendar prompts rewritten as operator-grade specs with optional expert-mode result fields (deliverability, dealHealth, disagreements, recommendedSlot). 8 behavioral tests.
- **Positioning + founder actions** (Session 9): `docs/competitive-positioning.md` names what JAK is and isn't. `docs/founder-action-list.md` is the owner-only blocker list. `check:truth` strengthened with AgentRole enum count guard.

### What is still weak (honest list)

- 6+ role agents remain shallow (`Support`, `Ops`, `Voice`, `HR`, `Designer`, `Browser`). Owner to decide: upgrade, mark experimental, or remove.
- No live-production uptime evidence. Benchmark harnesses exist; public bench numbers do not.
- P1b-ownership (lease/heartbeat schema migration) not yet applied — workers can theoretically hold dead jobs until the next restart.
- `packages/tools/src/builtin/index.ts` is a 5946-line monolith. P2b-split incomplete.
- Screenshot-to-Code is wired end-to-end, but no recorded smoke against a complex Figma design.

---

## 2. Search / crawler audit

| Provider | Role | Env var | Status |
|---|---|---|---|
| Serper | Production primary | `SERPER_API_KEY` | Wired, `config_dependent` |
| Tavily | Secondary | `TAVILY_API_KEY` | Wired, `config_dependent` |
| DuckDuckGo scrape | Free-tier fallback | none | `real`, quality noticeably lower |
| Brave MCP | Optional research | `BRAVE_API_KEY` | Available, not wired into `web_search` chain |

No branded "Ducky Duck" product exists anywhere. The DDG scrape is explicitly labeled as a free-tier fallback. `pnpm check:truth` enforces this.

`pnpm bench:search` runs a 30-query fixed set and writes `docs/_generated/search-bench.json`. Requires at least one provider key.

---

## 3. Role depth matrix

| Role | Before | After | Evidence |
|---|---|---|---|
| Marketing (CMO) | World-class | World-class | 110-line prompt, 9 tools, typed `MarketingResult` |
| Technical (CTO) | World-class | World-class | 82-line prompt, 6 tools, typed `TechnicalResult` |
| Strategist (CEO) | World-class | World-class | 74-line prompt, typed `StrategistResult` |
| Coder | World-class | World-class | 65 lines, deep tool set |
| AppArchitect | World-class | World-class | 64 lines, typed file-tree output |
| AppGenerator | World-class | World-class | 56 lines, no-truncation invariant |
| AppDebugger | World-class | World-class | 52 lines, ≤3 retry tracking |
| ScreenshotToCode | World-class | World-class | 50 lines, typed `DesignToken[]` |
| **Email** | **Shallow (19-line prompt)** | **Operator-grade** | Session 8: 60+ line prompt with deliverability / A-B variants / send-time / compliance; `EmailDeliverability` + `EmailABVariant` types |
| **CRM** | **Shallow** | **Operator-grade** | Session 8: deal-health scoring rubric, BANT/MEDDIC qualification, next-best-action; `DealHealth` + `LeadQualification` types |
| **Research** | **Shallow (paraphrase)** | **Operator-grade** | Session 8: source-quality tiers, freshness, disagreement surfacing, citation-to-claim map; `ResearchDisagreement` type |
| **Calendar** | **Shallow** | **Operator-grade** | Session 8: meeting-type classification, hard/soft conflict split, slot quality scoring (0-100), DST aware; `SchedulingConflict` + `SlotRationale` types |
| Support / Ops / Voice / HR / Designer / Browser | Shallow | Shallow — pending owner decision (D1 in founder list) | — |
| AppDeployer | Thin (39 lines) | Thin — upgrade deferred | Still routes to Vercel, needs deployer-specific depth |

Verifier-level output-schema validation per role (Wave 2 item) is deferred.

---

## 4. Vibe Coder reality + fixes

### Before
- Four isolated agents. No DAG. No end-to-end chain.
- Builder UI had 3 manual buttons.
- No build check. No auto-repair. No checkpoints.

### After
```
AppArchitect → AppGenerator → BuildCheck (heuristic → tsc → optional Docker) → ok? → Deployer
                                      |
                                      no → Debugger (≤3 retries) → Generator/Debugger loop
                                      |
                                      every stage → checkpoint (diff + snapshot)
```

- `runVibeCoderWorkflow` (`packages/swarm/src/workflows/vibe-coder-workflow.ts`) is a plain async function — not a SwarmGraph node, because the retry loop is cyclic.
- Queue durability via `workflowKind: 'vibe-coder'` dispatch in `SwarmExecutionService.executeVibeCoderAsync`.
- Build check composition: `heuristicBuildChecker` (truncation / placeholder) → `staticBuildChecker` (TypeScript compiler) → optionally `DockerBuildChecker` (real `next build`). Each returns `{ok, errorLog, affectedFiles, skipped?, durationMs?}`.
- Auto-snapshot to `project_versions` at `generator`, `debugger` (per retry), `deployer`. Structural diff (added/modified/deleted with size + hash) computed and persisted to `diffJson`.
- Builder UI timeline renders stage badges + diffs + inline restore.

### Test evidence
- 14 unit tests: `tests/unit/swarm/vibe-coder-workflow.test.ts`
- 12 unit tests: `tests/unit/swarm/static-build-checker.test.ts`
- 15 unit tests: `tests/unit/swarm/docker-build-checker.test.ts`
- 16 unit tests: `tests/unit/api/checkpoint-service.test.ts`
- Owner bench: `pnpm bench:vibe-coder [--docker]` runs 5 app specs and scores them

### Gaps
- No owner-recorded end-to-end deploy against a real Vercel account (in the founder-action list).
- Integration test `tests/integration/vibe-coder-e2e.test.ts` (Docker-gated) not yet written.

---

## 5. Product truth / positioning

### Claims on the repo today

| Claim | Reality | Status |
|---|---|---|
| "38 AI Agents" | 38 in AgentRole enum | ✅ Accurate (CI-enforced against enum) |
| "119 Production Tools" | 119 registered, 0 unclassified | ✅ Accurate (CI-enforced) |
| "Vibe Coding Builder: prompt → deployed app" | End-to-end chain exists, durable, auto-repair | ✅ Accurate |
| "Distributed locks + signal bus + leader election" | Wired | ✅ Accurate |
| "Approval gate: human-in-the-loop" | Wired, risk-stratified | ✅ Accurate |
| "Screenshot-to-Code" | Wired via vibe-coding-execution.service.ts | ✅ Accurate |
| "10x cheaper" | No benchmark published | ❌ Blocked by `check:truth` — not present |
| "World-class" (universal) | 9 roles qualify, 6+ don't | ⚠️ Not universally claimed |
| "Ducky Duck" crawler | Does not exist | ❌ Blocked by `check:truth` — not present |

### New positioning

See `docs/competitive-positioning.md`. Summary: JAK is the **operator control plane** that sits between multi-agent systems and production — it is NOT a consumer coding IDE (Cursor wins there) or a vertical tool (each vertical tool wins in its lane).

---

## 6. Pending founder tasks

See `docs/founder-action-list.md`. Section order: Security → Credentials → Infra → Product decisions → Manual QA → Things to stop claiming → Deferred work. Sections A (security) and C (infra) are blockers for production.

---

## 7. Tests added / improved

| File | Tests | Focus |
|---|---|---|
| `tests/unit/swarm/vibe-coder-workflow.test.ts` | 14 | End-to-end chain behaviors |
| `tests/unit/swarm/static-build-checker.test.ts` | 12 | TS compiler validation |
| `tests/unit/swarm/docker-build-checker.test.ts` | 15 | Docker-backed build check |
| `tests/unit/api/checkpoint-service.test.ts` | 16 | Checkpoint create/list/restore + pure diff |
| `tests/unit/agents/role-behavioral.test.ts` | 8 | Email/CRM/Research/Calendar expert-mode schema round-trip |
| `tests/unit/tools/tool-manifest.test.ts` | invariant flipped | No tool ships without maturity classification |
| `scripts/check-docs-truth.ts` | +agent count guard | AgentRole enum size matches marketing copy |

Full suite: **373/373 unit tests passing** as of `cd7ecbd`.

---

## 8. Verification evidence

- `pnpm typecheck` — 23/23 tasks green
- `pnpm --filter @jak-swarm/tests exec vitest run unit` — 373/373 tests green
- `pnpm check:truth` — 0 mismatches, 0 unclassified tools
- `pnpm --filter @jak-swarm/web build` — clean Next.js production build including the new `/builder/[projectId]` timeline
- `pnpm bench:search` — runnable, skips gracefully without keys
- `pnpm bench:vibe-coder [--docker]` — runnable, skips gracefully without LLM keys

Still requires owner verification:
- End-to-end Vibe Coder deploy against real Vercel (D1 founder action)
- Multi-tenant isolation test on real Postgres (manual QA)
- Worker kill/recovery test (manual QA)

---

## 9. Remaining risks

1. **Supabase service token leaked in chat on 2026-04-18.** Founder-action A1 — rotate in dashboard, not in code.
2. **Shallow roles still exist.** Misusing them is only dangerous if marketing claims they are world-class. Session 9 blocked the universal "world-class" claim; individual shallow roles will need owner decision (D1).
3. **No public benchmark numbers.** Until bench runs produce comparable workloads vs competitor platforms, any cost/speed comparison claim stays off the marketing site. `check:truth` enforces this.
4. **P1b-ownership not applied.** A worker that dies without cleanup can theoretically hold jobs until restart. Not exploitable, but degrades throughput.
5. **Monolith tool file.** `builtin/index.ts` at 5946 lines is a merge-conflict hotspot.
6. **Role output-schema validation is advisory, not strict.** The plan specified `JAK_ROLE_OUTPUT_STRICT=1` promotion to failures in CI; this is deferred.

---

## 10. Final score

A rubric with numeric score is worth less than the evidence in sections 7-9. The honest reading:

- **Durability**: strong. Durable queue + cross-instance signals + checkpoints + lease-less reclaim on restart.
- **Correctness**: strong. Type-checked end-to-end, 373 unit tests, truth-check CI, no silent fabrications in agent output schemas.
- **Truth**: strong. CI blocks drift in tool count, agent count, prohibited-claim strings, unclassified-tool regressions.
- **Differentiation**: moderate-to-strong. The operator-grade feature set is real and demonstrably separates JAK from consumer coding tools. Not yet differentiated in a way a competitive sales deck would make land without a live customer story.
- **Observability**: moderate. SSE + trace UI + `/metrics` endpoint exist; production wiring (Prometheus scrape + alerting + uptime dashboards) is owner-side.
- **Testing**: strong for unit, moderate for integration. Postgres-gated integration tests deferred.
- **Docs**: strong. Positioning, founder action list, truth report, role manifest, integration matrix, search stack, runbook — all exist and are CI-checked for drift.
- **Security**: moderate. Approval gates wired, tool allowlisting per tenant, PII sanitization policies in agent prompts. Outstanding: the leaked Supabase token (A1) and P1b-ownership for worker leases.

**What moves this from "operator-grade" to "8.5+/10 publicly defensible":**
- One real production customer running JAK for ≥30 days with an uptime trail
- Three Vibe Coder apps deployed end-to-end with ≥2 debug-retry iterations each, recorded
- A published benchmark comparing JAK's search stack or LLM cost vs a named competitor, with methodology in the repo
- Owner-run manual QA (founder-list E) completed and documented

These are evidence, not code. The plan deliberately did not include them because no session can produce them — the owner has to run the product against real traffic and capture the trail.

**What is NOT missing and would be a distraction to chase:** features. JAK doesn't need another agent or another tool to reach the next level. It needs production evidence and honest go-to-market positioning, both of which are now in the repo for the owner to execute against.
