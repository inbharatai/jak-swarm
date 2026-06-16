# JAK Swarm -- System Architecture

This document describes the internal architecture of JAK Swarm: how a user goal becomes a planned, routed, executed, verified result.

For deployment topology (Google Cloud Run primary, Railway fallback, infrastructure diagrams), see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). For the deployment runbook, see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## High-Level Flow

```
User Input (natural language goal)
      |
      v
  ┌─────────────┐
  │  Commander   │  Interprets intent, extracts entities, sets mission context
  └──────┬──────┘
         v
  ┌─────────────┐
  │  Guardrail   │  Pre-flight risk check. Can block or flag the mission.
  └──────┬──────┘
         v
  ┌─────────────┐
  │   Planner    │  Decomposes goal into a dependency-aware task graph (DAG).
  └──────┬──────┘  Each task has: agent role, tools needed, risk level, deps.
         v
  ┌─────────────┐
  │   Router     │  Assigns specific agents and LLM tiers to each task.
  └──────┬──────┘  Identifies tasks that can run in parallel (no deps).
         v
  ┌─────────────────────────────────────────────────────────────┐
  │  Task Scheduler                                              │
  │  Resolves the DAG: runs ready tasks in parallel, respects    │
  │  dependency ordering, handles skip/fail propagation.         │
  └──────────────────────────┬──────────────────────────────────┘
                             v
  ┌──────────────────────────────────────────────────────────────┐
  │  Worker Execution                                             │
  │                                                               │
  │  For each task:                                               │
  │    1. Approval gate (if task.requiresApproval)                │
  │    2. Worker agent receives task + context                    │
  │    3. Agent enters tool loop:                                 │
  │       - LLM decides which tool to call                        │
  │       - ToolRegistry executes tool with validated input       │
  │       - Result fed back to LLM                                │
  │       - Repeat until agent produces final output              │
  │    4. Output stored in SwarmState                             │
  └──────────────────────────┬──────────────────────────────────┘
                             v
  ┌─────────────┐
  │  Verifier    │  Checks each task output for correctness,
  └──────┬──────┘  completeness, and grounding.
         │
         ├── PASS ──> next task or final result
         │
         └── FAIL ──> Replanner rewrites failed tasks,
                      Router re-assigns, execution retries
                      (configurable max retries)
```

---

## Package Responsibilities

### `packages/swarm` -- Orchestration Engine

The core execution engine. Contains:

- **LangGraph StateGraph** (`packages/swarm/src/graph/`): Native `@langchain/langgraph` orchestration with node handlers for Commander, Planner, Router, Worker, Verifier, Guardrail, Approval, and Replanner. Checkpoints persist to Postgres via `PostgresCheckpointSaver`; approval pauses use native `interrupt()` + `Command(resume=…)`. The previous custom SwarmGraph state machine was deleted in Sprint 2.5.

- **Task Scheduler** (`graph/task-scheduler.ts`): Given the current plan and task statuses, resolves which tasks are ready to execute (all dependencies complete) and which should be skipped (dependency failed).

- **SwarmState** (`state/swarm-state.ts`): Immutable state object threaded through the graph. Contains the mission, plan, task results, traces, and control flags.

- **SwarmRunner** (`runner/swarm-runner.ts`): High-level API. Takes a goal string, creates initial state, and drives the graph to completion. Emits events for real-time UI updates.

### `packages/agents` -- Agent Implementations

38 agents organized by role:

- **Base Layer** (`base/`):
  - `BaseAgent`: Abstract class with `run()` method implementing the tool loop pattern.
  - `GeminiRuntime`: Primary LLM execution path for the Google AI Agents Challenge. Bridges Google's Generative AI SDK (Gemini 2.5 Pro/Flash/Flash-Lite) to JAK's agent-first architecture via `geminiResponseToChatCompletion()`. Supports parallel function calling, `responseSchema` structured output, controllable thinking, and Google Search Grounding. Per-tenant provider switching from Settings UI stored in `TenantMemory` → `BaseAgent.setContextOverride()`.
  - `OpenAIRuntime`: Alternate LLM execution path. Uses OpenAI Responses API with `json_schema` strict mode for structured output and prompt-cache-aware cost telemetry. Available for tenants that prefer OpenAI models.
  - `ModelRouter`: Tier-based routing. When Gemini is selected: Tier 3 → Gemini 2.5 Pro, Tier 2 → Gemini 2.5 Flash, Tier 1 → Gemini 2.5 Flash-Lite. When OpenAI is selected: Tier 3 → GPT-5.5, Tier 1/2 → GPT-5.4.
  - `AntiHallucination`: Four detection layers run on every agent output before it's accepted.
  - `TokenOptimizer`: Estimates token counts, compresses context when approaching limits, selects optimal model based on input size.

- **Orchestrator Agents** (`roles/`): Commander, Planner, Router, Verifier, Guardrail, Approval. Each extends BaseAgent with role-specific system prompts and output schemas.

- **Worker Agents** (`workers/`): 32 domain specialists. Each declares which tools it needs and has a specialized system prompt for its domain.

### `packages/adk` -- Google ADK Integration + Agent Engine Gateway

When `JAK_ADK_MODE=1`, workflows route through Google's Agent Development Kit (`@google/adk`) instead of LangGraph:

- **jak-tool-bridge.ts**: Converts JAK tools to ADK `FunctionTool` format
- **jak-adk-agents.ts**: Wraps JAK agents as ADK `LlmAgent` instances
- **adk-pipeline.ts**: Orchestrates agents via `SequentialAgent` (Commander → Planner → ParallelAgent(workers) → SynthesisAgent → VerifierAgent)
- **adk-runner.ts**: Bridges ADK output back to JAK's SwarmState shape
- **deploy/agent-engine-entry.ts**: Agent Engine gateway entry point — creates a gateway agent that uses GOOGLE_SEARCH for grounding and delegates workflow execution to JAK's Cloud Run API
- **deploy/agent.ts**: ADK deploy shim (`root_agent` export required by `npx @google/adk deploy agent_engine`)
- **deploy/agent-engine-resource.ts**: Auto-generated file with live resource ID `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728`

When ADK is not enabled, the existing LangGraph path runs unchanged. ADK is an additive layer — the Gemini + ADK orchestration pipeline runs alongside the existing LangGraph pipeline without modifying it.

The Agent Engine gateway is deployed live on Vertex AI. Cloud Run remains the primary verified deployment; Agent Engine is an additional gateway path that routes through the same Cloud Run API backend.

### `packages/tools` -- Tool System

122 tools (built-in + sandbox + MCP) managed by a singleton ToolRegistry:

- **ToolRegistry** (`registry/tool-registry.ts`): Singleton. Tools register with metadata (name, description, category, risk class, input/output schemas) and an executor function. Supports input validation and execution timing.

- **Adapters** (`adapters/`): Pluggable backends behind interfaces.
  - `EmailAdapter`: Interface with `GmailImapAdapter` (real IMAP/SMTP). Throws if not configured.
  - `CalendarAdapter`: Interface with `CalDAVCalendarAdapter` (real CalDAV). Throws if not configured.
  - `CRMAdapter`: Interface with `PrismaCRMAdapter` (database-backed, tenant-scoped) and `UnconfiguredCRMAdapter` fallback.
  - `BrowserAdapter`: Playwright-based. Singleton engine manages browser lifecycle.
  - `MemoryAdapter`: In-memory or database-backed key-value store.
  - `PhoringAdapter`: HTTP client for Phoring.ai forecasting and knowledge graph APIs.

- **Adapter Factory** (`adapters/adapter-factory.ts`): Detects environment variables and returns real adapters or unconfigured stubs that throw on use. No fake data is ever returned.

- **MCP Bridge** (`mcp/`):
  - `McpClientManager`: Manages MCP server processes (spawn, connect, disconnect). Each provider gets its own stdio-based MCP server.
  - `McpToolBridge`: Converts between JAK Swarm `ToolMetadata` and MCP tool specs. Agents can call Slack, GitHub, and Notion tools through the same ToolRegistry interface.
  - `MCP_PROVIDERS`: Configuration for each supported MCP provider (command, args, env, credential fields, setup instructions).

### `packages/shared` -- Shared Types

TypeScript enums and interfaces used across all packages:

- `AgentRole` (38 agent roles), `AgentStatus`, `AgentHandoff`, `ToolCall`, `AgentTrace`
- `ToolCategory` (11 categories), `ToolRiskLevel` (6 tiers: `READ_ONLY`, `DRAFT_ONLY`, `SANDBOX_EDIT`, `LOCAL_EXEC_ALLOWLIST`, `EXTERNAL_ACTION_APPROVAL`, `CRITICAL_MANUAL_ONLY`), `ToolMetadata`, `ToolResult`
- `WorkflowStatus`, `TaskStatus`, `RiskLevel`, `WorkflowTask`, `WorkflowPlan`, `ApprovalRequest`

### `packages/db` -- Database

Prisma ORM with PostgreSQL. Schema covers tenants, users, workflows, tasks, traces, integrations, credentials, schedules, memory, skills, and the Audit & Compliance product surface (`ComplianceFramework`, `ComplianceControl`, `ControlEvidenceMapping`, `ManualEvidence`, `ScheduledAttestation`, `ControlAttestation`, `WorkflowArtifact`, `AuditRun`, `ControlTest`, `AuditException`, `AuditWorkpaper`).

### `packages/security` -- Local Policy Logic (JAK Swarm) + JAK Shield MCP Gateway

JAK Swarm has **two security layers**:

**1. Local policy logic** (`packages/security`): Guardrails, RBAC, injection detection, PII redaction, tool risk classification, audit logging, and the Agent Governance Overlay that enforces agent profiles, memory scopes, autonomy boundaries, and role boundaries. This code runs inside JAK Swarm. It is **not** JAK Shield — it is local policy enforcement.

- **Agent Firewall**: 22 regex patterns for prompt injection + 6 offensive-cyber categories
- **Risk-Based Approvals**: 6-tier `ToolRiskLevel` lattice with payload hash binding
- **Secure Tool Permissions**: Per-tenant registry, role-gated installer, Standing Orders (tool whitelists propagated through SwarmState)
- **Sandboxed Execution**: Per-tenant browser sessions, URL allowlists, path-traversal guards, 500MB disk quotas
- **Defensive Vulnerability Triage**: Allows defensive security work, blocks offensive requests
- **Audit Evidence Layer**: HMAC-SHA256 signed bundles with per-tenant key derivation

**2. JAK Shield MCP** ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)): A **separate MCP-native security gateway** with a 10-stage decision pipeline (hard rules, injection v2, taint tracker, attack-chain detection, PII v2, anomaly detection, RBAC + threshold, OpenAI classifier advisory, HMAC signing, output routing). JAK Swarm calls JAK Shield MCP for signed security decisions on high-risk actions. Decision outcomes: `allow`, `redact`, `requires_approval`, `block`, `rewrite`. If JAK Shield MCP is unavailable, all high-risk actions require approval (local policy still runs).

For the local threat model, see [`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md). For the full evolution plan including Agent Governance Overlay and JAK Shield MCP integration, see [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md).

### `packages/verification` -- Output Verification

Email/document/transaction verification tools and the Verifier agent's structured evaluation pipeline.

### `packages/skills` -- Skill System

Operators can propose new Tier 3 skills that go through a sandbox-and-review pipeline before activation. Skills define tool allowlists (`ToolRiskLevel` per tool) and agent prompts per vertical.

### `packages/industry-packs` -- Industry Configuration

13 industry-specific agent configurations (healthcare, education, retail, logistics, finance, insurance, recruiting, legal, hospitality, customer-support, manufacturing, consulting, general). Each pack provides agent prompt supplements, policy overlays, recommended approval thresholds, and restricted tool lists.

### `packages/client` -- TypeScript SDK

`@jak-swarm/client` — auto-generated TypeScript client for the API. Used by `apps/web` and available for external integrations.

### `apps/api/src/services/audit` -- Audit & Compliance Agent Pack

Five tenant-scoped services that drive a full audit engagement end-to-end:

- **`AuditRunService`** -- Engagement lifecycle (`PLANNING → PLANNED → MAPPING → TESTING → REVIEWING → READY_TO_PACK → FINAL_PACK → COMPLETED`) with `assertAuditTransition()` refusing illegal jumps. Emits 13 audit-specific lifecycle events with `agentRole` attribution.
- **`ControlTestService`** -- Builds test procedures + evaluates evidence via the configured LLM runtime's `respondStructured` with strict zod schema. Falls back to a deterministic coverage rule (with explicit "no LLM key" rationale) when the API key is unset.
- **`AuditExceptionService`** -- Auto-creates exceptions on test fail/exception. Independent state machine for the remediation lifecycle (`open → remediation_planned → … → closed`).
- **`WorkpaperService`** -- Renders per-control PDFs via existing `exportPdf` (pdfkit) and persists as `WorkflowArtifact` with `approvalState='REQUIRES_APPROVAL'`. Lazy-creates one backing `Workflow` row per `AuditRun`.
- **`FinalAuditPackService`** -- Hard gate: `FinalPackGateError` if any workpaper is unapproved. Bundles workpapers + control matrix CSV + exceptions JSON + executive summary PDF + HMAC-SHA256 signature via existing `bundle-signing.service`.

Routes: `apps/api/src/routes/audit-runs.routes.ts` (14 endpoints, REVIEWER+ on writes). UI: `apps/web/src/app/(dashboard)/audit/runs/`. End-to-end test: `tests/integration/audit-run-e2e.test.ts` (11 assertions, all green).

### `packages/workflows` -- Temporal Integration (Optional)

Optional Temporal workflow and activity definitions for durable, long-running workflows (batch processing, scheduled reports, multi-day approval escalations). The primary workflow engine is LangGraph + QueueWorker in `packages/swarm` and `apps/api`. Temporal is only needed for jobs that must survive full process restarts.

### `packages/voice` -- Voice Pipeline

Real-time voice interaction using OpenAI Realtime API via WebRTC. Session creation, ephemeral token exchange, and provider abstraction (OpenAI Realtime, Deepgram STT, ElevenLabs TTS, mock provider for testing).

### `packages/whatsapp-client` -- WhatsApp Bridge

WhatsApp Cloud API integration for workflow control via chat. QR verification for session establishment.

---

## LLM Provider Routing

JAK Swarm supports two first-class LLM providers with per-tenant switching. Gemini is the primary provider for the Google AI Agents Challenge; OpenAI is an alternate supported path.

### Gemini Path (primary for Google competition)

```
                        ModelRouter
                             |
              ┌──────────────┼──────────────┐
              v              v              v
          Tier 1         Tier 2         Tier 3
       (cost opt)      (balanced)     (premium)
              |              |              |
              v              v              v
      Flash-Lite         Flash           Pro
       simple         code/arch      commander/
       workers         itect         planner/verifier
```

### OpenAI Path (alternate provider)

```
                        ModelRouter
                             |
              ┌──────────────┼──────────────┐
              v              v              v
          Tier 1         Tier 2         Tier 3
       (cost opt)      (balanced)     (premium)
              |              |              |
              v              v              v
          GPT-5.4       GPT-5.4        GPT-5.5
       lower-cost      standard          +
       routing        worker          vision
```

Per-tenant provider preference is stored in `TenantMemory` (key: `llm:preferred_provider`) and flows through the entire execution pipeline: `SwarmExecutionService` → `SwarmRunner` → `SwarmState` → `AgentContext.llmProvider` → `BaseAgent.setContextOverride()`. Tenant API keys are AES-256-GCM encrypted at rest.

### Gemini Grounding (primary search)

When `GEMINI_GOOGLE_SEARCH_GROUNDING=1`, Gemini agents inject `{ googleSearch: {} }` into the API tools array. Responses include `groundingMetadata` with web search queries, source URLs, and confidence scores. When ADK is enabled, the built-in `GOOGLE_SEARCH` tool provides free, citation-backed search.

### OpenAI Web Search (alternate provider)

For OpenAI, `web_search_preview` provides equivalent real-time search — no Serper or Tavily keys needed.

### Tier Assignments

| Tier | Gemini Model | OpenAI Model | Assigned to |
|:----:|:------------:|:------------:|:-----------|
| Tier 1 | Gemini 2.5 Flash-Lite | GPT-5.4 (lower-cost) | Parallel workers, email, calendar, CRM |
| Tier 2 | Gemini 2.5 Flash | GPT-5.4 (standard) | Code generator, designer, architect |
| Tier 3 | Gemini 2.5 Pro | GPT-5.5 | Commander, Planner, Verifier, vision tasks |

Key files:
- [`packages/agents/src/runtime/gemini-runtime.ts`](packages/agents/src/runtime/gemini-runtime.ts) — Gemini SDK adapter
- [`packages/agents/src/runtime/gemini-response-parser.ts`](packages/agents/src/runtime/gemini-response-parser.ts) — Response conversion
- [`packages/agents/src/runtime/gemini-message-adapter.ts`](packages/agents/src/runtime/gemini-message-adapter.ts) — Message shape conversion
- [`apps/api/src/routes/llm-settings.routes.ts`](apps/api/src/routes/llm-settings.routes.ts) — Provider toggle + key management API

---

## Tool Execution Flow

```
Agent decides to call a tool
        |
        v
  ToolRegistry.execute(name, input, context)
        |
        ├── 1. Look up tool by name
        ├── 2. Validate input against JSON schema
        ├── 3. Execute tool function
        ├── 4. Measure duration
        └── 5. Return ToolResult { success, data?, error?, durationMs }
                |
                v
        Result fed back to LLM for next decision
```

Risk levels determine approval requirements (6-tier `ToolRiskLevel` lattice):

| Level | Approval | Examples |
|:-----:|:--------:|:--------|
| `READ_ONLY` | Never | web_search, file_read, list_calendar |
| `DRAFT_ONLY` | Never | draft_email, create_calendar_event (uncommitted) |
| `SANDBOX_EDIT` | Configurable | Browser operations within sandbox |
| `LOCAL_EXEC_ALLOWLIST` | Configurable | Code execution, file write (allowlisted tools) |
| `EXTERNAL_ACTION_APPROVAL` | Always | send_email, send_webhook, post_slack |
| `CRITICAL_MANUAL_ONLY` | Always | delete records, credential rotation, production deploys |

---

## Hallucination Detection Pipeline

Every agent output passes through four heuristic checks before acceptance. These are **regex/rule-based detectors**, not AI-powered:

1. **Invented Statistics**: Regex detection of specific percentages, dollar amounts, and large numbers that appear without source attribution.

2. **Fabricated Sources**: Pattern matching for academic-style citations (Author et al., year), URL references, and paper titles that the agent may have invented.

3. **Overconfidence**: Flags absolute statements ("always", "never", "guaranteed") and certainty claims without evidence.

4. **Impossible Claims**: Rule-based detection of logically inconsistent or physically impossible assertions.

Each check contributes to a grounding score (0.0 to 1.0). If the combined score falls below threshold, the Verifier flags the output for re-generation or human review.

---

## Agent Error Feedback & Learning

### Cross-agent error propagation

- **Verifier → Worker loop**: When verification fails, `needsRetry=true` routes back to the worker (up to 3 retries)
- **Self-correction**: Workers run `reflectAndCorrect()` before the verifier — up to 2 reflection passes (strict for factual roles, lenient for creative roles)
- **Repair loop**: The `RepairService` classifies errors into 9 categories and auto-retries with backoff, or escalates to human for destructive actions
- **Replanning**: If tasks fail, the Planner re-plans with failed tasks and completed results

### Agent memory persistence

- **persistLearning / recallLearnings**: Agents store and retrieve facts across workflows via per-role memory keyed by tenant
- **Post-workflow fact extraction**: `memory-extractor.ts` extracts up to 10 facts per completed workflow
- **Standing Orders**: Per-tenant tool whitelists and blocked-actions lists propagated through SwarmState

---

## State Machine

```
PENDING
   |
   v
PLANNING ──> ROUTING ──> EXECUTING ──> VERIFYING ──> COMPLETED
   |                         |              |
   v                         v              v
FAILED                AWAITING_APPROVAL   FAILED
                             |              |
                             v              v
                        (approved)     (re-plan)
                             |              |
                             v              v
                        EXECUTING      PLANNING
```

`CANCELLED` can be reached from any state via user action.

---

## Data Model (Key Entities)

```
Tenant
  ├── Users
  ├── Workflows
  │     ├── WorkflowPlan (task DAG)
  │     ├── Tasks (individual work items)
  │     ├── ApprovalRequests
  │     └── AgentTraces (full execution logs)
  ├── Integrations (MCP provider connections)
  │     └── Credentials (encrypted)
  ├── Schedules (cron definitions)
  ├── Memory (key-value knowledge store)
  └── Skills (reusable workflow templates)
```

---

## API Layer

Fastify server with route modules for workflows, approvals, audit, compliance, integrations, schedules, memory, tools, traces, voice, slack, and more. Key patterns:

- **Multi-tenant**: Every request is scoped to a tenant via auth middleware.
- **Streaming**: Workflow execution events are streamed to the frontend via SSE for real-time DAG updates.
- **Approval API**: Frontend polls for pending approvals. User approves/rejects, execution resumes.

---

## Frontend Architecture

Next.js 16 with App Router. The dashboard uses a shared layout with sidebar navigation across 13 pages.

Key UI components:
- **DAG Viewer** (React Flow): Renders the workflow plan as an interactive node graph. Nodes change color based on task status (pending/running/completed/failed).
- **Trace Explorer**: Drill into any agent execution to see LLM prompts, tool calls, token counts, costs, and timing.
- **Integration Manager**: Connect/disconnect MCP providers with credential forms and connection testing.

---

## Error Handling Strategy

### Per-Layer Recovery

| Layer | Error Type | Recovery |
|-------|-----------|----------|
| Tool | Tool execution fails | Agent receives error message, adapts approach and tries alternative tool or strategy |
| Agent | LLM call fails (rate limit, network) | Exponential backoff retry (3 attempts) via ProviderRouter |
| Node | Node execution hangs | 120s timeout (`NODE_TIMEOUT_MS`), node skipped, dependent tasks cancelled |
| Task | Task verification fails | Worker re-executes with Verifier feedback (up to 3 retries, `needsRetry=true`) |
| Task | Worker self-correction | `reflectAndCorrect()` runs before verifier (2 passes max, strict for factual roles) |
| Workflow | Multiple tasks fail | Auto-repair: Replanner rewrites failed task subgraph, Router re-assigns (`MAX_REPAIR_LOOPS=4`) |
| System | Server crash mid-workflow | State persisted to PostgreSQL after every node; stale workflows detected and marked FAILED on restart via `recoverStaleWorkflows` |
| Approval | Approval timeout | Request expires to EXPIRED status; workflow remains PAUSED until manual intervention |

### Error Propagation in the DAG

When a task fails, the Task Scheduler determines the impact:

1. **Independent tasks** continue executing -- failure does not cascade to unrelated branches
2. **Dependent tasks** are marked SKIPPED -- they cannot proceed without their dependency's output
3. **The Verifier** inspects all failed tasks and decides whether auto-repair is viable
4. **Auto-repair** (if enabled) triggers the Replanner to generate alternative task definitions that avoid the failed approach

### Graceful Degradation

- If a preferred LLM provider is unavailable, the ProviderRouter falls back to the next available provider in the tier
- If real adapters (Gmail, CalDAV) fail, the system logs the error but does not fall back to mock adapters at runtime
- If an MCP server process crashes, `McpClientManager` detects the disconnection and reports it via the integration status API
- If Redis is unavailable, voice sessions cannot be created but all other functionality continues (schedules fall back to polling)

---

## Current Deployment Reality

As of 2026-06-15, JAK Swarm has two verified deployment paths:

**Primary — Cloud Run API:**
- Service: `jak-swarm-api`
- Region: `asia-south1`
- URL: `https://jak-swarm-api-565531938617.asia-south1.run.app`
- `/ready`: ✅ passing (uses `$queryRawUnsafe` for Supabase pooler compatibility; requires auth on public Cloud Run)
- `/health`: ✅ passing (uses `$queryRawUnsafe` for Supabase pooler compatibility; requires auth on public Cloud Run)
- `/healthz`: ✅ wired (liveness probe, always 200; requires auth on public Cloud Run)

**Additional — Vertex AI Agent Engine Gateway:**
- Resource ID: `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728`
- Display name: `jak-swarm-gateway`
- Region: `asia-south1`
- Model: gemini-2.5-flash with GOOGLE_SEARCH grounding
- Gateway pattern: Agent Engine → JAK Cloud Run API → JAK workflows
- Deployment scripts: `scripts/deploy-agent-engine.sh`, `scripts/deploy-agent-engine.ts`, `scripts/deploy-agent-engine-python.py`
- Resource file: `packages/adk/src/deploy/agent-engine-resource.ts`

Railway remains the rollback/fallback path. Cloud Run Worker and Vercel API cutover are pending.

---

## Deployment

JAK Swarm runs as two services: an API server (Fastify, port 4000) and a queue worker (`worker-entry.js`, port 9464). Both share the same codebase; the `WORKFLOW_WORKER_MODE` env var selects the role.

- **Google Cloud Run (current primary API)**: `jak-swarm-api` is deployed in `asia-south1` and publicly reachable. It runs the Fastify API / agent gateway.
- **Vertex AI Agent Engine (additional gateway)**: A live Agent Engine resource (`projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728`) deployed via `vertexai.agent_engines.create()`. The gateway agent uses GOOGLE_SEARCH for grounding and 5 FunctionTool wrappers (create_workflow, get_workflow_status, get_workflow_traces, search_knowledge, approve_request) that call the JAK Cloud Run API at /workflows, /memory, /approvals. This is an additional entry point — it does not replace the Cloud Run API.
- **Railway (rollback/fallback)**: Railway API + Worker remain available as the fallback path until Cloud Run Worker and Vercel cutover are fully validated.
- **Cloud Run Worker (pending)**: A standalone Cloud Run worker is not yet deployed. Do not claim Cloud Run Worker is live.
- **Vercel Frontend**: Still points to Railway until `NEXT_PUBLIC_API_URL` is intentionally switched after worker validation.
- **Local development**: `pnpm dev` runs both API and web; `pnpm --filter @jak-swarm/api worker` runs the standalone worker

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full deployment guide and [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md) for Cloud Run setup.

---

## Scaling Considerations

### Current Architecture Constraints

| Resource | Limit | Notes |
|----------|-------|-------|
| Concurrent workflows per runner | 20 | Configurable in SwarmRunner constructor |
| Concurrent tasks per workflow | 5 | Batched parallel execution via Task Scheduler |
| In-memory state store TTL | 5 minutes | Workflow state evicted from memory after completion + TTL |
| EventEmitter listeners | Cleaned per-workflow | Listeners removed after each workflow completes to prevent leaks |
| SSE connections | 1 per workflow per client | Heartbeat every 15s, cleanup on disconnect |

### Horizontal Scaling Path

The architecture supports two running modes:

1. **Mode A (embedded)**: `WORKFLOW_WORKER_MODE=embedded`. Single process does HTTP + queue. For local dev and staging only.
2. **Mode B (two-service)**: `WORKFLOW_WORKER_MODE=standalone` on API + separate worker process. Production default. API p95 latency stays flat regardless of queue depth. Worker scales independently.

Production target is Mode B, with API and worker as separate services. Currently Railway still runs the worker path, while Cloud Run has the API live. Cloud Run Worker deployment remains pending and must not be claimed as completed.

### Memory Management

- `SwarmState` is immutable -- each node produces a new state object rather than mutating shared state
- Tool results and agent traces are streamed to the database incrementally, not accumulated in memory
- Browser adapter (Playwright) uses a singleton engine pattern to avoid spawning multiple browser processes
- MCP server processes are spawned per-provider (not per-request) and reused across workflows

---

## Security Architecture

### Authentication Flow

```
Client                    API (Fastify)                 Database
  |                           |                            |
  |-- POST /auth/login ------>|                            |
  |                           |-- Verify password (bcrypt)->|
  |                           |<-- User + Tenant -----------|
  |                           |                            |
  |                           |-- Sign JWT (AUTH_SECRET) --|
  |<-- 200 { token } --------|                            |
  |                           |                            |
  |-- GET /workflows -------->|                            |
  |   Authorization: Bearer   |-- Verify JWT --------------|
  |                           |-- enforceTenantIsolation --|
  |                           |-- Check RBAC role ---------|
  |<-- 200 { data } ---------|                            |
```

### Encryption at Rest

LLM API keys stored via the dashboard are encrypted using AES-256-GCM:

1. Key derivation: `scryptSync(AUTH_SECRET, 'jak-swarm-llm-keys', 32)` produces a 256-bit key
2. Each value is encrypted with a random 12-byte IV
3. Storage format: `base64(iv):base64(authTag):base64(ciphertext)`
4. Decryption requires the same `AUTH_SECRET` -- rotating the secret invalidates all stored keys

### Tenant Isolation

Every database query is scoped by `tenantId`. The `enforceTenantIsolation` middleware verifies that the `tenantId` in the JWT matches the resource being accessed. Cross-tenant access is only permitted for `SYSTEM_ADMIN` role.

### JAK Shield (6-Stage In-Process Pipeline)

Six-stage defense pipeline that runs inside the JAK Swarm process before any agent action touches code, browser, files, or business tools. (The standalone JAK Shield MCP service at https://github.com/inbharatai/jak-shield has a broader architecture; within JAK Swarm, the 6-stage pipeline is the in-process implementation.)

1. **Agent Firewall** -- 22 regex patterns for prompt injection + 6 offensive-cyber categories
2. **Risk-Based Approvals** -- 6-tier tool risk lattice with payload hash binding
3. **Secure Tool Permissions** -- Per-tenant registry, role-gated installer, Standing Orders
4. **Sandboxed Execution** -- Per-tenant browser sessions, URL allowlists, path-traversal guards
5. **Defensive Vulnerability Triage** -- Allows defensive security work, blocks offensive requests
6. **Audit Evidence Layer** -- HMAC-SHA256 signed bundles with per-tenant key derivation

For the full threat model, see [`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md).

---

## Roadmap: Company OS Evolution

JAK Swarm is a beta closed-loop operating layer today. The architectural direction is toward an ever-learning Company OS. This section describes the evolution path and what exists in code today versus what is planned.

### Current foundation (shipped)

- **Company Operating Layer** ([`company-operating-layer.service.ts`](apps/api/src/services/company-brain/company-operating-layer.service.ts)): artifact ingestion, entity extraction, drift detection, and agent-executable spec generation. The evidence graph is tenant-scoped and citation-first.
- **Company Brain** ([`company-profile.service.ts`](apps/api/src/services/company-brain/company-profile.service.ts)): LLM-extracted company profiles (industry, brand voice, competitors, goals) approved by the user, grounding every agent prompt.
- **Local policy logic** (`packages/security`): Agent Firewall, Risk-Based Approvals, Secure Tool Permissions, Sandboxed Execution, Defensive Vulnerability Triage, Audit Evidence Layer. These are local guardrails inside JAK Swarm — **not** JAK Shield itself.
- **JAK Shield MCP** ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)): A separate 10-stage MCP-native security gateway that JAK Swarm calls for signed security decisions on high-risk actions.
- **Role-based agents**: 38 specialist agents across Executive, Operations, Core, and Vibe Coding layers, each with domain-scoped prompts and tool allowlists.
- **Industry Packs**: 13 vertical configurations with agent prompt supplements, policy overlays, and restricted tool lists.

### Evolving toward (roadmap, not shipped)

| Layer | Direction | Current code status |
|:------|:----------|:-------------------|
| **Company Inputs** | Calls, meetings, docs, websites, emails, code, tasks, CRM, support flowing automatically into the evidence graph | Manual ingestion + 7 artifact sources. Full auto-sync is a product build item. |
| **Company Memory** | Transcripts, decisions, policies, people, projects, risks, evidence as persistent, queryable context | `company-operating-layer.service.ts` implements artifact → entity → drift finding → spec pipeline. Cross-workflow recall via `persistLearning` / `recallLearnings`. Memory is session-scoped; cross-session grounding is evolving. |
| **Role-Based Intelligence** | CEO, HR, CTO, CMO, Finance, Legal, Ops, Support agents with department-scoped context, Ability Packs, Autonomy Ladder (L0–L5), and approval gates | Agent roles exist. Department-scoped RBAC (5 roles) is tenant-scoped, not department-scoped. Ability Packs and Autonomy Ladder are roadmap items. |
| **Permission + Governance** | Agent Governance Overlay enforcing agent profiles, memory scopes, and autonomy boundaries; JAK Shield MCP for signed security decisions on high-risk actions | Local policy logic in `packages/security` is shipped. JAK Shield MCP is a separate gateway. Agent Governance Overlay, Ability Packs, and Agent Profile Registry are roadmap items. |
| **Autonomous Execution** | Plan, assign, execute, verify, report, learn again in a self-improving closed loop | Commander → Planner → Router → Worker → Verifier loop is shipped. Self-improving cycles and cross-workflow learning are evolving. |

Full roadmap with milestones and honest scope: [`docs/ROADMAP.md`](docs/ROADMAP.md). Full architecture plan including JAK Shield MCP integration and Agent Governance Overlay: [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md).