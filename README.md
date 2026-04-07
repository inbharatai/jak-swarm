<div align="center">

# 🐝 JAK Swarm

### The Autonomous AI Company — 33 Agents That Run Your Business

[![Agents](https://img.shields.io/badge/AI_Agents-38-blue?style=for-the-badge&logo=openai&logoColor=white)](https://github.com/inbharatai/jak-swarm)
[![Tools](https://img.shields.io/badge/Tools-112-green?style=for-the-badge&logo=playwright&logoColor=white)](https://github.com/inbharatai/jak-swarm)
[![Vibe Coding](https://img.shields.io/badge/Vibe_Coding-Builder-emerald?style=for-the-badge&logo=vercel&logoColor=white)](https://github.com/inbharatai/jak-swarm)
[![LLM Providers](https://img.shields.io/badge/LLM_Providers-6-purple?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/inbharatai/jak-swarm)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/inbharatai/jak-swarm)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-80%2F80_Human_Sim-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/inbharatai/jak-swarm)

**Open-source multi-agent AI platform that replaces entire departments.**
**CEO • CTO • CMO • Engineer • Legal • Finance • HR • Marketing — all autonomous.**
**Now with Vibe Coding: describe an app, watch it build, deploy in minutes.**

[Quick Start](#-quick-start) • [Features](#-features) • [Agent Roster](#-agent-roster) • [API Reference](#-api-reference) • [Documentation](ARCHITECTURE.md)

---

*Give it a goal in plain English. Watch 33 agents plan, execute, and deliver — in real time.*

</div>

---

## 🏗️ How It Works

JAK Swarm is a self-orchestrating AI system built as a TypeScript monorepo. You give it a high-level goal in natural language. A Commander agent interprets it, a Planner decomposes it into a dependency-aware task graph, a Router assigns tasks to the right specialist workers (in parallel where possible), and a Verifier checks every output before it ships. The entire pipeline is observable through a real-time DAG visualization dashboard.

It connects to real infrastructure -- Gmail via IMAP/SMTP, Google Calendar via CalDAV, Slack/GitHub/Notion via MCP, and the open web via Playwright -- so agents do actual work, not demos.

```
┌─────────────────────────────────────────────────────────────┐
│                      USER COMMAND                            │
│              "Research competitors and write a report"        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │    🎯 COMMANDER AGENT       │
        │    Parse goal → mission     │
        └─────────────┬───────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │    📋 PLANNER AGENT         │
        │    Decompose → task DAG     │
        └─────────────┬───────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    ┌───────────┐ ┌───────────┐ ┌───────────┐
    │🔍Research │ │✏️ Content │ │📧 Email   │
    │  Agent    │ │  Agent    │ │  Agent    │
    │ web_search│ │ write_blog│ │ draft_send│
    └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
          │             │             │
          └─────────────┼─────────────┘
                        ▼
        ┌─────────────────────────────┐
        │    ✅ VERIFIER AGENT        │
        │    Quality check → approve  │
        └─────────────┬───────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │    📊 RESULT DELIVERED      │
        │    Compiled markdown output  │
        └─────────────────────────────┘
```

> **Auto-Repair**: If the Verifier rejects output, the system re-plans and re-routes failed tasks without human intervention (configurable).

---

## ✨ Features

| | Feature | Description |
|---|---------|-------------|
| 🤖 | **38 AI Agents** | 6 orchestrators + 27 workers + 5 vibe coding specialists |
| 🔧 | **112 Tools** | Web search, browser, email, calendar, code execution, sandbox, PDF, vision |
| ⚡ | **Vibe Coding Builder** | Describe an app in plain English, get a live full-stack app. Architect → Generate → Build → Preview → Deploy |
| 🔄 | **DAG Execution** | Parallel task scheduling with dependency tracking and auto-repair |
| 👁️ | **Screenshot-to-Code** | Upload a UI screenshot, get pixel-accurate React + Tailwind components |
| 📧 | **Real Gmail/Calendar** | IMAP/SMTP + CalDAV — no OAuth needed, just app password |
| 🔌 | **MCP Gateway** | Slack, GitHub, Notion via official MCP servers |
| ⏰ | **Workflow Scheduling** | Cron-based recurring tasks with UI |
| 💰 | **Cost Controls** | Per-workflow budgets, 3-tier LLM routing for cost optimization |
| 🛡️ | **4-Layer Anti-Hallucination** | Prompt rules → self-correction → verification → auto-repair |
| 🌐 | **22 Browser Tools** | Full Playwright: keyboard, mouse, cookies, tabs, PDF export, vision |
| 📊 | **React Flow DAG Graph** | Real-time visualization of agent execution |
| 🏢 | **Multi-Tenant SaaS** | RBAC, approval gates, audit logging, onboarding wizard |
| 🚀 | **One-Click Deploy** | Deploy generated apps to Vercel with env vars and custom domains |
| 🔀 | **Version Control** | Every change creates a snapshot. Rollback to any version instantly |
| 📸 | **Image-to-Code** | Drag-drop a Figma screenshot, AI replicates the design |

---

## 🎭 Agent Roster

<div align="center">

### 🎯 Orchestrators (6)

> **Commander** • **Planner** • **Router** • **Verifier** • **Guardrail** • **Approval**
>
> *The brain of the swarm. Parse goals, build task DAGs, assign workers, verify quality, block risk, and gate approvals.*

</div>

---

### 💼 Executive Suite (8)

> 🎯 **Strategist** (CEO) • 🏗️ **Technical** (CTO) • 💰 **Finance** (CFO) • 📣 **Marketing** (CMO) • 👔 **HR** • 💻 **Coder** • 🎨 **Designer** • 🚀 **Growth**

### 🏢 Company Operations (8)

> ✏️ **Content** • 📈 **SEO** • 📰 **PR** • ⚖️ **Legal** • 🤝 **Success** • 📉 **Analytics** • 🗺️ **Product** • 📌 **Project**

### ⚡ Vibe Coding Agents (5) — NEW

> 🏛️ **App Architect** • ⚡ **Code Generator** • 🔧 **Auto-Debugger** • 🚀 **Deployer** • 📸 **Screenshot-to-Code**
>
> *The AI app builder. Describe what you want, these agents design the architecture, generate production code, auto-fix build errors, and deploy to Vercel.*

### ⚙️ Core Workers (11)

> 📧 **Email** • 📅 **Calendar** • 👤 **CRM** • 📄 **Document** • 📊 **Spreadsheet** • 🌐 **Browser** • 🔍 **Research** • 🧠 **Knowledge** • 🎧 **Support** • ⚙️ **Ops** • 🎤 **Voice**

---

<details>
<summary><b>📋 Full Agent Details (click to expand)</b></summary>

#### Orchestrator Agents

| Role | Agent | Description |
|------|-------|-------------|
| `COMMANDER` | CommanderAgent | Interprets user goals, extracts intent, sets mission context |
| `PLANNER` | PlannerAgent | Decomposes goals into dependency-aware task graphs |
| `ROUTER` | RouterAgent | Assigns agents and tools to each task, enables parallelism |
| `VERIFIER` | VerifierAgent | Validates outputs, triggers re-planning on failure |
| `GUARDRAIL` | GuardrailAgent | Pre-flight risk assessment, blocks dangerous operations |
| `APPROVAL` | ApprovalAgent | Human-in-the-loop gate for high-risk actions |

#### Worker Agents

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

#### Vibe Coding Agents

| Role | Agent | Primary Tools |
|------|-------|---------------|
| `WORKER_APP_ARCHITECT` | AppArchitectAgent | Architecture blueprints, file tree planning, data model design |
| `WORKER_APP_GENERATOR` | AppGeneratorAgent | Full file code generation (React, Next.js, Tailwind, Prisma) |
| `WORKER_APP_DEBUGGER` | AppDebuggerAgent | Self-debugging loop: diagnose build errors, auto-fix, rebuild |
| `WORKER_APP_DEPLOYER` | AppDeployerAgent | Vercel deployment, GitHub sync, custom domain config |
| `WORKER_SCREENSHOT_TO_CODE` | ScreenshotToCodeAgent | Vision analysis, UI replication from screenshots |

</details>

---

## 🧠 LLM Providers & Routing

<div align="center">

| Provider | Tier | Use Case |
|:--------:|:----:|----------|
| ![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-412991?style=flat-square&logo=openai&logoColor=white) | **Tier 2-3** | Primary provider, multimodal vision |
| ![Anthropic](https://img.shields.io/badge/Anthropic-Claude-D97706?style=flat-square&logo=anthropic&logoColor=white) | **Tier 3** | Premium reasoning, long context |
| ![Google](https://img.shields.io/badge/Google-Gemini-4285F4?style=flat-square&logo=google&logoColor=white) | **Tier 2** | Balanced cost/quality |
| ![DeepSeek](https://img.shields.io/badge/DeepSeek-V3-00A67E?style=flat-square) | **Tier 1** | Low-cost workers |
| ![Ollama](https://img.shields.io/badge/Ollama-Local-000000?style=flat-square) | **Tier 1** | Local/private, zero API cost |
| ![OpenRouter](https://img.shields.io/badge/OpenRouter-100%2B_Models-6366F1?style=flat-square) | **Tier 1-2** | Access to 100+ models via single key |

</div>

**Routing Strategies:** `cost_optimized` (default) | `quality_first` | `local_first`

> Tier 1 handles cheap parallel worker tasks. Tier 3 handles Commander, Planner, and Verifier.

---

## 📸 Screenshots

### Landing Page
![JAK Swarm Hero](docs/screenshots/01-hero.png)

### Agent Network — 6 Specialist Roles
![Agent Network](docs/screenshots/02-agents.png)

### Workflow — From Command to Result in Seconds
![Workflow](docs/screenshots/03-workflow.png)

### Pricing — Free / Pro ($49/mo) / Enterprise
![Pricing](docs/screenshots/04-pricing.png)

### Onboarding Wizard — 4-Step Setup
![Onboarding](docs/screenshots/07-onboarding.png)

### Dashboard Home
![Dashboard](docs/screenshots/08-dashboard.png)

### Login & Registration
| Login | Registration |
|:-----:|:------------:|
| ![Login](docs/screenshots/05-login.png) | ![Register](docs/screenshots/06-register.png) |

---

## ⚡ Vibe Coding — AI App Builder

JAK Swarm includes a full **Vibe Coding** module that lets you build complete web applications by describing them in plain English. Think Emergent.sh / Lovable / Bolt.new, but integrated into a multi-agent platform with 3-tier cost optimization.

### How It Works

```
"Build a task manager with user auth, drag-and-drop boards, and dark mode"
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  🏛️ App Architect Agent (Tier 3)                    │
│  Creates: file tree, data models, API endpoints,    │
│  component hierarchy, dependency list               │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  ⚡ Code Generator Agent (Tier 2)                    │
│  Generates: React pages, API routes, Prisma schema, │
│  Tailwind styles — complete, working files           │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  🔧 Auto-Debugger Agent (Tier 1)                     │
│  Runs: npm install → next build → fix errors →       │
│  rebuild (max 3 retries before escalating to user)   │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  👁️ Live Preview                                     │
│  Preview in iframe, iterate via chat, deploy to      │
│  Vercel when ready                                   │
└─────────────────────────────────────────────────────┘
```

### Builder IDE Features

| Feature | Description |
|---------|-------------|
| **3-Panel IDE** | File explorer + Monaco editor + chat panel |
| **Live Preview** | Iframe preview via sandbox dev server |
| **Screenshot-to-Code** | Upload a UI screenshot, AI replicates it |
| **Version History** | Every change creates a snapshot, one-click rollback |
| **Deploy to Vercel** | One-click deployment with env vars and custom domains |
| **GitHub Sync** | Push/pull to any GitHub repository |
| **Self-Debugging** | Build errors auto-detected and auto-fixed (3 retries) |
| **Cost Optimization** | Tier 3 for architecture, Tier 2 for code gen, Tier 1 for debug loops |
| **Iterative Chat** | Describe changes in natural language, only affected files regenerated |
| **Template Library** | Next.js App, SaaS Starter, React SPA scaffolds |

### Estimated Cost Per App

| Operation | LLM Tier | Cost |
|-----------|----------|------|
| Initial architecture | Tier 3 (Claude/GPT-4o) | $0.20-0.50 |
| Code generation | Tier 2 (Sonnet/Flash) | $0.15-0.40 |
| Debug iterations | Tier 1 (DeepSeek/GPT-4o-mini) | $0.02-0.05/iter |
| **Total (new app)** | | **$0.50-2.00** |
| **Per iteration** | | **$0.05-0.30** |

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version |
|:-----------:|:-------:|
| Node.js | 20+ |
| pnpm | 9+ |
| PostgreSQL | 15+ |
| Redis | Optional (for scheduling) |

### 1. Clone & Install

```bash
git clone https://github.com/inbharatai/jak-swarm.git
cd jak-swarm
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` -- at minimum set:

```bash
OPENAI_API_KEY=sk-your-key-here
DATABASE_URL=postgresql://user:pass@localhost:5432/jak_swarm
AUTH_SECRET=your-random-32-char-string-here
```

### 3. Setup Database

```bash
pnpm --filter @jak-swarm/db db:migrate
pnpm --filter @jak-swarm/db db:seed    # optional: seed sample data
```

### 4. Build

```bash
pnpm turbo build
```

### 5. Run

```bash
# Terminal 1 — API server (Fastify, port 4000)
pnpm --filter @jak-swarm/api dev

# Terminal 2 — Web dashboard (Next.js, port 3000)
pnpm --filter @jak-swarm/web dev
```

### 6. Open Dashboard

```
http://localhost:3000
```

> That's it. Give it a goal and watch the swarm execute.

---

## 🖥️ Dashboard Pages

| Page | Description |
|:-----|:------------|
| 🏠 **Home** | Mission control overview |
| 🐝 **Swarm** | Real-time workflow execution with DAG view |
| 🔎 **Traces** | Full agent trace explorer with token/cost breakdown |
| 📊 **Analytics** | Usage metrics, cost tracking, agent performance |
| ⏰ **Schedules** | Cron-based recurring workflow management |
| 🔌 **Integrations** | Connect Slack, GitHub, Notion via MCP |
| 🧠 **Knowledge** | Knowledge base management |
| 🏢 **Workspace** | Workspace/team settings |
| ⚙️ **Settings** | LLM provider config, approval policies |
| 👑 **Admin** | Tenant & user management |

---

## 🔧 Tool Inventory (74 Tools)

| Category | Count | Tools | Status |
|:---------|:-----:|:------|:------:|
| **Email** | 5 | read_email, draft_email, send_email, gmail_read_inbox, gmail_send_email | ✅ Real (Gmail IMAP/SMTP) |
| **Calendar** | 3 | list_calendar_events, create_calendar_event, find_availability | ✅ Real (CalDAV) |
| **CRM** | 3 | lookup_crm_contact, update_crm_record, search_deals | 🔌 Mock (pluggable adapter) |
| **Browser** | 11 | navigate, extract, fill_form, click, screenshot, get_text, type_text, press_key, mouse_click, scroll, analyze_page | ✅ Real (Playwright) |
| **Document** | 4 | summarize_document, extract_document_data, pdf_extract_text, pdf_analyze | ✅ Real (pdf-parse) |
| **Research** | 3 | web_search, web_fetch, search_knowledge | ✅ Real (web) |
| **Spreadsheet** | 3 | parse_spreadsheet, compute_statistics, generate_report | ✅ Built-in |
| **Knowledge** | 3 | search_knowledge, memory_store, memory_retrieve | ✅ Real (DB-backed) |
| **Ops** | 5 | send_webhook, file_read, file_write, list_directory, code_execute | ✅ Built-in |
| **Classify** | 1 | classify_text | ✅ Built-in |
| **Lead/Sales** | 8 | enrich_contact, enrich_company, verify_email, score_lead, deduplicate_contacts, find_decision_makers, monitor_company_signals, predict_churn | ✅ Built-in |
| **SEO** | 4 | audit_seo, research_keywords, analyze_serp, monitor_rankings | ✅ Built-in |
| **Email Sequences** | 5 | create_email_sequence, personalize_email, schedule_email, track_email_engagement, analyze_engagement | ✅ Built-in |
| **Growth** | 2 | generate_winback, predict_churn | ✅ Built-in |
| **Phoring.ai** | 4 | phoring_forecast, phoring_graph_query, phoring_validate, phoring_simulate | ✅ Real (needs API key) |
| **MCP (external)** | Dynamic | Slack, GitHub, Notion tools loaded at runtime | ✅ Real (MCP servers) |

**Total: 65 built-in tools + dynamic MCP tools**

---

## 🔗 Integration Setup

<details>
<summary><b>📧 Gmail (IMAP/SMTP)</b></summary>

1. Enable 2-Factor Authentication on your Google account
2. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
3. Generate an app password for "Mail"
4. Add to `.env`:

```bash
GMAIL_EMAIL="you@gmail.com"
GMAIL_APP_PASSWORD="abcd efgh ijkl mnop"
```

The system auto-detects these variables and switches from mock to real adapters.

</details>

<details>
<summary><b>💬 Slack (MCP)</b></summary>

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Add Bot Token Scopes: `channels:read`, `chat:write`, `search:read`, `users:read`
3. Install to workspace and copy the Bot User OAuth Token
4. In the dashboard: **Settings > Integrations > Slack** -- paste token and Team ID

</details>

<details>
<summary><b>🐙 GitHub (MCP)</b></summary>

1. Generate a Personal Access Token at [github.com/settings/tokens](https://github.com/settings/tokens)
2. Select scopes: `repo`, `read:org`, `read:user`
3. In the dashboard: **Settings > Integrations > GitHub** -- paste token

</details>

<details>
<summary><b>📝 Notion (MCP)</b></summary>

1. Create an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Copy the Internal Integration Secret
3. Share your Notion pages/databases with the integration
4. In the dashboard: **Settings > Integrations > Notion** -- paste secret

</details>

---

## ⏰ Scheduling

Create recurring workflows from the dashboard at `/schedules`:

```json
{
  "name": "Weekly SEO Audit",
  "goal": "Run a full SEO audit on our marketing site and email the report to the team",
  "cron": "0 9 * * 1",
  "enabled": true
}
```

> Cron expressions use standard 5-field format: `minute hour day-of-month month day-of-week`. The scheduler stores execution history and traces for every run.

---

## ⚖️ How JAK Swarm Compares

<div align="center">

| Feature | JAK Swarm | CrewAI | LangGraph | Devin |
|:--------|:---------:|:------:|:---------:|:-----:|
| Pre-built agents | **33** | 0 | 0 | 1 |
| Tools | **74** | 50+ | Custom | ~10 |
| Built-in UI | **15 pages** | --- | LangSmith | IDE |
| Multi-tenant | ✅ | Enterprise | --- | --- |
| Scheduling | ✅ | ✅ | ✅ | --- |
| Browser control | **22 tools** | Via plugin | Via plugin | --- |
| Vision/PDF | ✅ | v1.13+ | Via model | Screenshots |
| Self-correction | **4 layers** | Limited | Manual | Limited |
| Open source | ✅ MIT | ✅ MIT | ✅ MIT | --- $20/mo |
| Price | **Free** | Free | Free+$39 | $20/mo |

</div>

---

## 🔐 Security

### Tool Risk Classification

| Risk Level | Examples | Approval Required |
|:-----------|:--------|:-----------------:|
| 🟢 `READ_ONLY` | web_search, file_read, list_calendar | Never |
| 🟡 `WRITE` | file_write, create_event, update_crm | Configurable |
| 🔴 `DESTRUCTIVE` | delete records, clear data | Always |
| 🟠 `EXTERNAL_SIDE_EFFECT` | send_email, send_webhook, post_slack | Always |

### Approval Gates

- Tasks above the tenant's `approvalThreshold` require human review
- Set `DEFAULT_APPROVAL_REQUIRED=false` for maximum autonomy (low-risk only)
- Set `DEFAULT_APPROVAL_REQUIRED=true` to require approval for all write+ operations
- Reviewers, Tenant Admins, and System Admins can approve/reject/defer

### Data Protection

- OAuth tokens and LLM API keys encrypted with **AES-256-GCM** at rest (derived via scrypt from `AUTH_SECRET`)
- JWT tokens signed with `AUTH_SECRET` and verified on every request
- Per-tenant data isolation enforced at middleware level (`enforceTenantIsolation`)
- Passwords hashed with **bcrypt** (12 rounds)
- Auth endpoints rate-limited to 10 requests/minute per IP
- RBAC roles: `SYSTEM_ADMIN` > `TENANT_ADMIN` > `OPERATOR` > `REVIEWER` > `VIEWER`

---

## 🛡️ 4-Layer Anti-Hallucination

| Layer | Detection | Action |
|:-----:|:----------|:-------|
| 1 | **Invented statistics** | Regex patterns catch fabricated percentages, dollar amounts, specific counts |
| 2 | **Fabricated sources** | Identifies fake citations and academic references |
| 3 | **Overconfidence** | Flags absolute claims without evidence |
| 4 | **Impossible claims** | Catches logically inconsistent statements |

> Each layer returns a grounding score (0.0-1.0) and lists specific ungrounded claims.

---

## 📈 Performance

| Operation | Time | Cost (GPT-4o) |
|:----------|:----:|:-------------:|
| Simple research task | 10-30s | $0.01-0.05 |
| Multi-agent workflow (5 tasks) | 30-90s | $0.05-0.20 |
| Complex pipeline (10+ tasks) | 2-5min | $0.20-1.00 |
| Voice session (per minute) | Real-time | ~$0.06 |

### Resource Limits

| Resource | Default | Configurable |
|:---------|:-------:|:------------:|
| Max concurrent workflows | 20 | Yes |
| Max concurrent tasks per workflow | 5 | `MAX_CONCURRENT_TASKS` |
| Max tool iterations per agent | 10 | `maxIterations` |
| Per-node timeout | 120s | `NODE_TIMEOUT_MS` |
| Max replan attempts | 1 | `MAX_REPLAN_ATTEMPTS` |
| State store TTL | 5 min | Hardcoded |
| SSE heartbeat interval | 15s | Hardcoded |
| Voice session TTL | 1 hour | `VOICE_SESSION_TTL_SECONDS` |
| Auth rate limit | 10 req/min/IP | `AUTH_RATE_LIMIT` |
| Pagination max per page | 100 | Query param `limit` |

---

## 🏗️ Tech Stack

| Layer | Technology |
|:------|:-----------|
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

## 📁 Project Structure

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

## 📡 API Reference

All endpoints are prefixed with `/api`. Responses follow the envelope format:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "...", "message": "..." } }
```

<details>
<summary><b>🔑 Authentication</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| POST | `/auth/register` | None | Create tenant + admin user, returns JWT |
| POST | `/auth/login` | None | Authenticate with email + password, returns JWT |
| POST | `/auth/logout` | JWT | Invalidate session (client discards token) |
| GET | `/auth/me` | JWT | Get current user profile |

Auth endpoints are rate-limited to 10 requests per minute per IP.

</details>

<details>
<summary><b>🐝 Workflows</b></summary>

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

</details>

<details>
<summary><b>✅ Approvals</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/approvals` | JWT + Reviewer | List approval requests (filterable by status) |
| GET | `/approvals/:approvalId` | JWT + Reviewer | Get a single approval request |
| POST | `/approvals/:approvalId/decide` | JWT + Reviewer | Submit decision (APPROVED/REJECTED/DEFERRED) |
| POST | `/approvals/:approvalId/defer` | JWT + Reviewer | Convenience shortcut to defer an approval |

</details>

<details>
<summary><b>🔌 Integrations</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/integrations` | JWT | List connected MCP integrations for tenant |
| GET | `/integrations/providers/:provider` | JWT | Get provider setup info (credential fields, instructions) |
| POST | `/integrations/connect` | JWT | Connect an MCP integration with credentials |
| POST | `/integrations/:id/test` | JWT | Test an integration connection |
| DELETE | `/integrations/:id` | JWT | Disconnect and remove an integration |

</details>

<details>
<summary><b>⏰ Schedules</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/schedules` | JWT | List all schedules for tenant |
| GET | `/schedules/:id` | JWT | Get a single schedule |
| POST | `/schedules` | JWT | Create a new cron schedule |
| PATCH | `/schedules/:id` | JWT | Update schedule (cron, name, enabled, etc.) |
| DELETE | `/schedules/:id` | JWT | Delete a schedule |
| POST | `/schedules/:id/run` | JWT | Trigger an immediate run of a schedule |

</details>

<details>
<summary><b>🧠 Memory</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/memory` | JWT | List memory entries (filterable by type, searchable) |
| GET | `/memory/:key` | JWT | Get a specific memory entry by key |
| PUT | `/memory/:key` | JWT + Operator | Upsert a memory entry (FACT/PREFERENCE/CONTEXT/SKILL_RESULT) |
| DELETE | `/memory/:key` | JWT + Admin | Delete a memory entry |

</details>

<details>
<summary><b>🔧 Tools</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/tools` | JWT | List all registered tools with metadata |
| GET | `/tools/:toolName` | JWT | Get full tool detail (risk class, schemas) |

</details>

<details>
<summary><b>🔎 Traces</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/traces` | JWT | List agent traces (filterable by workflowId, agentRole) |
| GET | `/traces/:traceId` | JWT | Get full trace by ID |
| GET | `/traces/:traceId/replay` | JWT | Get replay-friendly trace data with timing |

</details>

<details>
<summary><b>📊 Analytics</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/analytics/usage` | JWT | Tenant usage summary (tokens, cost, time series) |
| GET | `/analytics/usage/workflow/:workflowId` | JWT | Per-workflow usage report (cost by provider/model/agent) |
| GET | `/analytics/cost` | JWT | Cost breakdown for current billing period (last 30 days) |

</details>

<details>
<summary><b>⚙️ LLM Settings</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/settings/llm` | JWT | List configured LLM providers (masked key previews) |
| GET | `/settings/llm/status` | JWT | Health check all providers |
| PUT | `/settings/llm/:provider` | JWT + Operator | Set or update API key for a provider (AES-256-GCM encrypted) |
| DELETE | `/settings/llm/:provider` | JWT + Admin | Remove a stored API key |

</details>

<details>
<summary><b>🎤 Voice</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| POST | `/voice/sessions` | JWT | Create voice session (returns WebRTC config) |
| GET | `/voice/sessions/:sessionId/token` | JWT | Get ephemeral WebRTC token from OpenAI Realtime API |
| DELETE | `/voice/sessions/:sessionId` | JWT | End a voice session |
| GET | `/voice/sessions/:sessionId/transcript` | JWT | Retrieve transcript for a voice session |

</details>

<details>
<summary><b>🏢 Tenants</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/tenants/:tenantId` | JWT | Get tenant info |
| PATCH | `/tenants/:tenantId` | JWT + Admin | Update tenant settings |
| GET | `/tenants/:tenantId/users` | JWT + Admin | List users in tenant |
| POST | `/tenants/:tenantId/users` | JWT + Admin | Invite a new user to the tenant |
| PATCH | `/tenants/:tenantId/users/:userId` | JWT + Admin | Update user role or active status |
| PATCH | `/tenants/current/users/:userId` | JWT | Update own profile (name, jobFunction, avatarUrl) |

</details>

<details>
<summary><b>🎯 Skills</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/skills` | JWT | List skills (filterable by tier and status) |
| GET | `/skills/:skillId` | JWT | Get skill by ID |
| POST | `/skills/propose` | JWT | Propose a new tenant skill |
| POST | `/skills/:skillId/approve` | JWT + Admin | Approve a proposed skill |
| POST | `/skills/:skillId/reject` | JWT + Admin | Reject a proposed skill |
| POST | `/skills/:skillId/sandbox` | JWT + Admin | Trigger sandbox test run for a proposed skill |

</details>

<details>
<summary><b>🚀 Onboarding</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/onboarding/state` | JWT | Get current onboarding state |
| POST | `/onboarding/state` | JWT | Update onboarding progress (completedSteps, dismissed) |

</details>

---

## 🌍 Environment Variables

<details>
<summary><b>Click to expand full environment variable reference</b></summary>

| Variable | Required | Default | Description |
|:---------|:--------:|:-------:|:------------|
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

</details>

---

## 🛠️ Development

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

## 🤝 Contributing

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

## 🔥 Troubleshooting

| Problem | Cause | Solution |
|:--------|:------|:---------|
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

## ❓ FAQ

<details>
<summary><b>Is JAK Swarm production-ready?</b></summary>

The architecture is production-grade (multi-tenant, RBAC, cost controls, state persistence, error recovery). It's v0.1.0 -- test thoroughly before production deployment.

</details>

<details>
<summary><b>How much does it cost?</b></summary>

JAK Swarm is free and open-source. You pay only for LLM API calls ($0.01-1.00 per workflow depending on complexity and provider).

</details>

<details>
<summary><b>Can I use local LLMs?</b></summary>

Yes. Set `OLLAMA_URL` and `OLLAMA_MODEL` for Ollama, or `OPENROUTER_API_KEY` for OpenRouter access to 100+ models. Use `LLM_ROUTING_STRATEGY=local_first` to prefer local models.

</details>

<details>
<summary><b>How do I connect Gmail without OAuth?</b></summary>

Enable 2FA on Gmail, generate an App Password at myaccount.google.com/apppasswords, then set `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD` in `.env`.

</details>

<details>
<summary><b>How do I connect Slack?</b></summary>

Go to Integrations in the dashboard, click Connect on Slack, and enter your Bot Token + Team ID from api.slack.com/apps.

</details>

<details>
<summary><b>What happens if a task fails?</b></summary>

The workflow continues with other independent tasks (graceful failure). The Verifier can trigger auto-repair, which replans and retries failed tasks with alternative approaches (configurable max retries).

</details>

<details>
<summary><b>Can agents see images and PDFs?</b></summary>

Yes. GPT-4o and Claude vision models process images via `analyzeImage()`. PDF tools (`pdf_extract_text`, `pdf_analyze`) handle document processing.

</details>

<details>
<summary><b>How do I add a new LLM provider?</b></summary>

Implement the `LLMProvider` interface in `packages/agents/src/base/`, add it to the `ProviderRouter` tier configuration, and set the corresponding API key env variable.

</details>

<details>
<summary><b>What RBAC roles are available?</b></summary>

Five roles in ascending privilege: `VIEWER` (read-only), `REVIEWER` (approve/reject), `OPERATOR` (run workflows, manage memory), `TENANT_ADMIN` (full tenant control), `SYSTEM_ADMIN` (cross-tenant).

</details>

<details>
<summary><b>How does SSE streaming work?</b></summary>

`GET /workflows/:id/stream` accepts a JWT via `?token=` query param (since EventSource cannot set headers). The server emits events for node transitions, task completions, and errors. A heartbeat every 15s keeps the connection alive.

</details>

---

## 📄 License

MIT -- free for commercial and personal use.

---

<div align="center">

**Built with ❤️ by [InBharat AI](https://github.com/inbharatai)**

[![GitHub stars](https://img.shields.io/github/stars/inbharatai/jak-swarm?style=social)](https://github.com/inbharatai/jak-swarm)
[![Twitter Follow](https://img.shields.io/twitter/follow/inbharatai?style=social)](https://twitter.com/inbharatai)

**[⬆ Back to Top](#-jak-swarm)**

</div>
