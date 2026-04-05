# JAK Swarm -- System Architecture

This document describes the internal architecture of JAK Swarm: how a user goal becomes a planned, routed, executed, verified result.

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

- **SwarmGraph** (`graph/swarm-graph.ts`): Builds a directed acyclic graph of node handlers. Each node (Commander, Planner, Router, Worker, Verifier, Guardrail, Approval, Replanner) is a function that receives SwarmState and returns updated state + next node name.

- **Task Scheduler** (`graph/task-scheduler.ts`): Given the current plan and task statuses, resolves which tasks are ready to execute (all dependencies complete) and which should be skipped (dependency failed).

- **SwarmState** (`state/swarm-state.ts`): Immutable state object threaded through the graph. Contains the mission, plan, task results, traces, and control flags.

- **SwarmRunner** (`runner/swarm-runner.ts`): High-level API. Takes a goal string, creates initial state, and drives the graph to completion. Emits events for real-time UI updates.

### `packages/agents` -- Agent Implementations

33 agents organized by role:

- **Base Layer** (`base/`):
  - `BaseAgent`: Abstract class with `run()` method implementing the tool loop pattern.
  - `LLMProvider` interface: Unified API across providers. Each provider (OpenAI, Anthropic, Gemini, DeepSeek, Ollama, OpenRouter) implements `chatCompletion()` with tool calling support.
  - `ProviderRouter`: Tier-based routing. Selects the cheapest available provider for a given tier. Tiers are assigned per agent role (Commander=Tier3, workers=Tier1).
  - `AntiHallucination`: Four detection layers run on every agent output before it's accepted.
  - `TokenOptimizer`: Estimates token counts, compresses context when approaching limits, selects optimal model based on input size.

- **Orchestrator Agents** (`roles/`): Commander, Planner, Router, Verifier, Guardrail, Approval. Each extends BaseAgent with role-specific system prompts and output schemas.

- **Worker Agents** (`workers/`): 27 domain specialists. Each declares which tools it needs and has a specialized system prompt for its domain.

### `packages/tools` -- Tool System

65 built-in tools managed by a singleton ToolRegistry:

- **ToolRegistry** (`registry/tool-registry.ts`): Singleton. Tools register with metadata (name, description, category, risk class, input/output schemas) and an executor function. Supports input validation and execution timing.

- **Adapters** (`adapters/`): Pluggable backends behind interfaces.
  - `EmailAdapter`: Interface with `GmailImapAdapter` (real IMAP/SMTP) and `MockEmailAdapter`.
  - `CalendarAdapter`: Interface with `CalDAVCalendarAdapter` (real CalDAV) and `MockCalendarAdapter`.
  - `CRMAdapter`: Interface with `MockCRMAdapter` (pluggable for Salesforce, HubSpot, etc.).
  - `BrowserAdapter`: Playwright-based. Singleton engine manages browser lifecycle.
  - `MemoryAdapter`: In-memory or database-backed key-value store.
  - `PhoringAdapter`: HTTP client for Phoring.ai forecasting and knowledge graph APIs.

- **Adapter Factory** (`adapters/adapter-factory.ts`): Detects environment variables and returns real or mock adapters. `hasRealAdapters()` checks if Gmail/Calendar credentials are configured.

- **MCP Bridge** (`mcp/`):
  - `McpClientManager`: Manages MCP server processes (spawn, connect, disconnect). Each provider gets its own stdio-based MCP server.
  - `McpToolBridge`: Converts between JAK Swarm `ToolMetadata` and MCP tool specs. Agents can call Slack, GitHub, and Notion tools through the same ToolRegistry interface.
  - `MCP_PROVIDERS`: Configuration for each supported MCP provider (command, args, env, credential fields, setup instructions).

### `packages/shared` -- Shared Types

TypeScript enums and interfaces used across all packages:

- `AgentRole` (33 roles), `AgentStatus`, `AgentHandoff`, `ToolCall`, `AgentTrace`
- `ToolCategory` (11 categories), `ToolRiskClass` (4 levels), `ToolMetadata`, `ToolResult`
- `WorkflowStatus`, `TaskStatus`, `RiskLevel`, `WorkflowTask`, `WorkflowPlan`, `ApprovalRequest`

### `packages/db` -- Database

Prisma ORM with PostgreSQL. Schema covers tenants, users, workflows, tasks, traces, integrations, credentials, schedules, memory, and skills.

### `packages/workflows` -- Temporal Integration

Temporal workflow and activity definitions for durable, long-running workflows that survive process restarts.

### `packages/security` -- Security Layer

- **Audit logging**: Records all tool executions and approval decisions.
- **RBAC**: Role-based access control for tenant/user permissions.
- **Guardrails**: Configurable rules for blocking dangerous operations.
- **Tool Risk Classification**: Maps every tool to a risk class (READ_ONLY, WRITE, DESTRUCTIVE, EXTERNAL_SIDE_EFFECT) used by the approval system.

### `packages/voice` -- Voice Pipeline

Real-time voice interaction using OpenAI Realtime API via WebRTC. Optional STT (Deepgram) and TTS (ElevenLabs) adapters.

### `packages/industry-packs` -- Industry Configuration

Pre-configured agent behaviors and tool permissions for specific industries (e.g., healthcare restricts certain tool categories, finance requires approval on all write operations).

---

## LLM Provider Routing

```
                        ProviderRouter
                             |
              ┌──────────────┼──────────────┐
              v              v              v
          Tier 1         Tier 2         Tier 3
       (cheap/fast)    (balanced)     (premium)
              |              |              |
     ┌────┬──┴──┐     ┌────┼────┐    ┌────┼────┐
     v    v     v     v    v    v    v    v    v
   Olla  Deep  Open  Gemi Open Open  Open Anth Open
   ma    Seek  Rtr   ni   Rtr  AI    AI   rop  AI
                                          ic
```

The router detects which providers have API keys configured, then for each tier picks the cheapest available option:

- **Tier 1** (workers): Ollama > DeepSeek > OpenRouter > Gemini > OpenAI
- **Tier 2** (balanced): Gemini > OpenRouter > OpenAI > Anthropic
- **Tier 3** (orchestrators): OpenAI (GPT-4o) > Anthropic (Claude) > Gemini

Strategy overrides (`quality_first`, `local_first`) reorder these preferences.

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

Risk classes determine approval requirements:
- `READ_ONLY`: Never requires approval
- `WRITE`: Requires approval if `DEFAULT_APPROVAL_REQUIRED=true`
- `DESTRUCTIVE`: Always requires approval
- `EXTERNAL_SIDE_EFFECT`: Always requires approval (sends emails, posts to Slack, etc.)

---

## Anti-Hallucination Pipeline

Every agent output passes through four checks before acceptance:

1. **Invented Statistics**: Regex detection of specific percentages, dollar amounts, and large numbers that appear without source attribution.

2. **Fabricated Sources**: Detects academic-style citations (Author et al., year), URL references, and paper titles that the agent may have invented.

3. **Overconfidence**: Flags absolute statements ("always", "never", "guaranteed") and certainty claims without evidence.

4. **Impossible Claims**: Catches logically inconsistent or physically impossible assertions.

Each check contributes to a grounding score (0.0 to 1.0). If the combined score falls below threshold, the Verifier flags the output for re-generation or human review.

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

Fastify server with 14 route modules. Key patterns:

- **Multi-tenant**: Every request is scoped to a tenant via auth middleware.
- **Streaming**: Workflow execution events are streamed to the frontend via SSE for real-time DAG updates.
- **Approval API**: Frontend polls for pending approvals. User approves/rejects, execution resumes.

---

## Frontend Architecture

Next.js 15 with App Router. The dashboard uses a shared layout with sidebar navigation across 11 pages.

Key UI components:
- **DAG Viewer** (React Flow): Renders the workflow plan as an interactive node graph. Nodes change color based on task status (pending/running/completed/failed).
- **Trace Explorer**: Drill into any agent execution to see LLM prompts, tool calls, token counts, costs, and timing.
- **Integration Manager**: Connect/disconnect MCP providers with credential forms and connection testing.
