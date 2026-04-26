# Client agent-visibility audit

**Date:** 2026-04-26
**Method:** End-to-end code trace from agent emit → graph → runner → execution-service → SSE route → ChatWorkspace cockpit. References real files in `main`. Supersedes the earlier audit at commit `df5ec62` (the gaps that audit identified — mount cockpit components, emit 4 missing events, inline approval card — have all shipped since).

## Summary verdict

The cockpit is **real, not cosmetic.** Every piece of the spec's "client should see what the AI team is doing" requirement is wired end-to-end via the lifecycle event system. Two gap categories existed in spec language vs code; this pass closes them by adding audit-specific event subtypes (Phase B+C) and an audit-run detail page (Phase E) so the audit run flow shows the same fidelity as the existing chat flow.

## Per-spec-claim classification

| Spec wants client to see | Verdict | Evidence path |
|---|---|---|
| What task was understood | **REAL** | Commander emits direct-answer or mission-brief; visible in chat thread + `cost_updated` event with model/runtime |
| What plan was created | **REAL** | `plan_created` SSE event populates cockpit `plan` state; renders via `apps/web/src/components/workspace/TaskList.tsx` |
| Which agents are working | **REAL** | Every `step_started`/`step_completed`/`tool_called`/`tool_completed` event carries `agentRole` field; ChatWorkspace renders agent name + role badge |
| What each agent is doing | **REAL** | `step_started` event includes `stepId` (task name) + `agentRole`; cockpit shows it in the task list with status flip |
| Which tools are called | **REAL** | `tool_called` event carries `toolName` + `inputSummary`; rendered as 🔧 row in cockpit chat |
| What evidence is used | **REAL after Phase B+C** | Today: `tool_completed` shows `outputSummary`. Audit-specific: `evidence_mapped` event will carry `controlId` + `evidenceCount` |
| What graph/DAG node is running | **REAL** | `apps/web/src/components/graph/WorkflowDAG.tsx` renders real plan nodes; status flips on every step event |
| What is waiting for approval | **REAL** | `paused` SSE event + `approval_required` lifecycle event; cockpit `CockpitStatusBadge` shows AWAITING_APPROVAL; chat surfaces inline approval link |
| What failed | **REAL** | `step_failed` + `failed` events emitted; cockpit footer shows error message; status badge flips to red |
| What completed | **REAL** | `step_completed` + `completed` events; cockpit shows COMPLETED badge with cost footer |
| What artifacts were generated | **REAL** | Workpapers + final pack create `WorkflowArtifact` rows; cockpit drawer + Audit dashboard reviewer queue surface them |
| Which model/runtime was used | **REAL** | `cost_updated` event carries `runtime` (e.g. `'openai-responses'`) + `model` (e.g. `'gpt-5.4'`) + `fallbackModelUsed` when applicable; cockpit footer aggregates per-workflow |
| Cost/token usage | **REAL** | `cost_updated` event carries `promptTokens`, `completionTokens`, `totalTokens`, `costUsd`; cockpit accumulates + shows on completion |
| What is real vs draft/mock/unconfigured | **REAL** | `tool_completed` event carries `outcome` field from `ToolOutcome` enum (`real_success` / `draft_created` / `mock_provider` / `not_configured` / `blocked_requires_config` / `failed`); cockpit renders distinct icon (✓ / ✎ / ⓘ / ⚙ / ⛔ / ✗) |

## What's NOT cosmetic — what backs each claim

| Claim | Code path | Test |
|---|---|---|
| All 13 lifecycle events emit on real workflow runs | `packages/swarm/src/workflow-runtime/lifecycle-events.ts` (vocabulary) → `apps/api/src/services/swarm-execution.service.ts:emitLifecycle` (chokepoint) | `tests/integration/approval-roundtrip.test.ts` (5 tests) |
| `paused` SSE event arrives when approval gate triggered | `apps/api/src/services/swarm-execution.service.ts` PAUSED branch + `apps/api/src/routes/workflows.routes.ts` SSE route | Static trace + integration test |
| Tool outcomes reflect real adapter status | `packages/tools/src/registry/tool-registry.ts:inferOutcome` | Integration tests |
| Cost telemetry includes runtime + model + fallback | `packages/agents/src/base/base-agent.ts` `cost_updated` emit | Integration tests confirm shape |
| Mock adapters don't fake-success | `packages/tools/src/adapters/email/mock-email.adapter.ts` throws on writes | Stage 1 honesty fix |
| Approve/reject buttons in reviewer queue use the real endpoint | `apps/web/src/app/(dashboard)/audit/page.tsx` `ReviewerQueueTab.decideApproval` calls `approvalApi.decide()` → `POST /approvals/:id/decide` | Real wire, no stub |

## Hardening this session adds (Phases B+C+E)

The existing 13 lifecycle events cover the generic workflow case. Audit runs need:

- `audit_run_started` — replaces generic `created` for AuditRun rows (emits with `agentRole='AUDIT_COMMANDER'`)
- `audit_plan_created` — control-test rows seeded from framework
- `evidence_mapped` — auto-mapper completed for audit run
- `control_test_started` / `control_test_completed` — per-control test execution
- `exception_found` — failed test created an AuditException
- `workpaper_generated` — PDF workpaper created (REQUIRES_APPROVAL)
- `final_pack_started` / `final_pack_generated` — signed evidence bundle

These extend (not replace) the existing 13. The `/audit/runs/:id` detail page reads them via the same `lifecycle:*` SSE channel + renders them in a per-audit cockpit.

## Verification still required (cannot be done from this code session)

Live verification requires:
1. A running staging API + DB
2. A logged-in user
3. A browser with DevTools → EventSource open

Manual recipes documented in `qa/openai-first-live-verification.md`. This audit is wiring-verified, not runtime-verified — but every claim is backed by a code path traceable in `main`.

## Risks (honest)

- The cockpit lazily computes per-workflow state from a JS Map. For a tenant with hundreds of concurrent workflows, the cockpit's `cockpitByWorkflow: Record<string, CockpitState>` will grow unboundedly until the user closes the page. Acceptable today; needs LRU cap if scale demands.
- The new audit-specific event subtypes (Phase B+C) require ChatWorkspace handlers to display them in the existing chat cockpit. Phase E's audit-run detail page renders them in a dedicated panel; full chat-cockpit handlers are deferred to a follow-up (low priority — most audit users will use the run detail page directly).
