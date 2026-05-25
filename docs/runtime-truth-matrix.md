# JAK Swarm — Runtime Truth Matrix (2026-05-25)

## Landing Page Claims vs. Runtime Reality

### Agent Count Claim: "38 agents"
**VERDICT: TRUE**

| Category | Count | Agents |
|----------|-------|--------|
| Orchestrators | 6 | Commander, Planner, Router, Verifier, Guardrail, Approval |
| Workers | 32 | Browser, Analytics, AppDebugger, AppGenerator, AppArchitect, Coder, Calendar, CRM, Email, Document, Content, Designer, Growth, Finance, Marketing, HR, Ops, PR, Legal, Knowledge, Product, Research, Project, AppDeployer, ScreenshotToCode, SEO, Voice, Spreadsheet, Support, Strategist, Success, Technical |
| **Total** | **38** | **Exact match** |

### Tool Count Claim: "122 tools"
**VERDICT: TRUE** (with 4 orphaned implementations noted)

- 122 tools actively registered in `registerBuiltinTools()`
- 4 orphaned Phoring tools exist in source but are NOT wired to runtime
- MCP bridge loads external tools dynamically at runtime (not counted in 122)

### 7-Step Pipeline Claim
**VERDICT: TRUE**

The pipeline `Command → Plan → Route → Execute → Approve → Verify → Deliver` is implemented via LangGraph nodes:
1. `commanderNode` (`packages/swarm/src/graph/nodes/commander-node.ts`)
2. `plannerNode` (`packages/swarm/src/graph/nodes/planner-node.ts`)
3. `routerNode` (`packages/swarm/src/graph/nodes/router-node.ts`)
4. `workerNode` (`packages/swarm/src/graph/nodes/worker-node.ts`)
5. `approvalNode` (`packages/swarm/src/graph/nodes/approval-node.ts`)
6. `verifierNode` (`packages/swarm/src/graph/nodes/verifier-node.ts`)
7. `compileFinalOutput` (end node in `packages/swarm/src/graph/nodes/output-node.ts`)

---

## Visible Role Truth Matrix

| Frontend Role | Backend Worker | Maturity | Tools Available | Landing Claim Match |
|---------------|---------------|----------|-----------------|---------------------|
| **CEO** | WORKER_STRATEGIST | `world_class` | Strategy frameworks, SWOT, OKRs, board reports, competitor monitoring, executive summaries | YES |
| **CTO** | WORKER_TECHNICAL | `world_class` | Architecture review, tech stack evaluation, security audit, dependency check, tech debt estimation, GitHub repo analysis | YES |
| **CMO** | WORKER_MARKETING | `world_class` | Campaign design, GTM planning, brand audit, content strategy, 9 dedicated marketing tools | YES |
| **Code** | WORKER_CODER | `world_class` | Code generation, debugging, review, sandboxed execution (E2B), complete-file generation, no-truncation invariant | YES |
| **Research** | WORKER_RESEARCH | `upgraded` | Multi-provider web search (Serper→Tavily→DDG), source quality grading, citation mapping, competitive intel | YES |
| **Design** | WORKER_DESIGNER | `strong` | UI/UX specs, accessibility audits, design-system tokens, component schemas | YES |
| **Auto** | WORKER_OPS | `upgraded` | Cron scheduling, webhook orchestration, monitoring alerts, incident triage, rollback planning | YES |
| **Legal** | WORKER_LEGAL | `strong` | Contract review, NDA drafting, compliance checklists, obligation extraction, regulation monitoring | YES |

**All 8 visible roles map to implemented workers with maturity `strong` or higher. No hidden/unimplemented roles.**

---

## Trust Layer Claims Verification

| Trust Claim | Evidence File | Status |
|-------------|--------------|--------|
| Human approval gates | `packages/swarm/src/graph/nodes/approval-node.ts` | IMPLEMENTED |
| Source-grounded outputs (citation density >= 0.7) | `packages/agents/src/roles/verifier.agent.ts` | IMPLEMENTED |
| Tool maturity labels | `scripts/check-docs-truth.ts` + `packages/tools/src/builtin/index.ts` | IMPLEMENTED (122 labeled) |
| Tamper-evident audit trail | `packages/agents/src/base/agent-context.ts` + audit-log plugin | IMPLEMENTED |
| Self-hostable open-source core | MIT License + `docker-compose.yml` | VERIFIED |
| OpenAI-first runtime | `packages/agents/src/runtime/openai-runtime.ts` | IMPLEMENTED |

---

## Runtime Fix Verification (This Session)

### Fix 1: Commander Fallback Hardening
**Files changed:**
- `packages/agents/src/roles/commander.agent.ts` (exported `inferIntentFromKeywords`, `buildHelpfulClarification`)
- `packages/agents/src/index.ts` (added exports)
- `packages/agents/src/roles/commander.agent.test.ts` (NEW — 44 tests)

**What changed:**
1. Added deterministic keyword inference with 16 regex patterns covering: website review, marketing plan, content creation, strategy, investor materials, competitor research, code, research, pricing, sales outreach, SOP, customer persona, product positioning, legal/compliance, HR, document analysis, browser inspection.
2. URL normalization: bare `www.*` domains get `https://` prepended before LLM processing.
3. When LLM structured response fails (recoverable schema mismatch), keyword inference runs BEFORE falling back to generic message.
4. When LLM returns `clarificationNeeded: true`, keyword inference overrides it if confidence >= 0.75.
5. `buildHelpfulClarification` asks targeted questions based on detected role, URL, or input length instead of generic "rephrase".

**Local verification:**
- 13/13 keyword inference tests passed
- 3/3 clarification tests passed
- 44/44 unit tests passed

### Fix 2: Swarm Graph Defensive Fallback
**Files changed:**
- `packages/swarm/src/graph/nodes/commander-node.ts`

**What changed:**
When `CommanderAgent.execute()` returns without `missionBrief` (historical "I had trouble understanding" path), the node now returns `clarificationNeeded: true` with a targeted question instead of `directAnswer` with the generic fallback message.

### Fix 3: Production API Contract
**File:** `apps/api/src/routes/workflows.routes.ts:324`

**Verified:**
- Production API returns `kind: 'workflow_created'` correctly.
- Smoke test: `createStatus: 202`, `persistedGetStatus: 200`, `sseStatus: 200`, `continueKind: 'followup_executed'`.
- **WARNING:** Production deployment appears stale — `finalOutputLen` was only 86 characters, suggesting the old Commander code is still running. The fixes in this session need to be deployed.

---

## Known Issues

1. **Production deployment is stale.** The production API returned a workflow with `finalOutputLen: 86` for "www.jakswarm.com, just review the website" — this is too short for a meaningful CTO audit. The new keyword inference + role-aware routing code is NOT deployed yet.
2. **Phoring tools are orphaned.** 4 tool implementations (`phoring_forecast`, `phoring_graph_query`, `phoring_validate`, `phoring_simulate`) exist in source but are not registered in the runtime. They should either be wired in or removed to avoid confusion.
3. **No E2E test for the new keyword inference path.** The existing E2E (`cto-mobile-production-regression.spec.ts`) tests the happy path but does not explicitly assert that keyword inference produces a `missionBrief` when the LLM fails.

---

## Test Results Summary

| Test Suite | Files | Tests | Status |
|------------|-------|-------|--------|
| `@jak-swarm/agents` | 1 | 44 | PASS |
| `@jak-swarm/swarm` | 1 | 32 | PASS |
| `@jak-swarm/tests` (integration) | 160 | 2109 | PASS |
| `@jak-swarm/tools` | 0 | 0 | PASS (no tests) |
| **Total** | **162** | **2185** | **ALL PASS** |

---

## Copilot Next Steps

1. **Deploy to Railway** — the fixes are verified locally but not in production.
2. **Add E2E test** for the LLM-failure path using a mock/stub that forces keyword inference.
3. **Clean up orphaned Phoring tools** or wire them into `registerBuiltinTools()`.
4. **Monitor production** after deploy using `scripts/production-workflow-smoke.mjs`.
