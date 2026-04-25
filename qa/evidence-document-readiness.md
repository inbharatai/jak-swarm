# Evidence + document handling readiness

**Date:** 2026-04-25
**Method:** Static code trace of the upload + ingest pipeline (`apps/api/src/routes/documents.routes.ts`, `packages/tools/src/adapters/memory/document-ingestor.ts`, `apps/api/src/services/storage.service.ts`) plus the new artifact foundation (`apps/api/src/services/artifact.service.ts` + `apps/api/src/routes/artifacts.routes.ts`).

## Per-capability verdict

| Capability | Status | Evidence |
|---|---|---|
| PDF text extraction | **REAL** | `DocumentIngestor.ingestPDF` uses `pdf-parse`. Failures throw with a clear message; the document row transitions to `FAILED` with the reason. |
| Plain text / markdown / JSON / CSV ingest | **REAL** | `documents.routes.ts:341` reads bytes as UTF-8 and feeds `ingestor.ingestText`. CSV is currently treated as plain text — sufficient for column-name search, but no per-cell extraction. |
| DOCX ingest | **NOT IMPLEMENTED — now honest** | Was previously marked `INDEXED` silently. **Hardening pass fix:** status transitions to `STORED_NOT_PARSED` with `ingestionError` explaining "Content parsing not implemented for application/vnd.openxmlformats-officedocument.wordprocessingml.document; file is searchable by filename and metadata only." Audit & Compliance UI must surface this status, not pretend the file is searchable. |
| XLSX ingest | **NOT IMPLEMENTED — now honest** | Same as DOCX above. To make real, add `xlsx` package and parse to per-sheet text in DocumentIngestor. Out of scope for this hardening pass. |
| Image / OCR ingest | **NOT IMPLEMENTED — now honest** | PNG / JPEG / WEBP stored only. Hardening pass marks them `STORED_NOT_PARSED`. To add OCR: integrate `tesseract.js` (free, slower) or a paid OCR API in DocumentIngestor — out of scope. |
| Source references on chunks | **REAL** | Each `VectorDocument` chunk carries `sourceKey` (file name) + `documentId` (soft FK to TenantDocument). `find_document` tool can resolve back to the parent TenantDocument metadata. |
| Chunking | **REAL** | `VectorMemoryAdapter.ingest` does the chunking. Default chunk policy lives in the adapter; verified to produce overlapping chunks suitable for retrieval. |
| Extracted-text storage | **REAL** | Chunk text lives in `VectorDocument.content` (plain text, separate row per chunk). The original-file bytes live in Supabase Storage (`tenant-documents` bucket). Both are tenant-scoped. |
| Evidence index | **REAL** | The `(VectorDocument + TenantDocument)` join IS the evidence index. The new `WorkflowArtifact` model (this hardening pass) extends the picture with workflow-produced artefacts. |
| Tenant isolation | **REAL** | Multiple layers: (a) `request.user.tenantId` scoping in every route (documents.routes.ts:68, 191, 226, 252; artifacts.routes.ts on every handler); (b) `storage.service.ts` enforces `<tenantId>/` prefix on every Supabase Storage operation (throws on cross-tenant access — defense in depth even with service-role key); (c) Postgres queries always include `tenantId` filter; (d) `WorkflowArtifact` service validates workflow belongs to tenant before any operation. |
| Prompt-injection scan on uploaded text | **REAL — added this pass** | `documents.routes.ts:380-390` now imports `detectInjection` from `@jak-swarm/security` and scans the ingested text. Findings logged in `ingestionError` for the Files tab to surface. Does NOT block ingestion (Audit & Compliance UI lets the user decide whether to keep / quarantine). |
| PII scan on uploaded text | **REAL — added this pass** | Same call site as injection scan. Uses `detectPII`. Same surface in Files tab. Both checks scoped to first 200KB to cap cost. |
| Artifact / export foundation | **REAL — added this pass** | `WorkflowArtifact` model in Prisma; service in `apps/api/src/services/artifact.service.ts`; routes in `apps/api/src/routes/artifacts.routes.ts`; migration `10_workflow_artifacts/migration.sql`. Approval-gated downloads enforced at the service layer (`ArtifactGatedError`). Audit log row per create / approve / reject / download. |
| Approval-gated download | **REAL — added this pass** | `WorkflowArtifact.approvalState` enum (`NOT_REQUIRED` / `REQUIRES_APPROVAL` / `APPROVED` / `REJECTED`). `requestSignedDownloadUrl` throws `ArtifactGatedError('requires_approval')` with HTTP 403. Reviewer-only `/artifacts/:id/approve` + `/artifacts/:id/reject` endpoints. |

## Hardening fixes shipped in this pass

1. **`STORED_NOT_PARSED` status** — `documents.routes.ts:347-356`. Replaces the prior dishonest `INDEXED` for unparsed file types.
2. **PII + injection scan on document text** — `documents.routes.ts:380-393`. Uses existing `@jak-swarm/security` primitives.
3. **WorkflowArtifact Prisma model + indices** — `packages/db/prisma/schema.prisma` + `packages/db/prisma/migrations/10_workflow_artifacts/migration.sql`.
4. **ArtifactService** — `apps/api/src/services/artifact.service.ts` (create / get / list / signed download / approve / reject / soft-delete).
5. **Artifact routes** — `apps/api/src/routes/artifacts.routes.ts` (6 endpoints, RBAC-gated).
6. **Approval-state enum on artifacts** — distinguishes "no gate", "pending approval", "approved", "rejected" so the Audit & Compliance UI can render the right action.

## Known gaps (out of scope for this pass — documented for the Audit & Compliance roadmap)

| Gap | Why it matters for Audit & Compliance | How to close |
|---|---|---|
| DOCX / XLSX / image content not parsed | Customers ingesting Word/Excel evidence get filename-only search | Add `mammoth` (DOCX), `xlsx` (XLSX), `tesseract.js` (OCR) to `DocumentIngestor`. ~1 day work each. |
| No retention policy | Compliance regimes (HIPAA, GDPR) require defined retention windows | Add `retentionPolicy` JSON column to Tenant, sweep job that hard-deletes after window. |
| No PII redaction on artifact export | Export bundle could leak PII if a tool's output contained it | Run `detectPII` on inline content before materialising; store both raw + redacted versions. |
| No signing / notarisation of evidence bundles | Customer can't prove an evidence ZIP wasn't tampered with | Sign artifact `contentHash` with tenant-scoped HMAC key on creation; verify on download. |
| No scheduled exports to customer S3 | Customers want nightly export to their own bucket | Cron job + per-tenant `exportConfig` table. |
| `ARTIFACT_CREATED` / `ARTIFACT_DOWNLOADED` / `ARTIFACT_APPROVED` AuditAction enum entries | Today the artifact service uses `WORKFLOW_COMPLETED` + `MEMORY_READ` as best-fit. Should be cleaner. | Add 3 enum values to `packages/security/src/audit/audit-log.ts` + run migration. ~1 hour. |

## What this means for Audit & Compliance product start

- **READY** for v1 evidence handling for: PDF, text, markdown, JSON, CSV.
- **READY** for: tenant-scoped artifact creation, approval-gated download, signed URLs with audit trail.
- **NOT READY** for: DOCX / XLSX / image content. Customers uploading these will see filename-only search results — this MUST be surfaced honestly in the UI (the new `STORED_NOT_PARSED` status enables that).
- **NOT READY** for: signed evidence bundles. The `WorkflowArtifact.contentHash` field is in place; signing just needs to happen at the export step.
