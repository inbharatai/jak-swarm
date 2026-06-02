# JAK Swarm — API Reference

All endpoints are prefixed with `/api`. Responses follow the envelope format:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "...", "message": "..." } }
```

---

## 🔑 Authentication

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| POST | `/auth/register` | None | Create tenant + admin user, returns JWT |
| POST | `/auth/login` | None | Authenticate with email + password, returns JWT |
| POST | `/auth/logout` | JWT | Invalidate session (client discards token) |
| GET | `/auth/me` | JWT | Get current user profile |

Auth endpoints are rate-limited to 10 requests per minute per IP.

---

## 🐝 Workflows

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| POST | `/workflows` | JWT | Create workflow and start async execution (returns 202) |
| GET | `/workflows` | JWT | List workflows (paginated, filterable by status) |
| GET | `/workflows/:workflowId` | JWT | Get workflow details with traces and approvals |
| POST | `/workflows/:workflowId/pause` | JWT | Pause a running workflow between nodes |
| POST | `/workflows/:workflowId/unpause` | JWT | Resume a paused workflow |
| POST | `/workflows/:workflowId/stop` | JWT | Stop workflow immediately (marks CANCELLED) |
| POST | `/workflows/:workflowId/resume` | JWT + Reviewer | Resume after human-in-the-loop approval decision |
| DELETE | `/workflows/:workflowId` | JWT | Cancel a running or pending workflow |
| GET | `/workflows/:workflowId/traces` | JWT | Get agent traces for a workflow |
| GET | `/workflows/:workflowId/approvals` | JWT | Get approval requests for a workflow |
| GET | `/workflows/:workflowId/stream` | JWT (query) | SSE event stream for real-time updates |
| GET | `/workflows/:workflowId/output` | JWT | Download final output as markdown |

---

## 💬 Conversations

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/conversations` | JWT | List conversations for current user |
| POST | `/conversations` | JWT | Create a new conversation thread |
| GET | `/conversations/:id` | JWT | Get a conversation with its messages |
| DELETE | `/conversations/:id` | JWT | Delete a conversation and its messages |
| POST | `/workflows` | JWT | Create workflow accepts optional `conversationId`; prior thread history is injected into the Commander node's prompt automatically |

---

## ✅ Approvals

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/approvals` | JWT + Reviewer | List approval requests (filterable by status) |
| GET | `/approvals/:approvalId` | JWT + Reviewer | Get a single approval request |
| POST | `/approvals/:approvalId/decide` | JWT + Reviewer | Submit decision (APPROVED/REJECTED/DEFERRED) |
| POST | `/approvals/:approvalId/defer` | JWT + Reviewer | Convenience shortcut to defer an approval |

---

## 🔌 Integrations

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/integrations` | JWT | List connected MCP integrations for tenant |
| GET | `/integrations/providers/:provider` | JWT | Get provider setup info (credential fields, instructions) |
| POST | `/integrations/connect` | JWT | Connect an MCP integration with credentials |
| POST | `/integrations/:id/test` | JWT | Test an integration connection |
| DELETE | `/integrations/:id` | JWT | Disconnect and remove an integration |

---

## ⏰ Schedules

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/schedules` | JWT | List all schedules for tenant |
| GET | `/schedules/:id` | JWT | Get a single schedule |
| POST | `/schedules` | JWT | Create a new cron schedule |
| PATCH | `/schedules/:id` | JWT | Update schedule (cron, name, enabled, etc.) |
| DELETE | `/schedules/:id` | JWT | Delete a schedule |
| POST | `/schedules/:id/run` | JWT | Trigger an immediate run of a schedule |

---

## 🧠 Memory

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/memory` | JWT | List memory entries (filterable by type, searchable) |
| GET | `/memory/:key` | JWT | Get a specific memory entry by key |
| PUT | `/memory/:key` | JWT + Operator | Upsert a memory entry (FACT/PREFERENCE/CONTEXT/SKILL_RESULT) |
| DELETE | `/memory/:key` | JWT + Admin | Delete a memory entry |

---

## 🔧 Tools

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/tools` | JWT | List all registered tools with metadata |
| GET | `/tools/:toolName` | JWT | Get full tool detail (risk class, schemas) |

---

## 🔎 Traces

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/traces` | JWT | List agent traces (filterable by workflowId, agentRole) |
| GET | `/traces/:traceId` | JWT | Get full trace by ID |
| GET | `/traces/:traceId/replay` | JWT | Get replay-friendly trace data with timing |
| GET | `/traces/workflow/:workflowId/timeline` | JWT | Workflow timeline with per-node start/end/cost breakdown |

---

## 📊 Analytics

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/analytics/usage` | JWT | Tenant usage summary (tokens, cost, time series) |
| GET | `/analytics/usage/workflow/:workflowId` | JWT | Per-workflow usage report (cost by provider/model/agent) |
| GET | `/analytics/cost` | JWT | Cost breakdown for current billing period (last 30 days) |

---

## ⚙️ LLM Settings

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/settings/llm` | JWT | List configured LLM providers (OpenAI + Gemini) with masked key previews |
| GET | `/settings/llm/status` | JWT | Health check all providers — tests API key availability |
| GET | `/settings/llm/preferred-provider` | JWT | Get tenant's current preferred LLM provider (default: `openai`) |
| PUT | `/settings/llm/preferred-provider` | JWT + Operator | Switch preferred provider (`openai` or `gemini`) — stored in `TenantMemory` |
| PUT | `/settings/llm/:provider` | JWT + Operator | Set or update API key for a provider (AES-256-GCM encrypted at rest) |
| DELETE | `/settings/llm/:provider` | JWT + Admin | Remove a stored API key |

**Per-tenant provider switching:** Each tenant independently selects OpenAI or Gemini. The preference propagates to every agent in every workflow with zero code changes. Provider identity is privacy-masked for non-owner users (`canRevealProviderIdentity`).

---

## 🎤 Voice

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| POST | `/voice/sessions` | JWT | Create voice session (returns WebRTC config) |
| GET | `/voice/sessions/:sessionId/token` | JWT | Get ephemeral WebRTC token from OpenAI Realtime API |
| DELETE | `/voice/sessions/:sessionId` | JWT | End a voice session |
| GET | `/voice/sessions/:sessionId/transcript` | JWT | Retrieve transcript for a voice session |
| POST | `/voice/sessions/:sessionId/trigger-workflow` | JWT | Convert voice transcript into a workflow execution |

---

## 💬 Slack

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| POST | `/slack/events` | HMAC-SHA256 | Slack Events API webhook (url_verification + event_callback) |
| POST | `/slack/interactivity` | HMAC-SHA256 | Slack interactive component payloads |

Slack routes verify `X-Slack-Signature` headers against `SLACK_SIGNING_SECRET`. Events trigger authenticated workflows with thread-reply results. Idempotent event handling prevents duplicate workflow creation on Slack retries.

---

## 🏢 Tenants

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/tenants/:tenantId` | JWT | Get tenant info |
| PATCH | `/tenants/:tenantId` | JWT + Admin | Update tenant settings |
| GET | `/tenants/:tenantId/users` | JWT + Admin | List users in tenant |
| POST | `/tenants/:tenantId/users` | JWT + Admin | Invite a new user to the tenant |
| PATCH | `/tenants/:tenantId/users/:userId` | JWT + Admin | Update user role or active status |
| PATCH | `/tenants/current/users/:userId` | JWT | Update own profile (name, jobFunction, avatarUrl) |

---

## 🎯 Skills

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/skills` | JWT | List skills (filterable by tier and status) |
| GET | `/skills/:skillId` | JWT | Get skill by ID |
| POST | `/skills/propose` | JWT | Propose a new tenant skill |
| POST | `/skills/:skillId/approve` | JWT + Admin | Approve a proposed skill |
| POST | `/skills/:skillId/reject` | JWT + Admin | Reject a proposed skill |
| POST | `/skills/:skillId/sandbox` | JWT + Admin | Trigger sandbox test run for a proposed skill |

---

## 🚀 Onboarding

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/onboarding/state` | JWT | Get current onboarding state |
| POST | `/onboarding/state` | JWT | Update onboarding progress (completedSteps, dismissed) |

---

## 🛡️ Audit & Compliance — v0 (audit log + reviewer surfaces)

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/audit/log` | JWT | Paginated AuditLog with filters (action / resource / dates / search) |
| GET | `/audit/workflows/:id/trail` | JWT | Chronological event stream for one workflow |
| GET | `/audit/reviewer-queue` | JWT + Reviewer | Pending workflow approvals + pending artifact downloads |
| GET | `/audit/dashboard` | JWT + Reviewer | High-level audit metrics |

---

## 🛡️ Compliance — v1 (control framework mapping)

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/compliance/frameworks` | JWT | List all available frameworks (soc2-type2, hipaa-security, iso27001-2022) |
| GET | `/compliance/frameworks/:slug` | JWT | Framework detail + per-control evidence count |
| GET | `/compliance/frameworks/:slug/controls/:controlId/evidence` | JWT | Drill into one control's evidence rows |
| POST | `/compliance/frameworks/:slug/auto-map` | JWT + Reviewer | Re-run the auto-mapping rule engine |
| POST | `/compliance/frameworks/:slug/attestations` | JWT + Reviewer | Generate a period attestation PDF (optionally signed) |
| GET | `/compliance/attestations` | JWT | List previously generated attestations |
| POST | `/compliance/manual-evidence` | JWT + Reviewer | Add a curated manual evidence row (BAA, training record, etc.) |
| GET | `/compliance/controls/:controlId/manual-evidence` | JWT | List manual evidence for a control |
| DELETE | `/compliance/manual-evidence/:id` | JWT + Reviewer | Soft-delete manual evidence |
| GET | `/compliance/schedules` | JWT | List recurring attestation schedules |
| POST | `/compliance/schedules` | JWT + Reviewer | Create a recurring attestation cron schedule |
| PATCH | `/compliance/schedules/:id` | JWT + Reviewer | Update a schedule |
| DELETE | `/compliance/schedules/:id` | JWT + Reviewer | Delete a schedule |

---

## 🛡️ Audit Runs — v2 (full engagement workflow)

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| POST | `/audit/runs` | JWT + Reviewer | Create a new audit run for a framework + period (status='PLANNING') |
| GET | `/audit/runs` | JWT | List audit runs (paginated, filterable by status) |
| GET | `/audit/runs/:id` | JWT | Detail with embedded controls, exceptions, workpapers |
| POST | `/audit/runs/:id/plan` | JWT + Reviewer | Seed `ControlTest` rows from framework. PLANNING → PLANNED |
| POST | `/audit/runs/:id/auto-map` | JWT + Reviewer | Run `ComplianceMapperService` for the run's framework + period |
| POST | `/audit/runs/:id/test-controls` | JWT + Reviewer | Run all not-yet-passed tests. PLANNED → TESTING → REVIEWING |
| POST | `/audit/runs/:id/controls/:controlTestId/test` | JWT + Reviewer | Re-run one test |
| POST | `/audit/runs/:id/workpapers/generate` | JWT + Reviewer | Render PDFs for every terminal control test |
| POST | `/audit/runs/:id/workpapers/:wpId/decide` | JWT + Reviewer | Approve / reject one workpaper |
| POST | `/audit/runs/:id/exceptions` | JWT + Reviewer | Manually create an exception |
| PATCH | `/audit/runs/:id/exceptions/:exId/remediation` | JWT + Reviewer | Update remediation plan / owner / due date |
| POST | `/audit/runs/:id/exceptions/:exId/decide` | JWT + Reviewer | Apply state transition (accepted / rejected / closed / …) |
| POST | `/audit/runs/:id/final-pack` | JWT + Reviewer | Generate signed final evidence pack (gated on workpaper approval) |
| DELETE | `/audit/runs/:id` | JWT + TenantAdmin | Soft-delete an audit run |

**Error codes:** `409 ILLEGAL_TRANSITION` (state machine refused), `409 FINAL_PACK_GATE` (workpapers unapproved), `503 AUDIT_SCHEMA_UNAVAILABLE` (apply migration 15 with `pnpm db:migrate:deploy`), `503 BUNDLE_SIGNING_UNAVAILABLE` (set `EVIDENCE_SIGNING_SECRET`).

---

## 📦 Artifacts + Bundles + Exports

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/artifacts/:id` | JWT | Get artifact metadata (tenant-scoped) |
| GET | `/artifacts/:id/download` | JWT | Signed download URL (gated by `approvalState`) |
| POST | `/artifacts/:id/approve` | JWT + Reviewer | Approve an artifact for download |
| POST | `/artifacts/:id/reject` | JWT + Reviewer | Reject artifact (download permanently blocked) |
| POST | `/exports` | JWT | Create an export (json/csv/xlsx/pdf/docx) |
| POST | `/bundles` | JWT + Reviewer | Generate HMAC-signed evidence bundle for a workflow |
| GET | `/bundles/:id/verify` | JWT | Verify bundle signature + re-hash referenced artifacts |