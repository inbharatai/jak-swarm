# JAK Swarm — System Architecture

## Table of Contents

1. [System Overview](#system-overview)
2. [Component Diagram](#component-diagram)
3. [Data Flow](#data-flow)
4. [Agent Communication Pattern](#agent-communication-pattern)
5. [Swarm Execution Model](#swarm-execution-model)
6. [Voice Pipeline](#voice-pipeline)
7. [Vibe Coder Workflow](#vibe-coder-workflow)
8. [Tool Registry](#tool-registry)
9. [Industry Pack System](#industry-pack-system)
10. [Security Model](#security-model)
11. [Observability](#observability)
12. [Deployment Topology](#deployment-topology)

---

## System Overview

JAK Swarm is an autonomous multi-agent platform designed to automate complex, multi-step business workflows across industries. The platform is built as a TypeScript monorepo.

**Current maturity: v0.1.0-beta.0 — functional for design partners, not yet ready for unqualified enterprise production promises.** The core orchestration engine, agent pipeline, tool registry, and queue system are implemented and tested. The system has not yet carried production traffic at scale.

Core principles:

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
│   │  Next.js Web App │    │  Voice Session Client (browser)    │   │
│   │  (apps/web)      │    │  Token exchange + client-side      │   │
│   │                  │    │  WebRTC via OpenAI Realtime API    │   │
│   └────────┬─────────┘    └─────────────────┬──────────────────┘   │
└────────────│──────────────────────────────── │──────────────────────┘
             │ HTTPS / REST + SSE              │ HTTPS (session + token)
             ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          API LAYER                                   │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  Fastify API Server (apps/api)  — port 4000                 │  │
│   │  • JWT + API Key authentication                             │  │
│   │  • Tenant isolation middleware                               │  │
│   │  • Rate limiting (@fastify/rate-limit)                      │  │
│   │  • Helmet CSP + CORS                                        │  │
│   │  • Routes: /workflows, /approvals, /tools, /voice,          │  │
│   │    /skills, /memory, /schedules, /integrations, /auth       │  │
│   └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────┘
                             │ In-process function calls
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATION LAYER                             │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  SwarmExecutionService + QueueWorker                        │  │
│   │  • DB-backed job queue (PostgreSQL WorkflowJob table)       │  │
│   │  • Atomic claiming (FOR UPDATE SKIP LOCKED)                 │  │
│   │  • Retry with exponential backoff → dead-letter             │  │
│   │  • Configurable concurrency (default 2 workers)             │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  LangGraphRuntime + SwarmRunner facade (packages/swarm)       │  │
│   │  • Native StateGraph: commander → planner → router →        │  │
│   │    guardrail → approval → worker → verifier → validator     │  │
│   │  • Postgres checkpoints via PostgresCheckpointSaver          │  │
│   │  • Human approvals via interrupt() + Command(resume)        │  │
│   │  • Queue worker resumes from durable workflow checkpoints    │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  Agent Engine (packages/agents)                              │  │
│   │  • BaseAgent with per-tenant provider switching              │  │
│   │  • OpenAI runtime: GPT-5.5 / GPT-5.4 tier routing            │  │
│   │  • Gemini runtime: Gemini 2.5 Pro / Flash / Flash-Lite       │  │
│   │  • Google ADK: LlmAgent, SequentialAgent, ParallelAgent     │  │
│   │  • Vertex AI Agent Engine gateway (live deployment)          │  │
│   │  • Role-aware tier selection (Tier 1–3)                     │  │
│   │  • ToolRegistry — resolves tool names to implementations    │  │
│   │  • Memory injection via <memory> tags                       │  │
│   └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
        ┌────────────────────┼───────────────────┐
        ▼                    ▼                   ▼
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  PostgreSQL  │   │      Redis       │   │   External APIs  │
│  (Supabase)  │   │  (coordination,  │   │  (OpenAI, Gemini│
│  • tenants   │   │   sessions,      │   │   Gmail, Slack,  │
│  • workflows │   │   rate limits,   │   │   MCP servers,   │
│  • job queue │   │   locks, leader  │   │   etc.)          │
│  • traces    │   │   election)      │   │                  │
│  • approvals │   │                  │   │                  │
│  • memory    │   │  Falls back to   │   │                  │
│  • audit logs│   │  in-memory shim  │   │                  │
└──────────────┘   └──────────────────┘   └──────────────────┘
```

**Note:** The QueueWorker can run embedded (default) or as a standalone process. Set `WORKFLOW_WORKER_MODE=standalone` to disable the embedded worker and run `node apps/api/dist/worker-entry.js` as a separate process for stronger isolation.

---

## Data Flow

### Workflow Creation Flow

```
1. User submits goal via POST /workflows
2. Fastify validates JWT/API Key and extracts TenantContext
3. JAK Shield scans goal for injection/PII (blocks if HIGH confidence)
4. API creates Workflow record in DB (status=PENDING)
5. API creates WorkflowJob record (status=QUEUED)
6. QueueWorker claims the job (atomic SKIP LOCKED)
7. SwarmExecutionService.executeAsync() is called
8. SwarmRunner executes the DAG:
   a. Commander agent parses intent, extracts entities
   b. Planner decomposes goal into dependency-aware task graph
   c. Guardrail validates plan (injection/PII checks)
   d. Router dispatches tasks (parallel where deps allow, max 5 concurrent)
   e. Each task: guardrail → worker agent + tool calls → verifier
   f. Worker self-correction (reflectAndCorrect) before verifier
   g. Verifier checks output (heuristic + LLM + citation density)
   h. High-risk tasks pause for ApprovalRequest creation
9. Workflow state persisted to DB after every node
10. Workflow record updated to COMPLETED/FAILED
11. SSE event pushed to client
```

### Approval Flow

```
Router detects task.requiresApproval = true
    │
    ▼
Approval Manager creates ApprovalRequest record (status=PENDING)
    │
    ▼
Workflow pauses (status=AWAITING_APPROVAL) via LangGraph interrupt()
    │
    ▼
Reviewer opens approval UI, sees proposed action + rationale
    │
    ├── APPROVED → POST /approvals/:id/decide → Command(resume) → Router resumes task
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
- **Durability** — Workflow state is persisted to PostgreSQL after every node. If the process crashes, the workflow can be resumed from the last persisted state via the recovery system.

**Cross-agent error feedback:**
- **Verifier → Worker loop**: When verification fails, `needsRetry=true` routes back to the worker (up to 3 retries)
- **Self-correction**: Workers run `reflectAndCorrect()` before the verifier — up to 2 reflection passes (strict for factual roles, lenient for creative roles)
- **Repair loop**: The `RepairService` classifies errors into 9 categories and auto-retries with backoff, or escalates to human for destructive actions
- **Replanning**: If tasks fail, the Planner re-plans with failed tasks and completed results
- **Memory persistence**: Agents call `persistLearning()` / `recallLearnings()` to store and retrieve facts across workflows

---

## Swarm Execution Model

The swarm uses a hierarchical execution model:

```
Level 0: Commander    — one per workflow, always present
Level 1: Planner      — one per workflow, runs once (re-runs on auto-repair)
Level 1: Guardrail    — invoked before plan execution and per-task
Level 1: Verifier     — one per task, validates worker output
Level 2: Router       — one per workflow, manages task lifecycle
Level 2: Approval     — zero or more per workflow, one per approval gate
Level 3: Workers      — one instance per task (up to 5 tasks run in parallel)
```

**Parallelism:**
The SwarmGraph analyzes the dependency graph via `getReadyTasks()` and dispatches all tasks with no unresolved dependencies simultaneously. Execution uses `Promise.allSettled()` with batching (max 5 concurrent tasks per batch). Each agent in a batch runs independently with its own LLM calls and tool execution.

**Durability:**
Workflow state (the full `SwarmState` object) is persisted to PostgreSQL via `PostgresCheckpointSaver` after every node completes. The QueueWorker provides job-level durability: if the process crashes, ACTIVE jobs are recovered on restart — classified as replay-safe, replay-unsafe, or requiring manual intervention.

**Per-tenant provider switching:**
Each organization can choose between OpenAI and Gemini from the Settings UI. The choice persists in `TenantMemory` and `BaseAgent.setContextOverride()` routes subsequent agent calls through the selected provider at runtime. Configured from the dashboard — no redeployment needed.

---

## Voice Pipeline

**Current status: Session management + token exchange implemented. Full voice-to-workflow pipeline requires client-side WebRTC integration.**

The voice subsystem provides:
1. **Session creation** — `POST /voice/sessions` creates a session record in Redis with TTL
2. **Token exchange** — `GET /voice/sessions/:id/token` fetches an ephemeral OpenAI Realtime API token
3. **Provider abstraction** — `VoicePipeline` class with providers for OpenAI Realtime, Deepgram (STT), ElevenLabs (TTS), and a mock provider for testing

```
Browser Microphone
        │
        │ Client-side WebRTC (OpenAI Realtime API)
        │ (browser connects directly to OpenAI using ephemeral token)
        ▼
OpenAI Realtime Model (gpt-4o-realtime-preview)
        │
        │ Transcription + VAD + response audio
        ▼
Browser Speaker
```

**What's implemented:**
- `VoicePipeline` with provider fallback (OpenAI → Deepgram → Mock)
- Session lifecycle in Redis (create, expire, status tracking)
- Ephemeral token generation for secure client-side WebRTC

**What's not yet wired:**
- Server-side audio stream processing
- Voice-to-workflow trigger (voice → Commander agent)
- Transcript persistence to database

---

## Vibe Coder Workflow

The Vibe Coder chain is NOT a `SwarmGraph` node — the debug-retry back-edge makes it cyclic, which is incompatible with the DAG executor. It runs as a plain async function (`runVibeCoderWorkflow` at `packages/swarm/src/workflows/vibe-coder-workflow.ts`) that gets queue durability by being dispatched inside the `SwarmExecutionService` processor when `workflowKind === 'vibe-coder'`.

### Chain

```
AppArchitect → AppGenerator → BuildCheck → ok? → AppDeployer
                                    |
                                    no → AppDebugger (≤3 retries) → Generator / Debugger loop
                                    |
                                    every stage-boundary → onCheckpoint(stage, files) hook
```

### Three-layer BuildCheck

| Layer | Implementation | Typical time | Catches |
|---|---|---|---|
| Heuristic | `heuristicBuildChecker` | ~1ms | Empty files, truncation, placeholder `TODO`, unbalanced braces, "Not implemented" stubs |
| Static TS | `staticBuildChecker` (TypeScript Compiler API, in-memory) | 200-800ms | Real syntax errors, local type errors, missing intra-file exports, duplicate declarations |
| Docker | `DockerBuildChecker` (disposable `node:20-slim` container) | 30-120s | Real `npm install` + `next build`. Missing deps, Next.js-specific issues, runtime/SSR violations |

---

## Tool Registry

The Tool Registry is the central catalogue of all capabilities available to worker agents.

**Implementation:** 122 classified tools registered in `packages/tools/src/builtin/index.ts`.

**Tool resolution:**
1. Worker agent requests tool by name from ToolRegistry
2. Registry looks up ToolMetadata (category, riskClass, requiresApproval)
3. Registry checks tenant's enabled tools and skill permissions
4. Tool executes with ToolExecutionContext (tenantId, workflowId, runId)
5. Result returned as `ToolResult<T>`

**Risk classification:**
Every tool is classified into 6 tiers: READ_ONLY, DRAFT_ONLY, SANDBOX_EDIT, LOCAL_EXEC_ALLOWLIST, EXTERNAL_ACTION_APPROVAL, CRITICAL_MANUAL_ONLY. The registry chokepoint returns `outcome:'approval_required'` without executing for tools above the tenant's threshold.

---

## Industry Pack System

Industry packs customise the swarm's behaviour for specific verticals. A pack is loaded at workflow start based on the tenant's `industry` setting.

13 industry packs: healthcare, education, retail, logistics, finance, insurance, recruiting, legal, hospitality, customer-support, manufacturing, consulting, general. Count is CI-enforced — `pnpm check:truth` fails if `listIndustries()` returns a different number than this paragraph claims.

**Pack application:**
1. IndustryPack selected based on `Tenant.industry` enum value
2. `agentPromptSupplement` appended to Commander and Planner system prompts
3. `policyOverlays` loaded into Guardrail's rule set
4. `recommendedApprovalThreshold` used as default if tenant hasn't overridden
5. `restrictedTools` merged with Guardrail block list

---

## Security Model

### Authentication
- **Web app users:** JWT signed by Fastify auth plugin (HS256 with `AUTH_SECRET`)
- **API consumers:** HMAC-SHA256 API keys scoped to tenant + permission set
- **Supabase Auth:** Email/password + magic link for user registration. Google OAuth is available for integration authorization (Gmail, Calendar, Drive), not user authentication.

### Authorisation
- Every API request passes through `tenantIsolationMiddleware`
- All DB queries include `WHERE tenantId = :tenantId` enforced at service layer
- Role-based access: SYSTEM_ADMIN > TENANT_ADMIN > OPERATOR > REVIEWER > END_USER
- Approval actions require REVIEWER role minimum

### Data Isolation
- PostgreSQL row-level isolation per tenant (tenantId column on every table)
- Redis keys namespaced: `jak:{tenantId}:{resource}`
- No cross-tenant joins permitted in any query

### JAK Shield (6-stage pipeline)
1. **Agent Firewall** — 22 regex patterns for prompt injection + 6 offensive-cyber categories
2. **Risk-Based Approvals** — 6-tier tool risk lattice with payload hash binding
3. **Secure Tool Permissions** — Per-tenant registry, role-gated installer, Standing Orders
4. **Sandboxed Execution** — Per-tenant browser sessions, URL allowlists, path-traversal guards
5. **Defensive Vulnerability Triage** — Allows defensive security work, blocks offensive requests
6. **Audit Evidence Layer** — HMAC-SHA256 signed bundles with per-tenant key derivation

For the full threat model, see `docs/security-threat-model.md`. The standalone JAK Shield MCP service is at https://github.com/inbharatai/jak-shield

---

## Observability

### Structured Logging
- All services use `pino` with JSON output in production
- Log levels: debug, info, warn, error
- Every log line includes: `tenantId`, `workflowId`, `traceId`, `agentRole`

### Distributed Tracing
- OpenTelemetry (`@opentelemetry/sdk-node`) with OTLP export
- `AgentTrace` records stored in `agent_traces` table
- Linked by `traceId` (correlation ID across the full workflow)
- Trace viewer in the web app shows the full execution DAG

### Metrics
- Prometheus (`prom-client`) with 35+ custom counters/histograms/gauges
- `/metrics` endpoint (bearer token gated via `METRICS_TOKEN`)
- Key metrics: LLM token counts and cost by model, workflow durations, agent executions, circuit breaker state, approval queue depth, HTTP request latency
- Both API and Worker expose `/metrics`

### Error Tracking
- Sentry (`@sentry/node`) with PII scrubbing in `beforeSend`
- Captures unhandled exceptions, LLM errors, tool execution failures

### Audit Logs
- `AuditLog` table records every user action and agent side effect
- HMAC-SHA256 signed evidence bundles with per-tenant key derivation
- Append-only pattern — immutable once written (rows are not chain-hashed; a system administrator with direct DB access could rewrite a row — this gap is documented explicitly)
- Tenant-scoped with user-agent and IP tracking

---

## Deployment Topology

### Local Development
```
pnpm dev             — runs Next.js (3000) + Fastify API (4000)
pnpm --filter @jak-swarm/api worker  — standalone queue worker (9464)
docker compose up    — runs Postgres (5432) + Redis (6379)
```

### Production (Google Cloud Run — primary, Railway — rollback)

```
            ┌──────────────────┐
            │   Vercel (Web)   │
            │   NEXT_PUBLIC_   │
            │   API_URL ──┐    │
            └─────────────┼────┘
                          │
            ┌─────────────┼──────────────────┐
            │             │                  │
            ▼             ▼                  │
 ┌──────────────────┐ ┌──────────────────┐  │
 │  Cloud Run API    │ │  Railway Worker   │  │
 │  jak-swarm-api    │ │  jak-swarm-worker │  │
 │  :4000            │ │  :9464            │  │
 │  /ready  /metrics │ │  /healthz /metrics│  │
 │  asia-south1      │ │                   │  │
 └────────┬─────────┘ └────────┬───────────┘  │
          │                    │               │
          └──────────┬────────┘               │
                     │                        │
            ┌────────▼────────┐ ┌─────────────────┘
            │  Railway Redis   │ │ Supabase PostgreSQL
            │  (public endpoint│ │ (pgvector, tenants,
            │   rediss://)    │ │  workflows, traces)
            └─────────────────┘ └─────────────────┘
                     ▲
                     │ (Agent Engine delegates to Cloud Run API)
            ┌────────┴────────┐
            │  Vertex AI      │
            │  Agent Engine   │
            │  jak-swarm-     │
            │  gateway        │
            │  asia-south1     │
            │  GOOGLE_SEARCH   │
            └─────────────────┘
```

**Why two deployments:**
- **Cloud Run** is the primary API backend (deployed, publicly reachable)
- **Railway** is the rollback/fallback path — keeps running as a hot standby
- Worker currently runs on Railway; Cloud Run Worker deployment is pending validation
- Traffic switches between Cloud Run and Railway by changing `NEXT_PUBLIC_API_URL` in Vercel

**Why two services:**
- API request latency never blocks on long-running agent chains
- Worker can be scaled independently based on queue depth
- One process can be restarted without affecting the other
- Each worker carries a stable `WORKFLOW_WORKER_INSTANCE_ID` so reclaim logs correlate with dead workers

### Google Cloud Run (primary — Google AI Agents Challenge)

```
            ┌──────────────────┐
            │   Vercel (Web)   │
            │   NEXT_PUBLIC_   │
            │   API_URL ──┐    │
            └─────────────┼────┘
                          │ (switches between Cloud Run and Railway)
            ┌─────────────┼──────────────────┐
            │             │                  │
            ▼             ▼                  │
 ┌──────────────────┐ ┌──────────────────┐  │
 │  Cloud Run API    │ │  Cloud Run Worker │  │
 │  jak-swarm-api    │ │  (not deployed)   │  │
 │  :4000            │ │  :9464            │  │
 │  2Gi RAM, 2 CPU  │ │  1Gi RAM, 1 CPU   │  │
 │  min 1 instance   │ │  min 1 instance   │  │
 └────────┬─────────┘ └────────┬───────────┘  │
          │                    │               │
          └──────────┬────────┘               │
                     │                        │
            ┌────────▼────────┐ ┌─────────────────┘
            │  Railway Redis    │ │ Supabase PostgreSQL
            │  (public endpoint)│ │ (shared)
            └─────────────────┘ └─────────────────┘
```

Cloud Run is the primary deployment. Railway is the rollback/fallback path. Cloud Run connects to Railway Redis via its **public endpoint** (not `.railway.internal` private DNS, which is unreachable from outside Railway). Traffic switches to Cloud Run by changing `NEXT_PUBLIC_API_URL` in Vercel and redeploying. Rollback is switching the URL back to Railway. See `docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md` for full setup instructions.

**Current status:**
- API deployed at `https://jak-swarm-api-565531938617.asia-south1.run.app`; Worker not yet deployed. `/ready` ✅ passing (uses `$queryRawUnsafe` for Supabase pooler compatibility; requires auth on public Cloud Run). `/health` ✅ passing (uses `$queryRawUnsafe` for Supabase pooler compatibility; requires auth on public Cloud Run). `/healthz` ✅ wired (liveness probe, always 200; requires auth on public Cloud Run).
- Agent Engine gateway deployed at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` (asia-south1). Gateway agent uses GOOGLE_SEARCH for grounding and 5 FunctionTool wrappers (create_workflow, get_workflow_status, get_workflow_traces, search_knowledge, approve_request) that call the JAK Cloud Run API at /workflows, /memory, /approvals. Deployment scripts: `scripts/deploy-agent-engine.sh`, `scripts/deploy-agent-engine.ts`, `scripts/deploy-agent-engine-python.py`. Resource file: `packages/adk/src/deploy/agent-engine-resource.ts`.

### Environment Tiers
- **development** — local `pnpm dev`, Docker Compose, hot-reload, verbose logging
- **staging-ready** — Railway deployment with test credentials (rollback/fallback)
- **production** — Google Cloud Run (primary API), Railway Worker, managed PostgreSQL (Supabase), Railway Redis (public endpoint), observability stack

---

## Roadmap Direction

JAK Swarm is evolving from a multi-agent workflow operator into a closed-loop Company OS. The architectural direction is documented in the root [`ARCHITECTURE.md`](../ARCHITECTURE.md#roadmap-company-os-evolution) and the full roadmap at [`docs/ROADMAP.md`](ROADMAP.md). The Company Operating Layer code ([`company-operating-layer.service.ts`](../../apps/api/src/services/company-brain/company-operating-layer.service.ts)) is the shipped foundation — artifacts, entities, drift findings, and agent-executable specs form the evidence graph that the Company OS layers will build on.