<div align="center">

# 🐝 JAK Swarm

### Operator-Grade Multi-Agent Control Plane

[![Agents](https://img.shields.io/badge/AI_Agents-38-blue?style=for-the-badge&logo=openai&logoColor=white)](https://jakswarm.com)
[![Tools](https://img.shields.io/badge/Classified_Tools-122-green?style=for-the-badge&logo=playwright&logoColor=white)](https://jakswarm.com)
[![Vibe Coding](https://img.shields.io/badge/Vibe_Coding-Builder-emerald?style=for-the-badge&logo=vercel&logoColor=white)](https://jakswarm.com)
[![Audit Pack](https://img.shields.io/badge/Audit_Pack-SOC2_HIPAA_ISO27001-orange?style=for-the-badge&logo=shieldsdotio&logoColor=white)](https://jakswarm.com)
[![LLM Providers](https://img.shields.io/badge/AI_Providers-6_Managed-purple?style=for-the-badge&logo=anthropic&logoColor=white)](https://jakswarm.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/inbharatai/jak-swarm)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Typecheck](https://img.shields.io/badge/Typecheck-23_packages_green-brightgreen?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/inbharatai/jak-swarm)

**Operator-grade multi-agent control plane orchestrated by [LangGraph](https://langchain-ai.github.io/langgraphjs/). 38 specialist agents + 122 classified tools (honest maturity labels: real / heuristic / llm_passthrough / config_dependent / experimental — CI-enforced against the runtime registry). Durable workflow queue with worker-lease reclaim, risk-stratified approval gates, real-time DAG execution, MCP gateway, workflow scheduling, multi-modal vision, Vibe Coder durable app builder. Production Audit & Compliance Agent Pack (SOC 2 / HIPAA / ISO 27001) with 167 seeded controls, LLM-driven control testing, reviewer-gated workpaper PDFs, HMAC-signed final evidence packs, and an invite-token-only External Auditor Portal for third-party reviewers. Company Brain (CompanyProfile + URL crawler + DOCX/XLSX/image ingestion). Source-grounded outputs with citation density verification. Runtime PII redaction in LLM prompts. OpenAI prompt-cache aware cost telemetry. Memory-aware agents, Slack + WhatsApp bridges, voice sessions, typed SDK. API keys are required for external LLM/integration providers unless using local models.**

> **Sprint 2.x + final hardening updates (Apr 2026):** native LangGraph orchestrator with Postgres checkpointer (no more custom state machine); URL crawler + DOCX/XLSX/image parsing; runtime PII auto-redaction in LLM prompts; OpenAI prompt-cache cost telemetry; source-grounded output verification; external auditor portal with SHA-256-hashed invite tokens **+ honest-status email send (`sent` / `not_configured` / `failed` — never fakes success) + scoped final-pack download endpoint**; **CEO super-orchestrator** that loads Company Brain, tags executive functions (CMO/CTO/CFO/COO), and emits a generated executive summary at workflow end; **cross-task auto-repair** with error classification + repair-policy decision tree (destructive actions never auto-retried); **retention sweep service** (dry-run-by-default, never deletes user-owned evidence). See [`qa/final-a-to-z-product-verification.md`](qa/final-a-to-z-product-verification.md) and [`qa/post-sprint-2-final-gap-audit.md`](qa/post-sprint-2-final-gap-audit.md) for the truthful per-feature classification.

[Website](https://jakswarm.com) • [Quick Start](#-quick-start) • [Features](#-features) • [Audit & Compliance](#%EF%B8%8F-audit--compliance-agent-pack) • [Agent Roster](#-agent-roster) • [Documentation](ARCHITECTURE.md)

---

*Give it a goal in plain English. JAK decomposes, routes, executes, and verifies — in real time.*

![JAK Swarm — Hero](docs/screenshot-hero.png)

<details>
<summary><strong>More screenshots</strong></summary>

#### Orchestration Engine
![Orchestration Engine](docs/screenshot-orchestration.png)

#### Agent Network
![Agent Grid](docs/screenshot-agents.png)

#### Capability Architecture
![Capability Map](docs/screenshot-capability-map.png)

#### Live Execution Trace
![Live Demo](docs/screenshot-live-demo.png)

#### Pricing
![Pricing](docs/screenshot-pricing.png)

#### Mobile
![Mobile](docs/screenshot-mobile-hero.png)

</details>

</div>

---

## 🏗️ How It Works

JAK Swarm is a self-orchestrating AI system built as a TypeScript monorepo. You give it a high-level goal in natural language. A Commander agent interprets it, a Planner decomposes it into a dependency-aware task graph, a Router assigns tasks to the right specialist workers (in parallel where possible), and a Verifier checks every output before it ships. The entire pipeline is observable through a real-time DAG visualization dashboard.

The orchestrator is a real native [`@langchain/langgraph`](https://langchain-ai.github.io/langgraphjs/) `StateGraph` — checkpoints persist to a `workflow_checkpoints` Postgres table via the `PostgresCheckpointSaver`; approval pauses use LangGraph's native `interrupt()` + `Command(resume=…)` cycle. The previous custom SwarmGraph state machine was deleted in Sprint 2.5/A.6 (commit `34491f2`); LangGraph is the only orchestration engine and the `JAK_WORKFLOW_RUNTIME` env-flag fallback no longer exists.

It connects to real infrastructure — Gmail via IMAP/SMTP, Google Calendar via CalDAV, Slack/GitHub/Notion via MCP, and the open web via Playwright — so agents do actual work, not demos.

```mermaid
flowchart TD
    subgraph INPUT["🎤 Input Layer"]
        A["💬 Natural Language Goal"]
        B["🎤 Voice Command"]
    end

    subgraph ORCHESTRATION["🧠 Orchestration Layer"]
        C["🎯 Commander Agent\nParse intent • Extract entities • Set mission context"]
        D["📋 Planner Agent\nDecompose goal • Build dependency DAG • Estimate cost"]
        E["🛡️ Guardrail Agent\nRisk assessment • PII detection • Policy enforcement"]
        F["🔀 Router Agent\nAssign agents • Select LLM tier • Enable parallelism"]
    end

    subgraph WORKERS["⚡ Worker Layer — 32 Specialists (incl. 5 Vibe Coding)"]
        direction LR
        G["📧 Email\n📅 Calendar\n👤 CRM"]
        H["📄 Document\n📊 Spreadsheet\n🌐 Browser"]
        I["🔍 Research\n🧠 Knowledge\n🎧 Support"]
        J["💻 Coder\n🎨 Designer\n🚀 Growth"]
        K["⚖️ Legal\n💰 Finance\n👔 HR"]
        L["🏛️ App Architect\n⚡ Code Generator\n🔧 Auto-Debugger"]
    end

    subgraph VERIFY["✅ Quality Layer"]
        M["✅ Verifier Agent\nValidate outputs • Check completeness • Score quality"]
        N["⚠️ Approval Gate\nHuman review for high-risk actions"]
    end

    subgraph OUTPUT["📊 Output Layer"]
        O["📊 Compiled Result\nMarkdown report • Generated app • Executed actions"]
    end

    A --> C
    B --> C
    C --> D
    D --> E
    E -->|"✅ Pass"| F
    E -->|"🚫 Block"| C
    F --> G & H & I & J & K & L
    G & H & I & J & K & L --> M
    M -->|"✅ Pass"| O
    M -->|"❌ Fail"| D
    M -->|"⚠️ Risk"| N
    N -->|"👍 Approved"| O
    N -->|"👎 Rejected"| C

    style INPUT fill:#0d1117,stroke:#34d399,color:#e6edf3
    style ORCHESTRATION fill:#0d1117,stroke:#fbbf24,color:#e6edf3
    style WORKERS fill:#0d1117,stroke:#38bdf8,color:#e6edf3
    style VERIFY fill:#0d1117,stroke:#c084fc,color:#e6edf3
    style OUTPUT fill:#0d1117,stroke:#34d399,color:#e6edf3
```

> **Auto-Repair**: If the Verifier rejects output, the system re-plans and re-routes failed tasks — no human intervention needed (configurable).

<details>
<summary><b>🔄 LLM Routing Strategy</b></summary>

```mermaid
flowchart LR
    subgraph TIER3["💎 Tier 3 — Premium"]
        T3A["Claude Opus/Sonnet"]
        T3B["GPT-4o"]
    end

    subgraph TIER2["⚡ Tier 2 — Balanced"]
        T2A["Gemini Flash"]
        T2B["GPT-4o-mini"]
    end

    subgraph TIER1["💰 Tier 1 — Cost Optimized"]
        T1A["DeepSeek V3"]
        T1B["Ollama (Local)"]
        T1C["OpenRouter"]
    end

    CMD["Commander\nPlanner\nVerifier"] --> TIER3
    GEN["Code Generator\nDesigner\nArchitect"] --> TIER2
    WRK["Email • Calendar\nCRM • Debug\nResearch"] --> TIER1

    style TIER3 fill:#1a0a2e,stroke:#c084fc,color:#e6edf3
    style TIER2 fill:#0a1a15,stroke:#34d399,color:#e6edf3
    style TIER1 fill:#1a150a,stroke:#fbbf24,color:#e6edf3
```

</details>

---

## ✨ Features

| | Feature | Description |
|---|---------|-------------|
| 🤖 | **38 AI Agents** | 6 orchestrators (Commander, Planner, Router, Verifier, Guardrail, Approval) + 32 specialist workers |
| 🧠 | **Company Brain** | Per-tenant `CompanyProfile` (name, industry, brand voice, target customers, competitors, pricing, products, goals, constraints, preferred channels). LLM-extracts from uploaded documents → user approves → `BaseAgent.injectCompanyContext` grounds every agent's prompt in the approved profile. Refuses to load extracted-but-unapproved profiles into agent prompts (no silent overwrite). Memory items now have an `approval_status` field (`extracted` / `suggested` / `user_approved` / `rejected`); agent-suggested memories require reviewer approval before agents see them. UI at `/company`. See [qa/company-brain-verification.md](qa/company-brain-verification.md). |
| 🎯 | **Intent vocabulary + WorkflowTemplate library** | 18 named CompanyOSIntents (`company_strategy_review`, `marketing_campaign_generation`, `audit_compliance_workflow`, …) constrained at the LLM layer via strict zod `CompanyOSIntentSchema`. `IntentRecord` Prisma model persists every classification. 6 system-seeded `WorkflowTemplate`s (strategy review, marketing campaign, website review, code review, competitor research, sales outreach drafts) provide pre-tuned decompositions; tenants can override per-intent. Cockpit emits `intent_detected`, `workflow_selected`, `clarification_required`, `company_context_missing` lifecycle events. |
| 💬 | **Follow-up command NL parser** | Rule-based parser maps short chat inputs to actions on the active workflow: `approve`, `reject`, `continue`, `pause`, `resume`, `cancel`, `show graph`, `show failed`, `show cost`, `download report`, `finalize workpaper`, `why is this waiting`, `what is the CMO/CTO/VibeCoder doing` (resolves role keyword → `agentRole`). Approval-pending bias: short positive responses (`yes`, `go ahead`) auto-route to approve. |
| 🛡️ | **Audit & Compliance Agent Pack** | Full audit engagement workflow: `AuditRun` lifecycle (PLANNING → PLANNED → MAPPING → TESTING → REVIEWING → READY_TO_PACK → FINAL_PACK → COMPLETED), 167 controls seeded across SOC 2 Type 2 (48), HIPAA Security Rule (37), and ISO/IEC 27001:2022 (82). LLM-driven control test evaluation (deterministic fallback when no key), auto-created `AuditException` rows on test failure, per-control workpaper PDFs gated by reviewer approval, HMAC-SHA256 signed final evidence pack. End-to-end e2e test passes. Live SSE on `/audit/runs/[id]` (was 15s SWR poll). See [docs/audit-compliance-agent-pack.md](docs/audit-compliance-agent-pack.md). |
| 🔒 | **Document content sanitization** | Every document chunk returned by `find_document` is wrapped in `<UNTRUSTED_DOCUMENT_CONTENT>` tags + scrubbed of ANSI/zero-width chars + scanned for 8 prompt-injection patterns (ignore-previous-instructions, role-override, fake-system-message, chat-template-injection, prompt-extraction, data-exfiltration). `BaseAgent` system prompt instructs every agent to treat tagged content as DATA, never instructions. |
| 🔧 | **122 Classified Tools** | Every tool carries an honest CI-enforced maturity label (real / heuristic / llm_passthrough / config_dependent / experimental). Email (IMAP/SMTP), calendar (CalDAV), browser tools (Playwright), code sandbox, GitHub, Vercel, CRM, PDF, verification. Breakdown live at `GET /tools/manifest`. |
| 🔍 | **31 Research Tools** | Web search (Serper primary → Tavily → DDG fallback), SEO audit, competitor monitoring, lead enrichment, keyword research, SERP analysis, platform discovery. Count matches `toolRegistry.getManifest()` RESEARCH category |
| ⚡ | **Vibe Coding Builder** | Describe an app → Architect → Generate → 3-layer build check (heuristic + TS compiler + optional Docker) → Debug loop (≤3 retries) → Deploy. Durable end-to-end workflow, auto-snapshots with diff at every stage. Full-stack Next.js/React/Tailwind |
| 🔖 | **Checkpoint-Revert** | Every Vibe Coder stage auto-snapshots the project with a structural diff (added / modified / deleted per file). One-click restore creates a rollback version so restores themselves are reversible |
| 🧪 | **Tool Maturity Manifest** | All 122 built-in tools carry an honest `maturity` label (real / heuristic / llm_passthrough / config_dependent / experimental). `pnpm check:truth` fails CI if any tool ships unclassified or any marketing claim drifts from the registry |
| 🧠 | **6 Managed AI Providers** | OpenAI (GPT-4o), Anthropic (Claude), Google (Gemini), DeepSeek, Ollama (local), OpenRouter. Dynamic routing with failover and role-aware primary selection. Provider API keys are required unless using local models |
| 🧬 | **Memory System** | LLM-powered fact extraction from completed workflows, token-budgeted retrieval injected into agent prompts via `<memory>` tags. Learns from every execution |
| 🎯 | **Context Engineering** | Automatic context summarization prevents window overflow on long DAGs. Protects current task + dependencies, compresses older results |
| 🔄 | **Tool Error Recovery** | Tool crashes produce recoverable error messages instead of workflow failures. Fingerprint-based loop detection (3x threshold) prevents infinite retries |
| 💬 | **Slack Channel Bridge** | Slack messages trigger authenticated workflows with thread-reply results. HMAC-SHA256 signature verification, idempotent event handling |
| 💬 | **WhatsApp Control (QR)** | Register a number in the dashboard, verify via challenge code, then send workflow commands over WhatsApp |
| 🎤 | **Voice Sessions + Realtime Tokens** | Voice session lifecycle and realtime token exchange are implemented; workflow trigger behavior depends on client-side orchestration |
| 📦 | **Internal TypeScript Client Package** | Typed API client in-monorepo with SSE streaming, workflow management, memory CRUD, health checks |
| 🛠️ | **SKILL.md Format** | DeerFlow-compatible skill definitions with YAML frontmatter, recursive discovery, risk levels, tool allowlists |
| 💰 | **Credit-Based Billing** | 4 plans (Free/Pro/Team/Enterprise), daily + monthly caps, per-task cost estimation, usage dashboard, Paddle payments |
| 🔐 | **Verification Engine** | Email threat detection, document forgery, transaction risk, identity verification. 4-layer: rules → AI Tier 1 → AI Tier 3 → human review |
| 🔄 | **DAG Execution** | Directed acyclic graph orchestration with parallel scheduling, dependency tracking, and auto-repair |
| 🔌 | **MCP Integrations (Implemented + Extendable)** | Slack, GitHub, Notion are wired with provider management; additional providers are extendable via MCP and adapter work |
| 🌐 | **30 Browser Tools** | ~20 Playwright primitives (navigate, click, type, screenshot, PDF export, cookies, tabs, JS evaluation) + ~10 site-specific automation tools (social posting, Gmail inbox, auto-reply). The site-specific tools are classified `experimental` in the tool manifest — fragile on UI change. Count matches `toolRegistry.getManifest()` BROWSER category |
| 📊 | **Observability** | 17 Prometheus metrics, OpenTelemetry tracing, per-node cost breakdown, workflow timeline API, /healthz + /ready probes |
| 📈 | **Boot Diagnostics** | Config validation on startup: checks DB, Redis, LLM providers, secrets, CORS — actionable errors in production, friendly warnings in dev |
| 🏗️ | **Distributed Ready** | Redis coordination: distributed locks, leader election, cross-instance signals, shared circuit breakers. P1b worker-lease reclaim: dead workers' jobs are auto-recovered in lease_ttl/2 (default 30s). |
| 🔭 | **Operator-grade Observability** | API + each worker expose `/metrics` (35+ Prometheus types: queue depth, worker liveness, reclaim rate, heartbeat failures, Vibe Coder runs, LLM cost, provider errors, signals). Scrape/alert/dashboard/runbook artifacts in `ops/`. |
| 🎛️ | **Two-service Production Topology** | API (HTTP + SSE + enqueue) runs separately from the queue worker (claim + run + reclaim). Reference: `docker-compose.prod.yml` at repo root. |
| 🏢 | **Multi-Tenant SaaS** | RBAC, approval gates, audit logging, tenant isolation, encrypted secrets (AES-256-GCM) |
| 📧 | **Real Email/Calendar** | Gmail via IMAP/SMTP, Google Calendar via CalDAV. Real send, real events — not mocks |
| 🧩 | **Skills Marketplace** | Create, sandbox-test, and deploy custom agent skills with approval workflow |
| ⏰ | **Workflow Scheduling** | Cron-based recurring workflows with leader-elected scheduler (no duplicate execution) |
| 📸 | **Screenshot-to-Code** | Upload a UI design → AI generates matching React + Tailwind components |
| 🛡️ | **Supervisor Module** | Event bus, circuit breakers (exponential backoff), workflow telemetry, budget enforcement |
| 🏖️ | **Virtual Sandbox FS** | Tenant-scoped `/workspace/` virtual paths translated to E2B or Docker sandbox physical paths. Path traversal protection |

---

## 🧠 Supervisor Module — System Intelligence

The Supervisor is JAK's observability and resilience layer. It ensures workflows are **observable**, **resilient**, and **controllable** — even when individual agents fail.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      SupervisorBus                           │
│              (Typed Event Pub-Sub — Singleton)                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Publishers:                    Subscribers:                 │
│  ├─ SwarmRunner                 ├─ SSE → Frontend            │
│  ├─ WorkerNode                  ├─ Database persistence       │
│  ├─ CircuitBreaker              ├─ Audit logging             │
│  └─ ApprovalGate                └─ Cost tracking             │
│                                                              │
├───── Event Types ────────────────────────────────────────────┤
│  workflow:requested  │  workflow:started  │  workflow:completed│
│  node:entered        │  node:completed    │  approval:required │
│  budget:exceeded     │  circuit:open      │                    │
└──────────────────────────────────────────────────────────────┘
```

### Circuit Breaker

Every agent execution is wrapped in a per-role circuit breaker:

```
CLOSED ──(5 failures)──→ OPEN ──(30s timeout)──→ HALF-OPEN ──(probe succeeds)──→ CLOSED
                           │                        │
                           └── calls fail instantly  └── one test call allowed
```

- **`worker:email`**, **`worker:crm`**, **`worker:browser`** — each agent role gets its own breaker
- When a circuit opens, the Supervisor publishes `circuit:open` to the event bus
- Prevents one broken integration (e.g. Gmail API outage) from cascading to the entire workflow

### Key Files

| File | Purpose |
|------|---------|
| `packages/swarm/src/supervisor/supervisor-bus.ts` | Event pub-sub with multi-tenant workflow tracking |
| `packages/swarm/src/supervisor/circuit-breaker.ts` | State machine protecting agent execution |
| `packages/swarm/src/runner/swarm-runner.ts` | Publishes workflow lifecycle events |
| `packages/swarm/src/graph/nodes/worker-node.ts` | Wraps agent calls in circuit breakers |

### Why This Matters

Most AI agent platforms have **zero resilience**. If an LLM call fails, the whole workflow crashes. JAK's Supervisor module means:

- **One broken agent can't take down everything** — circuit breakers isolate failures
- **You can watch execution in real time** — every node entry/exit streams to the frontend
- **High-risk actions require approval** — budget limits and human gates prevent runaway costs
- **Full audit trail** — every event is timestamped, tenant-scoped, and persisted

---

## 🎭 Agent Roster — 38 Agents

```mermaid
graph LR
    subgraph ORCH["🧠 Orchestrators"]
        O1["🎯 Commander"]
        O2["📋 Planner"]
        O3["🔀 Router"]
        O4["✅ Verifier"]
        O5["🛡️ Guardrail"]
        O6["⚠️ Approval"]
    end

    subgraph EXEC["💼 Executive Suite"]
        E1["🎯 Strategist\n(CEO)"]
        E2["🏗️ Technical\n(CTO)"]
        E3["💰 Finance\n(CFO)"]
        E4["📣 Marketing\n(CMO)"]
        E5["👔 HR"]
        E6["💻 Coder"]
        E7["🎨 Designer"]
        E8["🚀 Growth"]
    end

    subgraph VIBE["⚡ Vibe Coding — NEW"]
        V1["🏛️ App\nArchitect"]
        V2["⚡ Code\nGenerator"]
        V3["🔧 Auto-\nDebugger"]
        V4["🚀 Deployer"]
        V5["📸 Screenshot\nto Code"]
    end

    subgraph OPS["🏢 Operations"]
        P1["✏️ Content"]
        P2["📈 SEO"]
        P3["📰 PR"]
        P4["⚖️ Legal"]
        P5["🤝 Success"]
        P6["📉 Analytics"]
        P7["🗺️ Product"]
        P8["📌 Project"]
    end

    subgraph CORE["⚙️ Core Workers"]
        W1["📧 Email"]
        W2["📅 Calendar"]
        W3["👤 CRM"]
        W4["📄 Document"]
        W5["📊 Spreadsheet"]
        W6["🌐 Browser"]
        W7["🔍 Research"]
        W8["🧠 Knowledge"]
        W9["🎧 Support"]
        W10["⚙️ Ops"]
        W11["🎤 Voice"]
    end

    style ORCH fill:#1a0a2e,stroke:#c084fc,color:#e6edf3
    style EXEC fill:#0a1a15,stroke:#34d399,color:#e6edf3
    style VIBE fill:#1a150a,stroke:#fbbf24,color:#e6edf3
    style OPS fill:#0d1117,stroke:#38bdf8,color:#e6edf3
    style CORE fill:#0d1117,stroke:#fb923c,color:#e6edf3
```

<div align="center">

| Layer | Agents | Purpose |
|:------|:------:|:--------|
| **🧠 Orchestrators** | 6 | Parse goals, build DAGs, route tasks, verify quality, enforce guardrails |
| **💼 Executive Suite** | 8 | CEO/CTO/CFO/CMO-level strategic decisions and specialized expertise |
| **⚡ Vibe Coding** | 5 | Full-stack app generation — architecture, code, debug, deploy, vision |
| **🏢 Operations** | 8 | Content, SEO, PR, Legal, Analytics, Product, Project management |
| **⚙️ Core Workers** | 11 | Email, Calendar, CRM, Browser, Research, Voice, and infrastructure tools |

</div>

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
| `WORKER_BROWSER` | BrowserAgent | browser_navigate, browser_extract, browser_fill_form, browser_screenshot + 23 more |
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
| `WORKER_APP_DEPLOYER` | AppDeployerAgent | Vercel deployment via LLM tool calls (experimental — requires Vercel API token) |
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

### Landing Page — Hero
![JAK Swarm Hero](docs/screenshots/01-hero.png)

### Agent Network — 38 Agents in 5 Layers
![Agent Network](docs/screenshots/02-agents.png)

### Workflow — From Command to Result in Seconds
![Workflow](docs/screenshots/03-workflow.png)

### Pricing — Free / Builder ($29) / Pro ($99) / Team ($249)
![Pricing](docs/screenshots/04-pricing.png)

### Vibe Coding — Build Apps with AI
> 5-step pipeline: Describe → Architect → Generate → Debug → Preview
> Builder IDE with Monaco editor, file tree, chat panel, and live preview

### Verification Engine — Verify Before You Act
> Email threat detection, document verification, transaction risk analysis,
> identity verification, cross-evidence correlation with 4-layer escalation

### Onboarding Wizard — 4-Step Setup
![Onboarding](docs/screenshots/07-onboarding.png)

### Login & Registration
| Login | Registration |
|:-----:|:------------:|
| ![Login](docs/screenshots/05-login.png) | ![Register](docs/screenshots/06-register.png) |

---

## ⚡ Vibe Coding — AI App Builder

<div align="center">

**Describe an app in plain English. Watch 5 AI agents architect, generate, debug, and deploy it — as a single durable workflow with auto-repair and diff-aware checkpoints.**

*Think Emergent.sh / Lovable / Bolt.new, but with operator-grade durability — cross-instance reclaim, risk-stratified approvals, structural diff on every stage, diff-aware revert (click + confirm) to any checkpoint.*

</div>

### What makes this different

- **Durable workflow**, not chat: the Vibe Coder chain runs through the queue with `workflowKind: 'vibe-coder'`. A worker can die mid-run and another instance reclaims the job.
- **3-layer build verification**: heuristic checker catches truncation + placeholder leaks in ~1ms → TypeScript compiler API catches real syntax/type errors in-memory in sub-second → optional Docker-backed `next build` provides the real production pre-flight. Each layer fails fast and passes the earliest actionable error to the debugger.
- **Auto-repair loop**: up to 3 debug retries per workflow, with fingerprint-based loop detection to stop the same fix from being tried repeatedly.
- **Checkpoint-revert**: every stage (generator, debugger-retry N, deployer) auto-snapshots the project with a structural diff (+added ~modified -deleted) persisted to `project_versions.diffJson`. Restore creates a new rollback version — restores are themselves reversible.
- **Subscription-tier gating**: free-tier runs route through cheaper models; paid routes unlock Tier 3 (Opus, GPT-4o) for the Architect / Technical / Strategist stages.

### Pipeline Architecture

```mermaid
flowchart TD
    subgraph INPUT["💬 User Input"]
        A["📝 Text Description"]
        B["📸 Screenshot Upload"]
    end

    subgraph VISION["👁️ Vision Layer — Optional"]
        C["📸 Screenshot-to-Code Agent\n• Analyze layout, colors, typography\n• Extract component boundaries\n• Generate design tokens"]
    end

    subgraph ARCHITECT["🏛️ Architecture Layer — Tier 3"]
        D["🏛️ App Architect Agent\n• File tree & component hierarchy\n• Prisma data models & relations\n• API endpoint contracts\n• Auth strategy & env vars\n• Dependency resolution"]
    end

    subgraph GENERATE["⚡ Generation Layer — Tier 2"]
        direction LR
        E["📄 Pages\nNext.js App Router\nServer Components"]
        F["🧩 Components\nReact + Tailwind\nshadcn/ui patterns"]
        G["🔌 API Routes\nRoute Handlers\nZod validation"]
        H["🗃️ Database\nPrisma schema\nMigrations"]
    end

    subgraph SANDBOX["🏗️ Build Layer"]
        I["📦 npm install\nDependency resolution"]
        J["🔨 next build\nTypeScript compilation"]
        K{"✅ Build\nPassed?"}
    end

    subgraph DEBUG["🔧 Debug Loop — Tier 1"]
        L["🔧 Auto-Debugger Agent\n• Parse error logs\n• Identify root cause\n• Apply surgical fix\n• Max 3 retries"]
    end

    subgraph DELIVER["🚀 Delivery Layer"]
        M["👁️ Live Preview\nIframe + Hot Reload"]
        N["💬 Iterate via Chat\nModify only affected files"]
        O["🚀 Deploy to Vercel\n(Planned — experimental)"]
        P["🔀 GitHub Sync\nPush/pull • CI/CD"]
    end

    A --> D
    B --> C --> D
    D --> E & F & G & H
    E & F & G & H --> I --> J --> K
    K -->|"✅ Yes"| M
    K -->|"❌ No"| L --> J
    M --> N --> D
    M --> O
    M --> P

    style INPUT fill:#0d1117,stroke:#34d399,color:#e6edf3
    style VISION fill:#0d1117,stroke:#f472b6,color:#e6edf3
    style ARCHITECT fill:#0d1117,stroke:#fbbf24,color:#e6edf3
    style GENERATE fill:#0d1117,stroke:#38bdf8,color:#e6edf3
    style SANDBOX fill:#0d1117,stroke:#c084fc,color:#e6edf3
    style DEBUG fill:#0d1117,stroke:#fb923c,color:#e6edf3
    style DELIVER fill:#0d1117,stroke:#34d399,color:#e6edf3
```

### Builder IDE

<div align="center">

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ← Back   My Task Manager    v3          [GitHub]  [Deploy]     Ready   │
├────────────┬─────────────────────────────────────┬───────────────────────┤
│            │                                     │                       │
│  📁 Files  │  [Code]  [Preview]                  │  💬 Chat              │
│            │                                     │                       │
│  ▸ src/    │  ┌─────────────────────────────┐    │  You: "Add dark mode  │
│    ▸ app/  │  │  // Monaco Editor           │    │   and a sidebar"      │
│      page  │  │  export default function    │    │                       │
│      layou │  │    Home() {                 │    │  JAK: Modified 3 files│
│    ▸ compo │  │    return (                 │    │   ✓ layout.tsx        │
│    ▸ lib/  │  │      <main>                 │    │   ✓ Sidebar.tsx       │
│  package.j │  │        <h1>Task Manager</h1>│    │   ✓ globals.css       │
│  tsconfig  │  │      </main>                │    │                       │
│  tailwind  │  │    );                       │    │  [📸 Screenshot]      │
│            │  │  }                          │    │  [Type a message...]  │
│  📋 v3     │  └─────────────────────────────┘    │  [Send ▶]             │
│  📋 v2     │                                     │                       │
│  📋 v1     │                                     │                       │
├────────────┴─────────────────────────────────────┴───────────────────────┤
│  ⏳ Analyzing ✅ → Generating ✅ → Building ⏳ → Preview ○     [72%]    │
└──────────────────────────────────────────────────────────────────────────┘
```

</div>

### Feature Comparison

<div align="center">

| Feature | JAK Swarm | Emergent.sh | Lovable | Bolt.new |
|:--------|:---------:|:-----------:|:-------:|:--------:|
| **Full-stack generation** | ✅ | ✅ | ✅ | ✅ |
| **Multi-agent pipeline** | ✅ 5 agents | ✅ | ❌ | ❌ |
| **Screenshot-to-code** | ✅ | ✅ | ❌ | ❌ |
| **Self-debugging loop** | ✅ 3 retries | ✅ | ❌ | ❌ |
| **3-tier cost routing** | ✅ | ❌ | ❌ | ❌ |
| **Version rollback** | ✅ | ✅ | ✅ | ❌ |
| **Monaco editor** | ✅ | ❌ | ✅ | ✅ |
| **Vercel deploy** | 🚧 Planned | ❌ Custom | ✅ | ✅ |
| **GitHub sync** | ✅ | ✅ | ✅ | ✅ |
| **Open source** | ✅ MIT | ❌ | ❌ | ❌ |
| **122 classified tools** (CI-enforced maturity) | ✅ | ❌ | ❌ | ❌ |
| **Voice input** | ✅ | ❌ | ❌ | ❌ |
| **Multi-tenant SaaS** | ✅ | ❌ | ❌ | ❌ |
| **Industry compliance** | ✅ 13 packs | ❌ | ❌ | ❌ |

</div>

### Cost Per App

<div align="center">

| Stage | LLM Tier | Model | Est. Cost |
|:------|:--------:|:------|:---------:|
| 📸 Screenshot analysis | Tier 3 | GPT-4o Vision | $0.10-0.20 |
| 🏛️ Architecture | Tier 3 | Claude Sonnet / GPT-4o | $0.20-0.50 |
| ⚡ Code generation | Tier 2 | Gemini Flash / GPT-4o-mini | $0.15-0.40 |
| 🔧 Debug iterations | Tier 1 | DeepSeek / Ollama | $0.02-0.05/iter |
| 🚀 Deploy | Tier 1 | Tool calls only | $0.01-0.02 |
| | | **Total (new app)** | **$0.50-2.00** |
| | | **Per iteration** | **$0.05-0.30** |

*Estimated costs based on model pricing. Actual costs vary by app complexity, model selection, and debug iterations.*

</div>

### Templates

| Template | Stack | Includes |
|:---------|:------|:---------|
| `nextjs-app` | Next.js 15 + Tailwind | App Router, TypeScript strict, responsive layout |
| `nextjs-saas` | Next.js 15 + Prisma + Stripe | Auth, database, payments, dashboard scaffold |
| `react-spa` | React + Vite + Router | Single-page app, client-side routing, Tailwind |

---

## 🛡️ Audit & Compliance Agent Pack

<div align="center">

**Run a real SOC 2 / HIPAA / ISO 27001 audit engagement end-to-end. Plan controls, auto-map evidence, run LLM-driven control tests, generate per-control workpaper PDFs gated by reviewer approval, produce a binding HMAC-signed final evidence pack, and invite a third-party auditor through a secure portal — verifiable byte-for-byte.**

*Built on the same durable workflow + lifecycle event + RBAC + signed-bundle foundation that powers everything else in JAK.*

</div>

### External Auditor Portal (Sprint 2.6)

Third-party auditors get a dedicated portal scoped to the engagements they're invited to. They never see other tenant data and never see audit runs they aren't on.

| Surface | Real-and-tested |
|---|---|
| Invite flow | Admin (`REVIEWER+`) creates an invite via `POST /audit/runs/:id/auditors/invite`. Cleartext token is returned **once**; only the SHA-256 hash is persisted (`crypto.randomBytes(32)` → 64-char hex → `SHA-256` → hex). |
| Acceptance | Auditor visits `/auditor/accept/[token]`. Token is hashed + verified with `crypto.timingSafeEqual`. On accept: an `EXTERNAL_AUDITOR` user row is created (no password — invite-token is the auth) and an `ExternalAuditorEngagement` row grants per-audit-run scope. |
| Engagement isolation | Every auditor route runs through `requireAuditorEngagement` middleware: verifies role + active engagement (not expired, not revoked) for the `:auditRunId` path param. Cross-engagement access returns 403. |
| Audit trail | Every auditor action (view, comment, approve/reject/request-changes) writes an `ExternalAuditorAction` row. The decide endpoint logs INTENT before mutating so failed mutations leave a forensic trace. |
| Revocation | `POST /audit/runs/:id/auditors/:inviteId/revoke` flips the invite to `REVOKED` AND sets `accessRevokedAt` on the engagement in a single transaction; subsequent JWTs cannot pass the engagement check. |
| Tests | 11 unit tests (`tests/unit/services/external-auditor.test.ts`) cover token format, cleartext-never-persisted, expired/revoked rejection, cross-tenant isolation. |
| Security audit | [`qa/external-auditor-portal-security-audit.md`](qa/external-auditor-portal-security-audit.md) records the threat model + per-requirement implementation status. |

### Frameworks shipped (167 controls total)

| Framework | Slug | Issuer | Version | Controls |
|---|---|---|---|---|
| SOC 2 Type 2 | `soc2-type2` | AICPA | 2017 | 48 |
| HIPAA Security Rule | `hipaa-security` | HHS | 2013 | 37 |
| ISO/IEC 27001:2022 | `iso27001-2022` | ISO/IEC | 2022 | 82 |

Each control is real-seeded from the published standard. 10 implemented `autoRuleKey` rules map evidence (audit log rows, approvals, workflow artifacts, signed bundles, PII detections, guardrail events, tool blocks, …) onto controls that have automation; controls without a rule are clearly classified as human-mapped only.

### Engagement flow

```
User → POST /audit/runs                                  AuditRunService.create()
                                                         status = PLANNING
                                                         emit audit_run_started
       POST /audit/runs/:id/plan                         seed ControlTest rows
                                                         status = PLANNED
                                                         emit audit_plan_created
       POST /audit/runs/:id/auto-map                     ComplianceMapperService.runForTenant()
                                                         emit evidence_mapped
       POST /audit/runs/:id/test-controls                ControlTestService.runAll()
                                                         per control: emit control_test_started/_completed
                                                         on fail/exception: emit exception_found + auto-create AuditException
                                                         status = TESTING → REVIEWING
       POST /audit/runs/:id/workpapers/generate          WorkpaperService.generateAll()
                                                         per control: render real PDF (pdfkit)
                                                         persist as WorkflowArtifact, approvalState=REQUIRES_APPROVAL
                                                         emit workpaper_generated + reviewer_action_required
       POST /audit/runs/:id/workpapers/:wpId/decide      WorkpaperService.setReviewDecision()
                                                         propagates to ArtifactService.setApprovalState
                                                         all approved → status = READY_TO_PACK
       POST /audit/runs/:id/final-pack                   FinalAuditPackService.generate()
                                                         GATE: refuses if any workpaper unapproved
                                                         bundles workpapers + control matrix CSV +
                                                         exceptions JSON + executive summary PDF
                                                         signs via bundle-signing.service (HMAC-SHA256)
                                                         status = FINAL_PACK → COMPLETED
                                                         emit final_pack_generated + audit_run_completed
```

### What's shipped (real, working, typechecked, e2e-tested)

| Capability | File |
|---|---|
| 4 Prisma models (`AuditRun`, `ControlTest`, `AuditException`, `AuditWorkpaper`) + migration 15 | [packages/db/prisma/migrations/15_audit_runs/migration.sql](packages/db/prisma/migrations/15_audit_runs/migration.sql) |
| State machine with `assertAuditTransition()` refusing illegal jumps | [apps/api/src/services/audit/audit-run.service.ts](apps/api/src/services/audit/audit-run.service.ts) |
| LLM-driven control test evaluation (deterministic fallback when no key) | [apps/api/src/services/audit/control-test.service.ts](apps/api/src/services/audit/control-test.service.ts) |
| Auto-create exceptions on test failure + reviewer lifecycle | [apps/api/src/services/audit/audit-exception.service.ts](apps/api/src/services/audit/audit-exception.service.ts) |
| Real PDF workpapers via existing `exportPdf` (pdfkit) | [apps/api/src/services/audit/workpaper.service.ts](apps/api/src/services/audit/workpaper.service.ts) |
| HMAC-SHA256 signed final pack with workpaper-approval gate | [apps/api/src/services/audit/final-audit-pack.service.ts](apps/api/src/services/audit/final-audit-pack.service.ts) |
| 14 REST endpoints under `/audit/runs/*`, REVIEWER+ RBAC on writes | [apps/api/src/routes/audit-runs.routes.ts](apps/api/src/routes/audit-runs.routes.ts) |
| 13 audit-specific lifecycle events on the `audit_run:{id}` SSE channel | (see [docs/agent-run-cockpit.md](docs/agent-run-cockpit.md)) |
| `/audit/runs` workspace + `/audit/runs/:id` detail UI (control matrix + workpaper + exception panels) | [apps/web/src/app/(dashboard)/audit/runs/page.tsx](apps/web/src/app/(dashboard)/audit/runs/page.tsx) |
| 11-assertion end-to-end test: create → plan → test → workpaper → approve → signed pack → signature verify | [tests/integration/audit-run-e2e.test.ts](tests/integration/audit-run-e2e.test.ts) |

### Reviewer gates (enforced at every layer)

1. **Test confidence < 0.7** → status `reviewer_required` (won't auto-pass)
2. **Every workpaper PDF** persists with `approvalState='REQUIRES_APPROVAL'` — download blocked, run can't advance until approved
3. **Final-pack signing** refuses if ANY workpaper is unapproved (`FinalPackGateError`)
4. **Exception lifecycle** runs through its own state machine — `IllegalAuditExceptionTransitionError` blocks bad transitions

### Honesty notes

- LLM evaluation is real (`OpenAIRuntime.respondStructured` with strict json_schema). When `OPENAI_API_KEY` is absent, the service falls back to a deterministic coverage rule and writes `"deterministic coverage rule (no LLM key configured)"` as the rationale so reviewers see the difference. Never silent-faked.
- Lifecycle events carry an `agentRole` field (`AUDIT_COMMANDER`, `CONTROL_TEST_AGENT`, `EXCEPTION_FINDER`, `WORKPAPER_WRITER`, `FINAL_AUDIT_PACK_AGENT`, `COMPLIANCE_MAPPER`). The work itself is performed by the named service. We did NOT create 9 fake `BaseAgent` placeholder classes — that's a documented Phase 2 optimization in [qa/audit-compliance-readiness-audit.md](qa/audit-compliance-readiness-audit.md).
- Things explicitly deferred (and named, not faked) — external auditor portal (~2 weeks), real LangGraph nodes (~2 weeks), DOCX/XLSX/image content parsing for evidence (~3 days), live SSE on the audit detail page (~1 day; currently 15s SWR polling). Full deferral table in [qa/audit-pack-shipped-report.md](qa/audit-pack-shipped-report.md).

### Reference docs

| Doc | Purpose |
|---|---|
| [docs/audit-compliance-agent-pack.md](docs/audit-compliance-agent-pack.md) | Product overview |
| [docs/audit-framework-library.md](docs/audit-framework-library.md) | Per-framework + per-control reference |
| [docs/audit-workpapers.md](docs/audit-workpapers.md) | Workpaper generation + approval flow |
| [docs/audit-human-review.md](docs/audit-human-review.md) | 4 human-in-loop surfaces + RBAC matrix |
| [docs/audit-api.md](docs/audit-api.md) | Endpoint reference + error codes + SSE channel |
| [docs/agent-run-cockpit.md](docs/agent-run-cockpit.md) | Cockpit audit event vocabulary |
| [qa/audit-pack-shipped-report.md](qa/audit-pack-shipped-report.md) | 26-point shipped + deferred report |

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

# Required for the Audit & Compliance final-pack signing
EVIDENCE_SIGNING_SECRET=$(openssl rand -base64 48)
```

### 3. Setup Database

```bash
pnpm --filter @jak-swarm/db db:migrate
pnpm --filter @jak-swarm/db db:seed         # optional: seed sample data
pnpm seed:compliance                        # seeds 167 SOC 2 / HIPAA / ISO 27001 controls
pnpm seed:audit-demo                        # optional: seeds a demo audit run for end-to-end exercise
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
| 🏠 **Home** | Mission control with activity feed, approvals, quick actions |
| 🏢 **Workspace** | Command center — text/voice input, DAG view, agent tracker |
| ⚡ **Builder** | Vibe Coding IDE — Monaco editor, chat, preview, deploy |
| 🐝 **Swarm** | Workflow inspector with agent timeline visualization |
| 🛡️ **Audit** | Audit & Compliance home — dashboard, audit log, reviewer queue, workflow trail, compliance frameworks (SOC 2 / HIPAA / ISO 27001), and **Audit Runs** workspace |
| 🛡️ **Audit Runs** | `/audit/runs` index + `/audit/runs/:id` engagement detail (control matrix · workpapers · exceptions · final pack) |
| 🔎 **Traces** | Full agent trace explorer with token/cost breakdown |
| 📊 **Analytics** | Usage metrics, cost tracking, agent performance charts |
| ⏰ **Schedules** | Cron-based recurring workflow management |
| 🔌 **Integrations** | MCP providers — HubSpot, Salesforce, Slack, GitHub + more |
| 🧩 **Skills** | Skill marketplace — browse, install, create custom skills |
| 🧠 **Knowledge** | Memory store — facts, preferences, policies, learnings |
| ⚙️ **Settings** | LLM provider config, approval thresholds |
| 👑 **Admin** | Tenant management, users, API keys, tool toggles |

---

## 🔧 Tool Inventory (122 Registered)

| Category | Count | Tools | Status |
|:---------|:-----:|:------|:------:|
| **Email** | 10 | read_email, draft_email, send_email, gmail_read_inbox, gmail_send_email, personalize_email, schedule_email, track_email_engagement, analyze_engagement, create_email_sequence | ✅ Real (Gmail IMAP/SMTP) |
| **Calendar** | 3 | list_calendar_events, create_calendar_event, find_availability | ✅ Real (CalDAV) |
| **CRM** | 14 | lookup_crm_contact, update_crm_record, search_deals, enrich_contact, enrich_company, verify_email_deliverability, score_lead, deduplicate_contacts, find_decision_makers, monitor_company_signals, predict_churn, generate_winback + more | 🔌 Pluggable adapter |
| **Browser** | 30 | navigate, extract, fill_form, click, screenshot, get_text, type_text, press_key, mouse_click, scroll, analyze_page, manage_cookies, manage_tabs, hover, select, upload, evaluate_js, wait_for, pdf_export, post_to_twitter, post_to_linkedin, post_to_reddit + more | ✅ Real (Playwright) |
| **Document** | 16 | summarize_document, extract_document_data, pdf_extract_text, pdf_analyze, generate_report, file_read, file_write, list_directory, generate_image + more | ✅ Real (pdf-parse + DALL-E) |
| **Research** | 31 | web_search, web_fetch, classify_text, audit_seo, research_keywords, analyze_serp, monitor_rankings, code_execute, discover_posting_platforms + more | ✅ Real (web) |
| **Spreadsheet** | 4 | parse_spreadsheet, compute_statistics, generate_report, export_csv | ✅ Built-in |
| **Knowledge** | 9 | search_knowledge, memory_store, memory_retrieve, ingest_document, compile_executive_summary + more | ✅ Real (DB-backed) |
| **Webhook** | 2 | send_webhook, deploy_to_vercel | ✅ Built-in |
| **MCP (external)** | Dynamic | Slack, GitHub, Notion + 18 more loaded at runtime | ✅ Real (MCP servers) |

**Total: 122 registered built-in tools across Email, Calendar, Browser, Document, Spreadsheet, CRM, Research, Knowledge, and Webhook categories. Additional provider tools can be loaded dynamically via MCP integrations.**

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
| Pre-built agents | **38** | 0 | 0 | 1 |
| Tools | **122** | 50+ | Custom | ~10 |
| Built-in UI | **13 pages** | — | LangSmith | IDE |
| Multi-tenant | ✅ | Enterprise | — | — |
| Scheduling | ✅ | ✅ | ✅ | — |
| Browser control | **30 tools** | Via plugin | Via plugin | — |
| Vision/PDF | ✅ | v1.13+ | Via model | Screenshots |
| Self-correction | **4 layers** (heuristic) | Limited | Manual | Limited |
| **SOC 2 / HIPAA / ISO 27001 audit pack** (167 controls + signed evidence bundles) | ✅ | ❌ | ❌ | ❌ |
| Open source | ✅ MIT | ✅ MIT | ✅ MIT | — $20/mo |
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

## 🛡️ 4-Layer Hallucination Detection

| Layer | Detection | Action |
|:-----:|:----------|:-------|
| 1 | **Invented statistics** | Regex patterns catch fabricated percentages, dollar amounts, specific counts |
| 2 | **Fabricated sources** | Pattern matching identifies fake citations and academic references |
| 3 | **Overconfidence** | Flags absolute claims ("always", "never", "guaranteed") without evidence |
| 4 | **Impossible claims** | Rule-based detection of logically inconsistent statements |

> Each layer returns a grounding score (0.0-1.0) and lists specific ungrounded claims. Detection is heuristic/regex-based, not AI-powered.

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
| Per-node timeout | 122s | `NODE_TIMEOUT_MS` |
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
| **Frontend** | Next.js 16, React 19, Tailwind CSS |
| **DAG Visualization** | React Flow |
| **Database** | PostgreSQL + Prisma ORM |
| **Durable Workflows** | PostgreSQL state persistence (Temporal package included, API wiring in progress) |
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
│   │       ├── routes/         # 16 route modules (workflows, approvals, audit, audit-runs, compliance, artifacts, bundles, exports, integrations, schedules, memory, tools, traces, voice, slack, ...)
│   │       ├── services/
│   │       │   ├── audit/       # AuditRun · ControlTest · Exception · Workpaper · FinalPack
│   │       │   ├── compliance/  # Mapper · Attestation · ManualEvidence · Scheduler · auto-mapping rules
│   │       │   ├── exporters/   # JSON · CSV · XLSX · PDF · DOCX
│   │       │   └── ...          # artifact, bundle, bundle-signing, db-state-store, swarm-execution, workflow, etc.
│   │       ├── middleware/      # Auth, RBAC, rate limiting
│   │       ├── boot/           # Config validation + environment diagnostics
│   │       └── plugins/        # Fastify plugins
│   └── web/                    # Next.js 16 dashboard (port 3000)
│       └── src/app/(dashboard)/
│           ├── home/           # Mission control
│           ├── audit/          # Audit & Compliance home (5 tabs: dashboard, log, queue, trail, compliance)
│           │   └── runs/       # /audit/runs index + /audit/runs/[id] detail (control matrix · workpapers · exceptions · final pack)
│           ├── swarm/          # Real-time DAG execution view
│           ├── traces/         # Agent trace explorer
│           ├── analytics/      # Usage & cost metrics
│           ├── schedules/      # Cron workflow manager
│           ├── integrations/   # MCP provider connections
│           ├── knowledge/      # Knowledge base
│           ├── workspace/      # Team settings
│           ├── settings/       # LLM & approval config
│           └── admin/          # Tenant management + /admin/platform (SYSTEM_ADMIN)
├── packages/
│   ├── agents/                 # 38 agent implementations
│   │   └── src/
│   │       ├── base/           # BaseAgent, LLM providers, anti-hallucination, memory injection
│   │       ├── roles/          # 6 orchestrator agents
│   │       └── workers/        # 32 worker agents
│   ├── tools/                  # 122 tool implementations
│   │   └── src/
│   │       ├── registry/       # Singleton ToolRegistry
│   │       ├── builtin/        # Built-in + sandbox tools
│   │       ├── adapters/       # Email, Calendar, CRM, Browser, Memory, Sandbox
│   │       └── mcp/            # MCP client, bridge, provider configs
│   ├── swarm/                  # Orchestration engine
│   │   └── src/
│   │       ├── graph/          # DAG builder, node handlers, task scheduler
│   │       ├── runner/         # SwarmRunner execution loop
│   │       ├── state/          # Immutable state machine
│   │       ├── memory/         # Memory extractor + query services
│   │       └── context/        # Context summarization engine
│   ├── client/                 # @jak-swarm/client TypeScript SDK
│   │   └── src/
│   │       └── index.ts        # HttpClient, SSE streaming, typed API methods
│   ├── shared/                 # Shared types & enums
│   │   └── src/
│   │       └── skills/         # SKILL.md parser + loader
│   ├── db/                     # Prisma schema, migrations, seed
│   ├── workflows/              # Temporal workflow definitions
│   ├── security/               # Audit logging, RBAC, guardrails, tool risk
│   ├── voice/                  # Voice pipeline (WebRTC, STT, TTS)
│   ├── verification/           # Email, document, transaction, identity verification
│   └── industry-packs/         # 13 industry-specific agent configurations
├── tests/
│   ├── unit/                   # Unit tests
│   ├── integration/            # Integration tests
│   └── e2e/                    # End-to-end tests
├── docker/                     # Docker Compose for Postgres, Redis, Temporal
├── scripts/                    # Dev scripts + doctor.ps1, setup.ps1
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
| GET | `/traces/workflow/:workflowId/timeline` | JWT | Workflow timeline with per-node start/end/cost breakdown |

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
| POST | `/voice/sessions/:sessionId/trigger-workflow` | JWT | Convert voice transcript into a workflow execution |

</details>

<details>
<summary><b>💬 Slack</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| POST | `/slack/events` | HMAC-SHA256 | Slack Events API webhook (url_verification + event_callback) |
| POST | `/slack/interactivity` | HMAC-SHA256 | Slack interactive component payloads |

Slack routes verify `X-Slack-Signature` headers against `SLACK_SIGNING_SECRET`. Events trigger authenticated workflows with thread-reply results. Idempotent event handling prevents duplicate workflow creation on Slack retries.

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

<details>
<summary><b>🛡️ Audit & Compliance — v0 (audit log + reviewer surfaces)</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/audit/log` | JWT | Paginated AuditLog with filters (action / resource / dates / search) |
| GET | `/audit/workflows/:id/trail` | JWT | Chronological event stream for one workflow |
| GET | `/audit/reviewer-queue` | JWT + Reviewer | Pending workflow approvals + pending artifact downloads |
| GET | `/audit/dashboard` | JWT + Reviewer | High-level audit metrics |

</details>

<details>
<summary><b>🛡️ Compliance — v1 (control framework mapping)</b></summary>

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

</details>

<details>
<summary><b>🛡️ Audit Runs — v2 (full engagement workflow)</b></summary>

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

Errors include `409 ILLEGAL_TRANSITION` (state machine refused), `409 FINAL_PACK_GATE` (workpapers unapproved), `503 AUDIT_SCHEMA_UNAVAILABLE` (apply migration 15 with `pnpm db:migrate:deploy`), `503 BUNDLE_SIGNING_UNAVAILABLE` (set `EVIDENCE_SIGNING_SECRET`).

</details>

<details>
<summary><b>📦 Artifacts + Bundles + Exports</b></summary>

| Method | Endpoint | Auth | Description |
|:------:|:---------|:----:|:------------|
| GET | `/artifacts/:id` | JWT | Get artifact metadata (tenant-scoped) |
| GET | `/artifacts/:id/download` | JWT | Signed download URL (gated by `approvalState`) |
| POST | `/artifacts/:id/approve` | JWT + Reviewer | Approve an artifact for download |
| POST | `/artifacts/:id/reject` | JWT + Reviewer | Reject artifact (download permanently blocked) |
| POST | `/exports` | JWT | Create an export (json/csv/xlsx/pdf/docx) |
| POST | `/bundles` | JWT + Reviewer | Generate HMAC-signed evidence bundle for a workflow |
| GET | `/bundles/:id/verify` | JWT | Verify bundle signature + re-hash referenced artifacts |

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
| `EVIDENCE_SIGNING_SECRET` | Yes (for audit pack) | -- | 32+ byte random secret for HMAC-SHA256 signing of audit evidence bundles. Generate with `openssl rand -base64 48`. Without it the final audit pack route returns `503 BUNDLE_SIGNING_UNAVAILABLE`. Intentionally separate from `AUTH_SECRET` so the two can be rotated independently. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (for storage) | -- | Supabase project URL — required by `ArtifactService` for storing workpaper PDF / final-pack bytes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (for storage) | -- | Supabase service-role key — used by `ArtifactService` to upload to the `tenant-artifacts` bucket |
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
| `SLACK_SIGNING_SECRET` | No | -- | Slack app signing secret for webhook verification |
| `SLACK_CLIENT_ID` | No | -- | Slack OAuth client ID |
| `SLACK_CLIENT_SECRET` | No | -- | Slack OAuth client secret |
| `TEMPORAL_ADDRESS` | No | `localhost:7233` | Temporal server (infrastructure-ready, API execution path not yet wired) |
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

JAK Swarm is staging-ready and production-capable with caveats. The architecture includes multi-tenant isolation, RBAC, credit-based cost controls, PostgreSQL state persistence, queue-backed durable execution with atomic job claiming, replay-safety classification, and idempotency key support. However, it is v0.1.0 — workflow durability relies on DB-backed checkpoints (not a dedicated workflow engine like Temporal), and in-flight workflows survive API restarts via recovery but not mid-node crashes. Test thoroughly before production deployment.

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

<details>
<summary><b>Is the Audit & Compliance pack production-ready?</b></summary>

The audit pack is functionally complete and end-to-end tested ([tests/integration/audit-run-e2e.test.ts](tests/integration/audit-run-e2e.test.ts) — 11 assertions covering create → plan → test → workpaper → approve → signed pack → signature verify, all green). All 23 workspace packages typecheck clean.

To bring it into production:

1. Apply migration 15 against the production database: `pnpm db:migrate:deploy`
2. Verify `EVIDENCE_SIGNING_SECRET` is set (required for final-pack signing — `openssl rand -base64 48`)
3. Verify `OPENAI_API_KEY` is set (optional — without it, control test evaluation falls back to a deterministic coverage rule with the rationale `"deterministic coverage rule (no LLM key configured)"` so reviewers see the difference)
4. Smoke-test by creating an audit run via `POST /audit/runs` for an existing tenant

What's deferred and named honestly (not faked) — external auditor portal (~2 weeks), DOCX/XLSX/image content parsing for evidence (~3 days), live SSE on the audit detail page (~1 day; currently 15s SWR polling). Full table in [qa/audit-pack-shipped-report.md](qa/audit-pack-shipped-report.md).

</details>

<details>
<summary><b>What audit-related lifecycle events does the cockpit show?</b></summary>

13 audit-specific events on the `audit_run:{id}` SSE channel: `audit_run_started`, `audit_plan_created`, `evidence_mapped`, `control_test_started`, `control_test_completed`, `exception_found`, `workpaper_generated`, `reviewer_action_required`, `final_pack_started`, `final_pack_generated`, `audit_run_completed`, `audit_run_failed`, `audit_run_cancelled`. Every event carries `agentRole` (`AUDIT_COMMANDER`, `CONTROL_TEST_AGENT`, `EXCEPTION_FINDER`, `WORKPAPER_WRITER`, `FINAL_AUDIT_PACK_AGENT`, `COMPLIANCE_MAPPER`) so the cockpit attributes each step to the responsible role. Full reference in [docs/agent-run-cockpit.md](docs/agent-run-cockpit.md).

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
