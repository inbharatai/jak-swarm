<div align="center">

# 🐝 JAK Swarm

### Two engines — a Company Brain and a Hyperagent — that turn company evidence into approved, self-healing agent work.

[![JAK Shield](https://img.shields.io/badge/JAK_Shield-Defensive_Only-ef4444?style=for-the-badge&logo=shieldsdotio&logoColor=white)](docs/jak-shield-manifest.md)
[![Agents](https://img.shields.io/badge/AI_Agents-38-blue?style=for-the-badge&logo=robot&logoColor=white)](#-agent-roster--38-agents)
[![Tools](https://img.shields.io/badge/Classified_Tools-122-green?style=for-the-badge&logo=playwright&logoColor=white)](#-tool-inventory-122-registered)
[![Connectors](https://img.shields.io/badge/Connectors-22-blue?style=for-the-badge&logo=zapier&logoColor=white)](#connectors--honest-maturity)
[![Audit Pack](https://img.shields.io/badge/Audit_Pack-SOC2_%7C_HIPAA_%7C_ISO27001-orange?style=for-the-badge&logo=shieldsdotio&logoColor=white)](docs/audit-compliance-agent-pack.md)
[![Release](https://img.shields.io/badge/Release-Beta_0.1.0--beta.0-0ea5e9?style=for-the-badge&logo=semver&logoColor=white)](docs/beta-release.md)
[![Tests](https://img.shields.io/badge/Tests-3157_blocking_CI-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](#-tech-stack)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?style=for-the-badge&logo=typescript&logoColor=white)](#-tech-stack)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

**JAK turns scattered company context into approved agent work. JAK Shield makes that work safe.**

Give it a goal in plain English. JAK decomposes, routes, executes, and verifies — in real time.

</div>

<nav align="center">

**[📖 Documentation](#-documentation)** · **[⚖️ License](#-license)** · **[🔐 Security](SECURITY.md)** · **[🏗️ Architecture](ARCHITECTURE.md)** · **[🤖 Agents](AGENTS.md)** · **[❓ FAQ](#-common-questions)** · **[🚀 Quick Start](#-quick-start)**

</nav>

---

## What JAK Swarm is

JAK Swarm is a working beta build (0.1.0-beta.0) of a Company Brain + Hyperagent operating layer for product and engineering teams. It is **not** a chatbot, a workflow DSL, or a generic agent framework. It is two engines sitting on top of a runtime of 38 specialist agents and 122 classified tools:

1. **Company Brain** — turns company artifacts into a cited evidence graph, detects execution drift, and generates agent-executable specs. This is the closed-loop Company OS foundation.
2. **Hyperagent** — a self-healing re-plan loop plus a governed self-learning half that repairs failed execution and promotes only measured, approved improvements.

Everything else — the 38 agents, 122 tools, 22 connectors, JAK Shield, the Google ADK/Gemini substrate — exists to carry those two engines safely into live work.

> **Blunt beta truth.** This is a working beta build, not a finished enterprise product. Company Brain has the data model, API routes, dashboard surface, deterministic drift detector, agent spec generator, approval decision route, and audit foundation. Only GitHub, Gmail, and Google Drive auto-sync on a 5-minute schedule; the other 19 of 22 connectors are callable as agent tools but ingest evidence on-demand/manually. Hyperagent's self-healing core is integration-proven, and the live runtime seam now harvests per-task failure classes + best-effort artifact ids (D1/D2 wired); the live LLM production canary remains the open stop (see the Hyperagent section). Enterprise SLA packaging, expanded observability, and the post-build production hardening roadmap remain open. API keys are required for external LLM providers (Gemini, OpenAI) — JAK does not bundle or provide free LLM API keys. See `docs/beta-release.md` for the full scope and go/no-go checklist.

---

## 🧠 Company Brain

The Company Brain is citation-first, not chatbot memory. It stores source-labeled artifacts, extracts entities and typed claims with citations, detects drift between intent and execution, and generates reviewer-approved specs — all tenant-scoped, all evidence-backed.

**The loop:**

```
artifacts → entities → typed claims → drift findings → agent-executable specs → approved work
```

| Stage | What it does | Honest status |
|---|---|---|
| Evidence ingestion | Source-labeled artifacts from docs, tickets, code, meetings, customer calls, Slack, Notion, GitHub, Gmail, Google Drive, or manual upload. Tenant-scoped, body-hashed. | GitHub, Gmail, Google Drive auto-sync (5-min) with **deep content ingestion** (Gmail full body + recipients + attachments; Drive content export + unbounded pagination; GitHub repositories + recent issues/PRs + event stream) and **atomic per-(tenant,provider) sync claims**; every ingest auto-enqueues Brain processing. Other 19/22 connectors ingest on-demand/manual. |
| Entity + claim extraction | Extracts decisions, tasks, risks, owners, deadlines, customer signals, code changes — each citing the artifact it came from. | Shipped. Per-predicate activation policy (high-stakes deadlines/owners/revenue demand stronger evidence); provenance gate drops source-less entities from agent context. |
| Retrieval | Multi-signal hybrid retrieval: alias + stable-identifier ILIKE + `ts_rank` FTS + 1-hop graph + temporal recency + entity-confidence + **vector cosine** (pgvector, separate embeddings table), fused into `compositeEntityScore`. **Vector channel is wired + integration-tested with a pluggable embedding provider (deterministic offline provider; real embeddings API provider wiring = roadmap).** Identity resolution is benchmarked: a deterministic stable-identifier resolver (merge by email/github/tenant-scoped external_id, never by name substring) scores F1=1.000 on a trap corpus (name collision, source scoping, cross-tenant, missed-merge) — CI-gated. |
| Drift detection | Deterministic comparator: customer pain without matching work, decisions that never became tasks, ungrounded execution, stale high-priority work. | Shipped. Not an LLM opinion. |
| Spec generation | Agent-executable spec with objective, scope, acceptance criteria, test plan, agent task plan, approval gates, cited evidence. | Shipped. Reviewer approval is a real backend decision route. |
| Product graph UI | `/company` + `/company/graph` — canonical entities, typed relationships, evidence-backed claims, conflicts, human review. | Shipped. Reachable from CommandPalette + ChatSidebar. |
| Brain MCP server | In-process `brain_*` tools (4) over a real MCP SDK server, tenant-safe (identity from `ToolExecutionContext`, never tool args). | Default-off behind `BRAIN_MCP_SERVER=1`. |
| Audit chain | Per-tenant HMAC-SHA256 row-chain, TOCTOU-closed under concurrency, fail-open-to-auditable when `EVIDENCE_SIGNING_SECRET` unset. Merge atomicity in one transaction. | Shipped. Testcontainer-proven; not yet exercised against managed Postgres. |

Code: `apps/api/src/services/company-brain/` · `apps/api/src/routes/company-operating-layer.routes.ts` · dashboard at `/company`.

---

## 🐝 Hyperagent

The Hyperagent is the self-healing + self-learning layer on top of the swarm runtime. It has two halves:

**Self-healing re-plan loop.** When the Verifier rejects output and the bounded-retry budget is exhausted, the Hyperagent kicks in: a **deterministic 20-class failure classifier** → **counterfactual fault isolation** → a **symbolic replanner** (an LLM may propose, only the symbolic layer may apply) → **autonomy-gated selective re-execution**. Destructive / permission / approval-timeout failures are never auto-retried.

**Governed self-learning.** A config-lifecycle gate (`DRAFT → PROPOSED → SHADOW → CANARY ramp → PROMOTED`, human-operated, no skip) wraps any autonomy-policy or repair-budget change. Promotion requires a measured mutual-information learning signal and a human `TENANT_ADMIN` approval. The agent may not self-promote.

| Component | Honest status |
|---|---|
| Pure-core spec executor (`spec-executor.ts`) | Shipped. Harvests artifacts with provenance; classifies failures; replans. Integration-proven with a deterministic stub `runPlan`. |
| Live runtime seam (`spec-executor-runtime.ts`) | **D1/D2 WIRED.** Harvests per-task failure classes (`failureClassByTask`) from `state.failureDiagnoses` and best-effort artifact ids workers emit into `taskResults` via a pure `harvestRunEvidence` helper, spread into `FinishedRun`. Integration-graph-proven at the live LangGraph level, **not production-proven.** Full worker artifact emission + the live LLM canary remain open. |
| `executeApprovedSpec` closed loop | REVIEWER-gated API route + service exist. The live LangGraph + LLM round-trip is env-blocked. |
| AuditLog per-tenant HMAC row-chain | Shipped. |
| `ShieldMcpClient` (Ed25519 signed decisions) | Live-instantiated behind `SHIELD_MCP_CANARY=1` — **observational canary: records signed decisions to the audit chain, does NOT gate execution.** |
| Self-learning in live graph | Wired behind `hyperAgentEnabled` (default **false**). 110 references; default workflows are byte-for-byte unchanged unless a tenant opts in. |

**What is still env-blocked, not fake-passed:** the live 12-step E2E + Cloud Run deploy gate that would prove measured learning impact in production; the live launch of `executeApprovedSpec` in prod; the Brain/Shield canaries against live traffic; audit-chain + merge atomicity against managed Postgres. The full wired-vs-pure-core breakdown is in `docs/hyperagent-current-state-audit.md`, and the executable canary runbook is `docs/production-canary-plan.md`.

Code: `packages/swarm/src/hyperagent/` · dashboard at `/hyperagent` (Control Centre: overview, runs, learnings, optimizations, experiments, governance, agent-fleet, autonomy, shield).

---

## 🛡️ JAK Shield — the trust gateway

JAK Shield is a separate MCP-native security gateway ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)) with a 10-stage decision pipeline. **Inside JAK Swarm today, the enforced gateway is the embedded local one** (`packages/security`): guardrails, RBAC, audit logging, PII redaction, tool-risk/approval gating via `LocalShieldGateway`, an Agent Governance Overlay (autonomy L0–L5 with a fixed human-only NEVER set), and the `ShieldMcpClient` observational canary above. The MCP network transport from JAK Swarm to the external Shield gateway is a roadmap item; the external Shield is replaceable through the `ShieldGateway` interface override.

The full 10-stage pipeline table and claim-to-code mapping: [`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md). Security policy: [`SECURITY.md`](SECURITY.md). JAK Shield is defensive-only — it does not support offensive hacking, malware generation, credential theft, phishing, or exploit generation.

---

## 🤖 Agent Roster — 38 Agents

38 AI Agents across four layers, routed through one operator-grade runtime with tier-based model execution.

| Layer | Count | Purpose |
|---|---|---|
| 🧠 Orchestrators | 6 | Parse goals, build DAGs, route tasks, verify quality, enforce guardrails |
| 💼 Executive | 8 | CEO/CTO/CFO/CMO-level strategic decisions and specialized expertise |
| ⚡ Vibe Coding | 5 | Full-stack app generation — architecture, code, debug, deploy, vision |
| 🏢 Operations | 8 | Content, SEO, PR, Legal, Analytics, Product, Project management |
| ⚙️ Core Workers | 11 | Email, Calendar, CRM, Browser, Research, Voice, infrastructure tools |

Per-tenant provider switching (Gemini or OpenAI) flows through `TenantMemory → SwarmExecutionService → SwarmRunner → SwarmState → AgentContext.llmProvider`. Full roster + input/output contracts: [`AGENTS.md`](AGENTS.md).

---

## 🔧 Tool Inventory (122 Registered)

122 Classified Tools, each carrying an honest CI-enforced maturity label (`real` / `heuristic` / `llm_passthrough` / `config_dependent` / `experimental`). The `pnpm check:truth` CI gate fails if any tool ships unclassified.

| Category | Count | Key Tools |
|---|---|---|
| Email | 10 | `read_email`, `draft_email`, `send_email`, `gmail_read_inbox` |
| Calendar | 3 | `list_calendar_events`, `create_calendar_event`, `find_availability` |
| CRM | 14 | `lookup_crm_contact`, `update_crm_record`, `search_deals`, `score_lead` |
| Browser | 30 | `navigate`, `extract`, `fill_form`, `click`, `screenshot`, `evaluate_js` |
| Document | 16 | `summarize_document`, `pdf_extract_text`, `generate_report`, `file_read` |
| Research | 33 | `web_search`, `web_fetch`, `classify_text`, `audit_seo`, `code_execute` |
| Knowledge | 10 | `search_knowledge`, `memory_store`, `memory_retrieve`, `ingest_document` |
| MCP | Dynamic | Slack, GitHub, Notion + 18 more loaded at runtime |

There are 122 classified tools in the registry — run `GET /tools/manifest` for the live maturity breakdown.

## Connectors — honest maturity

22 Connectors = 13 external SaaS connectors + 9 infrastructure/MCP adapters (each surfaced as a UI tile with an honest live status badge). Of those 22 plus 3 adapters that ship without a UI tile:

- **9 production-ready** — Slack, WhatsApp, Gmail, Google Calendar, PostgreSQL, Puppeteer, Filesystem, Fetch, Memory
- **4 beta** — GitHub, Notion, Brave Search, Sequential Thinking
- **4 partial** — Google Drive (auto-sync ingestion only), HubSpot, Salesforce, CRM fallback
- **8 placeholder** — Linear, Stripe, Airtable, ClickUp, SendGrid, Discord, Supabase, Sentry

Per-connector runtime path + notes: [`docs/integration-maturity-matrix.md`](docs/integration-maturity-matrix.md).

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20+ |
| pnpm | 9+ |
| PostgreSQL | 15+ (pgvector recommended) |
| Redis | Optional (scheduling + distributed locks) |

### 1. Clone & install

```bash
git clone https://github.com/inbharatai/jak-swarm.git
cd jak-swarm
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

At minimum set:

```bash
# LLM provider (set one or both — per-tenant switching available in the dashboard)
OPENAI_API_KEY=sk-your-openai-key-here
GEMINI_API_KEY=your-gemini-key-here          # enables Gemini 2.5 Pro/Flash

DATABASE_URL=postgresql://user:pass@localhost:5432/jak_swarm
AUTH_SECRET=your-random-32-char-string-here
EVIDENCE_SIGNING_SECRET=$(openssl rand -base64 48)

# Supabase (required for production auth)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

API keys are required for external LLM providers (Gemini, OpenAI) — JAK does not bundle or provide free LLM API keys. Full reference: `docs/environment-setup.md`.

### 3. Setup database

```bash
pnpm --filter @jak-swarm/db db:migrate
pnpm --filter @jak-swarm/db db:seed              # optional: seed sample data
pnpm seed:compliance                             # seeds 182 SOC 2 / HIPAA / ISO 27001 controls
```

### 4. Build & run

```bash
pnpm turbo build

# Terminal 1 — API server (Fastify, port 4000)
pnpm --filter @jak-swarm/api dev

# Terminal 2 — Web dashboard (Next.js, port 3000)
pnpm --filter @jak-swarm/web dev
```

Open http://localhost:3000 — give it a goal and watch the swarm execute.

### Deploy

- **Google Cloud Run** (primary) — `gcloud builds submit --config=cloudbuild-api.yaml`; see `docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`.
- **Railway** (rollback continuity) — `railway up`; see `docs/railway-deployment.md`.

The Cloud Run Worker cutover and expanded observability endpoints are part of the post-build production hardening roadmap.

---

## 🏗️ Built on Google's agent stack

JAK runs on Google's Agent Development Kit and Gemini, with OpenAI as an alternate provider. This is the **substrate**, not the product.

- **ADK orchestration** — when `JAK_ADK_MODE=1`, workflows route through `@google/adk` `SequentialAgent` + `ParallelAgent` instead of LangGraph. Additive; the LangGraph path is unchanged. (`packages/adk/`)
- **Gemini + Google Search Grounding** — Gemini 2.5 Pro/Flash/Flash-Lite with `GOOGLE_SEARCH` grounding (included quota, citation-backed). OpenAI uses the native `web_search_preview` hosted tool. No Serper or Tavily keys required for provider-native search.
- **Cloud Run** — the verified public deployment is the Cloud Run API (`jak-swarm-api`, `asia-south1`). A live Agent Engine gateway is also deployed (`projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728`) as an additional path; Cloud Run remains primary.
- **Agent Engine + GEPA** — the gateway agent uses `GOOGLE_SEARCH` + 5 FunctionTool wrappers calling `/workflows`, `/memory`, `/approvals`; the GEPA-optimized Candidate 1 prompt (safety refusal + `search_knowledge` fallback) is adopted. Benchmark: Gemini Flash 2.5, 4/4 pass, p50 7.6s, p95 9.0s. Results in `qa/benchmark-optimization-before-after.md`.

Canary flags (all default-off): `hyperAgentEnabled`, `JAK_ADK_MODE`, `BRAIN_MCP_SERVER=1`, `SHIELD_MCP_CANARY=1`, `BENCHMARKS_PERSISTED`.

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Language | TypeScript 5.7 (strict) |
| API | Fastify |
| Frontend | Next.js 16, React 19, Tailwind CSS |
| DAG Visualization | React Flow |
| Database | PostgreSQL + Prisma ORM + pgvector |
| Auth | Supabase (email/password + magic link) + JWT + API keys |
| Durable Workflows | LangGraph StateGraph + PostgresCheckpointSaver |
| ADK Orchestration | `@google/adk` (SequentialAgent + ParallelAgent) |
| LLM — OpenAI | GPT-5.5 / GPT-5.4 — Responses API, json_schema strict mode |
| LLM — Gemini | Gemini 2.5 Pro / Flash / Flash-Lite — parallel function calling, Google Search Grounding |
| Browser Automation | Playwright |
| Email / Calendar | imapflow + nodemailer (IMAP/SMTP) · tsdav (CalDAV) |
| External Integrations | Model Context Protocol (MCP) |
| Testing | Vitest (3,157 blocking CI tests: 2,734 unit + 423 integration) |
| Schema Validation | Zod |

### Security risk lattice

| Risk Level | Examples | Approval |
|---|---|---|
| 🟢 READ_ONLY | `web_search`, `file_read`, `list_calendar` | Never |
| 🟡 DRAFT_ONLY | `draft_email`, `create_calendar_event` (uncommitted) | Never |
| 🟡 SANDBOX_EDIT | Browser ops within sandbox | Configurable |
| 🟠 LOCAL_EXEC_ALLOWLIST | Code execution, file write (allowlisted) | Configurable |
| 🟠 EXTERNAL_ACTION_APPROVAL | `send_email`, `send_webhook`, `post_slack` | Always |
| 🔴 CRITICAL_MANUAL_ONLY | delete records, credential rotation, production deploys | Always |

AES-256-GCM field-level encryption; JWT auth with per-tenant isolation at middleware; bcrypt (12 rounds); PII redaction at LLM boundary and write time; 5-layer hallucination detection on every agent output; RBAC roles `END_USER < REVIEWER < OPERATOR < TENANT_ADMIN < SYSTEM_ADMIN + EXTERNAL_AUDITOR`.

### Development

```bash
pnpm test                  # run all tests (3157 blocking CI)
pnpm typecheck             # strict type checking, zero errors
pnpm lint                  # eslint . --max-warnings=0
pnpm check:truth           # verify tool classifications + landing claims
pnpm audit:tools           # audit all 122 tools against registry
```

Adding a new agent or tool: see [`AGENTS.md`](AGENTS.md) and the "Adding a New Tool" section of `docs/environment-setup.md`. New tools must set a risk class and a maturity label.

---

## 📚 Documentation

| Doc | Description |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Full system architecture, data model, error handling, scaling |
| [`AGENTS.md`](AGENTS.md) | Every agent role: purpose, input/output contracts, handoff logic |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting, SLA, scope, cryptographic assumptions |
| [`docs/hyperagent-current-state-audit.md`](docs/hyperagent-current-state-audit.md) | Hyperagent wired-vs-pure-core breakdown |
| [`docs/production-canary-plan.md`](docs/production-canary-plan.md) | 6-stage live canary runbook (credential-gated) |
| [`docs/mandate-completion-report.md`](docs/mandate-completion-report.md) | Integration hardening milestone report (24 items) |
| [`docs/integration-maturity-matrix.md`](docs/integration-maturity-matrix.md) | Per-connector runtime path + maturity |
| [`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md) | JAK Shield 10-stage pipeline, claim-to-code |
| [`docs/audit-compliance-agent-pack.md`](docs/audit-compliance-agent-pack.md) | Audit & Compliance product overview |
| [`docs/beta-release.md`](docs/beta-release.md) | Beta scope, go/no-go checklist, production readiness |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Long-term vision, honest scope boundaries |
| [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md) | Next-evolution architecture + 11-phase roadmap |
| [`docs/faq.md`](docs/faq.md) | Full FAQ |
| [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md) | Cloud Run deployment guide |
| [`docs/environment-setup.md`](docs/environment-setup.md) | Environment variables, integration setup, troubleshooting |

---

## ❓ Common Questions

**Is JAK Swarm production-ready?**
Not yet. JAK is a working beta build (0.1.0-beta.0). For self-hosted validation and design-partner use: yes. For paying enterprise customers expecting an SLA: no. The named blockers: (1) a third-party security audit / SOC 2 attestation is not yet complete (controls are seeded, not yet attested by a third party); (2) Terms of Service, Privacy Policy, and DPA have not been lawyer-reviewed; (3) the Hyperagent live seam returns empty artifacts until wired and the live canary has not run against managed Postgres + real LLM keys. The integration hardening milestone is merged to main; the live production canary is a named stop awaiting owner credentials. See `docs/beta-release.md` and `docs/production-canary-plan.md`.

**Does JAK have SOC 2 / HIPAA / ISO 27001 certification?**
No. 182 controls are seeded across the three frameworks (108 operationally backed, 74 require reviewer attestation). Certification is third-party and not yet pursued.

**Can I self-host?**
Yes — MIT licensed, self-hostable. `pnpm install && pnpm turbo build` and the Quick Start above.

**Do I need Serper or Tavily for web search?**
No. Gemini uses `GOOGLE_SEARCH` (ADK built-in, included quota); OpenAI uses `web_search_preview` (hosted tool, included quota). Serper/Tavily are optional `web_search` backends, not required.

**What is the Hyperagent?**
A self-healing re-plan loop + governed self-learning layer. Integration-proven; default-off; not yet production-proven. See the Hyperagent section above and `docs/hyperagent-current-state-audit.md`.

Full FAQ: [`docs/faq.md`](docs/faq.md).

---

## 📄 License

MIT — free for commercial and personal use. See [`LICENSE`](LICENSE).

Built with ❤️ by InBharat AI.