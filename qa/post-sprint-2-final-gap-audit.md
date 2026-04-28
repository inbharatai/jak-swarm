# Post-Sprint-2 Final Gap Audit (5 Hardening Items)

**Date:** 2026-04-27
**Verified at commit:** `ff69a61`
**CI on `ff69a61`:** ✅ green
**Local unit tests:** ✅ **695/695 passing**
**Branch:** `main`

---

## 1. Repo state verification (no code changed yet)

| Check | Status |
|---|---|
| Current commit | `ff69a61` |
| Branch | `main` |
| Last 3 commits | `ff69a61` (docs/landing/RBAC) → `34491f2` (Sprint 2.5/A.6 + 2.6) → `5e161e5` (interim status) |
| CI workflow on latest commit | ✅ success |
| Local unit tests | ✅ 695/695 passed |
| Cross-package typecheck | ✅ green (web/api/swarm/agents/db/security/shared) |
| LangGraph runtime status | ✅ Native StateGraph + Postgres checkpoints (only runtime) |
| SwarmGraph deletion | ✅ DELETED — `swarm-graph.ts` and `swarm-graph-runtime.ts` removed in `34491f2` |
| `JAK_WORKFLOW_RUNTIME=swarmgraph` env-flag fallback | ✅ REMOVED — setting it logs a warning but is otherwise a no-op |
| External auditor portal | ✅ 3 Prisma models + 9 routes + 3 UI pages + 11 unit tests + security audit doc |
| README | ✅ Updated with LangGraph + auditor portal sections |
| Landing page | ✅ Updated with LangGraph mention + auditor portal card |
| Docs (Sprint 2.x) | ✅ 7 new docs in qa/ + docs/ |

---

## 2. The 5 hardening items — current state

These items were named in `qa/final-proof-report-2026-04-27.md` §20 as "this
session can't deliver" — items that were OUT OF SCOPE from the original
Sprint 2 deferred list but are required before "complete and world-class".

### Gap A — CEO super-orchestrator

**Status:** 🚫 **MISSING** (named in role-config; no top-level orchestrator agent)

**What exists today:**
- `WORKER_STRATEGIST` (CEO mapping in role config) — a single-task worker, NOT an orchestrator
- The Commander agent does intent detection + clarification gate
- Planner does workflow decomposition; Router maps tasks to workers
- The pattern today is "Planner-decomposed parallel tasks", not a CEO that delegates to CMO+CTO+CFO under it

**What's missing:**
- No single agent class that wraps Commander/Planner/Router/Worker as a "CEO experience"
- No `ceo_*` lifecycle events
- No executive-summary generation at workflow end
- No detection of "act as CEO" / "review my business" intent that activates this orchestrator
- No explicit identification of WHICH executive functions (CMO/CTO/CFO/COO) are needed for a given goal
- No "missing inputs from Company Brain" detection at the CEO level

**Files that will need to change:**
- `apps/api/src/services/ceo-orchestrator.service.ts` (NEW)
- `packages/swarm/src/workflow-runtime/lifecycle-events.ts` (add `ceo_*` events to vocabulary)
- `apps/api/src/services/swarm-execution.service.ts` (translate ceo_* activity events → workflow lifecycle events)
- `packages/agents/src/base/agent-context.ts` (add `ceo_*` to AgentActivityEvent if needed)
- `apps/api/src/routes/workflows.routes.ts` (new endpoint or mode flag)
- `apps/web/src/lib/api-client.ts` (typed client method)
- Tests + docs

### Gap B — Cross-task auto-repair

**Status:** 🟡 **PARTIAL**

**What exists today:**
- Verifier emits `needsRetry: true` for individual task failures
- Verifier-node retries up to MAX_RETRIES=2 per task before accepting result
- Single-task-failure path captured (the failing task is marked FAILED, plan advances to next viable task)
- Activity events `verification_started` / `verification_completed` exist
- BaseAgent has internal LLM retry with exponential backoff for transient API errors

**What's missing:**
- No EXPLICIT `repair_*` lifecycle events
- No error CLASSIFIER (transient vs structured-output vs permission-block vs destructive)
- No repair POLICY (decision tree: which errors are safe to auto-repair, which need human escalation)
- No auto-repair across MULTIPLE tasks when a node throws
- No `repair_escalated_to_human` event when a destructive action fails
- No central `RepairService` that records every attempt + outcome
- Cross-task auto-repair (recompute deps + skip orphans) was documented in `qa/langgraph-parity-verification.md` as a deferred follow-up after the LangGraph cutover

**Files that will need to change:**
- `apps/api/src/services/repair.service.ts` (NEW)
- `packages/swarm/src/workflow-runtime/lifecycle-events.ts` (add `repair_*` events)
- `packages/swarm/src/graph/nodes/worker-node.ts` (call RepairService on failure)
- `apps/api/src/services/swarm-execution.service.ts` (translate repair events → lifecycle)
- Tests + docs

### Gap C — Auditor email send

**Status:** 🟡 **PARTIAL** — invite created + token returned, but no email send

**What exists today:**
- `ExternalAuditorService.createInvite` returns the cleartext token in the response
- Admin can copy the token + acceptUrl from the API response and email it manually
- No automated email send

**What's missing:**
- Integration with the existing email adapter (Gmail SMTP)
- Honest status field: `email_sent` / `email_not_configured` / `email_failed`
- Don't return `success: true` if email actually wasn't sent
- UI must show "Copy invite link" when email isn't configured

**Files that will need to change:**
- `apps/api/src/services/audit/external-auditor.service.ts` (add `sendInviteEmail` method)
- `apps/api/src/routes/external-auditor.routes.ts` (response shape includes email status)
- `apps/web/src/lib/api-client.ts` (response type includes email status)
- New ExternalAuditorInvite columns: `emailStatus`, `emailSentAt`, `emailError`
- Migration to add the new columns
- Tests + docs

### Gap D — Auditor final-pack download endpoint

**Status:** 🚫 **MISSING** — `view_final_pack` scope exists in the schema but no route serves it

**What exists today:**
- Final audit packs are HMAC-signed bundles persisted via the existing `BundleService` + `WorkflowArtifact`
- The auditor portal has `view_workpapers` route that lists workpaper artifacts
- No equivalent route for the final pack
- `view_final_pack` exists in the route validator's enum of scopes

**What's missing:**
- `GET /auditor/runs/:auditRunId/final-pack/metadata` route
- `GET /auditor/runs/:auditRunId/final-pack/download` route (signed URL or stream)
- Final-pack-must-be-approved gate before download
- Download action logged via `logAction`
- UI button in the Auditor Run Review page to download

**Files that will need to change:**
- `apps/api/src/routes/external-auditor.routes.ts` (2 new routes)
- `apps/web/src/lib/api-client.ts` (2 new typed methods)
- `apps/web/src/app/auditor/runs/[id]/page.tsx` (download button when `view_final_pack` scope present)
- Tests + docs

### Gap E — Retention sweep

**Status:** 🚫 **MISSING** — no retention sweep service, route, or schedule

**What exists today:**
- Database has timestamps + soft-delete columns on most models
- No automated cleanup of expired invites, expired engagements, stale temp files, etc.

**What's missing:**
- `RetentionSweepService` with configurable retention windows
- Dry-run mode (counts what would be deleted without deleting)
- Real execution mode
- Per-tenant scoping
- Admin route to trigger sweep + view dry-run report
- Audit log entries for every deletion
- `retention_*` events
- Safe-skip for protected artifacts (final audit packs that are user-owned evidence)

**Files that will need to change:**
- `apps/api/src/services/retention-sweep.service.ts` (NEW)
- `apps/api/src/routes/admin-retention.routes.ts` (NEW; SYSTEM_ADMIN only)
- `apps/api/src/index.ts` (register routes)
- Tests + docs

---

## 3. Per-gap classification summary

| Gap | Pre-session status |
|---|---|
| A. CEO super-orchestrator | 🚫 missing |
| B. Cross-task auto-repair | 🟡 partial (single-task retry exists; cross-task + classification missing) |
| C. Auditor email send | 🟡 partial (manual copy; no email send) |
| D. Auditor final-pack download | 🚫 missing |
| E. Retention sweep | 🚫 missing |

---

## 4. Implementation priority for this session (per user's order)

1. **CEO super-orchestrator** (largest; ship first while context is freshest)
2. **Cross-task auto-repair** (medium; builds on existing verifier retry)
3. **Auditor final-pack download** (smallest; existing auditor portal extension)
4. **Auditor email send** (small; integrates with existing email adapter)
5. **Retention sweep** (medium; SYSTEM_ADMIN-only surface)

---

## 5. Honest scope reality

These five items together are **~3 weeks of focused engineering** by the same
per-item estimates I documented in the previous proof report:
- CEO super-orchestrator: ~1 week
- Cross-task auto-repair: 3-5 days
- Auditor email send: 0.5 days
- Auditor final-pack download: 1 day
- Retention sweep: ~1 week

What I will commit to in this session:
- Real code shipped for each gap (not stubs, not UI-only)
- Real unit tests for each gap (no fake assertions)
- Real lifecycle events emitted (not console.log placeholders)
- Honest deferrals named for any sub-item that genuinely cannot ship in the time available

What I will NOT do:
- Claim "world-class" for items that are minimum-viable
- Claim "production-ready" for items not exercised end-to-end
- Add UI cards for features the backend doesn't implement
- Mark "complete" anything that lacks a passing test

---

## 6. Verification gate after each gap

After each gap implementation:
- All packages typecheck (web/api/swarm/agents/db/security/shared)
- Full unit test suite passes
- New tests for the gap pass
- Lifecycle events for the gap appear in the canonical vocabulary
- No regressions in the 695 baseline tests
