# JAK Swarm — Evolution Plan: Company Operating System

> **Planning document only. No code changes made.**
> **Revised:** 2026-06-11 — v4: Clarified phased approach for JAK Shield MCP integration. Phase 1-11A uses local policy logic. Phase 11B adds JAK Shield MCP integration.

---

## Product Sentence

**JAK Swarm is the ever-learning Company OS. JAK Shield is the MCP-native trust gateway that protects every real-world agent action.**

---

## Terminology Convention

| Term | Meaning | Not |
|---|---|---|
| **JAK Swarm** | The Company OS: orchestration, Commander, Planner, Router, agents, company memory, threads, tools, workflows, approvals UI, learning loop, and execution layer. | Not the security layer. |
| **JAK Shield** | A **separate MCP-native security gateway** ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)). It sits between AI agents and real tools. 10-stage decision pipeline: hard rules, injection v2 (6 substages, 13+ languages), taint tracker, attack-chain detection, PII v2 (28 types + cryptographic checksums), anomaly detection (EWMA + z-score), RBAC + threshold, OpenAI classifier (advisory only — deterministic engine has final say), HMAC signing, output routing. Deployable as MCP stdio server, HTTP MCP gateway, or REST API. Independently deployable, independently auditable, reusable by any MCP-compatible agent system. | Not an in-process package inside JAK Swarm. Not "6-stage". Not "6+ stage". Not "Stages 7–10". JAK Swarm's `packages/security` contains local guardrails, RBAC, audit references, and approval UI — but these are local policy logic, not the Shield pipeline itself. |
| **Agent Governance Overlay** | A new governance layer **inside JAK Swarm** that enforces agent profiles, memory scopes, autonomy boundaries, and role boundaries. It **calls JAK Shield MCP** for signed security decisions and stores those decisions in JAK Swarm audit logs. It is separate from both JAK Shield and the Swarm orchestration. | Not part of JAK Shield. Not a modification of JAK Shield. Not "JAK Shield Stage 7". |
| **Company Memory Base** | Structured memory layer storing typed, scoped, confidence-scored facts extracted from company data sources. | Not a replacement for `TenantMemory` or `MemoryItem`. It extends them. |
| **Ability Pack** | Department-level configuration defining allowed tools, blocked tools, memory scopes, approval rules, and autonomy levels for agents in that department. | Not a new industry pack. It operates *within* industry packs, scoping tools and memory per role. |
| **Agent Forge** | A controlled system for drafting, sandbox-testing, and proposing temporary or permanent agents with least-privilege defaults. All Forge output requires JAK Shield MCP validation and human approval. | Not unrestricted agent creation. |

---

## Architecture Separation

```text
┌─────────────────────────────────────────────────────────────┐
│                    JAK SWARM (Company OS)                     │
│                                                              │
│  Commander · Planner · Router · Workers · Verifier            │
│  Company Memory · Threads · Agent Registry · Ability Packs   │
│  Agent Forge · Learning Loop · Approvals UI · Dashboard       │
│                                                              │
│  Local policy logic (Phase 1-11A):                            │
│  - Agent Governance Overlay (profiles, scopes, autonomy,     │
│    role boundaries)                                          │
│  - RBAC (PolicyEngine)                                       │
│  - ToolRegistry + approval policies                          │
│  - Audit references and workflow evidence                    │
│  - Agent Firewall (injection detection, offensive cyber)     │
│  - PII detection and redaction                                │
│  - Tool risk classification                                   │
│                                                              │
│  JAK Shield MCP integration (Phase 11B+):                     │
│  - High-risk actions routed through JAK Shield MCP            │
│  - Shield MCP decisions stored in AuditLog                    │
│  - If Shield MCP unavailable: fall back to local policy       │
│                                                              │
│  Calls JAK Shield MCP before (Phase 11B+):                   │
│  - High-risk tool calls                                      │
│  - External emails/messages                                  │
│  - Memory access requests                                    │
│  - Cross-department access                                   │
│  - Agent Forge draft approval                                │
│  - Autonomy upgrade requests                                 │
│  - Credential/secret operations                               │
│  - Production deployment requests                            │
│  - Destructive actions                                       │
│                                                              │
│  Stores JAK Shield MCP decisions in audit logs and links    │
│  them to workflow/thread evidence (Phase 11B+).              │
└──────────────────┬──────────────────────────────────────────┘
                   │ MCP calls (Phase 11B+)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              JAK SHIELD (MCP-native trust gateway)            │
│              github.com/inbharatai/jak-shield                 │
│                                                              │
│  10-stage decision pipeline:                                  │
│  1.  Hard rules (block) — deterministic policy                │
│  2.  Injection v2 — 6 substages, 13+ languages               │
│  3.  Taint tracker — MinHash + n-gram fingerprinting          │
│  4.  Attack-chain detection — 20 patterns + data-flow         │
│  5.  PII v2 — 28 types + cryptographic checksums              │
│  6.  Anomaly detection — EWMA + z-score per tenant/agent      │
│  7.  RBAC + threshold — role-based access + approval gates    │
│  8.  OpenAI classifier — advisory only, deterministic final   │
│  9.  HMAC signing — cryptographic decision integrity          │
│  10. Output routing — allow/redact/approve/block/rewrite      │
│                                                              │
│  Deployable as: MCP stdio server, HTTP MCP gateway, REST API │
│  Independently deployable, independently auditable             │
│  Reusable by any MCP-compatible agent system                  │
└─────────────────────────────────────────────────────────────┘
```

**Phased Approach:**
- **Phase 1-11A:** All security enforcement uses local policy logic in `packages/security`. JAK Shield MCP exists as a separate product but is NOT called from JAK Swarm.
- **Phase 11B:** Create `ShieldMcpClient` and wire `AgentGovernanceOverlay` to call JAK Shield MCP for high-risk actions. Shield MCP decisions stored in AuditLog with HMAC signatures.
- **If JAK Shield MCP unavailable (Phase 11B+):** Fall back to local policy + require approval for all high-risk actions.

---

## Deployment Truth

| Component | Status |
|---|---|
| Cloud Run API | ✅ Live |
| Cloud Run Worker | ⏳ Not deployed yet |
| Agent Engine gateway | ✅ Live at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` |
| Railway | Rollback/fallback |
| Vercel `NEXT_PUBLIC_API_URL` | ⏳ Pending cutover from Railway |
| GKE | Not deployed. Not claimed. |
| Full autonomy | Not claimed. |
| Gemini + Google ADK | Primary Google-facing path. Remains so. |
| OpenAI | Alternate supported provider path. Remains so. |
| JAK Shield | Separate MCP-native security gateway. Not an in-process package. Not "6-stage". Described as 10-stage pipeline at [github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield). |

---

## 1. Current State Review

### What Already Exists in JAK Swarm

| Capability | Current Implementation | Maps To Vision |
|---|---|---|
| **Commander** | `commander-node.ts` + `CommanderAgent` | Foundation. Will *orchestrate* CommanderCoachService, CapabilityGapDetectorService, AgentForgeService — not contain all logic itself. |
| **Guardrail** | `guardrail-node.ts` + `GuardrailAgent` + local security package (`packages/security`) | Local guardrails stay in Swarm. Agent governance enforcement becomes Agent Governance Overlay that calls JAK Shield MCP. |
| **Planner** | `planner-node.ts` + `PlannerAgent` | Stays. Will receive coaching notes from Commander. |
| **Router** | `router-node.ts` + `RouterAgent` | Will route to dynamic/temporary agents and respect ability packs. |
| **Task Scheduler** | LangGraph `StateGraph` | Stays. |
| **Worker Execution Loop** | `worker-node.ts` | Stays. Will be coached by Commander. |
| **Verifier** | `verifier-node.ts` + `VerifierAgent` | Foundation for Agent Evaluation System. |
| **Replanner** | `replanner-node.ts` | Stays. |
| **SwarmState** | 35+ fields, LangGraph `SwarmStateAnnotation` | Will gain optional fields. Existing workflows unaffected. |
| **LangGraph Orchestration** | `LangGraphRuntime`, `PostgresCheckpointSaver`, 8-node `StateGraph` | Stays as primary. ADK remains alternate path. |
| **Google ADK Integration** | `packages/adk/` with Agent Engine gateway deployed at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` | Remains primary Google-facing path. Agent Engine gateway uses GOOGLE_SEARCH for grounding and delegates to Cloud Run API. |
| **Gemini/OpenAI Runtime** | `GeminiRuntime`, `OpenAIRuntime` | Stays. |
| **ToolRegistry** | 122 tools, `DefaultApprovalPolicy`, `TenantToolRegistry` | Will be extended with ability pack boundaries. |
| **38 Agents** | 6 orchestrators + 8 executive + 5 vibe-coding + 8 operations + 11 core workers | Foundation. Will grow with temporary agents from Agent Forge. |
| **Local Security Package** | `packages/security`: guardrails, PII detection, injection detection, RBAC (`PolicyEngine`), tool risk classification, field encryption, audit logging. | Local policy logic inside Swarm. **Not JAK Shield.** JAK Shield is a separate MCP-native gateway. Swarm calls JAK Shield MCP for signed security decisions. |
| **Tenant-Scoped Memory** | `TenantMemory`, `MemoryItem`, `MemoryEvent` | Foundation. Extended with structured types, scopes, and ingestion. |
| **Company Brain** | `CompanyProfileService`, `CompanyOperatingLayerService` | Foundation. Needs auto-sync and role-based access. |
| **Memory Approval** | `MemoryApprovalService` | Extended for Company Memory Base. |
| **Approval Gates** | `ApprovalRequest` with SHA-256 payload binding | Extended with new approval types. JAK Shield MCP decisions linked as evidence. |
| **Audit Evidence** | `AuditLogger`, `AuditLog`, HMAC-signed bundles | Extended. JAK Shield MCP decisions stored and linked. |
| **RBAC** | 5 roles, `PolicyEngine` | Extended with department-scoped access and ability pack enforcement. |
| **Industry Packs** | 13 vertical configurations | Foundation for Ability Packs. |
| **Skills System** | SKILL.md parser, cascade loading | Foundation for Skill Upgrade Loop. |
| **Integrations/MCP** | 22 MCP connectors, `TenantMcpManager` | Foundation for data ingestion. Also the transport for calling JAK Shield. |

### What Already Exists in JAK Shield (Separate Product)

| Capability | Implementation |
|---|---|
| **10-Stage Decision Pipeline** | Hard rules → Injection v2 → Taint tracker → Attack-chain → PII v2 → Anomaly → RBAC+threshold → Classifier (advisory) → HMAC signing → Output routing |
| **Five Decision Outcomes** | `allow`, `redact`, `requires_approval`, `block`, `rewrite` |
| **MCP-Native** | Speaks Model Context Protocol. Any MCP-compatible client can use it. Pre-built configs for Claude Desktop, Cursor, VS Code, Windsurf, Zed, Goose. |
| **Signed Decisions** | HMAC-SHA256 signed. Capability tokens are short-lived (60s default), single-use, scope-bound JWTs. |
| **PII Detection** | 28 types (SSN, Aadhaar, IBAN, PAN, NRIC, CPF, CNPJ, etc.) with cryptographic checksum validation (Luhn, Verhoeff, mod-97). 12 secret types. |
| **Injection Scanning** | 6 substages: standard, structural, Unicode confusables, base64/hex, spaced-letter, multilingual (13+ languages). Targets RAG poisoning, tool-name spoofing, indirect injection, format-token attacks. |
| **Deployment** | MCP stdio server (~2-3ms p95), HTTP MCP gateway (Docker), REST API (`POST /api/evaluate`). Independently deployable and auditable. |

---

## 2. Gap Analysis

### 2.1–2.13 (Same as v2 — see original sections)

**Gap Summary:** Structured memory types, ingestion pipelines, role-based memory, HyperAgent fleet, Commander coaching, capability gap detection, Agent Forge, agent evaluation, ability packs, autonomy ladder, learning loop, admin approvals, audit evidence — all missing and needed.

**New gap:** JAK Swarm currently has local guardrails in `packages/security` but does NOT call JAK Shield MCP for signed security decisions. The Agent Governance Overlay needs to route high-risk actions through JAK Shield MCP and store the signed decisions in audit logs.

---

## 3. Proposed Target Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER / ADMIN INTERFACE                       │
│  /threads/new · HyperAgent Fleet · Memory Base · Approvals · Forge │
├─────────────────────────────────────────────────────────────────────┤
│                         FRONTEND (Next.js 16)                       │
├─────────────────────────────────────────────────────────────────────┤
│                           API (Fastify 5.x)                         │
├─────────────────────────────────────────────────────────────────────┤
│                     COMMANDER (ORCHESTRATOR)                         │
│  Commander delegates to:                                             │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────┐                  │
│  │ Commander   │ │ Capability   │ │ Agent        │                  │
│  │ CoachService│ │ GapDetector │ │ Doctor       │                  │
│  └────────────┘ └──────────────┘ └──────────────┘                  │
├─────────────────────────────────────────────────────────────────────┤
│                    ORCHESTRATION (LangGraph StateGraph)              │
│  Commander → Guardrail → Planner → Router → Worker → Verifier     │
│  ← Approval ← Replanner                                            │
│  ADK alternate path (JAK_ADK_MODE=1)                               │
├─────────────────────────────────────────────────────────────────────┤
│                 AGENT GOVERNANCE OVERLAY (in JAK Swarm)              │
│  Enforces: agent profiles, memory scopes, autonomy, role boundaries  │
│  Routes high-risk actions to JAK Shield MCP for signed decisions    │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────┐     │
│  │ Agent Profile     │ │ Memory Scope     │ │ Autonomy      │     │
│  │ Validation        │ │ Enforcement      │ │ Boundary      │     │
│  └──────────────────┘ └──────────────────┘ └────────────────┘     │
│  ┌──────────────────┐ ┌──────────────────┐                        │
│  │ Role Boundary    │ │ Agent Forge      │                        │
│  │ Enforcement      │ │ Safety Check      │                        │
│  └──────────────────┘ └──────────────────┘                        │
├─────────────────────────────────────────────────────────────────────┤
│           LOCAL POLICY LOGIC (in JAK Swarm packages/security)       │
│  RBAC (PolicyEngine) · Tool Risk Classification · Audit References  │
│  PII Redaction · Injection Detection (local, pre-Shield)           │
│  Approval UI · Workflow Evidence                                   │
├─────────────────────────────────────────────────────────────────────┤
│                 JAK SHIELD MCP (separate service)                    │
│  10-stage decision pipeline · Signed decisions · HMAC integrity    │
│  Called by Agent Governance Overlay before:                         │
│  - High-risk tool calls, external actions, destructive actions     │
│  - New agent profiles, Agent Forge drafts, autonomy upgrades       │
│  - Credential/secret ops, production deploys, cross-dept access    │
│  - Memory access requests, browser actions, API/webhook calls      │
│  Decisions stored in JAK Swarm audit logs and linked to evidence   │
├─────────────────────────────────────────────────────────────────────┤
│                    COMPANY MEMORY BASE                              │
│  Ingestion · Structured Store · Role-Based Access · Vector Search  │
│  Entity Extraction · Learning Loop                                  │
├─────────────────────────────────────────────────────────────────────┤
│                    AGENT REGISTRY & FORGE                            │
│  Agent Profile Registry · Ability Packs · Agent Forge · Evaluation │
│  Autonomy Policy · Skill Recommendations                            │
├─────────────────────────────────────────────────────────────────────┤
│                    DATA & INTEGRATIONS                              │
│  PostgreSQL + pgvector · Redis · Supabase · MCP Connectors          │
│  Gemini + Google ADK (primary) · OpenAI (alternate)                │
├─────────────────────────────────────────────────────────────────────┤
│                    DEPLOYMENT                                       │
│  Cloud Run API (live) · Agent Engine gateway (live) · Cloud Run    │
│  Worker (pending) · Railway (rollback/fallback) · Vercel           │
│  (frontend, pending cutover)                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 JAK Shield MCP Integration Flow

```text
Agent action (tool call, memory access, agent creation, etc.)
    │
    ▼
Agent Governance Overlay (in JAK Swarm)
    ├── Is this action within the agent's autonomy level? → If NO, block or require approval
    ├── Is this action within the agent's ability pack? → If NO, block
    ├── Is this memory access within the agent's scope? → If NO, block
    ├── Is this role boundary respected? → If NO, block
    │
    ├── Is this a high-risk action? → If YES, route to JAK Shield MCP
    │   │
    │   ▼
    │   JAK Shield MCP (separate service)
    │   ├── 1. Hard rules (block destructive if policy says block)
    │   ├── 2. Injection v2 (6 substages, 13+ languages)
    │   ├── 3. Taint tracker (MinHash + n-gram)
    │   ├── 4. Attack-chain detection (20 patterns + data-flow)
    │   ├── 5. PII v2 (28 types + cryptographic checksums)
    │   ├── 6. Anomaly detection (EWMA + z-score per tenant/agent)
    │   ├── 7. RBAC + threshold
    │   ├── 8. OpenAI classifier (advisory — deterministic engine has final say)
    │   ├── 9. HMAC signing (decision integrity)
    │   └── 10. Output routing → allow / redact / requires_approval / block / rewrite
    │   │
    │   ▼ Signed decision returned to JAK Swarm
    │
    ├── Decision is allow → proceed
    ├── Decision is redact → proceed with PII redacted
    ├── Decision is requires_approval → pause for human approval
    ├── Decision is block → reject with explanation
    ├── Decision is rewrite → proceed with rewritten action
    │
    └── Decision stored in JAK Swarm audit log, linked to workflow/thread evidence
```

### 3.3 Workflow Flow

```text
User Goal
    │
    ▼
Commander (orchestrates, delegates to services)
    ├── CommanderCoachService: understand goal, enrich context
    ├── CapabilityGapDetectorService: check agents/tools/memory
    └── Produces coaching notes in SwarmState
    │
    ▼
Agent Governance Overlay (calls JAK Shield MCP for security decisions)
    ├── Agent Profile Validation
    ├── Memory Scope Enforcement
    ├── Autonomy Boundary
    ├── Role Boundary Enforcement
    └── High-risk actions → JAK Shield MCP → signed decision
    │
    ▼
Planner → Router → Workers (existing flow, enhanced)
    │
    ▼
JAK Shield MCP (for tool calls, external actions, destructive actions)
    │
    ▼
Approval Gates (existing + new types, JAK Shield decisions linked as evidence)
    │
    ▼
Verifier
    │
    ▼
Commander Review (delegates to CommanderCoachService)
    │
    ▼
Learning Extraction (delegates to LearningExtractorService)
    │
    ▼
Human Approval (for upgrades, new agents, autonomy changes)
    │
    ▼
Output + Audit Evidence (JAK Shield signed decisions linked)
```

---

## 4. Data Model / Schema Plan

> **IMPORTANT: This section is conceptual only — a design reference for what tables and fields will be needed. It is NOT copy-paste Prisma migration code.** Actual migrations will use correct Prisma conventions (`@db.Text` not `@db_text`), proper relation syntax, and will be broken into safe, sequential migrations per phase.

### Key Design Decisions

1. **Polymorphic `scopeId`** — `scopeId` is a plain `String?`, NOT a foreign key. Application code resolves it based on `scopeType`. No Prisma `@relation` on `scopeId`.

2. **Schema rollout** — Tables added per phase, NOT in one migration:
   - Phase 1: `AgentProfile`, `AbilityPack`, `AgentToolPermission`, `AgentAutonomyPolicy`
   - Phase 2: `Thread`
   - Phase 3: `CompanyMemoryItem`, `MemorySource`, `MemorySourceSyncRun`
   - Phase 4: `RoleAccessPolicy`, `AgentMemoryPermission`
   - Phase 7: `AgentForgeDraft`
   - Phase 8: `AgentEvaluation`, `AgentLearning`, `SkillRecommendation`

3. **JAK Shield MCP decisions** — Stored in existing `AuditLog` table with new action types. The HMAC-signed decision from JAK Shield is stored as a reference field, not a new table. This links JAK Swarm evidence to JAK Shield decisions.

### 4.1–4.7 Models (Same as v2)

See v2 plan for full model definitions. Key changes from v2:
- `scopeId` is `String?` with application-level resolution (not a FK to Department)
- `@db.Text` in actual migrations (shown as `// @db.Text` comments in conceptual schema)
- `ApprovalPolicyType` enum includes `REQUIRE_ADMIN_APPROVAL`
- New `AuditAction` enum values for JAK Shield MCP decision linking

### 4.8 New Audit Actions for JAK Shield MCP Integration

```text
SHIELD_MCP_ALLOW          — JAK Shield MCP returned "allow" decision
SHIELD_MCP_REDACT         — JAK Shield MCP returned "redact" decision
SHIELD_MCP_APPROVAL       — JAK Shield MCP returned "requires_approval" decision
SHIELD_MCP_BLOCK          — JAK Shield MCP returned "block" decision
SHIELD_MCP_REWRITE        — JAK Shield MCP returned "rewrite" decision
AGENT_PROFILE_CREATED    — New agent profile created
AGENT_FORGE_DRAFT_CREATED — Agent Forge draft created
AGENT_FORGE_DRAFT_APPROVED — Forge draft approved
AGENT_FORGE_DRAFT_REJECTED — Forge draft rejected
AUTONOMY_LEVEL_REQUESTED  — Autonomy upgrade requested
AUTONOMY_LEVEL_APPROVED   — Autonomy upgrade approved
AUTONOMY_LEVEL_REJECTED   — Autonomy upgrade rejected
MEMORY_SCOPE_GRANTED      — Memory scope access granted
MEMORY_SCOPE_REVOKED      — Memory scope access revoked
ABILITY_PACK_ASSIGNED     — Ability pack assigned to agent
CAPABILITY_GAP_DETECTED   — Capability gap detected
CAPABILITY_GAP_RESOLVED   — Capability gap resolved
LEARNING_EXTRACTED       — Learning extracted from workflow
LEARNING_APPROVED        — Learning approved
LEARNING_REJECTED        — Learning rejected
SKILL_RECOMMENDED        — Skill recommendation generated
SKILL_APPROVED           — Skill approved
SKILL_ACTIVATED          — Skill activated
COACHING_NOTE_GENERATED  — Commander coaching note generated
COACHING_NOTE_APPLIED    — Coaching note applied to workflow
MEMORY_ACCESS_VIOLATION  — Agent attempted memory access outside scope
ROLE_BOUNDARY_VIOLATION  — Agent attempted action outside role boundary
AUTONOMY_BOUNDARY_VIOLATION — Agent attempted action above autonomy level
```

---

## 5. Backend Services Plan

All services are **separate modules** that Commander orchestrates. Commander does not contain service logic.

| # | Service | File Path | Phase | Calls JAK Shield MCP? |
|---|---------|-----------|-------|----------------------|
| 1 | `AgentProfileRegistryService` | `apps/api/src/services/agents/agent-profile-registry.service.ts` | 1 | No (local policy) |
| 2 | `AbilityPackService` | `apps/api/src/services/agents/ability-pack.service.ts` | 1 | No (local policy) |
| 3 | `AutonomyPolicyService` | `apps/api/src/services/agents/autonomy-policy.service.ts` | 1 | No (local policy) |
| 4 | `ShieldMcpClient` | `packages/security/src/governance/shield-mcp-client.ts` | 1 | **Yes — this IS the MCP client** |
| 5 | `AgentGovernanceOverlay` | `packages/security/src/governance/agent-governance-overlay.ts` | 1 | Yes — delegates to ShieldMcpClient |
| 6 | Thread CRUD | `apps/api/src/routes/threads.routes.ts` | 2 | No |
| 7 | `CompanyMemoryService` | `apps/api/src/services/company-brain/company-memory.service.ts` | 3 | Yes — for memory access validation |
| 8 | `MemoryIngestionService` | `apps/api/src/services/company-brain/memory-ingestion.service.ts` | 3 | Yes — for content scanning before storage |
| 9 | `RoleMemoryAccessService` | `apps/api/src/services/company-brain/role-memory-access.service.ts` | 4 | No (local policy) |
| 10 | `CommanderCoachService` | `apps/api/src/services/swarm/commander-coach.service.ts` | 5 | No (LLM-powered) |
| 11 | `CapabilityGapDetectorService` | `apps/api/src/services/swarm/capability-gap-detector.service.ts` | 6 | No |
| 12 | `AgentForgeService` | `apps/api/src/services/agents/agent-forge.service.ts` | 7 | Yes — Forge drafts validated by Shield |
| 13 | `AgentEvaluationService` | `apps/api/src/services/agents/agent-evaluation.service.ts` | 8 | No |
| 14 | `LearningExtractorService` | `apps/api/src/services/company-brain/learning-extractor.service.ts` | 8 | No |
| 15 | `SkillRecommendationService` | `apps/api/src/services/skills/skill-recommendation.service.ts` | 8 | No |
| 16 | Approval extensions | `apps/api/src/routes/approvals.routes.ts` (extend) | 9 | Yes — approval decisions validated by Shield |

---

## 6. Frontend Plan

Same as v2. See original plan Section 6.

---

## 7. Workflow Plan

Same as v3 Section 3.3 above. Key difference from v2: high-risk actions are routed through JAK Shield MCP, not through an in-process "stage 7-10". The Agent Governance Overlay is a local policy layer that calls JAK Shield MCP for signed security decisions.

---

## 8. Safety and Permissions Plan

### 8.1 Least Privilege

- New agents start at `TEMPORARY` status, `L0` autonomy, `REQUIRE_APPROVAL` policy
- No tool access, no memory access by default
- Ability packs define baseline
- Autonomy upgrades require human approval with justification and audit logging

### 8.2 HR/CTO/CMO/Finance Memory Boundaries

- `RoleAccessPolicy` defines which `MemoryScopeType` and `MemoryType` each department+role can access
- Cross-department access: explicit `MemoryAccessPermission` + JAK Shield MCP validation + approval gate + audit log

### 8.3 Approval Gates (extending existing)

- Agent creation: `TENANT_ADMIN` approval before L3+
- Agent upgrade: Human approval required
- Memory scope change: Department `REVIEWER` approval
- Ability pack change: `TENANT_ADMIN` approval
- External communication: Policy-based approval, routed through JAK Shield MCP
- Production deployment: `TENANT_ADMIN` approval always, routed through JAK Shield MCP
- Secret/credential: Always routed through JAK Shield MCP, always requires approval

### 8.4 Destructive Action Controls

- Agent Forge agents never get `DESTRUCTIVE` tool access
- L0-L2: cannot execute destructive actions
- L3-L4: destructive actions require approval, routed through JAK Shield MCP
- L5: within strict policy boundaries, routed through JAK Shield MCP, with audit evidence

### 8.5 JAK Shield MCP Integration

**JAK Shield is a separate MCP-native security gateway.** JAK Swarm calls it for:

- High-risk tool calls (before execution)
- External emails/messages (before sending)
- GitHub/code actions (before execution)
- Database actions (before execution)
- Filesystem/shell actions (before execution)
- Browser actions (before execution)
- API/webhook calls (before execution)
- Memory access requests (before retrieval)
- Cross-department access (before granting)
- New agent profile validation (before activation)
- Agent Forge draft approval (before testing)
- Autonomy upgrade requests (before granting)
- Credential/secret operations (before execution)
- Production deployment requests (before execution)
- Destructive actions (before execution)

**JAK Shield MCP decisions are stored in JAK Swarm audit logs and linked to workflow/thread evidence.** The HMAC-signed decision from JAK Shield provides tamper-evident proof that the action was evaluated.

**JAK Swarm's local policy logic (in `packages/security`) remains as-is for local checks:**
- RBAC (`PolicyEngine`)
- Tool risk classification (`DefaultApprovalPolicy`)
- PII redaction at LLM boundary
- Injection detection (local, pre-Shield)
- Audit references and workflow evidence

**The flow is:**
1. Agent Governance Overlay checks local policy (autonomy level, ability pack, memory scope, role boundary)
2. If the action is high-risk, route to JAK Shield MCP for full 10-stage evaluation
3. JAK Shield MCP returns a signed decision (`allow`, `redact`, `requires_approval`, `block`, `rewrite`)
4. JAK Swarm stores the signed decision in `AuditLog` and links it to the workflow/thread
5. If JAK Shield MCP is unavailable, JAK Swarm falls back to local policy (fail-safe: require approval)

### 8.6 Agent Governance Overlay (in JAK Swarm)

The Agent Governance Overlay is a **separate module** in JAK Swarm (`packages/security/src/governance/`). It is NOT part of JAK Shield and does NOT add stages to JAK Shield.

It enforces:
1. **Agent Profile Validation** — Is this agent approved? Does it have the right tools for its ability pack? Is its memory scope correct?
2. **Memory Scope Enforcement** — Is this agent accessing memory within its allowed scope?
3. **Autonomy Boundary** — Is this action within the agent's autonomy level?
4. **Role Boundary Enforcement** — Is this agent staying within its department/role boundary?
5. **Agent Forge Safety Check** — Does this Forge draft meet least-privilege requirements?

For local policy checks, it uses `PolicyEngine`, `DefaultApprovalPolicy`, and `AgentAutonomyPolicy`.
For security decisions on high-risk actions, it delegates to JAK Shield MCP via `ShieldMcpClient`.

### 8.7 No Silent High-Risk Autonomy

- All agents start at L0
- L0→L1: `REVIEWER` approval
- L1→L2: `REVIEWER` approval
- L2→L3: `TENANT_ADMIN` approval
- L3→L4: `TENANT_ADMIN` + 30-day performance history
- L4→L5: `TENANT_ADMIN` + 90-day performance history + explicit policy boundary
- Every change logged to `AuditLog` with JAK Shield MCP decision linked
- Autonomy level changes that involve high-risk actions are routed through JAK Shield MCP

---

## 9. Implementation Phases

### Phase 0: Current Repo Audit and Truth Alignment (Week 1-2) ✅ COMPLETE

### Phase 1: Agent Profile Registry + Ability Packs + Role/Tool Permission Model + Shield MCP Client (Week 3-5)

**Scope: ONLY this. No Company Memory, no Agent Forge, no Commander Coach yet.**

- Create `AgentProfile`, `AbilityPack`, `AgentToolPermission`, `AgentAutonomyPolicy` models (single migration)
- Create `AgentProfileRegistryService`, `AbilityPackService`, `AutonomyPolicyService`
- Create `ShieldMcpClient` (`packages/security/src/governance/shield-mcp-client.ts`)
- Create `AgentGovernanceOverlay` (`packages/security/src/governance/agent-governance-overlay.ts`)
- **Key difference from v2:** The Agent Governance Overlay calls JAK Shield MCP for high-risk decisions, not an in-process "stage 7-10"
- Seed default ability packs and agent profiles
- Create API routes and frontend pages
- Write unit tests for all new services
- Write integration tests for ability pack enforcement
- Write policy tests for role-based tool access
- Write tests for Shield MCP client (mock JAK Shield responses)

**Files to inspect before Phase 1:**
- `packages/security/src/rbac/policy-engine.ts`
- `packages/security/src/rbac/roles.ts`
- `packages/security/src/shield-gateway/local-shield-gateway.ts` — understand existing Shield integration
- `packages/security/src/shield-gateway/types.ts` — understand Shield interfaces
- `packages/security/src/guardrails/pii-detector.ts`
- `packages/security/src/guardrails/injection-detector.ts`
- `packages/security/src/guardrails/offensive-cyber-detector.ts`
- `packages/security/src/audit/audit-log.ts`
- `packages/tools/src/registry/tenant-tool-registry.ts`
- `packages/tools/src/registry/approval-policy.ts`
- `packages/agents/src/base/base-agent.ts`
- `packages/agents/src/base/agent-context.ts`
- `packages/shared/src/types/agent.ts`
- `packages/db/prisma/schema.prisma`
- `apps/api/src/plugins/auth.plugin.ts`

**Tests required for Phase 1:**
- `AgentProfileRegistryService.test.ts`
- `AbilityPackService.test.ts`
- `AutonomyPolicyService.test.ts`
- `AgentGovernanceOverlay.test.ts`
- `ShieldMcpClient.test.ts` — mock JAK Shield MCP responses, verify decision handling
- `least-privilege.test.ts`
- `ability-pack-enforcement.test.ts`
- `industry-pack-composition.test.ts`
- `backward-compatibility.test.ts`
- `integration/agent-profile-flow.test.ts`
- `integration/autonomy-enforcement.test.ts`
- `integration/shield-mcp-fallback.test.ts` — test behavior when JAK Shield MCP is unavailable

**Risks specific to Phase 1:**
1. **JAK Shield MCP availability** — If JAK Shield is down, JAK Swarm must fall back safely (require approval for all high-risk actions). Mitigation: fail-safe fallback in ShieldMcpClient.
2. **Ability pack conflicts with industry packs** — Ability packs compose with industry packs by intersection (more restrictive wins).
3. **Agent profile seeding** — Must correctly map each AgentRole to an AgentProfile. Write explicit seed script.
4. **Backward compatibility** — Tenants that don't opt in see zero change. Feature flag per tenant.

### Phase 2: Thread Model (Week 6-8)
### Phase 3: Company Memory Base (Week 9-12)
### Phase 4: Role-Based Memory Permissions (Week 13-15)
### Phase 5: Commander Coach Engine (Week 16-18)
### Phase 6: Capability Gap Detector (Week 19-21)
### Phase 7: Agent Forge (Week 22-25)
### Phase 8: Evaluation and Learning Loop (Week 26-29)
### Phase 9: Admin Approvals (Week 30-32)
### Phase 10: Deeper Autonomous Execution Under Policy (Week 33-38)
### Phase 11: Production Hardening and Cloud Run Worker Cutover (Week 39-44)

(Phase details same as v2 — see original plan for full descriptions. Key changes: Shield MCP client added in Phase 1, Agent Governance Overlay calls Shield MCP in all phases.)

---

## 10. Files Likely Affected

### New Files for JAK Shield MCP Integration (Phase 1)

| File | Change |
|---|---|
| `packages/security/src/governance/shield-mcp-client.ts` | **New:** MCP client that calls JAK Shield for signed security decisions |
| `packages/security/src/governance/agent-governance-overlay.ts` | **New:** Governance overlay that enforces profiles, scopes, autonomy, and role boundaries |
| `packages/security/src/governance/types.ts` | **New:** Types for governance overlay decisions |
| `apps/api/src/services/shield/shield-mcp.service.ts` | **New:** API-level service for Shield MCP integration |

### All Other Files (Same as v2)

See v2 plan Section 10 for full file lists per package.

---

## 11. Test Plan

### Phase 1 Tests (Required Before Moving to Phase 2)

| Test Suite | Purpose |
|---|---|
| `AgentProfileRegistryService.test.ts` | CRUD, filtering, tool/memory scope resolution, status transitions |
| `AbilityPackService.test.ts` | CRUD, effective tools, effective memory scopes, effective approval rules |
| `AutonomyPolicyService.test.ts` | Level checks, action permissions, upgrade workflows, boundary enforcement |
| `AgentGovernanceOverlay.test.ts` | Profile validation, memory scope enforcement, autonomy boundary, role boundary |
| `ShieldMcpClient.test.ts` | Mock JAK Shield MCP responses, verify allow/redact/approve/block/rewrite handling |
| `shield-mcp-fallback.test.ts` | Test fail-safe behavior when JAK Shield MCP is unavailable (all high-risk → requires approval) |
| `least-privilege.test.ts` | New agent has no tools by default, no memory access, L0 autonomy |
| `ability-pack-enforcement.test.ts` | HR pack restricts to HR tools and HR memory |
| `industry-pack-composition.test.ts` | Ability pack intersects with industry pack (more restrictive wins) |
| `backward-compatibility.test.ts` | Tenants without agent profiles see zero change |

### Full Test Plan (All Phases)

Same as v2 plan Section 11, plus additional tests for Shield MCP integration in every phase.

---

## 12. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | Over-permissioned agents | Critical | Medium | Least privilege default. Agent Governance Overlay validates every profile. |
| 2 | Memory leakage across departments | Critical | Medium | RoleMemoryAccessService enforces scope. Agent Governance Overlay validates. Cross-department access requires explicit permission + approval. |
| 3 | HR/Finance data exposure | Critical | Medium | Sensitivity defaults to CONFIDENTIAL. RoleAccessPolicy restricts. JAK Shield MCP validates external actions. |
| 4 | Hallucinated memory | High | Medium | Confidence scoring. Source lineage. Deduplication. Human approval. |
| 5 | Unsafe autonomy escalation | Critical | Low | All upgrades require human approval. L4/L5 require performance history. Agent Governance Overlay enforces. |
| 6 | Prompt injection through ingestion | High | Medium | JAK Shield MCP Stage 2 (Injection v2) applies to all ingested content before memory storage. |
| 7 | Unapproved external actions | High | Medium | Routed through JAK Shield MCP. L0-L3 cannot send external comms. |
| 8 | Agent sprawl | Medium | High | Temporary agents auto-expire. Permanent agents require TENANT_ADMIN approval. Capability Gap Detector checks before creating. |
| 9 | Cost overrun | Medium | High | Existing credit billing and daily caps. Autonomy levels limit scope. |
| 10 | Stale learning | Medium | Medium | Memory confidence decays. expiresAt for retention. Human approval for recommendations. |
| 11 | Audit gaps | High | Low | New audit action types. JAK Shield MCP signed decisions linked as evidence. HMAC integrity. |
| 12 | Deployment confusion | Medium | High | Honest deployment truth. Phase 11 handles hardening. |
| 13 | Ability pack conflicts with industry packs | Medium | Medium | Intersection (more restrictive wins). Test overlap and conflict. |
| 14 | Polymorphic scopeId bugs | High | Medium | scopeId is plain String resolved at application level. Never Prisma @relation. |
| 15 | Big-bang migration failure | Critical | Low | Each phase has its own migration. Never add all tables at once. |
| 16 | JAK Shield MCP unavailable | High | Medium | Fail-safe fallback: all high-risk actions require approval. ShieldMcpClient catches errors and falls back to local policy. |

---

## 13. Final Recommendation

### The Best Structure to Build Without Breaking the Current Repo

1. **JAK Swarm and JAK Shield are separate products.** JAK Swarm is the Company OS. JAK Shield is the MCP-native trust gateway. JAK Swarm calls JAK Shield MCP for signed security decisions. JAK Shield remains independently deployable, independently auditable, and reusable by other agent systems.

2. **JAK Swarm's local policy logic stays in `packages/security`.** RBAC, tool risk classification, PII redaction, injection detection, and audit references remain as local checks. They are NOT JAK Shield stages.

3. **The Agent Governance Overlay is a new module in JAK Swarm** that calls both local policy logic AND JAK Shield MCP. It does NOT modify JAK Shield.

4. **Extend, don't replace.** LangGraph orchestration, AgentRole system, ToolRegistry, local guardrails, and MemoryExtractor all stay. Every new feature extends existing systems.

5. **Per-phase Prisma migrations.** Phase 1 creates only 4 tables. Each phase adds its own. Never all at once.

6. **Treat schema as conceptual.** Actual migrations use correct Prisma conventions. `scopeId` is plain String with app-level resolution.

7. **Commander remains an orchestrator.** `CommanderCoachService`, `CapabilityGapDetectorService`, `AgentForgeService` are separate services.

8. **Start with the foundation.** Agent Profile Registry + Ability Packs + Shield MCP Client + Agent Governance Overlay. Everything else builds on top.

9. **Keep Gemini + Google ADK primary.** All new services use existing `ProviderRouter`. ADK remains alternate path.

10. **Keep Railway as rollback/fallback.** Don't remove Railway. Don't claim full Cloud Run cutover.

11. **JAK Shield MCP decisions are linked to JAK Swarm audit logs.** Every signed decision from JAK Shield is stored as evidence in the workflow/thread.

12. **If JAK Shield MCP is unavailable, JAK Swarm falls back safely.** All high-risk actions require approval. Local policy logic still runs.

13. **Test comprehensively before each phase ships.** 2,156 existing tests must continue passing. Add Shield MCP client tests with mock responses.

---

*Ready for review. No code changes made.*