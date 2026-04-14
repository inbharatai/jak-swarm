# JAK Swarm vs DeerFlow 2.0 — Architecture-Aware Comparison

> **Generated:** July 2025 | **Scope:** Code-level deep comparison  
> **Methodology:** Full codebase read of JAK Swarm + DeerFlow 2.0 CLAUDE.md & README.md  
> **Constraint:** Recommendations strengthen JAK's own vision — not clone DeerFlow

---

## Part 1 — Executive Verdict

**DeerFlow is an AI coding assistant that became a general agent. JAK is a business operations platform that happens to use AI agents.** They solve fundamentally different problems.

DeerFlow (61.4K stars, ByteDance) excels at **single-user, single-thread agentic coding** — one lead agent, sandbox execution, file manipulation, context compression, and progressive skill loading. It is a sophisticated personal assistant with a filesystem as its memory.

JAK Swarm excels at **multi-tenant, multi-agent business orchestration** — a DAG-based swarm pipeline where 37 specialized agents coordinate through a 9-node graph with verification, approval gates, budget controls, industry-specific compliance, and distributed coordination.

**The honest gap analysis:**

| Dimension | JAK Advantage | DeerFlow Advantage |
|-----------|---------------|-------------------|
| Business orchestration | 9-node DAG with parallel task scheduling, retry, budget tracking | None — single-agent linear execution |
| Multi-tenancy | Full tenant isolation, RBAC, audit trails, credit system | None — single-user, no auth |
| Industry compliance | 13 industry packs with PII/PHI detection, policy enforcement | None |
| Agent memory | DB-backed TenantMemory + vector store (routes exist) | LLM-powered fact extraction + file persistence (fully wired) |
| Context engineering | Minimal — no summarization, no context budget | Aggressive — SummarizationMiddleware, filesystem offloading, loop detection |
| Sandbox execution | E2B code execution (single tool) | Full virtual filesystem, 5 file tools, Docker/K8s isolation |
| Tool resilience | Manual tool-loop with 3 retries | 18-middleware chain: dangling tool-call recovery, error normalization, guardrails |
| Developer experience | Manual setup, no diagnostics | `make doctor`, `make setup` wizard, config validation |
| IM channels | None | Feishu, Slack, Telegram with card-patching streaming |
| Embedded client | None | `DeerFlowClient` — full in-process access without HTTP |

**Bottom line:** JAK has the harder problem solved (enterprise multi-agent orchestration) but leaves operational polish on the table. DeerFlow has the easier problem solved (single-agent coding) but with extraordinary engineering quality. The extraction opportunity is surgical: take DeerFlow's **middleware resilience patterns**, **memory persistence architecture**, and **context engineering** — but never its single-agent model, its file-based storage, or its "local trusted environment" security posture.

---

## Part 2 — Side-by-Side Scorecard

Scoring: 1 = absent/broken, 5 = functional, 8 = production-grade, 10 = best-in-class

| # | Capability | JAK | DeerFlow | Notes |
|---|-----------|-----|----------|-------|
| 1 | **Agent Orchestration** | **9** | 4 | JAK: 9-node DAG, parallel tasks, conditional edges, retry, approval gates. DeerFlow: single lead agent delegates to 3 max subagents |
| 2 | **Agent Specialization** | **9** | 3 | JAK: 37 typed roles (CEO, CFO, CTO, HR, Legal, etc.) with industry prompts. DeerFlow: 2 subagent types (general-purpose, bash) |
| 3 | **Tool System** | 7 | **8** | JAK: 46 tools, 11 categories, risk classification, MCP client. DeerFlow: fewer tools but 18-middleware resilience chain, dangling call recovery, guardrail provider protocol |
| 4 | **Memory Persistence** | 3 | **8** | JAK: DB schema + routes exist but agent retrieval NOT wired. DeerFlow: LLM extraction → fact dedup → JSON persistence → prompt injection — fully operational |
| 5 | **Context Engineering** | 2 | **9** | JAK: no summarization, no context budget. DeerFlow: SummarizationMiddleware, 2000-token injection cap, filesystem offloading, loop detection |
| 6 | **Sandbox/Code Execution** | 4 | **9** | JAK: E2B `code_execute` tool. DeerFlow: full virtual filesystem (5 tools), Docker/K8s providers, path translation, per-sandbox serialization |
| 7 | **Security & Compliance** | **9** | 3 | JAK: PII detection (10 types), injection detection (25+ patterns), RBAC (4 roles, 26 perms), audit logging. DeerFlow: designed for "127.0.0.1 only", no auth |
| 8 | **Multi-Tenancy** | **9** | 1 | JAK: tenant isolation throughout (DB, API, billing, tools). DeerFlow: single-user only |
| 9 | **Billing/Credits** | **8** | 1 | JAK: credit reservation, 3-tier model routing, usage ledger, daily/per-task caps, provider health. DeerFlow: none |
| 10 | **Industry Packs** | **8** | 1 | JAK: 13 industries with compliance keywords, prompt supplements, classification. DeerFlow: none |
| 11 | **Verification/QA** | **8** | 2 | JAK: 5 analyzers, risk scoring, cross-evidence correlation, model-tier escalation. DeerFlow: no verification system |
| 12 | **Skill System** | 3 | **7** | JAK: DB model + approval workflow (code exists, not agent-invoked). DeerFlow: SKILL.md progressive loading, container paths, runtime install |
| 13 | **Voice Pipeline** | **6** | 1 | JAK: 4 providers (OpenAI Realtime, Deepgram, ElevenLabs, Mock), WebRTC/WebSocket. DeerFlow: none |
| 14 | **Frontend UX** | 6 | **7** | JAK: Mosaic tiling + floating windows, Zustand. DeerFlow: Next.js with artifacts, todos, file upload with auto-conversion |
| 15 | **IM Channel Integration** | 1 | **8** | JAK: none. DeerFlow: Feishu (card streaming), Slack, Telegram — all long-polling, no public IP required |
| 16 | **Developer Experience** | 4 | **9** | JAK: manual env setup, no diagnostics. DeerFlow: `make doctor`, `make setup` wizard, `make check`, config version migration |
| 17 | **Observability** | 6 | **7** | JAK: OpenTelemetry + Prometheus. DeerFlow: LangSmith + Langfuse dual-provider, per-middleware tracing |
| 18 | **Distributed Coordination** | **8** | 2 | JAK: Redis locks, leader election, pub/sub relay, circuit breakers. DeerFlow: single-process only |
| 19 | **Embedded Client API** | 1 | **8** | JAK: none. DeerFlow: `DeerFlowClient` full in-process Python API with Gateway conformance tests |
| 20 | **Error Recovery** | 4 | **8** | JAK: per-task retry (max 3), skip-on-failure. DeerFlow: 5 error-handling middlewares, tool error normalization, loop detection + hard stop |

**Aggregate:**
- **JAK Swarm:** 117 / 200 (58.5%) — Strong enterprise orchestration, weak operational polish
- **DeerFlow 2.0:** 107 / 200 (53.5%) — Strong agent resilience, weak enterprise features

**Interpretation:** JAK wins on *what matters for enterprise customers* (security, multi-tenancy, billing, compliance, orchestration). DeerFlow wins on *what matters for agent reliability* (memory, context, error recovery, DX). The gap is complementary, not competitive.

---

## Part 3 — Extraction Matrix

What to take from DeerFlow, what to leave, and why.

### ✅ EXTRACT — High-value patterns that strengthen JAK's vision

| # | DeerFlow Pattern | JAK Adaptation | Effort | Impact |
|---|-----------------|----------------|--------|--------|
| 1 | **MemoryMiddleware + debounced queue** | Add memory extraction as a SwarmGraph post-execution hook — after workflow completes, queue conversation for LLM fact extraction into TenantMemory | M | Critical — closes JAK's biggest gap |
| 2 | **Fact deduplication (whitespace-normalized)** | Apply dedup logic when writing to TenantMemory — compare normalized `key+value` before insert | S | Prevents memory bloat |
| 3 | **Memory injection into system prompt** | Before BaseAgent.callLLM(), inject top N tenant memories as `<memory>` block in system prompt | S | Enables cross-session learning |
| 4 | **SummarizationMiddleware pattern** | Add token budget tracking to SwarmState; when conversation exceeds threshold, summarize older messages before next node | M | Prevents context window overflow on long workflows |
| 5 | **DanglingToolCallMiddleware** | In BaseAgent.toolLoop(), detect when previous LLM response had tool_calls but loop was interrupted — inject placeholder ToolMessages | S | Prevents silent failures in multi-turn tool loops |
| 6 | **ToolErrorHandlingMiddleware** | Wrap tool execution in BaseAgent.toolLoop() with error→ToolMessage conversion instead of throwing | S | Agent can recover from bad tool calls |
| 7 | **LoopDetectionMiddleware** | Track tool-call fingerprints in SwarmState; if same tool+args repeated 3x, inject "stop — you're looping" message | S | Prevents infinite LLM loops burning credits |
| 8 | **`make doctor` / `make setup` DX** | Create `scripts/doctor.ps1` and `scripts/setup.ps1` — check Node, pnpm, Postgres, Redis, env vars, ports | S | Massively reduces onboarding friction |
| 9 | **Config version migration** | Add `configVersion` field to tenant settings; on API boot, compare and emit migration warnings | S | Smooth upgrades |
| 10 | **SKILL.md format for skill definitions** | Extend JAK's Skill model to support SKILL.md frontmatter (name, description, allowed-tools) alongside existing code-based skills | M | Enables community skill marketplace |

### ⚠️ ADAPT — Take the concept, reshape for JAK's architecture

| # | DeerFlow Pattern | JAK Adaptation | Reasoning |
|---|-----------------|----------------|-----------|
| 1 | **File-based memory.json** | Keep Prisma + PostgreSQL (TenantMemory model already exists) — never downgrade to file-based | JAK is multi-tenant; file-based storage is single-user only |
| 2 | **Single lead agent + subagents** | Keep SwarmGraph 9-node DAG — DeerFlow's "lead agent delegates tasks" maps to JAK's commander→planner→router→worker pattern, but JAK's is more granular | JAK's multi-agent coordination is a competitive advantage |
| 3 | **Sandbox virtual filesystem** | Add virtual path translation to JAK's E2B tool execution — `/mnt/workspace/` maps to tenant-scoped storage | Useful for vibe coding features, not for business workflows |
| 4 | **IM channels (Feishu/Slack/Telegram)** | Build Slack + Teams adapters that map incoming messages to `POST /workflow` — but scope to JAK's multi-tenant + RBAC model | DeerFlow maps IM→thread; JAK would map IM→workflow with tenant auth |
| 5 | **Gateway embedded runtime** | Not applicable — JAK's Fastify API already embeds the SwarmGraph runtime; no separate process to eliminate | JAK doesn't have a separate "runner" process |
| 6 | **DeerFlowClient embedded API** | Create `@jak-swarm/client` package with typed methods for programmatic workflow execution | Enables SDK-first integration pattern |

### ❌ DO NOT EXTRACT — Patterns that would weaken JAK

| # | DeerFlow Pattern | Why Not |
|---|-----------------|---------|
| 1 | **"Local trusted environment" security model** | JAK serves enterprise multi-tenant; "trust localhost" is the opposite of what JAK needs |
| 2 | **No authentication** | JAK has Supabase JWT + RBAC — never remove this |
| 3 | **No billing/credits** | DeerFlow is free-to-run; JAK monetizes via credits — incompatible |
| 4 | **Single-user thread model** | JAK's tenant→user→workflow hierarchy is non-negotiable |
| 5 | **LangGraph dependency** | JAK's custom SwarmGraph avoids a heavy Python dependency and gives full control over the execution loop |
| 6 | **Python backend** | JAK is TypeScript end-to-end; introducing Python would fragment the stack |
| 7 | **18-middleware chain** | DeerFlow has 18 middlewares because it has ONE agent doing everything. JAK's 9-node graph already separates concerns architecturally — don't collapse into middleware soup |
| 8 | **No verification system** | DeerFlow has no output verification; JAK's 5-analyzer verification pipeline is a differentiator |
| 9 | **No industry packs** | DeerFlow is industry-agnostic; JAK's 13 industry packs are a moat |

---

## Part 4 — Phased Integration Plan

### Phase 1: Memory Activation (Weeks 1-3)
**Goal:** Wire JAK's existing memory infrastructure into the agent execution loop

1. **Memory Extraction Hook** — After `SwarmGraph.run()` completes, extract key facts from workflow traces and store in `TenantMemory`
2. **Memory Injection** — Before each `BaseAgent.callLLM()`, query top 15 TenantMemory entries and inject as `<memory>` tags in system prompt
3. **Deduplication** — Normalize whitespace and compare before inserting new memory entries
4. **TTL Enforcement** — Add a cron or scheduled job to prune expired TenantMemory entries

### Phase 2: Agent Resilience (Weeks 3-5)
**Goal:** Harden the tool execution loop against silent failures

1. **Tool Error Normalization** — In `BaseAgent.toolLoop()`, catch tool execution errors and convert to assistant-facing error messages instead of throwing
2. **Dangling Tool-Call Recovery** — Detect interrupted tool loops and inject placeholder responses
3. **Loop Detection** — Track tool-call signatures in SwarmState; break after 3 identical calls
4. **Budget-Aware Context Trimming** — Add `contextTokens` to SwarmState; when exceeding 80% of model context window, summarize older task results

### Phase 3: Developer Experience (Weeks 5-6)
**Goal:** Match DeerFlow's onboarding quality

1. **`scripts/doctor.ps1`** — Verify Node.js, pnpm, PostgreSQL, Redis, Supabase, env vars, port availability
2. **`scripts/setup.ps1`** — Interactive first-run wizard: create `.env`, run `pnpm install`, `prisma migrate`, seed data
3. **Health endpoint enrichment** — Expand `GET /health` to report DB, Redis, LLM provider, and MCP server status
4. **Config validation on boot** — Warn on missing API keys, unreachable services, schema drift

### Phase 4: Platform Extensions (Weeks 6-10)
**Goal:** Expand JAK's reach without changing its identity

1. **Slack Integration** — Inbound: map Slack messages to `POST /workflow` with tenant auth via Slack app OAuth. Outbound: stream workflow results back to thread
2. **Microsoft Teams Integration** — Same pattern, Bot Framework adapter
3. **`@jak-swarm/client` SDK** — Typed TypeScript package for programmatic workflow CRUD, execution, and streaming
4. **SKILL.md Support** — Parse SKILL.md frontmatter in addition to DB-stored skills; mount skills into agent system prompt at execution time

---

## Part 5 — Build Spec

### 5A — Memory Extraction Service

**File:** `packages/swarm/src/memory/memory-extractor.ts`

```typescript
interface MemoryExtractionResult {
  facts: Array<{
    key: string;       // Normalized identifier
    value: unknown;    // Structured fact content
    type: MemoryType;  // FACT | PREFERENCE | CONTEXT | SKILL_RESULT
    confidence: number; // 0.0 - 1.0
    source: string;    // workflowId
  }>;
}

// Called after SwarmGraph.run() completes
async function extractMemories(
  state: SwarmState,
  llmProvider: LLMProvider
): Promise<MemoryExtractionResult> {
  // 1. Collect traces with meaningful outputs
  // 2. Build extraction prompt with workflow goal + task results
  // 3. Call LLM to extract discrete facts
  // 4. Score confidence per fact
  // 5. Return for persistence by API layer
}
```

**Integration point:** `SwarmExecutionService.executeAsync()` — after `swarmRunner.run()` resolves, call `extractMemories()` and persist via `TenantMemory.createMany()`.

**Deduplication:** Before insert, query existing memories with same `tenantId` + normalized `key`. Skip if `value` matches after whitespace normalization.

### 5B — Memory Injection in BaseAgent

**File:** `packages/agents/src/base/base-agent.ts` — modify `callLLM()`

```typescript
// Before building messages array:
if (context.tenantId) {
  const memories = await this.getRelevantMemories(context.tenantId, context.goal);
  if (memories.length > 0) {
    const memoryBlock = memories
      .slice(0, 15)
      .map(m => `- ${m.key}: ${JSON.stringify(m.value)}`)
      .join('\n');
    // Inject after system message
    messages.splice(1, 0, {
      role: 'system',
      content: `<memory>\n${memoryBlock}\n</memory>`
    });
  }
}
```

**Token budget:** Cap memory injection at 2000 tokens. If memories exceed, prioritize by `confidence` descending, then `updatedAt` descending.

### 5C — Tool Error Normalization

**File:** `packages/agents/src/base/base-agent.ts` — modify `toolLoop()`

```typescript
// In the tool execution try/catch:
try {
  const result = await tool.execute(args, executionContext);
  toolMessages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: call.id });
} catch (err) {
  // Instead of throwing, convert to recoverable error message
  const errorMsg = err instanceof Error ? err.message : String(err);
  toolMessages.push({
    role: 'tool',
    content: `Error executing ${call.function.name}: ${errorMsg}. Try a different approach.`,
    tool_call_id: call.id
  });
  // Continue the loop — let the LLM decide how to recover
}
```

### 5D — Loop Detection

**File:** `packages/swarm/src/graph/swarm-graph.ts` — add to `SwarmState`

```typescript
// In SwarmState interface:
toolCallFingerprints?: Map<string, number>; // fingerprint → count

// In workerNode or BaseAgent.toolLoop():
const fingerprint = `${toolName}:${JSON.stringify(args)}`;
const count = (state.toolCallFingerprints?.get(fingerprint) ?? 0) + 1;
if (count >= 3) {
  // Inject hard-stop message
  messages.push({
    role: 'system',
    content: 'You are repeating the same tool call. Stop and summarize what you have so far.'
  });
}
```

### 5E — Doctor Script

**File:** `scripts/doctor.ps1`

```powershell
# Check: Node.js >= 20, pnpm >= 9, PostgreSQL running, Redis running
# Check: .env exists with required keys (OPENAI_API_KEY, DATABASE_URL, etc.)
# Check: Prisma migrations are current
# Check: Ports 3000, 3001 are available
# Output: ✅ / ❌ per check with fix instructions
```

---

## Part 6 — Memory Persistence Blueprint

### Current State (JAK)

```
┌─────────────────────────────────────────────────┐
│                WHAT EXISTS TODAY                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  Prisma Model: TenantMemory                     │
│  ┌───────────────────────────────────────────┐  │
│  │ tenantId  (String)  ──┐                   │  │
│  │ key       (String)    ├── Unique compound │  │
│  │ value     (Json)      │                   │  │
│  │ memoryType (Enum)     │                   │  │
│  │ expiresAt  (DateTime?)│                   │  │
│  │ createdAt  (DateTime) │                   │  │
│  │ updatedAt  (DateTime) │                   │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  API Routes: memory.routes.ts                   │
│  ┌───────────────────────────────────────────┐  │
│  │ GET    /memory          List entries      │  │
│  │ GET    /memory/:key     Get by key        │  │
│  │ PUT    /memory/:key     Upsert entry      │  │
│  │ DELETE /memory/:key     Delete entry      │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Vector Store: VectorDocument model             │
│  ┌───────────────────────────────────────────┐  │
│  │ Embedding storage for semantic search     │  │
│  │ (Schema exists, adapter code exists)      │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ❌ NOT WIRED: Agents don't read/write memory   │
│  ❌ NOT WIRED: No extraction after execution     │
│  ❌ NOT WIRED: No injection into agent prompts   │
│  ❌ NOT WIRED: Vector search not connected       │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Target Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                    MEMORY PERSISTENCE ARCHITECTURE                     │
│                                                                        │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────────┐    │
│  │  Workflow    │───▶│  SwarmGraph   │───▶│  Memory Extraction     │    │
│  │  Trigger     │    │  Execution    │    │  (post-execution hook) │    │
│  └─────────────┘    └──────────────┘    └─────────┬──────────────┘    │
│                                                   │                    │
│                                                   ▼                    │
│                                         ┌──────────────────┐          │
│                                         │  LLM Fact        │          │
│                                         │  Extractor        │          │
│                                         │                   │          │
│                                         │  Input: traces,   │          │
│                                         │  goal, outputs    │          │
│                                         │                   │          │
│                                         │  Output: facts[]  │          │
│                                         └────────┬─────────┘          │
│                                                  │                     │
│                           ┌──────────────────────┼──────────────┐     │
│                           │                      │              │     │
│                           ▼                      ▼              ▼     │
│                    ┌─────────────┐    ┌────────────────┐ ┌──────────┐│
│                    │ Dedup Gate  │    │  Confidence     │ │  TTL     ││
│                    │             │    │  Scorer         │ │  Tagger  ││
│                    │ Normalize   │    │                 │ │          ││
│                    │ key+value,  │    │ Score: 0.0-1.0  │ │ FACT: ∞  ││
│                    │ skip if     │    │ Below 0.7: skip │ │ CONTEXT: ││
│                    │ exists      │    │                 │ │  30 days ││
│                    └──────┬──────┘    └───────┬────────┘ └────┬─────┘│
│                           │                   │               │      │
│                           └───────────┬───────┘───────────────┘      │
│                                       │                              │
│                                       ▼                              │
│                            ┌──────────────────────┐                  │
│                            │    TenantMemory       │                  │
│                            │    (PostgreSQL)        │                  │
│                            │                        │                  │
│                            │  + VectorDocument      │                  │
│                            │    (semantic search)   │                  │
│                            └──────────┬─────────────┘                  │
│                                       │                              │
│                    ┌──────────────────┘                               │
│                    │                                                   │
│                    ▼                                                   │
│         ┌───────────────────────┐                                     │
│         │  Memory Injection     │                                     │
│         │  (pre-execution)      │                                     │
│         │                       │                                     │
│         │  1. Query by tenantId │                                     │
│         │  2. Rank: confidence  │                                     │
│         │     desc, recent first│                                     │
│         │  3. Cap at 2000 tokens│                                     │
│         │  4. Inject as         │                                     │
│         │     <memory> block    │                                     │
│         │     in system prompt  │                                     │
│         └───────────┬───────────┘                                     │
│                     │                                                  │
│                     ▼                                                  │
│           ┌─────────────────┐                                         │
│           │  BaseAgent      │                                         │
│           │  .callLLM()     │                                         │
│           │                 │                                         │
│           │  System prompt  │                                         │
│           │  includes:      │                                         │
│           │  - Role prompt  │                                         │
│           │  - Industry     │                                         │
│           │  - <memory>     │◄── NEW                                  │
│           │  - Task context │                                         │
│           └─────────────────┘                                         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Memory Data Model (Enhanced)

```
TenantMemory (existing — no schema change needed)
├── tenantId     String        Partition key
├── key          String        Unique within tenant
├── value        Json          Structured fact content
├── memoryType   Enum          FACT | PREFERENCE | CONTEXT | SKILL_RESULT
├── expiresAt    DateTime?     Auto-cleanup (null = permanent)
├── createdAt    DateTime
└── updatedAt    DateTime

Compound unique: (tenantId, key)
```

**Why no schema change:** The existing TenantMemory model already supports everything needed — tenant partitioning, JSON values, typed categories, and TTL. The gap isn't the data model; it's the **read/write integration with the agent loop**.

### Implementation Sequence

```
Step 1: Memory Extractor (new file)
    packages/swarm/src/memory/memory-extractor.ts
    - extractMemories(state: SwarmState, provider: LLMProvider): MemoryExtractionResult
    - Uses tier-1 model (cheap) for extraction
    - Prompt: "Extract key facts from this workflow execution..."

Step 2: Dedup + Persist Hook (modify existing)
    apps/api/src/services/swarm-execution.service.ts
    - After swarmRunner.run() resolves
    - Call extractMemories()
    - Dedup against existing TenantMemory
    - Bulk upsert via prisma.tenantMemory.createMany()

Step 3: Memory Query Service (new file)
    packages/swarm/src/memory/memory-query.ts
    - getRelevantMemories(tenantId, goal?, limit = 15): TenantMemory[]
    - Orders by confidence (if scored), then recency
    - Respects TTL (skip expired)
    - Token-budget aware (cap at 2000 tokens)

Step 4: Injection in BaseAgent (modify existing)
    packages/agents/src/base/base-agent.ts
    - In callLLM() or new prepareMessages() method
    - If context.tenantId exists, query memories and inject <memory> block
    - Position: after system prompt, before user message

Step 5: Vector Enhancement (future)
    - Use VectorDocument for semantic memory retrieval
    - Embed workflow goals + outputs
    - Retrieve memories by semantic similarity to current goal
    - Requires embedding model (OpenAI text-embedding-3-small)
```

### DeerFlow Comparison — What JAK's Approach Improves

| Aspect | DeerFlow | JAK (target) |
|--------|----------|-------------|
| Storage | `memory.json` file — single user, no replication, lost on container restart | PostgreSQL `TenantMemory` — multi-tenant, replicated, backed up, queryable |
| Isolation | None — one memory pool | Per-tenant partitioning with RBAC |
| Search | Linear scan of facts array | Indexed DB queries + future vector similarity |
| Scalability | Single-process file lock | Distributed — any API instance can read/write |
| Schema | Untyped JSON with categories | Typed Prisma model with validation |
| Dedup scope | Per-append dedup | Per-tenant dedup with normalized key matching |
| TTL | None — facts accumulate forever | Configurable per-entry expiry with auto-cleanup |
| Injection cap | 2000 tokens (hardcoded) | 2000 tokens (configurable per tenant/plan) |

---

## Part 7 — Final Recommendation

### Top 10 Things JAK Should Extract from DeerFlow

| # | What | Why | Priority |
|---|------|-----|----------|
| 1 | **Memory extraction + injection loop** | JAK's biggest gap — DB + routes exist but agents are amnesiac | P0 |
| 2 | **Tool error→message normalization** | Agents crash on tool failures instead of recovering | P0 |
| 3 | **Loop detection with hard-stop** | No guard against infinite tool-call loops burning credits | P0 |
| 4 | **Dangling tool-call recovery** | Interrupted tool loops leave state inconsistent | P1 |
| 5 | **Context summarization for long workflows** | 10+ task workflows will exceed context windows | P1 |
| 6 | **`make doctor` / `scripts/doctor.ps1`** | First-run experience is a major barrier | P1 |
| 7 | **SKILL.md parsing for community skills** | Lowers skill creation barrier vs DB-only approach | P2 |
| 8 | **Config validation on boot** | Silent failures from missing API keys waste debugging time | P2 |
| 9 | **Embedded client SDK** (`@jak-swarm/client`) | Enables programmatic integration without HTTP | P2 |
| 10 | **Slack/Teams channel bridge** | Maps IM messages to authenticated workflows | P3 |

### Top 10 Things JAK Should NEVER Copy from DeerFlow

| # | What | Why |
|---|------|-----|
| 1 | **Single lead-agent architecture** | JAK's 37-role, 9-node DAG is its core differentiator — collapsing to one agent destroys the product |
| 2 | **File-based memory storage** | Single-user, no replication, lost on restart — incompatible with multi-tenant SaaS |
| 3 | **"Local trusted environment" security** | JAK serves enterprises; "trust localhost" is a non-starter |
| 4 | **No authentication / no RBAC** | JAK's 4-role RBAC with 26 permissions is table stakes for enterprise |
| 5 | **Python backend** | JAK is TypeScript end-to-end; adding Python fragments the stack, doubles CI, splits team expertise |
| 6 | **LangGraph dependency** | JAK's custom SwarmGraph gives full control without a heavyweight Python dependency |
| 7 | **18-middleware monolith** | DeerFlow uses 18 middlewares because one agent does everything; JAK's 9-node graph already separates concerns architecturally |
| 8 | **No billing system** | DeerFlow is run-for-free; JAK monetizes via credits with reservation, reconciliation, and usage ledger |
| 9 | **No industry packs** | DeerFlow is generic; JAK's 13 industry packs with compliance keywords are a competitive moat |
| 10 | **No verification pipeline** | DeerFlow trusts agent output; JAK's 5-analyzer verification with cross-evidence scoring is an enterprise requirement |

### Strategic Positioning

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    AGENT PLATFORM LANDSCAPE                      │
│                                                                 │
│   Complexity ▲                                                  │
│              │                                                  │
│              │              ┌─────────────┐                     │
│   Enterprise │              │  JAK Swarm  │                     │
│   Multi-Agent│              │  ★          │                     │
│   Orchestr.  │              │  37 agents  │                     │
│              │              │  9-node DAG │                     │
│              │              │  13 industry│                     │
│              │              │  Multi-tenant│                    │
│              │              └─────────────┘                     │
│              │                                                  │
│              │  ┌───────────────┐                               │
│              │  │  DeerFlow 2.0 │                               │
│              │  │  ★            │                               │
│   Single     │  │  1 agent      │                               │
│   Agent      │  │  18 middleware│                               │
│   Coding     │  │  File memory  │                               │
│              │  │  Sandbox      │                               │
│              │  └───────────────┘                               │
│              │                                                  │
│              └──────────────────────────────────────────────▶   │
│                         Personal             Enterprise         │
│                         (single-user)        (multi-tenant)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**JAK Swarm is not competing with DeerFlow.** They occupy different quadrants. DeerFlow is a personal AI coding assistant; JAK is an enterprise business operations platform. The only overlap is that both use LLMs and tools.

The extraction opportunity is narrow and surgical:
1. **Wire memory** (the data model is already there)
2. **Harden tools** (add 3 resilience patterns to `BaseAgent.toolLoop()`)
3. **Polish DX** (one script to validate the development environment)

Everything else DeerFlow does well — sandbox filesystem, IM channels, embedded client — is nice-to-have for JAK and belongs in Phase 4+ after the core memory and resilience gaps are closed.

**JAK's moat is not technology — it's architecture.** A 9-node DAG with 37 specialized agents, verification pipelines, industry compliance, credit billing, and distributed coordination is 6+ months of engineering that DeerFlow hasn't attempted and doesn't need to. Protect that moat. Fill the memory gap. Ship.

---

*End of report.*
