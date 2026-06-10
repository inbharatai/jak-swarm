# JAK Swarm — Evolution Plan: Company Operating System

> **Planning document only. No code changes made.**
> **Revised:** 2026-06-10 — incorporating terminology, schema, sequencing, and architecture corrections.

---

## Terminology Convention

| Term | Meaning | Not |
|---|---|---|
| **JAK Shield** | The existing 6-stage in-process trust/security pipeline (Agent Firewall, Risk-Based Approvals, Secure Tool Permissions, Sandboxed Execution, Defensive Vulnerability Triage, Audit Evidence Layer). Described in [`docs/jak-shield-manifest.md`](jak-shield-manifest.md). | Never called "6+ stage" or "Stages 7–10". No new numbered stages are added to JAK Shield. |
| **Agent Governance Overlay** | A new, separate governance layer that *calls* JAK Shield and `PolicyEngine` to enforce agent profiles, memory scopes, autonomy boundaries, and role boundaries. It is not part of JAK Shield — it is a consumer of it. | Not "JAK Shield Stage 7". Not a modification of JAK Shield. |
| **Company Memory Base** | Structured memory layer storing typed, scoped, confidence-scored facts extracted from company data sources. | Not a replacement for `TenantMemory` or `MemoryItem`. It extends them. |
| **Ability Pack** | Department-level configuration defining allowed tools, blocked tools, memory scopes, approval rules, and autonomy levels for agents in that department. | Not a new industry pack. It operates *within* industry packs, scoping tools and memory per role. |
| **Agent Forge** | A controlled system for drafting, sandbox-testing, and proposing temporary or permanent agents with least-privilege defaults. | Not unrestricted agent creation. All Forge output requires approval. |

---

## Deployment Truth

| Component | Status |
|---|---|
| Cloud Run API | ✅ Live |
| Cloud Run Worker | ⏳ Not deployed yet |
| Railway | Rollback/fallback |
| Vercel `NEXT_PUBLIC_API_URL` | ⏳ Pending cutover from Railway |
| GKE | Not deployed. Not claimed. |
| Full autonomy | Not claimed. |
| Gemini + Google ADK | Primary Google-facing path. Remains so. |
| OpenAI | Alternate supported provider path. Remains so. |
| JAK Shield | 6-stage in-process security/trust pipeline. Described as-is. No "6+ stage" claims. |

---

## 1. Current State Review

### What Already Exists

| Capability | Current Implementation | Maps To Vision |
|---|---|---|
| **Commander** | `commander-node.ts` + `CommanderAgent` — Parses goal, produces `MissionBrief`, short-circuits with `directAnswer`. Resolves UX role modes to canonical `AgentRole`. | Foundation. Will *orchestrate* CommanderCoachService, CapabilityGapDetectorService, AgentForgeService — not contain all logic itself. |
| **Guardrail** | `guardrail-node.ts` + `GuardrailAgent` + JAK Shield 6-stage pipeline. | JAK Shield stays as-is. Agent governance enforcement (profiles, memory scope, autonomy, role boundaries) becomes a separate Agent Governance Overlay that *calls* JAK Shield. |
| **Planner** | `planner-node.ts` + `PlannerAgent` | Stays. Will receive coaching notes from Commander. |
| **Router** | `router-node.ts` + `RouterAgent` | Will route to dynamic/temporary agents and respect ability packs. |
| **Task Scheduler** | LangGraph `StateGraph` with dependency resolution, parallel execution | Stays. |
| **Worker Execution Loop** | `worker-node.ts` — Circuit breaker, `reflectAndCorrect()`, `RepairService` | Stays. Will be coached by Commander. |
| **Verifier** | `verifier-node.ts` + `VerifierAgent` + `@jak-swarm/verification` | Foundation for Agent Evaluation System. |
| **Replanner** | `replanner-node.ts` | Stays. |
| **SwarmState** | 35+ fields, LangGraph `SwarmStateAnnotation` | Will gain optional fields: `coachingNotes`, `capabilityGaps`, `threadId`, `agentProfileIds`. Existing workflows unaffected. |
| **LangGraph Orchestration** | `LangGraphRuntime`, `PostgresCheckpointSaver`, 8-node `StateGraph` | Stays as primary orchestration. ADK remains alternate path. |
| **Google ADK Integration** | `packages/adk/` — Full bridge, `JAK_ADK_MODE=1` | Remains primary Google-facing path. |
| **Gemini/OpenAI Runtime** | `GeminiRuntime`, `OpenAIRuntime`, `ProviderRouter` | Stays. Dual-provider support continues. |
| **ToolRegistry** | 122 tools, `DefaultApprovalPolicy`, `TenantToolRegistry`, `StandingOrder` | Will be extended with ability pack boundaries and per-role tool access. |
| **38 Agents** | 6 orchestrators + 8 executive + 5 vibe-coding + 8 operations + 11 core workers | Foundation. Will grow with temporary/sandboxed agents from Agent Forge. |
| **JAK Shield** | 6-stage in-process pipeline (Firewall, Approvals, Tool Permissions, Sandbox, Vuln Triage, Audit Evidence). **No modifications. No new stages.** | Agent Governance Overlay will *call* JAK Shield, not extend it. |
| **Tenant-Scoped Memory** | `TenantMemory` (key-value), `MemoryItem` (scoped, versioned, approval workflow), `MemoryEvent` (audit trail) | Foundation. Extended with structured types, scopes, and ingestion pipelines. |
| **Company Brain** | `CompanyProfileService`, `CompanyOperatingLayerService`, `IntentRecordService`, `WorkflowTemplateService` | Strong foundation. Needs auto-sync, cross-session grounding, and role-based access. |
| **Memory Approval** | `MemoryApprovalService` (extracted→suggested→user_approved/rejected) | Extended for Company Memory Base. |
| **Vector Memory** | `PgVectorAdapter`, `DocumentIngestor`, `EmbeddingService` | Extended for multi-source ingestion and role-scoped retrieval. |
| **Approval Gates** | `ApprovalRequest` with SHA-256 payload binding, `ApprovalScope`, `ApprovalAuditLog` | Extended with new approval types for agent/memory/autonomy changes. |
| **Audit Evidence** | `AuditLogger` (40+ actions), `AuditLog`, HMAC-signed evidence bundles, `AuditRunService` | Extended with new audit action types. |
| **RBAC** | 5 roles: `END_USER`, `REVIEWER`, `OPERATOR`, `TENANT_ADMIN`, `SYSTEM_ADMIN`. `PolicyEngine`. | Foundation. Extended with department-scoped access and ability pack enforcement. |
| **Industry Packs** | 13 vertical configurations | Foundation for Ability Packs. |
| **Skills System** | SKILL.md parser, cascade loading | Foundation for Skill Upgrade Loop. |
| **Departments** | `Department` model in Prisma schema | Foundation. Needs population and service layer. |
| **Standing Orders** | Persistent allowlists, blocked actions, approval gates, budget caps | Foundation for autonomy policy. |
| **Integrations/MCP** | 22 MCP connectors, `TenantMcpManager` | Foundation for data ingestion pipelines. |
| **Dashboard Pages** | 26+ pages | Foundation. New pages needed for threads, memory, agents, etc. |

---

## 2. Gap Analysis

### 2.1 Company Memory Base

**Missing:** Structured memory types (people, project, decision, policy, etc.), cross-session grounding, ingestion pipelines for calls/websites/emails/Slack/GitHub/CRM, role-based memory scope enforcement, memory deduplication across sources, entity-level confidence scoring, memory expiry/retention policies, memory lineage tracking, proactive memory surfacing.

### 2.2 Call/Document/Website Ingestion

**Missing:** Call recording ingestion, meeting recording ingestion, website crawling, email ingestion pipeline, Slack/WhatsApp conversation ingestion, GitHub/code ingestion, CRM data ingestion, HR/finance ingestion, entity extraction pipeline, incremental sync.

### 2.3 Role-Based Memory

**Missing:** Department-scoped RBAC, memory scope definition per department/role, memory access boundaries at the service layer, role-based retrieval in agent context, sensitivity classification, cross-department access approvals, retention policies.

### 2.4 HyperAgent Fleet

**Missing:** Dynamic agent creation, agent profile registry, ability packs, agent cards, thread model, fleet UI.

### 2.5 Commander Coaching

**Missing:** Commander as Mission Coach, Capability Judge, Agent Doctor, Agent Builder. These should be **separate services** that Commander orchestrates, not logic inside Commander itself.

### 2.6 Capability Gap Detection

**Missing:** Automatic task-vs-capability comparison, gap decision logic, persistent gap history.

### 2.7 Agent Forge

**Missing:** Temporary agent creation, profile drafting with least privilege, sandbox execution, evaluation, promotion workflow, JAK Shield review, human approval.

### 2.8 Agent Evaluation

**Missing:** Multi-dimensional performance scoring, persistent evaluation history, weakness pattern detection, upgrade recommendations.

### 2.9 Ability Packs

**Missing:** Department-level packs (HR, CTO, CMO, Sales, Finance, Legal, Ops, Support, Compliance, Data Analyst, Chief of Staff), each defining tools, memory scopes, approval rules, autonomy levels, evaluation criteria, sensitive data boundaries.

### 2.10 Autonomy Ladder

**Missing:** Per-agent autonomy levels (L0–L5), autonomy policy engine, upgrade workflow with human approval, audit logging for level changes, escalation rules.

### 2.11 Learning Loop

**Missing:** Workflow pattern extraction, skill recommendation, agent upgrade recommendation, cross-workflow learning, learning history tracking, admin approval for upgrades.

### 2.12 Admin Approvals

**Missing:** Approval workflows for agent creation, profile changes, autonomy upgrades, memory scope changes, ability pack changes, tool permission changes, skill activation, external communication, production deployment, secret rotation. Role-based approval routing. Approval chains.

### 2.13 Audit Evidence

**Missing:** Audit actions for agent creation, upgrade, autonomy change, memory scope change, ability pack change, tool permission change, coaching decisions, capability gap resolutions. Agent-creation audit trail. Memory access audit trail. Autonomy change audit trail.

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
│                    AGENT GOVERNANCE OVERLAY                         │
│  (Separate from JAK Shield — calls Shield and PolicyEngine)        │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────┐     │
│  │ Agent Profile     │ │ Memory Scope     │ │ Autonomy      │     │
│  │ Validation        │ │ Enforcement      │ │ Boundary      │     │
│  └──────────────────┘ └──────────────────┘ └────────────────┘     │
│  ┌──────────────────┐ ┌──────────────────┐                        │
│  │ Role Boundary    │ │ Agent Forge      │                        │
│  │ Enforcement      │ │ Safety Check     │                        │
│  └──────────────────┘ └──────────────────┘                        │
├─────────────────────────────────────────────────────────────────────┤
│                    JAK SHIELD (6 STAGES — UNCHANGED)                │
│  1. Agent Firewall  2. Risk-Based Approvals  3. Secure Tool Perms  │
│  4. Sandboxed Execution  5. Vulnerability Triage  6. Audit Layer   │
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
│  Cloud Run API (live) · Cloud Run Worker (pending) · Railway       │
│  (rollback/fallback) · Vercel (frontend, pending cutover)           │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Workflow Flow

```
User Goal
    │
    ▼
Commander (orchestrates, does NOT contain all logic)
    ├── Delegates to CommanderCoachService
    │   ├── Mission Coach: understand goal, enrich context
    │   ├── Capability Judge: check existing agents/tools/memory
    │   └── Agent Doctor: detect weak outputs, send corrections
    │
    ├── Delegates to CapabilityGapDetectorService
    │   ├── Found sufficient? → route to existing agents
    │   ├── Partial gap? → combine agents + temporary specialist
    │   ├── Missing capability? → delegate to AgentForgeService
    │   └── Unsafe/missing permission? → reject with explanation
    │
    └── Produces coaching notes in SwarmState
    │
    ▼
Agent Governance Overlay (calls JAK Shield for security checks)
    ├── Agent Profile Validation (approved? correct tools? correct scopes?)
    ├── Memory Scope Enforcement (agent can only access allowed scopes)
    ├── Autonomy Boundary (action within agent's autonomy level?)
    └── Role Boundary Enforcement (agent stays within department)
    │
    ▼
Planner → Router → Workers (existing flow, enhanced)
    ├── Coaching notes injected into context
    ├── Ability pack constraints applied to tool access
    ├── Memory scopes applied to context injection
    └── Autonomy level checked before each tool call
    │
    ▼
JAK Shield (6 stages — unchanged)
    │
    ▼
Approval Gates (existing + new types)
    │
    ▼
Verifier
    │
    ▼
Commander Review (delegates to CommanderCoachService)
    ├── Goal achieved?
    ├── Output deep enough?
    ├── Memory used properly?
    ├── Tools used effectively?
    ├── Capability gaps?
    └── Performance scores per agent
    │
    ▼
Learning Extraction (delegates to LearningExtractorService)
    ├── Extract facts → Company Memory Base
    ├── Extract patterns → Skill Recommendation
    ├── Identify agent improvements → Agent Upgrade Recommendation
    └── Identify missing capabilities → Agent Forge Proposal
    │
    ▼
Human Approval (for upgrades, new agents, autonomy changes)
    │
    ▼
Output + Audit Evidence
```

### 3.3 Key Architecture Principle

**Commander remains an orchestrator, not a monolith.** Commander delegates to:
- `CommanderCoachService` — goal understanding, plan assessment, output review
- `CapabilityGapDetectorService` — gap detection and resolution
- `AgentForgeService` — temporary agent creation
- `AgentEvaluationService` — performance scoring
- `LearningExtractorService` — learning extraction

These are **separate services** that Commander calls, not logic baked into the Commander agent.

Similarly, **Agent Governance Overlay** is a separate module that **calls** JAK Shield and `PolicyEngine`. It does not modify JAK Shield or add numbered stages to it.

---

## 4. Data Model / Schema Plan

> **IMPORTANT: This section is conceptual only — a design reference for what tables and fields will be needed. It is NOT copy-paste Prisma migration code.** Actual migrations will use correct Prisma conventions (e.g., `@db.Text` not `@db_text`), proper relation syntax, and will be broken into safe, sequential migrations per phase.

### Key Design Decisions

1. **Polymorphic `scopeId`** — `scopeId` can reference a Department, Role, or Project. It will NOT use a direct Prisma `@relation` to Department. Instead, it will be a plain `String?` field with application-level resolution based on `scopeType`. This avoids polymorphic foreign-key issues.

2. **Schema rollout** — Tables are added per phase, NOT in one big migration:
   - Phase 1: `AgentProfile`, `AbilityPack`, `AgentToolPermission`, `AgentAutonomyPolicy`
   - Phase 2: `Thread`
   - Phase 3: `CompanyMemoryItem`, `MemorySource`, `MemoryScope`, `MemorySourceSyncRun`
   - Phase 4: `RoleAccessPolicy`, `AgentMemoryPermission`
   - Phase 7: `AgentForgeDraft`
   - Phase 8: `AgentEvaluation`, `AgentLearning`, `SkillRecommendation`
   - Phase 9: Approval type extensions (new `ApprovalType` enum values, not new tables)
   - Phase 10: Autonomy policy enforcement (service-level, not schema)

3. **New enums** are added incrementally with each phase migration, not all at once.

### 4.1 AgentProfile

```prisma
// Conceptual — actual migration will use correct Prisma conventions
model AgentProfile {
  id                    String              @id @default(cuid())
  tenantId              String              @map("tenant_id")
  agentId               String?             @map("agent_id")         // Maps to AgentRole for static agents
  displayName           String              @map("display_name")
  department            String?             // Department name (plain String, not FK to avoid polymorphic issues)
  role                  String?             // Role within department
  purpose               String              // @db.Text in actual migration
  systemPromptProfile   String?             @map("system_prompt_profile") // @db.Text
  allowedTools          Json?               @map("allowed_tools")     // String[]
  blockedTools          Json?               @map("blocked_tools")     // String[]
  memoryScopes          Json?               @map("memory_scopes")     // MemoryScopeType[]
  dataSources           Json?               @map("data_sources")      // String[]
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

  // Relations added in their respective phase migrations
  tenant                Tenant              @relation(fields: [tenantId], references: [id])
  abilityPack           AbilityPack?        @relation(fields: [abilityPackId], references: [id])

  @@unique([tenantId, displayName])
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
  L0  // Answer only
  L1  // Draft only
  L2  // Recommend action
  L3  // Execute low-risk internal action
  L4  // Execute with approval
  L5  // Autonomous loop within strict policy and audit boundary
}
```

### 4.2 AbilityPack

```prisma
model AbilityPack {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  name                  String            // e.g., "HR Pack", "CTO Pack"
  department            String?           // Plain String, not FK
  description           String            // @db.Text
  allowedTools          Json              @map("allowed_tools")     // String[]
  blockedTools          Json?             @map("blocked_tools")     // String[]
  memoryScopes          Json?             @map("memory_scopes")     // String[]
  approvalRules         Json?             @map("approval_rules")
  autonomyLevel         AutonomyLevel     @default(L1) @map("autonomy_level")
  outputFormats         Json?             @map("output_formats")    // String[]
  evaluationCriteria    Json?             @map("evaluation_criteria") // String[]
  sensitiveDataBoundaries Json?           @map("sensitive_data_boundaries") // String[]
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

### 4.3 AgentAutonomyPolicy

```prisma
model AgentAutonomyPolicy {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  agentProfileId        String            @map("agent_profile_id")
  currentLevel          AutonomyLevel      @default(L0) @map("current_level")
  requestedLevel        AutonomyLevel?    @map("requested_level")
  upgradeJustification  String?           @map("upgrade_justification") // @db.Text
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

### 4.4 AgentToolPermission

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

### 4.5 Thread (Phase 2)

```prisma
model Thread {
  id                    String            @id @default(cuid())
  tenantId              String            @map("tenant_id")
  userId                String            @map("user_id")
  title                 String?
  originalGoal          String            @map("original_goal") // @db.Text
  selectedAgentIds      Json?             @map("selected_agent_ids")
  memoryUsed             Json?             @map("memory_used")
  toolsUsed              Json?             @map("tools_used")
  approvalsRequested    Json?             @map("approvals_requested")
  decisions             Json?             @map("decisions")
  outputGenerated       String?           @map("output_generated") // @db.Text
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

### 4.6 CompanyMemoryItem (Phase 3)

> Note: `scopeId` is a plain `String?`, NOT a foreign key. Application code resolves it based on `scopeType` — if scopeType is DEPARTMENT, scopeId is a department name; if ROLE, it's a role identifier; if PROJECT, it's a project ID. This avoids polymorphic FK issues in Prisma.

```prisma
model CompanyMemoryItem {
  id                String            @id @default(cuid())
  tenantId          String            @map("tenant_id")
  sourceId          String?           @map("source_id")
  memoryType        MemoryType        @map("memory_type")
  scopeType         MemoryScopeType   @default(TENANT) @map("scope_type")
  scopeId           String?           @map("scope_id")  // Plain String — resolved by scopeType at application level
  sensitivity       SensitivityLevel  @default(INTERNAL)
  key               String
  value             String            // @db.Text
  summary           String?           // @db.Text
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

### 4.7–4.17 Remaining Models (Phase-scoped)

The following models follow the same conceptual-only pattern and will be implemented in their respective phases with correct Prisma conventions:

- **MemorySource** (Phase 3) — ingestion source tracking with `SyncStatus` enum
- **MemoryScope** (Phase 4) — access policy definitions, `@@unique([tenantId, scopeType, scopeId])`
- **MemorySourceSyncRun** (Phase 3) — sync run tracking
- **AgentMemoryPermission** (Phase 4) — `MemoryAccessLevel` enum (READ, WRITE, ADMIN)
- **AgentEvaluation** (Phase 8) — multi-dimensional scoring
- **AgentLearning** (Phase 8) — `LearningType` and `LearningStatus` enums
- **AgentForgeDraft** (Phase 7) — `ForgeDraftStatus` enum
- **SkillRecommendation** (Phase 8) — `SkillRecStatus` enum
- **CapabilityGap** (Phase 6) — `GapType` and `GapResolution` enums
- **RoleAccessPolicy** (Phase 4) — `@@unique([tenantId, department, role])`

---

## 5. Backend Services Plan

All services are **separate modules** that Commander orchestrates. Commander does not contain service logic.

| # | Service | File Path | Phase |
|---|---------|-----------|-------|
| 1 | `AgentProfileRegistryService` | `apps/api/src/services/agents/agent-profile-registry.service.ts` | 1 |
| 2 | `AbilityPackService` | `apps/api/src/services/agents/ability-pack.service.ts` | 1 |
| 3 | `AutonomyPolicyService` | `apps/api/src/services/agents/autonomy-policy.service.ts` | 1 |
| 4 | Thread CRUD | `apps/api/src/routes/threads.routes.ts` | 2 |
| 5 | `CompanyMemoryService` | `apps/api/src/services/company-brain/company-memory.service.ts` | 3 |
| 6 | `MemoryIngestionService` | `apps/api/src/services/company-brain/memory-ingestion.service.ts` | 3 |
| 7 | `RoleMemoryAccessService` | `apps/api/src/services/company-brain/role-memory-access.service.ts` | 4 |
| 8 | `CommanderCoachService` | `apps/api/src/services/swarm/commander-coach.service.ts` | 5 |
| 9 | `CapabilityGapDetectorService` | `apps/api/src/services/swarm/capability-gap-detector.service.ts` | 6 |
| 10 | `AgentForgeService` | `apps/api/src/services/agents/agent-forge.service.ts` | 7 |
| 11 | `AgentEvaluationService` | `apps/api/src/services/agents/agent-evaluation.service.ts` | 8 |
| 12 | `LearningExtractorService` | `apps/api/src/services/company-brain/learning-extractor.service.ts` | 8 |
| 13 | `SkillRecommendationService` | `apps/api/src/services/skills/skill-recommendation.service.ts` | 8 |
| 14 | Approval extensions | `apps/api/src/routes/approvals.routes.ts` (extend) | 9 |
| 15 | `AgentGovernanceOverlay` | `packages/security/src/governance/agent-governance-overlay.ts` | 1 (foundational), extended in 4, 7, 10 |
| 16 | Ingestion services | `apps/api/src/services/ingestion/` (call, website, email, etc.) | 3+ |

---

## 6. Frontend Plan

| Phase | Page | Route |
|-------|------|-------|
| 1 | Agent Fleet | `/agents` |
| 1 | Agent Profile | `/agents/[id]` |
| 1 | Ability Pack Editor | `/admin/ability-packs` |
| 2 | New Thread | `/threads/new` |
| 2 | Thread Workspace | `/threads/[id]` |
| 3 | Memory Base | `/memory` |
| 3 | Memory Sources | `/memory/sources` |
| 4 | Role Access Control | `/admin/roles` |
| 5 | Commander Coach Review | `/workflows/[id]/coach` |
| 7 | Agent Forge Draft | `/agents/forge/[draftId]` |
| 8 | Learning History | `/learning` |
| 8 | Skill Recommendations | `/skills/recommendations` |
| 9 | Approvals (extended) | `/approvals` (new tabs) |
| 10 | Agent Ability Editor | `/agents/[id]/abilities` |

---

## 7. Workflow Plan

Same as the original plan (Section 3.2 above), with these corrections:
- Commander **orchestrates** services, doesn't contain logic
- Agent Governance Overlay **calls** JAK Shield, doesn't add stages to it
- JAK Shield remains 6 stages, unchanged

---

## 8. Safety and Permissions Plan

### 8.1 Least Privilege

- New agents start at `TEMPORARY` status, `L0` autonomy, `REQUIRE_APPROVAL` policy
- No tool access, no memory access by default
- Ability packs define baseline — agents can only access what their pack allows
- Autonomy upgrades require human approval with justification and audit logging

### 8.2 HR/CTO/CMO/Finance Memory Boundaries

- `RoleAccessPolicy` defines which `MemoryScopeType` and `MemoryType` each department+role can access
- HR agents: HR memory scope, PEOPLE + POLICY types — cannot access FINANCE or SALES
- CTO agents: TECHNICAL memory scope, PROJECT + TECHNICAL types — cannot access HR or FINANCE without approval
- CMO agents: MARKETING memory scope, CUSTOMER + MARKETING types — cannot access HR, FINANCE, or LEGAL without approval
- Finance agents: FINANCE memory scope, FINANCE type — cannot access HR, MARKETING, or TECHNICAL without approval
- CEO/Chief of Staff: TENANT scope with CONFIDENTIAL items requiring individual approval
- Cross-department access: explicit `MemoryAccessPermission` + approval gate + audit log

### 8.3 Approval Gates (extending existing)

- Agent creation: `TENANT_ADMIN` approval before L3+ autonomy
- Agent upgrade: Human approval required
- Memory scope change: Department `REVIEWER` approval
- Ability pack change: `TENANT_ADMIN` approval
- External communication: Policy-based approval
- Production deployment: `TENANT_ADMIN` always
- Secret/credential: Always requires approval

### 8.4 Destructive Action Controls

- Agent Forge agents never get `DESTRUCTIVE` tool access
- L0-L2: cannot execute destructive actions
- L3: low-risk internal destructive actions with approval
- L4: destructive actions with approval
- L5: within strict policy boundaries with audit evidence

### 8.5 JAK Shield Review for Agent Changes

**JAK Shield remains the 6-stage in-process pipeline. It is NOT extended.**

Agent governance enforcement is a **separate Agent Governance Overlay** that:
1. Calls JAK Shield's existing stages for security checks (injection, PII, offensive cyber, tool risk)
2. Calls `PolicyEngine` for RBAC checks
3. Validates agent profiles against `AgentProfileRegistry`
4. Validates memory access against `RoleAccessPolicy`
5. Validates autonomy levels against `AgentAutonomyPolicy`
6. Validates role boundaries against department+role assignments

This overlay is called at the same points in the workflow where JAK Shield is called, but it is a separate module — `packages/security/src/governance/agent-governance-overlay.ts` — not a modification of JAK Shield.

### 8.6 No Silent High-Risk Autonomy

- All agents start at L0
- L0→L1: `REVIEWER` approval
- L1→L2: `REVIEWER` approval
- L2→L3: `TENANT_ADMIN` approval
- L3→L4: `TENANT_ADMIN` + 30-day performance history
- L4→L5: `TENANT_ADMIN` + 90-day performance history + explicit policy boundary
- Every change logged to `AuditLog`

---

## 9. Implementation Phases

> Each phase is independently deployable. Existing functionality must continue working without opting in.

### Phase 0: Current Repo Audit and Truth Alignment (Week 1-2)

- Verify all 38 agents documented and match code
- Verify all 122 tools classified and match ToolRegistry
- Verify all Prisma models match running schema
- Verify all API routes match frontend API client
- Verify deployment truth (Cloud Run API live, Worker pending, Railway fallback)
- Verify test suite passes (2,156 tests)
- Document any discrepancies

### Phase 1: Agent Profile Registry + Ability Packs + Role/Tool Permission Model (Week 3-5)

**Scope: ONLY this. No Company Memory, no Agent Forge, no Commander Coach yet.**

- Create `AgentProfile`, `AbilityPack`, `AgentToolPermission`, `AgentAutonomyPolicy` models (single migration)
- Create `AgentProfileRegistryService`, `AbilityPackService`, `AutonomyPolicyService`
- Create `AgentGovernanceOverlay` module (calls JAK Shield + PolicyEngine, does NOT modify them)
- Seed default ability packs (HR, CTO, CMO, Finance, Legal, Ops, Support, Compliance)
- Seed agent profiles for existing 38 agents
- Create API routes for agent profiles and ability packs
- Update `TenantToolRegistry` to respect ability pack boundaries
- Update `PolicyEngine` to enforce role-based boundaries
- Create frontend pages: `/agents`, `/agents/[id]`, `/admin/ability-packs`
- Write unit tests for all new services
- Write integration tests for ability pack enforcement
- Write policy tests for role-based tool access

**Files to inspect before Phase 1:**
- `packages/security/src/rbac/policy-engine.ts` — understand current RBAC
- `packages/security/src/rbac/roles.ts` — understand current role definitions
- `packages/tools/src/registry/tenant-tool-registry.ts` — understand current tenant tool filtering
- `packages/tools/src/registry/approval-policy.ts` — understand current approval policy
- `packages/security/src/shield-gateway/local-shield-gateway.ts` — understand current Shield flow
- `packages/security/src/shield-gateway/types.ts` — understand Shield interfaces
- `packages/agents/src/base/base-agent.ts` — understand current agent context
- `packages/agents/src/base/agent-context.ts` — understand current context passing
- `packages/shared/src/types/agent.ts` — understand current AgentRole enum
- `packages/db/prisma/schema.prisma` — understand current schema (50+ models)
- `apps/api/src/plugins/auth.plugin.ts` — understand current auth middleware

**Tests required for Phase 1:**
- `AgentProfileRegistryService.test.ts` — CRUD, filtering, tool/memory scope resolution, status transitions
- `AbilityPackService.test.ts` — CRUD, effective tools, effective memory scopes, effective approval rules
- `AutonomyPolicyService.test.ts` — level checks, action permissions, upgrade workflows, boundary enforcement
- `AgentGovernanceOverlay.test.ts` — profile validation, memory scope enforcement, autonomy boundary, role boundary
- Policy tests for least privilege (new agent has no tools, no memory, L0 autonomy)
- Policy tests for ability pack enforcement (HR pack restricts to HR tools and memory)
- Integration tests for ability pack integration with TenantToolRegistry
- Integration tests for role-based tool access enforcement

**Risks specific to Phase 1:**
1. **Ability pack conflicts with industry packs** — Industry packs already restrict tools. Ability packs must compose with, not override, industry pack restrictions. Mitigation: ability packs intersect with industry packs (take the more restrictive set).
2. **Agent profile seeding for 38 existing agents** — Must correctly map each `AgentRole` to an `AgentProfile` with appropriate defaults. Mitigation: write a seed script with explicit mappings, test against existing workflows.
3. **Autonomy level enforcement at runtime** — Checking autonomy level before every tool call could add latency. Mitigation: cache autonomy policies in memory, invalidate on change.
4. **Backward compatibility** — Tenants that don't opt in to agent profiles should see zero change in behavior. Mitigation: feature flag (`agentProfilesEnabled`) per tenant, default `false`.

### Phase 2: Thread Model and HyperAgent UI Skeleton (Week 6-8)

- Create `Thread` model (single migration)
- Create Thread API routes (CRUD, list, search)
- Create `CapabilityGap` model (single migration, but table only — no service yet)
- Create `/threads/new` page with goal input and agent selector
- Create `/threads/[id]` page with thread timeline
- Update `SwarmState` to include `threadId`, `capabilityGaps`, `coachingNotes` (optional fields)
- Update `SwarmRunner` to create/update threads
- Write tests for Thread CRUD and SwarmState with thread context

### Phase 3: Company Memory Base (Week 9-12)

- Create `CompanyMemoryItem`, `MemorySource`, `MemorySourceSyncRun` models (single migration)
- Create `CompanyMemoryService`, `MemoryIngestionService`
- Extend existing `DocumentIngestor` for entity extraction and memory classification
- Create vector index migration for `CompanyMemoryItem`
- Create API routes for memory CRUD, search, approval
- Create `/memory` and `/memory/sources` pages
- Update `MemoryQuery` to use `CompanyMemoryService`
- Update `BaseAgent` to inject role-scoped memories
- Write unit tests for memory services
- Write integration tests for role-based memory access
- Write policy tests for memory scope violations

### Phase 4: Role-Based Memory Permissions (Week 13-15)

- Create `MemoryScope`, `RoleAccessPolicy`, `AgentMemoryPermission` models (single migration)
- Implement `RoleMemoryAccessService` (scope filtering at the service layer)
- Implement Agent Governance Overlay: Memory Scope Enforcement
- Update `CommanderAgent` to check memory scopes before context injection
- Update `WorkerNode` to respect memory scopes
- Create `/admin/roles` page for role access policy management
- Write policy tests for cross-department memory access
- Write integration tests for role-based memory enforcement

### Phase 5: Commander Coach Engine (Week 16-18)

- Create `CommanderCoachService` (separate from Commander agent)
- Implement goal assessment, plan assessment, agent selection assessment, output assessment
- Add `coachingNotes` field to SwarmState
- Update `CommanderAgent` to delegate to `CommanderCoachService`
- Update `VerifierNode` to use coaching context
- Create `/workflows/[id]/coach` page
- Write unit tests for coaching service
- Write integration tests for Commander coaching flow

### Phase 6: Capability Gap Detector (Week 19-21)

- Create `CapabilityGapDetectorService` (separate from Commander)
- Implement gap detection and resolution logic
- Create `CapabilityGap` API routes
- Update `CommanderAgent` to invoke gap detector before planning
- Write unit tests for gap detection
- Write integration tests for gap resolution

### Phase 7: Agent Forge Temporary Agents (Week 22-25)

- Create `AgentForgeDraft` model (single migration)
- Create `AgentForgeService` (separate from Commander)
- Implement draft generation, least privilege enforcement, sandbox testing, evaluation
- Implement Agent Governance Overlay: Agent Profile Validation for Forge drafts
- Create `/agents/forge/[draftId]` page
- Update `RouterNode` to route to temporary agents
- Write unit tests for forge service
- Write sandbox tests for temporary agents

### Phase 8: Evaluation and Learning Loop (Week 26-29)

- Create `AgentEvaluation`, `AgentLearning`, `SkillRecommendation` models (single migration)
- Create `AgentEvaluationService`, `LearningExtractorService`, `SkillRecommendationService`
- Implement evaluation scoring, learning extraction, skill recommendation
- Create `/learning` and `/skills/recommendations` pages
- Update post-workflow flow to extract learnings
- Write unit tests for evaluation scoring
- Write integration tests for learning extraction

### Phase 9: Admin Approvals for Agent Upgrades (Week 30-32)

- Extend existing `ApprovalRequest` system with new `ApprovalType` enum values
- Create approval workflows for agent creation, profile changes, autonomy upgrades, memory scope changes, ability pack changes, skill activation
- Create role-based approval routing
- Extend `/approvals` page with new tabs
- Extend `AuditLogger` with new action types
- Write policy tests for approval workflows

### Phase 10: Deeper Autonomous Execution Under Policy (Week 33-38)

- Implement L4 and L5 autonomy under strict policy boundaries
- Implement `StandingOrder` integration with autonomy levels
- Implement automatic autonomy downgrade on policy violations
- Implement periodic autonomy review (30-day cycle)
- Implement Agent Governance Overlay: Autonomy Boundary and Role Boundary Enforcement
- Create `/agents/[id]/abilities` page
- Write extensive policy tests for L4 and L5
- Write safety tests for autonomy boundary violations
- Write integration tests for autonomous loops

### Phase 11: Production Hardening and Cloud Run Worker Cutover (Week 39-44)

- Deploy Cloud Run Worker (currently pending)
- Cutover Vercel `NEXT_PUBLIC_API_URL` to Cloud Run
- Load testing for Company Memory Base
- Load testing for Agent Profile Registry
- Security audit for Agent Governance Overlay
- Security audit for role-based memory access
- Security audit for Agent Forge sandbox
- Security audit for autonomy enforcement
- Performance optimization for memory ingestion
- Database migration to production
- Monitoring and alerting for new services
- Documentation updates
- End-to-end testing across all new features
- Beta testing with select tenants

---

## 10. Files Likely Affected

### Phase 1 (Agent Profile Registry + Ability Packs)

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `AgentProfile`, `AbilityPack`, `AgentToolPermission`, `AgentAutonomyPolicy` models + enums |
| `packages/db/prisma/migrations/` | New migration for Phase 1 tables |
| `packages/shared/src/types/agent.ts` | Add `AgentProfileStatus`, `ApprovalPolicyType`, `AutonomyLevel`, `ToolPermission` types |
| `packages/shared/src/constants/agent-roles.ts` | No changes (existing roles stay, new TEMPORARY role added later in Phase 7) |
| `packages/security/src/rbac/policy-engine.ts` | Add department-scoped role checks, ability pack enforcement |
| `packages/security/src/rbac/roles.ts` | Add department-aware permission checks |
| `packages/security/src/governance/` | New directory: `agent-governance-overlay.ts`, `types.ts` |
| `packages/security/src/audit/audit-log.ts` | Add new `AuditAction` enum values |
| `packages/tools/src/registry/tenant-tool-registry.ts` | Integrate ability pack tool filtering |
| `packages/tools/src/registry/approval-policy.ts` | Integrate autonomy level checks |
| `apps/api/src/services/agents/` | New: `agent-profile-registry.service.ts`, `ability-pack.service.ts`, `autonomy-policy.service.ts` |
| `apps/api/src/routes/` | New: `agent-profiles.routes.ts`, `ability-packs.routes.ts` |
| `apps/api/src/middleware/` | New: `agent-profile.middleware.ts` |
| `apps/api/src/plugins/swarm.plugin.ts` | Wire new services |
| `apps/web/src/app/(dashboard)/agents/` | New pages |
| `apps/web/src/app/(dashboard)/admin/ability-packs/` | New page |
| `apps/web/src/lib/api-client.ts` | Add new API endpoints |
| `apps/web/src/store/` | New: `agent-profile-store.ts` |

### Later Phases

See original plan Section 10 for full file lists. Each phase adds files in its own service/route/component directories without modifying existing files (except for extending SwarmState with optional fields, extending AuditAction enum, and extending ApprovalRequest with new types).

---

## 11. Test Plan

### Phase 1 Tests (Required Before Moving to Phase 2)

| Test Suite | Purpose |
|---|---|
| `AgentProfileRegistryService.test.ts` | CRUD, filtering, tool/memory scope resolution, status transitions |
| `AbilityPackService.test.ts` | CRUD, effective tools, effective memory scopes, effective approval rules |
| `AutonomyPolicyService.test.ts` | Level checks, action permissions, upgrade workflows, boundary enforcement |
| `AgentGovernanceOverlay.test.ts` | Profile validation, memory scope enforcement, autonomy boundary, role boundary |
| `least-privilege.test.ts` | New agent has no tools by default, no memory access, L0 autonomy |
| `ability-pack-enforcement.test.ts` | HR pack restricts to HR tools and HR memory |
| `industry-pack-composition.test.ts` | Ability pack intersects with industry pack (more restrictive wins) |
| `backward-compatibility.test.ts` | Tenants without agent profiles see zero change |
| `integration/agent-profile-flow.test.ts` | Create profile → assign pack → verify tool access |
| `integration/autonomy-enforcement.test.ts` | L0 agent → try execute → blocked → upgrade → try again |

### Full Test Plan (All Phases)

See original plan Section 11 for the complete test plan covering all 10 categories. Each phase adds its own test suites before moving to the next phase.

---

## 12. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | Over-permissioned agents | Critical | Medium | Least privilege default. Agent Governance Overlay validates every profile. Audit every permission change. |
| 2 | Memory leakage across departments | Critical | Medium | RoleMemoryAccessService enforces scope. Agent Governance Overlay validates memory access. Cross-department access requires explicit permission + approval. |
| 3 | HR/Finance data exposure | Critical | Medium | Sensitivity defaults to CONFIDENTIAL. RoleAccessPolicy restricts access. Agent Governance Overlay enforces role boundaries. |
| 4 | Hallucinated memory | High | Medium | Confidence scoring (0.7 threshold). Source lineage tracking. Deduplication. Human approval. |
| 5 | Unsafe autonomy escalation | Critical | Low | All upgrades require human approval. L4/L5 require performance history. Agent Governance Overlay enforces boundaries. Automatic downgrade on violations. |
| 6 | Prompt injection through ingestion | High | Medium | Existing JAK Shield Stage 1 (injection detection) applies to all ingested content. Document sanitizer before entity extraction. |
| 7 | Unapproved external actions | High | Medium | EXTERNAL_POST/CREDENTIAL categories always require approval. L0-L3 cannot send external comms. |
| 8 | Agent sprawl | Medium | High | Temporary agents auto-expire. Permanent agents require TENANT_ADMIN approval. Capability Gap Detector checks before creating. |
| 9 | Cost overrun | Medium | High | Existing credit billing and daily caps. Autonomy levels limit scope. L5 requires explicit budget caps. |
| 10 | Stale learning | Medium | Medium | Memory confidence decays. expiresAt for retention. Drift detection. Human approval for recommendations. |
| 11 | Audit gaps | High | Low | 40+ new audit action types. HMAC-signed evidence bundles. External auditor portal. |
| 12 | Deployment confusion | Medium | High | Honest deployment truth. Cloud Run API live, Worker pending, Railway fallback. Phase 11 handles hardening. |
| 13 | Ability pack conflicts with industry packs | Medium | Medium | Ability packs compose with industry packs by intersection (more restrictive wins). Test both overlap and conflict scenarios. |
| 14 | Polymorphic scopeId bugs | High | Medium | scopeId is a plain String resolved at application level by scopeType. Never use Prisma @relation on scopeId. Test all scopeType+scopeId combinations. |
| 15 | Big-bang migration failure | Critical | Low | Each phase has its own migration. Never add all tables at once. Test each migration independently. |

---

## 13. Final Recommendation

### The Best Structure to Build Without Breaking the Current Repo

1. **Extend, don't replace.** LangGraph orchestration, AgentRole system, ToolRegistry, JAK Shield, and MemoryExtractor all work well. Every new feature extends existing systems.

2. **JAK Shield stays 6-stage.** Agent governance, memory scope, autonomy, and role boundaries are a separate Agent Governance Overlay that *calls* JAK Shield and PolicyEngine. No new numbered stages.

3. **Add new models via per-phase Prisma migrations.** Phase 1 creates only `AgentProfile`, `AbilityPack`, `AgentToolPermission`, `AgentAutonomyPolicy`. Each subsequent phase adds its own tables. Never add all tables at once.

4. **Treat schema section as conceptual.** The Prisma models in this document are design references, not copy-paste migration code. Actual migrations will use correct Prisma conventions (`@db.Text` not `@db_text`, proper relations, no polymorphic foreign keys on `scopeId`).

5. **Extend SwarmState with optional fields.** `coachingNotes`, `capabilityGaps`, `threadId`, `agentProfileIds` default to `undefined` or `[]`. Existing workflows unaffected.

6. **Commander remains an orchestrator.** `CommanderCoachService`, `CapabilityGapDetectorService`, `AgentForgeService`, `AgentEvaluationService`, `LearningExtractorService` are separate services that Commander delegates to. Commander does not contain their logic.

7. **Use the existing approval system.** Extend `ApprovalRequest` with new `ApprovalType` values. Don't build a parallel system.

8. **Build ingestion services as new modules.** `apps/api/src/services/ingestion/` directory. Each service independent.

9. **Build Agent Forge as a new module.** `packages/agents/src/forge/`. `AgentRole` gets `TEMPORARY` value. `agent-factory.ts` gets extended to handle temporary agents. Existing agents untouched.

10. **Extend the API with new route modules.** New files, not modifications to existing ones.

11. **Build frontend pages incrementally.** New routes under `apps/web/src/app/(dashboard)/`. New Zustand store slices.

12. **Phase the work strictly.** Phase 1 (Agent Profile Registry + Ability Packs) ships without breaking anything. If a tenant doesn't opt in, workflows run exactly as they do today.

13. **Keep Gemini + Google ADK as the primary Google-facing path.** All new services use existing `ProviderRouter`. ADK remains alternate path.

14. **Keep Railway as rollback/fallback.** Don't remove Railway. Don't claim full Cloud Run cutover.

15. **Start with the foundation.** Agent Profile Registry + Ability Packs + Role/Tool Permission Model. Everything else builds on top of this.

---

*Ready for review. No code changes made.*