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

**Current maturity: v0.1.0 — staging-ready.** The core orchestration engine, agent pipeline, tool registry, and queue system are implemented and tested. The system has not yet carried production traffic at scale.

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
└────────────│──────────────────────────────── │────────────────────--┘
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
│   │  SwarmGraph + SwarmRunner (packages/swarm)                   │  │
│   │  • DAG state machine: commander → planner → router →        │  │
│   │    guardrail → worker → verifier → replanner                │  │
│   │  • Parallel task execution (Promise.allSettled, max 5)      │  │
│   │  • Dependency-aware scheduling via getReadyTasks()          │  │
│   │  • State persisted to PostgreSQL after every node           │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  Agent Engine (packages/agents)                              │  │
│   │  • BaseAgent with multi-provider LLM routing + failover     │  │
│   │  • 6 providers: OpenAI, Anthropic, Gemini, DeepSeek,        │  │
│   │    Ollama, OpenRouter                                       │  │
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
│  (Prisma)    │   │  (coordination,  │   │  (OpenAI, Gmail, │
│  • tenants   │   │   sessions,      │   │   MCP servers,   │
│  • workflows │   │   rate limits,   │   │   etc.)          │
│  • job queue │   │   locks, leader  │   │                  │
│  • traces    │   │   election)      │   │                  │
│  • approvals │   │                  │   │                  │
│  • memory    │   │  Falls back to   │   │                  │
│  • audit logs│   │  in-memory shim  │   │                  │
└──────────────┘   └──────────────────┘   └──────────────────┘
```

**Note:** The QueueWorker can run embedded (default) or as a standalone process. Set `WORKFLOW_WORKER_MODE=standalone` to disable the embedded worker and run `pnpm --filter @jak-swarm/api worker` as a separate process for stronger isolation.

---

## Data Flow

### Workflow Creation Flow

```
1. User submits goal via POST /workflows
2. Fastify validates JWT/API Key and extracts TenantContext
3. API creates Workflow record in DB (status=PENDING)
4. API creates WorkflowJob record (status=QUEUED)
5. QueueWorker claims the job (atomic SKIP LOCKED)
6. SwarmExecutionService.executeAsync() is called
7. SwarmRunner executes the DAG:
   a. Commander agent parses intent, extracts entities
   b. Planner decomposes goal into dependency-aware task graph
   c. Guardrail validates plan (injection/PII checks)
   d. Router dispatches tasks (parallel where deps allow, max 5 concurrent)
   e. Each task: guardrail → worker agent + tool calls → verifier
   f. High-risk tasks pause for ApprovalRequest creation
8. Workflow state persisted to DB after every node
9. Workflow record updated to COMPLETED/FAILED
10. SSE event pushed to client
```

### Approval Flow

```
Router detects task.requiresApproval = true
    │
    ▼
Approval Manager creates ApprovalRequest record (status=PENDING)
    │
    ▼
Workflow pauses (status=AWAITING_APPROVAL)
    │
    ▼
Reviewer opens approval UI, sees proposed action + rationale
    │
    ├── APPROVED → POST /workflows/:id/resume → Router resumes task
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
Workflow state (the full `SwarmState` object) is persisted to PostgreSQL via `DbWorkflowStateStore` after every node completes. The QueueWorker provides job-level durability: if the process crashes, ACTIVE jobs are recovered on restart — classified as replay-safe, replay-unsafe, or requiring manual intervention.

**Replay Safety:**
Each workflow's checkpoint is classified into one of four tiers:
- **REPLAY_SAFE** — read-only tasks, safe to auto-resume
- **REQUIRES_IDEMPOTENCY_KEY** — may produce side effects, needs caller-provided key
- **MANUAL_INTERVENTION_REQUIRED** — approval-gated or high-side-effect tasks
- **REPLAY_UNSAFE** — cannot be safely replayed

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

Composed so the debugger receives the earliest actionable error. Layers stop on first real failure:

| Layer | Implementation | Typical time | Catches |
|---|---|---|---|
| Heuristic | `heuristicBuildChecker` | ~1ms | Empty files, truncation, placeholder `TODO`, unbalanced braces, "Not implemented" stubs |
| Static TS | `staticBuildChecker` (TypeScript Compiler API, in-memory) | 200-800ms | Real syntax errors, local type errors, missing intra-file exports, duplicate declarations. Ignores module-not-found (npm resolution is Vercel's job). |
| Docker | `DockerBuildChecker` (disposable `node:20-slim` container) | 30-120s | Real `npm install` + `next build`. Catches missing deps, Next.js-specific issues, runtime/SSR violations. Graceful skip when Docker is absent — returns `{ok: true, skipped: true}`. |

### Auto-repair loop

- `maxDebugRetries` default 3.
- Debugger receives `errorLog` + `affectedFiles` from whichever layer failed.
- `applyFixes()` merges debugger output with existing files (replace on path match, append on new path), no mutation of the previous set.
- Fingerprint-based loop detection at the tool level prevents the debugger from retrying the identical fix.

### Durability

- Dispatch: `POST /projects/:id/run` → creates `Workflow` row → `fastify.swarm.enqueueExecution({ workflowKind: 'vibe-coder', vibeCoderInput: { projectId, ... } })`.
- Queue row in `workflow_jobs` with `FOR UPDATE SKIP LOCKED` semantics — any instance can claim and execute.
- Progress emitted via `onProgress` callback, relayed to SSE subscribers on `/workflows/:id/stream`.
- Final result (files, deployment URL, build logs, debug attempts) persisted to `Workflow.finalOutput` on completion.

### Checkpoint-Revert

Every workflow stage triggers `onCheckpoint(stage, {files, attempt, workflowId})`:

- `SwarmExecutionService` wires this to `CheckpointService.createCheckpoint()` when `projectId` is set.
- Checkpoint creation: `ProjectService.saveFiles()` persists current files → `CheckpointService` creates a `ProjectVersion` row with `snapshotJson` (full file tree) + `diffJson` (structural diff vs previous version: added / modified / deleted with size and SHA-256 hash per file).
- Stages snapshot: `generator`, `debugger` (per retry), `deployer`.
- Restore (`POST /projects/:id/checkpoints/:version/restore`) hard-deletes current `ProjectFile` rows, re-creates from the target snapshot, and creates a new `ProjectVersion` tagged as a rollback — so restores are themselves reversible.
- Cross-tenant guards on every read / write path.

API surface:
- `GET /projects/:id/checkpoints` — newest-first list with diffs embedded
- `GET /projects/:id/checkpoints/:version` — full snapshot + diff
- `POST /projects/:id/checkpoints` — manual snapshot (pre-risky-change affordance)
- `POST /projects/:id/checkpoints/:version/restore` — revert to that checkpoint

UI: `apps/web/src/components/builder/CheckpointTimeline.tsx` renders a newest-first list with stage badges (architect / generator / debugger / deployer / manual / rollback), +N ~M -K diff summary, expandable file list, and an inline-confirm restore button.

---

## Tool Registry

The Tool Registry is the central catalogue of all capabilities available to worker agents.

**Implementation:** 119 built-in tools registered in `packages/tools/src/builtin/index.ts`.

**Tool resolution:**
1. Worker agent requests tool by name from ToolRegistry
2. Registry looks up ToolMetadata (category, riskClass, requiresApproval)
3. Registry checks tenant's enabled tools and skill permissions
4. Tool executes with ToolExecutionContext (tenantId, workflowId, runId)
5. Result returned as `ToolResult<T>`

**Risk classification:**
Every tool is classified as READ_ONLY, WRITE, EXTERNAL_SIDE_EFFECT, or DESTRUCTIVE. High-risk tools trigger approval gates.

---

## Industry Pack System

Industry packs customise the swarm's behaviour for specific verticals. A pack is loaded at workflow start based on the tenant's `industry` setting.

11 industry packs: healthcare, education, retail, logistics, finance, insurance, recruiting, legal, hospitality, customer-support, general.

**Pack application:**
1. IndustryPack selected based on `Tenant.industry` enum value
2. `agentPromptSupplement` appended to Commander and Planner system prompts
3. `policyOverlays` loaded into Guardrail's rule set
4. `recommendedApprovalThreshold` used as default if tenant hasn't overridden
5. `restrictedTools` merged with Guardrail block list

---

## Security Model

### Authentication
- **Web app users:** JWT issued by Fastify auth plugin, HS256 signed
- **API consumers:** HMAC-SHA256 API keys scoped to tenant + permission set

### Authorisation
- Every API request passes through `tenantIsolationMiddleware`
- All DB queries include `WHERE tenantId = :tenantId` enforced at service layer
- Role-based access: SYSTEM_ADMIN > TENANT_ADMIN > REVIEWER > END_USER
- Approval actions require REVIEWER role minimum

### Data Isolation
- PostgreSQL row-level isolation per tenant (tenantId column on every table)
- Redis keys namespaced: `jak:{tenantId}:{resource}`
- No cross-tenant joins permitted in any query

### Guardrails
- **Injection detection** — 15+ patterns (prompt overrides, jailbreaks, system tag injection). HIGH risk blocks workflow.
- **PII detection** — 10 PII types (SSN, credit card, phone, IP, etc.) with redaction.
- **Tool risk classification** — 4 classes with 40+ tool-specific overrides.
- **Encrypted credentials** — AES-256-GCM for stored integration secrets.

For the full threat model, see `docs/security-threat-model.md`.

---

## Observability

### Structured Logging
- All services use `pino` (via Fastify) with JSON output in production
- Log levels: debug, info, warn, error
- Every log line includes: `tenantId`, `workflowId`, `traceId`, `agentRole`

### Distributed Tracing
- `AgentTrace` records stored in `agent_traces` table
- Linked by `traceId` (correlation ID across the full workflow)
- Trace viewer in the web app shows the full execution DAG

### Metrics
- Prometheus metrics exposed at `/metrics` (17 counters/histograms)
- Key metrics: LLM token counts, LLM cost by model, workflow durations
- Health check at `/health` with DB and Redis status

### Audit Logs
- `AuditLog` table records every user action and agent side effect
- Append-only pattern — immutable once written
- Tenant-scoped with user-agent and IP tracking

---

## Deployment Topology

### Local Development
```
pnpm dev             — runs Next.js (3000) + Fastify API (4000)
docker compose up    — runs Postgres (5432) + Redis (6379)
```

### Current Production (Render)
```
┌─────────────────────────────────────────┐
│  Render (render.yaml)                   │
│  • jak-swarm-api: Docker service        │
│  • Starter plan ($7/mo)                 │
│  • Oregon region                        │
└────────────┬──────────────┬─────────────┘
             │              │
     ┌───────▼──────┐  ┌────▼──────┐
     │  web         │  │  api      │
     │  (Next.js)   │  │  (Fastify)│
     │  Static/SSR  │  │  + Worker │
     └──────────────┘  └────┬──────┘
                            │
              ┌─────────────┼───────────┐
              ▼             ▼           ▼
         ┌─────────┐  ┌─────────┐  ┌──────────┐
         │Postgres │  │  Redis  │  │  MCP      │
         │(Supabase│  │(Upstash │  │  servers  │
         │ or RDS) │  │ or self)│  │  (npm)    │
         └─────────┘  └─────────┘  └──────────┘
```

The API process runs the QueueWorker embedded — no separate worker process required for single-instance deployments. For horizontal scaling, QueueWorker can be extracted to a standalone process reading from the same database.

### Environment Tiers
- **development** — local Docker Compose, hot-reload, verbose logging
- **staging** — Render deployment with test credentials
- **production** — Render or container platform, managed Postgres, Redis coordination
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

JAK Swarm is a staging-ready, production-capable autonomous multi-agent platform designed to automate complex, multi-step business workflows across industries. The platform is built as a TypeScript monorepo with the following core principles:

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
│   │  Fastify API Server (apps/api)  — port 4000                 │  │
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
                             │ In-process call → SwarmExecutionService
                             │ (Temporal is target architecture, not yet wired)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATION LAYER                             │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  SwarmExecutionService + QueueWorker (apps/api)              │  │
│   │  • WorkflowJob table is the durable queue                    │  │
│   │  • Poll-and-claim worker embedded by default                 │  │
│   │  • Standalone worker entrypoint supported (worker-entry)     │  │
│   │  • SwarmGraph runs nodes: Commander → Planner → Router →     │  │
│   │    Worker → Verifier → Approval (all in-process)             │  │
│   │  ── Target: externalise to Temporal workflow pods (see       │  │
│   │     packages/workflows/; scaffolding only, not wired)        │  │
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
4. SwarmExecutionService runs the workflow in-process (Temporal integration is infrastructure-ready but not yet wired into this path)
5. Commander agent receives goal + tenant context
6. Commander enriches with IndustryPack data
7. Planner decomposes into WorkflowPlan
8. Guardrail validates plan
9. Router dispatches tasks sequentially/in parallel
10. Each task executes via Worker agent + tool calls
11. High-risk tasks pause for ApprovalRequest creation
12. Human reviewer approves/rejects via API
13. On all tasks done, Verifier validates output
14. Commander synthesises final result
15. Workflow record updated to COMPLETED
16. SSE event pushed to client
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
- **Durability** — Workflow state is persisted to DB after every node. Temporal worker/activities exist in `packages/workflows/` for future distributed execution but are not yet wired into the API execution path.

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
The Router analyses the dependency graph and dispatches all tasks with no unresolved dependencies simultaneously, subject to `tenant.maxConcurrentWorkflows`. Parallel execution uses `Promise.all` within the SwarmExecutionService.

**Durability:**
Workflow state is persisted to PostgreSQL after every node completes. If the process crashes, the workflow can be resumed from the last persisted state. Temporal worker and activity definitions exist in `packages/workflows/` and are infrastructure-ready for distributed execution, but the API currently runs workflows in-process via SwarmExecutionService.

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
pnpm dev             — runs Next.js (3000) and API (4000)
pnpm --filter @jak-swarm/api worker  — optional standalone queue worker
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
     │  web pods    │  │  api pods   │
     │  (Next.js)   │  │  (Fastify)  │
     └──────────────┘  └────┬────────┘
                            │
                    ┌───────▼──────────────┐
                    │  Temporal (target)   │
                    │  — not yet wired in  │
                    └───────┬──────────────┘
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
