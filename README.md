<div align="center">

# 🐝 JAK

### The Closed-Loop Company Operating Layer for Agent Work

[![JAK Shield](https://img.shields.io/badge/JAK_Shield-Defensive_Only-ef4444?style=for-the-badge&logo=shieldsdotio&logoColor=white)](docs/jak-shield-manifest.md)
[![Agents](https://img.shields.io/badge/AI_Agents-38-blue?style=for-the-badge&logo=robot&logoColor=white)](#-agent-roster--38-agents)
[![Tools](https://img.shields.io/badge/Classified_Tools-122-green?style=for-the-badge&logo=playwright&logoColor=white)](#-tool-inventory-122-registered)
[![Connectors](https://img.shields.io/badge/Connectors-22-blue?style=for-the-badge&logo=zapier&logoColor=white)](#-tool-inventory-122-registered)
[![ADK](https://img.shields.io/badge/Google_ADK-Integrated-4285f4?style=for-the-badge&logo=google&logoColor=white)](#-google-adk--grounding)
[![Audit Pack](https://img.shields.io/badge/Audit_Pack-SOC2_%7C_HIPAA_%7C_ISO27001-orange?style=for-the-badge&logo=shieldsdotio&logoColor=white)](docs/audit-compliance-agent-pack.md)
[![Release](https://img.shields.io/badge/Release-Beta_0.1.0--beta.0-0ea5e9?style=for-the-badge&logo=semver&logoColor=white)](docs/beta-release.md)
[![Tests](https://img.shields.io/badge/Tests-2900%2B_blocking_CI-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](#-tech-stack)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?style=for-the-badge&logo=typescript&logoColor=white)](#-tech-stack)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

> Built with Google's **Agent Development Kit (ADK)** for multi-agent orchestration, deployable on **Vertex AI Agent Engine**, running **Gemini 2.5 Pro/Flash/Flash-Lite** alongside **GPT-5.5/5.4**, with **Google Search Grounding** for real-time, citation-backed responses. Per-tenant provider switching configured from the Settings UI.

**JAK turns scattered company context into approved agent work. JAK Shield makes that work safe.**

Give it a goal in plain English. JAK decomposes, routes, executes, and verifies — in real time.

</div>

<nav align="center">

**[📖 Documentation](#-documentation)** · **[⚖️ License](#-license)** · **[🔐 Security](SECURITY.md)** · **[🏗️ Architecture](ARCHITECTURE.md)** · **[🤖 Agents](AGENTS.md)** · **[❓ FAQ](docs/faq.md)** · **[🚀 Quick Start](#-quick-start)**

</nav>

---

## Build Status & Verified Evidence

JAK Swarm is a **working beta build** (0.1.0-beta.0). Its strongest verified evidence is **Google Cloud Run + Gemini + ADK multi-agent orchestration + Google Search Grounding + JAK Shield safety layer + 2,900+ blocking CI tests**.

The system includes:

* **Gemini and OpenAI** mission interpretation, planning, routing, tool calling, and verification (per-tenant provider switching from the Settings UI)
* **Google ADK orchestration** through `@google/adk` (`SequentialAgent` + `ParallelAgent` pipeline, activated via `JAK_ADK_MODE=1`)
* **Google Search Grounding** — built-in with included quota, citation-backed via `GOOGLE_SEARCH` ADK tool
* **Google Cloud Run deployment** — live API gateway at `jak-swarm-api` in `asia-south1`
* **JAK Shield** local security, approval, permission, and audit checks
* **2,900+ blocking CI tests** (unit + integration) + `check:truth` documentation validation
* Live demo access, short and long demo videos, audit-ready workflow evidence

Agent Engine is deployed at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728`. Gateway code lives in `packages/adk/src/deploy/agent-engine-entry.ts`, with deployment scripts `scripts/deploy-agent-engine.sh`, `scripts/deploy-agent-engine.ts`, and `scripts/deploy-agent-engine-python.py`. The verified public deployment documented here is Cloud Run; Agent Engine is an additional gateway path.

### Verified Evidence

This table summarizes what is publicly evidenced in this repository and what is intentionally not overclaimed.

| Capability | Evidence in JAK | Status |
|:------------|:----------------|:------:|
| Gemini integration | `GeminiRuntime` adapter, `gemini-2.5-pro/flash/flash-lite`, tier-based model selection, per-tenant provider switching | ✅ Verified |
| Google ADK orchestration | `@google/adk` `SequentialAgent` + `ParallelAgent` pipeline, `JAK_ADK_MODE=1` feature flag, `adk-pipeline.ts` + `adk-runner.ts` | ✅ Verified |
| Multi-agent collaboration | 38 agents (6 orchestrators + 32 workers), DAG-based routing, parallel worker execution, verifier with bounded retry + a genuine **HyperAgent self-healing/re-plan loop** (deterministic failure classifier → counterfactual diagnosis → symbolic replanner + validator → autonomy-gated apply) merged to `main` (Phases 0-15); integration tests prove real plan repair end-to-end | ✅ Verified |
| Google Cloud deployment | Verified Cloud Run API deployment in `asia-south1`; Cloud Run deployment docs and Google Cloud deployment path included | ✅ Verified |
| Grounding / RAG | ADK `GOOGLE_SEARCH` tool, Gemini Google Search grounding, private knowledge retrieval, optional Vertex AI Search datastore configuration | ✅ Verified |
| Business use case | Company operating layer: evidence graph → drift detection → agent-executable specs → approved multi-agent execution | ✅ Verified |
| Safety / security layer | JAK Shield-style local policy controls, RBAC, approval gates, audit logging, PII redaction, HMAC-ready security path + a **`ShieldMcpClient`** that signs/verifies high-risk decisions (local embedded mode, unit-tested, Phase 8) and an **Agent Governance Overlay** (autonomy policy L0-L5 + human-only NEVER set, governance gate, Phase 7). Both are pure-core-tested; the `ShieldMcpClient` is **not yet instantiated in the live action path**, the external JAK Shield MCP *transport* wiring remains a roadmap item, and `AuditLog` row-chain HMAC is not yet implemented. Today the enforced gateway is the embedded local one | ✅ Verified |
| Tests | 2,900+ blocking CI tests (unit + integration) + `check:truth` documentation validation; badge shows a floor count | ✅ Verified |
| Live demo | Publicly accessible demo path with verified Cloud Run API backend support | ✅ Verified |
| Agent Engine | Live deployment at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` with 6 tools (google_search + 5 FunctionTool wrappers calling `/workflows`, `/memory`, `/approvals`); GEPA Candidate 1 prompt adopted; gateway code in `agent-engine-entry.ts`, deploy script `deploy-agent-engine-python.py`, resource ID in `agent-engine-resource.ts` | ✅ Verified |
| Agent Simulation / benchmarking | Benchmark harness and scenarios committed; Gemini Flash 2.5 benchmark: 4/4 pass, p50 7.6s, p95 9.0s ([`benchmark-results-gemini.md`](qa/benchmark-results-gemini.md)); harness supports `--gemini` and `--adk` flags | ✅ Verified |
| Agent Optimizer | Google ADK `adk eval` + `GEPARootAgentPromptOptimizer` run against `jak-swarm-gateway`; corrected eval: 6/6 training + 4/4 held-out validation; GEPA Candidate 1 prompt adopted in deployed Agent Engine; results in [`benchmark-optimization-before-after.md`](qa/benchmark-optimization-before-after.md) and [`adk-eval-results.json`](qa/_generated/adk-eval-results.json) | ✅ Verified |
| Before/after optimization results | Initial eval 4/6 was caused by broken API paths (`/api/` prefix); corrected eval: 6/6 training, 4/4 held-out validation; GEPA optimizer (20 iters, 102 calls) found baseline optimal on training set; Candidate 1 (safety refusal + search_knowledge fallback) adopted; original run had train/val overlap, now fixed ([`benchmark-optimization-before-after.md`](qa/benchmark-optimization-before-after.md)); latency: 4/4 pass, p50 7.6s ([`benchmark-results-gemini.md`](qa/benchmark-results-gemini.md)) | ✅ Verified |

### Deployment Reality

JAK's verified public Google Cloud deployment is the Cloud Run API (requires auth for health endpoints; public demo at [jakswarm.com](https://jakswarm.com)). A live Agent Engine gateway is also deployed at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` (`asia-south1`) with 6 tools (google_search + 5 FunctionTool wrappers) and the GEPA Candidate 1 prompt (safety-strengthened variant that matches baseline quality while adding explicit refusal and search_knowledge fallback).

Current verified deployment path:

```
Demo / frontend → Cloud Run API → JAK workflow engine → Gemini / ADK / tools / approvals
```

Optional Agent Engine gateway path:

```
Vertex AI Agent Engine → JAK Agent Engine gateway → Cloud Run API → JAK workflows
```

This keeps the existing demo and production path safe. It does not replace the public demo path or the verified Cloud Run backend.

| Component | Status | Details |
|:----------|:------:|:--------|
| **Cloud Run API** (`jak-swarm-api`) | ✅ Verified | Primary deployment — `asia-south1`; health endpoints implemented (`/ready`, `/health`, `/healthz`) and passing internally; require auth on public Cloud Run |
| **Frontend / demo** | ✅ Verified | Vercel + Railway continuity for the public demo; `NEXT_PUBLIC_API_URL` switch to Cloud Run planned post-validation |
| **Agent Engine** | ✅ Verified | Live at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728`; 6 tools (google_search + 5 FunctionTool wrappers calling `/workflows`, `/memory`, `/approvals`); GEPA Candidate 1 prompt; `agent-engine-entry.ts` + `deploy-agent-engine-python.py` + `agent-engine-resource.ts` |
| **Cloud Run Worker** | 🔜 Roadmap | `jak-swarm-worker` Dockerfile + Cloud Build config exist; deployment is part of the production hardening roadmap |
| **Google Secret Manager** | ✅ Configured | 12 secrets mounted |
| **Supabase PostgreSQL** | ✅ Connected | Shared across deployments |
| **Redis** | ✅ Connected | Railway public endpoint (`rediss://`) |

### Optimization Story

JAK's optimization story is not a single prompt tweak. It is an architecture-level shift from a broad workflow system into a Google-aligned multi-agent execution layer:

1. **ADK mode routes workflows through `SequentialAgent` and `ParallelAgent`** — when `JAK_ADK_MODE=1`, JAK's existing LangGraph system is extended with Google ADK orchestration. Workflows route through `SequentialAgent` + `ParallelAgent` with zero changes to the LangGraph path. This is additive, provider-flexible architecture.

2. **Gemini grounding improves factual reliability before and during agent execution** — real-time, citation-backed responses via `GOOGLE_SEARCH` (built-in with included quota, ADK native). No third-party search API keys required. Grounded responses reduce hallucination risk at the source.

3. **Parallel worker orchestration allows specialist agents to collaborate** — instead of forcing one agent to do everything, 38 specialist agents execute in parallel, each with domain-scoped tools and context. The Verifier agent quality-checks output before delivery.

4. **JAK Shield-style policy controls, approval gates, RBAC, and audit logging reduce unsafe automation risk** — every real-world agent action flows through 6 local policy stages (Agent Firewall, Risk-Based Approvals, Secure Tool Permissions, Sandboxed Execution, Defensive Vulnerability Triage, Audit Evidence Layer) with deterministic blocking, injection detection, taint tracking, PII redaction, RBAC thresholds, and signed evidence bundles. The external JAK Shield MCP will add 4 additional stages for signed high-risk decisions (it is a separate product; the MCP wiring from JAK Swarm to that gateway is a roadmap item, not yet integrated). High-risk actions require explicit approval. Destructive actions are never auto-retried.

5. **Provider switching allows tenants to use Gemini or other supported providers without rewriting workflows** — each tenant chooses from the Settings UI. The preference flows through `TenantMemory` → `SwarmExecutionService` → `SwarmRunner` → `AgentContext.llmProvider`. No code changes, no env-var swaps.

6. **Benchmark/readiness scripts and the blocking test suite provide regression protection** — 2,900+ blocking CI tests (unit + integration, 2,905 at last count) with CI-enforced truth checks (`pnpm check:truth`). Tool maturity labels are CI-enforced. Landing page claims are CI-enforced.

ADK Agent Optimizer (`adk optimize` with `GEPARootAgentPromptOptimizer`) has been executed against the JAK gateway agent. The GEPA algorithm ran 20 evaluation iterations (102 metric calls) on the training set, finding the baseline prompt achieves 100% rubric pass rate (6/6). The initial `adk eval` showed 4/6 due to broken API paths (`/api/` prefix instead of production `/workflows`), not poor agent quality. After fixing paths, corrected eval: 6/6 training + 4/4 held-out validation. GEPA explored 3 alternative prompt variants — Candidate 1 (explicit safety refusal + search_knowledge fallback) matched baseline quality and has been adopted in the deployed Agent Engine. The original optimizer run had train/val overlap (same 6 scenarios for both); a separate validation set has been added. Full results in `qa/benchmark-optimization-before-after.md`.

Post-build production hardening roadmap:

* full Cloud Run worker cutover
* expanded health and observability endpoints
* enterprise SLA packaging
* deeper connector productionization
* full JAK Shield MCP signed-decision integration for high-risk actions
* official Agent Evaluator / Simulation / Optimizer quantitative runs

---

## What JAK Swarm Does

JAK Swarm is a Gemini-powered Agentic Business Operating Layer for product and engineering execution. It captures evidence from company artifacts, maps decisions / tasks / risks / owners / customer signals / code changes, detects execution drift, generates agent-executable specs, and routes approved work through **38 specialist agents** + **122 classified tools** + **22 connectors** (13 external SaaS connectors in `INTEGRATIONS_CORE` + 9 infrastructure adapters in `INTEGRATIONS_INFRA`, each surfaced as a UI tile with an honest live status badge; 21 MCP providers auto-mapped at runtime, plus Remotion and Blender connector manifests).

### What's unique

- **Evidence graph before agent action** — artifacts become graph entities; graph entities become drift findings; drift findings become agent-executable specs. This is the closed-loop Company OS foundation — intentionally citation-first, not chatbot memory. ([`company-operating-layer.service.ts`](apps/api/src/services/company-brain/company-operating-layer.service.ts))
- **One task graph for AI agents AND humans** — the CEO writes a prompt; the planner routes some steps to specialist agents (Research, CMO, CTO) and others to teammates ("@anita to sign the contract"). Both flow through the same orchestrator, emit lifecycle events, and feed the signed audit pack. ([`docs/team-and-trial.md`](docs/team-and-trial.md))
- **JAK Shield as the trust gateway** — high-risk agent actions are routed through a separate MCP-native 10-stage security gateway ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)) with local policy enforcement inside Swarm. ([`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md) · [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md))
- **Google ADK orchestration** — when `JAK_ADK_MODE=1`, workflows route through Google's Agent Development Kit (`@google/adk`) using `SequentialAgent` and `ParallelAgent` for multi-agent orchestration. Google Search Grounding provides real-time, citation-backed responses. ([`packages/adk/`](packages/adk/))
- **Provider-native search without paid APIs** — Gemini uses `GOOGLE_SEARCH` (built-in with included quota, citation-backed). OpenAI uses `web_search_preview` (built-in with included quota, native). No Serper, no Tavily, no third-party search API keys needed. API keys are required for OpenAI and Gemini — JAK does not bundle or provide free LLM API keys.
- **30-day free trial with daily budget caps** — sign up at `/trial` with just an email. No credit card. Four daily caps protect both your data AND your budget.
- **Integrate, don't rebuild** — JAK is the cockpit for your existing stack. Gmail, Google Calendar, Slack, GitHub, Notion, browser automation, and MCP surfaces exist in code.

### Who it's for

- Product and engineering teams comparing customer/founder intent with what is actually being built
- Solo founders and small ops teams who want AI to do real work, not just "give answers"
- Compliance-aware teams needing tamper-evident agent action trails (SOC 2 / HIPAA / ISO 27001 control mappings shipped — third-party certification not yet; see [FAQ](docs/faq.md))
- Teams already on Slack / GitHub / Notion / Gmail wanting one place to turn evidence into approved execution

### Build scope

This is a **working beta build** (0.1.0-beta.0), not a finished enterprise product. **Blunt beta truth:** JAK has the Company OS data model, API routes, dashboard surface, deterministic drift detector, agent spec generator, approval decision route, and audit foundation. It still needs deeper connector auto-sync before it should claim full company-wide OS coverage — today only **GitHub, Gmail, and Google Drive** auto-sync on a 5-minute schedule; the other 19 of 22 connectors are callable as agent tools but ingest evidence on-demand/manually. Enterprise SLA packaging, expanded observability, and production hardening are on the roadmap. The Google Cloud Run deployment supports the JAK API / agent gateway for live workflows. API keys are required for external LLM providers (Gemini, OpenAI) — JAK does not bundle API keys or provide free LLM access. See [`docs/beta-release.md`](docs/beta-release.md) for the full scope and go/no-go checklist.

---

## 🔮 Google ADK + Grounding

JAK Swarm integrates Google's Agent Development Kit at three layers, each independently activatable and completely additive — the Gemini + ADK orchestration pipeline runs alongside the existing LangGraph pipeline without modifying it.

### Layer 1: Google Search Grounding + Vertex AI Search

When `LLM_PROVIDER=gemini`, the Gemini runtime injects `{ googleSearch: {} }` and optionally `{ vertex_ai_search: { datastore } }` into the Gemini API tools array. Responses include `groundingMetadata` with web search queries, source URLs, and confidence scores.

For OpenAI, the native `web_search_preview` hosted tool provides equivalent real-time search — no Serper or Tavily keys needed.

| Flag | Effect |
|:-----|:-------|
| `GEMINI_GOOGLE_SEARCH_GROUNDING=1` | Enables Google Search grounding in Gemini |
| `GEMINI_VERTEX_AI_SEARCH_DATASTORE=projects/.../dataStores/...` | Enables Vertex AI Search |
| `OPENAI_WEB_SEARCH=1` | Enables web_search_preview for OpenAI |

### Layer 2: ADK Agent Wrappers + Orchestration

When `JAK_ADK_MODE=1`, workflows route through `@google/adk` instead of LangGraph:

```
SequentialAgent(root)
  ├── CommanderAgent          (GOOGLE_SEARCH + JAK tools)
  ├── PlannerAgent            (no tools)
  ├── ParallelAgent(workers)
  │     ├── Worker_CEO        (tools + search)
  │     ├── Worker_CTO        (tools + search)
  │     └── ...               (one per role)
  ├── SynthesisAgent           (merges parallel outputs)
  └── VerifierAgent            (quality assurance)
```

**Provider-native search**: Gemini agents use `GOOGLE_SEARCH` (ADK built-in, included quota). OpenAI agents use `web_search_preview` (hosted tool, included quota).

Key files: [`packages/adk/`](packages/adk/) — [`jak-tool-bridge.ts`](packages/adk/src/bridge/jak-tool-bridge.ts) · [`jak-adk-agents.ts`](packages/adk/src/agents/jak-adk-agents.ts) · [`adk-pipeline.ts`](packages/adk/src/orchestration/adk-pipeline.ts) · [`adk-runner.ts`](packages/adk/src/orchestration/adk-runner.ts)

### Provider-Agnostic Guarantee

| When | What runs |
|:----:|:----------|
| `LLM_PROVIDER=openai` (any mode) | Existing OpenAI path, zero changes |
| `LLM_PROVIDER=gemini` (no flags) | Existing GeminiRuntime, no grounding |
| `LLM_PROVIDER=gemini` + `GEMINI_GOOGLE_SEARCH_GROUNDING=1` | GeminiRuntime with Google Search grounding |
| `LLM_PROVIDER=gemini` + `JAK_ADK_MODE=1` | ADK orchestration with Gemini + grounding |

### Layer 3: Agent Engine Gateway

Agent Engine gateway code in [`agent-engine-entry.ts`](packages/adk/src/deploy/agent-engine-entry.ts), with deployment scripts [`deploy-agent-engine.sh`](scripts/deploy-agent-engine.sh), [`deploy-agent-engine.ts`](scripts/deploy-agent-engine.ts), and [`deploy-agent-engine-python.py`](scripts/deploy-agent-engine-python.py). The live Agent Engine resource is `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` (stored in [`agent-engine-resource.ts`](packages/adk/src/deploy/agent-engine-resource.ts)). The gateway agent uses `GOOGLE_SEARCH` for real-time grounding and delegates workflow execution to JAK's Cloud Run API. Cloud Run remains the primary verified deployment; Agent Engine is an additional gateway path.

---

## 🏗️ How It Works

```mermaid
flowchart TD
    subgraph INPUT["🎤 Input Layer"]
        A["💬 Natural Language Goal"]
        B["🎤 Voice Command"]
    end

    subgraph ORCHESTRATION["🧠 Orchestration Layer"]
        C["🎯 Commander Agent"]
        D["📋 Planner Agent"]
        E["🛡️ Guardrail Agent"]
        F["🔀 Router Agent"]
    end

    subgraph WORKERS["⚡ Worker Layer — 32 Specialists"]
        direction LR
        G["📧 Email  📅 Calendar  👤 CRM"]
        H["📄 Document  📊 Spreadsheet  🌐 Browser"]
        I["🔍 Research  🧠 Knowledge  🎧 Support"]
        J["💻 Coder  🎨 Designer  🚀 Growth"]
        K["⚖️ Legal  💰 Finance  👔 HR"]
    end

    subgraph VERIFY["✅ Quality Layer"]
        M["✅ Verifier Agent"]
        N["⚠️ Approval Gate"]
    end

    subgraph OUTPUT["📊 Output"]
        O["Compiled Result"]
    end

    A --> C
    B --> C
    C --> D --> E
    E -->|"✅ Pass"| F
    E -->|"🚫 Block"| C
    F --> G & H & I & J & K
    G & H & I & J & K --> M
    M -->|"✅ Pass"| O
    M -->|"❌ Fail"| D
    M -->|"⚠️ Risk"| N
    N -->|"👍 Approved"| O
    N -->|"👎 Rejected"| C
```

> **Bounded retry + genuine re-plan loop**: If the Verifier rejects output, the system re-runs the same task against the same worker up to a bounded retry budget (`RepairService` classifies the failure and refuses to auto-retry destructive / permission / approval-timeout / unknown classes). Beyond retry, the **HyperAgent self-healing layer** (merged to `main`, Phases 0-15) adds a genuine *re-plan* loop that is **wired into the live LangGraph graph** (OFF-gated so default workflows are byte-for-byte unchanged): a deterministic 20-class failure classifier → counterfactual fault isolation (agent/tool/model) → a **symbolic replanner** that proposes agent/tool/task-order/dependency/scope changes and a **deterministic validator** that rejects cyclic / unpermitted / unsafe plans (Innovation #3 — an LLM may propose, only the symbolic layer may apply) → autonomy-gated apply that preserves completed external actions + signed approvals + receipts. Integration tests prove real plan repair (REPLACE_AGENT, SPLIT_TASK), learning promotion via measured mutual information, Shield fail-closed, and versioned-config rollback end-to-end — *by composing the pure cores directly*. **Honest scope:** only the *repair* half (diagnosis → replanner → selective re-execution) is wired into the live workflow runner; the *self-learning* half (outcome evaluator, learning extraction/recall, mutual-information gate, meta-optimiser, R2 output-correction) and the `ShieldMcpClient` exist as **pure cores with unit tests but are not yet called from the live execution path**. Retry accounting was unified onto `taskRetryCount` + a single shared `MAX_TASK_RETRIES=2` (verifier + edge now read the same field/constant, so they can no longer disagree), and a 16-bug hardening sweep landed further safety fixes (host-JS `code_execute` production-disabled because Node `vm` is not a security boundary; the graph-state `error` channel made clearable so recovered runs are no longer mis-reported as failed; Shield subject-substitution defense; DP-noise scale corrected to the reported sensitivity; cyclic-spec rejection; code-repair path normalization; node-timeout timer-leak fix; risk-classifier security floor unbypassable) — see the HyperAgent section below for the full wired-vs-pure-core breakdown. Destructive actions are never auto-retried. The live 12-step E2E + Cloud Run deploy gate that would prove *measured learning impact in production* is env-blocked (no live stack in this session) and is not fake-passed. See `docs/hyperagent-current-state-audit.md` (Phase 0 baseline).

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full system architecture, data model, error handling strategy, and scaling considerations.

---

## 🛡️ JAK Shield — The Trust Gateway

JAK Shield is a **separate MCP-native security gateway** ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)) with a **10-stage decision pipeline** that protects every real-world agent action. JAK Swarm enforces JAK Shield-style **local** policy controls inside `packages/security` — guardrails, RBAC, audit logging, PII redaction, and tool-risk/approval gating via the embedded `LocalShieldGateway`. The **Agent Governance Overlay** (autonomy policy L0-L5 with a fixed human-only NEVER set, governance gate, ability packs) and the **`ShieldMcpClient`** that signs + verifies high-risk decisions in local embedded mode are built (HyperAgent Phases 7-8). The **MCP transport call from JAK Swarm to the external JAK Shield gateway** remains a roadmap item; today the default gateway is the embedded local one, and the external Shield is replaceable through the `ShieldGateway` interface override.

**JAK Shield 10-stage decision pipeline:**

| Stage | What it does |
|-------|-------------|
| 1. Hard rules | Deterministic block/allow based on tenant policy |
| 2. Injection v2 | 6 substages, 13+ language detection of prompt injection |
| 3. Taint tracker | MinHash + n-gram fingerprinting for cross-prompt taint |
| 4. Attack-chain detection | 20 patterns + data-flow analysis for multi-step attacks |
| 5. PII v2 | 28 types (SSN, Aadhaar, IBAN, PAN, NRIC, CPF, CNPJ, etc.) + cryptographic checksums |
| 6. Anomaly detection | EWMA + z-score per tenant/agent for behavioural drift |
| 7. RBAC + threshold | Role, department, and autonomy-level gating |
| 8. OpenAI classifier | Advisory-only second opinion (deterministic engine has final say) |
| 9. HMAC signing | Cryptographic proof of every security decision |
| 10. Output routing | `allow` · `redact` · `requires_approval` · `block` · `rewrite` |

**Local policy enforcement inside JAK Swarm** (`packages/security`):

| # | Defense | What it does | Code |
|---|---------|-------------|------|
| 1 | **Agent Firewall** | Blocks prompt-injection attacks AND offensive-cyber requests before the LLM sees them. | [`offensive-cyber-detector.ts`](packages/security/src/guardrails/offensive-cyber-detector.ts) · [`injection-detector.ts`](packages/security/src/guardrails/injection-detector.ts) |
| 2 | **Risk-Based Approvals** | Every tool call classified across the 6-tier `ToolRiskLevel` lattice. Risky calls pause the workflow. Approval bound to exact payload via SHA-256 hash. | [`approval-policy.ts`](packages/tools/src/registry/approval-policy.ts) |
| 3 | **Secure Tool Permissions** | Per-tenant tool registry + industry-pack restrictions + Standing Orders (allowed-tools whitelist + blocked-actions list + budget cap + expiry). | [`tenant-tool-registry.ts`](packages/tools/src/registry/tenant-tool-registry.ts) |
| 4 | **Sandboxed Execution** | Browser sessions: per-tenant data dirs, 500 MB disk quota, URL allowlist, DNS-rebind defense. Subprocess: literal argv, 60s timeout, stripped env. | [`playwright-browser-operator.ts`](packages/tools/src/browser-operator/playwright-browser-operator.ts) |
| 5 | **Defensive Vulnerability Triage** | Supports defensive security work — repo audits, dependency scans, secret-leak detection. Offensive work is blocked at the boundary. | [`offensive-cyber-detector.ts`](packages/security/src/guardrails/offensive-cyber-detector.ts) |
| 6 | **Audit Evidence Layer** | Every workflow lifecycle event lands in `AuditLog`. AgentTrace PII-redacted at write time. Evidence bundles HMAC-SHA256 signed. Field-level encryption via `field-cipher.ts` available for sensitive workflow data. | [`bundle.service.ts`](apps/api/src/services/bundle.service.ts) · [`field-cipher.ts`](packages/security/src/encryption/field-cipher.ts) |

**Safety boundary:** JAK Shield is built for defensive security, safe automation, permissioned workflows, and audit-ready agent execution. It does **not** support offensive hacking, malware generation, credential theft, phishing, unauthorized scanning, or exploit generation.

Full manifest: [`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md). Architecture plan: [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md). Security policy: [`SECURITY.md`](SECURITY.md).

---

## ✨ Key Features

| | Feature | Description |
|---|---------|-------------|
| 🤖 | **38 AI Agents** | 6 orchestrators + 32 specialist workers across Executive, Operations, Core, and Vibe Coding layers. [Full roster →](#-agent-roster--38-agents) |
| 🧠 | **Company Brain** | Per-tenant profile (industry, brand voice, competitors, goals) LLM-extracted from documents → user approves → grounds every agent prompt. Refuses unapproved profiles. UI at `/company`. |
| 🎯 | **Intent Vocabulary + Templates** | 18 named CompanyOSIntents constrained at the LLM layer via strict Zod schema. 6 system-seeded WorkflowTemplates provide pre-tuned decompositions. |
| 💬 | **Follow-up NL Parser** | Rule-based parser maps short chat inputs to workflow actions: approve, reject, continue, pause, resume, cancel, show graph/cost/failed, "what is the CMO doing?" |
| 🛡️ | **Audit & Compliance Pack** | SOC 2 Type 2 (63) + HIPAA (37) + ISO 27001 (82) = 182 controls seeded. 108 operationally backed, 74 require reviewer attestation. LLM-driven control testing, reviewer-gated workpaper PDFs, HMAC-signed evidence packs, External Auditor Portal. [Full details →](docs/audit-compliance-agent-pack.md) |
| 🔧 | **122 Classified Tools** | Every tool carries an honest CI-enforced maturity label (`real` / `heuristic` / `llm_passthrough` / `config_dependent` / `experimental`). [Inventory →](#-tool-inventory-122-registered) |
| ⚡ | **Vibe Coding Builder** | Describe an app → Architect → Generate → 3-layer build check → Debug loop (≤3 retries) → Deploy. [Details →](docs/vibe-coding.md) |
| 🧠 | **Agent-first Runtime** | All work routes through specialist agents with tier-based model execution. Both **OpenAI** (GPT-5.5/5.4) and **Gemini** (2.5 Pro/Flash/Flash-Lite) with per-tenant switching. |
| 🔍 | **Provider-Native Search** | Google Search Grounding (built-in with included quota, citation-backed) for Gemini. `web_search_preview` (built-in with included quota, native) for OpenAI. No Serper, no Tavily, no external search API keys required. |
| 🧬 | **ADK Orchestration** | Google Agent Development Kit (`@google/adk`) for multi-agent orchestration. `SequentialAgent` + `ParallelAgent` pipeline mirrors JAK's DAG. Activated via `JAK_ADK_MODE=1`. |
| 🧠 | **Memory System** | LLM-powered fact extraction, token-budgeted retrieval injected via `<memory>` tags. Server-side conversation threads with full history injection into LangGraph state. |
| 🔌 | **MCP Integrations** | Slack, GitHub, Notion wired with provider management. 21 MCP providers auto-mapped. Connector Runtime with honest status badges. [Connector docs →](docs/connector-runtime.md) |
| 💬 | **Slack + WhatsApp Bridges** | Slack messages trigger authenticated workflows with HMAC-verified webhooks. WhatsApp control via QR verification. |
| 🎤 | **Voice Sessions** | OpenAI Realtime API via WebRTC. Optional Deepgram STT / ElevenLabs TTS adapters. |
| 🏢 | **Multi-Tenant SaaS** | RBAC (5 roles + External Auditor), approval gates, audit logging, tenant isolation. Tenant secrets are protected through environment secret storage, Supabase Vault, and Google Secret Manager where deployed. |
| 💰 | **Credit-Based Billing** | 4 plans (Free / Pro / Team / Enterprise), daily + monthly caps, per-task cost estimation, usage dashboard. |
| 📊 | **Observability** | 35 Prometheus metrics, OpenTelemetry tracing, per-node cost breakdown, workflow timeline API, `/ready` readiness endpoint. Additional health and telemetry endpoints are part of the production observability roadmap. |
| 🏗️ | **Distributed Ready** | Redis coordination: distributed locks, leader election, cross-instance signals, shared circuit breakers. Worker-lease reclaim: dead workers' jobs auto-recovered in 30s. |

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

    subgraph EXEC["💼 Executive"]
        E1["🎯 Strategist (CEO)"]
        E2["🏗️ Technical (CTO)"]
        E3["💰 Finance (CFO)"]
        E4["📣 Marketing (CMO)"]
        E5["👔 HR"]
        E6["💻 Coder"]
        E7["🎨 Designer"]
        E8["🚀 Growth"]
    end

    subgraph VIBE["⚡ Vibe Coding"]
        V1["🏛️ Architect"]
        V2["⚡ Generator"]
        V3["🔧 Debugger"]
        V4["🚀 Deployer"]
        V5["📸 Screenshot→Code"]
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
        W4["📄 Doc"]
        W5["📊 Sheet"]
        W6["🌐 Browser"]
        W7["🔍 Research"]
        W8["🧠 Knowledge"]
        W9["🎧 Support"]
        W10["⚙️ Ops"]
        W11["🎤 Voice"]
    end
```

| Layer | Count | Purpose |
|:------|:-----:|:--------|
| **🧠 Orchestrators** | 6 | Parse goals, build DAGs, route tasks, verify quality, enforce guardrails |
| **💼 Executive** | 8 | CEO/CTO/CFO/CMO-level strategic decisions and specialized expertise |
| **⚡ Vibe Coding** | 5 | Full-stack app generation — architecture, code, debug, deploy, vision |
| **🏢 Operations** | 8 | Content, SEO, PR, Legal, Analytics, Product, Project management |
| **⚙️ Core Workers** | 11 | Email, Calendar, CRM, Browser, Research, Voice, infrastructure tools |

Full agent details: [`AGENTS.md`](AGENTS.md)

---

## 🧠 LLM Providers & Routing

| Provider | Models | Use Case |
|:--------:|:------:|:---------|
| ![Gemini](https://img.shields.io/badge/LLM-Gemini_2.5-4285f4?style=flat-square&logo=google) | 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite | Parallel function calling, controllable thinking, structured output, **Google Search Grounding** |
| ![OpenAI](https://img.shields.io/badge/LLM-GPT--5.5_%2F_5.4-412991?style=flat-square&logo=openai) | GPT-5.5, GPT-5.4 | Responses API, strict structured output, prompt-cache-aware telemetry (alternate provider) |

**Per-tenant provider switching** — each tenant chooses Gemini or OpenAI from the Settings UI. The preference flows through `TenantMemory` → `SwarmExecutionService` → `SwarmRunner` → `SwarmState` → `AgentContext.llmProvider` → `BaseAgent.setContextOverride()`. Tenant API keys are protected through environment secret storage, Supabase Vault, and Google Secret Manager where deployed.

**Tier-based model selection:**

| Tier | Gemini | OpenAI | Assigned to |
|:----:|:------:|:------:|:-----------|
| 💎 Premium | Gemini 2.5 Pro | GPT-5.5 | Commander, Planner, Verifier, CEO/CMO/CFO |
| ⚡ Balanced | Gemini 2.5 Flash | GPT-5.4 | Code Generator, Architect, Research |
| 💰 Economy | Gemini 2.5 Flash-Lite | GPT-5.4 | Router, Guardrail, simple workers |

**Provider-native search** — no paid search API keys required:

| Provider | Search Method | Cost | Citations |
|:--------:|:-------------:|:----:|:---------:|
| Gemini | `GOOGLE_SEARCH` (ADK built-in) or `googleSearch` grounding | Included quota | ✅ URLs + snippets |
| OpenAI | `web_search_preview` hosted tool | Included quota | ✅ Source URLs |

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version |
|:-----------:|:-------:|
| Node.js | 20+ |
| pnpm | 9+ |
| PostgreSQL | 15+ (pgvector recommended) |
| Redis | Optional (for scheduling + distributed locks) |

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

At minimum set:

```bash
# LLM provider (set one or both — per-tenant switching available in the dashboard)
OPENAI_API_KEY=sk-your-openai-key-here
GEMINI_API_KEY=your-gemini-key-here          # Optional: enables Gemini 2.5 Pro/Flash

# Google ADK orchestration (optional — activates ADK multi-agent pipeline)
JAK_ADK_MODE=1                                # Routes workflows through @google/adk
GEMINI_GOOGLE_SEARCH_GROUNDING=1              # Google Search grounding for Gemini
OPENAI_WEB_SEARCH=1                           # Native web_search for OpenAI

DATABASE_URL=postgresql://user:pass@localhost:5432/jak_swarm
AUTH_SECRET=your-random-32-char-string-here
EVIDENCE_SIGNING_SECRET=$(openssl rand -base64 48)

# Supabase (required for production auth)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Full reference: [`docs/environment-setup.md`](docs/environment-setup.md)

### 3. Setup Database

```bash
pnpm --filter @jak-swarm/db db:migrate
pnpm --filter @jak-swarm/db db:seed              # optional: seed sample data
pnpm seed:compliance                             # seeds 182 SOC 2 / HIPAA / ISO 27001 controls
```

### 4. Build & Run

```bash
pnpm turbo build

# Terminal 1 — API server (Fastify, port 4000)
pnpm --filter @jak-swarm/api dev

# Terminal 2 — Web dashboard (Next.js, port 3000)
pnpm --filter @jak-swarm/web dev
```

Open **http://localhost:3000** — give it a goal and watch the swarm execute.

Docker: [`docker/docker-compose.yml`](docker/docker-compose.yml) · Production: [`docker-compose.prod.yml`](docker-compose.prod.yml)

### Deploy to Railway (Rollback Continuity)

Railway remains available as rollback continuity. Google Cloud Run is the primary deployment.

```bash
npm i -g @railway/cli
railway link
railway up
```

See [`docs/railway-deployment.md`](docs/railway-deployment.md) for the full Railway runbook.

### Deploy to Google Cloud Run

JAK Swarm API is deployed on Google Cloud Run (primary). Railway remains available as rollback continuity.

```bash
# Prerequisites: gcloud CLI, billing-enabled GCP project
# See docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md for full setup

gcloud builds submit --config=cloudbuild-api.yaml
# Worker migration to Cloud Run is part of the post-build production hardening roadmap
```

See [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md) for step-by-step instructions.

#### Current Deployment Status

JAK Swarm API is currently deployed successfully on Google Cloud Run.

| Field | Value |
|-------|-------|
| Service | `jak-swarm-api` |
| Region | `asia-south1` |
| URL | `https://jak-swarm-api-565531938617.asia-south1.run.app` |
| Last deployed by | `reetu004@gmail.com` |
| Last deployed at | `2026-06-09T05:50:22Z` (≈ 11:20 AM IST) |

**Verification commands:**

```bash
gcloud config get-value project

gcloud run services list --platform managed

gcloud run services describe jak-swarm-api \
  --region asia-south1 \
  --format="value(status.url,status.conditions[0].status,status.conditions[0].type)"

curl -i https://jak-swarm-api-565531938617.asia-south1.run.app/health

gcloud run services logs read jak-swarm-api \
  --region asia-south1 \
  --limit=50
```

**Component Status:**

| Component | Status |
|-----------|--------|
| Cloud Run API (`jak-swarm-api`) | ✅ Deployed, accessible through the public demo path |
| Cloud Run Worker (`jak-swarm-worker`) | 🔜 Roadmap (post-build hardening) |
| Supabase PostgreSQL | ✅ Connected (shared with Railway) |
| Redis | ✅ Connected via Railway public endpoint (`rediss://`, not `.railway.internal`) |
| Google Secret Manager | ✅ Configured, 12 secrets mounted |
| Vercel `NEXT_PUBLIC_API_URL` | 🔜 Points to Railway for the public demo; Cloud Run URL switch planned post-validation |

**Health Endpoints:**

| Endpoint | Status | Notes |
|----------|--------|-------|
| `/ready` | ✅ Implemented | Readiness check. Env, DB, Redis, LLM. Uses `$queryRawUnsafe` for Supabase pooler compatibility. Requires auth on public Cloud Run. |
| `/health` | ✅ Implemented | Deep diagnostic. Uses `$queryRawUnsafe` for Supabase pooler compatibility. Requires auth on public Cloud Run. |
| `/healthz` | ✅ Implemented | Liveness probe (always 200, no dependency checks). Requires auth on public Cloud Run. |

**Post-Build Hardening Items:**

- Complete Cloud Run Worker migration
- Switch Vercel `NEXT_PUBLIC_API_URL` to Cloud Run URL after full validation

**Railway as Rollback Continuity:**

The frontend remains on Vercel for the public demo. The Google Cloud Run deployment supports the JAK API / agent gateway path, while Railway remains available as rollback continuity. If Cloud Run has issues, switch `NEXT_PUBLIC_API_URL` in Vercel back to the Railway URL and redeploy — no code changes needed.

### Integration Setup

<details>
<summary><b>📧 Gmail (IMAP/SMTP)</b></summary>

1. Enable 2FA → generate an App Password at [Google App Passwords](https://myaccount.google.com/apppasswords)
2. Add to `.env`: `GMAIL_EMAIL="you@gmail.com"` + `GMAIL_APP_PASSWORD="abcd efgh ijkl mnop"`
3. System auto-detects and switches from mock to real adapters

</details>

<details>
<summary><b>💬 Slack (MCP)</b></summary>

1. Create Slack app at [api.slack.com/apps](https://api.slack.com/apps) → add Bot Token Scopes: `channels:read`, `chat:write`, `search:read`, `users:read`
2. Install to workspace → copy Bot User OAuth Token
3. Dashboard: **Settings > Integrations > Slack** → paste token + Team ID

</details>

<details>
<summary><b>🐙 GitHub (MCP) · 📝 Notion (MCP)</b></summary>

- **GitHub**: Generate PAT at [github.com/settings/tokens](https://github.com/settings/tokens) (scopes: `repo`, `read:org`, `read:user`) → paste in **Settings > Integrations > GitHub**
- **Notion**: Create integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) → copy Internal Integration Secret → share pages with integration → paste in **Settings > Integrations > Notion**

</details>

---

## 📸 Screenshots

<div align="center">

| Landing Page | Agent Network |
|:---:|:---:|
| ![Hero](docs/screenshots/01-hero.png) | ![Agents](docs/screenshots/02-agents.png) |

| Workflow Execution | Pricing |
|:---:|:---:|
| ![Workflow](docs/screenshots/03-workflow.png) | ![Pricing](docs/screenshots/04-pricing.png) |

| Login | Register |
|:---:|:---:|
| ![Login](docs/screenshots/05-login.png) | ![Register](docs/screenshots/06-register.png) |

| Onboarding | |
|:---:|:---:|
| ![Onboarding](docs/screenshots/07-onboarding.png) | |

</div>

---

## 🖥️ Dashboard Pages

| Page | Description |
|:-----|:------------|
| 🏠 **Home** | Mission control — activity feed, approvals, quick actions |
| 🏢 **Workspace** | Command center — text/voice input, DAG view, agent tracker |
| ⚡ **Builder** | Vibe Coding IDE — Monaco editor, chat, preview, deploy |
| 🐝 **Swarm** | Workflow inspector with agent timeline visualization |
| 🛡️ **Audit** | Audit & Compliance home — dashboard, log, reviewer queue, compliance frameworks |
| 🛡️ **Audit Runs** | Engagement detail — control matrix, workpapers, exceptions, final pack |
| 🔎 **Traces** | Full agent trace explorer with token/cost breakdown |
| 📊 **Analytics** | Usage metrics, cost tracking, agent performance charts |
| ⏰ **Schedules** | Cron-based recurring workflow management |
| 🔌 **Integrations** | MCP provider connections |
| 🔗 **Connectors** | Connector status and management |
| 🧠 **Knowledge** | Memory store — facts, preferences, policies |
| ⚙️ **Settings** | LLM provider config, approval thresholds |
| 👑 **Admin** | Tenant management, users, API keys, tool toggles |
| 📁 **Files** | Document upload, storage, and management |
| 📋 **My Tasks** | Personal task list and assignments |
| 👥 **Team** | Team management, departments, member roles |
| 🏢 **Company** | Company profile, brand voice, competitors, goals |
| 📨 **Inbox** | Notification center and message feed |
| 📅 **Calendar** | Calendar events and scheduling |
| 💬 **Social** | Social media management and drafts |
| ✏️ **Social Drafts** | Draft social media posts for review |
| 🔧 **Tool Installer** | Tool installation and configuration |
| 📜 **Standing Orders** | Persistent tool allowlists and blocked actions |
| 💡 **Skills** | Reusable workflow templates and skill library |
| 🏃 **Runs** | Workflow run history and results |
| 💳 **Billing** | Subscription plans, usage, credits |

---

## 🔧 Tool Inventory (122 Registered)

| Category | Count | Key Tools | Status |
|:---------|:-----:|:----------|:------:|
| **Email** | 10 | read_email, draft_email, send_email, gmail_read_inbox, gmail_send_email, track_email_engagement | ✅ Real (Gmail IMAP/SMTP) |
| **Calendar** | 3 | list_calendar_events, create_calendar_event, find_availability | ✅ Real (CalDAV) |
| **CRM** | 14 | lookup_crm_contact, update_crm_record, search_deals, enrich_contact, score_lead, predict_churn | 🔌 Pluggable adapter |
| **Browser** | 30 | navigate, extract, fill_form, click, screenshot, analyze_page, manage_cookies, evaluate_js, pdf_export | ✅ Real (Playwright) |
| **Document** | 16 | summarize_document, extract_document_data, pdf_extract_text, pdf_analyze, generate_report, file_read, file_write | ✅ Real (pdf-parse + DALL-E) |
| **Research** | 33 | web_search, web_fetch, classify_text, audit_seo, research_keywords, analyze_serp, code_execute | ✅ Real (web) |
| **Spreadsheet** | 4 | parse_spreadsheet, compute_statistics, generate_report, export_csv | ✅ Built-in |
| **Knowledge** | 10 | search_knowledge, memory_store, memory_retrieve, ingest_document | ✅ Real (DB-backed) |
| **Webhook** | 2 | send_webhook, deploy_to_vercel | ✅ Built-in |
| **MCP** | Dynamic | Slack, GitHub, Notion + 18 more loaded at runtime | ✅ Real (MCP servers) |

Tool maturity labels enforced by CI: `pnpm check:truth` fails if any tool ships unclassified.

---

## ⚖️ How JAK Swarm Compares

| Feature | JAK Swarm | CrewAI | LangGraph | Devin |
|:--------|:---------:|:------:|:---------:|:-----:|
| Pre-built agents | **38** | 0 | 0 | 1 |
| Tools | **122** | 50+ | Custom | ~10 |
| Built-in UI | **26 pages** | — | LangSmith | IDE |
| **Gemini + OpenAI** (per-tenant) | ✅ | ❌ | ❌ | ❌ |
| **Google ADK orchestration** | ✅ | ❌ | ❌ | ❌ |
| **Google Search Grounding** | ✅ | ❌ | ❌ | ❌ |
| SOC 2 / HIPAA / ISO 27001 audit pack | ✅ | ❌ | ❌ | ❌ |
| Self-debugging loop | ✅ 3 retries | Limited | Manual | Limited |
| Open source | ✅ MIT | ✅ MIT | ✅ MIT | — $20/mo |

---

## 🔭 Long-Term Vision

JAK is evolving from a multi-agent workflow operator into an ever-learning Company OS that remembers company context, understands departmental roles, and safely completes approved work across the organisation. JAK Shield is the MCP-native trust gateway that protects every real-world agent action.

<details>
<summary><b>Vision diagram and time horizons</b></summary>

```mermaid
flowchart TB
    subgraph INPUTS["1. Company Inputs"]
        I1["Calls"] & I2["Meetings"] & I3["Docs"] & I4["Websites"]
        I5["Emails"] & I6["Code"] & I7["Tasks"] & I8["CRM"] & I9["Support"]
    end

    subgraph MEMORY["2. Company Memory Layer"]
        M1["Transcripts"] & M2["Decisions"] & M3["Policies"] & M4["People"]
        M5["Projects"] & M6["Risks"] & M7["Evidence"]
    end

    subgraph INTELLIGENCE["3. Role-Based Intelligence Layer"]
        R1["CEO"] & R2["HR"] & R3["CTO"] & R4["CMO"]
        R5["Finance"] & R6["Legal"] & R7["Ops"] & R8["Support"]
    end

    subgraph PERMISSIONS["4. Permission + Governance Layer"]
        P1["RBAC"] & P2["Dept access"] & P3["Approval gates"]
        P4["Agent Governance Overlay"] & P5["JAK Shield MCP"]
        P6["Audit evidence"] & P7["Autonomy Ladder"]
    end

    subgraph EXECUTION["5. Approved Execution Layer"]
        E1["Plan"] & E2["Assign"] & E3["Execute"]
        E4["Verify"] & E5["Report"] & E6["Learn again"]
    end

    INPUTS --> MEMORY --> INTELLIGENCE --> PERMISSIONS --> EXECUTION
    EXECUTION -->|"feedback loop"| MEMORY
```

**Short term (Phase 1-4)** — Foundation: Agent Profile Registry, Ability Packs, Thread Model, Company Memory Base, Role-Based Memory Permissions, Marketing OS backend. Security enforced by local policy logic in `packages/security`.

**Medium term (Phase 5-10)** — Intelligence + Governance: Commander Coach, Capability Gap Detector, Agent Forge, Evaluation + Learning Loop, Autonomy Ladder (L0-L4 with local policy; L5 deferred). Agent Governance Overlay enforces profiles, scopes, and role boundaries using local policy.

**Long term (Phase 11A-11B)** — Production Hardening + JAK Shield MCP Integration:
- Phase 11A: Production hardening, Cloud Run Worker cutover
- Phase 11B: Full JAK Shield MCP signed-decision integration for high-risk action validation (separate MCP-native gateway at [github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield))

**HyperAgent self-healing + self-learning layer** (merged to `main`, Phases 0-15): a bounded, test-driven layer that evaluates and improves JAK Swarm without weakening it. Phases 0-15 are built and gate-green: Phase 0 baseline audit; Phase 1 central autonomy policy (L0-L5 + human-only NEVER set); Phase 2 20-class failure taxonomy + repair budget; Phase 3 outcome evaluator; Phase 4 root-cause diagnosis + genuine symbolic plan repair (Innovations #1 + #3); Phase 5 self-learning pipeline (info-theoretic gate #2, Bayesian evidence accrual #5, hazard-model expiry #10); Phase 6 approved-spec closed loop; Phase 7 governance + red-team/counterfactual/DP innovations (#4/#7/#8/#9); Phase 8 `ShieldMcpClient` (local signed decisions, fail-closed on unavailable/unverified); Phase 9 versioned config lifecycle (shadow→canary→promote/rollback); Phase 10 meta-optimiser; Phase 11 ADK parity; Phase 12 R5 code self-repair (isolated branch + draft PR only, never auto-merge); Phase 13 honest Control Centre aggregation (9 views, `dataAvailable` flags — no fake "all healthy"); Phase 14 failure-injection framework + integration proof (16 modes, 9 end-to-end scenarios); Phase 15 honest docs + wired-vs-pure-core verification. A 16-bug hardening sweep then landed further safety fixes across the layer (host-JS `code_execute` production-disabled, clearable graph `error` channel, Shield subject-substitution defense, unified retry accounting, DP-noise scale fix, cyclic-spec rejection, code-repair path normalization, node-timeout timer-leak fix, risk-classifier security floor unbypassable).

**Honest scope — what is wired vs what is pure-core-only (verified against source):**
- ✅ **Wired into the live LangGraph graph (OFF-gated, non-regressing):** deterministic 20-class failure classifier → counterfactual fault diagnosis → symbolic replanner + plan validator → selective re-execute-only-invalidated-tasks. The legacy bounded-retry path is unchanged.
- ✅ **Wired / enforced as policy cores:** central autonomy policy (L0-L5 matrix + human-only NEVER set), versioned config lifecycle state machine (DRAFT→PROPOSED→SHADOW→CANARY→PROMOTED→ROLLED_BACK), R5 code-repair gate (isolated `hyperagent/r5-*` branch + draft PR, never auto-merge, forbidden symbols/paths), ADK parity (roles-from-plan + Kahn dependency-ordered waves + honest approval-pause docs), and the 9 reviewer-gated Control Centre routes (honest `dataAvailable` flags).
- 🟡 **Pure cores with unit + integration tests, NOT yet wired into the live execution path:** outcome evaluator + acceptance checker, learning extraction / persist / recall, mutual-information learning gate, meta-optimiser (UCB1/ε-greedy bandit over arms), R2 `CORRECT_OUTPUT` typed correction, and the `ShieldMcpClient` itself (signs/verifies/fail-closed at the unit level but never instantiated in runtime).
- ❌ **Not yet implemented:** the full `executeApprovedSpec` closed loop (only the pure `materializePlan` half exists — no method starts a real workflow / evaluates acceptance / resolves drift), learning dedup / conflict / scoping, `AuditLog` HMAC row-chain hashing, and the `agent-governance-overlay.ts` aggregate file (Shield pieces live under `shield-gateway/` instead).
- ✅ **Resolved (Fix 2 + 16-bug sweep):** retry accounting is unified on `taskRetryCount` + a single shared `MAX_TASK_RETRIES=2` — the verifier and the afterVerifier edge now read the **same field** against the **same constant**, so they can no longer disagree (previously three divergent counters/ceilings coexisted: verifier `_retries`@MAX=2, edge `taskRetryCount`@MAX=3 [dead], and the wrapVerifierNode increment). The 16-bug hardening sweep also landed the safety fixes listed above.
- 🟡 **Env-blocked, not fake-passed:** the live 12-step E2E + Cloud Run deploy gate that would prove *measured learning impact in production*, the external JAK Shield MCP network transport, and persisted benchmark evaluation (`BENCHMARKS_PERSISTED=false`).

The pure-core layer is proven by 2,905 unit + integration tests; integration tests compose the pure cores end-to-end (real plan repair, learning promotion, Shield fail-closed, config rollback) but do **not** imply those cores run inside every live workflow. JAK Swarm stays the execution engine; the HyperAgent layer only observes/proposes/replans; JAK Shield stays the independent trust gateway.

</details>

Full roadmap with implementation milestones and honest scope boundaries: [`docs/ROADMAP.md`](docs/ROADMAP.md). Full architecture plan: [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md).

---

## 🏗️ Tech Stack

| Layer | Technology |
|:------|:-----------|
| **Monorepo** | pnpm workspaces + Turborepo |
| **Language** | TypeScript 5.7 (strict) |
| **API** | Fastify |
| **Frontend** | Next.js 16, React 19, Tailwind CSS |
| **DAG Visualization** | React Flow |
| **Database** | PostgreSQL + Prisma ORM + pgvector |
| **Auth** | Supabase (email/password + magic link) + JWT + API keys |
| **Durable Workflows** | LangGraph StateGraph + PostgresCheckpointSaver |
| **ADK Orchestration** | @google/adk (SequentialAgent + ParallelAgent) |
| **LLM — OpenAI** | GPT-5.5 / GPT-5.4 — Responses API, json_schema strict mode |
| **LLM — Gemini** | Gemini 2.5 Pro / Flash / Flash-Lite — parallel function calling, responseSchema, Google Search Grounding |
| **Search — Gemini** | GOOGLE_SEARCH (ADK built-in) / googleSearch grounding — included quota, citation-backed |
| **Search — OpenAI** | web_search_preview hosted tool — included quota, native |
| **Browser Automation** | Playwright |
| **Email** | imapflow (IMAP) + nodemailer (SMTP) |
| **Calendar** | tsdav (CalDAV) |
| **PDF** | pdfkit, pdf-parse |
| **External Integrations** | Model Context Protocol (MCP) |
| **Testing** | Vitest |
| **Schema Validation** | Zod |
| **OpenAPI** | `zod-to-json-schema` — auto-generated from Zod schemas |

---

## 📁 Project Structure

```
jak-swarm/
├── apps/
│   ├── api/                     # Fastify REST API (port 4000)
│   │   └── src/
│   │       ├── routes/           # Route modules (workflows, approvals, audit, compliance, ...)
│   │       ├── services/         # Business logic (audit, compliance, swarm-execution, ...)
│   │       ├── middleware/       # Auth, RBAC, rate limiting
│   │       └── openapi/         # Zod → JSON Schema → OpenAPI spec
│   └── web/                     # Next.js 16 dashboard (port 3000)
│       └── src/app/(dashboard)/ # 26 dashboard pages
├── packages/
│   ├── adk/                      # 🆕 Google ADK orchestration (JAK_ADK_MODE=1)
│   │   ├── bridge/              # JAK → ADK tool bridge (FunctionTool, GOOGLE_SEARCH)
│   │   ├── agents/              # LlmAgent wrappers for Commander, Planner, Workers, Verifier
│   │   ├── deploy/              # Agent Engine gateway (agent-engine-entry.ts, resource ID)
│   │   ├── orchestration/       # SequentialAgent + ParallelAgent pipeline + Runner bridge
│   │   └── types/               # Type augmentation for @google/adk v1.3.0
│   ├── agents/                  # 38 agent implementations
│   │   ├── base/                # BaseAgent (decomposed: llm-call, prompt-builder, tool-execution)
│   │   ├── roles/               # 6 orchestrator agents
│   │   ├── workers/             # 32 worker agents
│   │   └── runtime/             # OpenAI + Gemini runtime adapters + grounding config
│   ├── tools/                   # 122 builtin tools (Phoring integration removed)
│   │   ├── registry/            # Singleton ToolRegistry + approval policy
│   │   ├── builtin/             # Built-in + sandbox tools
│   │   ├── adapters/            # Email, Calendar, CRM, Browser, Memory
│   │   └── mcp/                 # MCP client + bridge + provider configs
│   ├── swarm/                   # Orchestration engine
│   │   ├── graph/               # LangGraph nodes + task scheduler
│   │   ├── runner/              # SwarmRunner execution loop
│   │   ├── state/               # Immutable SwarmState
│   │   └── supervisor/          # Event bus, circuit breakers, telemetry
│   ├── db/                      # Prisma schema, migrations, seed
│   ├── security/                # Audit logging, RBAC, guardrails, encryption
│   ├── client/                  # @jak-swarm/client TypeScript SDK
│   ├── shared/                  # Shared types, enums, skills parser
│   ├── skills/                  # Tenant skill registry + proposal flow
│   ├── voice/                   # Voice pipeline (WebRTC, STT, TTS)
│   ├── verification/            # Email/document/transaction verification
│   ├── whatsapp-client/         # WhatsApp bridge (Baileys QR client)
│   └── industry-packs/           # 13 industry pack registry entries (11 shipped: customer-support, education, finance, general, healthcare, hospitality, insurance, legal, logistics, recruiting, retail + 2 stubs: manufacturing, consulting)
├── tests/
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── e2e/                     # End-to-end tests
├── docker/                      # Docker Compose for Postgres, Redis
├── scripts/                     # Dev scripts, doctor, setup
└── docs/                        # Documentation
```

---

## 🔐 Security

| Risk Level | Examples | Approval Required |
|:-----------|:---------|:-----------------:|
| 🟢 `READ_ONLY` | web_search, file_read, list_calendar | Never |
| 🟡 `DRAFT_ONLY` | draft_email, create_calendar_event (uncommitted) | Never |
| 🟡 `SANDBOX_EDIT` | Browser ops within sandbox | Configurable |
| 🟠 `LOCAL_EXEC_ALLOWLIST` | Code execution, file write (allowlisted tools) | Configurable |
| 🟠 `EXTERNAL_ACTION_APPROVAL` | send_email, send_webhook, post_slack | Always |
| 🔴 `CRITICAL_MANUAL_ONLY` | delete records, credential rotation, production deploys | Always |

- **AES-256-GCM** field-level encryption available for sensitive workflow data; tenant secrets are protected through environment secret storage, Supabase Vault, and Google Secret Manager where deployed
- **JWT** auth with per-tenant isolation enforced at middleware level
- **bcrypt** password hashing (12 rounds)
- **PII redaction** at LLM boundary and at write time
- **5-layer hallucination detection** (heuristic/regex-based) on every agent output: grounding check, invented statistics, fabricated sources, overconfidence, impossible claims
- **RBAC** roles: `END_USER` < `REVIEWER` < `OPERATOR` < `TENANT_ADMIN` < `SYSTEM_ADMIN` + `EXTERNAL_AUDITOR`

Full security policy: [`SECURITY.md`](SECURITY.md)

---

## 🛠️ Development

```bash
pnpm test                  # Run all tests (2800+ blocking CI)
pnpm typecheck             # Type checking (strict mode, zero errors)
pnpm lint                  # Lint
pnpm check:truth           # Verify tool classifications + landing claims
pnpm audit:tools           # Audit all 122 tools against registry

# Run specific package tests
pnpm --filter @jak-swarm/agents test
pnpm --filter @jak-swarm/tools test
pnpm --filter @jak-swarm/swarm test
pnpm --filter @jak-swarm/adk test
```

### Adding a New Agent

1. Create `packages/agents/src/workers/your-agent.ts` (follow `growth.agent.ts` pattern)
2. Export from `packages/agents/src/index.ts`
3. Add `AgentRole.WORKER_YOUR_ROLE` to `packages/shared/src/types/agent.ts`
4. Add case to `createWorkerAgent()` in `packages/swarm/src/graph/nodes/worker/agent-factory.ts`
5. Add case to `buildTaskInput()` in `packages/swarm/src/graph/nodes/worker/task-input-builders.ts`
6. Add `infer*Action()` in `packages/swarm/src/graph/nodes/worker/intent-inference/text.ts`
7. Add role description to `packages/agents/src/roles/planner.agent.ts`
8. Run `pnpm turbo build` to verify

### Adding a New Tool

1. Add `toolRegistry.register(metadata, executor)` in `packages/tools/src/builtin/index.ts`
2. Define `inputSchema` / `outputSchema` (JSON Schema)
3. Set `riskClass` (`READ_ONLY` → `CRITICAL_MANUAL_ONLY`) and `maturity` label
4. Run `pnpm turbo build` to verify

### Adding a New LLM Provider

Follow the `GeminiRuntime` adapter pattern: create a runtime adapter that converts message shapes, map tool definitions, and translate responses back. Wire it through `BaseAgent.setContextOverride()`. See [`gemini-runtime.ts`](packages/agents/src/runtime/gemini-runtime.ts) as reference.

### Using Google ADK Orchestration

Set `JAK_ADK_MODE=1` in your `.env`. Workflows will route through `@google/adk`'s `SequentialAgent` + `ParallelAgent` pipeline instead of LangGraph. Falls back to LangGraph on ADK error. See [`packages/adk/`](packages/adk/) for architecture details.

---

## 📚 Documentation

| Doc | Description |
|:----|:-----------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Full system architecture, data model, error handling, scaling |
| [`AGENTS.md`](AGENTS.md) | Every agent role: purpose, input/output contracts, handoff logic |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting, SLA, scope, cryptographic assumptions |
| [`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md) | Local policy defenses (claim-to-code mapping) — JAK Shield is a separate 10-stage MCP gateway ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)) |
| [`docs/audit-compliance-agent-pack.md`](docs/audit-compliance-agent-pack.md) | Audit & Compliance product overview |
| [`docs/audit-framework-library.md`](docs/audit-framework-library.md) | Per-framework + per-control reference (SOC 2, HIPAA, ISO 27001) |
| [`docs/audit-api.md`](docs/audit-api.md) | Audit endpoint reference + error codes + SSE channel |
| [`docs/audit-workpapers.md`](docs/audit-workpapers.md) | Workpaper generation + approval flow |
| [`docs/beta-release.md`](docs/beta-release.md) | Beta scope, go/no-go checklist, production readiness |
| [`docs/team-and-trial.md`](docs/team-and-trial.md) | Team hierarchy, free trial, daily caps |
| [`docs/connector-runtime.md`](docs/connector-runtime.md) | Connector Runtime design + phase status |
| [`docs/vibe-coding.md`](docs/vibe-coding.md) | Vibe Coding pipeline, cost tables, feature comparison |
| [`docs/faq.md`](docs/faq.md) | Full FAQ — product, trial, security, integrations, costs |
| [`docs/api-reference.md`](docs/api-reference.md) | Complete API endpoint reference |
| [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md) | Google Cloud Run deployment guide for live API and pending Worker rollout |
| [`docs/environment-setup.md`](docs/environment-setup.md) | Environment variables, integration setup, troubleshooting |
| [`docs/agent-run-cockpit.md`](docs/agent-run-cockpit.md) | Cockpit audit event vocabulary |
| [`docs/competitive-positioning.md`](docs/competitive-positioning.md) | Market positioning analysis |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Long-term vision, 5-layer Company OS evolution, honest scope boundaries |
| [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md) | Next-evolution architecture — JAK Shield MCP integration, Agent Governance Overlay, Company Memory, Agent Forge, Commander Coach, Ability Packs, Autonomy Ladder, 11-phase implementation roadmap |

---

## ❓ Common Questions

<details>
<summary><b>Is JAK Swarm production-ready?</b></summary>

**This is a working beta build (0.1.0-beta.0).** The architecture is solid (LangGraph + ADK + Postgres checkpointer + signed evidence bundles + JAK Shield local policy controls). 2,900+ blocking CI tests (unit + integration). Zero TypeScript errors under strict mode.

**Enterprise SLA packaging, expanded observability, and production hardening are part of the post-build roadmap.** Specific items on that roadmap: live-hosted smoke tests, third-party security audit/certification, lawyer-reviewed ToS/DPA, pen test, AuditLog row chain-hashing, and incident-response runbook.

Full checklist: [`docs/beta-release.md`](docs/beta-release.md).

</details>

<details>
<summary><b>Does JAK have SOC 2 / HIPAA / ISO 27001 certification?</b></summary>

**No.** The *infrastructure* is shipped (182 controls seeded, 108 operationally backed, HMAC-signed evidence bundles, External Auditor Portal) — everything an external auditor needs. The actual third-party attestation has not happened. We deliberately avoid phrases that imply certification we don't have.

</details>

<details>
<summary><b>Can I self-host?</b></summary>

**Yes.** MIT-licensed, the code is here. Docker for Postgres + Redis, an API key, Node 20+, pnpm 9+. No cloud-only feature — the same code that runs at jakswarm.com is what you self-host.

</details>

<details>
<summary><b>What is Google ADK orchestration?</b></summary>

Google's Agent Development Kit (`@google/adk`) provides `SequentialAgent`, `ParallelAgent`, and `LlmAgent` primitives for building multi-agent workflows. When `JAK_ADK_MODE=1`, JAK routes workflows through ADK's orchestration instead of LangGraph. The output shape is identical (SwarmState) so persistence and SSE work unchanged. **ADK parity (HyperAgent Phase 11, opt-in):** when the caller supplies `plannerPlan` / `approvalGate`, ADK now takes worker roles **from the Planner's plan** (unique in first-appearance order), partitions them into **dependency-ordered waves** via a Kahn topo-sort (a depended-on role's wave runs before its dependents'), and **pauses for approval** on `requiresApproval` or EXTERNAL_SIDE_EFFECT/DESTRUCTIVE risk (allow ⇒ execute; deny/approval_required ⇒ the tool does not run, recorded for review). Legacy ADK runs (no `plannerPlan`/`approvalGate`) are byte-for-byte unchanged. ADK's built-in `GOOGLE_SEARCH` tool provides citation-backed web search for Gemini agents (included quota; see [Gemini pricing](https://ai.google.dev/pricing) for limits beyond the allowance).

</details>

<details>
<summary><b>Do I need Serper or Tavily for web search?</b></summary>

**No.** When `GEMINI_GOOGLE_SEARCH_GROUNDING=1`, Gemini agents use Google Search Grounding (built-in with included quota). When `OPENAI_WEB_SEARCH=1`, OpenAI agents use `web_search_preview` (built-in with included quota). Both provide real-time web search without any external search API keys. If neither flag is set, JAK falls back to its built-in `web_search` tool (which can optionally use Serper for enhanced results).

</details>

Full FAQ: [`docs/faq.md`](docs/faq.md)

---

## 📄 License

MIT — free for commercial and personal use. See [`LICENSE`](LICENSE).

---

<div align="center">

**Built with ❤️ by [InBharat AI](https://github.com/inbharatai)**

[Website](https://jakswarm.com) · [Quick Start](#-quick-start) · [Architecture](ARCHITECTURE.md) · [Security](SECURITY.md) · [FAQ](docs/faq.md)

[![GitHub stars](https://img.shields.io/github/stars/inbharatai/jak-swarm?style=social)](https://github.com/inbharatai/jak-swarm)
[![Twitter Follow](https://img.shields.io/twitter/follow/inbharatai?style=social)](https://twitter.com/inbharatai)

</div>
