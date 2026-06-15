# Google Agents Challenge — Submission

## Description

**JAK Swarm — Gemini-Powered Agentic Business Operating Layer**

### Problem

Teams increasingly want AI agents to execute real business goals: research competitors, update CRMs, send emails, manage workflows, analyze documents, generate content, deploy code, and coordinate operations. But most agents either stay at the chatbot level, refuse to act, or act without sufficient security, verification, and auditability.

### Solution

JAK Swarm is a multi-agent operating layer that converts a human goal into a secure, dependency-aware execution plan. A **Commander** interprets the goal, a **Planner** creates a task DAG, a **Router** assigns work to specialist agents, **JAK Shield** validates safety and permissions, worker agents execute with real tools, and a **Verifier** checks the output against the original intent.

The system supports **Gemini as a first-class runtime**, allowing agents to use Gemini 2.5 Pro, Flash, and Flash-Lite depending on task complexity. It also supports **Google ADK (Agent Development Kit)** for native Agent Engine deployment on Vertex AI (live at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728`).

---

## Core Capabilities

- **38 specialist agents** across orchestration, executive, coding, operations, and core workflow layers
- **122 classified tools** mapped through a risk-based execution model (READ_ONLY → CRITICAL_MANUAL_ONLY)
- **Gemini-powered agent runtime** using `FunctionDeclaration[]` for tool calling, `responseSchema` for structured output, safety filtering, and controllable reasoning tiers
- **Google ADK integration** — standalone `@jak-swarm/adk` package bridges JAK's 122 tools into ADK `FunctionTool` instances for ADK orchestration mode, wraps agents as ADK `LlmAgent` nodes, and deploys `SequentialAgent` / `ParallelAgent` pipelines. The deployed Agent Engine gateway has 6 tools: `google_search` for grounding + 5 `FunctionTool` wrappers (create_workflow, get_workflow_status, get_workflow_traces, search_knowledge, approve_request) that call the JAK Cloud Run API at `/workflows`, `/memory`, `/approvals`.
- **Dependency-aware task planning** using LangGraph workflows with PostgreSQL checkpoints for durable execution
- **Live per-tenant provider switching** — each organization can choose between OpenAI and Gemini from the Settings UI without changing environment variables, redeploying, or editing code. The choice persists in tenant memory and `BaseAgent.setContextOverride()` routes subsequent agent calls through the selected provider at runtime
- **JAK Shield security layer** — 6-stage pipeline: Agent Firewall (injection + offensive-cyber detection), Risk-Based Approvals (6-tier tool risk lattice), Secure Tool Permissions (per-tenant registry, role-gated installer), Sandboxed Execution (per-tenant browser sessions, URL allowlists, path-traversal guards), Defensive Vulnerability Triage (boundary between offensive and defensive security work), Audit Evidence Layer (HMAC-SHA256 signed bundles, timing-safe verification)
- **Human approval gates** for destructive, sensitive, or high-risk actions
- **Verifiable audit trails** with HMAC-SHA256 signed evidence bundles, per-tenant key derivation, and canonical JSON for signature stability
- **CI-enforced truth claims** — tests that fail the build if the README or landing page claims more than the code supports (agent counts, tool counts, connector counts, beta wording, badge URLs)

---

## Gemini / Google AI Usage

JAK uses Gemini as a production-grade agent runtime. Gemini models are used for:

- Goal interpretation (Commander agent)
- Dependency-aware planning (Planner agent)
- Function/tool calling across all 122 tools via `FunctionDeclaration[]`
- Structured JSON output via `responseSchema` (Zod → JSON Schema → Gemini `generationConfig.responseSchema`)
- Safety-aware task execution with Gemini's built-in safety filtering
- Lightweight routing, classification, and guardrails with Flash-Lite
- Higher-reasoning orchestration and verification with Pro
- Google Search grounding for real-time information (`googleSearch` tool declaration)
- Vertex AI Search datastore grounding for enterprise knowledge

### 3-Tier Routing Strategy

| Tier | Gemini Model | OpenAI Model | Assigned to |
|------|-------------|-------------|-------------|
| Premier (Tier 3) | Gemini 2.5 Pro | GPT-5.5 | Commander, Planner, Verifier, CEO/CMO/CFO |
| Balanced (Tier 2) | Gemini 2.5 Flash | GPT-5.4 | Code Generator, Architect, Research |
| Economy (Tier 1) | Gemini 2.5 Flash-Lite | GPT-5.4 | Router, Guardrail, simple workers |

All 122 tools run through the same `FunctionDeclaration[]` interface regardless of tier or provider.

### Google ADK Integration

The `@jak-swarm/adk` package provides a first-class bridge between JAK Swarm and Google's Agent Development Kit:

- **Tool Bridge** (`jak-tool-bridge.ts`): Converts JAK's `ToolRegistry` tools to ADK `FunctionTool` instances using `jsonSchemaToZod()` for parameter conversion, with a module-level side channel (`setJakExecutionContext` / `clearJakExecutionContext`) to thread JAK's `ToolExecutionContext` through ADK tool calls
- **Agent Wrappers** (`jak-adk-agents.ts`): Creates ADK `LlmAgent` instances for Commander, Planner, Workers, Verifier, and Synthesis roles. Model selection mirrors JAK's tier routing: Gemini Pro for Commander/Verifier, Flash for workers
- **Orchestration Pipeline** (`adk-pipeline.ts`): Builds `SequentialAgent` pipeline: Commander → Planner → `ParallelAgent(workers)` → Synthesis → Verifier. Also provides `buildSimpleAdkPipeline()` for single-agent tasks and `buildDynamicAdkPipeline()` for plan-driven worker creation
- **Runner Bridge** (`adk-runner.ts`): `runWithAdk()` creates an ADK `Runner` + `InMemorySessionService`, runs the pipeline, collects events, and converts results to `Partial<SwarmState>` compatible with JAK's persistence/SSE infrastructure
- **Agent Engine Deployment** (`agent-engine-entry.ts`): Creates standalone ADK agents deployed to Google Cloud's Agent Engine (Vertex AI) at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` — a `createJakGatewayAgent()` for full workflow orchestration and `createJakDirectAgent()` for single-turn tasks. Both use `GOOGLE_SEARCH` for real-time grounding and 5 `FunctionTool` wrappers that call back to JAK's Cloud Run API at `/workflows`, `/memory`, `/approvals`

ADK mode is activated via `JAK_ADK_MODE=1`. The `@google/adk` SDK is lazy-loaded — only imported when ADK mode is enabled, keeping the default path lightweight.

---

## Technology Stack

- **Gemini 2.5 Pro / Flash / Flash-Lite** for agent reasoning and tool execution
- **Google Generative AI SDK** (`@google/generative-ai`) for direct Gemini API calls
- **Google Agent Development Kit** (`@google/adk`) for Agent Engine deployment (live at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728`)
- **LangGraph** for multi-step workflow orchestration
- **LangChain** for agent abstractions
- **PostgreSQL / Supabase** for tenant configuration, checkpoints, audit logs, and traces
- **Redis** for queues, scheduled tasks, and workflow state
- **Fastify** API backend
- **Next.js** frontend
- **Playwright** for sandboxed browser automation
- **MCP connectors** for external SaaS tools
- **Zod** for schema validation and structured outputs
- **OpenTelemetry, Sentry, Prometheus, Pino** for observability
- **Docker, Railway, Vercel** for deployment

---

## Data Sources & Integrations

JAK connects to business and productivity systems through secure tenant-authorized integrations, including:

Gmail, Calendar, Google Drive, GitHub, Slack, Notion, HubSpot, Salesforce, Stripe, CRM and document systems, web search and browser automation tools, and MCP-based connectors for additional SaaS tools.

---

## Security Model

JAK Shield sits between the user, model, tools, and external systems through a **6-stage pipeline**:

1. **Agent Firewall** — 22 regex patterns for prompt injection detection + 6 offensive-cyber categories with defensive-marker down-weighting. High-confidence hits throw a structured error, ending the workflow in `FAILED` state
2. **Risk-Based Approvals** — 6-tier risk lattice (READ_ONLY / WRITE / DESTRUCTIVE / EXTERNAL_SIDE_EFFECT mapped through DRAFT_ONLY / SANDBOX_EDIT / LOCAL_EXEC_ALLOWLIST / EXTERNAL_ACTION_APPROVAL / CRITICAL_MANUAL_ONLY). The registry chokepoint returns `outcome:'approval_required'` without executing the tool. Payload hash binding prevents replay
3. **Secure Tool Permissions** — Per-tenant tool registry, industry-pack restrictions, role-gated installer, workflow-scoped Standing Orders
4. **Sandboxed Execution** — Per-tenant browser data directories, URL allowlists (blocks localhost/RFC1918/cloud-metadata), DNS-rebinding defense, path-traversal guards, idle-session sweep
5. **Defensive Vulnerability Triage** — The offensive-cyber detector's `DEFENSIVE_MARKERS` list allows defensive security work (audit, review, harden, CVE, OWASP, SAST) while blocking offensive requests (malware creation, exploit generation, credential theft, unauthorized scanning, phishing). A dedicated defensive-review agent is documented but not yet implemented
6. **Audit Evidence Layer** — HMAC-SHA256 signed evidence bundles with per-tenant key derivation, canonical JSON for signature stability, timing-safe verification, at-rest field encryption (AES-256-GCM)

High-risk actions are never executed silently. Sensitive actions require explicit approval. Tenant credentials are only used through authorized access.

### Honest Gaps

- Audit log rows are not chain-hashed — a system administrator with direct database access could rewrite a row. We document this gap explicitly
- JAK Shield's external MCP gateway (`mcp` source type) is a future seam — currently only the `local` implementation exists
- SOC 2, formal pentest, and full compliance certification are not yet completed

---

## Key Learning

The main learning from building JAK Swarm is that agentic AI is not only about better prompts or stronger models. Real business automation requires planning, routing, permissions, verification, observability, durable execution, and security at every tool boundary.

A second learning: the tool-calling loop is the real integration surface. Today, when Gemini calls a tool, we manually handle the full cycle — parse the `functionCall`, match it to the right internal tool, validate permissions and risk, execute the tool, build the `functionResponse`, send it back in a new `generateContent` call, check if Gemini wants another tool call or final output, and repeat until completion. One agent call can require 2–8 tool turns. We built a custom Gemini runtime with `callTools()` in `gemini-runtime.ts`, plus `GeminiToolAdapter`, `GeminiMessageAdapter`, and `GeminiResponseParser` — roughly 800 lines of adapter/runtime code mainly to manage the tool loop and schema differences.

---

## Submission Questions

### On a scale from 1-5, how familiar are you with Google Cloud products? (1=none, 5=expert)

4

### On a scale from 1-5, how familiar are you with Google AI Studio? (1=none, 5=expert)

5

### Describe the readiness of your project for launch.

Beta — functional for design partners, not yet ready for unqualified enterprise production promises.

### Which specific feature of Agent Platform was most critical to your project's impact, and what is one thing it's's currently missing?

**Most critical feature:** Gemini function calling with `FunctionDeclaration[]`, combined with structured output through `responseSchema`.

This pairing was the most critical capability for JAK Swarm because it turned Gemini from a chatbot interface into a practical orchestration engine.

JAK Swarm is a 38-agent business operating layer. A user gives one goal, and the system decomposes it, creates a dependency-aware plan, routes tasks to specialist agents, executes tools, validates safety, and verifies the result. For this to work, agents cannot return loose free text. They need structured plans, reliable tool calls, and machine-readable outputs.

`FunctionDeclaration[]` lets every agent execute real tools through the `functionCall` / `functionResponse` loop. These tools include email, calendar, CRM, browser automation, research, document workflows, MCP connectors, and internal workflow actions — all 122 classified tools registered in the `ToolRegistry` and bridged into Gemini's function calling format by `GeminiToolAdapter`.

`responseSchema` lets orchestration agents return deterministic outputs. The Commander returns a structured goal breakdown, the Planner returns a valid DAG, the Router returns task assignments, and the Verifier returns a pass/fail result with reasoning traces. We convert Zod schemas to JSON Schema via `zod-to-json-schema`, strip the `$schema` key (Gemini doesn't need it), pass it as `responseSchema` in `generationConfig` alongside `responseMimeType: 'application/json'`, then validate the response with `schema.safeParse()` on top because Gemini's responseSchema is best-effort — we always validate with Zod for safety.

Together, these two features power the core JAK workflow: plan, route, execute, verify, and audit.

We route different agents across Gemini tiers:

- **Gemini 2.5 Pro** for Commander, Planner, Verifier, and complex reasoning
- **Gemini 2.5 Flash** for balanced worker agents
- **Gemini 2.5 Flash-Lite** for routing, classification, guardrails, and lightweight tasks

All 122 tools run through the same `FunctionDeclaration[]` interface regardless of tier.

Beyond direct Gemini API calls, we also integrate with **Google ADK** (`@google/adk`). The `@jak-swarm/adk` package bridges JAK's tool registry into ADK `FunctionTool` instances for ADK orchestration mode, wraps agents as ADK `LlmAgent` nodes, and builds `SequentialAgent` → `ParallelAgent(workers)` → `Verifier` pipelines. The deployed **Agent Engine gateway** at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` has 6 tools: `google_search` for grounding + 5 `FunctionTool` wrappers calling the JAK Cloud Run API. The 122-tool bridge is used in ADK orchestration mode (when `JAK_ADK_MODE=1`), not in the Agent Engine gateway.

**What is currently missing:** a native multi-turn tool execution loop in the Gemini SDK.

Today, when Gemini calls a tool, we manually handle the full cycle:

1. Parse the `functionCall`
2. Match it to the right internal tool
3. Validate permissions and risk through JAK Shield's 6-stage pipeline
4. Execute the tool
5. Build the `functionResponse`
6. Send it back in a new `generateContent` call
7. Check if Gemini wants another tool call or final output
8. Repeat until completion

In JAK, one agent call can require 2–8 tool turns. To make this reliable, we built a custom Gemini runtime with `callTools()` in `gemini-runtime.ts`, plus `GeminiToolAdapter`, `GeminiMessageAdapter`, and `GeminiResponseParser`. This added roughly 800 lines of adapter/runtime code mainly to manage the tool loop and schema differences.

A native SDK method like:

```
agent.run({ tools, maxTurns, responseSchema })
```

would be extremely valuable. It should automatically handle tool-call detection, tool execution callbacks, function response formatting, multi-turn continuation, structured final output, tool errors, safety/refusal handling, and traceable logs.

For JAK Swarm, this would reduce integration complexity, remove much of the adapter layer, improve developer experience, and make Gemini even stronger for production-grade agentic systems.

### If you could add one specific API capability or integration that would have saved you 2+ hours of work, what would it be?

A provider-agnostic tool-calling SDK in Gemini that accepts OpenAI-style tool schemas and maps roles/responses automatically. It would remove our ~800-line adapter layer and save 10+ hours debugging schema and `functionResponse` edge cases.

Specifically:
- OpenAI uses `tool_calls` with `function.name` / `function.arguments` inside `choices[0].message`; Gemini uses `functionCall` parts inside `candidates[0].content.parts[]`
- OpenAI tool results come as `role: 'tool'` messages with `tool_call_id`; Gemini wraps them as `functionResponse` parts inside a user-turn `Content`
- OpenAI allows consecutive assistant messages; Gemini requires alternating user/assistant roles, so we merge consecutive user messages in `chatMessagesToGeminiContents()`
- OpenAI includes `$schema` in JSON Schema; Gemini rejects it, so we strip it in `chatToolsToFunctionDeclarations()`

A unified tool-calling interface that handles these format differences transparently would eliminate our entire adapter layer.

### Additional Information

**JAK Shield** (separate repo: https://github.com/inbharatai/jak-shield) is designed as a security gateway for AI agents and tool calls. In JAK Swarm, it runs as a 6-stage local pipeline:

1. **Agent Firewall** — 22 regex patterns for prompt injection + 6 offensive-cyber categories with defensive-marker down-weighting
2. **Risk-Based Approvals** — 6-tier tool risk lattice with payload hash binding to prevent replay
3. **Secure Tool Permissions** — Per-tenant registry, industry-pack restrictions, role-gated installer, Standing Orders
4. **Sandboxed Execution** — Per-tenant browser sessions, URL allowlists, path-traversal guards, idle-session sweep
5. **Defensive Vulnerability Triage** — Boundary allowing defensive security work (audit, review, harden) while blocking offensive requests (malware, exploits, credential theft)
6. **Audit Evidence Layer** — HMAC-SHA256 signed bundles with per-tenant key derivation and timing-safe verification

**What we honestly don't have yet:**
- Audit log rows are not chain-hashed. A system administrator with direct database access could theoretically rewrite a row. We document this gap explicitly rather than claiming immutability
- JAK Shield's external MCP gateway is a future seam type (`'mcp'` in `ShieldGatewaySource`) — only the `'local'` implementation is wired today. There are no `shield.*` MCP tools in the current runtime
- SOC 2 certification, formal pentest, and full compliance attestation are not yet completed. Our compliance controls are seeded for 3 frameworks (SOC 2 Type 2, HIPAA Security Rule, ISO 27001:2022 — 182 total controls, 108 operationally backed, 74 requiring human attestation), but these are honest self-assessments, not certifications

**Per-tenant provider switching** is a full-stack feature: the Settings UI renders OpenAI and Gemini provider cards with toggle buttons. Choosing a provider calls `PUT /settings/llm/preferred-provider`, which persists the choice in `TenantMemory`. When a workflow starts, `swarm-execution.service.ts` reads the preference, decrypts the tenant's API key, and passes `llmProvider` + `llmApiKey` into the agent context. At the agent call level, `BaseAgent.setContextOverride()` detects the context provider, builds a fresh runtime for it (GeminiRuntime or OpenAIRuntime), executes, then clears the override in a `finally` block. Configured from the dashboard — no redeployment needed.

**CI-enforced honesty checks**: The repository includes truth-claims tests that fail the build if the README or landing page claims more than the code supports. These tests validate agent counts (38), tool counts (122), connector counts, beta wording, badge URLs, and public product stats against the implementation. They caught regressions during the contest period when restructure edits accidentally removed or overstated required content. We explicitly document current gaps instead of hiding them.

Overall, JAK Swarm is not only a multi-agent demo. It is an attempt to build a safer, auditable business operating layer where agents can plan, execute, verify, and be governed through security controls that are visible, testable, and honest.