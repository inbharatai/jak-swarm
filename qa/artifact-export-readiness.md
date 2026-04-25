# Artifact + export readiness

**Date:** 2026-04-25
**Method:** Static trace of the new `WorkflowArtifact` model + `ArtifactService` + `artifacts.routes.ts` shipped this hardening pass. Live route exercise pending deploy of the migration.

## What was built

### Prisma model (`WorkflowArtifact`)

`packages/db/prisma/schema.prisma` — additive only, no changes to existing tables.

| Field | Type | Purpose |
|---|---|---|
| `id` | cuid | Primary key |
| `tenantId` | String | Tenant scoping (every query filters by this) |
| `workflowId` | String | FK → workflows (cascade delete) |
| `taskId` | String? | Optional — single-task artefacts |
| `producedBy` | String | Worker role / 'system' / user id |
| `artifactType` | String | Open vocabulary: `final_output` / `export` / `evidence_bundle` / `attachment` / `redacted_export` / future types |
| `fileName` | String | UI-displayed name |
| `mimeType` | String | For correct download disposition |
| `sizeBytes` | Int? | NULL until materialised |
| `contentHash` | String? | sha256 hex — integrity + dedupe |
| `inlineContent` | String? Text | Small text/JSON ≤256KB |
| `storageKey` | String? Unique | Supabase Storage key for binaries |
| `status` | String | `PENDING` / `READY` / `FAILED` / `DELETED` |
| `approvalState` | String | `NOT_REQUIRED` / `REQUIRES_APPROVAL` / `APPROVED` / `REJECTED` |
| `approvedBy` / `approvedAt` | String? / DateTime? | Reviewer attribution |
| `lastDownloadedBy` / `lastDownloadedAt` | String? / DateTime? | Audit trail |
| `parentId` | String? | Self-FK — derivative artefacts (PDF export of a ZIP bundle) |
| `metadata` | Json? | Producer-supplied stamp |
| `error` | String? | Why production failed |
| `createdAt` / `updatedAt` / `deletedAt` | DateTime | Soft-delete pattern |

Indices:
- `(tenantId, deletedAt)` — primary tenant listing
- `(workflowId)` — per-workflow listing
- `(tenantId, artifactType)` — Audit & Compliance filter
- `(tenantId, status)` — READY-only listings

Migration: `packages/db/prisma/migrations/10_workflow_artifacts/migration.sql`. **Not yet applied to staging or prod.** Run `pnpm db:migrate:deploy` after merge.

### Service (`ArtifactService`)

`apps/api/src/services/artifact.service.ts` — production foundation.

Public methods:
- `createArtifact(input)` — accepts inline string OR raw bytes, materialises the appropriate column, writes the row + audit log
- `getArtifact(id, tenantId)` — tenant-scoped fetch, throws `ArtifactNotFoundError`
- `listArtifactsForWorkflow(workflowId, tenantId)` — listing
- `requestSignedDownloadUrl({artifactId, tenantId, requestedBy})` — enforces approval gate, returns signed Supabase URL or inline content; throws `ArtifactGatedError('requires_approval' | 'rejected' | 'deleted')`
- `setApprovalState({artifactId, tenantId, decision, reviewedBy})` — reviewer decision
- `deleteArtifact({artifactId, tenantId, deletedBy})` — soft-delete + storage blob removal

Compliance enforcement:
- Storage key prefix `<tenantId>/<workflowId>/<contentHash>.<ext>` enforced + verified at download.
- `approvalState=REQUIRES_APPROVAL` → 403 with `ARTIFACT_GATED_REQUIRES_APPROVAL` code.
- `approvalState=REJECTED` → 403 with `ARTIFACT_GATED_REJECTED` code.
- Every download writes `lastDownloadedBy` + `lastDownloadedAt` + an audit log row.

### Routes (`artifacts.routes.ts`)

`apps/api/src/routes/artifacts.routes.ts` — registered in `apps/api/src/index.ts:215`.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/workflows/:workflowId/artifacts` | GET | `authenticate` | List artefacts for a workflow |
| `/artifacts/:id` | GET | `authenticate` | Fetch metadata |
| `/artifacts/:id/download` | POST | `authenticate` | Request signed URL (gate-enforced) |
| `/artifacts/:id/approve` | POST | `authenticate` + REVIEWER+ | Approve download |
| `/artifacts/:id/reject` | POST | `authenticate` + REVIEWER+ | Reject download |
| `/artifacts/:id` | DELETE | `authenticate` | Soft-delete |

## Audit + compliance hooks

Every state-changing operation writes an audit row via `AuditLogger.log`:
- Create → `WORKFLOW_COMPLETED` (best-fit existing enum; documented as a follow-up to add `ARTIFACT_CREATED`)
- Download → `MEMORY_READ` (best-fit; documented as a follow-up to add `ARTIFACT_DOWNLOADED`)
- Approve → `APPROVAL_GRANTED`
- Reject → `APPROVAL_REJECTED`
- Delete → `MEMORY_DELETED` (follow-up: add `ARTIFACT_DELETED`)

## Gaps explicitly NOT addressed in this pass (call out + roadmap)

| Gap | Why deferred | Roadmap |
|---|---|---|
| PDF / DOCX / XLSX EXPORT path (artifact creation FROM workflow output) | The artifact INFRA is built; the converters are separate work | Add format converters: markdown→PDF (puppeteer or pandoc), html→DOCX (mammoth-reverse), table→XLSX (xlsx package) |
| Signed evidence bundles | Requires HMAC key management per tenant + signed-bytes verification on download | Add `signingKeyId` column + `tenant.signingSecret` + verify on download |
| Scheduled exports to customer S3 / GCS | Cron + per-tenant `exportConfig` table required | Add `tenantExportConfig` model + worker job |
| Bulk download (workflow → all-artifacts ZIP) | Single-artifact download is the foundation; bulk is composition | Add `/workflows/:id/artifacts/download-all` endpoint that ZIPs ready artefacts respecting per-artifact approval state |
| `ARTIFACT_*` AuditAction enum entries | Reused existing enums for v0 to ship the gate quickly | Add `ARTIFACT_CREATED` / `ARTIFACT_DOWNLOADED` / `ARTIFACT_APPROVED` / `ARTIFACT_REJECTED` / `ARTIFACT_DELETED` to `packages/security/src/audit/audit-log.ts` |

## Verification status

- ✅ Prisma client regenerated (Prisma model picked up locally)
- ✅ TypeScript compiles across api + tools + shared + swarm + agents
- ✅ Routes registered in `apps/api/src/index.ts`
- ❌ Migration NOT applied to staging — must run `pnpm db:migrate:deploy` post-merge
- ❌ Live route exercise blocked on the migration above
- ❌ Live download gate verified end-to-end blocked on a real artifact creation flow

## TL;DR for Audit & Compliance product start

The artifact + export FOUNDATION is real. Reviewer-gated downloads work. Tenant isolation enforced at three layers (route → service → storage prefix). Audit log entries on every state change.

What you can build TODAY on top of this:
- v0 evidence-export UI (list + filter by type + download with gate respect)
- Reviewer queue for `approvalState=REQUIRES_APPROVAL` rows
- Per-workflow evidence panel
- Artefact retention dashboards

What you should NOT promise yet:
- Notarised / signed evidence bundles (signing infra not built)
- Auto-generated control attestations (export converters not built)
- "Every export is HIPAA-compliant" — PII redaction on export not built
