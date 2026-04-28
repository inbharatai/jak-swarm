# Codebase A-to-Z Map (Phase 2)

Pure observed structure as of `c2fb125`. Numbers are file counts in
the listed directories (not lines of code).

---

## 1. Top-level workspaces

```
apps/api                Fastify backend (TypeScript, ESM)
apps/web                Next.js 16 frontend (App Router)
packages/agents         BaseAgent + 38 agent classes + OpenAI runtime
packages/client         Typed SDK
packages/db             Prisma schema + client
packages/industry-packs Per-industry tool restrictions
packages/security       RBAC + PII + injection + audit logger + runtime PII redactor
packages/shared         Shared types + cost calc + LLM pricing
packages/swarm          LangGraph orchestrator + state + nodes + workflow runtime
packages/tools          146 tool entries + adapters
packages/verification   Output verification utilities
packages/voice          Voice session adapter
packages/whatsapp-client WhatsApp adapter
packages/workflows      Higher-level orchestration
```

---

## 2. Backend routes (30 files)

Auth + tenant lifecycle:
- `auth.routes.ts`, `tenants.routes.ts`, `onboarding.routes.ts`

Workflow + execution:
- `workflows.routes.ts`, `traces.routes.ts`, `analytics.routes.ts`,
  `usage.routes.ts`, `schedules.routes.ts`

Approvals + artifacts:
- `approvals.routes.ts`, `artifacts.routes.ts`, `bundles.routes.ts`,
  `exports.routes.ts`, `documents.routes.ts`

Audit + compliance:
- `audit.routes.ts`, `audit-runs.routes.ts`, `compliance.routes.ts`,
  `external-auditor.routes.ts`

Company OS / brain:
- `company-brain.routes.ts`, `memory.routes.ts`, `projects.routes.ts`,
  `layouts.routes.ts`

Admin:
- `admin-aggregate.routes.ts`, `admin-diagnostics.routes.ts`,
  `admin-retention.routes.ts`

Integrations + tools:
- `integrations.routes.ts`, `slack.routes.ts`, `tools.routes.ts`,
  `voice.routes.ts`, `paddle.routes.ts`, `llm-settings.routes.ts`,
  `skills.routes.ts`

---

## 3. Backend services (32 files)

`apps/api/src/services/`:

**Workflow/runtime:**
- `swarm-execution.service.ts` (1700+ lines — workflow orchestrator)
- `vibe-coding-execution.service.ts`
- `queue-worker.ts`, `db-state-store.ts`, `checkpoint.service.ts`
- `workflow.service.ts`, `workflow-timeline.service.ts`
- `repair.service.ts` (Final hardening / Gap B)
- `ceo-orchestrator.service.ts` (Final hardening / Gap A)

**Audit:**
- `audit-run.service.ts`, `control-test.service.ts`,
  `audit-exception.service.ts`, `workpaper.service.ts`,
  `final-audit-pack.service.ts`, `external-auditor.service.ts`

**Compliance:**
- `compliance-mapper.service.ts`, `attestation.service.ts`,
  `attestation-scheduler.service.ts`, `manual-evidence.service.ts`,
  `auto-mapping-rules.ts`

**Company Brain:**
- `company-profile.service.ts`, `crawler.service.ts`,
  `intent-record.service.ts`, `memory-approval.service.ts`,
  `workflow-template.service.ts`

**Conversation/intent:**
- `conversation/followup-parser.ts`

**Document parsing:**
- `document-parsing/parsers.ts` (DOCX/XLSX/image)

**Bundles + exports:**
- `bundle.service.ts`, `bundle-signing.service.ts`, `export.service.ts`,
  `exporters/index.ts`, `artifact.service.ts`

**Auth + storage:**
- `auth.service.ts`, `credential.service.ts`, `storage.service.ts`,
  `oauth-providers.ts`, `sandbox.service.ts`

**Retention:**
- `retention-sweep.service.ts` (Final hardening / Gap E)

**Project + scheduler:**
- `project.service.ts`, `scheduler.service.ts`

---

## 4. Agent layer

`packages/agents/src/`:
- `base/` — BaseAgent + AgentContext + provider router
- `runtime/` — OpenAIRuntime, LegacyRuntime, model resolver,
  schemas, tool adapter, response parser
- `roles/` — 6 orchestrator roles: commander, planner, router, guardrail,
  verifier, approval
- `workers/` — **32 worker agents:**
  analytics, app-architect, app-debugger, app-deployer, app-generator,
  browser, calendar, coder, content, crm, designer, document, email,
  finance, growth, hr, knowledge, legal, marketing, ops, pr, product,
  project, research, screenshot-to-code, seo, spreadsheet, strategist,
  success, support, technical, voice
- `intents/` — `COMPANY_OS_INTENTS` (18 named) + `INTENT_TO_LIKELY_AGENTS`
- `role-manifest.ts` — per-role maturity + needsGrounding flag

**Total agent classes:** 6 orchestrators + 32 workers = **38 agents**.

---

## 5. Swarm / orchestration layer

`packages/swarm/src/`:
- `graph/nodes/` — 9 node files: commander, planner, router, guardrail,
  worker, verifier, approval, validator, replanner (and a `worker/`
  subdir for the worker's intent-inference + task-input-builder helpers)
- `graph/edges.ts` — 4 conditional-edge functions extracted from deleted swarm-graph.ts
- `graph/task-scheduler.ts` — getReadyTasks + getSkippedTasks
- `state/swarm-state.ts` — `SwarmState` interface (28 fields)
- `state/run-lifecycle.ts` — typed state machine
- `state/workflow-state-store.ts` — InMemoryStateStore + interface
- `runner/swarm-runner.ts` — facade over LangGraphRuntime (Sprint 2.5/A.6 rewrite)
- `workflow-runtime/` — LangGraphRuntime + PostgresCheckpointSaver +
  langgraph-graph-builder + lifecycle-events + workflow-runtime
  interface
- `supervisor/` — circuit-breaker, supervisor-bus, breaker-registry,
  activity-registry
- `context/` — context-summarizer
- `coordination/` — execute-guarded
- `memory/` — memory-extractor
- `workflows/` — vibe-coder-workflow, docker-build-checker,
  static-build-checker

---

## 6. Frontend pages (App Router)

`apps/web/src/app/`:
- `(auth)/` — login, register, onboarding (5 steps incl. Company Info), forgot/reset password
- `(dashboard)/` — workspace, audit (5 tabs), audit/runs, files,
  knowledge, integrations, schedules, social, traces, swarm, etc.
- `auditor/` — accept/[token], runs, runs/[id] (with final-pack download UI)
- `auth/` — auth callbacks
- `__e2e__/` — e2e test helpers
- `page.tsx` — landing page (1300+ lines)

---

## 7. Database schema (Prisma)

`packages/db/prisma/schema.prisma` — central schema with all models.
Migration directory has 100+ migration entries; latest 4 of note:
- `99_memory_item_status` — Migration 16 split-fix
- `100_workflow_checkpoint` — LangGraph checkpoints
- `101_external_auditor_portal` — auditor invite/engagement/action
- `102_auditor_invite_email_status` — invite email status columns

---

## 8. Tools registry

`packages/tools/src/`:
- `builtin/index.ts` — 122+ classified tool entries
- `adapters/` — browser (Playwright), calendar (CalDAV), crm,
  email (Gmail IMAP/SMTP), memory (vector), phoring, sandbox,
  search (Serper/Tavily/DDG), social
- `mcp/` — MCP gateway
- `registry/` — TenantToolRegistry (per-tenant, industry-pack-aware)
- `security/` — document sanitizer

---

## 9. Lifecycle event vocabulary (the cockpit contract)

`packages/swarm/src/workflow-runtime/lifecycle-events.ts` — single
discriminated union with **49+ event types** including:
- core: created, started, planned, step_started/completed/failed,
  approval_required/granted/rejected, resumed, cancelled, completed, failed
- intent (Migration 16): intent_detected, clarification_required/answered,
  workflow_selected
- agent_assigned, verification_started/completed
- context_summarized (Sprint 2.2)
- company_context_loaded/used_by_agent/missing,
  company_memory_suggested/approved/rejected
- ceo_* (8 events, Final hardening / Gap A)
- repair_* (6 events, Final hardening / Gap B)
- retention_* (6 events, Final hardening / Gap E)

---

## 10. QA documentation footprint

`qa/` directory has 70+ documents from prior audit cycles. The audits
created in this session:
- `current-state-baseline.md` (Phase 1)
- `codebase-a-to-z-map.md` (this file, Phase 2)
- 16 more audit docs to be created across phases 3–18.

---

## 11. Test footprint

`tests/`:
- `unit/` — 72 test files, 751 passing tests
- `integration/` — exists, requires Postgres
- `e2e/` — Playwright specs (require running server)
- `coverage/` — vitest coverage output

---

## 12. Flagged for next phases

- Heavy reliance on dynamic imports (`require('...')`) in service files
  to avoid circular deps — needs runtime verification that lazy paths
  actually resolve at production runtime
- Many services reference `(this.db as any).<model>` patterns where
  the Prisma client typedef predates a migration — these will fail
  at runtime if the migration isn't applied. Will be checked in
  security/cost phases.
- 70+ historic QA docs may carry stale claims that contradict current
  state — to be reconciled in Phase 18.
