# Audit API

All routes are under `/audit/runs/*`, registered via `auditRunsRoutes` in `apps/api/src/index.ts`. Tenant-scoped — every route reads `request.user.tenantId` from the authenticated JWT.

## Endpoint reference

### Create + read

| Method | Path | RBAC | Body / Response |
|---|---|---|---|
| `POST` | `/audit/runs` | REVIEWER+ | `{frameworkSlug, title, scope?, periodStart, periodEnd, metadata?}` → `{id, status}` |
| `GET` | `/audit/runs` | any auth | Query: `?status=&limit=&offset=` → `{items, total, limit, offset}` |
| `GET` | `/audit/runs/:id` | any auth | → `{run, controlTests, exceptions, workpapers}` |
| `DELETE` | `/audit/runs/:id` | TENANT_ADMIN+ | → 204 (soft-delete) |

### Lifecycle drives

| Method | Path | RBAC | What it does |
|---|---|---|---|
| `POST` | `/audit/runs/:id/plan` | REVIEWER+ | Seed `ControlTest` rows from framework. PLANNING → PLANNED. |
| `POST` | `/audit/runs/:id/auto-map` | REVIEWER+ | Re-run `ComplianceMapperService` for the run's framework + period. |
| `POST` | `/audit/runs/:id/test-controls` | REVIEWER+ | Run all not-yet-passed tests. PLANNED/MAPPING → TESTING → REVIEWING. |
| `POST` | `/audit/runs/:id/controls/:controlTestId/test` | REVIEWER+ | Re-run one test (e.g. after evidence was added). |
| `POST` | `/audit/runs/:id/workpapers/generate` | REVIEWER+ | Render PDFs for every terminal-status control test. |
| `POST` | `/audit/runs/:id/workpapers/:wpId/decide` | REVIEWER+ | `{decision: 'approved'\|'rejected', reviewerNotes?}` → updated workpaper. |
| `POST` | `/audit/runs/:id/final-pack` | REVIEWER+ | Sign + persist final bundle. Refuses if any workpaper unapproved. |

### Exceptions

| Method | Path | RBAC | What it does |
|---|---|---|---|
| `POST` | `/audit/runs/:id/exceptions` | REVIEWER+ | Manually create an exception. |
| `PATCH` | `/audit/runs/:id/exceptions/:exId/remediation` | REVIEWER+ | Update remediation plan + owner + due date. Auto-advances `open → remediation_planned` if a plan is provided. |
| `POST` | `/audit/runs/:id/exceptions/:exId/decide` | REVIEWER+ | Apply a state transition. Validated against the per-exception state machine. |

## Error codes

All routes return `{error: {code, message}}` on failure. Status codes:

| Code | Meaning | Likely cause |
|---|---|---|
| 400 `INVALID_REQUEST` / `INVALID_QUERY` | Body / query failed Zod validation | Frontend sent malformed input |
| 404 `NOT_FOUND` | Run / control test / exception / workpaper not in this tenant | Stale ID or cross-tenant access |
| 409 `ILLEGAL_TRANSITION` | State machine refused | Tried to skip a state (e.g. PLANNING → COMPLETED) |
| 409 `FINAL_PACK_GATE` | Gate refused final-pack generation | Workpapers still unapproved (response includes `reason` and `details.examples`) |
| 503 `AUDIT_SCHEMA_UNAVAILABLE` | `audit_runs` table missing | Run `pnpm db:migrate:deploy` to apply migration 15 |
| 503 `COMPLIANCE_SCHEMA_UNAVAILABLE` | `compliance_frameworks` missing | Run earlier compliance migrations + `pnpm seed:compliance` |
| 503 `ARTIFACT_SCHEMA_UNAVAILABLE` | `workflow_artifacts` missing | Run migration 10 |
| 503 `BUNDLE_SIGNING_UNAVAILABLE` | `EVIDENCE_SIGNING_SECRET` env var unset | Set the secret to a 32+ byte random value |
| 500 fallback | Unexpected server error | Check API logs |

## Request/response shapes

Everything is typed in [apps/web/src/lib/api-client.ts](../apps/web/src/lib/api-client.ts) under `auditRunsApi`. The TypeScript types match the route handler shapes exactly. Use them directly in frontend code:

```ts
import { auditRunsApi, type AuditRunDetail } from '@/lib/api-client';

const run: AuditRunDetail = await auditRunsApi.get(runId);
const planResult = await auditRunsApi.plan(runId);
const testSummary = await auditRunsApi.testControls(runId);
const wpResult = await auditRunsApi.generateWorkpapers(runId);
const finalPack = await auditRunsApi.finalPack(runId);
```

## SSE channel

Audit lifecycle events fan out on the `audit_run:{id}` SSE channel via `fastify.swarm.emit()`. Subscribe to it the same way you subscribe to `workflow:{id}`. Event payload:
```ts
interface AuditLifecycleEvent {
  type:        AuditLifecycleEventType;
  auditRunId:  string;
  agentRole:   'AUDIT_COMMANDER' | 'COMPLIANCE_MAPPER' | 'CONTROL_TEST_AGENT' | 'EXCEPTION_FINDER' | 'WORKPAPER_WRITER' | 'FINAL_AUDIT_PACK_AGENT';
  timestamp:   string;
  details?:    Record<string, unknown>;
}
```

The frontend audit-runs detail page polls SWR every 15s today (real-time SSE wiring is roadmap).

## Where to look

- Routes: [apps/api/src/routes/audit-runs.routes.ts](../apps/api/src/routes/audit-runs.routes.ts)
- API client: [apps/web/src/lib/api-client.ts](../apps/web/src/lib/api-client.ts) (`auditRunsApi`)
- Registration: `apps/api/src/index.ts` — `await fastify.register(auditRunsRoutes)`
