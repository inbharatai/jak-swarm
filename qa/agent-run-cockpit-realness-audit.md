# Agent Run Cockpit — realness audit

**Date:** 2026-04-25
**Method:** End-to-end code trace from agent emit → graph → runner → execution-service → SSE route → browser. No live workflow run in this audit (would require a credentialed Render API + OpenAI key + browser session); claims below are **wiring-verified**, not **runtime-verified**. Where a runtime check is required to prove behavior, it is called out explicitly.

## Summary

The cockpit is **mostly real**. Six of nine claimed capabilities are backend-verified end-to-end. Two are **partial** (model/runtime label, mock/draft labelling). One was **a real silent gap** (auto-pause on approval emitted no SSE event) and was fixed in this pass — see `apps/api/src/services/swarm-execution.service.ts` Hardening A below.

## Per-claim verdict

| Claim | Verdict | Evidence path |
|---|---|---|
| Real run events (started / completed / failed) | **real** | swarm-execution.service.ts:645 `started`, :814 `completed`, :824 `failed` → workflows.routes.ts:751 SSE handler |
| Real agent names | **real** | base-agent.ts emits agentRole on every activity event; swarm-graph.ts:528 sets agentRole from nodeName |
| Real tool calls | **real** | base-agent.ts `executeWithTools` emits `tool_called` + `tool_completed` via ctx.emitActivity → activity-registry → swarm-runner.ts:215 graph relay |
| Real task graph nodes | **real** | swarm-graph.ts:554-575 emits `plan_created` carrying full task list with id/name/agentRole/dependsOn/status. WorkflowDAG renders this directly (no synthetic nodes). |
| Real approval state | **real (after this pass)** | Was: only manual /pause emitted SSE. Now: auto-pause on AWAITING_APPROVAL also emits `{type:'paused', reason:'awaiting_approval', pendingApprovalIds}` — see Hardening A. |
| Model / runtime label | **partial** | `cost_updated` events carry `model` field per call (base-agent.ts onLLMCallComplete). The cockpit DetailDrawer does NOT currently render this — only an aggregated cost. The runtime name (`legacy` vs `openai-responses`) is NOT emitted on any event. **Gap: small UI/event addition needed.** |
| Token / cost data | **real** | `cost_updated` event carries `promptTokens`, `completionTokens`, `costUsd`, `model`. ChatWorkspace.tsx:285 accumulates per-workflow into `costRef` and renders a footer on completion. |
| Updates during async / background | **real** | SSE stream survives backgrounded workflows because workflows.routes.ts:751 listens on `fastify.swarm.on('workflow:${id}')` which the queue worker also publishes through (Redis pub/sub when configured). |
| Distinguishes real / draft / mock / unconfigured tools | **partial — heuristic** | ChatWorkspace.tsx detects `mock`/`notice`/`warning` substrings in tool output to colour the row; the underlying tool result has no canonical `status` field today. **Gap: standardised status enum is the next hardening item.** |

## Hardening shipped in this pass

### A. Approval pause now emits SSE (real)

Previously the approval-node set `state.status = AWAITING_APPROVAL` but `swarm-execution.service.ts` only emitted SSE for `COMPLETED` / `FAILED`. When a workflow halted at an approval gate, the cockpit went silent and the user assumed the run was stuck.

**Fix:** added `else if (dbStatus === 'PAUSED')` branch at `swarm-execution.service.ts:833-846` that emits `{type:'paused', reason:'awaiting_approval', pendingApprovalIds: [...]}`.

ChatWorkspace already handles `evType === 'paused'` (line 400 of ChatWorkspace.tsx) and flips `cockpit.status = 'paused'`, so no frontend change is needed for the fix to be visible.

### B. (still pending in this pass)

- Standardised tool result status enum (real_success / draft / mock / not_configured / blocked / failed) — see hardening item 3 in the master plan.
- `cost_updated` event carries `model`+`runtime`; cockpit DetailDrawer renders it.

## Verification still required (cannot be done from this code session)

The following must be confirmed by an actual workflow run on staging or local with a real OpenAI key + browser open on `/workspace`:

1. Run `hi` and observe `started` → `connected` → cost_updated → `completed` arrive in DevTools Network → EventSource.
2. Run a multi-task workflow (e.g. CMO LinkedIn post) and confirm `plan_created` populates the TaskList with the right number of items, then each `worker_started` flips IN_PROGRESS, then `worker_completed` flips COMPLETED.
3. Run an action that triggers an approval gate (e.g. `send an email to test@example.com about X` with no auto-approve) and confirm the new `paused` event arrives and the approval link appears in the chat.
4. Cancel a running workflow via the Runs page and confirm the cockpit status flips and no further events arrive.

## Risks

- Without runtime verification (#1–4 above), the trace audit can confirm wiring but cannot prove there's no off-by-one or off-by-state-mismatch issue in the live SSE stream.
- The `cost_updated` event today fires per LLM call. For a 30-call workflow that's 30 SSE writes. ChatWorkspace coalesces locally but the API → Vercel → browser bandwidth is not free. Acceptable today; warrants throttling at scale.
- Two cockpit components (`AgentCard`, `ApprovalsInbox`) exist in the codebase but are NOT mounted by the chat DetailDrawer. This audit confirms the TaskList + WorkflowDAG mount only; the other two would be follow-up work.
