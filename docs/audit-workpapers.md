# Audit workpapers

A workpaper is a per-control narrative PDF that pulls together the control text, test procedure, evidence considered, result + rationale, and any linked exception. Reviewers approve or reject each workpaper individually before the run can produce a final pack.

## What a workpaper contains

The PDF (rendered via existing `exportPdf` from `services/exporters/index.ts`) has these sections:

1. **Audit run** — title, framework, period
2. **Control** — code + title (from the snapshot stored on `ControlTest`, not the live catalog)
3. **Test procedure** — LLM-generated when `OPENAI_API_KEY` is set, deterministic template otherwise
4. **Result** — status, result (`pass` / `fail` / `exception` / `needs_evidence`), confidence (0-1), rationale
5. **Evidence considered** — auto-mapping count, manual evidence count, ID list (capped at 25 per type for readability)
6. **Exception** (only when present) — severity, status, description, remediation plan
7. **Reviewer signoff** — placeholder section reviewers fill in via the UI

## Generation flow

```
WorkpaperService.generateAll
  for each ControlTest in terminal status (passed/failed/exception_found/evidence_missing/...):
    generateSingle:
      1. Skip if AuditWorkpaper(auditRunId, controlId) already exists (unless forceRegenerate)
      2. ensureBackingWorkflow → lazy-create one Workflow row per AuditRun, stored in AuditRun.metadata.backingWorkflowId
      3. Fetch the ControlTest + run + linked AuditException (if any)
      4. Build PDF sections from the data
      5. exportPdf(...) → real PDF bytes via pdfkit
      6. ArtifactService.createArtifact:
          - artifactType: 'workpaper'
          - approvalState: 'REQUIRES_APPROVAL'  ← always
          - bytes: <pdf bytes>
      7. Upsert AuditWorkpaper(auditRunId, controlId) → status='needs_review' + artifactId
      8. Emit workpaper_generated + reviewer_action_required
```

## Approval flow

```
WorkpaperService.setReviewDecision({decision: 'approved'|'rejected', reviewerNotes?})
  1. Propagate decision to ArtifactService.setApprovalState
     → WorkflowArtifact.approvalState becomes APPROVED or REJECTED
     → Download gate updates: REJECTED artifacts permanently blocked
  2. Update AuditWorkpaper.status to 'approved' or 'rejected'
  3. If ALL workpapers for the run are 'approved' → transition AuditRun.status REVIEWING → READY_TO_PACK
```

## Why the gate matters

The final-pack signing operation refuses to run if any workpaper is unapproved (see `FinalPackGateError`). This ensures the binding signed bundle never includes evidence that hasn't been reviewed by a human.

## Honesty notes

- **PDFs are real.** They're rendered server-side via `pdfkit` (no Chromium), persist as bytes in Supabase Storage, and verify against their `contentHash` when included in a signed bundle.
- **The approval gate is enforced at multiple layers:**
  1. UI cosmetically disables the "Generate final pack" button until all approved.
  2. The route layer's RBAC requires REVIEWER+ to call `/decide` and `/final-pack`.
  3. The service layer (`FinalAuditPackService.generate`) re-checks workpaper approval state and throws `FinalPackGateError` if any is unapproved — even if the UI / route is bypassed.
- **The `approvalState='REQUIRES_APPROVAL'` flag also gates artifact downloads.** A reviewer who hasn't approved a workpaper can't download it (`ArtifactGatedError`).

## Where to look

- Service: [apps/api/src/services/audit/workpaper.service.ts](../apps/api/src/services/audit/workpaper.service.ts)
- PDF exporter: `apps/api/src/services/exporters/index.ts` (`exportPdf`)
- Artifact gate: `apps/api/src/services/artifact.service.ts` (`ArtifactGatedError`, `setApprovalState`, `requestSignedDownloadUrl`)
- Schema: `packages/db/prisma/schema.prisma` (`AuditWorkpaper`)
- E2E test (covers full generate → approve → final-pack flow): `tests/integration/audit-run-e2e.test.ts`
