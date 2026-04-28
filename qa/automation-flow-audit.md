# Automation Flow Audit (Phase 10) — 16 workflows × per-workflow checks

Verified at commit `c2fb125`. Static audit of code-path existence per
workflow. **Live workflow execution = NEEDS RUNTIME.**

---

## 1. Mapping spec workflows → JAK intents → agents

| Spec workflow | JAK intent | Likely agents | Code path |
|---|---|---|---|
| 1. company_strategy_review | `company_strategy_review` | WORKER_STRATEGIST + WORKER_RESEARCH | Commander → Planner → Router → strategist worker |
| 2. marketing_campaign_generation | `marketing_campaign_generation` | WORKER_MARKETING (9 dedicated tools) + WORKER_CONTENT | Same; marketing worker emits campaign plan + draft assets |
| 3. website_review_and_improvement | `website_review_and_improvement` | WORKER_DESIGNER + WORKER_RESEARCH + WORKER_BROWSER | Same; browser worker capability-gated by tenant config |
| 4. codebase_review_and_patch | `codebase_review_and_patch` | WORKER_CODER + WORKER_TECHNICAL + VERIFIER + dedicated `vibe-coder-workflow` (architect→generator→debugger→deployer with build-check + retry) | Same; specialized workflow path |
| 5. competitor_research | `competitor_research` | WORKER_RESEARCH (needsGrounding=0.7) | Verifier enforces citation density |
| 6. investor_material_generation | `investor_material_generation` | WORKER_DOCUMENT + WORKER_CONTENT + WORKER_DESIGNER | Same |
| 7. content_calendar_generation | `content_calendar_generation` | WORKER_CONTENT + WORKER_MARKETING | Same |
| 8. audit_compliance_workflow | `audit_compliance_workflow` | (services, not BaseAgent classes — see Phase 11) | Routes to /audit/runs API |
| 9. pricing_and_unit_economics_review | `pricing_and_unit_economics_review` | WORKER_FINANCE + WORKER_ANALYTICS | Same |
| 10. operations_sop_generation | `operations_sop_generation` | WORKER_OPS | Same |
| 11. customer_persona_generation | `customer_persona_generation` | WORKER_CRM + WORKER_RESEARCH + WORKER_MARKETING | Same |
| 12. sales_outreach_draft_generation | `sales_outreach_draft_generation` | WORKER_EMAIL (DRAFT mode) + WORKER_CRM | Honest: never sends; produces drafts |
| 13. product_positioning_review | `product_positioning_review` | WORKER_MARKETING + WORKER_STRATEGIST | Same |
| 14. document_analysis | `document_analysis` | WORKER_DOCUMENT + DocumentIngestor | Same |
| 15. browser_inspection | `browser_inspection` | WORKER_BROWSER (capability-gated) | Same |
| 16. general_business_advice | `general_question` (Commander short-circuit) | None — direct answer | Same |

✅ **16/16 workflows have a real code path.**

---

## 2. Per-workflow verification checklist

For each workflow, the per-spec checklist asks 11 things:

| Verification item | Coverage |
|---|---|
| intent detection | ✅ Commander + zod schema (Phase 6) |
| company context usage | ✅ `injectCompanyContext` in BaseAgent (Migration 16) |
| agents assigned | ✅ Router emits `agent_assigned` per task (Sprint 2.1/K) |
| graph nodes | ✅ LangGraph StateGraph w/ 8 nodes (Phase 5) |
| tools used | ✅ TenantToolRegistry + tool_called/tool_completed events |
| events emitted | ✅ 49+ canonical lifecycle events |
| artifacts generated | ✅ WorkflowArtifact via ArtifactService |
| approval gates | ✅ approval-node + LangGraph interrupt (Phase 5) |
| cost tracking | ✅ accumulatedCostUsd + per-call cost_updated events |
| verification | ✅ Verifier with 4-layer hallucination + Sprint 2.4/F citation density |
| final report | ✅ workflows.routes.ts compileFinalOutput + (CEO mode) executive summary |
| UI visibility | ✅ ChatWorkspace SSE consumer (Phase 12) |

✅ **Every spec checkbox has a real code path.** 100% structural coverage.

---

## 3. WorkflowTemplate library (Migration 16)

`apps/api/src/services/company-brain/workflow-template.service.ts:74`:
- `seedSystemTemplates()` — idempotent system-template seeder
- Templates have:
  - `tasksJson` — pre-decomposed task list per intent
  - `requiredCompanyContext` — fields the Commander surfaces as missing
  - `requiredUserInputs` — UI prompts for missing user inputs
  - `approvalGates` — task-id list that needs approval before continuing
  - `expectedArtifacts` — artifact types this template produces

Templates are looked up by intent in Planner (replaces ad-hoc LLM
decomposition where a template exists). System templates are tenantId=null
(available to all tenants); per-tenant overrides allowed.

✅ Real template library with metadata-driven workflow assembly.

---

## 4. Vibe-coder workflow (specialized cyclic chain)

`packages/swarm/src/workflows/vibe-coder-workflow.ts`:
- Architect → Generator → Debugger → Deployer chain
- Build-check validator runs after Generator
- Retry loop on build failure (bounded)
- Uses `staticBuildChecker` or `dockerBuildChecker` per config
- Test: `tests/unit/swarm/vibe-coder-workflow.test.ts` (3 tests)
- Test: `tests/unit/swarm/static-build-checker.test.ts` (12 tests)
- Test: `tests/unit/swarm/docker-build-checker.test.ts` (15 tests)

✅ Real specialized workflow. Honest validator that REJECTS files
containing `// TODO` (line 108-109 of workflow file).

---

## 5. Audit/compliance product audit (Phase 11)

### Schema (Migrations 15 + adjacents)
- `AuditRun` — engagement record (framework, period, scope, status)
  - status state machine: PLANNING → PLANNED → MAPPING → TESTING → REVIEWING → READY_TO_PACK → FINAL_PACK → COMPLETED
- `ControlTest` — per-control test execution + result
- `AuditException` — exception records (severity, remediation, reviewer state)
- `AuditWorkpaper` — per-control narrative + reviewer notes
- `WorkflowArtifact` — workpaper PDF storage with `approvalState`

### Frameworks seeded
- SOC 2 Type 2 — 48 controls (AICPA)
- HIPAA Security Rule — 37 controls (HHS)
- ISO/IEC 27001:2022 — 82 controls (ISO/IEC)
- **Total: 167 controls**

### Services (apps/api/src/services/audit/)
- `audit-run.service.ts` — CRUD + state machine + lifecycle events
- `control-test.service.ts` — LLM-driven test procedure + result recording
- `audit-exception.service.ts` — CRUD + auto-create on failed test
- `workpaper.service.ts` — PDF generation via existing `exportPdf` + `ArtifactService`
  with `approvalState='REQUIRES_APPROVAL'`
- `final-audit-pack.service.ts` — gated bundle: REFUSES if any workpaper unapproved
  (`FinalPackGateError`)
- `external-auditor.service.ts` — Sprint 2.6 invite/engagement/action

### Routes (apps/api/src/routes/)
- `audit-runs.routes.ts` — 10+ endpoints (CRUD + lifecycle actions + workpaper decide)
- `audit.routes.ts` — 5 endpoints (audit log + reviewer queue)
- `compliance.routes.ts` — 10 endpoints (frameworks + mapping + attestations)
- `external-auditor.routes.ts` — 9 endpoints (Sprint 2.6 + final-pack download Gap D)

### UI
- `apps/web/src/app/(dashboard)/audit/page.tsx` — 5-tab home (Dashboard, Audit Log, Reviewer Queue, Workflow Trail, Compliance) + 6th tab "Audit Runs"
- `apps/web/src/app/(dashboard)/audit/runs/page.tsx` — index of runs
- `apps/web/src/app/(dashboard)/audit/runs/[id]/page.tsx` — detail page with control matrix + workpapers + final pack
- `apps/web/src/app/auditor/runs/[id]/page.tsx` — auditor portal review with **final-pack download UI** (Final hardening / Gap D)

### Honest gates
- Test confidence < 0.7 → status auto-flips to `reviewer_required` (per landing page band)
- Every workpaper PDF persists with `approvalState='REQUIRES_APPROVAL'` (download blocked)
- Final-pack signing refuses if any workpaper unapproved (`FinalPackGateError`)
- Exception lifecycle has its own state machine (`IllegalAuditExceptionTransitionError`)

### Tests
- E2E test in `tests/integration/audit-run-e2e.test.ts` (when DB available)
- 11 unit tests for ExternalAuditorService
- AuditExceptionService + AuditRunService + WorkpaperService + FinalAuditPackService each have unit tests

### External auditor portal (Sprint 2.6 + Gap D)
- 9 routes (admin invite/list/revoke/actions + public accept + auditor runs/run/workpapers/decide/comment + final-pack metadata/download)
- 3 UI pages (accept/[token], runs, runs/[id])
- 11 unit tests covering token security + cross-tenant isolation
- Final-pack download with scope-gating + audit trail (Final hardening / Gap D)

---

## 6. Per-workflow rating

| Workflow | Code path | Tests | Honest gates | Live runtime tested? | Rating |
|---|---|---|---|---|---|
| 1. company_strategy_review | ✅ | indirect (orchestrator) | n/a | NEEDS RUNTIME | 7/10 |
| 2. marketing_campaign_generation | ✅ | role-behavioral | DRAFT mode for outreach | NEEDS RUNTIME | 8/10 |
| 3. website_review_and_improvement | ✅ | crawler tests | browser capability-gated | NEEDS RUNTIME | 7/10 |
| 4. codebase_review_and_patch | ✅ | vibe-coder + build-check tests | TODO-rejection in validator | NEEDS RUNTIME | 8/10 |
| 5. competitor_research | ✅ | needsGrounding=0.7; verifier-grounding tests | citation density gate | NEEDS RUNTIME | 8/10 |
| 6. investor_material_generation | ✅ | (composed) | n/a | NEEDS RUNTIME | 7/10 |
| 7. content_calendar_generation | ✅ | (composed) | n/a | NEEDS RUNTIME | 7/10 |
| 8. audit_compliance_workflow | ✅ | full audit-run-e2e test | FinalPackGateError + workpaper approval gate | partially (e2e exists) | 9/10 |
| 9. pricing_and_unit_economics_review | ✅ | (composed) | n/a | NEEDS RUNTIME | 7/10 |
| 10. operations_sop_generation | ✅ | (composed) | n/a | NEEDS RUNTIME | 7/10 |
| 11. customer_persona_generation | ✅ | (composed) | n/a | NEEDS RUNTIME | 7/10 |
| 12. sales_outreach_draft_generation | ✅ | role-behavioral.test (Email DRAFT) | DRAFT-only honest | NEEDS RUNTIME | 8/10 |
| 13. product_positioning_review | ✅ | (composed) | n/a | NEEDS RUNTIME | 7/10 |
| 14. document_analysis | ✅ | document-parsers tests + Document agent behavioral | parseConfidence surfaced | NEEDS RUNTIME | 8/10 |
| 15. browser_inspection | ✅ | worker-node-browser tests | tenant browser config gate | NEEDS RUNTIME | 7/10 |
| 16. general_business_advice | ✅ | (Commander short-circuit) | n/a | NEEDS RUNTIME | 7/10 |

**Workflow average: 7.4/10.** Cap due to NEEDS RUNTIME on most workflows
(audit/compliance is the standout because it has a real e2e test).

---

## 7. Verdict

**Automation flows: 8/10**

- ✅ All 16 spec workflows have real code paths
- ✅ All 11 per-workflow checklist items have real implementations
- ✅ WorkflowTemplate library (Migration 16) supports per-intent
  pre-tuned decompositions
- ✅ Vibe-coder workflow has bounded retry + TODO-rejection
- ✅ Audit/compliance workflow has E2E test + FinalPackGateError

**Why not 10/10:**
- 14/16 workflows lack live e2e tests (NEEDS RUNTIME)
- WorkflowTemplate library populated for SOME intents; not all 18 have
  pre-tuned templates (Planner falls back to ad-hoc LLM decomposition)
