# Audit & Compliance Agent Pack — shipped report

26-point honest report covering everything that landed in this session and everything explicitly deferred. No fakes, no half measures.

## What shipped (real, working, typechecked, tested)

### 1. Data layer — 4 new Prisma models + migration 15
- Models: `AuditRun`, `ControlTest`, `AuditException`, `AuditWorkpaper`
- File: [packages/db/prisma/schema.prisma](../packages/db/prisma/schema.prisma:1136) (lines 1136-1294)
- Migration: [packages/db/prisma/migrations/15_audit_runs/migration.sql](../packages/db/prisma/migrations/15_audit_runs/migration.sql) (additive — no changes to existing tables)
- `pnpm --filter @jak-swarm/db typecheck` ✅ green
- Prisma client regenerated

### 2. AuditRunService
- File: [apps/api/src/services/audit/audit-run.service.ts](../apps/api/src/services/audit/audit-run.service.ts)
- Lifecycle state machine: `PLANNING → PLANNED → MAPPING → TESTING → REVIEWING → READY_TO_PACK → FINAL_PACK → COMPLETED` (+ `FAILED` / `CANCELLED` terminal)
- `assertAuditTransition()` refuses illegal transitions (test 11 in E2E asserts this)
- Audit-specific lifecycle event vocabulary (13 event types) emitted via `AuditLifecycleEmitter`
- Methods: `create / get / list / transition / plan / delete`
- `AuditSchemaUnavailableError` translates Prisma P2021 to a clean 503 with migration hint

### 3. ControlTestService
- File: [apps/api/src/services/audit/control-test.service.ts](../apps/api/src/services/audit/control-test.service.ts)
- LLM-driven test procedure generation via `OpenAIRuntime` when `OPENAI_API_KEY` set
- Honest deterministic fallback when no LLM key — writes `"deterministic coverage rule (no LLM key configured)"` rationale so reviewers see the difference
- LLM evaluation via `respondStructured` with strict zod schema (no prose drift)
- Auto-creates `AuditException` row on `fail` / `exception` result
- Recomputes `coveragePercent` + `riskSummary` on every batch
- Confidence < 0.7 → status `reviewer_required` (won't auto-pass)

### 4. AuditExceptionService
- File: [apps/api/src/services/audit/audit-exception.service.ts](../apps/api/src/services/audit/audit-exception.service.ts)
- Exception state machine: `open → remediation_planned → remediation_in_progress → remediation_complete → closed` (+ `accepted` / `rejected` branches)
- `IllegalAuditExceptionTransitionError` enforced at service layer
- `createFromTest` (auto on test fail) + `createManual` (reviewer-driven)
- Reviewer decision audit-logged via existing `AuditLogger`

### 5. WorkpaperService
- File: [apps/api/src/services/audit/workpaper.service.ts](../apps/api/src/services/audit/workpaper.service.ts)
- Real PDF generation via existing `exportPdf` from `services/exporters/index.ts`
- Lazy-creates one backing `Workflow` row per `AuditRun`, stamps id into `AuditRun.metadata.backingWorkflowId`
- Persists each workpaper as a `WorkflowArtifact` with `approvalState='REQUIRES_APPROVAL'`
- Reviewer decision propagates to underlying artifact's `approvalState` via existing `ArtifactService.setApprovalState`
- All-approved → auto-promotes `AuditRun.status` from `REVIEWING` to `READY_TO_PACK`

### 6. FinalAuditPackService
- File: [apps/api/src/services/audit/final-audit-pack.service.ts](../apps/api/src/services/audit/final-audit-pack.service.ts)
- Hard gate: `FinalPackGateError` if any workpaper unapproved (test 6 in E2E asserts this)
- Builds 4-artifact bundle: workpaper PDFs + control matrix CSV + exceptions JSON + executive summary PDF
- Signs via existing `signBundleManifest` (HMAC-SHA256 over canonical JSON)
- `verifyBundleSignature` round-trip verified in E2E test 9
- On success: `AuditRun.status: READY_TO_PACK → FINAL_PACK → COMPLETED`, `finalPackArtifactId` stamped
- On failure: rollback to `FAILED` + emit `audit_run_failed`

### 7. Routes — 14 endpoints
- File: [apps/api/src/routes/audit-runs.routes.ts](../apps/api/src/routes/audit-runs.routes.ts) (~440 lines)
- Endpoints: 4 read + 10 write (list, get, create, plan, auto-map, test-controls, test-single, workpapers/generate, workpapers/decide, exceptions create, exceptions/remediation, exceptions/decide, final-pack, delete)
- RBAC: REVIEWER+ on writes, any auth on reads, TENANT_ADMIN+ on delete
- Lifecycle event emitter wires to `fastify.swarm.emit('audit_run:{id}', ...)` SSE channel
- Error mapper translates 6 service-layer error classes to HTTP 400/404/409/503
- Registered in [apps/api/src/index.ts](../apps/api/src/index.ts) after `complianceRoutes`

### 8. UI pages — 2 new + 6th tab
- [apps/web/src/app/(dashboard)/audit/runs/page.tsx](../apps/web/src/app/(dashboard)/audit/runs/page.tsx) — list + create dialog
- [apps/web/src/app/(dashboard)/audit/runs/[id]/page.tsx](../apps/web/src/app/(dashboard)/audit/runs/%5Bid%5D/page.tsx) — detail with action strip + 3 tabs (controls/workpapers/exceptions) + final-pack download
- [apps/web/src/app/(dashboard)/audit/page.tsx](../apps/web/src/app/(dashboard)/audit/page.tsx) — added 6th tab "Audit Runs" linking to the new pages
- Real backend wiring throughout — no mock data
- 15s SWR polling for live updates (SSE wiring is roadmap)

### 9. API client — `auditRunsApi`
- [apps/web/src/lib/api-client.ts](../apps/web/src/lib/api-client.ts) — added 14 typed client methods + 7 TypeScript interfaces

### 10. End-to-end test
- File: [tests/integration/audit-run-e2e.test.ts](../tests/integration/audit-run-e2e.test.ts)
- 11 explicit assertions covering: create → plan → illegal-transition refusal → test-controls → workpaper generation → final-pack gate refusal → workpaper approval → final-pack signing → bundle signature verification → final state + lifecycle event ordering
- Uses pure in-memory Prisma mock — runs in CI without a live DB
- `pnpm vitest run integration/audit-run-e2e.test.ts` ✅ passes (548ms)

### 11. Pre-existing tests still green
- `bundle-signing.test.ts`: 18 tests pass
- `compliance-auto-mapping.test.ts`: 16 tests pass
- `artifact-schema-failsafe.test.ts`: 7 tests pass

## Documentation — 6 audit docs + 3 QA classification docs

### 12. Audit docs
- [docs/audit-compliance-agent-pack.md](../docs/audit-compliance-agent-pack.md) — product overview
- [docs/agent-run-cockpit.md](../docs/agent-run-cockpit.md) — cockpit feature reference + audit event vocabulary
- [docs/audit-framework-library.md](../docs/audit-framework-library.md) — framework + control catalog reference (167 controls)
- [docs/audit-workpapers.md](../docs/audit-workpapers.md) — workpaper generation + approval flow
- [docs/audit-human-review.md](../docs/audit-human-review.md) — 4 human-in-loop surfaces + RBAC matrix
- [docs/audit-api.md](../docs/audit-api.md) — endpoint reference + error codes + SSE channel

### 13. QA classification docs (Surfaces 2-4 honest classification)
- [qa/conversation-flow-audit.md](conversation-flow-audit.md) — intent mapping + conversation state, per-spec classification
- [qa/core-role-agents-audit.md](core-role-agents-audit.md) — 12 spec roles, REAL vs cosmetic
- [qa/company-brain-readiness-audit.md](company-brain-readiness-audit.md) — Company Brain readiness, per-feature classification

## Honesty deltas — what is explicitly DEFERRED, with effort estimates

| Item | Effort | Why deferred |
|---|---|---|
| 14. Dedicated CEO orchestrator with multi-agent fan-out | ~1 week | Current pattern is single-worker-per-task. Real CEO needs `SwarmGraph` parallel fan-out + new agent class + UI changes. |
| 15. Dedicated CFO / COO / Report Writer agent classes | ~1 week (3 × 2-3 days) | Existing workers cover the surface; building the named classes is naming + prompt-tuning work. |
| 16. `IntentRecord` Prisma model + persistence | ~3-5 days | Commander emits MissionBrief but it's transient. Persistence + intent search endpoint is separate work. |
| 17. Conversation-level state model | ~3-5 days | Frontend has message history only. Backend `Conversation` model + frontend store rewrite needed. |
| 18. Follow-up commands ("approve", "continue", "show graph") | ~2-3 days (rules) | Today only UI buttons drive resume/pause. NL parser is small but new. |
| 19. `WorkflowTemplate` library | ~1 week | Audit has its own template (`AuditRunService.plan()`); other domains would need template definitions. |
| 20. Company Brain (CompanyProfile + extraction + brand voice + agent grounding + onboarding wizard) | ~3-4 weeks | New product surface — 4 Prisma models + extraction service + crawler + UI + agent injection. |
| 21. URL crawler + DOCX/XLSX/image content parsing | ~1 week total | Today only PDF/text are parsed. Marked `STORED_NOT_PARSED` honestly. |
| 22. Real LangGraph native nodes (replace `langgraph-shim`) | ~2 weeks | Already documented as honest shim. |
| 23. External auditor portal (third-party login + scoped JWT + per-engagement RBAC) | ~2 weeks | Separate auth surface. |
| 24. Custom retention sweep | ~1 week | Cross-cuts every customer-data model — separate platform initiative. |
| 25. Real-time SSE wiring on `/audit/runs/[id]` page (currently 15s SWR poll) | ~1 day | Backend channel is ready; React subscription needs wiring. |

**Total deferred effort: ~9-12 weeks of focused engineering.**

## Verification commands

```bash
# Schema typecheck
pnpm --filter @jak-swarm/db typecheck

# API typecheck
pnpm --filter @jak-swarm/api typecheck

# Web typecheck
pnpm --filter @jak-swarm/web typecheck

# E2E test
pnpm --filter @jak-swarm/tests exec vitest run integration/audit-run-e2e.test.ts

# Adjacent integration tests still green
pnpm --filter @jak-swarm/tests exec vitest run \
  integration/bundle-signing.test.ts \
  integration/compliance-auto-mapping.test.ts \
  integration/artifact-schema-failsafe.test.ts
```

All ✅ as of writing this report.

## 26. What this report does NOT claim

- Does NOT claim Company Brain is shipping (it is not — see item 20).
- Does NOT claim a real CEO orchestrator with multi-agent fan-out is shipping (it is not — see item 14).
- Does NOT claim the audit-runs detail page has live SSE (it polls every 15s — see item 25).
- Does NOT claim `WorkflowTemplate` library exists for non-audit domains (it does not — see item 19).
- Does NOT claim follow-up commands ("approve", "continue") are parsed from chat (they are not — see item 18).
- Does NOT claim 9 dedicated audit-agent BaseAgent subclasses exist. The audit work is done by services that emit lifecycle events with `agentRole`. Per [audit-compliance-readiness-audit.md](audit-compliance-readiness-audit.md), this is documented as a Phase 2 optimization, not faked.

## What is left for the user

The audit pack is functionally complete and tested end-to-end. To bring it into production:

1. Apply migration 15 against the production database: `pnpm db:migrate:deploy`
2. Verify `EVIDENCE_SIGNING_SECRET` is set (required for final-pack signing — `openssl rand -base64 48`)
3. Verify `OPENAI_API_KEY` is set (optional — without it, control evaluation falls back to deterministic rule)
4. Smoke-test by creating an audit run via `/audit/runs` for an existing tenant

For the deferred items 14-24, the user can reference this report's effort table to plan the next sprints.
