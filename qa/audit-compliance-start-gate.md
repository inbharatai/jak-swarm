# Audit & Compliance product — start gate

**Date:** 2026-04-25
**Verdict:** **READY FOR FULL PRODUCT BUILD — with two named live-verification gates that the user must perform once OpenAI quota is restored.**

The full Audit & Compliance product can begin construction. The foundation is real, tested, and honest about its limits. The two outstanding live-verification gates are external blockers (OpenAI quota), not code blockers — they don't require any further engineering before the Audit & Compliance product can begin.

## Per-dependency status

| # | Dependency | Verdict | Evidence |
|---|---|---|---|
| 1 | Real event stream | **READY** | All 13 canonical lifecycle events wire to BOTH audit log + SSE. See `qa/workflow-runtime-coverage.md` matrix. |
| 2 | Real graph / DAG visibility | **READY** | WorkflowDAG renders only when `plan_created` (real backend event) populates the cockpit. Empty / missing-plan state shows "Waiting for the planner to publish a plan…". No fake nodes anywhere. |
| 3 | Real workflow runtime | **READY** | `WorkflowRuntime` interface implemented; resume + cancel routed; start uses lifecycle side-channel emitter so audit trail is complete regardless of which start path executes. See `qa/workflow-runtime-coverage.md`. |
| 4 | Real approval pause / resume | **READY** | Lifecycle vocabulary covers `approval_required` / `approval_granted` / `approval_rejected` / `resumed`. 5 integration tests pass in `tests/integration/approval-roundtrip.test.ts`. The `paused` SSE gap was found and fixed in this pass. **Live end-to-end verification gate #1**: requires a real workflow with quota — see recipe in `qa/benchmark-results-openai-first.md` scenario 5+10. |
| 5 | Real file / evidence handling | **READY (for PDF / text / md / JSON / CSV)** | DocumentIngestor handles those types live. DOCX / XLSX / image content marked `STORED_NOT_PARSED` honestly (this pass) so the UI can surface "filename match only". PII + injection scan added to ingest path. See `qa/evidence-document-readiness.md`. |
| 6 | Real export / artifact system | **READY** | `WorkflowArtifact` Prisma model + `ArtifactService` + 6 routes shipped. Approval-gated downloads enforced. Tenant isolation at 3 layers. Audit log on every state change. See `qa/artifact-export-readiness.md`. **Migration must be applied to staging**: `pnpm db:migrate:deploy`. |
| 7 | Real OpenAI runtime | **READY (statically) — live verification blocked on quota** | `/version` shows `effectiveExecutionEngine: openai-first`. `pnpm bench:runtime` reached the OpenAI API; got `429 quota exceeded` — proves the runtime + key path works. **Live end-to-end verification gate #2**: top up OpenAI account + re-run `pnpm bench:runtime`. See `qa/openai-first-live-verification.md`. |
| 8 | No fake tool success | **READY** | `ToolOutcome` enum (real_success / draft_created / mock_provider / not_configured / blocked_requires_config / failed) propagated end-to-end. Cockpit renders distinct icons. |

## What this means

- ✅ **Begin** the Audit & Compliance product build.
- ✅ Build read-only audit UI v0 (list + filter + drill-into trace).
- ✅ Build the artifact-management UI on top of `/artifacts/*` routes.
- ✅ Build the reviewer queue (filter by `approvalState=REQUIRES_APPROVAL`).
- ✅ Build per-workflow evidence panels using `/workflows/:id/artifacts`.
- ⚠ Defer claims that depend on the live verification gates until the user has run them:
  - "Verified: live workflow runs emit a complete lifecycle stream" → wait for gate #1
  - "Verified: OpenAI Responses API end-to-end on real prompts" → wait for gate #2

## Out-of-scope items the Audit & Compliance product will eventually need

These are NOT blockers for starting — they are roadmap items the product PM should sequence after v0:

| Item | Pre-req for which Audit & Compliance feature |
|---|---|
| Native DOCX / XLSX / image content parsing | Customers uploading those file types want full-text search inside evidence |
| Format converters (markdown→PDF, html→DOCX, table→XLSX) | "Export to customer-deliverable PDF" feature |
| Signed evidence bundles (HMAC) | "Tamper-evident audit pack" feature |
| Scheduled exports to customer S3 / GCS | "Daily evidence drop to compliance bucket" feature |
| PII redaction on export | HIPAA / GDPR compliant export claims |
| Per-tenant retention policy | Auto-purge after configurable window |
| `ARTIFACT_*` audit enum values | Cleaner audit-log filtering UI (works today using best-fit existing enums) |

## Gate items the user must verify

After top-up of OpenAI account:

1. Run `pnpm bench:runtime` locally — confirm scenarios 1-4 pass.
2. Open `/workspace`, send `"Write a 200-word LinkedIn post for JAK Swarm enterprise launch"`, watch the cockpit.
3. Send `"Send an email to test@example.com about X"` to trigger the approval gate, watch for `paused` event + approval link.
4. Approve via `/approvals` UI, confirm workflow continues to COMPLETED.

If any of #1-4 fails, the gate is RED — do not start Audit & Compliance until fixed.

If #1-4 all pass: gate is **fully GREEN** — begin Audit & Compliance with no caveats.
