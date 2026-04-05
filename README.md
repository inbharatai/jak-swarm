<p align="center">
  <h1 align="center">JAK Swarm</h1>
  <p align="center">
    Multi-agent AI workforce that plans, routes, executes, and verifies complex business workflows.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/agents-33-blue?style=flat-square" alt="33 Agents" />
  <img src="https://img.shields.io/badge/tools-65-green?style=flat-square" alt="65 Tools" />
  <img src="https://img.shields.io/badge/LLM%20providers-6-orange?style=flat-square" alt="6 LLM Providers" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/version-0.1.0-purple?style=flat-square" alt="v0.1.0" />
</p>

---

JAK Swarm is a self-orchestrating AI system built as a TypeScript monorepo. You give it a high-level goal in natural language. A Commander agent interprets it, a Planner decomposes it into a dependency-aware task graph, a Router assigns tasks to the right specialist workers (in parallel where possible), and a Verifier checks every output before it ships. The entire pipeline is observable through a real-time DAG visualization dashboard.

It connects to real infrastructure -- Gmail via IMAP/SMTP, Google Calendar via CalDAV, Slack/GitHub/Notion via MCP, and the open web via Playwright -- so agents do actual work, not demos.

---

## Architecture

```
                                    JAK Swarm Pipeline
  ============================================================================

  User Goal (natural language)
       |
       v
  +-------------+     +-----------+     +----------+     +-----------+
  |  COMMANDER   | --> |  PLANNER  | --> |  ROUTER  | --> |  WORKERS  |
  |  Interprets  |     | Builds    |     | Assigns  |     | Execute   |
  |  intent &    |     | task DAG  |     | agents & |     | in        |
  |  context     |     | with deps |     | tools    |     | parallel  |
  +-------------+     +-----------+     +----------+     +-----------+
                                                              |
       +------------------------------------------------------+
       |                                                      |
       v                                                      v
  +------------+     +-------------+                +---------+--------+
  | GUARDRAIL  | <-- |  VERIFIER   |                | 27 Worker Agents |
  | Pre-flight |     | Checks      |                |                  |
  | risk check |     | outputs &   |                | Email     CRM    |
  +------------+     | can trigger |                | Calendar  Code   |
       |              | re-plan    |                | Browser   Docs   |
       v              +-------------+                | Research  SEO    |
  +------------+                                    | Content   PR     |
  |  APPROVAL  |                                    | Legal     HR     |
  | Human-in-  |                                    | Finance   Growth |
  | the-loop   |                                    | Analytics Design |
  | gate       |                                    | Marketing Ops    |
  +------------+                                    | Strategy  Voice  |
                                                    | Product   Project|
                                                    | Support   K.Base |
                                                    | Spreadsheet      |
                                                    +------------------+
```

The swarm graph supports **auto-repair**: if the Verifier rejects output, the system re-plans and re-routes failed tasks without human intervention (configurable).

---

## Features

### 33 AI Agents (6 Orchestrators + 27 Workers)

Every agent has a typed interface, structured input/output schemas, and full trace logging. Orchestrators handle planning and control flow. Workers handle domain-specific execution.

### 65 Registered Tools

Built-in tools spanning email, calendar, CRM, browser automation, document processing, web search, PDF extraction, code execution, knowledge base, SEO auditing, lead enrichment, email sequencing, and more. Plus 4 Phoring.ai tools for forecasting and knowledge graph queries.

### 6 LLM Providers with Tier-Based Routing

| Provider | Tier Use | Notes |
|----------|----------|-------|
| **OpenAI** | Tier 2-3 (GPT-4o, GPT-4o-mini) | Primary provider, multimodal vision |
| **Anthropic** | Tier 3 (Claude Opus/Sonnet) | Premium reasoning, long context |
| **Google Gemini** | Tier 2 | Balanced cost/quality |
| **DeepSeek** | Tier 1 | Low-cost workers |
| **Ollama** | Tier 1 | Local/private, zero API cost |
| **OpenRouter** | Tier 1-2 | Access to 100+ models via single key |

Routing strategies: `cost_optimized` (default), `quality_first`, `local_first`. Tier 1 handles cheap parallel worker tasks. Tier 3 handles Commander, Planner, and Verifier.

### Real-Time DAG Visualization

11-page Next.js dashboard built with React Flow. Watch your workflow execute in real time -- see which agents are active, which tasks are pending, trace every LLM call and tool invocation.

| Page | Description |
|------|-------------|
| Home | Mission control overview |
| Swarm | Real-time workflow execution with DAG view |
| Traces | Full agent trace explorer with token/cost breakdown |
| Analytics | Usage metrics, cost tracking, agent performance |
| Schedules | Cron-based recurring workflow management |
| Integrations | Connect Slack, GitHub, Notion via MCP |
| Knowledge | Knowledge base management |
| Workspace | Workspace/team settings |
| Settings | LLM provider config, approval policies |
| Admin | Tenant & user management |

### MCP Gateway (Slack, GitHub, Notion)

Model Context Protocol integration lets agents interact with external services through standardized tool interfaces. Each provider spawns its own MCP server process with isolated credentials.

### Real Gmail & Calendar

Not mocked. The email adapter uses IMAP (via `imapflow`) for reading and SMTP (via `nodemailer`) for sending. Calendar uses CalDAV (via `tsdav`) for Google Calendar read/write. Falls back to mock adapters if credentials are not configured.

### Workflow Scheduling

Cron-based scheduling via the dashboard. Create recurring workflows that execute on a schedule with full trace history.

### Cost Controls & Approval Gates

- Per-task risk classification: `READ_ONLY`, `WRITE`, `DESTRUCTIVE`, `EXTERNAL_SIDE_EFFECT`
- Human-in-the-loop approval for high-risk actions
- Auto-approve mode for trusted low-risk operations
- Per-workflow token and cost tracking

### 4-Layer Anti-Hallucination

1. **Invented statistics detection** -- regex patterns catch fabricated percentages, dollar amounts, and specific counts
2. **Fabricated source detection** -- identifies fake citations and academic references
3. **Overconfidence detection** -- flags absolute claims without evidence
4. **Impossible claims detection** -- catches logically inconsistent statements

Each layer returns a grounding score (0.0-1.0) and lists specific ungrounded claims.

### Multi-Modal Vision

GPT-4o and Claude support image inputs. The browser agent can take screenshots and pass them to vision models for page analysis.

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+
- Redis (optional, for scheduling)

### Install

```bash
git clone https://github.com/your-org/jak-swarm.git
cd jak-swarm
pnpm install
```

### Configure

```bash
cp .env.example .env
# Edit .env -- at minimum set:
#   OPENAI_API_KEY
#   DATABASE_URL
#   AUTH_SECRET (any random 32+ char string)
```

### Database Setup

```bash
pnpm --filter @jak-swarm/db db:migrate
pnpm --filter @jak-swarm/db db:seed    # optional: seed sample data
```

### Build

```bash
pnpm turbo build
```

### Run

```bash
# Terminal 1 -- API server (Fastify, port 4000)
pnpm --filter @jak-swarm/api dev

# Terminal 2 -- Web dashboard (Next.js, port 3000)
pnpm --filter @jak-swarm/web dev
```

Open `http://localhost:3000` to access the dashboard.

---

## Agent Roster

### Orchestrator Agents

| Role | Agent | Description |
|------|-------|-------------|
| `COMMANDER` | CommanderAgent | Interprets user goals, extracts intent, sets mission context |
| `PLANNER` | PlannerAgent | Decomposes goals into dependency-aware task graphs |
| `ROUTER` | RouterAgent | Assigns agents and tools to each task, enables parallelism |
| `VERIFIER` | VerifierAgent | Validates outputs, triggers re-planning on failure |
| `GUARDRAIL` | GuardrailAgent | Pre-flight risk assessment, blocks dangerous operations |
| `APPROVAL` | ApprovalAgent | Human-in-the-loop gate for high-risk actions |

### Worker Agents

| Role | Agent | Primary Tools |
|------|-------|---------------|
| `WORKER_EMAIL` | EmailAgent | read_email, draft_email, send_email, gmail_read_inbox, gmail_send_email |
| `WORKER_CALENDAR` | CalendarAgent | list_calendar_events, create_calendar_event, find_availability |
| `WORKER_CRM` | CRMAgent | lookup_crm_contact, update_crm_record, search_deals, enrich_contact |
| `WORKER_DOCUMENT` | DocumentAgent | summarize_document, extract_document_data, pdf_extract_text, pdf_analyze |
| `WORKER_SPREADSHEET` | SpreadsheetAgent | parse_spreadsheet, compute_statistics, generate_report |
| `WORKER_BROWSER` | BrowserAgent | browser_navigate, browser_extract, browser_fill_form, browser_screenshot + 7 more |
| `WORKER_RESEARCH` | ResearchAgent | web_search, web_fetch, search_knowledge |
| `WORKER_KNOWLEDGE` | KnowledgeAgent | search_knowledge, memory_store, memory_retrieve |
| `WORKER_SUPPORT` | SupportAgent | classify_ticket, lookup_customer, search_knowledge_base |
| `WORKER_OPS` | OpsAgent | send_webhook, file_read, file_write, list_directory, code_execute |
| `WORKER_VOICE` | VoiceAgent | OpenAI Realtime API via WebRTC |
| `WORKER_CODER` | CoderAgent | code_execute, file_read, file_write |
| `WORKER_DESIGNER` | DesignerAgent | browser_screenshot, browser_analyze_page |
| `WORKER_STRATEGIST` | StrategistAgent | web_search, research tools, analytics |
| `WORKER_MARKETING` | MarketingAgent | create_email_sequence, personalize_email, track_email_engagement |
| `WORKER_TECHNICAL` | TechnicalAgent | code_execute, web_search, architecture analysis |
| `WORKER_FINANCE` | FinanceAgent | compute_statistics, generate_report, spreadsheet tools |
| `WORKER_HR` | HRAgent | classify_text, draft_email, document tools |
| `WORKER_GROWTH` | GrowthAgent | score_lead, enrich_contact, predict_churn, generate_winback, monitor_company_signals |
| `WORKER_CONTENT` | ContentAgent | web_search, classify_text, draft tools |
| `WORKER_SEO` | SEOAgent | audit_seo, research_keywords, analyze_serp, monitor_rankings |
| `WORKER_PR` | PRAgent | web_search, draft_email, classify_text |
| `WORKER_LEGAL` | LegalAgent | extract_document_data, summarize_document, classify_text |
| `WORKER_SUCCESS` | SuccessAgent | lookup_customer, classify_ticket, draft_email |
| `WORKER_ANALYTICS` | AnalyticsAgent | compute_statistics, generate_report, analyze_engagement |
| `WORKER_PRODUCT` | ProductAgent | web_search, classify_text, generate_report |
| `WORKER_PROJECT` | ProjectAgent | list_calendar_events, send_webhook, generate_report |

---

## Tool Inventory

| Category | Count | Tools | Status |
|----------|-------|-------|--------|
| **Email** | 5 | read_email, draft_email, send_email, gmail_read_inbox, gmail_send_email | REAL (Gmail IMAP/SMTP) |
| **Calendar** | 3 | list_calendar_events, create_calendar_event, find_availability | REAL (CalDAV) |
| **CRM** | 3 | lookup_crm_contact, update_crm_record, search_deals | MOCK (pluggable adapter) |
| **Browser** | 11 | navigate, extract, fill_form, click, screenshot, get_text, type_text, press_key, mouse_click, scroll, analyze_page | REAL (Playwright) |
| **Document** | 4 | summarize_document, extract_document_data, pdf_extract_text, pdf_analyze | REAL (pdf-parse) |
| **Research** | 3 | web_search, web_fetch, search_knowledge | REAL (web) / needs runtime |
| **Spreadsheet** | 3 | parse_spreadsheet, compute_statistics, generate_report | Built-in |
| **Knowledge** | 3 | search_knowledge, memory_store, memory_retrieve | REAL (DB-backed) |
| **Ops** | 5 | send_webhook, file_read, file_write, list_directory, code_execute | Built-in |
| **Classify** | 1 | classify_text | Built-in |
| **Lead/Sales** | 8 | enrich_contact, enrich_company, verify_email, score_lead, deduplicate_contacts, find_decision_makers, monitor_company_signals, predict_churn | Built-in |
| **SEO** | 4 | audit_seo, research_keywords, analyze_serp, monitor_rankings | Built-in |
| **Email Sequences** | 5 | create_email_sequence, personalize_email, schedule_email, track_email_engagement, analyze_engagement | Built-in |
| **Growth** | 2 | generate_winback, predict_churn | Built-in |
| **Phoring.ai** | 4 | phoring_forecast, phoring_graph_query, phoring_validate, phoring_simulate | REAL (needs Phoring API) |
| **MCP (external)** | Dynamic | Slack, GitHub, Notion tools loaded at runtime | REAL (MCP servers) |

**Total: 65 built-in tools + dynamic MCP tools**

---

## Integration Setup

### Gmail (IMAP/SMTP)

1. Enable 2-Factor Authentication on your Google account
2. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
3. Generate an app password for "Mail"
4. Add to `.env`:

```bash
GMAIL_EMAIL="you@gmail.com"
GMAIL_APP_PASSWORD="abcd efgh ijkl mnop"
```

The system auto-detects these variables and switches from mock to real adapters.

### Slack (MCP)

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Add Bot Token Scopes: `channels:read`, `chat:write`, `search:read`, `users:read`
3. Install to workspace and copy the Bot User OAuth Token
4. In the dashboard: **Settings > Integrations > Slack** -- paste token and Team ID

### GitHub (MCP)

1. Generate a Personal Access Token at [github.com/settings/tokens](https://github.com/settings/tokens)
2. Select scopes: `repo`, `read:org`, `read:user`
3. In the dashboard: **Settings > Integrations > GitHub** -- paste token

### Notion (MCP)

1. Create an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Copy the Internal Integration Secret
3. Share your Notion pages/databases with the integration
4. In the dashboard: **Settings > Integrations > Notion** -- paste secret

---

## Scheduling

Create recurring workflows from the dashboard at `/schedules`:

```json
{
  "name": "Weekly SEO Audit",
  "goal": "Run a full SEO audit on our marketing site and email the report to the team",
  "cron": "0 9 * * 1",
  "enabled": true
}
```

Cron expressions use standard 5-field format: `minute hour day-of-month month day-of-week`. The scheduler stores execution history and traces for every run.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis for scheduling/queues |
| `AUTH_SECRET` | Yes | -- | Random secret for session signing (32+ chars) |
| `AUTH_URL` | No | `http://localhost:3000` | Base URL for auth callbacks |
| `OPENAI_API_KEY` | Yes | -- | OpenAI API key (primary LLM provider) |
| `OPENAI_ORG_ID` | No | -- | OpenAI organization ID |
| `ANTHROPIC_API_KEY` | No | -- | Anthropic API key for Claude models |
| `GEMINI_API_KEY` | No | -- | Google Gemini API key |
| `DEEPSEEK_API_KEY` | No | -- | DeepSeek API key |
| `OPENROUTER_API_KEY` | No | -- | OpenRouter API key |
| `OLLAMA_URL` | No | -- | Ollama server URL for local models |
| `OLLAMA_MODEL` | No | -- | Ollama model name |
| `LLM_ROUTING_STRATEGY` | No | `cost_optimized` | `cost_optimized`, `quality_first`, or `local_first` |
| `GMAIL_EMAIL` | No | -- | Gmail address for real email adapter |
| `GMAIL_APP_PASSWORD` | No | -- | Gmail app password (not your account password) |
| `CALDAV_URL` | No | -- | CalDAV server URL for calendar |
| `CALDAV_USERNAME` | No | -- | CalDAV username |
| `CALDAV_PASSWORD` | No | -- | CalDAV password |
| `OPENAI_REALTIME_MODEL` | No | `gpt-4o-realtime-preview` | Model for voice agent |
| `DEEPGRAM_API_KEY` | No | -- | Deepgram STT adapter |
| `ELEVENLABS_API_KEY` | No | -- | ElevenLabs TTS adapter |
| `ELEVENLABS_VOICE_ID` | No | -- | ElevenLabs voice ID |
| `PHORING_API_URL` | No | -- | Phoring.ai API endpoint |
| `PHORING_API_KEY` | No | -- | Phoring.ai API key |
| `TEMPORAL_ADDRESS` | No | `localhost:7233` | Temporal server for durable workflows |
| `TEMPORAL_NAMESPACE` | No | `jak-swarm` | Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | No | `jak-main` | Temporal task queue |
| `NODE_ENV` | No | `development` | Environment |
| `API_PORT` | No | `4000` | API server port |
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:4000` | API URL for frontend |
| `NEXT_PUBLIC_APP_URL` | No | `http://localhost:3000` | App URL |
| `LOG_LEVEL` | No | `info` | Logging level |
| `DEFAULT_APPROVAL_REQUIRED` | No | `true` | Require human approval by default |

---

## Project Structure

```
jak-swarm/
├── apps/
│   ├── api/                    # Fastify REST API (port 4000)
│   │   └── src/
│   │       ├── routes/         # 14 route modules
│   │       ├── services/       # Business logic
│   │       ├── middleware/      # Auth, RBAC, rate limiting
│   │       └── plugins/        # Fastify plugins
│   └── web/                    # Next.js dashboard (port 3000)
│       └── src/app/(dashboard)/
│           ├── home/           # Mission control
│           ├── swarm/          # Real-time DAG execution view
│           ├── traces/         # Agent trace explorer
│           ├── analytics/      # Usage & cost metrics
│           ├── schedules/      # Cron workflow manager
│           ├── integrations/   # MCP provider connections
│           ├── knowledge/      # Knowledge base
│           ├── workspace/      # Team settings
│           ├── settings/       # LLM & approval config
│           └── admin/          # Tenant management
├── packages/
│   ├── agents/                 # 33 agent implementations
│   │   └── src/
│   │       ├── base/           # BaseAgent, LLM providers, anti-hallucination
│   │       ├── roles/          # 6 orchestrator agents
│   │       └── workers/        # 27 worker agents
│   ├── tools/                  # 65 tool implementations
│   │   └── src/
│   │       ├── registry/       # Singleton ToolRegistry
│   │       ├── builtin/        # 65 built-in tools
│   │       ├── adapters/       # Email, Calendar, CRM, Browser, Memory
│   │       └── mcp/            # MCP client, bridge, provider configs
│   ├── swarm/                  # Orchestration engine
│   │   └── src/
│   │       ├── graph/          # DAG builder, node handlers, task scheduler
│   │       ├── runner/         # SwarmRunner execution loop
│   │       └── state/          # Immutable state machine
│   ├── shared/                 # Shared types & enums
│   ├── db/                     # Prisma schema, migrations, seed
│   ├── workflows/              # Temporal workflow definitions
│   ├── security/               # Audit logging, RBAC, guardrails, tool risk
│   ├── voice/                  # Voice pipeline (WebRTC, STT, TTS)
│   └── industry-packs/         # Industry-specific agent configurations
├── tests/
│   ├── unit/                   # Unit tests
│   ├── integration/            # Integration tests
│   └── e2e/                    # End-to-end tests
├── docker/                     # Docker Compose for Postgres, Redis, Temporal
├── scripts/                    # Dev scripts
└── docs/                       # Documentation
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Monorepo** | pnpm workspaces + Turborepo |
| **Language** | TypeScript 5.7 (strict) |
| **API** | Fastify |
| **Frontend** | Next.js 15, React, Tailwind CSS |
| **DAG Visualization** | React Flow |
| **Database** | PostgreSQL + Prisma ORM |
| **Durable Workflows** | Temporal |
| **Browser Automation** | Playwright |
| **Email** | imapflow (IMAP) + nodemailer (SMTP) |
| **Calendar** | tsdav (CalDAV) |
| **PDF** | pdf-parse |
| **External Integrations** | Model Context Protocol (MCP) |
| **Testing** | Vitest |
| **Schema Validation** | Zod |

---

## API Routes

The Fastify API exposes 14 route modules:

| Route | Description |
|-------|-------------|
| `/api/auth` | Authentication & sessions |
| `/api/workflows` | Create, list, execute workflows |
| `/api/approvals` | Approve/reject pending actions |
| `/api/traces` | Query agent execution traces |
| `/api/tools` | List available tools |
| `/api/analytics` | Usage metrics & cost data |
| `/api/schedules` | CRUD for scheduled workflows |
| `/api/integrations` | MCP provider management |
| `/api/memory` | Knowledge base read/write |
| `/api/skills` | Skill/template management |
| `/api/voice` | Voice pipeline endpoints |
| `/api/tenants` | Multi-tenant management |
| `/api/llm-settings` | LLM provider configuration |
| `/api/onboarding` | First-run setup flow |

---

## Development

```bash
# Run all tests
pnpm test

# Type checking
pnpm typecheck

# Lint
pnpm lint

# Run specific package tests
pnpm --filter @jak-swarm/agents test
pnpm --filter @jak-swarm/tools test
pnpm --filter @jak-swarm/swarm test
```

---

## API Reference

All endpoints are prefixed with `/api`. Responses follow the envelope format `{ success: true, data: ... }` or `{ success: false, error: { code, message } }`.

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | None | Create tenant + admin user, returns JWT |
| POST | `/auth/login` | None | Authenticate with email + password, returns JWT |
| POST | `/auth/logout` | JWT | Invalidate session (client discards token) |
| GET | `/auth/me` | JWT | Get current user profile |

Auth endpoints are rate-limited to 10 requests per minute per IP.

### Workflows

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
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

### Approvals

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/approvals` | JWT + Reviewer | List approval requests (filterable by status) |
| GET | `/approvals/:approvalId` | JWT + Reviewer | Get a single approval request |
| POST | `/approvals/:approvalId/decide` | JWT + Reviewer | Submit decision (APPROVED/REJECTED/DEFERRED) |
| POST | `/approvals/:approvalId/defer` | JWT + Reviewer | Convenience shortcut to defer an approval |

### Integrations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/integrations` | JWT | List connected MCP integrations for tenant |
| GET | `/integrations/providers/:provider` | JWT | Get provider setup info (credential fields, instructions) |
| POST | `/integrations/connect` | JWT | Connect an MCP integration with credentials |
| POST | `/integrations/:id/test` | JWT | Test an integration connection |
| DELETE | `/integrations/:id` | JWT | Disconnect and remove an integration |

### Schedules

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/schedules` | JWT | List all schedules for tenant |
| GET | `/schedules/:id` | JWT | Get a single schedule |
| POST | `/schedules` | JWT | Create a new cron schedule |
| PATCH | `/schedules/:id` | JWT | Update schedule (cron, name, enabled, etc.) |
| DELETE | `/schedules/:id` | JWT | Delete a schedule |
| POST | `/schedules/:id/run` | JWT | Trigger an immediate run of a schedule |

### Memory

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/memory` | JWT | List memory entries (filterable by type, searchable) |
| GET | `/memory/:key` | JWT | Get a specific memory entry by key |
| PUT | `/memory/:key` | JWT + Operator | Upsert a memory entry (FACT/PREFERENCE/CONTEXT/SKILL_RESULT) |
| DELETE | `/memory/:key` | JWT + Admin | Delete a memory entry |

### Tools

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/tools` | JWT | List all registered tools with metadata |
| GET | `/tools/:toolName` | JWT | Get full tool detail (risk class, schemas) |

### Traces

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/traces` | JWT | List agent traces (filterable by workflowId, agentRole) |
| GET | `/traces/:traceId` | JWT | Get full trace by ID |
| GET | `/traces/:traceId/replay` | JWT | Get replay-friendly trace data with timing |

### Analytics

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/analytics/usage` | JWT | Tenant usage summary (tokens, cost, time series) |
| GET | `/analytics/usage/workflow/:workflowId` | JWT | Per-workflow usage report (cost by provider/model/agent) |
| GET | `/analytics/cost` | JWT | Cost breakdown for current billing period (last 30 days) |

### LLM Settings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/settings/llm` | JWT | List configured LLM providers (masked key previews) |
| GET | `/settings/llm/status` | JWT | Health check all providers |
| PUT | `/settings/llm/:provider` | JWT + Operator | Set or update API key for a provider (AES-256-GCM encrypted) |
| DELETE | `/settings/llm/:provider` | JWT + Admin | Remove a stored API key |

### Voice

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/voice/sessions` | JWT | Create voice session (returns WebRTC config) |
| GET | `/voice/sessions/:sessionId/token` | JWT | Get ephemeral WebRTC token from OpenAI Realtime API |
| DELETE | `/voice/sessions/:sessionId` | JWT | End a voice session |
| GET | `/voice/sessions/:sessionId/transcript` | JWT | Retrieve transcript for a voice session |

### Tenants

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/tenants/:tenantId` | JWT | Get tenant info |
| PATCH | `/tenants/:tenantId` | JWT + Admin | Update tenant settings |
| GET | `/tenants/:tenantId/users` | JWT + Admin | List users in tenant |
| POST | `/tenants/:tenantId/users` | JWT + Admin | Invite a new user to the tenant |
| PATCH | `/tenants/:tenantId/users/:userId` | JWT + Admin | Update user role or active status |
| PATCH | `/tenants/current/users/:userId` | JWT | Update own profile (name, jobFunction, avatarUrl) |

### Skills

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/skills` | JWT | List skills (filterable by tier and status) |
| GET | `/skills/:skillId` | JWT | Get skill by ID |
| POST | `/skills/propose` | JWT | Propose a new tenant skill |
| POST | `/skills/:skillId/approve` | JWT + Admin | Approve a proposed skill |
| POST | `/skills/:skillId/reject` | JWT + Admin | Reject a proposed skill |
| POST | `/skills/:skillId/sandbox` | JWT + Admin | Trigger sandbox test run for a proposed skill |

### Onboarding

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/onboarding/state` | JWT | Get current onboarding state |
| POST | `/onboarding/state` | JWT | Update onboarding progress (completedSteps, dismissed) |

---

## Contributing

### Adding a New Agent

1. Create `packages/agents/src/workers/your-agent.ts` following the pattern in `growth.agent.ts`
2. Export from `packages/agents/src/index.ts`
3. Add `AgentRole.WORKER_YOUR_ROLE` to `packages/shared/src/types/agent.ts`
4. Add case to `createWorkerAgent()` in `packages/swarm/src/graph/nodes/worker-node.ts`
5. Add case to `buildTaskInput()` in the same file
6. Add `infer*Action()` function at the end of the same file
7. Add role description to `packages/agents/src/roles/planner.agent.ts`
8. Run `pnpm turbo build` to verify

### Adding a New Tool

1. Add `toolRegistry.register(metadata, executor)` in `packages/tools/src/builtin/index.ts`
2. Define `inputSchema` and `outputSchema` (JSON Schema format)
3. Set `riskClass` (`READ_ONLY`, `WRITE`, `DESTRUCTIVE`, `EXTERNAL_SIDE_EFFECT`)
4. Set `requiresApproval: true` for write/destructive operations
5. Run `pnpm turbo build` to verify

### Running Tests

```bash
pnpm --filter @jak-swarm/tests test                              # Unit tests
OPENAI_API_KEY=sk-... pnpm --filter @jak-swarm/tests test        # Live tests
OPENAI_API_KEY=sk-... node tests/human-simulator/run-all.js      # Human simulator
```

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| `Playwright times out` | Chromium not installed | `cd packages/tools && npx playwright install chromium` |
| `Email agent says "not connected"` | No Gmail credentials | Set `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD` in `.env` |
| `Workflow stuck in RUNNING` | Server crashed mid-execution | Restart API -- `recoverStaleWorkflows` runs on startup |
| `Budget exceeded` | `maxCostUsd` too low | Increase budget or remove limit |
| `MCP connection failed` | Wrong token/API key | Verify credentials in integration settings |
| `Database connection error` | PostgreSQL not running | Start PostgreSQL: `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres` |
| `Module not found` | Stale build | Run `pnpm turbo build --force` |
| `Tool validation error` | Wrong input format | Check tool's `inputSchema` in source code |
| `SSE stream disconnects` | Proxy buffering | Set `X-Accel-Buffering: no` on your reverse proxy |
| `JWT expired` | Token older than 7 days | Re-authenticate via `POST /auth/login` |

---

## Security

### Tool Risk Classification

| Risk Level | Examples | Approval Required |
|-----------|---------|------------------|
| READ_ONLY | web_search, file_read, list_calendar | Never |
| WRITE | file_write, create_event, update_crm | Based on tenant `DEFAULT_APPROVAL_REQUIRED` setting |
| DESTRUCTIVE | delete records, clear data | Always |
| EXTERNAL_SIDE_EFFECT | send_email, send_webhook, post_slack | Always |

### Approval Gates

- Tasks above the tenant's `approvalThreshold` require human review
- Set `DEFAULT_APPROVAL_REQUIRED=false` for maximum autonomy (low-risk only)
- Set `DEFAULT_APPROVAL_REQUIRED=true` to require approval for all write+ operations
- Reviewers, Tenant Admins, and System Admins can approve/reject/defer

### Data Protection

- OAuth tokens and LLM API keys encrypted with AES-256-GCM at rest (derived via scrypt from `AUTH_SECRET`)
- JWT tokens are signed with `AUTH_SECRET` and verified on every request
- Per-tenant data isolation enforced at middleware level (`enforceTenantIsolation`)
- Passwords hashed with bcrypt (12 rounds)
- Auth endpoints rate-limited to 10 requests/minute per IP
- RBAC roles: `SYSTEM_ADMIN` > `TENANT_ADMIN` > `OPERATOR` > `REVIEWER` > `VIEWER`

---

## Performance

| Operation | Time | Cost (GPT-4o) |
|-----------|------|--------------|
| Simple research task | 10-30s | $0.01-0.05 |
| Multi-agent workflow (5 tasks) | 30-90s | $0.05-0.20 |
| Complex pipeline (10+ tasks) | 2-5min | $0.20-1.00 |
| Voice session (per minute) | Real-time | ~$0.06 |

### Limits

| Resource | Default | Configurable |
|----------|---------|-------------|
| Max concurrent workflows | 20 | Constructor param in SwarmRunner |
| Max concurrent tasks per workflow | 5 | `MAX_CONCURRENT_TASKS` |
| Max tool iterations per agent | 10 | `maxIterations` param |
| Per-node timeout | 120s | `NODE_TIMEOUT_MS` |
| Max replan attempts | 1 | `MAX_REPLAN_ATTEMPTS` |
| State store TTL | 5 minutes | Hardcoded in SwarmState |
| SSE heartbeat interval | 15s | Hardcoded in stream handler |
| Voice session TTL | 1 hour | `VOICE_SESSION_TTL_SECONDS` |
| Auth rate limit | 10 req/min per IP | `AUTH_RATE_LIMIT` config |
| Pagination max per page | 100 | Query param `limit` (max 100) |

---

## FAQ

**Q: Is JAK Swarm production-ready?**
A: The architecture is production-grade (multi-tenant, RBAC, cost controls, state persistence, error recovery). It's v0.1.0 -- test thoroughly before production deployment.

**Q: How much does it cost?**
A: JAK Swarm is free and open-source. You pay only for LLM API calls ($0.01-1.00 per workflow depending on complexity and provider).

**Q: Can I use local LLMs?**
A: Yes. Set `OLLAMA_URL` and `OLLAMA_MODEL` for Ollama, or `OPENROUTER_API_KEY` for OpenRouter access to 100+ models. Use `LLM_ROUTING_STRATEGY=local_first` to prefer local models.

**Q: How do I connect Gmail without OAuth?**
A: Enable 2FA on Gmail, generate an App Password at myaccount.google.com/apppasswords, then set `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD` in `.env`.

**Q: How do I connect Slack?**
A: Go to Integrations in the dashboard, click Connect on Slack, and enter your Bot Token + Team ID from api.slack.com/apps.

**Q: What happens if a task fails?**
A: The workflow continues with other independent tasks (graceful failure). The Verifier can trigger auto-repair, which replans and retries failed tasks with alternative approaches (configurable max retries).

**Q: Can agents see images and PDFs?**
A: Yes. GPT-4o and Claude vision models process images via `analyzeImage()`. PDF tools (`pdf_extract_text`, `pdf_analyze`) handle document processing.

**Q: How do I add a new LLM provider?**
A: Implement the `LLMProvider` interface in `packages/agents/src/base/`, add it to the `ProviderRouter` tier configuration, and set the corresponding API key env variable.

**Q: What RBAC roles are available?**
A: Five roles in ascending privilege: `VIEWER` (read-only), `REVIEWER` (approve/reject), `OPERATOR` (run workflows, manage memory), `TENANT_ADMIN` (full tenant control), `SYSTEM_ADMIN` (cross-tenant).

**Q: How does the SSE streaming work?**
A: `GET /workflows/:id/stream` accepts a JWT via `?token=` query param (since EventSource cannot set headers). The server emits events for node transitions, task completions, and errors. A heartbeat every 15s keeps the connection alive.

---

## License

MIT
