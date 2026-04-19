# JAK Swarm — Competitive Positioning

**Identity**: JAK Swarm is an **operator-grade multi-agent control plane** with risk-stratified approvals, tool maturity enforcement, and distributed coordination — not a consumer AI coding product.

This document exists so the marketing copy, pricing decisions, and roadmap prioritization share the same mental model. It is deliberately blunt about where we do and don't compete.

---

## Where we compete (and win)

These capabilities exist, are wired through production paths, and are demonstrable to an operator today.

### 1. Distributed coordination
- Redis-backed workflow signal bus with pause / unpause / stop semantics across instances
- `FOR UPDATE SKIP LOCKED` durable queue over Postgres; workers can be killed mid-run and another instance reclaims on next poll
- Leader election for scheduled workflows (avoids cron duplicates)
- SSE relay so any instance can stream a workflow's events regardless of which instance is executing it

### 2. Risk-stratified approval gates
- Every tool carries a `riskClass` and `requiresApproval` flag on its metadata
- Write-ops (CRM UPDATE, SEND email, CREATE_EVENT, DEPLOY) short-circuit to the approval node regardless of what the LLM wanted to do
- Approval requests persist in `approval_requests` with reviewer identity, comment, timestamp, and decision — audit-grade

### 3. Tool maturity manifest + CI truth-check
- All 119 built-in tools carry an honest `maturity` label (real / heuristic / llm_passthrough / config_dependent / experimental)
- `pnpm check:truth` fails CI if any tool ships unclassified, or if any README / landing-page claim drifts from the registry
- The manifest is queryable at runtime via `toolRegistry.getManifest()`, surfaced in admin UI
- This is not a documentation convention — it's a machine-enforced invariant

### 4. LLM tier routing by agent role
- `provider-router.ts` classifies tier-1 (fast/cheap) vs tier-3 (deep/expensive) providers per task
- Commander + Planner + simple workers route tier-1; App Architect + Technical + Marketing strategist route tier-3
- Subscription tier gates `maxModelTier` so free-tier users can't accidentally spend on Opus runs

### 5. Vibe Coder chain with auto-repair + checkpoints
- Architect → Generator → Build-check → Debugger (≤3 retries) → Deployer runs end-to-end as a durable workflow
- Build-check has 3 layers: heuristic (truncation/placeholder detection) → TypeScript compiler (real syntax+type errors) → optional Docker-backed build
- Every stage auto-snapshots to `project_versions` with a structural diff; operators can restore to any prior checkpoint

### 6. Session-level cross-agent memory
- Typed memory extraction, confidence-weighted writes, idempotency keys, and `MemoryEvent` audit trail
- Not a vector-search-only retrieval hack — structured facts survive re-runs

---

## Category baseline (parity, not differentiation)

Things we do that every serious agent framework does. These keep us from looking broken, but they don't win deals.

- DAG / graph execution with typed node handlers
- SSE event streams for the operator UI
- A roster of specialist role agents with tool allowlists
- MCP server integration for discovery
- Observability / trace UI

---

## Where we do **not** compete

Being honest about this makes the marketing sharper and the roadmap cheaper.

### Consumer vibe-coding
**We will not out-ship Cursor, Bolt, or v0 as a consumer coding product.** They have better chat UX, better streaming file edits, tighter IDE integration, and larger context windows tuned for code editing. Our Vibe Coder is a *durable workflow* that creates checkpoints and can be reclaimed across instances — not a chat window.

If a prospect's primary need is "I want to sit in an IDE and prompt my way to an app," Cursor wins. If the need is "my team runs AI-generated apps in production and needs approval gates, rollback, audit, and multi-tenant isolation," JAK wins.

### Deep single-domain tools
**We will not out-specialize a vertical tool.** Clay for sales enrichment, Clearbit for enrichment, Intercom for support, Perplexity for research — each invests deeper than we do in their one thing. Our value is orchestrating across domains with durable coordination, not replacing any one vertical.

### Raw LLM benchmarks
We route models, we don't train them. Claiming a raw capability edge over OpenAI or Anthropic is a category error.

---

## Benchmarks (honest)

- `pnpm bench:search` — runs a 30-query fixed set through Serper / Tavily / DDG and emits a structured report. Requires at least one provider key; partial runs supported.
- `pnpm bench:vibe-coder` — runs 5 app-generation specs through the real workflow, scoring files-generated, required-files-present, and truncation-phrase absence. Requires an LLM key; `--docker` flag adds a real container build as the deepest verification layer.

No "10x cheaper" claim appears anywhere in the repo. We can route to a cheaper model than a single-model platform on many tasks, but until the bench produces a dollar figure on a comparable workload, the claim doesn't ship.

---

## Positioning one-liners by audience

- **To a platform engineer**: "A multi-agent control plane with durable queues, risk-stratified approvals, and a tool-maturity manifest CI-enforced against your marketing copy."
- **To a CTO**: "The operator layer between your team's agents and production — approval gates, audit trail, rollback, and cross-instance durability built in."
- **To a founder evaluating against Cursor / Bolt**: "If you're building a product with AI inside, JAK is your control plane. If you're looking for a consumer coding IDE, Cursor wins — we don't compete there."

---

## What would move us from "operator-grade" to "industry leader"

Not code. Evidence:
- Uptime history on a real multi-tenant deployment
- A named customer who delegated an end-to-end workflow to JAK and got operator-grade results for 30+ days
- 3 production apps shipped via Vibe Coder with ≥2 debug-retry iterations each
- A benchmark we're comfortable publishing against a comparable platform (with methodology in the repo)

These are §10 of the final truth report, not this document.
