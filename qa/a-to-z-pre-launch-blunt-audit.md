# JAK Swarm — A-to-Z Blunt Pre-Launch Audit

**Commit:** `4dcd50f` (HEAD, local-only — S1 cockpit rail not yet pushed to origin)
**Date:** 2026-04-28
**Mandate:** Honest, blunt ratings out of 10 per function. Cross-check landing/README claims against code. Punch list for ship-readiness.

> **Verdict at the top:** the platform is **6.4/10** for promotion today. The engine room is real and well-built (LangGraph cutover, audit pack, tools, agents). The marketing layer over-claims meaningfully (time-saved figures, control count, stale badges). The cockpit-first simplification (S1) is solid but exposes that approvals are still trapped on `/audit` instead of inline in chat — the single biggest UX promise the README makes that the product doesn't yet keep. **Do not promote until the eight P1 items below are closed (~2 weeks of focused work).**

---

## Baseline state (verified at HEAD)

| Check | Result | Source |
|---|---|---|
| Tests pass | **961 passing / 97 skipped / 1058 total** | `pnpm exec vitest run` (re-run after a 2-test flake on first attempt) |
| Test flake | **2 flaky tests on first run** (clean on retry) | `bzxcfyfbm` first run reported 2 failed → 0 on second run |
| Typecheck | **15/15 workspaces green** | `pnpm -r --no-bail typecheck` (apps/api + apps/web + 13 packages) |
| Truth check | OK · 122 tools · 0 unclassified | `pnpm check:truth` |
| Latest commit pushed | **NO** — `4dcd50f` is local-only | `git log origin/main..HEAD` shows S1 unpushed |

**README badges that are stale or wrong:**
- `Tests-751/751_passing` → **actual is 961/1058 (with 97 skipped)**. Off by 210 tests.
- `Typecheck-15_workspaces_green` → **accurate**.
- `AI_Agents-38` → **accurate**.
- `Classified_Tools-122` → **accurate**.

---

## Per-function ratings (blunt, /10)

### Backend — engine room (weight: 35% of overall verdict)

| Function | Rating | Evidence | Single biggest gap |
|---|---|---|---|
| **LangGraph orchestrator** | **8/10** | `packages/swarm/src/workflow-runtime/langgraph-runtime.ts` is 410+ lines, real impl. SwarmGraph deleted. `PostgresCheckpointSaver` wired. `interrupt()` + `Command(resume)` for approvals. No env-flag fallback. | None at runtime; only a precision nit — README says "native LangGraph" but JAK still owns the 9 node implementations wrapped inside the StateGraph. Honest enough. |
| **Agent count + behaviors** | **6/10** | 38 agents (6 + 32) confirmed. `tests/unit/agents/` has ~17 test files for 38 agents — **45% of agents have no dedicated unit test**. No stubs detected. | Behavioral test gap. Snapshot-grade tests only on the most-used roles; specialised workers are essentially untested in isolation. |
| **Tool registry** | **8.5/10** | 122 `toolRegistry.register()` calls verified. Maturity labels CI-enforced via `scripts/check-docs-truth.ts`. No silent-fake tools. | No CI test that asserts every tool has a maturity label. Today's check is grep-based. |
| **Audit & Compliance Pack** | **7/10** | `FinalAuditPackService` enforces hard gate (refuses if any workpaper not approved). `FinalPackGateError` exists + thrown. `AuditorPortalService` uses `crypto.timingSafeEqual` + SHA-256 token hashing. RetentionSweep service real, dry-run by default, skips user-owned evidence. | **Control count discrepancy**: README + landing claim 167 controls (48+37+82). The 82 ISO 27001 entry has a comment in the seed file noting **only 54 are operationally backed; 39 are policy-only**. Real auditable count is closer to **129**, not 167. Marketing inflation. |
| **Company Brain** | **7/10** | `CompanyProfile` + `CompanyKnowledgeSource` models exist. Crawler has SSRF defense (private IP block), robots.txt parsing, single-instance per-host rate limit. DOCX (mammoth, 0.95 confidence), XLSX (exceljs, 0.85), image OCR (tesseract, 0.6) — all real, honest confidence labels. | Crawler rate-limit is per-instance, not Redis-backed — multi-replica deploys can bypass. OCR at 60% confidence is structurally noisy; agents downstream don't filter on confidence. |
| **Trust layer (Verifier + PII + structured output)** | **7/10** | Verifier has 5-layer hallucination + citation density gating (`computeCitationDensity` lines 83-126). `RuntimePIIRedactor` (92 lines) is wired in BaseAgent. `openai-runtime.ts` uses `responses.create` with `type: 'json_schema'` strict. `cached_tokens` tracked. | Citation density is heuristic (sentence-split + claim-verb regex). PII redactor is regex-based — false negatives on novel PII types. Cache-hit ratio not surfaced anywhere user-visible. |
| **CEO super-orchestrator** | **7.5/10** | `CEOOrchestratorService` real. Emits `ceo_context_loaded` / `ceo_goal_understood` / `ceo_workflow_selected` / `ceo_final_summary_generated`. Loads Company Brain. | Test coverage thin (1 unit test file). |
| **RepairService (auto-repair)** | **3/10** ⚠️ | 224 lines of code. 27 tests pass in isolation. Decision tree real (destructive→escalate, transient→retry). | **NOT WIRED INTO THE LANGGRAPH WORKER-NODE FAILURE PATH.** Grep for imports shows zero references in the orchestration layer. This is a phantom feature — present-but-not-active. README markets it as a hardening win; code doesn't deliver. |
| **Retention sweep** | **8/10** | Real, dry-run by default, skips user-owned records. | No scheduled job — relies on manual trigger. No UI surface for ops. |

**Backend weighted average: 6.7/10** — solid mid-tier. LangGraph + tools + audit pack are the strong pillars. RepairService is the single biggest credibility gap.

---

### Marketing claims — landing + README (weight: 20%)

| Claim | Verdict | Rating |
|---|---|---|
| "38 specialist agents (6 + 32)" | TRUE — count verified | **10/10** |
| "122 classified tools" | TRUE — count verified | **10/10** |
| "167 seeded controls (48 SOC 2 + 37 HIPAA + 82 ISO 27001)" | PARTIALLY MISLEADING — 82 ISO entry includes 39 policy-only entries; auditable count ~129 | **6/10** |
| "751/751 tests passing" badge | **STALE** — actual 961 passing, 97 skipped | **3/10** |
| "Native LangGraph orchestration" | TRUE | **10/10** |
| "Postgres-backed checkpoints" | TRUE — `PostgresCheckpointSaver` real | **10/10** |
| "Reviewer-gated workpaper PDFs" | TRUE — gate enforced via `approvalState=REQUIRES_APPROVAL` | **9/10** |
| "Final-pack signing refuses if any workpaper unapproved (FinalPackGateError)" | TRUE | **10/10** |
| "External Auditor Portal — invite-token-only, SHA-256 hashed, `crypto.timingSafeEqual`" | TRUE — service + middleware exist | **9/10** |
| "HMAC-SHA256 evidence bundles verify byte-for-byte" | TRUE | **9/10** |
| "Source-grounded verification with citation density" | TRUE — but heuristic, not ML | **7/10** |
| "Runtime PII redaction" | TRUE — regex-based, with false-negative risk | **7/10** |
| "Cross-task auto-repair" | **PARTIAL — code exists but not wired into the worker-node failure path** | **3/10** |
| "CEO super-orchestrator" | TRUE | **8/10** |
| "Tech stack: Next.js 16, TypeScript, Fastify, Prisma, PostgreSQL, pgvector, Supabase, Playwright" | All TRUE except Playwright is dev-dependency-only (used for tests, not runtime browser-tool path) | **8/10** |
| **"SOC 2 evidence pack — 6-12 weeks → 3-5 days"** (ShowTheWork outcome card) | **ASPIRATIONAL — no benchmarking, no telemetry, no code reference for the 3-5d figure** | **2/10** |
| **"Generated SaaS app — 2-5 days → 15-60 min"** | **ASPIRATIONAL — no timing telemetry** | **2/10** |
| **"Market research brief — 4-8 hours → 15-25 min"** | **ASPIRATIONAL — no timing telemetry** | **2/10** |
| **"Cold-email campaign — 3-6 hours → 10-20 min"** | **ASPIRATIONAL — no timing telemetry** | **2/10** |
| **"$0.50–$1.50 per generated app"** | **UNVERIFIED — comment says "real $0.50-$1.50 cost band" but no cost-calculation code surfaces this anywhere** | **3/10** |

**Marketing weighted average: 6.2/10**. Pattern: **the "before → after" time-saved figures and the cost-per-app number are made up.** They have zero backing in code, telemetry, or a real benchmark study. The "167 controls" figure is also overstated by ~25-30%. Everything else is either truthful or close enough.

---

### UI/UX — cockpit, rail, palette, onboarding, audit page (weight: 25%)

| Surface | Rating | Single biggest issue |
|---|---|---|
| First-time onboarding (register → /onboarding → /workspace) | **7/10** | Two-step funnel is clean; industry asked once (in register). Step skip-paths can fail silently if backend save errors. No expectation-setting for approvals or cost. |
| Cockpit chat input | **8/10** | Single textarea, optional file/voice, no pre-pickers required. Placeholder copy "Auto mode — JAK picks the right specialist" is ambiguous for laymen. |
| Empty state | **8/10** | Clean H1, role combos, contextual starter prompts. No mention of how approvals or cost will surface. |
| **Cockpit while running (live state visibility)** | **6/10** | Plan rendered inline; worker events stream as messages. **TaskList + WorkflowDAG only visible when DetailDrawer is opened — drawer is hidden by default and undiscoverable.** No inline cost ticker. No progress bar. |
| S1 zone rail (new) | **8/10** | 5 icons, clean active-state, role gates correct (END_USER doesn't see Audit). Recent-conversations popover is undiscoverable — no badge or hint that the Chat icon has a popover. |
| S1 command palette (new) | **9/10** | Cmd+K opens, search filter, role gates, arrow nav, Esc close, no-result state. **On mobile the trigger button is `hidden sm:flex` — palette is unreachable on phones unless user knows the keyboard shortcut (which they can't trigger without a keyboard).** |
| **Approvals UX** | **4/10** ⚠️ | **Approvals are NOT inline in chat.** They live on `/audit` Reviewer Queue tab. When an agent pauses, the workflow stalls silently in chat. User must navigate to `/audit` to approve. **This breaks the cockpit-first promise.** |
| Audit page (1209 lines, 6 tabs) | **7/10** | Real reviewer queue, audit log, workflow trail, compliance, audit runs. No empty-state guidance for non-technical reviewers. Generic "Reviewer access required" gate text. |
| Mobile | **6/10** | Rail collapses to drawer; palette button is hidden on phones; recent-conversations popover positions absolute and may go off-screen on mobile drawer. |
| Accessibility | **7/10** | `aria-label` + `aria-current` on rail; `role="dialog"` + `aria-modal` on palette. Missing: focus-trap on palette, skip-to-content, live-region announcements for upload status, `role="alert"` on voice errors. |

**UI/UX weighted average: 7.0/10**. The cockpit-first promise is **half-met**. Chat is the primary surface and the rail+palette are clean wins. But two big breakages remain: approvals trap users on `/audit`, and live workflow state is hidden behind an undiscoverable drawer.

---

### Tests + CI (weight: 10%)

| Function | Rating | Evidence |
|---|---|---|
| Test count | 961 unit+integration tests | `pnpm exec vitest run` |
| Test stability | **2 flakes on first run** (clean on retry); 97 skipped tests | `bzxcfyfbm` log |
| Typecheck | **15/15 workspaces green** | `pnpm -r typecheck` |
| Truth-check CI gate | Green at HEAD | `pnpm check:truth` |
| E2E test depth | Audit-run E2E exists but **only 1 test** for the full SOC 2 engagement flow. Compliance-critical with thin coverage. | `tests/integration/audit-run-e2e.test.ts` |
| Browser e2e (Playwright) | NEEDS RUNTIME — no live persona-walkthrough test runs in this audit | n/a |
| Load/stress test | Not present | n/a |

**Tests/CI rating: 7.5/10**. Volume is good (961). Stability is mediocre (2 flakes). E2E coverage for compliance flow is thin (1 test gates a feature the README makes a centerpiece).

---

### Production-readiness gaps (weight: 10%)

| Gap | Severity | Notes |
|---|---|---|
| RepairService not wired into worker-node failure path | **P1** | Marketed as a final-hardening feature; not actually active. ~1 day to wire. |
| Approvals trapped on /audit, not inline in cockpit | **P1** | Single biggest UX promise the cockpit-first design makes that the product doesn't keep. ~3-5 days to surface in chat (extends Sprint S2). |
| README test badge stale (751 vs 961) | **P1** | Easy 1-min fix; signals attention-to-detail at first glance. |
| "167 controls" vs operational ~129 | **P1** | Either (a) update copy to "167 controls seeded (~129 operationally backed)", or (b) finish operational backing for the remaining 39 ISO controls (~3-5 days). |
| Time-saved figures ("6-12 weeks → 3-5 days") with no backing | **P1** | Either delete the figures, replace with conservative ranges + asterisk to a methodology page, or run a real benchmark. Currently fiction. |
| Cost-per-app figure ($0.50–$1.50) with no telemetry | **P2** | Add a real cost tracker that aggregates `cost_updated` events per workflow tagged "vibe-coder". Until then, copy reads as marketing. |
| Mobile palette button hidden | **P2** | Change `hidden sm:flex` → always-visible icon button. ~10 min. |
| Live workflow state requires drawer toggle | **P2** | Auto-open drawer on plan_created OR fold a slim live-status strip into the chat thread. Sprint S2 territory. |
| 2-test flake on retry | **P2** | Identify the flaky tests + stabilise. Will start failing CI more often as test count grows. |
| 45% of agents have no dedicated unit test | **P3** | Backfill behavioral tests in batches. 2-3 day effort. |
| ISO 27001 crawler rate-limit per-instance only | **P3** | Move to Redis-backed token bucket. Only matters if scaled to multi-replica deploys. |
| OCR confidence 60% — agents don't filter on it | **P3** | Add `parseConfidence < 0.7` filter at the agent context-injection layer. ~2 hours. |

---

## What's missing entirely

These are features the marketing implies but code doesn't ship:

1. **Inline approvals in chat** — README says "human approvals on every high-risk action", landing says "approval-gated where it matters". The code has approvals; the UX traps them on `/audit`. **Most laymen will give up before finding the queue.**
2. **Cost transparency** — claimed cost figures ($0.50–$1.50/app) with no surfaced cost panel anywhere. `cost_updated` events fire and accumulate but aren't displayed during execution.
3. **Auto-repair as a runtime behavior** — `RepairService` exists in isolation; never invoked.
4. **Time-saved benchmarking** — every "X hours → Y minutes" figure on the landing is unsubstantiated.
5. **Mobile-first cockpit** — palette unreachable on phones; rail popover misaligned.
6. **First-action moment after onboarding** — "Ready!" step is a dead-end with no "try this first" call-out.
7. **LLM-key not-set guard** — workflows can run with no API key and silently degrade. No user-facing warning. (S4 of the active plan addresses this.)

## What the platform DOES deliver well

These are real and ship-ready as-is:

1. **LangGraph orchestrator** with Postgres checkpoints, native pause/resume — the engine room is solid.
2. **Audit pack engagement flow** — plan → seed → test → workpaper → reviewer-approval → HMAC-signed final pack. Gate logic is hard, error class real.
3. **External Auditor Portal** — SHA-256 token hashing + `timingSafeEqual` + engagement-isolation middleware. Cryptographically sound.
4. **Tool registry** with maturity labels CI-enforced.
5. **Trust layer** — citation density gate, PII redactor at the LLM boundary, structured output via OpenAI Responses API json_schema strict.
6. **38 agents** real and registered.
7. **S1 cockpit rail + Cmd+K palette** — clean simplification of the 15-item sidebar.
8. **Truth-check CI** — `scripts/check-docs-truth.ts` blocks landing/code drift.

---

## 8 P1 items to close before promotion (ordered by value/effort)

| # | Item | Effort | Why it blocks promotion |
|---|---|---|---|
| 1 | Update README badge `Tests-751/751` → `Tests-961_passing` (or remove the stale number entirely) | 1 min | First impression — anyone scanning the README sees a stale claim. |
| 2 | Delete or asterisk the "X hours → Y minutes" outcome figures on the landing | 30 min | Aspirational marketing fiction. A single sceptical visitor checks one of them and the trust collapses. |
| 3 | Wire `RepairService` into the LangGraph worker-node failure path | 1 day | Featured as a hardening pillar; not actually active. Easy to fix; high credibility win. |
| 4 | Surface approvals INLINE in chat (not just on `/audit`) — Sprint S2 of the cockpit plan | 3-5 days | The single biggest UX promise the cockpit-first design fails today. Required for a layman demo. |
| 5 | Either (a) revise control count claim to "167 seeded · ~129 operationally backed" OR (b) finish operational backing for the 39 policy-only ISO controls | 30 min (a) / 3-5 days (b) | Honest framing > inflated figure. Pick (a) for speed, (b) for product depth. |
| 6 | Add real cost tracking + surface a "Cost so far" inline ticker during workflow execution | 2 days | Without this the $0.50–$1.50 claim is unsupported and a buyer can't verify it. |
| 7 | Mobile palette + rail polish (always-visible Cmd+K button on mobile, popover repositioning) | 1 day | Solo-founders pitch from phones. Today the palette is keyboard-only. |
| 8 | Identify + stabilise the 2 flaky tests | 0.5 day | Will start blocking CI as test count grows. |

**Total: ~14 days of focused work to close the eight P1 items.** Items #1, #2, #5(a), #7 can land in a single afternoon. The bigger lifts (#4, #6) overlap with the active cockpit-plan Sprint S2 + S4.

---

## Promotion-readiness verdict

| Audience | Ready today? | Caveats |
|---|---|---|
| **Solo founder (technical)** | YES, with caveats | They'll forgive the stale badge + drawer-toggle quirk. Will hit the approvals-on-/audit UX wall on their second workflow. |
| **Solo founder (non-technical)** | NO | Approvals UX traps them. Mobile palette unreachable. Time-saved claims won't survive their first sceptical attempt. |
| **Enterprise (audit/compliance buyer)** | YES, with caveats | Audit pack genuinely strong. Will notice 167-vs-129 control discrepancy if they read the seed file. |
| **Enterprise (general autonomy buyer)** | PARTIAL | LangGraph + checkpoints + RBAC + auditor portal are real. RepairService claim won't survive due diligence. |

**Honest overall rating: 6.4/10 for promotion today.** With the 8 P1 items closed: **8.0/10** — comfortable launch position.

---

## What this audit explicitly did NOT cover (deferred to runtime)

- Live LLM behavioral grading on real prompts (~$50–100 OpenAI tokens, 1-2 weeks)
- Browser e2e Playwright runs against a deployed instance (~3-5 days)
- Penetration test of the auditor portal (~1 week)
- Load test under realistic concurrent-workflow conditions
- 30-day production stability monitoring
- Real benchmark study to substitute for the made-up time-saved figures

These are honestly named so the product roadmap has them, not hidden so the platform looks finished.

---

## Files most worth reviewing if continuing this work

| Path | Why |
|---|---|
| `apps/web/src/components/landing/ShowTheWork.tsx` | The four time-saved cards live here — needs rewrite to either delete the figures or attach methodology footnotes. |
| `apps/web/src/lib/product-truth.ts` | Canonical claim registry — verify each entry against current code before promotion. |
| `apps/web/src/components/chat/ChatWorkspace.tsx` | 854 lines — adding inline approvals + auto-open drawer + cost ticker happens here. |
| `apps/api/src/services/repair.service.ts` | The unwired auto-repair service. Calling site needs to be added to the worker-node path. |
| `packages/swarm/src/graph/nodes/worker-node.ts` | Where RepairService should be invoked on failure. |
| `apps/web/src/components/layout/CommandPalette.tsx` | Mobile palette button visibility fix lives here. |
| `apps/web/src/components/layout/TopBar.tsx:73-83` | Cmd+K trigger button — currently `hidden sm:flex`. |
| `packages/db/seed-data/compliance-frameworks.ts` | The 167-vs-129 control discrepancy lives here. |
| `README.md:14-15` | Test badge to refresh from 751 → 961 (or remove the count). |
| `qa/a-to-z-human-level-product-audit.md` | Prior audit (commit 7e1661a) — compare deltas. |
