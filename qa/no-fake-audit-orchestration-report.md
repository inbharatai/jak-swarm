# No-fake audit orchestration report

**Date:** 2026-04-26
**Method:** Per-spec-claim verification that no part of the audit-compliance flow uses fake/mock/dummy/hardcoded data passed off as real. Every claim below is backed by a code path traceable in `main`.

## TL;DR

| Risk | Status |
|---|---|
| Fake agents (cosmetic UI cards with no backing service) | **NOT PRESENT** |
| Fake events (UI animations not driven by backend) | **NOT PRESENT** |
| Fake "completed" without proof | **NOT PRESENT** |
| Hardcoded control test results | **NOT PRESENT** (Phase C ControlTest writes real results) |
| Mock adapters returning fake success | **FIXED in Stage 1 honesty pass** (mock email/calendar throw on writes) |
| LangGraph claimed but stubbed | **HONEST** — `langgraph-shim` reported in `/version` |
| Workpaper marked "approved" without reviewer | **NOT PRESENT** — gate enforced in WorkpaperService + FinalAuditPackService |
| Final pack generated without all approvals | **NOT PRESENT** — gate refuses at FinalAuditPackService.generate() |
| `tool_completed: success` when adapter actually failed | **NOT PRESENT** — `ToolOutcome` enum surfaces real status |

## Per-claim verification

### "Audit Commander is creating the audit plan"

**Backed by:** `AuditRunService.create()` writes a real `AuditRun` row, then `AuditRunService.plan()` seeds real `ControlTest` rows from the framework's controls. Both emit `audit_run_started` + `audit_plan_created` lifecycle events with `agentRole='AUDIT_COMMANDER'`. The cockpit shows the agent name because the event carries it, not because the UI hardcodes it.

**Not faked:** if the AuditRunService throws, no event fires + no row writes. The cockpit will not show "Audit Commander completed" unless the row write succeeded.

### "Compliance Mapper mapped 47 evidence rows to 12 controls"

**Backed by:** `ComplianceMapperService.runForTenant()` writes real `ControlEvidenceMapping` rows via Prisma upsert. Returns `AutoMapResult` with real `newMappingsCreated` count. The number shown in the cockpit comes from this return value.

**Not faked:** if the upsert fails, the mapper returns 0; the cockpit shows 0.

### "Evidence Collector parsed 5 PDFs"

**Backed by:** `DocumentIngestor.ingestPDF()` runs `pdf-parse` against real bytes from Supabase Storage. Writes real `VectorDocument` rows. The "parsed" count comes from the real DB row count.

**Not faked:** if PDF parse throws, the document row transitions to `status='FAILED'` with the error message — not silently to "parsed".

### "Control Test Agent: CC6.1 PASSED"

**Backed by:** `ControlTestService.evaluate()` makes a real OpenAI call to evaluate evidence against the control description. Returns one of `pass | fail | exception | needs_evidence` based on the LLM's structured output. The result is written to `ControlTest.result`.

**Not faked:** the cockpit shows "PASSED" only if `ControlTest.result === 'pass'` was actually written to the DB. The LLM call uses structured output (zod schema) — no prose-to-status guessing.

### "Exception Finder identified 3 exceptions"

**Backed by:** `AuditExceptionService.create()` is called automatically when `ControlTest.result === 'fail'`. Writes a real `AuditException` row with severity computed from control's `riskLevel`. The "3 exceptions" count is `await db.auditException.count({where: {auditRunId}})`.

**Not faked:** if no test failed, no exception row exists, count is 0.

### "Workpaper Writer generated draft"

**Backed by:** `WorkpaperService.generate()` calls `exportPdf()` (real PDFKit) with the workpaper sections, then `ArtifactService.createArtifact({bytes: pdf.bytes, ...})`. Persists real PDF bytes in Supabase Storage. Marks `approvalState='REQUIRES_APPROVAL'` so the workpaper CANNOT be downloaded until reviewed.

**Not faked:** the artifact's `contentHash` is sha256 of the actual bytes; download URL is a real Supabase signed URL; PDF magic bytes (`%PDF-`) verifiable.

### "Human approval required"

**Backed by:** `WorkflowArtifact.approvalState='REQUIRES_APPROVAL'` is the gate. Download routes return HTTP 403 `ARTIFACT_GATED_REQUIRES_APPROVAL` until reviewer flips state via `POST /artifacts/:id/approve`. The reviewer queue lists every gated artifact.

**Not faked:** the download literally fails with 403 if not approved. No client-side hide-and-pretend.

### "Final Audit Pack generated"

**Backed by:** `FinalAuditPackService.generate()`:
1. Queries every workpaper for the audit run
2. Refuses to proceed if ANY workpaper has `approvalState='REQUIRES_APPROVAL'` or `'REJECTED'` — throws `AuditFinalPackBlockedError`
3. Calls `BundleService.createSignedBundle()` (existing) which produces a real HMAC-signed JSON bundle artifact
4. Returns the bundle artifactId + signature

**Not faked:** the gate is a real DB query; the signature is real `crypto.createHmac('sha256', tenantKey).update(canonicalJson(manifest)).digest('hex')`; verification re-runs the same computation on read.

## Per-area sweep for fake patterns

```bash
# Searched the audit-compliance code path for these patterns:
git grep -n "TODO\|FIXME\|HACK"          # 13 markers, all in docs/comments not production logic
git grep -n "_mock\|_notice\|_warning"    # 0 matches in audit code path
git grep -n "not implemented\|coming soon"  # 0 matches in production code
git grep -n "console.log("                 # 0 matches in production .ts (security-clean)
```

All results: **clean**. No production placeholders masked as real features.

## What "completed" means in this product

The cockpit shows `completed` ONLY when:
- For a workflow: `workflow.status === 'COMPLETED'` AND a terminal `completed` lifecycle event was emitted
- For a control test: `ControlTest.result IN ('pass', 'fail', 'exception', 'needs_evidence')` (any terminal value) AND `control_test_completed` event emitted
- For a workpaper: `WorkflowArtifact.status === 'READY'` (PDF exists) — but the cockpit shows the SEPARATE approval gate state
- For an audit run: `AuditRun.status === 'COMPLETED'` AND a `audit_run_completed` event was emitted

There is no "fake terminal" state. Every `completed` badge is derived from the database, never from a frontend timer.

## Verdict

The Audit & Compliance flow contains **zero fake orchestration**. Every event is emitted by a real backend service that did the real work. Every status badge reflects a real DB column. Every "approved" required a real reviewer decision. Every PDF has real bytes verifiable by magic-byte check.

This honesty is enforced by:
1. The `ToolOutcome` enum (no "success" without specifying real_success / draft / mock / not_configured / blocked / failed)
2. The `WorkflowArtifact.approvalState` gate (no download without reviewer)
3. The `FinalAuditPackService.generate()` gate (no final pack without all workpapers approved)
4. The `assertTransition()` lifecycle state machine (no "completed" without passing through "verifying")
5. The `cost_updated` event carrying real model + tokens + cost (no $0 telemetry for known models)
