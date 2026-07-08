# HyperAgent — Current-State Truth Audit (Phase 0)

> **Branch:** `feature/hyperagent-self-healing-learning`
> **Baseline commit:** `2d96b2d` (main, 2026-07-08)
> **Purpose:** Verify, against executable code, every claim the HyperAgent spec makes about what JAK Swarm currently does — *before* building anything on top of it. No marketing assumptions. Every claim cites `file:line`.
> **Method:** Six parallel read-only investigations over `packages/swarm`, `packages/agents`, `packages/security`, `packages/adk`, `packages/db`, `apps/api`, `apps/web`, and `docs/`. No files were modified during the audit.

---

## 0. Test baseline (recorded on `feature/hyperagent-self-healing-learning` off `main @ 2d96b2d`, 2026-07-08)

Local environment: pnpm 9.15.4, Node v24.13.0 (CI uses Node 20; local Node 24 used for tests only), Prisma Client v6.19.3. Commands and exact results:

| Gate | Command | Result |
|---|---|---|
| Prisma client generate | `pnpm --filter @jak-swarm/db exec prisma generate` | ✔ Generated in 454ms |
| Lint (root, zero warnings) | `pnpm lint:eslint` (`eslint . --max-warnings=0`) | **EXIT 0**, 0 warnings |
| Typecheck | `pnpm typecheck` (`turbo run typecheck`) | **25/25 tasks**, 0 TS errors, EXIT 0 (2m25s) |
| Build (ran as typecheck dependency) | `turbo run build` | **15/15 tasks successful** (1m11s) |
| Unit tests | `pnpm --filter @jak-swarm/tests exec vitest run unit --exclude "**/*behavioral*.test.ts" --exclude "**/role-world-class-upgrades.test.ts"` | **137 files / 1843 passed \| 54 todo, 0 failed**, 57.7s, EXIT 0 |
| Docs truth-check | `pnpm check:truth` | **EXIT 0** (before README accuracy edits; re-verified after edits — see below) |

**Not run locally (require infra not present in this session):**
- Integration tests (`vitest run integration …`) — require Docker testcontainers (pgvector), Playwright browser tooling, OpenAI Responses stub. CI runs these in the `test` job.
- E2E (`pnpm test:e2e`) — requires full API + web stack.
- `pnpm audit:tools`, `pnpm audit:approval-paths`, bench scripts — not part of the blocking baseline.

**Known uncommitted state at branch creation:** two modified QA image assets under `qa/yc-demo-video/public/assets/` — unrelated to this work, intentionally not included in the Phase 0 commit.

**README accuracy edits made as part of Phase 0 (per the user's request and the §6 audit):**
- `README.md:129` "21 connectors" → "23 connectors (21 MCP providers + Remotion + Blender, each with an honest live status badge)".
- `README.md:799` "122 builtin + 4 Phoring tool implementations" → "122 builtin tools (Phoring integration removed)" — `registerPhoringTools()` is never called; `builtin/index.ts:6` says "Phoring integration removed — disabled".
- `README.md:817` "13 industry-specific agent configurations" → "11 … (customer-support, education, finance, general, healthcare, hospitality, insurance, legal, logistics, recruiting, retail)" — `manufacturing` and `consulting` never had pack files.
- `README.md:58` "verifier / auto-repair loop" → "verifier with bounded retry (a full re-plan / auto-repair loop is a roadmap item)" — no replanner exists (§1.1).
- `README.md:62` "signed-decision / HMAC-ready security path" → "HMAC-ready security path (signed-decision wiring for the external JAK Shield MCP is a roadmap item, not yet integrated)" — no signing of shield decisions exists (§5.4).
- `README.md:108` "The external JAK Shield MCP adds 4 additional stages … cryptographic signing" → "will add … (separate product; MCP wiring is a roadmap item, not yet integrated) … signed evidence bundles" — external Shield not wired (§5.2).
- `README.md:253` "Auto-Repair: … the system re-plans and re-routes failed tasks" → honest bounded-retry framing with a pointer to this audit — no re-plan loop exists (§1.1, §1.3).
- `README.md:261` "Agent Governance Overlay that enforces agent profiles, memory scopes, and autonomy boundaries" → "roadmap items (Phase 11B / HyperAgent Phase 7-8), not yet wired" — governance overlay not built (§5.2, §5.3).
- `README.md:952` ADK "approval flows work unchanged" → "Approval parity is partial: ADK cannot pause/resume … worker roles come from caller `roleModes` … one flat `ParallelAgent`; plan-derived dependency-aware waves are a roadmap item" — (§4.1, §4.3, §4.4).

**Test-count claim (`2,400+ / 2,407 blocking CI tests`):** not reverified end-to-end this session because integration tests were not run locally. The unit-only count is 1843 passed + 54 todo. The `2,407` headline (2368 root + 39 web) is the CI unit+integration count and is verified by the `check:truth` script, which passed. Left unchanged.

---

## 1. LangGraph replanner, retry accounting, verifier behaviour, RepairService, graph topology

### 1.1 Is there a functioning replanner node? — **CONFIRMED: none.**

`packages/swarm/src/workflow-runtime/langgraph-graph-builder.ts:55-61` carries an explicit comment:

> A `replannerNode` previously existed in SwarmGraph for an external auto-repair loop AFTER the main DAG completed with partial failures. It was **never wired into this LangGraph StateGraph** and never invoked by SwarmExecutionService (the claimed post-completion invocation never existed in code), so it was **dead and has been removed**.

- The `NodeName` union still lists `'replanner'` (`packages/swarm/src/graph/edges.ts:30`) — **stale**. No `replanner` node is added in `buildLangGraph` (`langgraph-graph-builder.ts:429-463`), which adds only 8 nodes: `commander, planner, router, guardrail, worker, verifier, approval, validator`.
- The file header doc comment (`langgraph-graph-builder.ts:21`) still says `replanner → guardrail` — **stale documentation**; the actual `.addConditionalEdges`/`.addEdge` calls never reference `replanner`.
- **Nothing changes plans at runtime.** The spec's Fix 1 (restore a real Replanner) is genuinely required.

### 1.2 Retry counters and ceilings — **CONFIRMED: two inconsistent counters, ceilings 2 vs 3.**

| Item | Location | Value |
|---|---|---|
| `taskRetryCount` state field | `packages/swarm/src/state/swarm-state.ts:55` (`Record<string, number>`) | — |
| `taskRetryCount` Annotation | `langgraph-graph-builder.ts:158` (mergeReducer) | — |
| `taskRetryCount` bump site | `langgraph-graph-builder.ts:398` | — |
| `${task.id}_retries` read | `packages/swarm/src/graph/nodes/verifier-node.ts:138-139` | — |
| `${task.id}_retries` write | `verifier-node.ts:152` | — |
| `MAX_RETRIES` (verifier) | `verifier-node.ts:8` | **2** |
| `MAX_TASK_RETRIES` (edges) | `packages/swarm/src/graph/edges.ts:78` | **3** |

- The verifier gates retry on `${task.id}_retries < 2` (`verifier-node.ts:141`); the edge function gates re-routing on `state.taskRetryCount[task.id] < 3` (`edges.ts:79-80`). The bumpers write to **different counters** (`taskRetryCount` at builder:398 vs `${task.id}_retries` at verifier:152).
- Because `verifierNode` stops emitting `needsRetry:true` at 2, the edges.ts ceiling of 3 on the other counter is **effectively dead code**. The spec's Fix 2 (unify retry accounting) is genuinely required.

### 1.3 Verifier failure behaviour — **CONFIRMED: re-sends the same task to the same worker; no structured feedback, no plan redesign.**

`verifier-node.ts:141-156` returns a patch containing only `verificationResults` and the bumped retry counter. It does **not** mutate `state.plan`, does **not** change `currentTaskIndex`, does **not** write any feedback field into `taskResults[task.id]`, and does **not** call any planner/replanner. On budget exhaustion (`verifier-node.ts:158-166`) it forcibly clears `needsRetry` and marks the task COMPLETED/FAILED — still no redesign.

- A grep of `worker-node.ts` for `verificationResult` shows the worker **does not read verifier feedback**. So even if feedback were passed, it is unused. This is the spec's "R2 output correction" gap — it currently *repeats* the task rather than *correcting* the output.

### 1.4 RepairService — **CONFIRMED: pure decision service, refuses destructive/permission/approval/unknown; retries a bounded set.**

`packages/swarm/src/recovery/repair-service.ts:37-48` declares `ErrorClass`:

```
'transient_api' | 'invalid_structured_output' | 'missing_input' |
'document_parse_failure' | 'tool_unavailable' | 'permission_block' |
'destructive_action' | 'graph_node_failure' | 'approval_timeout' |
'export_failure' | 'unknown'
```

`classifyError` (`repair-service.ts:109-127`) is a regex cascade in that order. `decideRepair` (`repair-service.ts:150-237`):
- **Refuses (escalate_to_human, never auto-retry):** `destructive_action` (158-164), `permission_block` (167-172), `approval_timeout` (173-179), `unknown` (180-185).
- **Auto-retry (per-class budgets, 188-202):** `transient_api`/`tool_unavailable`/`invalid_structured_output` → `Math.min(maxRetries, 3)` (default `maxRetries=2`, `DEFAULT_MAX_RETRIES` line 77); `missing_input`/`graph_node_failure`/`document_parse_failure`/`export_failure` → `1`; all others → `0`.
- **Give up** when `priorAttempts >= perClassMax` (204-210).

RepairService is a **pure decision service** — it does not itself retry. `worker-node.ts:16, 211-232` calls `defaultRepairService.evaluate(...)` and acts on the decision, with `MAX_REPAIR_LOOPS = 4` (`worker-node.ts:169`) as a belt-and-braces ceiling. This substantially implements R1 and part of R2, exactly as the spec states.

### 1.5 Actual graph topology — **CONFIRMED: Worker → Verifier → {worker | guardrail | validator}; no replanner edge.**

From `buildLangGraph` (`langgraph-graph-builder.ts:438-463`):

| # | Edge | Type | Branches |
|---|---|---|---|
| 1 | `START → commander` | addEdge | — |
| 2 | `commander →` | conditional | `planner \| end` |
| 3 | `planner →` | conditional | `router \| end` |
| 4 | `router → guardrail` | addEdge | — |
| 5 | `guardrail →` | conditional | `approval \| worker \| end` |
| 6 | `approval →` | conditional | `worker \| end` |
| 7 | `worker → verifier` | addEdge | — |
| 8 | `verifier →` | conditional | `worker \| guardrail \| validator` |
| 9 | `validator → END` | addEdge | — |

`verifierEdge` returns `worker` (retry), `guardrail` (next task), or `validator` (no more tasks). The `guardrail → worker` re-entry after a verifier pass is the only mechanism that advances to the next task — it is the same node path, not a replanning step.

---

## 2. Memory and learning wiring

### 2.1 `extractMemories()` — **CONFIRMED: exists, exported, ZERO production or test call sites. Dead code.**

- Definition: `packages/swarm/src/memory/memory-extractor.ts:98`. Header comment (lines 8-9) describes the intended design: `SwarmGraph.run() completes → extractMemories(state) → dedup → TenantMemory`.
- Re-exports: `packages/swarm/src/memory/index.ts:2`, `packages/swarm/src/index.ts:132`.
- Doc/audit prose only: `docs/AUDIT-V6-DEERFLOW-COMPARISON.md:171,183,407,414`.
- **Invocations `extractMemories(`: none.** No `apps/` import, no test file (no `memory-extractor.test.ts` exists). The spec's Fix 3 is genuinely required.

### 2.2 `persistLearning()` / `recallLearnings()` in BaseAgent — **CONFIRMED: defined, never called by any worker or test.**

- `packages/agents/src/base/base-agent.ts:616` (`persistLearning`), `:649` (`recallLearnings`) — `protected`, internally call the `memory_store`/`memory_retrieve` tools.
- `this.persistLearning(` / `this.recallLearnings(` / `super.persistLearning` / `super.recallLearnings` → **no matches anywhere**.
- Workers instead declare `memory_store`/`memory_retrieve` as **LLM-callable function tools** (passed into `executeWithTools`), e.g. `success.agent.ts:201/217`, `project.agent.ts:197/213`, `product.agent.ts:151/167`, `pr.agent.ts:182/198`, `legal.agent.ts:194/210`, `analytics.agent.ts:108/201`, `content.agent.ts:167/181`. Memory access is therefore **optional and LLM-initiated**, not via the BaseAgent helpers. The helpers are dead.

### 2.3 Post-workflow extraction pipeline & planning-time retrieval — **CONFIRMED: none.**

- `extractMemories` is never invoked at runtime. `swarm-runner.ts` has no post-completion learning hook.
- `swarm-execution.service.ts` only reads `TenantMemory` for LLM provider config (`llm:preferred_provider`, `llm:{provider}:api_key`) at `:1039-1049` — not learnings.
- `packages/tools/src/builtin/index.ts:2379` references `SwarmGraph.persistWorkflowLearning()` in a comment — **that function does not exist anywhere** (grep returns only the comment). Stale/aspirational.
- `formatMemoryBlock`, `buildMemoryQuery`, `rankMemories` are defined (`packages/swarm/src/memory/memory-query.ts:37,73,96`) and re-exported, but have **no production caller**. The entire `memory-query.ts` module is unused dead code. No code injects a `<memory>` block into planner/worker system prompts; `worker-node.ts:89` only reads `TenantMemory` for the LLM provider preference.

### 2.4 Memory stores / persistence — **CONFIRMED present (storage layer real; integration layer absent).**

- `TenantMemory` (`packages/db/prisma/schema.prisma:495-511`): `tenantId`, `key`, `value Json`, `source`, `memoryType` (`WORKFLOW | USER_PREF | KNOWLEDGE | POLICY | SKILL_REGISTRY`), `expiresAt`. Unique `[tenantId, key]`. Referenced by `Tenant` at `schema.prisma:41`.
- `MemoryItem` (`schema.prisma:513+`): richer — `scopeType`, `scopeId`, `confidence`, `idempotencyKey`, `contentHash`, `version`, approval-status fields (migration 16). Used by the scoped-memory v2 adapter.
- `memory_store`/`memory_retrieve` tools (`packages/tools/src/builtin/index.ts:2383/2451`) call `getMemoryAdapter()`; marked `maturity: 'real_external'` (`:2388/2457`) — persistence path is real and DB-backed.

**Net:** storage layer present; extraction + injection + BaseAgent helpers are dead/unwired. `docs/AUDIT-V6-DEERFLOW-COMPARISON.md:79` already flags this as "JAK's biggest gap."

---

## 3. Approved-spec execution loop (Company Operating Layer)

### 3.1 Service stops at `decideSpec()`; no `executeApprovedSpec` — **CONFIRMED.**

`CompanyOperatingLayerService` methods on `AgentExecutableSpec` are exactly three: `generateSpec` (`company-operating-layer.service.ts:902`), `listSpecs` (`:1031`), `decideSpec` (`:1054`). `decideSpec` body (`:1069-1078`) flips `status` to `approved`/`rejected`, sets `reviewedBy/reviewedAt/reviewComment`, writes an audit log (`AGENT_SPEC_APPROVED`/`AGENT_SPEC_REJECTED`, `:1080-1090`), and returns the row. **No call to `SwarmExecutionService`, no `workflow.create`, no enqueue.**

Repo-wide grep for `executeApprovedSpec|launchSpec|runApprovedSpec|specToWorkflow|launchApprovedSpec|approvedSpec|executeSpec` → **0 matches**. The route `POST /company/specs/:id/decide` (`company-operating-layer.routes.ts:318-336`) just `reply.send(ok({ spec }))`. The spec's Fix 4 is genuinely required.

### 3.2 Statuses & consumers of `approved` — **CONFIRMED: nothing consumes `approved` to trigger execution.**

- Schema: `packages/db/prisma/schema.prisma:1767` — `status String @default("draft") // 'draft' | 'approved' | 'rejected'`. No enum; free-text string with inline comment.
- Service writes raw strings: `:1011` (`'draft'` on create), `:1069` (`'approved'|'rejected'` on decide). Review is immutable (`:1065-1067`).
- Only readers of `approved`: the audit-log emitter and `listSpecs`'s optional `?status=approved` filter (`:1037-1041`). **`approved` triggers nothing.**

### 3.3 How workflows start today; could an approved spec feed it? — **CONFIRMED: no feed path.**

- `enqueueExecution` (`swarm-execution.service.ts:620`), `executeAsync` (`:866`), `executeVibeCoderAsync` (`:1693`) require an already-created `workflowId` + free-text `goal`.
- `ExecuteAsyncParams` (`:95-162`) has **no** `specId`, `acceptanceCriteria`, `agentTaskPlan`, or `approvalGates`. The runner consumes `goal: string` (`runner.run({...})` at `:1303`). An approved spec's `agentTaskPlan`/`acceptanceCriteria` JSON columns (`schema.prisma:1761-1764`) have **no code path into `runner.run`**.

### 3.4 Spec ↔ drift ↔ workflow linkage — **CONFIRMED: chain broken at the spec-approval step.**

- Read-only linkage spec → drift exists: `generateSpec` accepts `driftFindingId?` (`:905`) and persists it (`:998`); FK `ExecutionDriftFinding? @relation(...)` at `schema.prisma:1777`; row type `AgentExecutableSpecRow.driftFindingId` (`:221`).
- **No** `workflow.specId` or back-reference from `Workflow` to `AgentExecutableSpec` (no such column; `ExecuteAsyncParams` has no `specId`). `swarm-execution.service.ts` has zero imports/references to `CompanyOperatingLayerService`/`AgentExecutableSpec`.
- So: artifacts → entities → drift findings → spec (draft → approved) is wired, but **approved spec → workflow launch is not wired.** The approved spec row sits in `agent_executable_specs` with no consumer.

### 3.5 Acceptance criteria — **PARTIAL: typed on the spec, but not attached to the plan the swarm executes and not consumed by the verifier.**

- DB column `acceptanceCriteria Json` on `AgentExecutableSpec` (`schema.prisma:1761`); migration `107_company_operating_layer/migration.sql:135` (`JSONB NOT NULL`).
- Row type `acceptanceCriteria: unknown` (`:227`); Zod output schema `z.array(z.string().min(1).max(1000)).min(1).max(20)` (`:131`); persisted at `:1004`; client type `string[] | null` (`apps/web/src/lib/api-client.ts:1492`); UI renders a count badge (`apps/web/src/app/(dashboard)/company/page.tsx:697-698`).
- **Absent** from `ExecuteAsyncParams`, from `runner.run({...})`, and from `planJson`. The swarm Verifier does not read the spec's acceptance criteria. (`acceptanceCriteria` also appears on `ProductAgent.userStories` — `packages/agents/src/workers/product.agent.ts:32/45/78/111` — unrelated per-user-story field inside PRD generation.)

---

## 4. ADK correctness and durable approval

### 4.1 Worker roles from caller-supplied `roleModes`, not the Planner's plan — **CONFIRMED.**

- `swarm-execution.service.ts:1266` passes `workerRoles: params.roleModes?.length ? params.roleModes : undefined`.
- `packages/adk/src/orchestration/adk-runner.ts:186` → `workerRoles: workerRoles ?? ['CEO']`.
- `packages/adk/src/orchestration/adk-pipeline.ts:65-66` → `const workerRoles = config.workerRoles ?? ['CEO']; const workers = workerRoles.map(role => createWorkerAdk(role, config));`
- The Planner agent emits `planner_output` with a JSON plan (`jak-adk-agents.ts:51`), but **that output is never parsed back to instantiate workers** — workers are built *before* the pipeline executes. The Planner's `agentRole`/`dependencies[]` fields are instruction text only; no code consumes them.

### 4.2 Full pipeline only when >1 role; else simplified Commander path — **CONFIRMED.**

`adk-runner.ts:194-196`: `workerRoles && workerRoles.length > 1 ? buildAdkPipeline(...) : buildSimpleAdkPipeline(...)`. `buildSimpleAdkPipeline` (`adk-pipeline.ts:92-96`) returns a single `LlmAgent` (Commander only, search forced on) — no Planner, no workers, no Synthesis, no Verifier. With 0/1 role the full DAG is bypassed entirely.

### 4.3 ADK admits it cannot pause/resume for approvals — **CONFIRMED.**

`adk-runner.ts:152-160` doc comment:

> ADK's tool model is synchronous within the `for await` event loop — there is no `interrupt()` equivalent. A `tool_approval_required` activity can be EMITTED for cockpit visibility, but it CANNOT pause the ADK run the way LangGraph's per-tool approval gate pauses the graph. High-risk tools in ADK mode must rely on the tool itself returning `outcome:'approval_required'` (recorded for review) rather than workflow-level pause/resume. Documented here so the caller does not assume parity with the LangGraph approval pause.

Reinforced at `swarm-execution.service.ts:1285` which hardcodes `pendingApprovals: []` — no approval surface is ever populated in ADK mode.

### 4.4 Dependency-aware waves — **REFUTED: one flat `ParallelAgent` over role-based workers.**

`adk-pipeline.ts:68-83`: all worker LlmAgents (one per role) go into a single `ParallelAgent('ParallelWorkers', subAgents: workers)` inside a `SequentialAgent('JAKSwarmPipeline', [commander, planner, parallelWorkers, synthesis, verifier])`. No reading of `dependencies[]`, no wave/topological grouping, no per-task sub-agent. Each "worker" is a role-based agent that runs **once for the whole workflow**, not once per task.

### 4.5 Failures fed to shared diagnosis/replanning — **CONFIRMED isolated: none.**

ADK runner has its own inline error handling (`adk-runner.ts:250-253`, `:271-274`, terminal state built at `:277-304`): `status: FAILED|COMPLETED`, traces mapped from collected events; **no call to any Planner/Verifier/diagnosis service, no replanning loop, no retry.** At the caller level, `swarm-execution.service.ts:1295-1298` catches ADK exceptions and **falls back to LangGraph wholesale** — failure escapes the ADK path entirely rather than being diagnosed within it. Grep across `packages/adk/src` for `replan|diagnos|retry|repair|wave|dependency` returns only two hits, both in Planner instruction text (`jak-adk-agents.ts:51-52`).

---

## 5. JAK Shield / governance integration

### 5.1 Default = `LocalShieldGateway`; separate Shield only via override — **CONFIRMED.**

`packages/security/src/shield-gateway/gateway.ts:4-8`: a singleton `LocalShieldGateway` is instantiated at import time; `getShieldGateway()` returns `overrideGateway ?? localShieldGateway`; `setShieldGateway()` (`:15-17`) is the only override path. `LocalShieldGateway.getStatus()` (`local-shield-gateway.ts:97-107`) self-reports `mode: 'embedded-local'`. `packages/security/src/index.ts:79-91` corroborates: "Today the default gateway preserves the embedded local detectors above; future code can swap the implementation without changing agents."

### 5.2 Real MCP client to the separate JAK Shield — **REFUTED (does not exist; spec's "need to be built" is accurate).**

- `packages/security/src/governance/` **does not exist**. Subdirs under `packages/security/src/`: `audit/`, `encryption/`, `guardrails/`, `rbac/`, `shield-gateway/`, `tool-risk/` (+ `index.ts`).
- Grep across `packages/` for `shield-mcp-client|agent-governance-overlay|decision-verifier|ShieldMcp|AgentGovernanceOverlay|decisionId|decision_id|SHIELD_MCP|shield_mcp` → **zero matches**.
- `EVOLUTION-PLAN.md:526-527` lists `ShieldMcpClient` and `AgentGovernanceOverlay` as Phase 1 work to be done; header (`:3`) states "Planning document only. No code changes made."

### 5.3 What the local gateway checks today — **PARTIAL: input safety + tool risk/approval only; NO agent profile / ability pack / memory scope / autonomy.**

`local-shield-gateway.ts`:
- `scanInput` (`:43-74`): `detectInjection`, `detectOffensiveCyberRequest`, `detectPII`; blocks only on HIGH-risk injection confidence ≥ 0.7 (`:49`) or offensive-cyber ≥ 0.7 (`:56`). Returns `source: 'local'`.
- `evaluateToolCall` (`:76-95`): `classifyToolRisk` + `localToolPolicyRequiresApproval`. Local policy (`:17-40`) approves based on `metadata.requiresApproval`, `ToolRiskClass.EXTERNAL_SIDE_EFFECT`/`DESTRUCTIVE`, `metadata.sideEffectLevel`, and a name blocklist (`install`, `oauth`, `credential`, `secret`, `token`, `publish`, `send_`, `delete`, `destroy`, `purge`, `refund`).
- `ShieldToolCallEvaluationRequest` (`types.ts:32-40`) carries only `toolName, metadata, input, tenantId, userId, workflowId, runId` — **no** agent-profile id, ability pack, memory scope, or autonomy level. The Agent Governance Overlay checks described in `EVOLUTION-PLAN.md:488-500` are not implemented.

### 5.4 Signature / decision-id / replay / audit persistence — **REFUTED: none.**

`ShieldToolCallEvaluation`/`ShieldInputScanResult` (`types.ts:42-48/23-30`) have **no** signature, decision-id, nonce, timestamp, or replay-token field. `AuditAction` (`audit/audit-log.ts:1-44`) has no `SHIELD_MCP_*` values. No code path persists a Shield decision to `AuditLog`. HMAC/decision-integrity/decision-id appear only in the external JAK Shield product description (`EVOLUTION-PLAN.md:81/152/263/472`) and as Phase 11B future work (`ROADMAP.md:134`).

### 5.5 ROADMAP & EVOLUTION-PLAN state the gaps — **CONFIRMED.**

`docs/ROADMAP.md`:
- `:147` "Self-improving cycles are not built. Agent memory (persistLearning / recallLearnings) persists facts across workflows. It does not yet adjust future plans without human re-specification."
- `:148` "Agent Governance Overlay is not built. The current Guardrail agent is a stateless in-process policy checker. The Agent Governance Overlay (agent profiles, memory scopes, autonomy boundaries, calling JAK Shield MCP for signed decisions) is a roadmap item."
- `:149` "JAK Shield MCP integration is not yet wired. … Today, JAK Swarm's 6 local policy defenses in packages/security are fully wired and enforced on every agent action — what is NOT wired is the MCP call to the external JAK Shield service for signed high-risk decisions."
- `:132` "Phase 1-11A: All security enforcement uses local policy logic in packages/security … the MCP call from JAK Swarm to that external service is not yet wired (Phase 11B)."

`docs/EVOLUTION-PLAN.md`: `:3` "Planning document only. No code changes made."; `:91-92` Phase 1-11A local policy / Phase 11B ShieldMcpClient wiring; `:165` "JAK Swarm currently has local guardrails in packages/security but does NOT call JAK Shield MCP for signed security decisions."; `:163` gap summary lists the learning loop as "all missing and needed."

---

## 6. Skill lifecycle + public claims / README accuracy

### 6.1 Skill lifecycle backend — **REAL and wired in (not stubbed); with code-vs-code and doc-vs-code drift.**

- Prisma model `Skill` (`packages/db/prisma/schema.prisma:471-493`): `tier`, `status String @default("PROPOSED")`, `inputSchemaJson`, `outputSchemaJson`, `permissions String[]`, `riskLevel`, `testCasesJson`, `implementation` (source — sandbox only), `sandboxResult Json`, `approvedBy/At`. Map `skills`.
- Lifecycle API registered at `apps/api/src/index.ts:237` (`/skills`); handler `apps/api/src/routes/skills.routes.ts` (517 lines): `GET /skills/packs` (`:39-74`), `GET /skills` (`:81-147`), `POST /skills/propose` (status `PROPOSED`, tier TENANT=3, `:153-198`), `GET /skills/:id` (`:204-229`), `POST /skills/:id/approve` (TENANT_ADMIN; PROPOSED|SANDBOX_PASSED → APPROVED, `:235-272`), `POST /skills/:id/reject` (`:278-318`), `POST /skills/:id/sandbox` (`:324-513`).
- The sandbox is **real**: it sets `SANDBOX_RUNNING`, parses schemas, executes the skill via `getSandboxAdapter()` (`@jak-swarm/tools`), writes `skill.js` + a generated `test-runner.js`, runs `node test-runner.js` against declared test cases (`:413-477`), stores `sandboxResult`, transitions to `SANDBOX_PASSED` or back to `PROPOSED`.
- `packages/skills` (the npm package) is a *different*, thinner thing — a filesystem SKILL.md pack loader (`packages/skills/src/index.ts:105-145`) with 4 bundled packs in `packages/skills/public/` (browser-researcher, content-engine, landing-page-fixer, repo-reviewer). It is the bundled Tier-1 pack loader, **not** the lifecycle backend.

**Drift to fix in the relevant phase:**
1. **Status enum code-vs-code:** `packages/shared/src/types/skill.ts:9-16` defines `ACTIVE, PROPOSED, SANDBOX_TESTING, APPROVED, REJECTED, DEPRECATED`; `apps/api/src/types.ts:32-39` + routes use `PROPOSED, SANDBOX_RUNNING, SANDBOX_PASSED, SANDBOX_FAILED, APPROVED, REJECTED, DEPRECATED`. The shared enum's `SANDBOX_TESTING`/`ACTIVE` are unused; the API's `SANDBOX_RUNNING/PASSED/FAILED` are undeclared in the shared enum.
2. **Tier mapping code-vs-code-vs-schema:** route comment says `1=BUILTIN, 2=COMMUNITY, 3=TENANT` (`skills.routes.ts:7-12`); schema comment says `1=BUILTIN, 2=GENERATED_PLAN, 3=PROPOSED` (`schema.prisma:476`); `shared/types/skill.ts:3-7` says `BUILTIN/GENERATED_PLAN/PROPOSED`.
3. **Sandbox doc materially wrong:** `docs/skill-system.md:177-190` claims "Node.js `vm` module", "No `process`, `require`, `import`, `fetch`, `fs`", 128 MB / 10s per test. The real implementation (`skills.routes.ts:415-477`) runs a full `node` subprocess that `require()`s the skill with a 30s timeout — a substantially larger capability surface than the doc admits. This is a **security-relevant** doc inaccuracy (the sandbox is less locked-down than documented).

### 6.2 Public counts — actual filesystem counts

| Metric | Actual count | How counted |
|---|---|---|
| Agents | **38** (6 orchestrators + 32 workers) | `packages/agents/src/roles/*.agent.ts` (6) + `packages/agents/src/workers/*.agent.ts` (32); all re-exported from `packages/agents/src/index.ts:40-244` |
| Tools | **122** registered | 122 `toolRegistry.register(` calls in `packages/tools/src/builtin/index.ts` |
| MCP providers | **21** | 21 `[A-Z_]+:` keys in `packages/tools/src/mcp/mcp-providers.ts` |
| Connectors (real) | **23** | 21 auto-mapped MCP + 2 hand-written manifests (REMOTION, BLENDER) at `packages/tools/src/connectors/manifests/index.ts:158-172` |
| Bundled skill packs | **4** | `packages/skills/public/`: browser-researcher, content-engine, landing-page-fixer, repo-reviewer |
| Industry packs | **11** | `packages/industry-packs/src/packs/`: customer-support, education, finance, general, healthcare, hospitality, insurance, legal, logistics, recruiting, retail |

### 6.3 Claim-by-claim audit

| # | Claim | Stated at | Code reality | Verdict |
|---|---|---|---|---|
| 1 | "38 agents (6 orchestrators + 32 workers)" | `README.md:58/129/320/794`; `ARCHITECTURE.md:80`; `EVOLUTION-PLAN.md:133` | 6+32=38, all exported | **CURRENT** |
| 2 | "122 tools" | `README.md:129/304/858`; `ARCHITECTURE.md:112/132`; `EVOLUTION-PLAN.md:132` | 122 `register(` calls | **CURRENT** |
| 3 | "122 builtin + 4 Phoring tool implementations" | `README.md:799` | `registerPhoringTools()` (`phoring.tools.ts:39`) is **never called**; `builtin/index.ts:6` says "Phoring integration removed — disabled" | **STALE** (Phoring dead) |
| 4 | "21 MCP providers" / headline "21 connectors" | `README.md:310` (MCP) / `:129` (connectors) | 21 MCP providers (current); but "21 connectors" understates: +Remotion+Blender = 23 | **PARTIAL** (MCP current; connector headline understates) |
| 5 | "22 MCP connectors" | `docs/EVOLUTION-PLAN.md:143` | 21 MCP providers | **STALE** (off by 1) |
| 6 | "13 industry-specific agent configurations (… manufacturing, consulting …)" | `README.md:170/817`; `ARCHITECTURE.md:170` | 11 pack files; **manufacturing and consulting do not exist** | **STALE** (off by 2; names fabricated) |
| 7 | "18 named CompanyOSIntents" | `README.md:301` | `packages/agents/src/index.ts:43` comment "canonical 18 named intents"; `intents/intent-vocabulary.ts` exported | **CURRENT** |
| 8 | "5 roles + External Auditor" RBAC | `README.md:313/845` | `apps/api/src/types.ts` + `packages/security` RBAC | **CURRENT** |
| 9 | "SOC 2 Type 2 (63) + HIPAA (37) + ISO 27001 (82) = 182 controls" | `README.md:303` | Not re-verified against seed file this pass | **UNVERIFIED** |
| 10 | "2,400+ blocking CI tests" | `README.md:112` | Pending the §11 baseline run | **UNVERIFIED** |
| 11 | Sandbox = "Node.js `vm`, no require/import/fs, 128 MB / 10s" | `docs/skill-system.md:177-190` | Real sandbox runs a `node` subprocess with `require('./skill.js')`, 30s timeout | **STALE/INACCURATE** (security-relevant) |
| 12 | Skill states `PROPOSED → SANDBOX_TESTING → …` | `docs/skill-system.md:119-151/257` | API uses `SANDBOX_RUNNING/PASSED/FAILED`; `ACTIVE`/`SANDBOX_TESTING` unused | **Doc drift** |
| 13 | Tier mapping | `skills.routes.ts:7-12` | Conflicts with `schema.prisma:476` and `shared/types/skill.ts:3-7` | **Internal inconsistency** |

### 6.4 Top stale/contradictory claims (to correct in Phase 15 / owning phase)

1. **Industry packs = 13 vs 11** (`README.md:170/817`; `ARCHITECTURE.md:170`) — `manufacturing` and `consulting` are listed but have no pack files.
2. **Phoring "+4 tools"** (`README.md:799`) — `registerPhoringTools()` never invoked; `builtin/index.ts:6` says removed/disabled. The 122 total is correct *without* Phoring.
3. **"22 MCP connectors"** (`EVOLUTION-PLAN.md:143`) — really 21.
4. **"21 connectors" headline** (`README.md:129`) — really 23 with Remotion+Blender (the Connector Registry registers them).
5. **Skill sandbox doc** (`docs/skill-system.md:177-190`) — describes a locked `vm`; the code runs a real Node subprocess with `require`. Security-relevant.

### 6.5 Verdict (Area B)

Flagship headline numbers — **38 agents** and **122 tools** — are accurate. **21 MCP providers** is accurate. Skill lifecycle backend is real, not stubbed. Five secondary claims are stale/contradictory (13 vs 11 industry packs; dead Phoring "+4"; 22 vs 21 MCP in EVOLUTION-PLAN; "21 connectors" vs 23 real; sandbox doc materially wrong). There is also an internal inconsistency in Skill tier/status naming across `schema.prisma`, `shared/types/skill.ts`, and `skills.routes.ts`.

---

## 7. Summary verdict matrix

| Spec claim | Verdict |
|---|---|
| No functioning replanner; removed & dead | **CONFIRMED** |
| Two inconsistent retry counters, ceilings 2 vs 3 | **CONFIRMED** |
| Verifier re-sends same task to same worker, no structured feedback | **CONFIRMED** |
| RepairService implements R1 + part of R2, refuses destructive/unknown | **CONFIRMED** |
| `extractMemories` has no production call site | **CONFIRMED** |
| `persistLearning`/`recallLearnings` have no worker usage | **CONFIRMED** |
| No post-workflow extraction; no planning-time retrieval; `memory-query.ts` dead | **CONFIRMED** |
| Memory storage layer (`TenantMemory`/`MemoryItem`) real; integration absent | **CONFIRMED** |
| `decideSpec()` stops; no `executeApprovedSpec` launches a workflow | **CONFIRMED** |
| `approved` status triggers nothing | **CONFIRMED** |
| Approved spec → workflow linkage broken; spec sits in DB | **CONFIRMED** |
| Acceptance criteria typed on spec but not attached to plan / not consumed by verifier | **PARTIAL** |
| ADK worker roles from caller `roleModes`, not Planner plan | **CONFIRMED** |
| ADK full pipeline only when >1 role; else simplified Commander | **CONFIRMED** |
| ADK cannot pause/resume for approvals (self-admitted) | **CONFIRMED** |
| ADK uses one flat `ParallelAgent`, no dependency waves | **CONFIRMED** (refuted the alternative) |
| ADK failures isolated; no shared diagnosis/replanning | **CONFIRMED** |
| Default `LocalShieldGateway`; separate Shield only via override | **CONFIRMED** |
| No real Shield MCP client / governance overlay files exist | **CONFIRMED** |
| Local gateway checks input safety + tool risk only; no profile/pack/scope/autonomy | **CONFIRMED (PARTIAL vs spec vision)** |
| No signature / decision-id / replay / audit persistence for shield decisions | **CONFIRMED** |
| ROADMAP & EVOLUTION-PLAN explicitly state Shield MCP + self-improving cycles not built | **CONFIRMED** |
| Skill lifecycle backend is real (Prisma `Skill` + 517-line `/skills` API + real node sandbox) | **CONFIRMED** |
| Skill status/tier enums drift across shared / API / schema; sandbox doc materially wrong | **CONFIRMED** |
| Headline counts: 38 agents, 122 tools, 21 MCP providers — accurate | **CONFIRMED** |
| 5 stale secondary claims: 13→11 industry packs, dead Phoring "+4", 22→21 MCP, "21 connectors"→23, sandbox doc | **CONFIRMED** |

**Bottom line:** Every load-bearing claim in the HyperAgent spec about the *current* repository is verified true. The gaps are real, not rhetorical. Phase 0 establishes a truthful baseline; subsequent phases build on it.

---

## 8. Stale documentation found during audit (to correct in the relevant phase, not hidden)

1. `langgraph-graph-builder.ts:21` header still says `replanner → guardrail`; `edges.ts:30` `NodeName` still includes `'replanner'`. → Fix in Phase 4 (real replanner) — either re-wire or remove the stale symbol/comment.
2. `packages/tools/src/builtin/index.ts:2379` references `SwarmGraph.persistWorkflowLearning()` which does not exist. → Fix in Phase 5 (wire learning) by making the reference real or removing the comment.
3. `memory-query.ts` (`formatMemoryBlock`/`buildMemoryQuery`/`rankMemories`) is exported but unused. → Phase 5 either wires it into the planner/worker prompt injection or deletes it.
4. README/ARCHITECTURE/ROADMAP claim audit — §6 complete. Five stale secondary claims to correct in Phase 15 (truthful documentation), plus the skill status/tier enum inconsistencies fixed in their owning phase:
   - `README.md:170/817` & `ARCHITECTURE.md:170`: "13 industry packs (incl. manufacturing, consulting)" → 11; remove manufacturing/consulting.
   - `README.md:799`: "122 builtin + 4 Phoring tool implementations" → remove Phoring clause (dead, never registered).
   - `README.md:129`: "21 connectors" → 23 (21 MCP + Remotion + Blender).
   - `docs/EVOLUTION-PLAN.md:143`: "22 MCP connectors" → 21.
   - `docs/skill-system.md:177-190`: sandbox description → real Node subprocess with `require`, 30s timeout (security-relevant — fix promptly).
   - Skill status enum: reconcile `packages/shared/src/types/skill.ts:9-16` with `apps/api/src/types.ts:32-39` + `skills.routes.ts` (SANDBOX_RUNNING/PASSED/FAILED vs SANDBOX_TESTING/ACTIVE).
   - Skill tier mapping: reconcile `skills.routes.ts:7-12`, `schema.prisma:476`, `shared/types/skill.ts:3-7`.

---

_Phase 0 complete. Audit (§1–§6) and test baseline (§0) recorded; README accuracy edits applied and `check:truth` re-verified green. Ready for the Phase 0 commit `docs(hyperagent): establish verified baseline and implementation gaps`._