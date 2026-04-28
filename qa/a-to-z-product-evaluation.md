# JAK Swarm — A-to-Z product evaluation (executive summary)

**Run date:** 2026-04-24
**Site under test:** `https://jakswarm.com`
**API under test:** `https://jak-swarm-api.onrender.com`
**Deployed commit:** `ef68e75f516c6b27e78364cd63e7b0a2236c7a68` (Phase 8 migration code merged)
**Runtime flags in prod:** `executionEngine=legacy`, `workflowRuntime=swarmgraph`, `openaiRuntimeAgents=[]`
**Spec:** `tests/e2e/qa-a-to-z.spec.ts` (22 tests, headed, 6.9m wall clock)
**Previous audit:** `qa/live-human-e2e-report.md` (2026-04-24 earlier run)
**Raw findings:** `qa/a-to-z-findings.json`, `qa/playwright-artifacts/a-to-z/`

## One-line verdict

**Backend is real; middle-of-the-product (the chat reply) is broken.** Every marketed capability has a backend implementation that executes, produces output, and is visible as a row in `/swarm` — but the chat surface that users actually see delivers the "did not produce a user-facing response" stub on **10 of 10** role+workflow tests. This is the single highest-leverage bug in the product. The migration that fixes it (Phase 4 OpenAI-first + Phase 5 lifecycle state machine + Phase 7 full rollout) has shipped to `main` as of `ef68e75` but the feature flags have not been flipped in the prod environment.

## What works, honestly (evidence-backed)

- **Auth end-to-end.** Supabase login, session persistence, sign-out, route protection with `redirectTo` preservation. Zero issues.
- **All 10 dashboard pages render.** Workspace, Swarm Inspector, Schedules, Builder, Analytics, Integrations, Files, Knowledge, Skills, Settings.
- **Workflow execution is real on the backend.** `POST /workflows` returns 202, SSE stream delivers events, `GET /workflows/:id` returns trace JSON, `/swarm` lists 22 recent rows with per-agent timeline + tool-call data. **Not** vapor.
- **Builder project creation works end-to-end.** Created `qa-atoz-1777015401043` live; `POST /projects` returned 201; the detail page renders editor + prompt UI + file tree + checkpoints. Go see it at `/builder/cmocl38bm0031l41xapu3logv`.
- **File upload UI** exists and fetches `/files` correctly; `.exe` upload is correctly rejected server-side with HTTP 415 (good — validation is real).
- **Audit trail** (`/swarm` Inspector) shows 22 workflow rows with per-agent traces, timing, input/output JSON, tool calls. This is arguably the best surface in the product.
- **Backend health.** `/health` = ok, DB latency 500ms (acceptable, could be tighter), Redis latency 1ms, API uptime 4987s at test time.
- **Resilience basics.** 100,000-char paste does not crash the chat input. Mobile 390×844 viewport renders the workspace + header. Refresh during a running workflow reloads cleanly; the conversation row persists in the sidebar.

## What's broken (user-visible)

### HIGH — same root cause, ten symptoms

The **chat final-answer stub leak** reproduces on **every role** (CEO, CTO, CMO, Coding, Research, Design, Auto, Marketing) and **every workflow** (lead generation, browser QA, approval gate, CMO scheduling). The user submits a prompt, the SSE stream shows `worker_started`/`worker_completed` events, the workflow reaches `completed` status, and then the chat renders:

> Agents completed their work but did not produce a user-facing response. View the run in Traces for structured output.

Meanwhile `/swarm` shows the exact same workflow ID with real per-agent output — it just isn't being surfaced to the chat. The recovery layer in `GET /workflows/:id` that was meant to catch this edge case (commits landed earlier today) isn't matching the trace shapes produced by the current legacy runtime. The user asked: **"the agent dag and flow should be visible"** — and today it is only visible if the user knows to leave `/workspace`, navigate to `/swarm`, find the right row, and click to expand. That is not an acceptable first-run experience.

### HIGH — scheduling does not persist

CMO prompt `"Schedule 10 LinkedIn posts …"` ran a workflow (returned 202, streamed, completed), but `/schedules` still shows "No schedules yet". The planner/worker may have *generated* a schedule plan internally — but no row was written to the Schedule DB, and no CTA was surfaced to the user ("Review this schedule?"). This is the same category of bug as the stub leak: the action was taken inside the swarm, but never crossed the boundary into the product's durable state.

### MEDIUM

- **Approval gate doesn't surface approval UI.** When a prompt implies a risky action ("send an email to yourself now"), the product returns the stub instead of pausing with an approval card. Approvals are real in the backend (`approval-node.ts`) but the chat surface doesn't render the `awaiting_approval` state.
- **.exe upload fails silently.** Server returns HTTP 415 (correct), but the UI doesn't show a user-visible error — only a console error. User drops a file, it just… disappears.

### INFO (not bugs, but worth noting)

- **Migration code is deployed but dormant.** `/version` shows `executionEngine=legacy`, `workflowRuntime=swarmgraph`, `openaiRuntimeAgents=[]`. The 8-phase migration this session shipped (OpenAI-first runtime + LangGraph wrapper + lifecycle state machine + benchmark harness) is compiled into the deployed bundle but not activated. Flipping the flags is a deploy-env change, not a code change.
- **Refresh recovery.** Conversations persist in the sidebar after refresh, but the *streaming* state of an in-progress workflow is not resumed (chat shows the prior state, not live events). Not a crash — just not delightful.

## Feature-readiness summary

Full matrix in `qa/feature-readiness-matrix.md`. Counts:

| Tier | Count | Examples |
|---|---|---|
| **Production-ready** | 6 | Auth, Sign-out, Dashboard nav shell, `/swarm` Inspector, `/health` + `/version`, 100k input handling |
| **Beta** | 5 | Builder create→detail, File upload UI, Knowledge CRUD, Schedules list view, Role picker (minus Legal) |
| **UI only, backend not wired** | 2 | `/skills` page (empty for new tenants), Approval gate chat surface |
| **Backend only, not surfaced to UI** | 3 | 122 built-in tools (no `/skills` tile), Legal role worker (no role chip), Schedule persistence from chat |
| **Broken or misleading** | 4 | Chat final-answer stub leak, CMO scheduling flow, Analytics SWR race, Unknown-route handling |
| **Missing entirely** | 3 | LinkedIn integration tile, Salesforce integration tile, `apps/web/src/app/not-found.tsx` |

## Top 3 things to fix first

1. **Chat final-answer rendering** (both the recovery layer AND flipping the prod flags to `openai-first`). Fixes 10 of 10 user-facing HIGH failures in one change. Details in `qa/implementation-gap-plan.md:§1`.
2. **Surface the agent DAG inline in the chat.** User explicitly asked for this. Per-agent timeline with status badges and tool-call summaries rendered *below* the final answer, not hidden behind `/swarm`. Users should never have to leave `/workspace` to understand what happened.
3. **Wire schedule persistence from chat to `/schedules`.** When the swarm emits a scheduling plan, persist it as a `Schedule` DB row in a `pending_approval` state, and render a "Review schedule" card in the chat. Without this, CMO scheduling is a demo-only feature.

## Honest bottom line

JAK Swarm is **not** a demo-grade shell — the backend, orchestration, persistence, auth, and tool registry are real. But the **chat surface**, which is what a user interacts with 95% of the time, has a deterministic failure that makes the product feel broken on first run. The good news is that every piece needed to fix this is already in the codebase: the migration shipped, the recovery layer exists, the trace data is complete. What's missing is wiring and a flag flip. Details and ordered plan in `qa/implementation-gap-plan.md`.
