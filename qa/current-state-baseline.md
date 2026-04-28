# Current-State Baseline (Phase 1, A-to-Z Audit, 2026-04-28)

Pure read-only snapshot. No code changed in this phase. Every fact below
is grep/file-system observable.

---

## 1. Git state

| Field | Value |
|---|---|
| Current commit | `c2fb125` (Final hardening — 5 gaps closed) |
| Branch | `main` |
| CI status on c2fb125 | ✅ success |
| CI status on prev commit ff69a61 | ✅ success |
| Last 10 commits | c2fb125 → ff69a61 → 34491f2 → 5e161e5 → e3e356f → e52a090 → a4c7f90 → aa031cf → 19422d4 → 32c929e |

---

## 2. Workspace layout

**`apps/`** (2):
- `api` — Fastify backend
- `web` — Next.js 16 frontend

**`packages/`** (12):
- `agents` — agent classes + runtime (BaseAgent, OpenAIRuntime, role agents)
- `client` — typed SDK
- `db` — Prisma schema + client
- `industry-packs` — per-industry tool-restriction policies
- `security` — RBAC + PII detection + injection detection + runtime PII redactor + audit logger
- `shared` — types + cost calculation + shared constants
- `swarm` — workflow orchestration (LangGraph builder + state + nodes + runtime)
- `tools` — 122 classified tools (classified maturity)
- `verification` — output verification utilities
- `voice` — voice session adapters
- `whatsapp-client` — WhatsApp adapter
- `workflows` — higher-level orchestration helpers

---

## 3. API routes (30 files in `apps/api/src/routes/`)

```
admin-aggregate.routes.ts        admin-diagnostics.routes.ts
admin-retention.routes.ts        analytics.routes.ts
approvals.routes.ts              artifacts.routes.ts
audit-runs.routes.ts             audit.routes.ts
auth.routes.ts                   bundles.routes.ts
company-brain.routes.ts          compliance.routes.ts
documents.routes.ts              exports.routes.ts
external-auditor.routes.ts       integrations.routes.ts
layouts.routes.ts                llm-settings.routes.ts
memory.routes.ts                 onboarding.routes.ts
paddle.routes.ts                 projects.routes.ts
schedules.routes.ts              skills.routes.ts
slack.routes.ts                  tenants.routes.ts
tools.routes.ts                  traces.routes.ts
usage.routes.ts                  voice.routes.ts
workflows.routes.ts (the workflow start endpoint)
```

---

## 4. Frontend pages

`apps/web/src/app/`:
- `(auth)` group — login / register / forgot-password / reset-password / onboarding
- `(dashboard)` group — workspace, audit/runs, audit, files, knowledge, etc.
- `auditor/` — external-auditor portal (accept/[token], runs, runs/[id])
- `auth/` — auth callbacks
- `__e2e__/` — e2e test helpers

---

## 5. Database / migrations

Prisma schema at `packages/db/prisma/schema.prisma`. Migrations applied
in lex+digit-run sort order. Latest visible:
- `100_workflow_checkpoint` — LangGraph PostgresCheckpointSaver storage
- `101_external_auditor_portal` — auditor invite/engagement/action
- `102_auditor_invite_email_status` — invite email-send status columns

---

## 6. Test framework + result

- Framework: vitest
- Test count (unit): **751 passing / 0 failing / 0 skipped**
- Test files: 72 passing
- Local run duration: ~18s
- Integration tests exist (Postgres-required) but not run in this baseline

---

## 7. Runtime / env flags

| Env var | Default | Purpose |
|---|---|---|
| `JAK_EXECUTION_ENGINE` | `openai-first` (Phase 7 default) | Runtime selection (LegacyRuntime fallback removed) |
| `JAK_WORKFLOW_RUNTIME` | `langgraph` (only runtime) | SwarmGraph fallback removed in `34491f2`; setting to `swarmgraph` logs a warning |
| `JAK_OPENAI_RUNTIME_AGENTS` | unset (all agents use OpenAI) | Per-agent allowlist |
| `JAK_INVITE_EMAIL_*` | unset → `not_configured` honest status | Auditor invite email SMTP |
| `JAK_PORTAL_BASE_URL` | `https://app.jak-swarm.com` | Auditor portal URL builder |
| `JAK_PII_REDACTION_DISABLED` | unset (PII redaction ON) | Runtime PII redaction in LLM prompts |
| `OPENAI_API_KEY` | required for live LLM calls | OpenAI Responses API |

---

## 8. Worker / async structure

- `apps/api/src/services/queue-worker.ts` — durable Postgres-backed queue
- `apps/api/src/services/swarm-execution.service.ts` — workflow execution service (calls SwarmRunner, which now wraps LangGraphRuntime)
- Activity event side-channel: `packages/swarm/src/supervisor/activity-registry.ts`
- Lifecycle event vocabulary: `packages/swarm/src/workflow-runtime/lifecycle-events.ts`

---

## 9. Audit scope honesty

**Phases I can fully execute in this session (static + tests):**
- Phase 1 (this), 2 (codebase map), 3 (fake/dummy grep), 4 (OpenAI runtime code review), 5 (LangGraph code + topology), 6 (intent parser code + tests), 7 (role agent inventory), 9 (Company Brain code + schema), 10 (workflow code), 11 (audit/compliance code), 13 (security code + tests), 14 (cost-tracking code), 15 (existing tests + delta), 16 (scorecard from collected evidence), 18 (README/landing claim audit).

**Phases that require live runtime / browser / API key (NEEDS RUNTIME):**
- Phase 7 deep behavioral testing of every agent (need live OpenAI)
- Phase 8 actual agent output quality assessment (need live LLM runs)
- Phase 12 manual UI testing (need running dev server + browser)
- Phase 15 E2E tests with live LLM (need OPENAI_API_KEY + record/replay infra)

**Phase 17 fixes:** I will fix what static audit surfaces; runtime-only gaps will be honestly named.

---

## 10. Definition of "done" for this audit

I will NOT mark any phase "complete" with vague language. Each phase
output document contains explicit findings with file references. Each
rating is justified with evidence. NEEDS RUNTIME is a valid honest
verdict — not a skip.
