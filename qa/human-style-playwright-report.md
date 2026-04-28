# JAK Swarm — Human-style Playwright walkthrough

Headed run against `https://jakswarm.com` as a real user would experience it. 22 tests, 6.9 minutes wall-clock, full Chromium UI visible on screen. The operator watched every step. This document is the narrative companion to `qa/a-to-z-findings.json` and the screenshots under `qa/playwright-artifacts/a-to-z/`.

## Phase 4 — Role-by-role workflow test

The goal here: send each marketed specialist a realistic prompt and see if the chat gives a real answer. Each test clicks into the workspace, clicks the role chip first (because of the H1 empty-state bug — the textarea is hidden until a function is selected), types the prompt, clicks Send, and waits up to 4 minutes for a final assistant message that isn't the stub.

### CEO — "Create a strategy plan for launching JAK to small businesses…"
- Role chip found and clicked: ✓ (`roles/ceo-role-selected.png`)
- Prompt typed, Send enabled: ✓ (`roles/ceo-prompt-typed.png`)
- Submit → `POST /workflows` returned 202, `GET /workflows/:id/stream` opened, `worker_started` events flowed
- Workflow reached `completed` status, `GET /workflows/:id` returned 200
- Final chat bubble: **`"Agents completed their work but did not produce a user-facing response. View the run in Traces for structured output."`**
- Verdict: **HIGH / broken.** Workflow ran on the backend. Chat shows nothing useful. Bug H2 confirmed.

### CTO, CMO, Coding, Research, Design, Auto, Marketing
Same exact pattern. Same exact stub. 7 more times. The bug is not intermittent — on the current prod runtime (`legacy` + `swarmgraph`) it is **deterministic**. That flips the H2 classification from "intermittent" (prior audit) to "the default state". Evidence: findings 1-8 in `a-to-z-findings.json`, screenshots `roles/*-final.png`.

**What the Inspector showed** (`/swarm`) for these same runs: 8 new rows, each with 6 agent traces (Commander, Planner, Router, Guardrail, Worker, Verifier), each with input/output JSON, tool calls, and real durations. The workers produced real content. **The chat just never saw it.** That's the bug.

**What the user asked for during this run:** "the agent dag and flow should be visible". Today it's visible in `/swarm`, not in the chat. That's the core UX gap.

## Phase 5 — End-to-end workflow scenarios

### P5.A — CMO scheduling workflow
Prompt: `"Schedule 10 LinkedIn posts for this week about JAK Swarm's launch. Space them across Mon–Fri. Require approval before publishing anything."`
- Workflow ran, returned stub (same as Phase 4)
- Navigated to `/schedules` immediately after
- Result: **"No schedules yet"** — zero rows created. The planner may have generated a schedule plan, but it never crossed the boundary into the Schedule DB or into a user-facing "Review this?" card.
- Screenshot: `workflows/schedules-after-cmo.png`
- **New HIGH bug** not caught in the prior audit.

### P5.B — Builder
Prompt: "Build me a simple landing page…"
- Clicked `New Project` → modal opened
- Typed name `qa-atoz-1777015401043`, selected `nextjs` framework
- Clicked Create → `POST /projects` → 201 → redirected to `/builder/cmocl38bm0031l41xapu3logv`
- Detail page rendered: editor, prompt area, file tree ("No files yet"), checkpoints tab, Deploy button, Screenshot button
- Did not exercise the generate → preview → deploy loop in this run (covered in `qa-world-class.spec.ts`)
- **Verdict: PARTIAL (working end of the flow tested).** Project creation is real. Later stages exist but weren't driven here.

### P5.C — Document evaluation entry
Navigated to `/files`. Saw "0 files · 0 indexed" + drop-zone. 6 API calls observed on page load, including `GET /files`. The page works. Didn't upload an actual pitch deck in this run — P7.1 covered the invalid-file-type case instead.

### P5.D — Lead generation
Prompt: `"Find 10 leads for me in the Indian stock broker industry: company name, a decision-maker title, and 1-line why they might buy JAK. Present as a table."`
Role chip: Auto.
- Same stub. No table in chat. Worker trace in `/swarm` may contain the list — user can't see it.
- **HIGH / broken**, same root cause as Phase 4.

### P5.E — Browser QA
Prompt: `"Visit https://example.com, read the page, then tell me the exact headline, the first paragraph, and whether the page uses HTTPS. Be honest if the browser tool is unavailable."`
- Same stub. Didn't render a QA report in chat.
- **HIGH / broken.** If the browser tool did run (it should have via Playwright-inside-Playwright tool registry), the output is in the trace but not surfaced.

### P5.F — Approval gate
Prompt: `"Send an email to reetu004@gmail.com right now that says 'JAK test approval gate 1777015401043'. Do not skip approval; require me to approve before sending."`
- Expected: an approval card, a "pending approval" row in the sidebar, or at minimum a "I need your approval to send this email" chat reply.
- Actual: same stub. No approval framing. No card.
- **MEDIUM / partial** — the approval backend is real; the chat surface isn't exposing it.

### P5.G — Audit trace
Navigated to `/swarm`. 22 workflow rows visible, newest first, ordered by recency. Clicked the top row. Result:
- Expanded inline to show per-agent timeline
- Each agent card: role badge, status, duration, input JSON, output JSON, tool calls
- Filter tabs (All / Active / Completed / Failed) present
- Refresh button present
- **Verdict: WORKING. This is the strongest surface in the product.** It's a near-professional observability view that most AI products simply don't have. The product would benefit enormously from projecting a compact version of this *into the chat* so the user doesn't have to leave `/workspace` to see what happened.

## Phase 6 — Backend verification

### `/version`
```json
{
  "gitCommit": "ef68e75f516c6b27e78364cd63e7b0a2236c7a68",
  "gitBranch": "main",
  "buildId": "srv-d7eed8l8nd3s73bcjv30-6d795b5d66-6gl9r",
  "startedAt": "2026-04-24T06:01:45.796Z",
  "uptimeSeconds": 4987,
  "executionEngine": "legacy",
  "workflowRuntime": "swarmgraph",
  "openaiRuntimeAgents": []
}
```
Key takeaway: **the OpenAI-first migration is deployed but dormant.** Every piece of the fix for H2 is compiled into this bundle. Activating it is a `JAK_EXECUTION_ENGINE=openai-first` + `JAK_OPENAI_RUNTIME_AGENTS=commander,planner,research` env flip and a pod restart. No code change required.

### `/health`
```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "ok", "latencyMs": 500 },
    "redis":    { "status": "ok", "latencyMs": 1 }
  }
}
```
- DB 500ms latency is not catastrophic but is noticeably higher than Redis 1ms — worth a Grafana-level investigation (cold-start pooling on Render?).
- Redis 1ms = local-network fast, fine.

## Phase 7 — Failure hunting

### P7.1 — Invalid file type
Dropped `C:/Users/reetu/Desktop/JAK/jak-swarm/qa/playwright-artifacts/a-to-z/_tmp-forbidden.exe` (a 30-byte text file renamed `.exe`) into the Files drop-zone.
- Server response: `415 Unsupported Media Type` on `POST /documents/upload`
- UI: no user-visible error message, no red toast, nothing. Just a console error.
- **MEDIUM / partial.** Server validation correct (good); UX totally invisible (bad).

### P7.2 — Mobile viewport (390×844)
Navigated to `/workspace` at iPhone 12-ish viewport. Page rendered — header visible, chat stream visible, role picker accessible, prior conversation content legible. No horizontal scroll bar. **WORKING.**

### P7.3 — 100,000-character paste
Filled chat textarea with 100k identical characters. Send button still usable. Zero console errors. Zero network errors. No UI freeze. **WORKING.** (Didn't submit to backend — that would DoS the workflow queue.)

### P7.4 — Refresh during running task
Submitted a Research-role prompt, waited 10s, refreshed at `worker_started` state.
- After refresh: page reloads cleanly. Sidebar shows the conversation row in RECENT.
- Streaming state: **did not resume live events** — chat shows the pre-refresh messages, not the `worker_completed` that landed after.
- **INFO / partial.** No crash. Not truly resumable either.

## What the screenshots show (one paragraph per page)

- `roles/*-final.png` — Each role's workspace with the same stub message. Side-by-side they look identical — same gray bubble, same text, same "View in Traces" link.
- `workflows/schedules-after-cmo.png` — A beautiful empty-state page that shouldn't be empty after a scheduling request.
- `workflows/builder-detail-landing.png` — The Builder detail page, clean, ready, with no files yet. Demonstrates the create loop works.
- `workflows/audit-trace-list.png` + `audit-trace-expanded.png` — The strongest visual evidence that the backend actually works. Rows, statuses, ages, durations, agent counts, expand-to-timeline. Real product.
- `failures/invalid-filetype.png` — A Files page showing zero evidence that a `.exe` upload just failed. The drop zone looks exactly the same as before. That's the bug.
- `failures/mobile-workspace.png` — Mobile rendering is fine.
- `failures/refresh-before.png` / `refresh-after.png` — Chat before refresh has active events; after refresh the chat row is still there but streaming is dead.

## Operator's honest read

This product is **much closer to shipping than a first impression suggests**. A new user who lands, signs in, types "hi", and sees the stub — that user walks away thinking "nothing works". But the Inspector tells a completely different story: the backend is a real, observable, multi-agent orchestrator with durable traces and real tool calls. The gap is one rendering layer and one env-flag flip.

If the chat showed the Commander's `directAnswer` *or* a compact version of the Inspector's agent-by-agent summary, JAK Swarm would feel like a much more complete product than it does right now. That's the single-highest-leverage change available.
