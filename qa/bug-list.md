# JAK Swarm — Bug list (severity-ranked)

Merges A-to-Z run (`qa/a-to-z-findings.json`, 2026-04-24 late-morning headed run) with the prior `qa/live-bug-matrix.md` (earlier-morning audit). Supersedes prior severities where the A-to-Z run produced new evidence.

## Summary

| Severity | Count | Change vs prior audit |
|---|---|---|
| Critical | 0 | unchanged |
| High | 5 | +1 (new H5 schedule persistence) |
| Medium | 6 | +1 (new M5 approval UI + M6 invalid-file UX) |
| Low | 3 | +1 (L3 refresh resume) |

## Critical

None. No crashes, no data loss, no auth leaks, no secret exposure observed.

## High

### H1 — Chat textarea hidden on empty `/workspace`
**State:** Still present. Workspace lands on a function-picker tile grid; textarea only appears after a role chip is clicked. A first-time user may never find the chat.
**Repro:** Sign in fresh → land on `/workspace` → look for a chat input.
**Evidence:** `qa/playwright-artifacts/p3-nav/workspace-landing.png` (prior), `qa/playwright-artifacts/a-to-z/roles/ceo-role-selected.png` (shows textarea ONLY after chip click).
**Fix:** In `apps/web/src/components/chat/ChatWorkspace.tsx` (or wherever the workspace body is rendered), invert the conditional: render the textarea unconditionally, render the role chips as a "quick-start" row above it, not as a gate.

### H2 — Chat final-answer stub leak is deterministic on legacy runtime
**State:** Reclassified from "intermittent" to **"100% reproducible on prod's current runtime config"**. 10/10 role+workflow tests on 2026-04-24 A-to-Z run produced the stub.
**Repro:** Send any prompt to any role → wait for completion.
**Actual:** `"Agents completed their work but did not produce a user-facing response. View the run in Traces for structured output."`
**Expected:** The Commander's `directAnswer` or a markdown synthesis of worker outputs.
**Evidence:** findings 1-8 (every role) + 9, 13, 14 (workflow scenarios) in `qa/a-to-z-findings.json`. Screenshots in `qa/playwright-artifacts/a-to-z/roles/`.
**Root cause (two-part):**
1. The `GET /workflows/:id` recovery layer in `apps/api/src/routes/workflows.routes.ts` doesn't match the trace shapes the legacy SwarmGraph currently emits. Workers produce output, but the recovery's `findDirectAnswer` + `findLongestWorkerOutput` fallbacks are returning `null`.
2. Even when recovery matched, the chat would only see the "completed" event plus `finalOutput` — it doesn't re-query the trace on a stub response.
**Fix order:**
- Short term: extend the recovery to walk ALL `WORKER_*` traces and `compileFinalOutput`-style synthesize a markdown reply when `finalOutput` equals the stub string.
- Medium term: flip prod env to `JAK_EXECUTION_ENGINE=openai-first` + `JAK_OPENAI_RUNTIME_AGENTS=commander,planner,research` (migration code merged at `ef68e75`; the Responses-API structured-output path eliminates the stub at the source).

### H3 — Landing markets "Legal" specialist; no role chip exists
**State:** Unchanged. `legal.agent.ts` exists in the agent registry; role picker in `/workspace` still shows 8 roles (CEO, CMO, CTO, Coding, Research, Design, Auto, Engineer, Marketing) and no Legal chip.
**Fix:** Add Legal to `ROLE_LIST` in `apps/web/src/lib/role-config.ts`; map to `WORKER_LEGAL`. 5-line change.

### H4 — `/analytics` SWR race — body empty for 4-5s on cold load
**State:** Present in prior audit; not re-exercised in A-to-Z run (skipped because analytics takes time to load and wasn't on the critical path).
**Fix:** Suspense boundary + chart-shaped skeletons in `apps/web/src/app/(dashboard)/analytics/page.tsx`.

### H5 — **NEW.** Chat-driven scheduling does not persist to `/schedules`
**Repro:** Send CMO `"Schedule 10 LinkedIn posts for this week…"` → wait for completion → navigate to `/schedules`.
**Actual:** `"No schedules yet. Create a schedule to run workflows automatically"`.
**Expected:** Either a new Schedule row in the list (status: pending approval) OR an in-chat "I'll create this schedule — review and approve?" card that, on approval, creates the row.
**Evidence:** finding 10 in `qa/a-to-z-findings.json`, `qa/playwright-artifacts/a-to-z/workflows/schedules-after-cmo.png`.
**Fix:** When the swarm emits a scheduling intent, the API needs to write a `Schedule` row (status=`pending_approval`) and return a chat card payload that references it. Likely touches `apps/api/src/services/swarm-execution.service.ts` (intent detection) + `apps/api/src/routes/schedules.routes.ts` (write path) + chat-message renderer (card component).

## Medium

### M1 — No `not-found.tsx` — unknown routes render dashboard shell with empty body
**State:** Unchanged. `/this-does-not-exist-xyz` → sidebar + empty main area.
**Fix:** Create `apps/web/src/app/not-found.tsx` with a clear message + link to `/workspace`.

### M2 — LinkedIn integration tile missing from `/integrations`
**State:** Unchanged. Adapter + tool present; no UI tile.
**Fix:** Register LinkedIn in the integrations directory page's provider list.

### M3 — Salesforce integration tile missing
**State:** Unchanged. No adapter, no tile. Either ship the Salesforce adapter or drop Salesforce from "supported CRMs" framing.

### M4 — `/skills` shows `Installed (0)` for new tenants; 122 built-in tools not surfaced
**State:** Unchanged.
**Fix:** Populate the Skills page with the built-in tool registry (filtered by tenant industry pack), rendered as read-only tiles with maturity labels.

### M5 — **NEW.** Approval gate doesn't surface in chat
**Repro:** Send a prompt that should trigger approval, e.g. `"Send an email to reetu004@gmail.com right now"`.
**Actual:** stub (same as H2).
**Expected:** Either "I need your approval to send this email — approve / deny" card in chat, or a pending-approval row in the sidebar that requires explicit click-through.
**Evidence:** finding 15 in `a-to-z-findings.json`.
**Fix:** Chat message renderer needs a branch for `state === 'awaiting_approval'` that renders an approval card component with approve/deny buttons wired to `POST /approvals/:id/decide`.

### M6 — **NEW.** `.exe` upload fails silently (415 server-side, no UI feedback)
**Repro:** Drop a `.exe` file into the Files drop-zone.
**Actual:** Server returns `415 Unsupported Media Type`; UI shows no error. Drop-zone looks unchanged.
**Expected:** Red toast or inline error ("We only accept PDF, DOCX, CSV, XLSX, PNG, TXT, MD — `.exe` is not supported.").
**Evidence:** finding 19, console error `"Failed to load resource: the server responded with a status of 415"`.
**Fix:** Intercept the `POST /documents/upload` 4xx in the Files page hook; render the server's error body as a toast.

## Low

### L1 — `/swarm` row count differs across runs without explanation
**State:** Unchanged. Run 1 saw 22 rows; a prior run saw 2. Likely recency scoping.
**Fix:** Add a time-window selector (Last 7d / 30d / All).

### L2 — Workspace `RECENT` entries persist in `localStorage` after sign-out
**State:** Unchanged.
**Fix:** Call `useConversationStore.persist.clearStorage()` in the sign-out handler.

### L3 — **NEW.** Chat SSE does not reattach after page refresh mid-workflow
**Repro:** Submit a long prompt → wait 10s for `worker_started` → refresh.
**Actual:** Page reloads, sidebar shows conversation row in RECENT, but chat is frozen at the pre-refresh state. `worker_completed` events that land after refresh are not visible.
**Expected:** Either resume streaming from the last SSE position OR poll `GET /workflows/:id` every few seconds until `completed`.
**Evidence:** finding 22, `qa/playwright-artifacts/a-to-z/failures/refresh-before.png` / `refresh-after.png`.
**Fix:** On workspace mount, if there's an active workflow in the conversation state, re-open the SSE stream (or fallback poll) until the workflow terminal state.

## Triage

Ordered for fastest user-visible ROI:

1. **H2** — flip the prod flags (10 minutes, zero code change) + extend recovery (half-day). Unlocks 10 failing tests to working.
2. **H5** — schedule persistence. Single demo scenario made real.
3. **H1** — workspace empty-state. One-line conditional invert.
4. **M5** — approval card in chat. Surfaces the trust story.
5. **H3** — Legal role chip. 5-line change.
6. **M2 + M3** — integrations tiles (or remove from landing).
7. **H4** — analytics skeletons.
8. **M1** — not-found page.
9. **M4** — skills populated from registry.
10. **M6** — file-upload toast.
11. **L1 + L2 + L3** — polish.

**Time budget estimate for H1 + H2 + H3 + H5 + M5 combined:** ~1-2 engineer-days. That single batch delivers the majority of the perceived-quality improvement this product needs.
