# Audit & Compliance Agent Pack

Production-grade audit engagement workflow built into JAK Swarm. Covers SOC 2, HIPAA, ISO 27001 out of the box. Drives one engagement from kickoff to a binding signed evidence pack.

## What ships today

| Capability | Status | Backed by |
|---|---|---|
| Per-tenant audit engagements (`AuditRun`) | Real | `apps/api/src/services/audit/audit-run.service.ts` |
| State machine: `PLANNING → PLANNED → MAPPING → TESTING → REVIEWING → READY_TO_PACK → FINAL_PACK → COMPLETED` | Real | `assertAuditTransition()` + per-action validation |
| Per-control test rows seeded from framework (182 controls across SOC2/HIPAA/ISO27001 — 108 auto-mapped + 74 reviewer-attest) | Real | `AuditRunService.plan()` + existing framework seed |
| Auto-mapping evidence to controls | Real (reuses v1) | `ComplianceMapperService.runForTenant()` |
| LLM-driven control test evaluation (with deterministic fallback when no key) | Real | `apps/api/src/services/audit/control-test.service.ts` |
| Auto-create `AuditException` rows on fail/exception | Real | `AuditExceptionService.createFromTest()` |
| Per-control workpaper PDFs, persisted as `WorkflowArtifact` | Real | `apps/api/src/services/audit/workpaper.service.ts` |
| Reviewer approve/reject workpapers (`approvalState='REQUIRES_APPROVAL'` gate) | Real | `WorkpaperService.setReviewDecision()` |
| Signed final evidence pack — refuses to generate if any workpaper is unapproved | Real | `apps/api/src/services/audit/final-audit-pack.service.ts` |
| HMAC-SHA256 signature over canonical manifest | Real (reuses v0) | `bundle-signing.service.ts` |
| Lifecycle events on SSE channel (`audit_run_started`, `control_test_completed`, `workpaper_generated`, `final_pack_generated`, …) | Real | `AuditLifecycleEmitter` wired in `audit-runs.routes.ts` |

## What does NOT ship in this version

These are explicitly deferred and named, not faked. See [audit-compliance-readiness-audit.md](../qa/audit-compliance-readiness-audit.md) for per-spec classification.

| Deferred capability | Reason | Effort to build |
|---|---|---|
| External auditor portal (third-party login + scoped access) | Separate auth surface | ~2 weeks |
| 9 dedicated `BaseAgent` subclasses (`AuditCommander`, `ComplianceMapper`, etc.) | Services already emit identical lifecycle events with `agentRole`, so the cockpit treats them identically. Building dedicated agent classes is a Phase 2 optimization. | ~1 week |
| Custom retention sweep | Cross-cuts every customer-data model — separate platform initiative | ~1 week |
| Real LangGraph nodes (replace `langgraph-shim`) | Already documented as honest shim | ~2 weeks |
| DOCX/XLSX/image content parsing for evidence | Currently `STORED_NOT_PARSED` | ~3 days |

## Engagement flow

```
User → POST /audit/runs                                  AuditRunService.create()
                                                         status = PLANNING
                                                         emit audit_run_started
       POST /audit/runs/:id/plan                         seed ControlTest rows
                                                         status = PLANNED
                                                         emit audit_plan_created
       POST /audit/runs/:id/auto-map                     ComplianceMapperService.runForTenant()
                                                         emit evidence_mapped
       POST /audit/runs/:id/test-controls                ControlTestService.runAll()
                                                         per-control: emit control_test_started/_completed
                                                         on fail/exception: emit exception_found + auto-create AuditException
                                                         status = TESTING → REVIEWING (when terminal)
       POST /audit/runs/:id/workpapers/generate          WorkpaperService.generateAll()
                                                         per-control: render PDF (existing exportPdf)
                                                         persist as WorkflowArtifact, approvalState=REQUIRES_APPROVAL
                                                         emit workpaper_generated + reviewer_action_required
       POST /audit/runs/:id/workpapers/:wpId/decide      WorkpaperService.setReviewDecision()
                                                         propagates to ArtifactService.setApprovalState
                                                         all approved → status = READY_TO_PACK
       POST /audit/runs/:id/final-pack                   FinalAuditPackService.generate()
                                                         GATE: refuses if any workpaper unapproved
                                                         bundles workpapers + control matrix CSV +
                                                         exceptions JSON + executive summary PDF
                                                         signs via bundle-signing.service (HMAC-SHA256)
                                                         status = FINAL_PACK → COMPLETED
                                                         emit final_pack_generated + audit_run_completed
```

## Honesty notes

- **No mock LLM evaluation.** `ControlTestService` uses `OpenAIRuntime` via `getRuntime('CONTROL_TEST_AGENT', …)` when `OPENAI_API_KEY` is set. When the key is absent, it falls back to a deterministic coverage rule and writes the rationale `"deterministic coverage rule (no LLM key configured)"` so reviewers see the difference.
- **No fake completion.** The state machine refuses illegal transitions (e.g. `PLANNING → COMPLETED`) via `assertAuditTransition`. The final-pack gate refuses to sign over unapproved workpapers via `FinalPackGateError`.
- **No fake agents.** The `agentRole` field on every lifecycle event names the role (`AUDIT_COMMANDER`, `CONTROL_TEST_AGENT`, `EXCEPTION_FINDER`, `WORKPAPER_WRITER`, `FINAL_AUDIT_PACK_AGENT`, `COMPLIANCE_MAPPER`). The work itself is performed by the named service — no fake `BaseAgent` placeholder classes were created.

## Where to look

- Routes: [apps/api/src/routes/audit-runs.routes.ts](../apps/api/src/routes/audit-runs.routes.ts)
- Services: [apps/api/src/services/audit/](../apps/api/src/services/audit/)
- Migration: [packages/db/prisma/migrations/15_audit_runs/migration.sql](../packages/db/prisma/migrations/15_audit_runs/migration.sql)
- E2E test: [tests/integration/audit-run-e2e.test.ts](../tests/integration/audit-run-e2e.test.ts)
- UI: [apps/web/src/app/(dashboard)/audit/runs/page.tsx](../apps/web/src/app/(dashboard)/audit/runs/page.tsx) + `[id]/page.tsx`
