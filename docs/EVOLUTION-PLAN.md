# JAK Swarm — Complete Evolution Plan: Company Operating System

> **Planning document only. No code changes made.**
> Generated: 2026-06-10

---

## 1. Current State Review

### What Already Exists

| Capability | Current Implementation | Maps To Vision |
|---|---|---|
| **Commander** | `commander-node.ts` + `CommanderAgent` — Parses user goal, produces `MissionBrief`, can short-circuit with `directAnswer`. Resolves UX role modes to canonical `AgentRole`. | Commander Coach foundation. Needs extension to capability gap detection, agent building, and coaching. |
| **Guardrail** | `guardrail-node.ts` + `GuardrailAgent` + JAK Shield 6-stage pipeline. Injection detection, offensive cyber blocking, PII redaction, tool risk classification. | Core of JAK Shield. Needs extension for agent profile validation, memory scope enforcement, autonomy level checks. |
| **Planner** | `planner-node.ts` + `PlannerAgent` — Decomposes `MissionBrief` into `WorkflowPlan` with DAG tasks, risk levels. | Stays. Will receive coaching from Commander. |
| **Router** | `router-node.ts` + `RouterAgent` — Maps tasks to agent roles, applies industry-pack restrictions. | Needs extension to route to temporary/dynamic agents and respect ability packs. |
| **Task Scheduler** | LangGraph `StateGraph` with dependency resolution, parallel execution. | Stays. Will handle Agent Forge agents. |
| **Worker Execution Loop** | `worker-node.ts` — Circuit breaker, `reflectAndCorrect()`, `RepairService` retry loop, context summarization. | Stays. Will be coached by Commander. |
| **Verifier** | `verifier-node.ts` + `VerifierAgent` + `@jak-swarm/verification` — Risk-tiered verification, email/document/transaction/identity analyzers. | Foundation for Agent Evaluation System. Needs extension for agent performance scoring. |
| **Replanner** | `replanner-node.ts` — Replans around failures. | Stays. |
| **SwarmState** | 35+ fields, LangGraph `SwarmStateAnnotation` with custom reducers. | Needs new fields: `capabilityGaps`, `coachingNotes`, `agentProfiles`, `memoryScopes`. |
| **LangGraph Orchestration** | `LangGraphRuntime`, `PostgresCheckpointSaver`, 8-node `StateGraph`. | Stays as primary orchestration. ADK remains alternate path. |
| **Google ADK Integration** | `packages/adk/` — Full bridge, `SequentialAgent` + `ParallelAgent` pipeline, `JAK_ADK_MODE=1`. | Remains primary Google-facing path. |
| **Gemini/OpenAI Runtime** | `GeminiRuntime`, `OpenAIRuntime`, `ProviderRouter`, tier-based model resolution, hallucination detection. | Stays. Dual-provider support continues. |
| **ToolRegistry** | 122 tools, `DefaultApprovalPolicy` (6-tier `ToolActionCategory`), `TenantToolRegistry`, `StandingOrder` allowlists. | Needs extension: ability pack tool boundaries, per-role tool access. |
| **38 Agents** | 6 orchestrators + 8 executive + 5 vibe-coding + 8 operations + 11 core workers. | Foundation. Will grow with temporary/sandboxed agents from Agent Forge. |
| **JAK Shield (6-stage)** | Agent Firewall, Risk-Based Approvals, Secure Tool Permissions, Sandboxed Execution, Vulnerability Triage, Audit Evidence. | Core security layer. Must extend to cover agent creation, memory scope, autonomy level, and role boundary enforcement. |
| **Tenant-Scoped Memory** | `TenantMemory` (key-value), `MemoryItem` (scoped, versioned, with approval workflow: extracted→suggested→user_approved/rejected), `MemoryEvent` (append-only audit trail). | Foundation for Company Memory Base. Currently flat key-value. Needs structured entity storage, scoped queries, and ingestion pipelines. |
| **Company Brain** | `CompanyProfileService` (LLM-extracted profiles), `CompanyOperatingLayerService` (artifact ingestion, entity extraction, drift detection, spec generation), `IntentRecordService`, `WorkflowTemplateService`. | Strong foundation. Currently manual ingestion. Needs auto-sync, cross-session grounding, and role-based access. |
| **Company Operating Layer** | `CompanyArtifact`, `CompanyKnowledgeSource`, `CompanyGraphEntity`, `ExecutionDriftFinding`, `AgentExecutableSpec`. | Schema exists. Needs ingestion pipelines for calls, documents, websites, emails, CRM, etc. |
| **Memory Approval** | `MemoryApprovalService` — Agents suggest memories (status: `extracted/suggested`), reviewers approve/reject. Full audit trail. | Exists and works. Will be extended for Company Memory Base. |
| **Vector Memory** | `PgVectorAdapter` (pgvector), `DocumentIngestor`, `EmbeddingService` (OpenAI + local fallback). | Exists. Needs expansion for multi-source ingestion and role-scoped retrieval. |
| **Approval Gates** | `approval-node.ts`, `ApprovalRequest` model with SHA-256 payload binding, `ApprovalScope` (replay prevention), `ApprovalAuditLog`, tenant-configurable thresholds. | Strong foundation. Needs extension for agent creation approvals, autonomy upgrade approvals, role-boundary approvals. |
| **Audit Evidence** | `AuditLogger` (40+ action types), `AuditLog` table, HMAC-signed evidence bundles, `AuditRunService` (full SOC 2/HIPAA/ISO 27001 engagement lifecycle). | Excellent foundation. Will cover all new agent/memory/autonomy actions. |
| **RBAC** | 5 roles: `END_USER`, `REVIEWER`, `OPERATOR`, `TENANT_ADMIN`, `SYSTEM_ADMIN`. `PolicyEngine` with `canApproveRiskLevel`, `canStartWorkflow`, `canManageSkills`, `canExecuteTool`, etc. | Foundation. Needs department-scoped RBAC, role-based memory boundaries, ability pack enforcement. |
| **Industry Packs** | 13 vertical configurations with restricted tools, allowed agents, compliance notes. | Foundation for Ability Packs. Needs role-based extension within each vertical. |
| **Skills System** | SKILL.md parser, cascade loading (workspace→project→org→tenant→user→bundled), 4 bundled packs. | Foundation for Skill Upgrade Loop. Needs learning extraction and recommendation. |
| **Departments** | `Department` model exists in Prisma schema (with `name`, `description`, `tenantId`). | Schema foundation for role-based memory and ability packs. Needs population and service layer. |
| **Task Assignments** | `TaskAssignment` model exists (assignedToUserId, assignedByUserId, dueDate, priority, status). | Foundation for human task assignment. |
| **Standing Orders** | `StandingOrder` model — persistent allowlists, blocked actions, approval gates, budget caps, expiry. | Strong foundation for autonomy policy. |
| **Subscriptions & Billing** | `Subscription`, `UsageLedger`, `RoutingLog`, `CreditService`, daily caps, 4 pricing tiers. | Exists. Will need to account for new services. |
| **Integrations/MCP** | 22 MCP connectors, `TenantMcpManager`, auto-start on boot. | Foundation for data ingestion pipelines. |
| **Dashboard Pages** | 26+ pages: workspace, company brain, audit, compliance, team, schedules, etc. | Foundation. New pages needed for threads, memory base, agent profiles, ability packs, etc. |

### Deployment Truth (Verified)

- **Cloud Run API**: Live at `https://jak-swarm-api-565531938617.asia-south1.run.app`
- **Cloud Run Worker**: Dockerfile exists (`Dockerfile.worker`), but not deployed yet
- **Railway**: Active as rollback/fallback
- **Vercel**: Frontend deployed, `NEXT_PUBLIC_API_URL` still pending cutover from Railway to Cloud Run
- **Supabase**: PostgreSQL + pgvector (primary DB)
- **Redis**: Railway managed instance (for locks, SSE relay, leader election)
- **GKE**: Not deployed
- **Full Cloud Run cutover**: Not claimed
- **Full autonomy**: Not claimed

---

## 2. Gap Analysis

### 2.1 Company Memory Base

**What exists:** `TenantMemory` (flat key-value), `MemoryItem` (scoped, versioned, with approval workflow), `MemoryEvent` (audit trail), `CompanyArtifact`/`CompanyKnowledgeSource`/`CompanyGraphEntity` (schema for structured knowledge), `PgVectorAdapter` (vector search), `DocumentIngestor` (text/PDF→chunks→embeddings), `EmbeddingService` (OpenAI + local).

**What is missing:**
- Structured memory types beyond key-value: people memory, project memory, decision memory, policy memory, technical memory, HR memory, marketing memory, finance memory, sales memory, legal/compliance memory, risk memory, customer memory, evidence memory, learning history
- Cross-session grounding (memory that improves across workflows without manual re-specification)
- Memory ingestion pipelines for: calls, meeting recordings, websites, emails, Slack/WhatsApp conversations, GitHub/code repositories, CRM data, HR records, finance documents, customer feedback
- Role-based memory scope enforcement at the retrieval layer
- Memory deduplication across sources (same fact from email + Slack + meeting transcript)
- Memory confidence scoring at the entity level (not just extraction level)
- Memory expiry/retention policies per scope
- Memory lineage tracking (which source produced which memory)
- Proactive memory surfacing (system tells you what changed, not just answers when asked)

### 2.2 Call/Document/Website Ingestion

**What exists:** `DocumentIngestor` for text/PDF→chunks→embeddings, `CompanyKnowledgeSource` model, manual artifact upload via `/company/brain` endpoints.

**What is missing:**
- Call recording ingestion pipeline (audio→transcript→entities→memory)
- Meeting recording ingestion
- Website crawling/ingestion service
- Email ingestion pipeline (beyond Gmail IMAP adapter that currently sends/receives, not ingests)
- Slack/WhatsApp conversation ingestion
- GitHub/code repository ingestion
- CRM data ingestion (beyond CRM adapter for contacts/deals)
- Entity extraction pipeline (extract people, decisions, risks, obligations, owners, deadlines, reusable facts from ingested content)
- Source-level deduplication
- Incremental sync (only process new content since last sync)

### 2.3 Role-Based Memory

**What exists:** `Department` model, `MemoryItem` with `scopeType`/`scopeId` fields, `TenantToolRegistry` (per-tenant tool filtering), `PolicyEngine` (5-role RBAC).

**What is missing:**
- Department-scoped RBAC (HR agents see HR memory only; Finance agents see Finance memory only)
- Memory scope definition per department/role
- Memory access boundaries enforced at the service/repository layer
- Role-based memory retrieval in agent context injection
- Sensitivity classification for memory items
- Approval requirements for cross-department memory access
- Retention policies per memory scope

### 2.4 HyperAgent Fleet

**What exists:** 38 static agents with fixed roles, industry packs with restricted tools, `AgentRole` enum, `BaseAgent` with tool loop and runtime adapters.

**What is missing:**
- Dynamic agent creation (temporary, sandboxed agents)
- Agent profile registry (tracking agent_id, display_name, department, role, purpose, system_prompt_profile, allowed_tools, blocked_tools, memory_scopes, data_sources, approval_policy, autonomy_level, risk_level, output_contract, status, version, performance_score)
- Ability packs (department-level packs defining allowed tools, blocked tools, memory scopes, approval rules, autonomy levels, output formats, evaluation criteria)
- Agent cards (visual representation in UI showing connected data, memory scope, ability pack)
- Thread model (persistent task context storing goal, agents, memory used, tools used, approvals, decisions, output, verification, learning, skill recommendations, audit evidence)
- Agent Fleet page (UI for browsing, selecting, and configuring agents)

### 2.5 Commander Coaching

**What exists:** `CommanderAgent` that parses goals, produces mission briefs, and can short-circuit with direct answers. `VerifierAgent` that validates output. `RepairService` with error categorization.

**What is missing:**
- Commander as Mission Coach: review whether goal is understood, whether plan is correct
- Commander as Capability Judge: check whether existing agents/tools/memory are sufficient
- Commander as Agent Doctor: detect weak, shallow, or incomplete agent outputs; send corrective instructions
- Commander as Agent Builder: trigger temporary agent creation when capability is missing
- Coaching feedback loop: Commander reviews entire workflow and produces improvement suggestions
- Performance scoring: rate agents on quality, grounding, completeness, efficiency
- Coaching notes in SwarmState: structured feedback from Commander that influences downstream execution

### 2.6 Capability Gap Detection

**What exists:** `IntentRecord` model, `IntentVocabulary` (18 canonical intents), industry packs with allowed/restricted tools.

**What is missing:**
- Automatic comparison of task requirements against available agents, tools, skills, memory, integrations
- Gap decision logic: use existing agent, combine agents, create temporary specialist, request integration, request human input, reject due to safety
- Gap report in SwarmState
- Integration with Agent Forge for gap resolution
- Persistent gap history (learn from past gaps)

### 2.7 Agent Forge

**What exists:** `BaseAgent` class, `AgentRole` enum, `agent-factory.ts`, `ROLE_MANIFEST` with maturity labels.

**What is missing:**
- Temporary agent creation system
- Agent profile drafting (name, role, department, purpose, prompt, memory scope, tools, risk level, approval rules, output contract, evaluation criteria, sandbox test plan)
- Sandbox execution environment for temporary agents
- Evaluation of temporary agent output
- Promotion workflow: temporary→draft→sandboxed→approved→permanent
- Least privilege enforcement for all new agents
- JAK Shield review before agent activation
- Human approval for permanent agent creation

### 2.8 Agent Evaluation

**What exists:** `VerifierAgent` validates output against goals. `RepairService` classifies errors into 9 categories. `AntiHallucination` detection. Token and cost tracking per workflow.

**What is missing:**
- Agent performance scoring (quality, grounding, completeness, tool use, memory use, safety, policy compliance, repeatability, cost, speed)
- Persistent agent evaluation history
- Agent performance comparison across workflows
- Weakness pattern detection (consistently weak in X)
- Automatic upgrade recommendations
- Integration with Commander coaching

### 2.9 Ability Packs

**What exists:** 13 industry packs with restricted tools, allowed agents, context prompts, compliance notes. `Department` model.

**What is missing:**
- Department-level ability packs (HR Pack, CTO Pack, CMO Pack, Sales Pack, Finance Pack, Legal Pack, Ops Pack, Customer Support Pack, Compliance Pack, Website Reviewer Pack, Data Analyst Pack, Chief of Staff Pack)
- Each pack defining: allowed tools, blocked tools, memory scopes, approval rules, autonomy level, output formats, evaluation criteria, sensitive data boundaries
- Pack assignment to agents and departments
- Pack override policies (tenant-level overrides)
- Pack versioning

### 2.10 Autonomy Ladder

**What exists:** `StandingOrder` (allowlists, blocked actions, approval gates, budget caps), `DefaultApprovalPolicy` (6-tier `ToolActionCategory`), `ApprovalRequest` model with SHA-256 payload binding, tenant-configurable `autoApproveEnabled` and `approvalThreshold`.

**What is missing:**
- Per-agent autonomy levels (L0: answer only, L1: draft only, L2: recommend action, L3: execute low-risk internal, L4: execute with approval, L5: autonomous loop within policy)
- Autonomy policy engine that combines agent autonomy level + tool risk level + memory scope sensitivity + department policy
- Autonomy upgrade workflow with human approval
- Audit logging for autonomy level changes
- Escalation rules (when agent hits autonomy boundary, what happens)

### 2.11 Learning Loop

**What exists:** `MemoryExtractor` (LLM-powered fact extraction from completed workflows, with dedup and confidence filtering), `MemoryApprovalService` (suggest→approve/reject workflow), `persistLearning`/`recallLearnings` per-role memory, `CompanyProfileService` (LLM-extracted profiles), `CompanyOperatingLayerService` (drift detection).

**What is missing:**
- Workflow pattern extraction (identify reusable workflow patterns across executions)
- Skill recommendation from successful workflows (propose new SKILL.md)
- Agent upgrade recommendation (propose prompt improvements, new tools, expanded memory)
- Cross-workflow learning (insights from one department inform another)
- Proactive learning (system identifies what it should learn, not just what was extracted)
- Learning history tracking
- Admin approval for skill/agent upgrades before production activation

### 2.12 Admin Approvals

**What exists:** `ApprovalRequest` model, `ApprovalScope` (payload binding), `ApprovalAuditLog`, approval routes, `autoApproveEnabled`/`approvalThreshold` per tenant.

**What is missing:**
- Approval workflows for: new agent creation, agent profile changes, autonomy level upgrades, memory scope changes, ability pack changes, tool permission changes, skill activation, external communication, production deployment, secret rotation
- Role-based approval routing (HR changes need HR admin, Finance changes need Finance admin)
- Approval chain support (multi-person approval)
- Approval expiry and escalation
- Approval templates for common actions

### 2.13 Audit Evidence

**What exists:** `AuditLogger` (40+ action types), `AuditLog` table, HMAC-signed evidence bundles, `AuditRunService` (full SOC 2/HIPAA/ISO 27001 engagement lifecycle), `ControlTest`, `AuditException`, `AuditWorkpaper`, `ExternalAuditorPortal`.

**What is missing:**
- Audit actions for: agent creation, agent upgrade, autonomy level change, memory scope change, ability pack change, tool permission change, Commander coaching decisions, capability gap resolutions
- Agent-creation audit trail (who created what, with what permissions, approved by whom)
- Memory access audit trail (who accessed what memory, from what scope)
- Autonomy level change audit trail
- Cross-department access audit trail
- Compliance evidence for agent operations (not just workflows)

---

## 3. Proposed Target Architecture

### 3.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER / ADMIN INTERFACE                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐│
│  │ /threads/ │ │HyperAgent│ │  Memory   │ │Approval  │ │  Agent   ││
│  │   new    │ │   Fleet   │ │   Base   │ │  Center  │ │  Forge   ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘│
├─────────────────────────────────────────────────────────────────────┤
│                         FRONTEND LAYER                              │
│  Next.js 16 App Router + React 19 + Zustand + React Flow           │
├─────────────────────────────────────────────────────────────────────┤
│                           API LAYER                                 │
│  Fastify 5.x REST API + SSE Streaming + JWT Auth + RBAC            │
├─────────────────────────────────────────────────────────────────────┤
│                     COMMANDER COACH ENGINE                         │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │  Mission    │ │  Capability  │ │   Agent      │                │
│  │  Coach     │ │  Gap Detector│ │   Doctor     │                │
│  └────────────┘ └──────────────┘ └──────────────┘                │
├─────────────────────────────────────────────────────────────────────┤
│                    ORCHESTRATION LAYER                              │
│  ┌───────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐   │
│  │ Commander  │→│Planner │→│ Router │→│Worker  │→│ Verifier  │   │
│  └───────────┘ └────────┘ └────────┘ └────────┘ └──────────┘   │
│  ┌───────────┐ ┌────────┐ ┌────────┐                              │
│  │ Guardrail │ │Approval│ │Replaner│  ←── JAK Shield at every node│
│  └───────────┘ └────────┘ └────────┘                              │
│  LangGraph StateGraph + Google ADK alternate path                 │
├─────────────────────────────────────────────────────────────────────┤
│                    COMPANY MEMORY BASE                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │  Ingestion   │ │  Structured  │ │  Role-Based  │              │
│  │  Pipelines   │ │  Store       │ │  Access      │              │
│  └──────────────┘ └──────────────┘ └──────────────┘              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │  Vector      │ │  Entity      │ │  Learning    │              │
│  │  Search      │ │  Extraction  │ │  Loop        │              │
│  └──────────────┘ └──────────────┘ └──────────────┘              │
├─────────────────────────────────────────────────────────────────────┤
│                    AGENT REGISTRY & FORGE                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │  Agent       │ │  Ability     │ │  Agent       │              │
│  │  Profile     │ │  Packs       │ │  Forge       │              │
│  │  Registry    │ │              │ │  (Draft→Test)│              │
│  └──────────────┘ └──────────────┘ └──────────────┘              │
│  ┌──────────────┐ ┌──────────────┐                                │
│  │  Autonomy    │ │  Agent       │                                │
│  │  Policy      │ │  Evaluation  │                                │
│  └──────────────┘ └──────────────┘                                │
├─────────────────────────────────────────────────────────────────────┤
│                    JAK SHIELD (6+ STAGE)                            │
│  1. Agent Firewall  2. Risk-Based Approvals  3. Secure Tool Perms  │
│  4. Sandboxed Execution  5. Vulnerability Triage  6. Audit Layer  │
│  7. Agent Profile Validation  8. Memory Scope Enforcement           │
│  9. Autonomy Boundary  10. Role Boundary Enforcement               │
├─────────────────────────────────────────────────────────────────────┤
│                    DATA & INTEGRATIONS                              │
│  PostgreSQL + pgvector │ Redis │ Supabase Storage │ MCP Connectors │
│  Gmail │ CalDAV │ Slack │ GitHub │ Notion │ HubSpot │ Salesforce   │
│  Playwright │ E2B │ Deepgram │ ElevenLabs │ OpenAI Realtime        │
├─────────────────────────────────────────────────────────────────────┤
│                    DEPLOYMENT                                       │
│  Cloud Run API (live) │ Cloud Run Worker (pending) │ Railway       │
│  (rollback/fallback) │ Vercel (frontend, pending cutover)          │
│  Gemini + Google ADK (primary) │ OpenAI (alternate)                │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Workflow Flow

```
User Goal
    │
    ▼
Commander Coach Engine
    ├── Mission Coach: Understand goal, enrich with company context
    ├── Capability Gap Detector: Check agents/tools/memory/skills
    │   ├── Found sufficient? → Route to existing agents
    │   ├── Partial gap? → Combine agents + temporary specialist
    │   ├── Missing capability? → Agent Forge draft
    │   └── Unsafe/missing permission? → Reject with explanation
    └── Agent Doctor: Review past performance, adjust coaching
    │
    ▼
JAK Shield Stage 7: Agent Profile Validation
    ├── Verify agent profiles are approved
    ├── Verify memory scopes match department
    ├── Verify autonomy level permits action
    └── Verify tool access matches ability pack
    │
    ▼
Planner → Router → Workers (existing flow)
    │
    ├── JAK Shield at every node (existing 6 stages + new stages)
    ├── Approval gates for HIGH/CRITICAL risk
    └── Commander coaching notes injected into context
    │
    ▼
Verifier
    │
    ▼
Commander Review
    ├── Was the goal achieved?
    ├── Was the output deep enough?
    ├── Was company memory used properly?
    ├── Were tools used effectively?
    ├── Is there a capability gap that should be addressed?
    └── Performance scores for each agent
    │
    ▼
Learning Extraction
    ├── Extract reusable facts → Company Memory Base
    ├── Extract reusable workflow pattern → Skill Recommendation
    ├── Identify agent improvement → Agent Upgrade Recommendation
    └── Identify missing capability → Agent Forge Proposal
    │
    ▼
Human Approval (for upgrades, new agents, autonomy changes)
    │
    ▼
Output + Audit Evidence
```

### 3.3 Input Ingestion Architecture

```
Data Sources                    Ingestion Services                Memory Base
─────────────                   ─────────────────                 ───────────
Calls/Recordings ─→ CallTranscriptIngestionService ─→ CompanyMemoryItem
Meeting Recordings ─→ MeetingIngestionService      ─→ CompanyMemoryItem
Documents (PDF, DOCX) ─→ DocumentIngestionService   ─→ CompanyMemoryItem (existing)
Websites ─→ WebsiteReviewIngestionService            ─→ CompanyMemoryItem
Emails ─→ EmailIngestionService                      ─→ CompanyMemoryItem
Slack/WhatsApp ─→ ConversationIngestionService       ─→ CompanyMemoryItem
GitHub/Code ─→ CodeRepositoryIngestionService       ─→ CompanyMemoryItem
CRM Data ─→ CRMIngestionService                     ─→ CompanyMemoryItem
HR Records ─→ HRIngestionService                   ─→ CompanyMemoryItem
Finance Docs ─→ FinanceIngestionService             ─→ CompanyMemoryItem
Customer Feedback ─→ FeedbackIngestionService       ─→ CompanyMemoryItem
Tasks/Decisions ─→ DecisionIngestionService         ─→ CompanyMemoryItem
```

Each ingestion service:
1. Receives raw input (file, URL, API response, transcript)
2. Extracts text content
3. Runs entity extraction (people, decisions, risks, obligations, owners, deadlines, facts)
4. Classifies by memory type (people, project, decision, policy, technical, etc.)
5. Assigns scope (tenant + department + role + sensitivity)
6. Deduplicates against existing memories
7. Stores in `CompanyMemoryItem` with confidence score
8. Embeds for vector search
9. Logs to `MemoryEvent` audit trail

### 3.4 Company Memory Base Architecture

```
┌─────────────────────────────────────────────────┐
│              Company Memory Service              │
│                                                  │
│  ┌──────────────┐  ┌──────────────────────┐     │
│  │   Query      │  │   Ingestion Pipeline  │     │
│  │   Engine     │  │   (multiple sources)  │     │
│  └──────┬───────┘  └──────────┬─────────────┘     │
│         │                     │                   │
│  ┌──────▼─────────────────────▼──────────┐       │
│  │         Role-Based Access Control      │       │
│  │  (department + role + sensitivity)     │       │
│  └──────┬─────────────────────┬──────────┘       │
│         │                     │                   │
│  ┌──────▼──────┐  ┌──────────▼───────┐           │
│  │  Structured │  │   Vector Store   │           │
│  │  Store      │  │   (pgvector)     │           │
│  │  (Prisma)   │  │                  │           │
│  └──────┬──────┘  └──────────┬───────┘           │
│         │                     │                   │
│  ┌──────▼─────────────────────▼──────────┐       │
│  │         Deduplication & Confidence     │       │
│  │         Scoring Engine                 │       │
│  └──────┬─────────────────────┬──────────┘       │
│         │                     │                   │
│  ┌──────▼──────┐  ┌──────────▼───────┐           │
│  │  Approval   │  │   Audit Trail    │           │
│  │  Workflow   │  │   (MemoryEvent)  │           │
│  └─────────────┘  └──────────────────┘           │
└─────────────────────────────────────────────────┘
```

### 3.5 Role-Based Memory Architecture

```
Memory Scopes:
┌─────────────────────────────────────────────────┐
│  Tenant Scope (all departments)                  │
│  ├── Department Scope: HR                        │
│  │   ├── Role Scope: HR Manager                  │
│  │   └── Role Scope: HR Coordinator              │
│  ├── Department Scope: Engineering                │
│  │   ├── Role Scope: CTO                          │
│  │   ├── Role Scope: Senior Engineer              │
│  │   └── Role Scope: Junior Engineer              │
│  ├── Department Scope: Marketing                  │
│  │   ├── Role Scope: CMO                          │
│  │   └── Role Scope: Marketing Manager            │
│  ├── Department Scope: Finance                    │
│  │   ├── Role Scope: CFO                          │
│  │   └── Role Scope: Accountant                   │
│  └── Department Scope: Legal                      │
│       └── Role Scope: General Counsel             │
│                                                    │
│  Sensitivity Levels: PUBLIC, INTERNAL, CONFIDENTIAL│
│  Approval Levels: AUTO, REVIEWER, ADMIN           │
└─────────────────────────────────────────────────┘
```

---

## 4. Data Model / Schema Plan

### 4.1 CompanyMemoryItem (extends existing `MemoryItem`)

```prisma
model CompanyMemoryItem {
  id                String            @id @default(cuid())
  tenantId          String            @map("tenant_id")
  sourceId          String?           @map("source_id")
  memoryType        MemoryType        @map("memory_type")
  scopeType         MemoryScopeType   @default(TENANT) @map("scope_type")
  scopeId           String?           @map("scope_id")
  sensitivity       SensitivityLevel  @default(INTERNAL)
  key               String
  value             String            @db_text
  summary           String?           @db_text
  entities          Json?
  confidence        Float             @default(0.7)
  sourceConfidence  Float?            @map("source_confidence")
  status            MemoryItemStatus  @default(EXTRACTED)
  approvedBy        String?           @map("approved_by")
  approvedAt        DateTime?         @map("approved_at")
  expiresAt         DateTime?         @map("expires_at")
  version           Int               @default(1)
  parentId          String?           @map("parent_id")
  createdAt         DateTime          @default(now()) @map("created_at")
  updatedAt         DateTime          @updatedAt @map("updated_at")

  tenant            Tenant            @relation(fields: [tenantId], references: [id])
  source            MemorySource?     @relation(fields: [sourceId], references: [id])
  department        Department?       @relation(fields: [scopeId], references: [id])
  events            MemoryEvent[]

  @@unique([tenantId, scopeType, scopeId, key])
  @@index([tenantId, memoryType])
  @@index([tenantId, scopeType, scopeId])
  @@map("company_memory_items")
}

enum MemoryType {
  PEOPLE
  PROJECT
  DECISION
  POLICY
  TECHNICAL
  HR
  MARKETING
  FINANCE
  SALES
  LEGAL
  RISK
  CUSTOMER
  EVIDENCE
  LEARNING
}

enum MemoryScopeType {
  TENANT
  DEPARTMENT
  ROLE
  PROJECT
}

enum SensitivityLevel {
  PUBLIC
  INTERNAL
  CONFIDENTIAL
}
```

### 4.2 MemorySource

```prisma
model MemorySource {
  id                String            @id @default(cuid())
  tenantId          String            @map("tenant_id")
  sourceType        MemorySourceType  @map("source_type")
  name              String
  uri               String?
  lastSyncedAt      DateTime?         @map("last_synced_at")
  syncStatus        SyncStatus        @default(PENDING)
  syncError         String?           @db_text @map("sync_error")
  config            Json?
  credentialsId     String?           @map("credentials_id")
  autoSyncEnabled   Boolean           @default(false) @map("auto_sync_enabled")
  syncIntervalMinutes Int?            @map("sync_interval_minutes")
  createdAt         DateTime          @default(now()) @map("created_at")
  updatedAt         DateTime          @updatedAt @map("updated_at")

  tenant            Tenant            @relation(fields: [tenantId], references: [id])
  credentials       IntegrationCredential? @relation(fields: [credentialsId], references: [id])
  memories          CompanyMemoryItem[]
  syncRuns          MemorySourceSyncRun[]

  @@index([tenantId, sourceType])
  @@map("memory_sources")
}

enum MemorySourceType {
  CALL
  MEETING
  DOCUMENT
  WEBSITE
  EMAIL
  SLACK
  WHATSAPP
  GITHUB
  CRM
  HR_SYSTEM
  FINANCE_SYSTEM
  FEEDBACK
  TASK
  MANUAL
}

enum SyncStatus {
  PENDING
  SYNCING
  COMPLETED
  FAILED
}
```

### 4.3 MemoryScope (access policy)

```prisma
model MemoryScope {
  id                String            @id @default(cuid())
  tenantId          String            @map("tenant_id")
  name              String
  scopeType         MemoryScopeType   @map("scope_type")
  scopeId           String?           @map("scope_id")
  sensitivity       SensitivityLevel  @default(INTERNAL)
  allowedRoles      Json
  writeRoles       Json
  approvalRequired  Boolean           @default(false) @map("approval_required")
  retentionDays    Int?              @map("retention_days")
  createdAt         DateTime          @default(now()) @map("created_at")
  updatedAt         DateTime          @updatedAt @map("updated_at")

  tenant            Tenant            @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, scopeType, scopeId])
  @@map("memory_scopes")
}
```

### 4.4 AgentProfile

```prisma
model AgentProfile {
  id                    String              @id @default(cuid())
  tenantId              String              @map("tenant_id")
  agentId               String?             @map("agent_id")
  displayName           String              @map("display_name")
  department            String?
  role                  String?
  purpose               String              @db_text
  systemPromptProfile   String?             @db_text @map("system_prompt_profile")
  allowedTools          Json?               @map("allowed_tools")
  blockedTools          Json?               @map("blocked_tools")
  memoryScopes          Json?               @map("memory_scopes")
  dataSources           Json?               @map("data_sources")
  abilityPackId         String?             @map("ability_pack_id")
  approvalPolicy        ApprovalPolicyType  @default(REQUIRE_APPROVAL) @map("approval_policy")
  autonomyLevel         AutonomyLevel       @default(L0) @map("autonomy_level")
  riskLevel             RiskLevel           @default(MEDIUM) @map("risk_level")
  outputContract        Json?               @map("output_contract")
  status                AgentProfileStatus  @default(DRAFT)
  version               Int                 @default(1)
  createdBy             String?             @map("created_by")
  createdFromWorkflowId String?             @map("created_from_workflow_id")
  performanceScore      Float?              @map("performance_score")
  lastReviewedAt        DateTime?           @map("last_reviewed_at")
  evaluationCount       Int                 @default(0) @map("evaluation_count")
  createdAt             DateTime            @default(now()) @map("created_at")
  updatedAt             DateTime            @updatedAt @map("updated_at")

  tenant                Tenant              @relation(fields: [tenantId], references: [id])
  abilityPack           AbilityPack?        @relation(fields: [abilityPackId], references: [id])
  evaluations           AgentEvaluation[]
  learnings             AgentLearning[]
  forgeDrafts           AgentForgeDraft[]
  threads               Thread[]
  auditLogs             AuditLog[]

  @@index([tenantId, status])
  @@index([tenantId, department])
  @@map("agent_profiles")
}

enum AgentProfileStatus {
  TEMPORARY
  DRAFT
  SANDBOXED
  APPROVED
  DEPRECATED
}

enum ApprovalPolicyType {
  AUTO_APPROVE
  REQUIRE_REVIEW
  REQUIRE_APPROVAL
  REQUIRE_ADMIN_APPROVAL
}

enum AutonomyLevel {
  L0
  L1
  L2
  L3
  L4
  L5
}
```

### 4.5 AgentAbilityPack

```prisma
model AbilityPack {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  name                  String
  department            String?
  description           String            @db_text
  allowedTools          Json              @map("allowed_tools")
  blockedTools          Json?             @map("blocked_tools")
  memoryScopes          Json?             @map("memory_scopes")
  approvalRules         Json?             @map("approval_rules")
  autonomyLevel         AutonomyLevel     @default(L1) @map("autonomy_level")
  outputFormats         Json?             @map("output_formats")
  evaluationCriteria    Json?             @map("evaluation_criteria")
  sensitiveDataBoundaries Json?           @map("sensitive_data_boundaries")
  isDefault             Boolean           @default(false)
  version               Int               @default(1)
  createdAt             DateTime          @default(now()) @map("created_at")
  updatedAt             DateTime          @updatedAt @map("updated_at")

  tenant                Tenant            @relation(fields: [tenantId], references: [id])
  agentProfiles         AgentProfile[]

  @@unique([tenantId, name])
  @@map("ability_packs")
}
```

### 4.6 AgentAutonomyPolicy

```prisma
model AgentAutonomyPolicy {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  agentProfileId        String            @map("agent_profile_id")
  currentLevel          AutonomyLevel      @default(L0) @map("current_level")
  requestedLevel        AutonomyLevel?    @map("requested_level")
  upgradeJustification  String?           @db_text @map("upgrade_justification")
  upgradeApprovedBy     String?           @map("upgrade_approved_by")
  upgradeApprovedAt     DateTime?         @map("upgrade_approved_at")
  allowedActions        Json?             @map("allowed_actions")
  blockedActions        Json?             @map("blocked_actions")
  maxConcurrentTasks    Int?              @default(1) @map("max_concurrent_tasks")
  budgetCapCents        Int?              @map("budget_cap_cents")
  expiresAt             DateTime?         @map("expires_at")
  createdAt             DateTime          @default(now()) @map("created_at")
  updatedAt             DateTime          @updatedAt @map("updated_at")

  tenant                Tenant            @relation(fields: [tenantId], references: [id])
  agentProfile          AgentProfile      @relation(fields: [agentProfileId], references: [id])

  @@unique([tenantId, agentProfileId])
  @@map("agent_autonomy_policies")
}
```

### 4.7 AgentToolPermission

```prisma
model AgentToolPermission {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  agentProfileId        String            @map("agent_profile_id")
  toolName              String            @map("tool_name")
  permission            ToolPermission    @default(ALLOW)
  riskLevelOverride     RiskLevel?        @map("risk_level_override")
  grantedBy             String?           @map("granted_by")
  grantedAt             DateTime?         @map("granted_at")
  expiresAt             DateTime?         @map("expires_at")
  createdAt             DateTime          @default(now()) @map("created_at")

  agentProfile          AgentProfile      @relation(fields: [agentProfileId], references: [id])

  @@unique([tenantId, agentProfileId, toolName])
  @@map("agent_tool_permissions")
}

enum ToolPermission {
  ALLOW
  BLOCK
  REQUIRE_APPROVAL
}
```

### 4.8 AgentMemoryPermission

```prisma
model AgentMemoryPermission {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  agentProfileId        String            @map("agent_profile_id")
  memoryScopeType       MemoryScopeType   @map("memory_scope_type")
  memoryScopeId         String?          @map("memory_scope_id")
  memoryType            MemoryType?       @map("memory_type")
  accessLevel           MemoryAccessLevel @default(READ)
  grantedBy             String?           @map("granted_by")
  grantedAt             DateTime?         @map("granted_at")
  createdAt             DateTime          @default(now()) @map("created_at")

  agentProfile          AgentProfile      @relation(fields: [agentProfileId], references: [id])

  @@unique([tenantId, agentProfileId, memoryScopeType, memoryScopeId, memoryType])
  @@map("agent_memory_permissions")
}

enum MemoryAccessLevel {
  READ
  WRITE
  ADMIN
}
```

### 4.9 AgentEvaluation

```prisma
model AgentEvaluation {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  agentProfileId        String            @map("agent_profile_id")
  workflowId            String?           @map("workflow_id")
  taskId                String?           @map("task_id")
  qualityScore          Float?            @map("quality_score")
  groundingScore        Float?            @map("grounding_score")
  completenessScore     Float?            @map("completeness_score")
  toolUseScore          Float?            @map("tool_use_score")
  memoryUseScore        Float?            @map("memory_use_score")
  safetyScore           Float?            @map("safety_score")
  policyComplianceScore Float?            @map("policy_compliance_score")
  costEfficiencyScore   Float?            @map("cost_efficiency_score")
  speedScore            Float?            @map("speed_score")
  overallScore          Float?            @map("overall_score")
  feedback              String?           @db_text
  weaknessPatterns      Json?             @map("weakness_patterns")
  improvementSuggestions Json?            @map("improvement_suggestions")
  evaluatedBy           String?           @map("evaluated_by")
  createdAt              DateTime          @default(now()) @map("created_at")

  agentProfile          AgentProfile      @relation(fields: [agentProfileId], references: [id])

  @@index([tenantId, agentProfileId])
  @@index([tenantId, workflowId])
  @@map("agent_evaluations")
}
```

### 4.10 AgentLearning

```prisma
model AgentLearning {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  agentProfileId        String            @map("agent_profile_id")
  workflowId            String            @map("workflow_id")
  learningType          LearningType      @map("learning_type")
  content               String            @db_text
  confidence            Float             @default(0.7)
  status                LearningStatus    @default(EXTRACTED)
  approvedBy            String?           @map("approved_by")
  approvedAt            DateTime?         @map("approved_at")
  appliedAt             DateTime?         @map("applied_at")
  createdAt             DateTime          @default(now()) @map("created_at")

  agentProfile          AgentProfile      @relation(fields: [agentProfileId], references: [id])

  @@index([tenantId, agentProfileId])
  @@index([tenantId, learningType])
  @@map("agent_learnings")
}

enum LearningType {
  FACT
  PATTERN
  SKILL_SUGGESTION
  AGENT_UPGRADE
  CAPABILITY_GAP
}

enum LearningStatus {
  EXTRACTED
  SUGGESTED
  APPROVED
  REJECTED
}
```

### 4.11 AgentForgeDraft

```prisma
model AgentForgeDraft {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  name                  String
  role                  String?
  department            String?
  purpose               String            @db_text
  systemPromptProfile   String?           @db_text @map("system_prompt_profile")
  memoryScopes          Json?             @map("memory_scopes")
  allowedTools          Json?             @map("allowed_tools")
  blockedTools          Json?             @map("blocked_tools")
  riskLevel             RiskLevel         @default(MEDIUM) @map("risk_level")
  approvalPolicy        ApprovalPolicyType @default(REQUIRE_APPROVAL) @map("approval_policy")
  outputContract        Json?             @map("output_contract")
  evaluationCriteria    Json?             @map("evaluation_criteria")
  sandboxTestPlan       Json?             @map("sandbox_test_plan")
  status                ForgeDraftStatus  @default(DRAFT)
  createdBy             String?           @map("created_by")
  createdFromWorkflowId String?           @map("created_from_workflow_id")
  reviewedBy            String?           @map("reviewed_by")
  reviewedAt            DateTime?         @map("reviewed_at")
  approvedBy            String?           @map("approved_by")
  approvedAt            DateTime?         @map("approved_at")
  activatedProfileId    String?           @map("activated_profile_id")
  createdAt             DateTime          @default(now()) @map("created_at")
  updatedAt             DateTime          @updatedAt @map("updated_at")

  tenant                Tenant            @relation(fields: [tenantId], references: [id])

  @@index([tenantId, status])
  @@map("agent_forge_drafts")
}

enum ForgeDraftStatus {
  DRAFT
  UNDER_REVIEW
  SANDBOX_TESTING
  APPROVED
  ACTIVATED
  REJECTED
  EXPIRED
}
```

### 4.12 Thread (new model for persistent task context)

```prisma
model Thread {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  userId                String            @map("user_id")
  title                 String?
  originalGoal          String            @db_text @map("original_goal")
  selectedAgentIds      Json?             @map("selected_agent_ids")
  memoryUsed             Json?             @map("memory_used")
  toolsUsed              Json?             @map("tools_used")
  approvalsRequested    Json?             @map("approvals_requested")
  decisions             Json?             @map("decisions")
  outputGenerated       String?           @db_text @map("output_generated")
  verificationResult    Json?             @map("verification_result")
  extractedLearnings    Json?             @map("extracted_learnings")
  skillRecommendations  Json?             @map("skill_recommendations")
  auditEvidence         Json?             @map("audit_evidence")
  status                ThreadStatus      @default(ACTIVE)
  createdAt             DateTime          @default(now()) @map("created_at")
  updatedAt             DateTime          @updatedAt @map("updated_at")

  tenant                Tenant            @relation(fields: [tenantId], references: [id])
  user                  User              @relation(fields: [userId], references: [id])

  @@index([tenantId, userId])
  @@map("threads")
}

enum ThreadStatus {
  ACTIVE
  COMPLETED
  ARCHIVED
}
```

### 4.14 SkillRecommendation

```prisma
model SkillRecommendation {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  threadId              String?           @map("thread_id")
  agentProfileId        String?           @map("agent_profile_id")
  name                  String
  description           String            @db_text
  allowedTools          Json?             @map("allowed_tools")
  riskLevel             RiskLevel         @default(MEDIUM) @map("risk_level")
  suggestedPrompt       String?           @db_text @map("suggested_prompt")
  status                SkillRecStatus    @default(SUGGESTED)
  approvedBy            String?           @map("approved_by")
  approvedAt            DateTime?         @map("approved_at")
  confidence            Float             @default(0.7)
  sourceWorkflowId      String?           @map("source_workflow_id")
  createdAt             DateTime          @default(now()) @map("created_at")

  tenant                Tenant            @relation(fields: [tenantId], references: [id])

  @@index([tenantId, status])
  @@map("skill_recommendations")
}

enum SkillRecStatus {
  SUGGESTED
  APPROVED
  ACTIVATED
  REJECTED
}
```

### 4.15 CapabilityGap

```prisma
model CapabilityGap {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  threadId              String?           @map("thread_id")
  workflowId            String?           @map("workflow_id")
  gapType               GapType           @map("gap_type")
  description           String            @db_text
  resolution            GapResolution    @map("resolution")
  resolutionDetail      String?           @db_text @map("resolution_detail")
  resolved              Boolean           @default(false)
  forgeDraftId          String?           @map("forge_draft_id")
  createdAt             DateTime          @default(now()) @map("created_at")
  updatedAt             DateTime          @updatedAt @map("updated_at")

  tenant                Tenant            @relation(fields: [tenantId], references: [id])

  @@index([tenantId, gapType])
  @@index([tenantId, resolved])
  @@map("capability_gaps")
}

enum GapType {
  MISSING_AGENT
  MISSING_TOOL
  MISSING_SKILL
  MISSING_MEMORY
  MISSING_INTEGRATION
  MISSING_PERMISSION
}

enum GapResolution {
  USE_EXISTING
  COMBINE_AGENTS
  CREATE_TEMPORARY
  REQUEST_INTEGRATION
  REQUEST_HUMAN
  REJECT_UNSAFE
}
```

### 4.16 RoleAccessPolicy

```prisma
model RoleAccessPolicy {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  department            String
  role                  String
  memoryScopeTypes      Json              @map("memory_scope_types")
  memoryTypes           Json?             @map("memory_types")
  maxAutonomyLevel      AutonomyLevel      @default(L2) @map("max_autonomy_level")
  allowedToolCategories  Json?             @map("allowed_tool_categories")
  blockedTools           Json?             @map("blocked_tools")
  approvalRules         Json              @map("approval_rules")
  sensitiveDataBoundaries Json?           @map("sensitive_data_boundaries")
  createdAt             DateTime          @default(now()) @map("created_at")
  updatedAt             DateTime          @updatedAt @map("updated_at")

  tenant                Tenant            @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, department, role])
  @@map("role_access_policies")
}
```

### 4.17 MemorySourceSyncRun

```prisma
model MemorySourceSyncRun {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  sourceId              String            @map("source_id")
  status                SyncStatus        @default(PENDING)
  itemsProcessed        Int               @default(0) @map("items_processed")
  itemsIngested         Int               @default(0) @map("items_ingested")
  itemsDeduplicated     Int               @default(0) @map("items_deduplicated")
  itemsFailed           Int               @default(0) @map("items_failed")
  errorMessage          String?           @db_text @map("error_message")
  startedAt             DateTime?         @map("started_at")
  completedAt           DateTime?         @map("completed_at")
  createdAt             DateTime          @default(now()) @map("created_at")

  source                MemorySource      @relation(fields: [sourceId], references: [id])

  @@index([tenantId, sourceId])
  @@map("memory_source_sync_runs")
}
```

---

## 5. Backend Services Plan

### 5.1 CompanyMemoryService

**File:** `apps/api/src/services/company-brain/company-memory.service.ts`

**Purpose:** Central service for storing, retrieving, querying, and managing structured company memories.

**Methods:**
- `store(item: CreateCompanyMemoryItemInput): Promise<CompanyMemoryItem>`
- `retrieve(query: MemoryQueryInput): Promise<CompanyMemoryItem[]>` — Scoped by tenant + department + role + sensitivity
- `search(query: string, scopes: MemoryScopeType[], limit: number): Promise<CompanyMemoryItem[]>` — Uses vector search
- `deduplicate(items: CompanyMemoryItem[]): Promise<CompanyMemoryItem[]>` — Merge overlapping facts
- `updateConfidence(id: string, confidence: number): Promise<void>`
- `delete(id: string, requesterRole: string): Promise<void>` — Enforce scope + sensitivity
- `getByType(type: MemoryType, scopes: MemoryScopeType[]): Promise<CompanyMemoryItem[]>`
- `approve(id: string, approvedBy: string): Promise<CompanyMemoryItem>`
- `reject(id: string, rejectedBy: string): Promise<CompanyMemoryItem>`

**Depends on:** Prisma, PgVectorAdapter, existing MemoryApprovalService

### 5.2 MemoryIngestionService

**File:** `apps/api/src/services/company-brain/memory-ingestion.service.ts`

**Purpose:** Orchestrates ingestion from various sources into the Company Memory Base.

**Methods:**
- `ingestFromSource(sourceId: string): Promise<MemorySourceSyncRun>`
- `ingestText(text: string, source: MemorySourceType, metadata: IngestionMetadata): Promise<CompanyMemoryItem[]>`
- `ingestFile(file: Buffer, mimeType: string, source: MemorySourceType, metadata: IngestionMetadata): Promise<CompanyMemoryItem[]>`
- `ingestUrl(url: string, metadata: IngestionMetadata): Promise<CompanyMemoryItem[]>`
- `runEntityExtraction(text: string, tenantId: string): Promise<ExtractedEntities>`
- `classifyMemoryType(entities: ExtractedEntities): MemoryType`
- `assignScope(entities: ExtractedEntities, source: MemorySourceType): { scopeType: MemoryScopeType, scopeId: string }`

**Depends on:** CompanyMemoryService, EmbeddingService, DocumentIngestor

### 5.3 CallTranscriptIngestionService

**File:** `apps/api/src/services/ingestion/call-transcript-ingestion.service.ts`

### 5.4 WebsiteReviewIngestionService

**File:** `apps/api/src/services/ingestion/website-review-ingestion.service.ts`

### 5.5 DocumentIngestionService (extends existing)

**File:** `apps/api/src/services/ingestion/document-ingestion.service.ts`

### 5.6 RoleMemoryAccessService

**File:** `apps/api/src/services/company-brain/role-memory-access.service.ts`

**Methods:**
- `canAccess(userId: string, memoryItem: CompanyMemoryItem): Promise<boolean>`
- `filterByScope(items: CompanyMemoryItem[], userId: string, department: string, role: string): Promise<CompanyMemoryItem[]>`
- `getAccessibleScopes(userId: string): Promise<MemoryScopeType[]>`
- `enforceScope(query: MemoryQueryInput, userId: string): Promise<MemoryQueryInput>`

### 5.7 AgentProfileRegistryService

**File:** `apps/api/src/services/agents/agent-profile-registry.service.ts`

### 5.8 AbilityPackService

**File:** `apps/api/src/services/agents/ability-pack.service.ts`

### 5.9 CommanderCoachService

**File:** `apps/api/src/services/swarm/commander-coach.service.ts`

### 5.10 CapabilityGapDetectorService

**File:** `apps/api/src/services/swarm/capability-gap-detector.service.ts`

### 5.11 AgentForgeService

**File:** `apps/api/src/services/agents/agent-forge.service.ts`

### 5.12 AgentEvaluationService

**File:** `apps/api/src/services/agents/agent-evaluation.service.ts`

### 5.13 LearningExtractorService (extends existing MemoryExtractor)

**File:** `apps/api/src/services/company-brain/learning-extractor.service.ts`

### 5.14 SkillRecommendationService

**File:** `apps/api/src/services/skills/skill-recommendation.service.ts`

### 5.15 AutonomyPolicyService

**File:** `apps/api/src/services/agents/autonomy-policy.service.ts`

### 5.16 JAKShieldAgentPolicyService

**File:** `packages/security/src/shield-gateway/agent-policy-gateway.ts`

---

## 6. Frontend Plan

### 6.1 `/threads/new` — Task Start Page

### 6.2 Thread Workspace — `/threads/[id]`

### 6.3 HyperAgent Fleet Page — `/agents`

### 6.4 Agent Profile Page — `/agents/[id]`

### 6.5 Agent Ability Editor — `/agents/[id]/abilities`

### 6.6 Memory Base Page — `/memory`

### 6.7 Memory Source Viewer — `/memory/sources`

### 6.8 Role Access Control Page — `/admin/roles`

### 6.9 Approvals Page — `/approvals` (extends existing)

### 6.10 Learning History Page — `/learning`

### 6.11 Skill Recommendations Page — `/skills/recommendations`

### 6.12 Commander Coach Review Panel — `/workflows/[id]/coach`

### 6.13 Agent Forge Draft Review Panel — `/agents/forge/[draftId]`

*(Full component descriptions available in the original analysis — see sections 6.1–6.13 above)*

---

## 7. Workflow Plan

*(Full workflow flow documented in section 3.2 and section 7 of the original analysis)*

---

## 8. Safety and Permissions Plan

### 8.1 Least Privilege
- New agents start at `TEMPORARY` status, `L0` autonomy, `REQUIRE_APPROVAL` policy
- Temporary agents have no tool access by default
- Temporary agents have no memory access by default
- Ability packs define baseline of allowed tools and memory scopes
- Autonomy upgrades require human approval with justification and audit logging

### 8.2 HR/CTO/CMO/Finance Memory Boundaries
- `RoleAccessPolicy` defines which `MemoryScopeType` and `MemoryType` each department+role can access
- Cross-department access requires explicit `MemoryAccessPermission` grant + approval gate + audit log

### 8.3 Approval Gates (extending existing)
- Agent creation: `TENANT_ADMIN` approval before L3+ autonomy
- Agent upgrade: Human approval required
- Memory scope change: Department `REVIEWER` approval
- Ability pack change: `TENANT_ADMIN` approval
- External communication: Policy-based approval
- Production deployment: `TENANT_ADMIN` approval always
- Secret/credential operations: Always require approval

### 8.4 Destructive Action Controls
- Agent Forge agents never get `DESTRUCTIVE` tool access
- L0-L2 cannot execute destructive actions
- L3 can execute low-risk internal destructive actions with approval
- L4 can execute destructive actions with approval
- L5 can execute within strict policy boundaries with audit evidence

### 8.5 External Communication Controls
- `EXTERNAL_POST` and `CREDENTIAL` categories always require approval
- L0-L2 cannot send external communications
- All external communications logged to `AuditLog`

### 8.6 Production Deployment Controls
- No agent can deploy to production without `TENANT_ADMIN` approval
- Cloud Run deployment actions classified as `DESTRUCTIVE`
- Agent Forge agents never have deployment tool access

### 8.7 Secret Management Controls
- No agent can access secrets without `CREDENTIAL` tool permission AND `TENANT_ADMIN` approval
- L0-L3 agents cannot access secrets
- Secret rotation always requires explicit human approval

### 8.8 Audit Logging (extending existing 40+ action types)
- New actions: `AGENT_PROFILE_CREATED`, `AGENT_FORGE_DRAFT_CREATED`, `AUTONOMY_LEVEL_REQUESTED`, `AUTONOMY_LEVEL_APPROVED`, `MEMORY_SCOPE_GRANTED`, `ABILITY_PACK_ASSIGNED`, `CAPABILITY_GAP_DETECTED`, `LEARNING_EXTRACTED`, `MEMORY_ACCESS_VIOLATION`, `ROLE_BOUNDARY_VIOLATION`, `AUTONOMY_BOUNDARY_VIOLATION`, and 15+ more

### 8.9 JAK Shield Review for Agent Changes
- Stage 7: Agent Profile Validation
- Stage 8: Memory Scope Enforcement
- Stage 9: Autonomy Boundary
- Stage 10: Role Boundary Enforcement

### 8.10 No Silent High-Risk Autonomy
- All agents start at L0
- L0→L1: `REVIEWER` approval
- L1→L2: `REVIEWER` approval
- L2→L3: `TENANT_ADMIN` approval
- L3→L4: `TENANT_ADMIN` approval + 30-day performance history
- L4→L5: `TENANT_ADMIN` approval + 90-day performance history + explicit policy boundary definition
- Every level change logged to `AuditLog`

---

## 9. Implementation Phases

| Phase | Goal | Timeline |
|---|---|---|
| **Phase 0** | Current repo audit and truth alignment | Week 1-2 |
| **Phase 1** | Agent Profile Registry and Ability Packs | Week 3-5 |
| **Phase 2** | Thread model and HyperAgent UI skeleton | Week 6-8 |
| **Phase 3** | Company Memory Base | Week 9-12 |
| **Phase 4** | Role-based memory permissions | Week 13-15 |
| **Phase 5** | Commander Coach Engine | Week 16-18 |
| **Phase 6** | Capability Gap Detector | Week 19-21 |
| **Phase 7** | Agent Forge temporary agents | Week 22-25 |
| **Phase 8** | Evaluation and learning loop | Week 26-29 |
| **Phase 9** | Admin approvals for agent upgrades | Week 30-32 |
| **Phase 10** | Deeper autonomous execution under policy | Week 33-38 |
| **Phase 11** | Production hardening and Cloud Run Worker cutover | Week 39-44 |

---

## 10. Files Likely Affected

### Packages

| Package | Files | Change |
|---|---|---|
| `packages/db/prisma/` | `schema.prisma` | Add all new models |
| `packages/db/prisma/migrations/` | New migration files | Schema changes |
| `packages/swarm/src/state/` | `swarm-state.ts` | Add coachingNotes, capabilityGaps, threadId |
| `packages/swarm/src/graph/nodes/` | `commander-node.ts`, `worker-node.ts`, `verifier-node.ts` | Inject coaching notes, evaluate against agent profiles |
| `packages/swarm/src/graph/` | `edges.ts` | Route through coaching and gap detection |
| `packages/swarm/src/memory/` | `memory-extractor.ts`, `memory-query.ts` | Extend for CompanyMemoryItem, role-scoped queries |
| `packages/swarm/src/workflow-runtime/` | `langgraph-graph-builder.ts` | Add coaching and gap detection nodes |
| `packages/agents/src/roles/` | `commander.agent.ts` | Extend with coaching capabilities |
| `packages/agents/src/base/` | `base-agent.ts`, `agent-context.ts` | Inject agent profile, memory scopes, ability packs |
| `packages/agents/src/role-manifest.ts` | All | Extend with profile references |
| `packages/security/src/rbac/` | `roles.ts`, `policy-engine.ts` | Add department-scoped roles |
| `packages/security/src/shield-gateway/` | `local-shield-gateway.ts`, `types.ts` | Add Stages 7-10 |
| `packages/security/src/guardrails/` | All | Extend for agent profile validation |
| `packages/security/src/audit/` | `audit-log.ts` | Add new AuditAction types |
| `packages/security/src/tool-risk/` | `risk-classifier.ts` | Add agent-related risk classification |
| `packages/tools/src/registry/` | `tool-registry.ts`, `approval-policy.ts`, `tenant-tool-registry.ts` | Integrate with ability packs |
| `packages/tools/src/adapters/memory/` | `db-memory.adapter.ts`, `vector-memory.adapter.ts` | Extend for CompanyMemoryItem |
| `packages/shared/src/types/` | All type files | Add new types |
| `packages/shared/src/schemas/` | All schema files | Add Zod schemas |
| `packages/shared/src/constants/` | `agent-roles.ts` | Extend for dynamic agent roles |

### Apps/API

| Path | Change |
|---|---|
| `apps/api/src/services/company-brain/` | Add company-memory, memory-ingestion, role-memory-access, learning-extractor services |
| `apps/api/src/services/agents/` | Add agent-profile-registry, ability-pack, agent-forge, agent-evaluation, autonomy-policy services |
| `apps/api/src/services/swarm/` | Add commander-coach, capability-gap-detector services |
| `apps/api/src/services/skills/` | Add skill-recommendation service |
| `apps/api/src/routes/` | Add threads, agent-profiles, ability-packs, memory (extend), forge, evaluations, learning routes |
| `apps/api/src/middleware/` | Add agent-profile, memory-scope, autonomy-level middleware |
| `apps/api/src/plugins/` | Update swarm.plugin.ts |
| `apps/api/src/coordination/` | Extend for Agent Forge sandbox coordination |

### Apps/Web

| Path | Change |
|---|---|
| `apps/web/src/app/(dashboard)/threads/` | New pages: new, [id] |
| `apps/web/src/app/(dashboard)/agents/` | New pages: list, [id], [id]/abilities, forge/[draftId] |
| `apps/web/src/app/(dashboard)/memory/` | New pages: list, sources, [id] |
| `apps/web/src/app/(dashboard)/admin/roles/` | New page |
| `apps/web/src/app/(dashboard)/learning/` | New page |
| `apps/web/src/app/(dashboard)/skills/recommendations/` | New page |
| `apps/web/src/app/(dashboard)/workflows/[id]/coach/` | New page |
| `apps/web/src/components/agents/` | New components |
| `apps/web/src/components/memory/` | New components |
| `apps/web/src/components/threads/` | New components |
| `apps/web/src/components/forge/` | New components |
| `apps/web/src/lib/api-client.ts` | Add new API endpoints |
| `apps/web/src/store/` | Add thread-store, agent-profile-store |

---

## 11. Test Plan

*(Full test plan available in section 11 of the original analysis — covering unit tests, integration tests, policy tests, JAK Shield tests, memory permission tests, agent profile tests, Agent Forge sandbox tests, Commander Coach tests, workflow end-to-end tests, and UI tests)*

---

## 12. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | Over-permissioned agents | Critical | Medium | Least privilege default. JAK Shield Stage 7 validates every agent profile. Audit every permission change. |
| 2 | Memory leakage across departments | Critical | Medium | RoleMemoryAccessService enforces scope. JAK Shield Stage 8 validates. Cross-department access requires explicit permission + approval. |
| 3 | HR/Finance data exposure | Critical | Medium | Sensitivity levels default to CONFIDENTIAL. RoleAccessPolicy restricts access. JAK Shield Stage 10 enforces role boundaries. |
| 4 | Hallucinated memory | High | Medium | Memory confidence scoring (0.7 threshold). Source lineage tracking. Deduplication. Human approval for high-confidence items. |
| 5 | Unsafe autonomy escalation | Critical | Low | All upgrades require human approval. L4/L5 require performance history. JAK Shield Stage 9 enforces. Automatic downgrade on violations. |
| 6 | Prompt injection through documents/websites | High | Medium | Existing injection detection (Stage 1). Apply to all ingested content before memory storage. |
| 7 | Unapproved external actions | High | Medium | EXTERNAL_POST/CREDENTIAL categories always require approval. L0-L3 cannot send external comms. |
| 8 | Agent sprawl | Medium | High | Temporary agents auto-expire. Permanent agents require TENANT_ADMIN approval. Capability Gap Detector checks before creating. |
| 9 | Cost overrun | Medium | High | Existing credit billing and daily caps. Autonomy levels limit scope. L5 requires explicit budget caps. |
| 10 | Stale learning | Medium | Medium | Memory confidence decays. expiresAt for retention. Drift detection. Human approval for recommendations. |
| 11 | Audit gaps | High | Low | 40+ new audit action types. HMAC-signed evidence bundles. External auditor portal. |
| 12 | Deployment confusion | Medium | High | Honest deployment truth. Cloud Run API live, Worker pending, Railway fallback. No GKE claims. Phase 11 handles hardening. |

---

## 13. Final Recommendation

**The best structure to build this without breaking the current repo:**

1. **Extend, don't replace.** LangGraph orchestration, AgentRole system, ToolRegistry, JAK Shield, and MemoryExtractor all work well. Every new feature extends existing systems.

2. **Add new models via Prisma migrations.** New tables, not modifications to existing ones. Existing data untouched.

3. **Extend SwarmState with optional fields.** `coachingNotes`, `capabilityGaps`, `threadId`, `agentProfileIds` default to `undefined` or `[]`. Existing workflows unaffected.

4. **Add new JAK Shield stages as a new module.** `agent-policy-gateway.ts` implements Stages 7-10 as a separate validation pass. Existing 6 stages untouched.

5. **Use the existing approval system.** Extend `ApprovalRequest` with new `ApprovalType` values. Don't build a parallel system.

6. **Build ingestion services as new modules.** `apps/api/src/services/ingestion/` directory. Each service independent.

7. **Create Agent Forge as a new package-level module.** `packages/agents/src/forge/`. `AgentRole` enum gets `TEMPORARY` value. Existing agents untouched.

8. **Extend the API with new route modules.** New files, not modifications to existing ones.

9. **Build frontend pages incrementally.** New routes under `apps/web/src/app/(dashboard)/`. New Zustand store slices. Existing pages untouched.

10. **Phase strictly.** Each phase independently deployable. Phase 1 ships without breaking anything.

11. **Keep Gemini + Google ADK primary.** All new services use existing `ProviderRouter`. ADK remains alternate path.

12. **Keep Railway as rollback/fallback.** Don't remove Railway. Don't claim full Cloud Run cutover.

13. **Test comprehensively before each phase ships.** 2,156 existing tests must continue passing. Add new tests per phase.

**Key principle: Every new feature should be additive. If a tenant doesn't use agent profiles, ability packs, or coaching, their workflows run exactly as they do today.**

---

*Ready for review. No code changes made.*