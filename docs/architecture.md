# JAK Swarm — System Architecture

## Table of Contents

1. [System Overview](#system-overview)
2. [Component Diagram](#component-diagram)
3. [Data Flow](#data-flow)
4. [Agent Communication Pattern](#agent-communication-pattern)
5. [Swarm Execution Model](#swarm-execution-model)
6. [Voice Pipeline](#voice-pipeline)
7. [Tool Registry](#tool-registry)
8. [Industry Pack System](#industry-pack-system)
9. [Security Model](#security-model)
10. [Observability](#observability)
11. [Deployment Topology](#deployment-topology)

---

## System Overview

JAK Swarm is a production-grade autonomous multi-agent platform designed to automate complex, multi-step business workflows across industries. The platform is built as a TypeScript monorepo with the following core principles:

- **Multi-tenant by default** — every resource is scoped to a tenant; cross-tenant access is impossible by design.
- **Human-in-the-loop** — high-risk actions are gated by configurable approval workflows before execution.
- **Full observability** — every agent step, tool call, and handoff is traced and stored for audit and debugging.
- **Industry-aware** — industry packs customise agent prompts, tool allowlists, compliance notes, and approval thresholds per vertical.
- **Extensible skill system** — operators can propose new Tier 3 skills that go through a sandbox-and-review pipeline before activation.

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                │
│                                                                     │
│   ┌──────────────────┐    ┌────────────────────────────────────┐   │
│   │  Next.js Web App │    │  Voice WebRTC Client (browser)     │   │
│   │  (apps/web)      │    │  OpenAI Realtime API               │   │
│   └────────┬─────────┘    └─────────────────┬──────────────────┘   │
└────────────│──────────────────────────────── │────────────────────--┘
             │ HTTPS / REST + SSE              │ WebRTC / WS
             ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          API LAYER                                   │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  Hono API Server (apps/api)  — port 4000                    │  │
│   │  • Auth middleware (JWT + API Key)                           │  │
│   │  • Tenant isolation middleware                               │  │
│   │  • Route: POST /workflows                                    │  │
│   │  • Route: GET  /workflows/:id                               │  │
│   │  • Route: GET  /workflows/:id/traces                        │  │
│   │  • Route: POST /approvals/:id/decide                        │  │
│   │  • Route: POST /voice/session                               │  │
│   │  • Route: GET  /tools                                       │  │
│   │  • Route: POST /skills                                      │  │
│   └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Temporal Activity Calls
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATION LAYER                             │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  Temporal Workflow Engine (apps/worker)                      │  │
│   │  • SwarmWorkflow.ts — root durable workflow                 │  │
│   │  • CommanderActivity, PlannerActivity, RouterActivity       │  │
│   │  • ApprovalActivity — blocks on human decision              │  │
│   │  • VerifierActivity, GuardrailActivity                      │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  Agent Engine (packages/agents)                              │  │
│   │  • OpenAI Agents SDK runner                                  │  │
│   │  • AgentFactory — instantiates agents with correct config   │  │
│   │  • ToolRegistry — resolves tool names to implementations    │  │
│   │  • GuardrailMiddleware — wraps every tool call              │  │
│   └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
        ┌────────────────────┼───────────────────┐
        ▼                    ▼                   ▼
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  PostgreSQL  │   │      Redis       │   │   External APIs  │
│  (Prisma)    │   │  (job queues,    │   │  (OpenAI, Gmail, │
│  • tenants   │   │   sessions,      │   │   Salesforce,    │
│  • workflows │   │   rate limits)   │   │   etc.)          │
│  • traces    │   └──────────────────┘   └──────────────────┘
│  • approvals │
│  • skills    │
│  • memory    │
│  • audit logs│
└──────────────┘
```

---

## Data Flow

### Workflow Creation Flow

```
1. User submits goal via POST /workflows
2. API validates JWT/ApiKey and extracts TenantContext
3. API creates Workflow record in DB (status=PENDING)
4. API enqueues Temporal workflow execution
5. Temporal starts SwarmWorkflow with workflowId
6. Commander agent receives goal + tenant context
7. Commander enriches with IndustryPack data
8. Planner decomposes into WorkflowPlan
9. Guardrail validates plan
10. Router dispatches tasks sequentially/in parallel
11. Each task executes via Worker agent + tool calls
12. High-risk tasks pause for ApprovalRequest creation
13. Human reviewer approves/rejects via API
14. On all tasks done, Verifier validates output
15. Commander synthesises final result
16. Workflow record updated to COMPLETED
17. SSE event pushed to client
```

### Approval Flow

```
Router detects task.requiresApproval = true
    │
    ▼
Approval Manager creates ApprovalRequest record (status=PENDING)
    │
    ▼
Notification sent (email / Slack / webhook)
    │
    ▼
Reviewer opens approval UI, sees proposed action + rationale
    │
    ├── APPROVED → Router resumes task execution
    ├── REJECTED → Task cancelled, downstream tasks skipped
    └── DEFERRED → Request re-queued with new expiry
```

---

## Agent Communication Pattern

Agents communicate via structured handoffs, not direct function calls. Each handoff is:

1. Logged as an `AgentHandoff` in the current trace
2. Carried as context into the next agent's run
3. Observable in the trace viewer UI

The pattern enforces:
- **Loose coupling** — agents do not import each other
- **Full auditability** — the complete chain of reasoning is preserved
- **Temporal durability** — Temporal activities wrap each agent run, providing automatic retry and state persistence

---

## Swarm Execution Model

The swarm uses a hierarchical execution model:

```
Level 0: Commander    — one per workflow, always present
Level 1: Planner      — one per workflow, runs once
Level 1: Guardrail    — invoked before plan execution and after each tool call
Level 1: Verifier     — one per workflow, runs after all tasks complete
Level 2: Router       — one per workflow, manages task lifecycle
Level 2: Approval     — zero or more per workflow, one per approval gate
Level 3: Workers      — one instance per task (N workers can run in parallel)
```

**Parallelism:**
The Router analyses the dependency graph and dispatches all tasks with no unresolved dependencies simultaneously, subject to `tenant.maxConcurrentWorkflows`. Temporal's `Promise.all` semantics handle parallel activity execution.

**Durability:**
Every agent run is a Temporal Activity. If the worker process crashes mid-execution, Temporal replays the workflow from the last completed activity. Tool calls include idempotency keys to prevent double-execution on replay.

---

## Voice Pipeline

```
Browser Microphone
        │
        │ WebRTC (OpenAI Realtime API — primary)
        ▼
OpenAI Realtime Model (gpt-4o-realtime-preview)
        │
        │ Transcription + VAD + response audio
        ▼
Voice Worker Agent
        │
        │ Structured intent extraction
        ▼
Commander Agent ─── launches workflow as normal
        │
        │ Text response
        ▼
Voice Worker Agent
        │
        │ TTS (OpenAI Realtime / ElevenLabs fallback)
        ▼
Browser Speaker
```

**Fallback path:**
If OpenAI Realtime is unavailable, the system falls back to:
- Deepgram Nova-3 for STT (streaming WebSocket)
- ElevenLabs for TTS
- Standard text I/O for the agent layer

**Session lifecycle:**
- Session created with `VoiceSession` record on connect
- `TranscriptSegment` records appended as speech is processed
- Session closed and summarised on disconnect
- Raw audio never persisted — only processed transcripts

---

## Tool Registry

The Tool Registry is the central catalogue of all capabilities available to worker agents.

**Structure:**
```
packages/tools/
  src/
    registry.ts       — ToolRegistry class, dynamic loader
    categories/
      email/          — Gmail, Outlook adapters
      calendar/       — Google Calendar, Exchange adapters
      crm/            — Salesforce, HubSpot, Pipedrive adapters
      document/       — Google Docs, Word adapters
      spreadsheet/    — Google Sheets, Excel adapters
      browser/        — Playwright-based automation
      research/       — Tavily, Serper, arXiv adapters
      knowledge/      — pgvector RAG, Pinecone adapters
      messaging/      — Slack, Teams adapters
      webhook/        — generic outbound webhook
```

**Tool resolution:**
1. Worker agent requests tool by name from ToolRegistry
2. Registry looks up ToolMetadata (category, riskClass, requiresApproval)
3. Registry checks tenant's enabled tools and skill permissions
4. GuardrailMiddleware wraps execution (pre + post check)
5. If riskClass >= threshold: ApprovalManager gate invoked
6. Tool executes with ToolExecutionContext (tenantId, workflowId, runId)
7. Result returned as `ToolResult<T>`

---

## Industry Pack System

Industry packs customise the swarm's behaviour for specific verticals. A pack is loaded at workflow start based on the tenant's `industry` setting.

**Pack application:**
1. IndustryPack selected based on `Tenant.industry` enum value
2. `agentPromptSupplement` appended to Commander and Planner system prompts
3. `policyOverlays` loaded into Guardrail's rule set
4. `recommendedApprovalThreshold` used as default if tenant hasn't overridden
5. `restrictedTools` merged with Guardrail block list
6. `allowedTools` used to constrain Router's tool dispatch options

See `docs/industry-packs.md` for the full design.

---

## Security Model

### Authentication
- **Web app users:** JWT issued by Auth.js (NextAuth), RS256 signed
- **API consumers:** HMAC-SHA256 API keys scoped to tenant + permission set
- **Inter-service:** Temporal mTLS for worker communication

### Authorisation
- Every API request passes through `tenantIsolationMiddleware`
- All DB queries include `WHERE tenantId = :tenantId` enforced at repository layer
- Role-based access: TENANT_ADMIN > OPERATOR > REVIEWER > END_USER
- Approval actions require REVIEWER role minimum

### Data Isolation
- Separate Postgres row-level isolation per tenant (tenant_id column on every table)
- Redis keys namespaced: `jak:{tenantId}:{resource}`
- No cross-tenant joins permitted in any query

For the full threat model, see `docs/security-threat-model.md`.

---

## Observability

### Structured Logging
- All services use `pino` with JSON output in production
- Log levels: debug, info, warn, error
- Every log line includes: `tenantId`, `workflowId`, `traceId`, `agentRole`

### Distributed Tracing
- `AgentTrace` records stored in `agent_traces` table
- Linked by `traceId` (correlation ID across the full workflow)
- Trace viewer in the web app shows the full execution DAG

### Metrics (planned — Phase 1b)
- Prometheus metrics exposed at `/metrics`
- Key metrics: workflow throughput, agent latency p50/p95/p99, tool error rates, approval queue depth

### Audit Logs
- `AuditLog` table records every user action and agent side effect
- Immutable once written (append-only pattern)
- Retention controlled per tenant via `logRetentionDays` setting
- Exportable for compliance (HIPAA, SOC 2)

---

## Deployment Topology

### Local Development
```
pnpm dev             — runs Next.js (3000), API (4000), Temporal worker
docker compose up    — runs Postgres (5432), Redis (6379), Temporal (7233), Temporal UI (8080)
```

### Production (Kubernetes target — Phase 2)
```
┌─────────────────────────────────────────┐
│  Ingress (nginx / Cloudflare)           │
│  • TLS termination                      │
│  • Rate limiting                        │
└────────────┬──────────────┬─────────────┘
             │              │
     ┌───────▼──────┐  ┌────▼──────┐
     │  web pods    │  │  api pods │
     │  (Next.js)   │  │  (Hono)   │
     └──────────────┘  └────┬──────┘
                            │
                    ┌───────▼────────┐
                    │ Temporal Cloud │
                    │ (managed)      │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │  worker pods   │
                    │  (Temporal     │
                    │   activities)  │
                    └───────┬────────┘
                            │
              ┌─────────────┼───────────┐
              ▼             ▼           ▼
         ┌─────────┐  ┌─────────┐  ┌──────────┐
         │Postgres │  │  Redis  │  │  Vector  │
         │(RDS)    │  │(Elasticache)│  │  DB      │
         └─────────┘  └─────────┘  └──────────┘
```

### Environment Tiers
- **development** — local Docker Compose, hot-reload, verbose logging
- **staging** — mirrors production topology, uses test credentials
- **production** — Kubernetes, Temporal Cloud, managed Postgres, observability stack
