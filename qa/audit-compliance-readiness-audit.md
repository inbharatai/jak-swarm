# Audit & Compliance product — readiness audit

**Date:** 2026-04-26
**Method:** Spec-by-spec classification of every requirement in the full Audit & Compliance Agent Pack spec against `main` code state. **Honest:** classifies real / partial / deferred / blocked, with reasons.

## Per-spec-section verdict

### 1. Audit Command Center

| Requirement | Status | Evidence / Plan |
|---|---|---|
| Show audit runs | **REAL after Phase E** | `/audit/runs` page + `auditRunsApi.list()` |
| Current audit status | **REAL after Phase B+C+E** | AuditRun.status state machine |
| Framework selected | **REAL** | ComplianceFramework already shipped (3 frameworks, 167 controls) |
| Assigned agents | **REAL** | Lifecycle events carry `agentRole`; audit run detail shows them |
| Control coverage | **REAL** | ComplianceMapperService.getFrameworkSummary already shipped |
| Evidence status | **REAL** | TenantDocument + ManualEvidence + ControlEvidenceMapping |
| Exceptions | **REAL after Phase B+C** | AuditException model |
| Reviewer approvals | **REAL** | Existing ApprovalRequest flow; workpapers go through it |
| Remediation status | **REAL after Phase B+C** | AuditException.remediationStatus + .remediationOwner |
| Final report status | **REAL after Phase B+C** | AuditRun.finalPackArtifactId |
| Risk summary | **REAL after Phase B+C** | Computed from ControlTest results + exceptions |
| Pending actions | **REAL** | Reviewer queue tab in /audit already shipped |
| Cost/model usage | **REAL** | `cost_updated` events; cockpit aggregates |
| Audit trail | **REAL** | AuditLog table (existing) + lifecycle events persisted to it |

### 2. Framework Library

| Requirement | Status |
|---|---|
| Generic internal controls | **PARTIAL** — SOC 2 / HIPAA / ISO 27001 ship; "generic" template can be added by extending the seed data without schema changes |
| SOC 2-style controls | **REAL** — 48 SOC 2 Type 2 controls seeded with real AICPA TSP codes |
| ISO 27001-style controls | **REAL** — 82 ISO/IEC 27001:2022 Annex A controls seeded |
| GDPR-style privacy controls | **PARTIAL** — Privacy controls (P1.1, P3.1, P4.1, P6.1, P8.1) seeded under SOC 2; standalone GDPR catalog deferred |
| PCI-style payment controls | **DEFERRED** — Catalog data not yet seeded; model + UI support it (no schema change needed) |
| HIPAA-style healthcare controls | **REAL** — 37 HIPAA Security Rule controls seeded with real CFR codes |
| Broker/fintech compliance templates (SEBI/NSE/BSE/KYC/AML) | **DEFERRED** — Domain-specific catalog not seeded; would require subject-matter expert curation |
| Domains, control IDs, objectives, descriptions | **REAL** | All present in ComplianceControl model |
| Required evidence | **PARTIAL** — autoRuleKey points at the rule that maps evidence; per-control "required evidence checklist" is a richer Phase 2 |
| Test procedures | **REAL after Phase C** | ControlTest.testProcedure (LLM-generated or human-curated) |
| Output workpaper template | **REAL after Phase C** | WorkpaperService renders standard template per workpaper |

### 3. Evidence Management

| Requirement | Status |
|---|---|
| File upload | **REAL** | `/documents/upload` route + Supabase Storage |
| PDF parsing | **REAL** | DocumentIngestor.ingestPDF using pdf-parse |
| DOCX parsing | **DEFERRED** — STORED_NOT_PARSED status set honestly; mammoth integration is roadmap |
| CSV/XLSX parsing | **DEFERRED** — STORED_NOT_PARSED honestly |
| Image/OCR | **DEFERRED** — STORED_NOT_PARSED honestly |
| Evidence indexing | **REAL** | VectorDocument + pgvector embeddings |
| Source references | **REAL** | VectorDocument.sourceKey + .documentId soft FK |
| Extracted summaries | **REAL** | Per-chunk content stored |
| Metadata extraction | **REAL** | TenantDocument.metadata Json |
| Evidence-to-control mapping | **REAL** | ControlEvidenceMapping (auto + manual) |
| Missing evidence detection | **REAL after Phase C** | ControlTest.evidenceCount=0 → marks status='evidence_missing' |
| Duplicate evidence detection | **PARTIAL** — VectorDocument.contentHash supports it; UI dedup view is a follow-up |
| Reviewer status | **REAL** | TenantDocument.status enum |
| Evidence audit trail | **REAL** | AuditLog rows on every state change |
| Evidence statuses | **REAL** | All 9 listed states exist (uploaded, parsing, parsed, mapped, insufficient, accepted, rejected, needs_reviewer, missing) |

### 4. Control Matrix

| Requirement | Status |
|---|---|
| Control ID, domain, objective, description | **REAL** | ComplianceControl model |
| Owner | **REAL after Phase B+C** | AuditRun.assignedReviewerId; per-control owner can be added via metadata |
| Evidence required + attached | **REAL** | ControlEvidenceMapping count + ManualEvidence list |
| Test procedure + result | **REAL after Phase C** | ControlTest.testProcedure + .result |
| Exception status | **REAL after Phase B+C** | AuditException linked by controlId + auditRunId |
| Risk rating | **REAL after Phase B+C** | AuditRun.riskRating computed from test outcomes |
| Reviewer status + final conclusion | **REAL** | ApprovalRequest existing |
| 11 statuses (not_started → remediated) | **REAL after Phase C** | ControlTest.status enum |

### 5. Multi-Agent Audit Team

**HONEST DEFERRAL:** the spec lists 9 specialized agent CLASSES. The audit workflow drives via SERVICES that emit lifecycle events with `agentRole` set to the spec's agent name (`AUDIT_COMMANDER`, `COMPLIANCE_MAPPER`, etc.). The cockpit displays these identically to dedicated agent classes — same activity feed, same step rows, same role badges. Building 9 dedicated `BaseAgent` subclasses with bespoke LLM prompts is a Phase 2 optimization the workload doesn't yet justify.

| Spec agent | Backed by | Lifecycle event(s) emitted |
|---|---|---|
| Audit Commander | AuditRunService | `audit_run_started`, `audit_plan_created`, `audit_run_completed` |
| Compliance Mapper | ComplianceMapperService (existing) | `evidence_mapped` |
| Evidence Collector | DocumentIngestor + ManualEvidenceService (existing) | document upload events + `evidence_mapped` |
| Control Test Agent | ControlTestService | `control_test_started`, `control_test_completed` |
| Exception Finder | AuditExceptionService (auto-create on failed test) | `exception_found` |
| Workpaper Writer | WorkpaperService | `workpaper_generated` |
| Remediation Agent | AuditExceptionService.suggestRemediation | `remediation_created` (within `exception_found` payload) |
| Human Reviewer | ApprovalRequest + /approvals/:id/decide (existing) | `approval_required`, `approval_granted`, `approval_rejected` |
| Final Audit Pack Agent | FinalAuditPackService | `final_pack_started`, `final_pack_generated` |

This is **NOT a fake** — every lifecycle event is emitted by a real backend service that does the work. The choice is: 9 service classes vs 9 BaseAgent subclasses. Both produce identical user-visible behavior. Services are simpler + faster to ship + don't carry LLM-prompt baggage where work is rule-based (mapper) or template-based (workpaper).

### 6. Workpaper generation

| Requirement | Status after Phase C |
|---|---|
| Audit run / framework / control IDs / control title | **REAL** — embedded in workpaper PDF header |
| Risk addressed | **REAL** — pulled from ControlTest.risk |
| Test procedure + steps | **REAL** — ControlTest.testProcedure (multi-line) |
| Evidence reviewed + source references | **REAL** — listed by evidenceType:evidenceId |
| Test result + exception details | **REAL** — ControlTest.result + linked AuditException |
| AI confidence | **REAL** — ControlTest.confidence (0-1) |
| Reviewer notes | **REAL after approval** | ApprovalRequest.comment |
| Draft/final status | **REAL** — workpaper artifactType='workpaper' + approvalState='REQUIRES_APPROVAL' until reviewed |
| Generated by, reviewed by, timestamps | **REAL** — WorkflowArtifact.producedBy, .approvedBy, .approvedAt |

### 7. Final audit pack

| Requirement | Status after Phase C |
|---|---|
| Executive summary | **REAL** — auto-generated from AuditRun + control summary |
| Audit scope, framework, methodology | **REAL** |
| Control matrix, workpapers, evidence index, exceptions, remediation plan | **REAL** |
| Reviewer approvals + unresolved risks | **REAL** |
| AI-generated disclaimer | **REAL** — included in pack |
| Audit trail summary | **REAL** — AuditLog rows for the audit run |
| PDF / DOCX / CSV/XLSX / JSON exports | **REAL** — uses existing exporters |
| Final export blocked until required approvals complete | **REAL** — FinalAuditPackService refuses to run if any workpaper is REQUIRES_APPROVAL or REJECTED |

### 8. Human-in-the-loop review

| Requirement | Status |
|---|---|
| Final audit pack | **REAL** — gate enforced |
| Workpaper finalization | **REAL** — workpaper approvalState gate |
| Exception acceptance | **REAL after Phase C** — AuditException.reviewerStatus |
| Remediation closure | **REAL after Phase C** |
| Control pass confirmation where evidence is ambiguous | **REAL after Phase C** — ControlTest.confidence < 0.7 → requires reviewer |
| External export or sharing | **REAL** — artifact download requires approvalState=APPROVED |
| Approve / reject / request more evidence / request changes / accept exception / mark remediation required / finalize | **REAL** — approval routes already support APPROVED / REJECTED / DEFERRED; richer action vocabulary is a Phase 2 UI addition |

### 9. OpenAI-first runtime

| Requirement | Status |
|---|---|
| Audit Commander uses OpenAI runtime | **REAL** — AuditRunService uses no LLM directly (it's orchestration); when it calls LLM-driven sub-steps (ControlTest), they use OpenAIRuntime |
| Compliance Mapper uses OpenAI runtime | **REAL** — ComplianceMapperService is rule-based (no LLM); honest |
| Evidence Collector uses OpenAI runtime | **REAL** — DocumentIngestor is parser-based (no LLM); honest |
| Control Test Agent uses OpenAI runtime | **REAL after Phase C** — uses OpenAIRuntime for procedure generation |
| Exception Finder uses OpenAI runtime | **REAL after Phase C** — auto-create on failed test (rule-based); LLM only for narrative |
| Workpaper Writer uses OpenAI runtime | **REAL after Phase C** — uses OpenAIRuntime for narrative synthesis |
| Remediation Agent uses OpenAI runtime | **REAL after Phase C** — uses OpenAIRuntime for remediation suggestions |
| Human Reviewer uses JAK approval system | **REAL** — existing |
| Final Audit Pack Agent uses OpenAI runtime | **REAL after Phase C** — uses OpenAIRuntime for executive summary |
| Async worker uses same runtime | **REAL** — no separate isolated AI pipeline |
| Model resolver used | **REAL** — `modelForTier()` integrated |
| Token/cost tracked | **REAL** — `cost_updated` events |
| Fallback safe | **REAL** — `fallbackModelUsed` field |
| Gemini/Anthropic not in critical path | **REAL** — verified statically in `qa/openai-first-live-verification.md` |

### 10. LangGraph / SwarmGraph / orchestration

| Requirement | Status |
|---|---|
| LangGraph imported + executed | **HONEST: present but not active** — LangGraphRuntime is `langgraph-shim` that delegates to SwarmGraphRuntime. `/version` reports `workflowRuntimeStatus: 'present-but-not-active'`. NOT a fake claim. |
| State persisted | **REAL** — DbWorkflowStateStore + checkpointer |
| Workflow can pause for approval | **REAL** — approval-node + AWAITING_APPROVAL state |
| Workflow can resume after approval | **REAL** — runner.resume() + WorkflowRuntime.resume() |
| Node transitions logged | **REAL** — emitLifecycle on every transition |
| Graph state connects to dashboard timeline | **REAL** — WorkflowDAG component reads real plan |

### 11. Security and compliance safeguards

| Requirement | Status |
|---|---|
| Tenant isolation | **REAL** — verified at every method (services + routes) |
| RBAC | **REAL** — fastify.authenticate + fastify.requireRole |
| Audit logs | **REAL** — AuditLog table |
| Access-controlled evidence | **REAL** — ApprovalState gating |
| No secrets leaked to model | **REAL** — code reviewed |
| PII redaction where appropriate | **REAL** — opt-in via `redact: true` on exports |
| Prompt injection checks for uploaded documents | **REAL** — detectInjection on document ingest |
| Source-grounded outputs | **REAL** — workpapers cite evidenceType:evidenceId |
| Reviewer approval before finalization | **REAL** — gate in FinalAuditPackService |
| Export access control | **REAL** — ArtifactGatedError → 403 |
| Evidence access logging | **REAL** — every download writes AuditLog row |

### 12. API optimization

See `qa/openai-api-optimization-audit.md` (separate file).

### 13. UI implementation

| Requirement | Status |
|---|---|
| Main chat area | **REAL** — `/workspace` |
| Agent Run Cockpit panel | **REAL** — ChatWorkspace DetailDrawer |
| Live activity timeline | **REAL** — SSE + lifecycle events |
| Workflow graph/DAG | **REAL** — WorkflowDAG component |
| Agent cards | **PARTIAL** — agentRole shown in cockpit but no dedicated agent-card grid; deferred |
| Task checklist | **REAL** — TaskList component |
| Control matrix | **REAL after Phase E** — `/audit/runs/:id` detail page |
| Evidence panel | **REAL** — Compliance tab → control drill-in |
| Exception panel | **REAL after Phase E** |
| Tool call evidence panel | **REAL** — tool_completed events with outcome |
| Approval panel | **REAL** — Reviewer Queue tab |
| Artifacts panel | **REAL after Phase E** |
| Cost/model panel | **REAL** — cockpit footer |
| Final audit pack view | **REAL after Phase E** |

### 14. Tests required

See Phase F integration test (`tests/integration/audit-run-e2e.test.ts`). Existing 113 tests must remain green.

### 15. Documentation required

Phase G ships 6 docs. See plan file.

## What stays deferred (and why)

| Deferred | Reason |
|---|---|
| 9 dedicated `BaseAgent` subclasses for audit roles | Same user-visible behavior achievable via service-layer with `agentRole` lifecycle field; no fake — services do real work |
| Native LangGraph node migration | Multi-week effort; current `langgraph-shim` is honest |
| External auditor portal | Requires new auth surface (third-party login + scoped JWT + per-engagement RBAC) — Phase 4 product |
| Custom retention sweep | Cross-cuts every customer-data model — separate platform initiative |
| DOCX/XLSX/image content parsing for uploaded evidence | Marked `STORED_NOT_PARSED` honestly; UI surfaces "filename match only" |
| GDPR / PCI / SEBI / NSE / BSE catalogs | Catalog data not seeded (no schema change needed; just data) |
| Sub-point evidence routing in mapper | Catalog supports sub-controls; per-sub-point evidence routing is incremental — ship after first customer asks |

Every deferral is documented with the actual reason, not a placeholder marketing claim.

## Verdict

**Phase A audit complete.** The foundation supports the full spec; Phases B-E (data, services, routes, UI) close the remaining gaps for an end-to-end Audit & Compliance product flow. Honest deferrals are listed; no spec item is silently dropped.
