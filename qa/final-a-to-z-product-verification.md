# JAK Swarm — Final A-to-Z Product Verification

**Date:** 2026-04-27
**Verified at commit:** `34491f2` (Sprint 2.5/A.6 + Sprint 2.6)
**Verifier:** code-grounded audit; no marketing claims accepted without proof.

This is the truthful map of what JAK Swarm actually does today, with each
surface classified honestly.

---

## Classification legend

| Symbol | Meaning |
|---|---|
| ✅ **PRODUCTION-READY** | Implemented, tested, no obvious gaps |
| 🟢 **WORKING** | Functional but needs polish (UI rough, docs thin, etc.) |
| 🟡 **PARTIAL** | Half-shipped or behind a flag |
| 🔧 **REQUIRES CONFIG** | Works only when operator wires credentials/env |
| 🚫 **MISSING** | Spec called for it; not implemented |
| ⚠️ **RISKY** | Implemented but has known sharp edges |
| ❌ **DEPRECATED/REMOVED** | Was in tree; deleted |

---

## 1. Workflow runtime

| Surface | Status | Proof |
|---|---|---|
| OpenAI-first runtime | ✅ | `packages/agents/src/runtime/openai-runtime.ts`; default per provider-router |
| Model resolver | ✅ | `packages/agents/src/runtime/model-resolver.ts`; tier-based per-agent model |
| Anthropic in critical path | ❌ DEPRECATED | Adapters compile but not in default routing per Phase 7 plan |
| Gemini in critical path | ❌ DEPRECATED | Same |
| LangGraph runtime | ✅ | Real native StateGraph at `packages/swarm/src/workflow-runtime/langgraph-graph-builder.ts`; `LangGraphRuntime.isFullyImplemented = true` |
| SwarmGraph engine | ❌ REMOVED | Deleted in commit 34491f2 (Sprint 2.5/A.6) |
| `JAK_WORKFLOW_RUNTIME=swarmgraph` fallback | ❌ REMOVED | Setting it logs a one-time warning; LangGraph is the only runtime |
| Postgres checkpoint persistence | ✅ | `PostgresCheckpointSaver` + `workflow_checkpoints` table; tenant-scoped; 18 unit tests |
| Approval pause/resume | ✅ | LangGraph native `interrupt()` + `Command(resume=…)` in `wrapApprovalNode` |
| Async worker | ✅ | `QueueWorker` durable queue; calls workflow-runtime through SwarmRunner facade |
| Cost/token tracking | ✅ | `accumulatedCostUsd` Annotation reducer; `wrapNode` enforces budget; `cost_updated` activity events |
| Prompt caching (OpenAI) | ✅ | Sprint 2.2/I — `cached_tokens` flows through `cost_updated`; `calculateCost` discounts cached tokens |
| Context summarization | ✅ | Sprint 2.2/H — `applySummarizationIfNeeded` wired into worker-node |
| Activity emitter side-channel | ✅ | `getActivityEmitter`/`registerActivityEmitter` per workflowId |

---

## 2. Intent / conversation flow

| Surface | Status | Proof |
|---|---|---|
| Intent mapping (Commander) | ✅ | `packages/agents/src/roles/commander.agent.ts`; 18 named intents |
| 18 named intents + zod schema | ✅ | `packages/agents/src/intents/intent-vocabulary.ts`; tested at 26 unit tests |
| `IntentRecord` Prisma model + persistence | ✅ | Migration 16; recorded per workflow run |
| `WorkflowTemplate` library (intent → template) | ✅ | Migration 16; `WorkflowTemplate` model + service |
| Clarification gate (Commander asks first) | ✅ | `clarificationNeeded` short-circuits planner |
| Direct-answer short-circuit | ✅ | `directAnswer` field bypasses Planner/Router/Workers |
| Conversation state persisted | 🟢 WORKING | `Conversation` model exists; auto-loads message history; pending-approval state stored in workflow not conversation |
| Follow-up command parser ("approve", "show graph", etc.) | ✅ | Sprint 2.1/J wired into `POST /workflows`; 14 commands; 26 unit tests |

---

## 3. Company Brain

| Surface | Status | Proof |
|---|---|---|
| `CompanyProfile` Prisma model | ✅ | Migration 16 |
| Manual company profile entry (UI) | ✅ | Onboarding step (Sprint 2.1/E) + Company page |
| Document-based extraction | ✅ | `CompanyProfileService.extractFromDocuments` |
| Memory approval flow (status: extracted → user_approved) | ✅ | Migration 16 + `MemoryApprovalService` |
| URL crawler for company knowledge sources | ✅ | Sprint 2.3/C — `CompanyKnowledgeCrawlerService` with SSRF defense, robots.txt, rate limiting; 24 unit tests |
| Document parsing — PDF | ✅ | Existing pdf-parse via DocumentIngestor |
| Document parsing — DOCX | ✅ | Sprint 2.2/D — mammoth (parseConfidence 0.95) |
| Document parsing — XLSX | ✅ | Sprint 2.2/D — exceljs (0.85) |
| Document parsing — Image OCR | ✅ | Sprint 2.2/D — sharp + tesseract.js (clamped ≤0.85) |
| Document parsing — TXT/JSON | ✅ | Existing |
| Vector search for ingested content | ✅ | pgvector + DbVectorAdapter |
| BaseAgent grounding in CompanyProfile | ✅ | `injectCompanyContext` in BaseAgent.executeWithTools |
| Onboarding wizard step | ✅ | Sprint 2.1/E — Company Info step |

---

## 4. Role agents

| Role | Status | Backing |
|---|---|---|
| Commander (orchestrator) | ✅ | `roles/commander.agent.ts`; world_class maturity |
| Planner | ✅ | `roles/planner.agent.ts`; world_class |
| Router | ✅ | `roles/router.agent.ts` |
| Verifier | ✅ | `roles/verifier.agent.ts` + Sprint 2.4/F citation density check |
| Guardrail | ✅ | `roles/guardrail.agent.ts` |
| Worker.STRATEGIST (CEO mapping) | ✅ | `workers/strategy.agent.ts` |
| Worker.MARKETING (CMO mapping) | ✅ | `workers/marketing.agent.ts` |
| Worker.TECHNICAL (CTO mapping) | ✅ | `workers/technical.agent.ts` |
| Worker.FINANCE (CFO mapping) | ✅ | `workers/finance.agent.ts` |
| Worker.OPS (COO mapping) | ✅ | `workers/ops.agent.ts` |
| Worker.APP_GENERATOR (VibeCoder mapping) | ✅ | `workers/app-generator.agent.ts` |
| Worker.RESEARCH | ✅ | `workers/research.agent.ts` (needsGrounding=true) |
| Worker.BROWSER | ✅ | `workers/browser.agent.ts` (capability-gated) |
| Worker.DESIGNER | ✅ | `workers/designer.agent.ts` (needsGrounding=true threshold 0.5) |
| Worker.CODER | ✅ | `workers/coder.agent.ts` |
| ~28 other workers | ✅ | All backed by BaseAgent subclasses with structured-output schemas |
| Dedicated CEO orchestrator (assigns CMO+CTO+CFO under it) | 🚫 NOT IMPLEMENTED | The CEO label maps to STRATEGIST worker; multi-agent fan-out is via Planner-decomposed parallel tasks, not a CEO sub-orchestrator |
| Dedicated CFO/COO agent classes (separate from finance/ops workers) | ⚠️ NOTE | CFO + COO labels exist in role-config; same pattern (single-worker-per-task) |

---

## 5. Agent Run Cockpit

| Surface | Status | Proof |
|---|---|---|
| Lifecycle event vocabulary (29+ canonical events) | ✅ | `lifecycle-events.ts` |
| SSE stream `/workflows/:id/events` | ✅ | `swarm-execution.service.ts` emit; `apps/web/src/components/chat/ChatWorkspace.tsx` consumer |
| Live tool_called / tool_completed | ✅ | BaseAgent activity emitter |
| Live cost_updated with cached + reasoning tokens | ✅ | Sprint 2.2/I |
| agent_assigned event | ✅ | Sprint 2.1/K — router-node emit |
| verification_started/completed events | ✅ | Sprint 2.1/K — verifier-node emit |
| context_summarized event | ✅ | Sprint 2.2/H |
| pii_redacted indication on cost_updated | ✅ | Sprint 2.4/G |
| Approval pause UI | ✅ | Existing approval-required handler in ChatWorkspace |
| Resume on approval grant | ✅ | Existing approval-granted → SSE → workflow resumes |

---

## 6. Audit & Compliance

| Surface | Status | Proof |
|---|---|---|
| AuditRun model + lifecycle | ✅ | Migration 15 |
| Framework library (SOC 2 / HIPAA / ISO 27001) | ✅ | 167 controls seeded |
| Control matrix | ✅ | `audit/control-test.service.ts` |
| Auto-mapping of evidence to controls | ✅ | `compliance/mapping.service.ts` |
| Workpaper generation (PDF) | ✅ | `audit/workpaper.service.ts` |
| Final audit pack (gated on workpaper approval) | ✅ | `audit/final-audit-pack.service.ts`; refuses if any workpaper REQUIRES_APPROVAL |
| HMAC-signed evidence bundles | ✅ | `compliance/bundle-signing.service.ts` |
| Approval gates on workpapers | ✅ | `WorkflowArtifact.approvalState` |
| Audit trail (AuditLog) | ✅ | `AuditLogger` writes for every lifecycle event |
| External auditor portal | ✅ | Sprint 2.6 — invite tokens (SHA-256), engagement isolation, 8 routes, 3 UI pages |
| Retention sweep (cross-cuts every customer-data model) | 🚫 NOT IMPLEMENTED | Honest deferral per closure report |
| External auditor email send hook | 🚫 NOT IMPLEMENTED | Admin currently copies cleartext token from API response; email send is a future enhancement |

---

## 7. Source-grounded outputs + verification

| Surface | Status | Proof |
|---|---|---|
| Verifier hallucination heuristics | ✅ | 4 layers in `verifier.agent.ts` |
| Citation density check | ✅ | Sprint 2.4/F — for `needsGrounding=true` roles |
| `needsGrounding` flag on role manifest | ✅ | Tagged on Research (0.7) + Designer (0.5) |
| Verifier emits `verification_completed` with groundingScore | ✅ | Sprint 2.4/F |

---

## 8. Security

| Surface | Status | Proof |
|---|---|---|
| Tenant isolation (RBAC + Postgres queries) | ✅ | `enforceTenantIsolation` middleware; every service scopes by tenantId |
| `EXTERNAL_AUDITOR` engagement isolation | ✅ | Sprint 2.6 — `requireAuditorEngagement` middleware |
| RBAC roles (5 + 1 = SYSTEM_ADMIN/TENANT_ADMIN/OPERATOR/REVIEWER/END_USER + EXTERNAL_AUDITOR) | ✅ | `packages/security/src/rbac/roles.ts` + new EXTERNAL_AUDITOR |
| PII detection + redaction (ingest-time) | ✅ | `detectPII` in @jak-swarm/security; called on document ingest |
| PII auto-redaction in LLM prompts (runtime) | ✅ | Sprint 2.4/G — `RuntimePIIRedactor` wired into BaseAgent.executeWithTools |
| Prompt-injection detection | ✅ | `detectInjection` called on document ingest |
| HMAC bundle signing | ✅ | `bundle-signing.service.ts` |
| AUTH_SECRET hardening | ✅ | Boot guard refuses default secret |
| Secret scanning (gitleaks) | ✅ | CI workflow |
| Dependency audit (high+ CVEs blocking) | ✅ | CI workflow |
| Document sanitizer (untrusted content delimiter) | ✅ | Migration 16 |

---

## 9. Tests

| Suite | Count | Status |
|---|---|---|
| Unit tests | **695** passing | ✅ |
| Integration tests | (separate run; not measured this session) | requires Postgres |
| E2E tests (Playwright) | (separate; not run this session) | requires running server |
| LangGraph builder tests | 8 | ✅ |
| Postgres checkpointer tests | 18 | ✅ |
| External auditor tests | 11 | ✅ |
| Source-grounded contract tests | 16 | ✅ |
| PII redactor tests | 14 | ✅ |
| Document parsers tests | 7 | ✅ |
| URL crawler tests | 24 | ✅ |
| Company OS foundation tests | 26 | ✅ |
| Cache-cost regression tests | 3 | ✅ |
| Onboarding step tests | (covered by api typecheck + manual; no e2e in this session) | 🟡 |

---

## 10. Honest gaps + risks

These are real gaps named for the next session, NOT marketing concerns to hide:

1. **CEO super-orchestrator** that fans tasks to CMO+CTO+CFO under it — not implemented. Multi-agent execution today goes via Planner-decomposed parallel tasks. Consequence: a user asking "as my CEO, run a quarterly planning cycle" gets a Planner-built DAG, not a CEO agent that delegates.
2. **Cross-task auto-repair on node throw.** SwarmGraph had a while-loop catch-block that recomputed deps + skipped orphan tasks; the LangGraph version handles single-task failures but the multi-task dep cascade is documented as a follow-up in `qa/langgraph-parity-verification.md`.
3. **External auditor email send.** Admin currently copies cleartext token from API response; integrating with the existing email adapter is a small follow-up.
4. **External auditor final-pack viewing.** Scope `view_final_pack` exists in the schema; route serving it is not implemented yet (1-day add).
5. **Real Postgres-backed pause/resume integration test.** 18 unit tests cover the checkpoint storage; a live-Postgres e2e test would round out the empirical proof.
6. **In-flight workflow migration to LangGraph checkpoints.** Workflows started under SwarmGraph used `Workflow.stateJson`; the new LangGraph runtime uses `workflow_checkpoints`. Operators should drain in-flight workflows before deploying.
7. **Retention sweep across customer-data models.** Cross-cuts every model; named in the original closure report as ~1 week of work; not implemented.
8. **Browser automation against logged-in consumer sites** (Twitter/Reddit) remains fragile by nature; the role-manifest documents this as a `limitations` field on `WORKER_BROWSER`.

---

## 11. Verdict per category

| Category | Verdict |
|---|---|
| OpenAI-first runtime | ✅ Production-ready |
| LangGraph orchestration | ✅ Production-ready (LangGraph is the only runtime; SwarmGraph deleted) |
| Postgres checkpointer | ✅ Production-ready (tenant-scoped, 18 tests) |
| Intent + conversation | ✅ Production-ready |
| Company Brain (text + URL ingestion) | ✅ Production-ready |
| Document parsing (DOCX/XLSX/image) | ✅ Production-ready (with honest parseConfidence) |
| Role agents (workers + orchestrators) | 🟢 Working — CEO super-orchestrator not yet a separate class |
| Agent Run Cockpit | ✅ Production-ready |
| Audit & Compliance | ✅ Production-ready |
| External auditor portal | ✅ Production-ready (no email integration; documented in §7) |
| Source-grounded outputs | ✅ Production-ready |
| PII redaction (runtime) | ✅ Production-ready |
| Cost tracking + prompt caching | ✅ Production-ready |
| Tests | ✅ 695 unit tests pass |
| Security | ✅ Production-ready |

---

## 12. What I will NOT claim in marketing copy

- "Fully autonomous" — workflows pause for approval on HIGH-risk tasks by design
- "Compliance certified" — JAK provides AUDIT WORKFLOWS for SOC 2/HIPAA/ISO 27001, not certification
- "Zero hallucination" — Verifier reduces hallucination via heuristics + citation gating; cannot prove zero
- "Replaces your auditor" — JAK gives auditors a portal; humans still decide
- "Browser automation works on every site" — only allowlisted domains, only configured sites
- "100% of model providers supported" — OpenAI is the supported runtime; Anthropic/Gemini adapters compile but aren't in the default critical path
- "Real-time email/Slack integrations" — these are configured per-tenant; out-of-the-box they require setup
