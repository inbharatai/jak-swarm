# Audit & Compliance — v0 status

**Date:** 2026-04-25
**Verdict:** **v0 SHIPPED.** First customer-usable surface of the Audit & Compliance product is in `main`. Real backend, real frontend, real tests. Honest gaps documented for Phase 2.

## What v0 is

A read-only Audit & Compliance UI that uses the foundation already built (lifecycle events, approvals, artifacts, exports, signed bundles). Four tabs:

| Tab | What it does | Backend | RBAC |
|---|---|---|---|
| **Dashboard** | Compliance metrics: workflow counts (total / 24h / 7d / by-status), approval breakdown, artifact counts (by type, by approval state), signed bundle count, top actions in last 7 days | `GET /audit/dashboard` | REVIEWER+ |
| **Audit Log** | Paginated AuditLog with filters: action, resource, user, date range, free-text search. Server-side filtering. | `GET /audit/log` | Authenticated (any role) |
| **Reviewer Queue** | Pending workflow approvals + pending artifact downloads in one combined queue. Approve/reject actions wired to the real `/approvals/:id/decide` endpoint. | `GET /audit/reviewer-queue` | REVIEWER+ |
| **Workflow Trail** | Drill into one workflow's chronological event stream — merges audit-log lifecycle events + agent traces + approvals + artifacts into one sorted timeline. | `GET /audit/workflows/:id/trail` | Authenticated |

## What it is NOT (Phase 2 roadmap)

These are documented as deferred — building them faked-or-half would violate the no-dummies rule.

| Feature | Why deferred |
|---|---|
| Custom control framework mappings (SOC2, HIPAA, ISO 27001) | Each framework is its own product surface. Right call: ship audit log + trail v0, then design control mapping with one specific framework + one design partner. |
| Auto-generated control attestations | Depends on control mappings (above). |
| Scheduled exports to customer S3 / GCS | Cron + per-tenant `tenantExportConfig` table required. Adds operational surface; v0 is "trigger + download". |
| Multi-tenant aggregate reporting (for SYSTEM_ADMIN) | v0 is per-tenant. Cross-tenant rollup is a separate access tier. |
| Custom retention policies | Today retention is implicit (rows live until tenant deletion). HIPAA/GDPR work requires a sweep job + per-tenant config. |
| PII redaction on artifact exports | Foundation is in place (`detectPII` runs at upload time); applying it to exports is a converter-pipeline addition. |

## Honesty rules enforced

- ✅ **No fake data.** Every chart/list/table renders only what the backend returned. Empty states are clear and explicit ("No audit log entries match this filter").
- ✅ **Migration awareness.** When the `workflow_artifacts` migration isn't deployed, the Dashboard shows "Artifact storage not provisioned (run pnpm db:migrate:deploy)" instead of a silently empty card. Trail and Reviewer Queue degrade gracefully (no crash; missing-table catch returns `[]`).
- ✅ **RBAC enforced backend-side AND surfaced honestly.** A VIEWER who lands on /audit sees the dashboard tab gate cleanly with "Reviewer access required". Sidebar nav hides the entry from non-reviewers as a UX fix; the page-level check is the security boundary.
- ✅ **Approve/reject buttons in the reviewer queue use the real endpoints.** `approvalApi.decide()` → `POST /approvals/:id/decide` → real lifecycle events fire → audit log updated. No fake success.
- ✅ **All filters server-side.** No client-side hide-and-pretend filtering on already-fetched rows. Pagination uses `offset` + `limit`; the "matching count" reflects the server total.
- ✅ **Tenant isolation verified by tests.** `audit-routes.test.ts` confirms every query is scoped by `request.user.tenantId`; cross-tenant workflow probes return 404.

## Files added this session

### Backend
- `apps/api/src/routes/audit.routes.ts` (new — 4 routes, 290 lines)
- `apps/api/src/index.ts` (route registration)

### Frontend
- `apps/web/src/lib/api-client.ts` (extended with `auditApi` + 4 typed interfaces)
- `apps/web/src/app/(dashboard)/audit/page.tsx` (new — 4 tabs, ~480 lines)
- `apps/web/src/components/layout/ChatSidebar.tsx` (new "Audit" nav entry, REVIEWER+ gate)

### Tests
- `tests/integration/audit-routes.test.ts` (11 new tests — all 4 routes, tenant isolation, fail-safe paths)

### Docs
- `qa/audit-compliance-v0-status.md` (this file)
- Updated `qa/audit-compliance-start-gate.md` to reflect "v0 build started + shipped"

## Test results

All 88 integration + lifecycle tests pass:

| File | Count | Status |
|---|---|---|
| `packages/swarm/src/state/run-lifecycle.test.ts` | 32 | PASS |
| `tests/integration/audit-routes.test.ts` | 11 | PASS (this session) |
| `tests/integration/approval-roundtrip.test.ts` | 5 | PASS |
| `tests/integration/artifact-schema-failsafe.test.ts` | 7 | PASS |
| `tests/integration/exporters.test.ts` | 15 | PASS |
| `tests/integration/bundle-signing.test.ts` | 18 | PASS |
| **TOTAL** | **88** | **88 PASS** |

## Two operational gates remaining (operator-side, not engineering)

These don't block v0 shipping (the UI degrades gracefully when they're not satisfied) but they DO block full feature visibility:

1. **Apply migration `10_workflow_artifacts` to staging** — `pnpm db:migrate:deploy`. Until applied, the Dashboard will show "Artifact storage not provisioned" and the Reviewer Queue will only show workflow approvals (not artifact-download approvals). New `/admin/diagnostics/artifacts` endpoint reports the status.
2. **OpenAI quota top-up** — required to do live model-behaviour verification of `pnpm bench:runtime`. Audit & Compliance v0 itself has no LLM dependency; this is only relevant for verifying the broader engine.

## Next steps for the operator (after merging this commit)

1. `pnpm db:migrate:deploy` against staging
2. Open `/audit` in the deployed UI as a TENANT_ADMIN user
3. Run a workflow, approve it via the Reviewer Queue, watch the Audit Log + Trail update
4. Decide which Phase 2 surface to build first (recommendation: control framework mapping with one design partner first)
