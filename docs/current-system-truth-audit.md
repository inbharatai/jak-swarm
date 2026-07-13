# JAK Swarm — Current System Truth Audit

**Audited:** `main` @ `59db931cd899570c096178fc2fee6ab979b3048e` (post Company Brain runtime wiring, PR #145).
**Date:** 2026-07-13.
**Method:** First-hand trace of every important path from user action → API route → service → DB migration → worker → agent → tool → approval → persistence → UI → audit. A file or migration existing is NOT counted as proof a capability works. Every classification below cites concrete `file:line` evidence.

**Classification legend:**
- `PRODUCTION-PROVEN` — verified to succeed in the deployed production environment.
- `LIVE-RUNTIME-WIRED` — reachable from the live runtime at boot; executes on real requests; not necessarily deployed/production-proven.
- `INTEGRATION-PROVEN` — proven by an integration test against a real Postgres/Redis (CI runs it).
- `UNIT-PROVEN` — proven by a unit test only (mocked DB/external deps).
- `PARTIAL` — core path exists but a required segment is missing, fake, or inert.
- `CONFIGURATION-DEPENDENT` — only active when specific env/config is provisioned.
- `ROADMAP` — designed/documented but no executable path.
- `DEAD-OR-DUPLICATE` — no live consumer, or duplicated by a newer path.

---

## 0. Starting state (verified)

- `git fetch --all --prune`; local `main` == `origin/main` == `59db931` ("feat(company-brain): wire Graph V2 task context into BaseAgent at boot"). Working tree clean.
- Merged work already on `main`: PR #137 (Governed Company Brain Graph V2, migration 118), PR #145 (Graph V2 task-context wiring into `BaseAgent` at boot).
- Backup branch `origin/feature/hyperagent-production-hardening` exists; fork base `2ca88d8`; **7 unique commits** past main (commit-by-commit classification in §15).
- **No `CLAUDE.md` at repo root**; `AGENTS.md` is the agent-instruction source.
- CI workflows: `ci.yml`, `bench-runtime.yml`, `dependabot-lockfile.yml`. **No `deploy.yml`** — merging `main` does NOT auto-deploy. Production is NOT deployed from merge.
- Migrations present through `118_company_brain_graph_v2`.

## 1. CI gates (verified from `.github/workflows/ci.yml`)

| Gate | Status | Evidence |
|---|---|---|
| Build & Typecheck (incl. `docker build --target runtime .`) | Blocking | ci.yml:14-72 |
| Tests: unit + coverage (thresholds in tests/vitest.config.ts) | Blocking | ci.yml:147-161 |
| Tests: integration (vs `pgvector/pgvector:pg16` + `redis:7`) | Blocking | ci.yml:178-191 |
| Security Gate (default AUTH_SECRET, real keys, `.env` tracked, boot guard) | Blocking | ci.yml:196-245 |
| Secret Scan (gitleaks, full history) | Blocking | ci.yml:252-265 |
| Lint (`pnpm lint:eslint`, `--max-warnings=0`) | Blocking | ci.yml:274-299 |
| Dependency Audit (`pnpm audit --audit-level=high --prod`) | Blocking | ci.yml:306-330 |
| SBOM (CycloneDX, `main` pushes only) | Non-blocking artifact | ci.yml:337-377 |
| Docs Truth Check (`pnpm check:truth`) | Blocking | ci.yml:383-428 |

**Honest gaps in the mandated test matrix:**
- **No `pnpm test:e2e` CI job** exists. The mandate's required `pnpm test:e2e` and browser-flow tests are NOT enforced by CI; if a `test:e2e` script exists it runs only locally.
- Behavioral agent tests (`**/*behavioral*.test.ts`, `role-world-class-upgrades.test.ts`) are **excluded** from CI because they call the live OpenAI API (ci.yml:157-160). They require `OPENAI_API_KEY` and are not gated.
- No dedicated concurrency/adversarial test job — such tests, if added, run inside the integration suite.

## 2. Company Brain Graph V2 — ingestion

**Status: `LIVE-RUNTIME-WIRED` (ingestion) + `INTEGRATION-PROVEN` (claim transition logic).**

- Path: artifact ingest → `company_artifacts` (existing Prisma model) → `CompanyOperatingLayerService.extractEntitiesFromArtifact` (`apps/api/src/services/company-brain/company-operating-layer.service.ts`) → `CompanyBrainV2Service.processExtractedEntities` writes `company_graph_entities`, `company_entity_aliases`, `company_claims`, `company_claim_evidence`, `company_edges` (migration 118).
- `decideClaimTransition` (`company-brain-v2.core.ts:280-327`) is the evidence-backed claim state machine (proposed→active on authority≥0.82&confidence≥0.75; supersede on newer+≥0.15 authority delta; dispute on comparable authority). This logic is `UNIT-PROVEN` (company-brain-v2-core.test.ts).
- **Ingestion trigger is API-local and non-durable** — see §4 (Phase 2 target).

## 3. Company Brain retrieval / task context package

**Status: `LIVE-RUNTIME-WIRED` but `PARTIAL` — retrieval is single-strategy and contains the forbidden recency fallback.**

- `PromptBuilder.injectCompanyContext` (`packages/agents/src/base/prompt-builder.service.ts:85-117`) calls `provider.getContextPackage({tenantId, task, agentRole, tokenBudget:2400})` and injects `<company_brain>` when `contextText` is non-empty. The provider is wired at boot via `createCompanyContextProvider` (PR #145). Role+tenant come from the trusted `AgentContext`, not the HTTP body. ✅
- **Forbidden fallback confirmed** — `apps/api/src/services/company-brain/company-brain-v2.context.ts:55-62`:
  ```ts
  if (entities.length === 0) {
    entities = await this.query<CompanyEntityV2Row>(
      `SELECT * FROM "company_graph_entities"
       WHERE "tenantId" = $1 AND "deletedAt" IS NULL
       ORDER BY "updatedAt" DESC LIMIT 15`, input.tenantId);
  }
  ```
  When no relevant search match exists, the package injects the 15 most-recent arbitrary entities. **This violates the Phase 1 rule: "No relevant result → empty governed context. Never inject arbitrary recent entities."**
- **Secondary recency fallback** — `company-brain-v2.context.ts:48-53`: if the ts_rank query itself throws, it falls back to 20 recent entities (degraded search, but still recency-not-relevance).
- **Single retrieval strategy** — only PostgreSQL `ts_rank` keyword search (`to_tsvector('simple', title||summary) @@ websearch_to_tsquery`). No vector similarity, no canonical-alias match, no stable-identifier lookup, no graph-neighborhood expansion, no temporal/authority/confidence weighting in retrieval (authority only affects claim *transition*, not *retrieval ranking*). Existing vector infra (`packages/tools/src/adapters/memory/vector-memory.adapter.ts`, pgvector) is NOT used by retrieval. **Phase 1 target.**
- **Returned package shape is flat** — `BrainContextPackage` (`company-brain-v2.core.ts:129-148`) has `entities/claims/edges/conflicts/evidence/omittedCount/contextText` but does NOT match the mandated `CompanyBrainContextPackage` (no `id`, `actor`, `scope`, `disputedClaims`, `omissions{restricted,expired,irrelevant}`, `retrieval{strategyVersion,candidateCount,selectedCount,latencyMs}`). The PromptBuilder consumes only `contextText` + `omittedCount` (`prompt-builder.service.ts:95-107`), so the richer shape can be returned as a structural subtype without breaking the agents contract. **Phase 1 target.**
- **Evidence IDs not preserved on claims in the package** — claims are returned (`visibleClaims`) but their per-claim evidence (`company_claim_evidence`) is not joined into the package; only a top-12 artifact excerpt list is attached. The mandate requires "every selected claim and relationship must preserve evidence IDs." **Phase 1 target.**
- **Token budgeting is char-budget, not provider-aware** — `context.ts:158` `maxChars = max(2000, min(tokenBudget*4, 16000))` then `contextText.slice(0, maxChars)` — this can truncate mid-claim/mid-evidence-ID. The mandate requires provider-aware token estimation and budget allocation by complete items (never truncate JSON/evidence IDs/claims halfway). **Phase 1 target.**
- Empty-task path returns empty package (`context.ts:26-31`) — correct.

## 4. Company Brain processing trigger

**Status: `PARTIAL` — atomic claim logic exists, but the trigger is API-local `setImmediate` and uses the banned scan-over-latest-200 pattern. Phase 2 target.**

- Atomic claim: `CompanyBrainArtifactStore.claimArtifactForProcessing` (`company-brain-v2.store.ts:35-79`) — `INSERT … ON CONFLICT DO UPDATE` with 30-minute stale-lease reclaim + max-attempts cap (≤10). `listPendingArtifacts` (`store.ts:81-116`) does a direct tenant-scoped pending query (NOT scan-200). ✅
- **API-local trigger** — `apps/api/src/routes/company-brain-v2.processing.ts:25-28`:
  ```ts
  const schedule = (tenantId, userId, artifactId) => {
    if (process.env['COMPANY_BRAIN_AUTO_PROCESS_ENABLED'] === 'false') return;
    setImmediate(() => void processArtifact({ tenantId, userId, artifactId }).catch(...));
  };
  ```
  Fire-and-forget in the API process. Lost on crash/redeploy/scale-down. No idempotency key, no retry, no lease recovery, no dead-letter. **Phase 2 target.**
- **Banned scan-over-latest-200** — `processing.ts:10-11`:
  ```ts
  const artifacts = await legacy.listArtifacts({ tenantId, limit: 200, offset: 0 });
  const artifact = artifacts.items.find((item) => item.id === input.artifactId);
  ```
  The processor lists the 200 most-recent artifacts then linearly searches for the target id. The mandate explicitly bans this: "no scan-and-find over the latest 200 artifacts; direct tenant-scoped artifact lookup." **Phase 2 target.**
- **API-local poller with in-memory running flag** — `company-brain-v2.routes.ts:58-70`: a `setInterval(tick)` with `let running = false` re-entrancy guard. The mandate bans API-local `setInterval` and in-memory running flags for production processing. **Phase 2 target.**

## 5. Reusable durable-job infrastructure (for Phase 2)

**Status: `LIVE-RUNTIME-WIRED` (for swarm workflows) — reusable as a pattern, NOT as the table.**

- `QueueWorker` (`apps/api/src/services/queue-worker.ts`) on `workflow_jobs` (migration 7) implements the textbook durable-job contract: `FOR UPDATE SKIP LOCKED` atomic claim (`queue-worker.ts:354-397`), `ownerInstanceId` + `leaseExpiresAt` + `lastHeartbeatAt` (added by migration 8), `attempts`/`maxAttempts`/`availableAt` (backoff), `reclaimExpiredLeases`, non-atomic fallback path, metrics. `INTEGRATION-PROVEN` (queue-worker-behavioral / worker-lease-reclaim tests).
- **Why a dedicated `company_brain_jobs` table is needed for Phase 2** (decision, documented per the mandate): `workflow_jobs.workflowId` is `UNIQUE` (migration 7) and FK-bound to `workflows` — it is one-job-per-workflow, not a generic multi-kind queue. It has no `idempotency key`, no `jobType`, no dead-letter reason, and its state set (QUEUED/ACTIVE/DONE/FAILED) does not include the Phase 2-required `REVIEW_REQUIRED`/`RETRY_WAIT`/`PERMANENTLY_FAILED`/`CANCELLED`. Company Brain processing has a genuinely different lifecycle (extract → resolve → reconcile claims → REVIEW_REQUIRED for merge/claim conflicts). Phase 2 will therefore add `company_brain_jobs` (migration 119) reusing the SAME lease-claim idiom (`FOR UPDATE SKIP LOCKED`, owner/lease/heartbeat, reclaim, metrics) — not a second framework, a purpose-built table modeled on the proven one.

## 6. Claims model (typed temporal claims)

**Status: `UNIT-PROVEN` (transition logic) + `PARTIAL` (no typed values, no predicate policies). Phase 4 target.**

- `company_claims` (migration 118) columns: `predicate`, `objectEntityId`, `objectValue JSONB`, `normalizedObject`, `fingerprint`, `status` (proposed/active/disputed/superseded/rejected), `confidence`, `authorityScore`, `validFrom`/`validTo`, `supersedesClaimId`, `reviewedBy`/`reviewedAt`/`reviewComment`, `createdAt`/`updatedAt`.
- **Missing vs Phase 4 mandate:** no typed-value discriminator (`valueType`), no `normalizedValue` per type (only a generic `normalizedObject`), no `contradictsClaimId`, no `sourceBodyHash`, no `observedAt` on the claim (it lives on evidence), no `extractorVersion`, no `policyVersion`, no `createdBy` (present on entity/alias but NOT on claim — `company_claims` has no `createdBy` column; `ClaimCandidate` carries `createdBy` but the schema column is absent). `objectValue JSONB` can hold typed values but there is no declared type or type-safe normalization (money/currency, date/time, entity-ref, URL, structured JSON).
- **No versioned predicate policies** — there is no `predicate_policy` table or column; `single-current-value`/`multi-value`/`append-only`/`time-series`/`human-approval-required`/`high-impact` do not exist as enforceable policy. `decideClaimTransition` applies one universal transition policy. **Phase 4 target.**
- Evidence preservation is real — `company_claim_evidence` (claimId, artifactId, excerpt, sourceAuthority, observedAt) with `UNIQUE(claimId, artifactId)` dedup. ✅

## 7. Entity identity / merge resolution

**Status: `PARTIAL` — merge is human-gated (good) but identity-evidence hierarchy and rejected-candidate preservation are absent. Phase 3 target.**

- `company_entity_aliases` (migration 118) with `UNIQUE(tenantId, entityType, normalizedAlias)` — canonical alias resolution exists. `normalizeEntityLabel` (`company-brain-v2.core.ts:223-233`) + `tokenSimilarity` (Jaccard, `:239-247`).
- `company_entity_merges` records source/target/reason/similarity/mergedBy/createdAt.
- Merge is **reviewer-gated** (`routes.ts:52-56`, `reviewRoles`) — not auto-merged on name alone. ✅ This already satisfies "never auto-merge two people solely because names match" for the human-initiated path.
- **Missing vs Phase 3 mandate:** no automatic candidate detection with the 6-tier resolution hierarchy (provider+externalId → verified stable ID → exact alias → deterministic composite → probabilistic-to-review → no merge). No `algorithmVersion` on merges. No `matchingEvidence` column. **Rejected merge candidates are not preserved** (no table for rejected/deferred merges). Concurrent merge safety is not proven (no `FOR UPDATE` on the merge target). Cross-tenant merge is prevented by `tenantId` scoping + FKs. **Phase 3 target.**

## 8. Access control and taint lineage

**Status: `LIVE-RUNTIME-WIRED` (artifact access filter) + `PARTIAL` (no derivation taint; limited adversarial coverage). Phase 5 target.**

- `canAgentAccessArtifact` (`company-brain-v2.core.ts:269-278`): expired retention → blocked; public/internal → all roles; restricted → only `allowedAgentRoles` (case-insensitive match). Applied in `context.ts:75-84` to filter artifacts AND entities (entities whose every source-artifact is restricted are dropped). ✅
- `agentRole` at the retrieval call site comes from the trusted `AgentContext` (`prompt-builder.service.ts:90-93` uses `String(input.role)`; the factory + boot derive tenant from authenticated context). The HTTP `POST /company/brain/context` route (`routes.ts:37-41`) accepts `agentRole` from the **request body** — this is a non-privileged debug/preview endpoint; it does NOT feed agent prompts. The mandate's "do not accept arbitrary agentRole for privileged retrieval" applies to the agent-prompt path (which is trusted) — but the body-accepted route should be reviewed. **Phase 5 target (harden the preview route or document it non-privileged).**
- **No derivation taint** — entities/claims returned are source-artifact-filtered, but a summary or entity derived from BOTH accessible and restricted evidence is not recomputed from accessible sources only; there is no taint-tracking that would catch a restricted fact leaking through a derived `summary`. **Phase 5 target.**
- **No adversarial test matrix** for cross-tenant identifiers, role spoofing, restricted-names-leaking-through-edges, restricted-data-through-summaries, expired/legal-hold evidence, prompt injection in stored docs, malicious HTML/Markdown, Unicode confusables, connector metadata poisoning, PII/secrets, inference-from-omitted-graph-structure. **Phase 5 target.**

## 9. Audit-chain concurrency

**Status: `LIVE-RUNTIME-WIRED` + `CONCURRENCY-PROVEN` — the TOCTOU fork risk is CLOSED (PR E / Phase 10).**

- Migration 117 adds `audit_logs.prevHash`/`rowHash`/`chainSeq`; `(tenantId, chainSeq)` index. Per-tenant HMAC row-chain; `verifyChain` detects tamper/reorder/delete; **fail-open-to-auditable** when `EVIDENCE_SIGNING_SECRET` is unset (rows still written, `rowHash` null, `signing_unavailable` surfaced). Honestly reported. ✅
- **TOCTOU — CLOSED (PR E).** The append path is now the atomic `appendChainedAuditRow` primitive: a single transaction that takes `pg_advisory_xact_lock(hashtext(tenantId))` (per-tenant serialisation), reads the chain head, and writes the next row with `prevHash`/`chainSeq = head + 1` inside the same tx. Two simultaneous tenant writes can no longer read the same head and fork — the second blocks on the advisory lock until the first commits. A migration 122 partial unique index `WHERE "rowHash" IS NOT NULL` on `(tenantId, chainSeq)` is a backstop that rejects any duplicate seq that ever escapes the lock. Proven against real Postgres by `tests/integration/audit-chain-concurrency.test.ts` (concurrent appenders → no duplicate seq, no fork, valid chain) + `tests/integration/audit-log-chain.test.ts` (tamper/reorder/delete detected, missing-secret fail-open honestly reported). `verifyChain` semantics unchanged. ✅

## 10. Hyperagent runtime, execution loop, approvals, learning, workflows/LangGraph

*(Filled from the parallel audit agent — see §15-appendix A. Summary first-hand: the hyperagent self-learning + executeApprovedSpec + R2 correction + AuditLog chain are merged on `main` through `2ca88d8`, OFF-gated (`hyperAgentEnabled` default false), integration-proven not production-proven. The 7 commits on the backup branch are hardening fixes not yet on main.)*

## 11. Connectors and synchronization

*(Filled from the parallel audit agent — appendix A. First-hand: `company-connector-sync-scheduler.service.ts` uses `setInterval` (api-local) — Phase 2-adjacent; only 3/22 connectors auto-sync per README truth-lock.)*

## 12. MCP surface, tools, sandboxing

*(Filled from the parallel audit agent — appendix A. First-hand: `code_execute` (E2B) + `browser_evaluate_js` are sandboxed + autonomy-gated.)*

- **`ShieldMcpClient` — LIVE-INSTANTIATED (PR E).** Previously "built but NOT instantiated in the live action path." `packages/security/src/shield-gateway/shield-mcp-live.ts` now instantiates it behind `SHIELD_MCP_CANARY=1` (default-off): `requestSignedInputScanDecision` runs the real `scanInput`, mints an Ed25519-signed `ShieldSignedDecision`, self-verifies it (fail-closed on a signature/key mismatch), and `recordShieldDecisionToAudit` writes a `SHIELD_DECISION_SIGNED` row into the atomic audit chain (severity WARN for BLOCK / INFO otherwise, `decisionId` as resourceId). The canary is wired into `swarm-execution.service.ts` after the existing `scanInput` call — it records signed decisions but does NOT gate execution (errors are caught + logged, never thrown). Fail-open-to-auditable when the keypair is absent. Proven against real Postgres by `tests/integration/shield-mcp-live-audit.test.ts` (ALLOW + BLOCK signed decisions chain-joined + verifiable; `requestHash` binds the scanned text). External JAK Shield MCP transport (stdio/SSE) is still roadmap — the `transport` seam on `ShieldMcpClient` is the hook.
- **`brain.*` MCP surface — EXISTS (PR E / Phase 9).** Previously "no `brain.*` MCP operation surface exists today." `packages/tools/src/mcp/brain-mcp-tools.ts` + `brain-mcp-server.ts` are the first in-process MCP server in the repo: a real `@modelcontextprotocol/sdk` `Server` + `InMemoryTransport` pair exposing `brain_get_graph` / `brain_get_entity` (READ_ONLY, no approval) + `brain_merge_entities` (DESTRUCTIVE, approval) / `brain_decide_claim` (WRITE, approval). Tenant identity is NEVER a tool argument — it is carried in `params._meta.jakContext` (raw MCP path) or injected from the authenticated `ToolExecutionContext` (JAK registry path). A call without `jakContext` is REFUSED; a `tenantId` passed in arguments is ignored (cross-tenant escape blocked — proven by `tests/unit/tools/brain-mcp-server.test.ts`). `getContextPackage` (the `<company_brain>` injection) is deliberately NOT exposed (agentRole-escalation guard). Boot-wired behind `BRAIN_MCP_SERVER=1` (default-off).

## 13. Skills system

*(Filled from the parallel audit agent — appendix A. First-hand: `packages/skills` + `docs/skill-system.md` exist; the controlled SOP→proposal→validation→sandbox→approval→versioned-release pipeline is Phase 8 target.)*

## 14. Memory systems

- `persistLearning` / `recallLearnings` (per-role, tenant-keyed) injected into prompts via `<memory>` tags by `PromptBuilder.injectMemories` (`prompt-builder.service.ts:205-234`), capped at 8000 chars. `LIVE-RUNTIME-WIRED`.
- Conversation memory (migration `20260528120000_add_conversation_memory`), memory_v2 (migration 3), memory item status (migration 99). Vector memory via pgvector (`vector-memory.adapter.ts`). `LIVE-RUNTIME-WIRED`.
- The HyperAgent self-learning path (Phase 5 learning persist/promote/rollback) is separate from this `<memory>` recall — see §10.

## 15. Frontend product surfaces, README, landing, deployment

- `/company/graph` route exists on the API (`routes.ts:27-31`); **`/company` + `/company/graph` are now reachable from the dashboard nav (PR E / Phase 11):** wired into the `CommandPalette` (Cmd+K) under a new `Brain` zone + the `ChatSidebar` zone rail (highlights on `/company/*`). This is the reachability half of the Phase 11 product-graph interface — the rich merge-comparison UI, evidence drawer, conflict queue, impact chains, and authority/confidence explanation remain roadmap.
- README + landing: the landing was already simplified on 2026-04-28 (commit d7bbf71 — stat cards + integration chips removed; `product-truth.ts` is the lean canonical registry the truth-check pins). The README (996 lines) carried verbose duplicated programme material (a 600-word HyperAgent blockquote under "How It Works" that duplicated the "Long-Term Vision" `<details>` breakdown, plus a redundant GEPA/optimizer table-row pair + narrative) and several **stale claims that PR E made obsolete** — `ShieldMcpClient` "not yet instantiated in the live action path (deferred)" and `AuditLog` "fetch-latest-then-write TOCTOU under concurrency" as outstanding. **Phase 12 (PR F) closed:** the stale claims corrected to PR E reality (Shield live behind `SHIELD_MCP_CANARY=1` observational canary; TOCTOU closed via `appendChainedAuditRow` + `pg_advisory_xact_lock` + migration 122), the duplicated 600-word blockquote replaced with a 2-paragraph summary + pointer, the GEPA narrative condensed, the duplicate optimizer table rows merged, and the FAQ roadmap list updated (AuditLog row-chain-hashing removed — it is shipped). Pinned counts (122 tools / 38 agents / 22 connectors / `Classified_Tools-122` badge) preserved; `pnpm check:truth` + `pnpm lint:eslint` green.
- **Deployment:** no `deploy.yml`; Cloud Run API deployment is documented (`docs/ARCHITECTURE.md:454` — `jak-swarm-api-…asia-south1.run.app`, `/ready` `/health` `/healthz` wired); worker NOT deployed. No production canary has run. **Phase 13 target** (and a named stop condition: production verification requires credentials not available in this session).

## 16. Red-flag sweep (first-hand, `apps/api/src`)

- **`setImmediate` (Company Brain):** `company-brain-v2.processing.ts:27` (processing trigger — Phase 2), `company-brain-v2.routes.ts:68` (poller kick). Others (`worker-entry.ts:320`, `swarm.plugin.ts:207/284`, `projects/schedules/slack/voice.routes.ts`) are async-dispatch patterns in the worker or request handlers — review per-case in Phase 2.
- **`setInterval` (Company Brain):** `company-brain-v2.routes.ts:68` (processing sweep — Phase 2), `company-connector-sync-scheduler.service.ts:58`. Others (`queue-worker.ts`, `scheduler.service.ts`, `scheduler-leader.ts`, `provider-health.ts`, attestation-scheduler) are worker/scheduler-internal timers — acceptable in a dedicated worker, not in the API request path.
- **`$queryRawUnsafe`/`$executeRawUnsafe`:** all parameterised (no string interpolation of caller input) in `company-brain-v2.store.ts:27-33`, `queue-worker.ts`, `vector-memory.adapter.ts`, `db-memory.adapter.ts`, health checks. No dynamic identifiers. ✅
- **Empty `.catch(() => {})`:** the cluster in `company-operating-layer.service.ts` (lines 658/757/882/951/1105/1169/1227) and `company-profile.service.ts` (185/327/361/381) needs per-case review in Phase 2/8 — they appear to be fire-and-forget telemetry/notification writes, but each must be confirmed non-essential before being left as-is. Redis-quit / sandbox-destroy / oAuthState-delete empty catches (`worker-entry.ts`, `approvals.routes.ts:341`, `integrations.routes.ts:628`) are acceptable cleanup.
- **`as any`:** not surveyed in this pass — Phase 1 implementation will lint-verify (`--max-warnings=0`).

## 17. Honest top-line verdict (post-PR #145)

JAK Swarm has a **merged and live-wired Company Brain Graph V2** (ingestion → entities → evidence-backed claims → permission-filtered task context → `<company_brain>` prompt injection) and a **merged, OFF-gated Hyperagent execution+learning layer** (integration-proven, not production-proven). The system is **not yet** the coherent production Company Brain + Hyperagent OS the mission describes. The concrete gaps, in priority order, are exactly the mandated phases:

1. **Retrieval correctness** — remove the recency fallback; build the measured hybrid pipeline; typed context package; provider-aware token budget; retrieval fixtures (Phase 1 → PR A).
2. **Durable Company Brain worker** — replace API-local `setImmediate`/`setInterval`/in-memory `running` with a leased, idempotent, dead-lettering `company_brain_jobs` table; kill the scan-200; real Postgres concurrency tests (Phase 2 → PR A).
3. Entity identity hierarchy + rejected-candidate preservation + reviewer comparison UI (Phase 3 → PR B).
4. Typed temporal claims + versioned predicate policies + claim reconciliation locking (Phase 4 → PR B).
5. Access-control taint lineage + adversarial test matrix (Phase 5 → PR B).
6. Hyperagent real artifact harvesting + approval pause/resume + execution persistence + drift reopen + failure classes (Phase 6 → PR C).
7. Governed learning (rollout stages, canary gate, invalidation) (Phase 7 → PR D).
8. Procedural skill compiler (Phase 8 → PR D).
9. Brain MCP surface (Phase 9 → PR E) — **DONE.**
10. Audit-chain concurrency fix (Phase 10 → PR E) — **DONE.**
11. Product graph interface (Phase 11 → PR E) — **reachability DONE** (nav wired); rich merge-comparison UI remains roadmap.
12. README + landing simplification + universal-claim correction (Phase 12 → PR F) — **DONE** (README stale-claim correction + de-duplication; landing already simplified 2026-04-28).
13. Production canary + deployment evidence (Phase 13 → PR G) — **requires production credentials not available in this session; will stop at the canary plan + safe non-destructive dry-run and request owner input for the live canary.**

---

## Appendix A — Hyperagent / execution / connectors / MCP / skills detail

*(Populated from the parallel read-only audit agents and the backup-branch commit classification agent — their reports are merged verbatim below when they complete.)*

<!-- AUDIT-AGENT-OUTPUT-PLACEHOLDER -->

### A0. Hyperagent / execution / connectors / MCP / tools audit (read-only agent, git main @ 59db931)

This appendix section is the verbatim consolidated report of the parallel
read-only audit agent that covered the Hyperagent runtime, spec-execution
loop, approvals, learning, workflows/LangGraph, connectors, MCP, and tools/
sandboxing (first-hand §§10-13). All paths absolute under the repo root;
quotes verbatim from source; no files were modified.

**Top-line verdict:** No capability is PRODUCTION-PROVEN. The two most mature
are **Approval pause/resume** and **LangGraph execution engine** — both
genuinely live-runtime-wired with real Postgres checkpointing. Three areas
— **Failure classes**, **Audit chain**, and **Tools/sandboxing** — are
integration-proven with honest documented open edges. The hyperagent
learning/execution/drift/artifact cluster is **PARTIAL**: closed-loop logic
and the promotion gate are real and integration-tested, but the production
run seam harvests `artifacts: []`, never persists a spec-execution record,
never writes drift resolution back, and the canary/shadow config-lifecycle
has no live advancement caller. Connectors are honest-but-narrow (3 real of
22 advertised). MCP is client-only, no `brain.*` server surface,
`ShieldMcpClient` built but never instantiated.

| # | Capability | Status | Headline gap |
|---|---|---|---|
| 1 | Spec execution loop | PARTIAL | Closed-loop logic real + integration-proven with STUB runPlan; production `runPlan` is `artifacts: []`, no spec↔workflow persistence, AWAITING_APPROVAL path NOT handled in spec executor (`spec-executor-runtime.ts:21-24`) |
| 2 | Artifact harvesting | PARTIAL | Real `WorkflowArtifact` model + storage + approval-gated download, but swarm runtime never writes rows; `artifacts: []` hardcoded (`spec-executor-runtime.ts:90`); no `POST /artifacts` route; no provenance FK to trace/approval/spec |
| 3 | Approval pause/resume | LIVE-RUNTIME-WIRED | Real LangGraph `interrupt()`+`Command(resume)`+Postgres checkpointer; real `proposedDataHash` binding with `@@unique` + `ApprovalPayloadMismatchError`; resume continues SAME thread. Most-proven capability. Indirect hash binding (in `WorkflowService`, not `approval-node.ts`) is the main seam |
| 4 | Execution persistence | PARTIAL | `WorkflowCheckpoint` + real `PostgresCheckpointSaver` (tenant-scoped); `WorkflowOutcome` model exists but never written by executeSpec; idempotency is JSON-blob + COMPLETED-only, no DB unique on spec/attempt; no `SpecExecution`/`ExecutionRecord` table |
| 5 | Drift resolution | PARTIAL | `ExecutionDriftFinding` with `@@unique([tenantId, fingerprint])`, `resolvedAt`, `status`; deterministic 4-type detection; reopen-on-re-detection (test-proven). `executeSpec` computes `resolved=MET` but never writes back; reopen is "still-a-candidate", not contradictory-evidence; no resolver identity columns |
| 6 | Failure classes | INTEGRATION-PROVEN | 20-class `FailureClass` enum + per-class `POLICY` table; never-auto-retry = {PERMISSION_DENIED, POLICY_BLOCK, PROMPT_INJECTION, UNKNOWN, externalSideEffectPossible}; sealed deterministic block in diagnostician; 16-mode failure-injection. Counterfactual re-executor honest stub (`executed:false`); `failureClassByTask` not wired; two live classifiers coexist |
| 7 | Learning governance | PARTIAL | Info-theoretic promotion gate + durable persist + recall live-wired through learning node, gated on `hyperAgentEnabled` (default false). Canary/shadow config-lifecycle + governance gate are unit-proven pure cores with no live caller. HazardModel time-bounding is a type only. `PAUSED` status absent from both enums |
| 8 | Workflows + LangGraph | LIVE-RUNTIME-WIRED | LangGraph is the live engine (`StateGraph` + `PostgresCheckpointSaver` + native `interrupt()`); SwarmGraph deleted; `SwarmRunner` is a facade. ADK is a live opt-in alternative (`JAK_ADK_MODE=1`, lazy-imported, falls back to LangGraph), not dead/dormant and not a runner-internal dual-path |
| 9 | Audit chain concurrency | INTEGRATION-PROVEN | HMAC-SHA256 per-tenant row-chain real and live-wired with fail-open-to-auditable missing-secret handling. **TOCTOU honestly documented but unfixed**: no advisory lock, no transaction, no atomic sequence, no `@@unique([tenantId, chainSeq])` — concurrent tenant writes can branch the chain (`audit-chain.ts:30-35`) |
| 10 | Connectors + sync | LIVE-RUNTIME-WIRED | 3 real polled syncs (GitHub/Gmail/Drive REST API + OAuth refresh + cursors + artifact ingestion), leader-elected `setInterval` scheduler at boot. Other 19 "connectors" have no JAK-side sync loop — manifest/MCP-tile only |
| 11 | MCP surface | PARTIAL | MCP *client* via stdio is real; boot auto-start opt-in. No MCP *server* exposed; no `brain.*` MCP surface (REST only); `ShieldMcpClient` built+unit-tested but never instantiated in live path |
| 12 | Tools + sandboxing | INTEGRATION-PROVEN | E2B SDK + Docker adapters real with hard sandbox gates (network=none, read-only fs, mem/cpu/pids caps, path traversal, no-shell argv, timeouts); `browser_evaluate_js` runs in browser not host. `code_execute` does NOT use E2B (host vm/python, production-disabled); the E2B path is via `sandbox_exec` — README's "E2B `code_execute`" framing is imprecise |

**Key per-capability evidence (selection):**

- **Spec execution** — `executeApprovedSpec` (`packages/swarm/src/hyperagent/spec-executor.ts:267-319`) returns a tri-state MET/UNMET/UNVERIFIABLE verdict, **no** `AWAITING_APPROVAL` branch. Runtime header (`spec-executor-runtime.ts:21-24`) admits approval-gated spec tasks are NOT handled. Production harvester returns `artifacts: []` (`:83-96`). No spec↔workflow persistence link; `AgentExecutableSpec` (`schema.prisma:2114-2144`) has no `executedAt`/`executedWorkflowId`/`verdict`. Integration test (`tests/integration/hyperagent-spec-execution.test.ts:160-166`) uses a STUB `runPlan`, not the real LangGraph run.
- **Artifact harvesting** — grep `WorkflowArtifact` across `packages/swarm/src/workflow-runtime` → no matches; swarm package never writes a `WorkflowArtifact` row. `ArtifactService.createArtifact` (`apps/api/src/services/artifact.service.ts:179-274`) is real but `POST /artifacts` route does not exist — unreachable from HTTP.
- **Approval pause/resume** — `wrapApprovalNode` calls `interrupt()` (`langgraph-graph-builder.ts:478-502`); `PostgresCheckpointSaver.put` writes real `workflow_checkpoints` rows (`postgres-checkpointer.ts:296-349`); `proposedDataHash` computed, persisted, re-checked at decide with `ApprovalPayloadMismatchError` (`workflow.service.ts:336-423`), `@@unique([approvalId, proposedDataHash])` (`schema.prisma:793`). Resume continues SAME thread (`langgraph-runtime.ts:141-163`). The previous `setImmediate(resumeAfterApproval)` was REPLACED by durable `enqueueControl` queue — no live `setImmediate` in the approval path.
- **Execution persistence** — `WorkflowOutcome` (`schema.prisma:132-162`) has no `specId`/`attempt`/`startedAt`/`completedAt`/`failureClasses`/`driftEffect`/`approvalIds`; grep `workflowOutcome.(create|upsert|update)` → zero source matches (only `findMany` reads). Spec-execution idempotency absent (`workflowId = wf_spec_${spec.id}` has no guard). Workflow-level idempotency is JSON-blob + COMPLETED-only, race-prone (`swarm-execution.service.ts:892-904`); a `lockProvider` distributed lock is the actual parallel-execution guard.
- **Drift resolution** — `ExecutionDriftFinding` (`schema.prisma:2083-2109`) has `resolvedAt`/`status` but **no** `resolvedBy`/`resolutionSpecId`/`resolutionWorkflowId`/`resolutionVerdict`. `executeSpec` returns `resolvedDrift.resolved = (verdict === MET)` (`spec-executor.ts:315-318`) but the consumer only logs to AuditLog (`company-operating-layer.service.ts:1213-1227`) — no `executionDriftFinding.update`. Reopen == "still-a-candidate" (`:920-936`), not contradictory-evidence.
- **Failure classes** — 20-class `FailureClass` (`packages/shared/src/types/failure.ts:21-42`); `POLICY` table per class (`failure-classifier.ts:40-61`); `hardNonRetryable` seal (`:140-148`); diagnostician's `DETERMINISTIC_BLOCK_CLASSES` (`failure-diagnostician.ts:103-108`) discards LLM `suggestedFailureClass` for UNKNOWN (`:179-203`). Counterfactual re-executor honest stub (`:125-131` `executed: false`). Legacy 11-class `RepairService` coexists live, bridged by `mapLegacyErrorClass`.
- **Learning governance** — promotion gate requires `n >= minSamples`, `a >= minPresentSuccesses`, `mi >= threshold` (`learning-gate.ts:81-98`); extractor only emits from `TASK_PASSED && verified` (`learning-extractor.ts:101`); promoted→DEPRECATED when MI collapses (`learning-persist.ts:226-237`); `hyperAgentEnabled` default false (`schema.prisma:94`, migration 111). **Config-lifecycle canary/shadow/promote pure core unit-proven but no live caller** — no write endpoint in `apps/api/src/routes` advances `ConfigVersion`. HazardModel time-bounding is a declared type, never populated.
- **Workflows/LangGraph** — `getWorkflowRuntime` always returns `LangGraphRuntime` (`workflow-runtime/index.ts:64-84`); `SwarmRunner` is a facade (`swarm-runner.ts`); SwarmGraph deleted. ADK is `JAK_ADK_MODE=1` opt-in, lazy-`import()`'d, falls back to LangGraph (`swarm-execution.service.ts:1309-1367`).
- **Audit chain** — `prepareAuditChainFields` fetch-latest-then-write (`audit-chain.ts:157-199`) is two separate Prisma calls, **no transaction, no SELECT FOR UPDATE, no advisory lock, no `@@unique([tenantId, chainSeq])`**; TOCTOU documented in header (`:30-35`). Missing secret → fail-open-to-auditable (`:164-165`), logged not swallowed (`audit-log.ts:134-151`).
- **Connectors** — `COMPANY_SYNC_PROVIDERS = ['GITHUB','GMAIL','GOOGLE_DRIVE']` (`sync-provider-normalization.ts:1`); real `fetch` to vendor APIs (`company-connector-sync.service.ts:628-896`); leader-elected `setInterval` scheduler (`swarm.plugin.ts:264-280`). Other 19 connectors are MCP-manifest-only — no scheduled polling. `INTEGRATIONS_MATURITY` self-labels 17/25 `beta`/`partial`.
- **MCP** — JAK is a CLIENT only (`packages/tools/src/mcp/mcp-client.ts:1-27`); no `StdioServerTransport`/`Server` import anywhere. No `brain.*` MCP operations (REST-only `company-brain-v2.routes.ts:27-41`). `ShieldMcpClient` built+unit-tested but grep `new ShieldMcpClient` across `apps/` → no matches (tests only). `mcp.config.example.json` ships all-disabled.
- **Tools/sandbox** — E2B SDK dynamic-import + real `Sandbox.create` (`e2b.adapter.ts:40-79`); Docker adapter hard gates: `--network none`, `--read-only`, `--memory 512m`, `--cpus 1`, `--pids-limit 256`, tmpfs, path-traversal + no-shell-argv (`docker.adapter.ts:80-187`). `code_execute` uses Node `vm`/`python3`, **hard-disabled in production** (`builtin/index.ts:2701-2711`, `HOST_JS_DISABLED_IN_PRODUCTION`); the E2B path is `sandbox_exec`, not `code_execute`. `browser_evaluate_js` runs via `page.evaluate` in Playwright context (`:1769-1771`), not host eval.

## Appendix A — Company Brain / Memory / Skills detail (from read-only audit agent)

Consolidated from a read-only audit agent (corroborates and extends §§2-9). Key additions beyond the first-hand pass:

**A1. Graph V2 ingestion** — `LIVE-RUNTIME-WIRED`, **LLM-gated**: extraction is the single LLM call (`company-operating-layer.service.ts:787-885`, `respondStructured` with zod `ExtractedEntitiesSchema`); `getLLM()` throws at `:792-795` if no `OPENAI_API_KEY`. **Honest failure, no stub** — but the brain graph stays empty without an OpenAI key. Edges are derived **only** from LLM-emitted `relatedEntityTitles` (`company-brain-v2.entities.ts:150-169`); no independent co-occurrence algorithm.

**A2. Retrieval** — confirms §3. Two stacked recency fallbacks: `context.ts:48-53` (FTS-throws → `LIMIT 20` recent) and `context.ts:55-62` (FTS-empty → `LIMIT 15` recent). `tokenBudget` is advisory only (arrays are fixed-count: 30 claims / 25 edges / 12 evidence / 20 entities); PromptBuilder hard-caps at 16_000. **NEW: the plain `callLLM` path is NOT grounded** — `BaseAgent.callLLM` (`base-agent.ts:301-307`) and the protected `BaseAgent.injectCompanyContext` wrapper (`:394-399`, no internal caller) do NOT invoke company-brain injection. Only `ToolExecutionService.executeWithTools` (`tool-execution.service.ts:53`) → `injectCompanyContext` does. Non-tool agents get no `<company_brain>`/`<company_context>`.

**A3. Processing trigger** — confirms §4. **NEW: `schedule()` (`processing.ts:25-28`) is dead code** — the manual route awaits `processArtifact` directly and the auto-sweep uses its own `setImmediate`; `schedule` has no caller. The atomic `claimArtifactForProcessing` upsert provides DB-level state-transition protection, but **no distributed lock** — two API replicas can both poll `listPendingArtifacts` and race (mitigated, not prevented, by the atomic claim).

**A4. Entity merge** — stronger than §7 stated. `resolveEntity` (`company-brain-v2.entities.ts:219-287`) tiers: (1) exact canonical alias match (sim=1.0, backed by `UNIQUE(tenantId,entityType,normalizedAlias)`), (2) token-similarity ≥ 0.94 → auto-merge, (3) 0.72–0.94 → `company_memory_reviews` row, NO auto-merge. `mergeEntities` (`review.ts:123-292`) validates same-tenant + same-`entityType` (throws on mismatch), re-parents claims/edges, migrates aliases, soft-deletes source with `status='merged'`, writes `company_entity_merges` audit. **Still missing for Phase 3:** provider+externalId tier, verified stable identifiers (email/domain/crmId/etc.), deterministic composite key, `algorithmVersion`, `matchingEvidence`, **rejected-candidate preservation**, concurrent-merge `FOR UPDATE` proof.

**A5. Claims** — confirms §6. Typed via `objectValue JSONB` + `objectEntityId` FK (not string-only). `decideClaimTransition` (`core.ts:280-327`) is the implicit uniform policy: single-current-value (one `active` per `(subject,predicate)`, supersede on newer ≥0.15 authority delta), supersession chain (`supersedesClaimId` + `validTo`), dispute (`status='disputed'` + review on comparable authority), human-approval-required (`proposed` + review when authority<0.82 or confidence<0.75), append-only evidence (`company_claim_evidence` `UNIQUE(claimId,artifactId)`, max-authority on conflict). **Missing for Phase 4:** declarative per-predicate policy table, typed-value discriminator, per-type normalization (money/currency, date/time), `contradictsClaimId`, `sourceBodyHash`, `observedAt` on claim, `extractorVersion`, `policyVersion`, DB-level type constraints.

**A6. Access control** — **PARTIAL, with a real trust-boundary defect.** `canAgentAccessArtifact` (`core.ts:269-278`) is correct, but:
- **Role spoofing on the preview route** — `POST /company/brain/context` (`routes.ts:37-41`) takes `agentRole` from the **request body** with only `fastify.authenticate` (no `requireRole`). Any authenticated user in the tenant can pass `agentRole: 'WORKER_FINANCE'` and receive the restricted-derived slice for that role. The agent-prompt path is safe (uses trusted `AgentContext.role`); this HTTP preview path is not. **Phase 5 target.**
- **Post-fetch filtering only** — restricted rows are read into the API process before being filtered (defense-in-depth concern, not a correctness bug).
- **Derivation taint via source-OR** — `context.ts:78-81` keeps an entity if `sources.length===0 || sources.some(visible)`; an entity derived from BOTH a restricted and a public artifact survives, and its `summary` (which may paraphrase restricted content) is emitted. `evidence` IS filtered to `visibleArtifacts` only (`:114-124`) — but claims/entities/edges are source-OR. **Phase 5 target.**

**A7. Memory systems (four distinct subsystems — do not conflate):**
| Subsystem | Status | Evidence |
|---|---|---|
| `<memory>`-tag tenant-memory injection | **DEAD-OR-DUPLICATE** | `BaseAgent.memoryProvider` declared `= null` (`base-agent.ts:266`), **never assigned anywhere in the repo**; `injectMemories` (`prompt-builder.service.ts:205-234`) has **zero call sites**. README/AUDIT-V6 claims are aspirational. |
| HyperAgent MI-gated persist/recall | `LIVE-RUNTIME-WIRED` (gated on `hyperAgentEnabled`) | `learning-node.ts:109` persist; `planner-node.ts:99` recall + `applyBanditToPlan` |
| Memory-approval (`extracted`→`approved`) | `PARTIAL` (route-wired; `suggest()` uncalled) | `company-brain.routes.ts:199/211/221`; `memory-approval.service.ts:53` `suggest()` has no caller |
| Conversation memory (per-thread) | `LIVE-RUNTIME-WIRED` (load path) | `swarm-execution.service.ts:1092-1100` |
| `memory_v2` (migration 3) schema | `PRODUCTION-PROVEN` (schema) | `3_memory_v2/migration.sql` |

Also dead: `BaseAgent.persistLearning`/`recallLearnings` (`base-agent.ts:635`/`668`) route through `memory_store`/`memory_retrieve` tools and have no subclass callers (workers declare those as LLM tools instead). `company-brain-v2.memory.ts` is a 5-line empty abstract subclass.

**A8. Skills** — mixed. Bundled SKILL.md packs (`packages/skills/public/*/SKILL.md`) are `LIVE-RUNTIME-WIRED` (`tool-execution.service.ts:60` → `formatBundledSkillsForAgent`). Tenant-proposed pipeline is `PARTIAL`: `POST /skills/propose` (`skills.routes.ts:153`) is **NOT role-gated** (any authenticated user); `POST /skills/:id/approve` (`:235`) gates on **status not `riskLevel`** — a `PROPOSED` skill that never ran the sandbox can be approved; sandbox **degrades to schema-only-pass** when `getSandboxAdapter()` throws (`:471-476`); **"no tests = pass"** (`:482`). **Agents cannot propose skills** (no agent-side proposer). Tier 2 `GENERATED_PLAN` is enum-only (`packages/shared/src/types/skill.ts:5`), no producer. **Phase 8 target.**

## Appendix B — Backup-branch commit classification (`origin/feature/hyperagent-production-hardening`)

**Method:** first-hand `git show --stat` / `git diff` of each of the 7 unique commits past the fork base `2ca88d88`, compared against current `main` (`59db931`). **Key finding: the 19 distinct source files these commits touch are byte-identical between `2ca88d88` and current `main`** — Graph V2 (PR #137 + #145) touched none of them, so every cherry-pick applies cleanly and none of the fixes is already present on main by any path.

| SHA | subject (short) | on main? | Graph V2 conflict? | classification | rationale |
|------|------------------|----------|--------------------|------------------|-----------|
| `e854601` | preserve Standing Order `allowedToolNames` end-to-end through LangGraph state | No | No | **SAFE-TO-CHERRY-PICK** | Additive LangGraph state channel mirroring the existing `disabledToolNames`; `workflow-runtime/*` byte-identical on main. |
| `53800a5` | enforce OBSERVE as read-only at the autonomy-policy layer | No | No | **SAFE-TO-CHERRY-PICK** | Adds the OBSERVE denial block to `autonomy-policy.ts` (main only special-cases `OFF`); pure governance-layer addition + new test. |
| `6ef07e2` | seal security-blocked diagnoses before replanning (pre-LLM guard + graph edge) | No | No | **SAFE-TO-CHERRY-PICK** | Three defense layers (typed seal on `FailureDiagnosis`, `afterDiagnosis` sealing edge, `replan()` pre-LLM guard); main still routes security diagnoses to the LLM proposer. |
| `1de63af` | dependency-aware recovery scheduling (wire `getReadyTasks` into replanner) | No | No | **SAFE-TO-CHERRY-PICK** | Replaces broken index-based `replayIndex` (main `replanner-node.ts:167-226`) with dependency-aware `getReadyTasks`. |
| `860987d` | unify ADK under LangGraph governance; LangGraph primary when HyperAgent enabled | No | No (touches `swarm-execution.service.ts`, not Graph V2's `index.ts`) | **SAFE-TO-CHERRY-PICK** | New pure `orchestration-router.ts` + governed ADK wiring; HyperAgent-ON + ADK-ON is still ungoverned on main. |
| `d620fc3` | directional + statistically safe learning promotion | No | No | **SAFE-TO-CHERRY-PICK** | Adds directional-lift + Wilson 95% lower-bound gates + fixes positional-marginals MI bug; main's `learning-gate.ts` is MI-only. |
| `d62f7d8` | composite, order-invariant, dimensioned learning keys | No | No | **SAFE-TO-CHERRY-PICK** | Adds `composeConfigKey`/`normalizeToolSet` + industry/model/risk dimensions; main still uses the fragile `toolsRequired[0]` key. |

**Cherry-pick order (matters):** `e854601 → 53800a5 → 6ef07e2 → 1de63af → 860987d → d620fc3 → d62f7d8`.
- `6ef07e2` amends `observe-read-only.test.ts` created by `53800a5`.
- `1de63af` and `53800a5` both edit `replanner-node.ts`.
- `d62f7d8` edits `hyperagent-measured-learning-impact.test.ts` modified by `53800a5` and logically depends on `d620fc3`'s directional gate.

**Disposition:** These 7 fixes are NOT applied wholesale. They fold into the relevant focused PRs:
- `e854601` (allowed-tools plumbing) + `1de63af` (dependency-aware replan) + `6ef07e2` (security-seal) → **PR C** (Hyperagent execution persistence + approval resume — Phase 6).
- `860987d` (ADK/LangGraph governance unification) → **PR C** (execution-path correctness).
- `d620fc3` (directional/statistical promotion) + `d62f7d8` (composite learning keys) → **PR D** (Governed learning — Phase 7).
- `53800a5` (OBSERVE read-only) → **PR D** (learning governance).
Each cherry-pick will be followed by the full repo gate before merge; the read-only audit predicts no textual conflict but has not run the combined build.
---

## PR B — Entity identity (Phase 3) + access control (Phase 5)

**Status:** implemented locally on `feat/company-brain-entity-access-control` (off main `4d20ddd`); local gate green (typecheck 0, lint `--max-warnings=0` exit 0, integration 375/0, unit 49/0). Pushed once as a focused draft PR after the full local matrix passed.

**Migration 120** (`120_entity_merge_metadata_and_rejections`): adds `algorithmVersion` + `matchingEvidence` JSONB to `company_entity_merges`, and a new `company_entity_merge_rejections` table (UNIQUE per `(tenantId, sourceEntityId, candidateEntityId)`, `decision` ∈ {`deferred`, `rejected`}, cascade-delete from `company_graph_entities`).

**Entity resolver — 6-tier identity hierarchy** (`company-brain-v2.entities.ts` `resolveEntity`): identity is established strictly, strongest evidence first —
1. `provider_external_id` — same integration source + external record id (from `properties.provider` + `properties.externalId/crmId/…`)
2. `verified_stable_identifier` — a shared, allowlisted durable identifier (email/domain/website/url/crmId/externalId/handle/linkedin/github) in `properties`
3. `exact_alias` — exact canonical alias (aliases table)
4. `deterministic_composite` — exact/near-exact (≥0.94) normalized title with **no conflicting identifier** (two "Acme" with different domains are NOT merged)
5. `probabilistic_review` — 0.72–0.94 token similarity → human review
6. `none` — separate entities

Tiers 1–4 auto-merge (dispositive); tier 5 defers to a human. The candidate pool is tenant-scoped at the SQL boundary (`tenantId` + `entityType`), so a same-named entity in a different tenant is never matched (cross-tenant isolation enforced in the query, not by post-filtering). Pure classifier helpers (`extractStableIdentifiers`, `extractProviderExternalId`, `identifiersConflict`, `classifyEntityCandidate`) live in/over `company-brain-v2.core.ts` + `entities.ts` and are unit-tested without a DB.

**Merge concurrency** (`company-brain-v2.review.ts` `mergeEntities`): the `query`/`execute` helpers run each statement in its own autocommit, so a per-statement `SELECT … FOR UPDATE` would release its row lock immediately and NOT serialize the multi-statement body. Instead the merge serializes via:
- an atomic compare-and-swap `UPDATE … SET status='merging' … RETURNING` on the **source** row (free-TEXT `status` column; `merging` is a transient sentinel owned by the winning merge) — a concurrent merge of the same source affects 0 rows and throws;
- an atomic jsonb `"sourceArtifactIds" || $sourceArtifacts` append on the **target**, conditional on the target still being `active` — two concurrent merges of different sources into the same target both append with no lost update; a concurrent merge of the target into something else aborts this merge.
Every merge stamps `algorithmVersion='entity-resolver-v1'` + `matchingEvidence` (tier + matched identifier/similarity) on the `company_entity_merges` row.

**Rejected/deferred-candidate preservation** (`rejectEntityMerge` + route `POST /company/brain/entities/:id/reject-merge`): a tier-5 review also writes a `deferred` `company_entity_merge_rejections` row (idempotent per pair). A human reject escalates the row to `rejected` and resolves the open review for that exact candidate. The resolver's tier-5 loop checks the rejection table and **never re-proposes a rejected pair** — this is the guarantee `createReview`'s open-status dedupe alone cannot provide (once a review is `rejected`, `createReview` would otherwise open a fresh one on the next extraction).

**Access control hardening (audit A6):** `POST /company/brain/context` now requires a review role (`REVIEWER`/`TENANT_ADMIN`/`SYSTEM_ADMIN`). The `agentRole` body field is untrusted; gating prevents a low-privilege authenticated tenant user from escalating to a privileged agent role. The source-AND entity/claim/edge access filter (Phase 1) is reinforced with an adversarial test proving an edge to a restricted entity is dropped for a non-allowed role and the relationship never leaks through graph structure.

**Honest limitations (NOT production-proven by these tests):**
- The merge CAS uses a transient `merging` sentinel on the free-TEXT `status` column. A crash between the CAS and the final soft-delete leaves the source stuck in `merging` (un-mergeable until manual repair). Full single-statement-transaction atomicity — wrapping the entire `mergeEntities` body plus `upsertClaim`/`upsertEdge` in one `db.$transaction` with a tx-aware runner — is the dedicated PR E audit-chain TOCTOU work and is intentionally deferred.
- `createReview` dedupes by `(resourceId, status='open')`, not by candidate. A source with two different tier-5 candidates keeps only one open review (the first); the rejection table tracks per-candidate state for the audit and the no-re-proposal guard, but the review UI does not multi-track candidates.
- Two concurrent merges of the SAME source into DIFFERENT targets: the CAS lets one win and the other throws; the losing target is untouched (no partial re-parent), but the caller must retry the losing merge against the surviving target. No automatic re-targeting.
- `properties` identifiers are untrusted tenant input; the allowlist (not `Object.keys`) bounds which keys can establish identity, but a tenant could still place a real email in a `notes`-style key that the resolver ignores (safe) or in an allowlisted key (treated as evidence — by design, the tenant owns its own graph).
- Production concurrency (multi-process, real Postgres under load) is NOT proven here; the tests use a single testcontainer. The CAS + append are correct under Postgres row-lock semantics, but multi-tenant production contention is PR G canary work.

---

## PR C — Hyperagent execution persistence + artifact harvesting + approval pause/resume (Phase 6)

**Status:** implemented locally on `feat/hyperagent-execution-persistence` (off main `22e00eb`, with the 4 safe backup-branch cherry-picks `7345092`/`b62123c`/`f4c3beb`/`26cd719` folded in — see Appendix B disposition). Local gate green: api typecheck 0, `pnpm lint:eslint` 0 warnings, unit 2652/0, integration 398 passed / 101 skipped (env-blocked), incl. the new `tests/integration/spec-execution-persistence.test.ts` (6/0 against a real pgvector testcontainer). Swarm + api + db build clean; `prisma generate` clean.

**What this PR closes (audit §A0 capabilities #1, #2, #4, #5 — all moved from PARTIAL → INTEGRATION-PROVEN):**

1. **Execution persistence (#1/#4):** new `spec_executions` table (migration 121) — one row per approved-spec execution *attempt*, `@@unique([tenantId, specId, attempt])` as the idempotency guard, status transition `running → awaiting_approval → completed`, `verdict` CHECK-constrained to `met|unmet|unverifiable`. `CompanyOperatingLayerService.executeSpec` claims an attempt atomically (MAX+1 with P2002 retry for multi-process contention), runs the closed loop, and on completion stamps `spec_executions` (verdict + taskTotal/Passed/Failed/Blocked + cost + completedAt + failureClasses), **upserts a `workflow_outcomes` row**, and stamps the `agent_executable_specs` execution-link columns (`executedAt`/`executedWorkflowId`/`lastVerdict`/`lastExecutionId`). Re-executing the same spec claims attempt 2 (no duplicate of attempt 1); the spec's `lastExecutionId` points at the latest run. Cross-tenant isolation regression-tested.

2. **Spec-execution IS a workflow run (FK honesty):** the service now creates an idempotent `workflows` row (`wf_spec_<specId>`) before persisting — `workflow_outcomes.workflowId` and `workflow_artifacts.workflowId` both FK to `workflows(id)` ON DELETE CASCADE, so the row must exist before any outcome/artifact write. The prior code wrote those FKs against a workflowId that had no `workflows` row (a runtime FK violation the integration test caught). A spec execution is now visible + inspectable in `workflows`, not an orphan workflowId only referenced from `spec_executions`.

3. **Artifact harvesting (#2):** `executeSpec` now harvests a `workflow_artifacts` row (provenance: `specExecutionId` + `metadata={specId,executionId,harvestedArtifactId}`, `artifactType='final_output'`, inline JSON provenance snapshot, sha256 contentHash, status `READY`) per artifact id produced by a satisfied `ARTIFACT_PRESENT` criterion. The artifact id is recovered by zipping the spec's original structured `acceptanceCriteria` with `result.acceptanceResults` by index — the measurer's `criterion` field is only the description *string* (it strips the structured criterion), so the artifactId cannot be read from the result alone (this was a real bug in the first cut: `acceptanceArtifacts` read `r.criterion.artifactId` which is always undefined). Also wires the previously-unreachable `POST /artifacts` route (audit §A0 #2 found the service existed but had no HTTP surface).

4. **Approval pause/resume signal (#1 AWAITING_APPROVAL):** the pure executor's `executeApprovedSpec` now surfaces `awaitingApproval=true` + `approvalRequestId` + `UNVERIFIABLE` verdict + a complete (no-undefined-fields) empty `OutcomeEvaluation` when the run interrupts at an approval gate (previously the runtime *threw* `GraphInterrupt` uncaught — audit §A0 #1). `spec-executor-runtime.ts` catches `GraphInterrupt`/`isInterrupted`, reads pending approvals off the LangGraph checkpoint, and returns the FinishedRun with `awaitingApproval`. The service persists the `spec_executions` row as `awaiting_approval` (+ `approvalRequestId`); `resumeSpecExecution` re-drives the SAME LangGraph thread (workflowId-keyed checkpointer), persists the final outcome, and **refuses to resume a non-awaiting row** (never silently double-resumes). New `POST /company/spec-executions/:executionId/resume` route (REVIEWER+).

5. **Drift resolution write-back + reopen-with-contradiction (#5):** `executeSpec` now writes drift resolution back to `execution_drift_findings` (raw SQL — the narrowed `executionDriftFinding` type has no typed `update`). MET → drift marked `resolved` with full provenance (`resolvedBy`/`resolutionSpecId`/`resolutionWorkflowId`/`resolutionVerdict`/`resolutionExecutionId`), only if not already resolved. Non-MET on a previously-resolved drift → **REOPENED** with contradiction evidence (`status` back to `open` + `contradictedAt` + `contradictingExecutionId`), replacing the prior "still-a-candidate" no-op. New `resolvedBy`/`resolutionSpecId`/`resolutionWorkflowId`/`resolutionVerdict`/`resolutionExecutionId`/`contradictedAt`/`contradictingExecutionId`/`lastResolutionAt` columns (migration 121).

**Folded-in backup-branch cherry-picks (Appendix B, all classified SAFE, all re-gated green):** `7345092` (Standing Order `allowedToolNames` end-to-end through LangGraph state), `b62123c` (seal security-blocked diagnoses before replanning — pre-LLM guard + graph edge + typed `seal` on `FailureDiagnosis` + `securityFieldsForClass` + `DETERMINISTIC_BLOCK_CLASSES`), `f4c3beb` (dependency-aware recovery scheduling — `getReadyTasks` replacing replay index), `26cd719` (unify ADK under LangGraph governance — LangGraph primary when HyperAgent enabled). The `6ef07e2` cherry-pick dropped one cross-PR test-file hunk (`tests/unit/swarm/observe-read-only.test.ts`, owned by PR D's `53800a5`) via `git rm`; the substantive code + the new `security-diagnosis-seal.test.ts` applied cleanly.

**Honest limitations (NOT production-proven by these tests):**
- The live LangGraph `interrupt()` + `Command(resume)` E2E against a real provider is **env-blocked** (no OpenAI/Sarvam keys in this session) — the same env-bar as every live-graph HyperAgent seam. The signal propagation, the DB state transitions (`awaiting_approval` → `completed`), the resume seam signature, and the closed-loop logic are integration-proven with a deterministic stub `runPlan`. The real graph resume is PR G canary work.
- The spec-execution `runPlan` production seam is `runPlanViaLangGraph`, env-blocked at every agent node. Tests inject a stub via `deps.runPlan` (the same honesty posture as `hyperagent-spec-execution.test.ts`).
- Artifact harvesting stores an inline JSON provenance snapshot, not the run's real task-output bytes (the richer byte-level harvester that extracts bytes from `taskResults` is a separate wiring — audit §A0 #2 open edge). The provenance row is durable + self-describing + FK-linked to the spec execution.
- Multi-process `claimSpecExecution` contention relies on the `@@unique([tenantId, specId, attempt])` guard + bounded P2002 retry; single-process correctness is proven, multi-process production contention is PR G canary work.
- The merge-CAS `merging`-sentinel crash-recovery gap (PR B honest limitation) is still open — deferred to PR E's single-transaction atomicity work.

## PR D — Governed learning live caller + procedural skill compiler (Phase 4 + Phase 8)

**Status:** implemented locally on `feat/governed-learning-skill-compiler` (off main `d4cb6e1`, with the 3 safe backup-branch cherry-picks `adc4e65`/`b754d6e`/`cd10c62` folded in — see Appendix B). Local gate green: api typecheck 0, `pnpm lint:eslint` 0 warnings, unit 2696/0, integration 414 passed / 101 skipped, incl. two new real-Postgres testcontainer suites: `tests/integration/skills-hardening.test.ts` (8/0) and `tests/integration/config-lifecycle-live.test.ts` (8/0). Shared + db + skills + swarm + api build clean; `prisma generate` clean; `check:truth` OK.

**Folded-in backup-branch cherry-picks (Appendix B, all classified SAFE, all re-gated green):** `adc4e65` (enforce OBSERVE as read-only at the autonomy-policy layer — PROMOTE_CONFIG requires L4 + non-OBSERVE), `b754d6e` (directional + statistically safe learning promotion — Wilson 95% lower bound + directional MI), `cd10c62` (composite, order-invariant, dimensioned learning keys — `composeConfigKey`/`normalizeToolSet`).

**What this PR closes:**

### Phase 8 — procedural skill compiler + skills hardening

1. **Tier 2 GENERATED_PLAN producer (audit §A0 #6):** new pure core `packages/skills/src/skill-compiler.ts` `compilePlanToSkill` deterministically compiles an APPROVED `agent_executable_spec`'s plan tasks into a versioned executable skill spec (an ordered procedure of steps, 1:1 with the plan tasks, order preserved). This is STRUCTURAL compilation, NOT LLM codegen — fully reviewable + reproducible. New `POST /skills/compile-from-spec` route (TENANT_ADMIN+) persists the compiled skill at `tier=2` (GENERATED_PLAN), `status=PROPOSED` — a generated skill is NEVER auto-approved; it still requires sandbox validation + TENANT_ADMIN approval. Provenance (`sourceSpecId`/`sourceSpecTitle`/`generatedAt`/`steps`) is stored in `inputSchemaJson`. Non-approved spec → 409; empty-tasks spec → 409; cross-tenant spec → 403.

2. **Sandbox fail-closed (audit §A0 #6):** new pure core `resolveSandboxVerdict` replaces the prior fail-OPEN sandbox result logic. A coded skill whose sandbox adapter is unavailable now FAILS (status stays PROPOSED, `sandboxResult.passed=false`, reason "sandbox unavailable: coded skills require sandbox execution to pass") — it does NOT silently degrade to a schema-only pass. A coded skill with zero test cases also FAILS ("coded skill requires ≥1 test case — no-tests ≠ pass"), and a coded skill whose tests did not run FAILS. Codeless (schema-only) skills still PASS on schema validity alone — the legitimate no-code path is preserved. The route wires `resolveSandboxVerdict` + records `sandboxAvailable` in the result.

3. **Skill-approval risk-level gating (audit §A0 #6):** `POST /skills/:id/approve` now refuses to approve a HIGH or CRITICAL skill that has not passed the sandbox (`HIGH/CRITICAL require SANDBOX_PASSED`). LOW/MEDIUM may be approved from PROPOSED (sandbox recommended, not required). The approver is still TENANT_ADMIN+.

4. **Tier mapping fixed + propose role-gate (audit gap #270):** the stale `1=BUILTIN, 2=COMMUNITY, 3=TENANT` mapping in `skills.routes.ts` + `apps/api/src/types.ts` is corrected to the canonical `1=BUILTIN, 2=GENERATED_PLAN, 3=PROPOSED` (matching `packages/shared` `SkillTier` enum + the `schema.prisma` comment). `POST /skills/propose` is now role-gated REVIEWER+ (a worker should not self-install skills; previously any authenticated caller could propose).

### Phase 4 — config-lifecycle LIVE caller (canary-gated self-learning reachable from runtime)

5. **Config-lifecycle write endpoint (audit §A0 #3 — the `EXPERIMENT_CONTROLS_WIRED=false` gap):** new `ConfigLifecycleService` (`apps/api/src/services/company-brain/config-lifecycle.service.ts`) is the LIVE caller over the pure `config-lifecycle.ts` gate. Three new routes (TENANT_ADMIN+): `POST /hyperagent/experiments` (create a DRAFT ConfigVersion), `POST /hyperagent/experiments/:id/advance` (advance one step DRAFT→PROPOSED→SHADOW→CANARY ramp→PROMOTED via the pure gate), `POST /hyperagent/experiments/:id/rollback`. `EXPERIMENT_CONTROLS_WIRED` flipped `false → true`. Every transition is persisted + audited as a `ConfigRolloutEvent` (transactional with the status write — the audit trail can never diverge from the row state). The pure gate refuses a fake advance on HOLD: missing/insufficient metrics ⇒ the status is UNCHANGED, an evaluation summary is attached, and a HOLD audit event is written (integration-proven — the "NEVER a fake advance" guarantee). A safety-incident breach ⇒ immediate ROLLBACK.

6. **PROMOTED config reaches live runtime:** on PROMOTE, the prior PROMOTED ConfigVersion of the same kind is superseded (ARCHIVED, `supersededById`/`parentVersionId` linked). For `AUTONOMY_POLICY` and `REPAIR_BUDGET` kinds, the spec is applied to the tenant's `HyperAgentConfig` — the row the live `evaluateForConfig` autonomy-policy evaluator reads — so a PROMOTED config genuinely governs live agent behaviour (integration-proven: after promoting an `AUTONOMY_POLICY {autonomyLevel:'L3'}`, `hyper_agent_configs.autonomyLevel='L3'`). Spec shapes are strict-validated (zod) before they enter the pipeline or are applied; unknown fields are rejected.

**Honest limitations (NOT production-proven / not yet wired):**
- The canary TRAFFIC-PERCENT routing into the live graph (sending N% of live executions to a CANARY config, per `rolloutPercent`) is NOT consumed by the live graph yet — the live graph reads `LearningRecord` arms for config selection, not `ConfigVersion.rolloutPercent`. The lifecycle DECISION + audit + the PROMOTED→`HyperAgentConfig` application ARE live; canary traffic routing is the remaining wire.
- `LEARNING_GATE` / `GOVERNANCE_RULE` / `TOOL_POLICY` ConfigKinds are persisted + audited through the lifecycle but NOT applied to live behaviour (their live consumers are roadmap) — only `AUTONOMY_POLICY` + `REPAIR_BUDGET` reach live runtime via `HyperAgentConfig` today (integration-proven).
- The procedural skill compiler is structural (plan tasks → skill steps), not LLM codegen — it does not author skill source code. A GENERATED_PLAN skill carries an ordered procedure in `inputSchemaJson`; its "execution" is the agent following the steps, not running JS. Sandbox for a codeless GENERATED_PLAN skill is schema-only validation (the appropriate level for a plan-skill); the real gate is human TENANT_ADMIN approval.
- Advancing/promoting a config is a human operator action via the API (TENANT_ADMIN+), not the agent self-promoting — the agent may not self-advance a config. The canary stage is mandatory before promote (the lifecycle gate enforces SHADOW→CANARY→PROMOTED; no skip), respecting the "never enable self-learning globally without a canary" constraint.

## PR E — Brain MCP surface + audit-chain concurrency + product graph interface (Phase 9 + Phase 10 + Phase 11)

**Status:** implemented locally on `feat/brain-mcp-product-graph-audit-chain` (off main `961e4e6`). Local gate green: `pnpm lint:eslint` 0 warnings, `pnpm --filter @jak-swarm/api exec tsc --noEmit` 0, web tsc + eslint clean on `CommandPalette.tsx` + `ChatSidebar.tsx`, unit 2734 passed / 54 todo (2788), integration 423 passed / 101 skipped (runtimeUnavailable graceful — Docker up), build 15/15 turbo tasks successful, `pnpm check:truth` OK (122 tools registered, 0 unclassified). Four new test suites: `tests/unit/security/shield-mcp-live.test.ts` (13), `tests/integration/shield-mcp-live-audit.test.ts` (3, real Postgres testcontainer), `tests/unit/tools/brain-mcp-server.test.ts` (17), `tests/integration/audit-chain-concurrency.test.ts` (concurrent appenders), plus extensions to `tests/integration/audit-log-chain.test.ts` + `tests/unit/security/audit-chain.test.ts` and `tests/integration/company-brain-merge-atomicity.test.ts`.

**What this PR closes:**

### Phase 10 — audit-chain TOCTOU + merge atomicity + Shield live

1. **Audit-chain TOCTOU (§9):** the append path is now the atomic `appendChainedAuditRow` primitive — a single transaction that takes `pg_advisory_xact_lock(hashtext(tenantId))` (per-tenant serialisation), reads the chain head, and writes the next row with `prevHash`/`chainSeq = head + 1` inside the same tx. Two simultaneous tenant writes can no longer read the same head and fork. Migration 122 adds a partial unique index `WHERE rowHash IS NOT NULL` on `(tenantId, chainSeq)` as a backstop that rejects any duplicate seq that escapes the lock. `verifyChain` semantics unchanged. Proven against real Postgres by `tests/integration/audit-chain-concurrency.test.ts` (concurrent appenders → no duplicate seq, no fork, valid chain) + `tests/integration/audit-log-chain.test.ts` (tamper/reorder/delete detected, missing-secret fail-open honestly reported).

2. **mergeEntities single-transaction atomicity (PR B honest limitation, now closed):** `CompanyBrainV2Service.mergeEntities` runs the entire merge — source/target existence + tenant-scope checks, edge re-pointing, claim re-parenting, source-entity archival, review-record update, audit rows — inside ONE Postgres transaction via an `AsyncLocalStorage` tx-context (`company-brain-v2.tx-context.ts`). The store methods participate in the ambient tx when one is active, falling back to the prior single-statement behaviour when not (so existing callers + tests are unchanged). A `merging`-sentinel crash-recovery gap is no longer possible: either the whole merge commits or none of it does. Proven by `tests/integration/company-brain-merge-atomicity.test.ts` (atomic rollback on a mid-merge failure → no partial state).

3. **ShieldMcpClient live instantiation + audit-chain routing (§12):** `packages/security/src/shield-gateway/shield-mcp-live.ts` instantiates the Shield MCP client behind `SHIELD_MCP_CANARY=1` (default-off). `requestSignedInputScanDecision` runs the real `scanInput`, mints an Ed25519-signed `ShieldSignedDecision` (verdictFromScan + subject{kind:input_scan, requestHash:sha256Hex(text)}), and self-verifies it — **fail-closed** on a signature/key mismatch (a tampered or mismatched-key decision is refused, not trusted). `recordShieldDecisionToAudit` writes a `SHIELD_DECISION_SIGNED` row into the atomic audit chain (severity WARN for BLOCK / INFO otherwise, `decisionId` as resourceId, never throws — a broken audit sink cannot take down a workflow). New `SHIELD_DECISION_SIGNED` `AuditAction`. The canary is wired into `swarm-execution.service.ts` after the existing `scanInput` of the workflow goal: it RECORDS signed decisions but does NOT gate execution (the canary is observational; errors are caught + logged at WARN, never thrown). Fail-open-to-auditable when the keypair is absent (no `SHIELD_SIGNING_KEY`/`SHIELD_VERIFICATION_KEY`). Proven against real Postgres by `tests/integration/shield-mcp-live-audit.test.ts` (ALLOW + BLOCK signed decisions chain-joined + `verifyChain` valid; `requestHash` binds the exact scanned text).

### Phase 9 — Brain MCP surface (brain.*)

4. **First in-process MCP server (§12):** `packages/tools/src/mcp/brain-mcp-tools.ts` defines 4 tool specs; `brain-mcp-server.ts` builds a real `@modelcontextprotocol/sdk` `Server` + `InMemoryTransport` pair exposing them:
   - `brain_get_graph` (READ_ONLY, no approval) — tenant entity graph (query/entityType/limit).
   - `brain_get_entity` (READ_ONLY, no approval) — one entity detail + evidence.
   - `brain_merge_entities` (DESTRUCTIVE, requires approval) — governed entity merge.
   - `brain_decide_claim` (WRITE, requires approval) — APPROVED/REJECTED claim decision.
   - **Tenant identity is NEVER a tool argument.** No `brain_*` input schema accepts `tenantId`/`userId` (all `additionalProperties:false`). The tenant + actor are carried in `params._meta.jakContext` (raw MCP path) or injected from the authenticated `ToolExecutionContext` (JAK registry path). A call without `jakContext` (or missing userId) is REFUSED; a `tenantId` passed in arguments is ignored — cross-tenant escape is blocked (proven by `tests/unit/tools/brain-mcp-server.test.ts`, 17 tests incl. explicit cross-tenant-escape-blocked tests on both paths).
   - `getContextPackage` (the `<company_brain>` prompt injection) is **deliberately NOT exposed** — it takes an `agentRole` and could be used to escalate; reads stay safe, the role-scoped context package is injected only by the trusted server-side `PromptBuilder`, never by an agent tool call.
   - `registerBrainMcpToolsInRegistry` connects a `Client` to the server and registers each `brain_*` tool in the JAK `toolRegistry` with a context-aware executor (`provider:brain`), so they are REACHABLE FROM THE LIVE AGENT RUNTIME as first-class tools — not a placeholder. Boot-wired in `apps/api/src/index.ts` behind `BRAIN_MCP_SERVER=1` (default-off; non-test only); `disconnect()` is hooked into graceful shutdown.

### Phase 11 — product graph interface (reachability)

5. **Dashboard nav wired (§15):** `/company` (Company Brain — profile, ingestion, entity extraction) + `/company/graph` (Product Graph — entities, claims, edges, review queue) are now reachable from the dashboard: added to `CommandPalette.tsx` `PALETTE_ENTRIES` under a new `Brain` zone (with `Share2`/`Brain` icons + keyword sets) and to `ChatSidebar.tsx` `ZONES` (id `brain`, highlights on `/company/*`). `ZONE_ORDER` updated. This is the reachability half of the Phase 11 interface.

**Honest limitations (NOT production-proven / not yet wired):**
- The Brain MCP server is IN-PROCESS (`InMemoryTransport`); a standalone stdio/SSE JAK Shield-style deployment is roadmap. The `transport` option on `ShieldMcpClient` is the seam for a remote Shield; the Brain server has no remote-transport seam yet.
- The Shield canary RECORDS signed decisions into the audit chain but does NOT GATE execution — it is observational by design (default-off, errors swallowed). Wiring a Shield BLOCK into the execution gate (refusing a blocked goal) is a deliberate later step that requires a fail-closed policy decision; this PR proves the signed-decision + audit-chain plumbing, not the gate.
- The Phase 11 product-graph interface is REACHABILITY only — the rich merge-comparison UI (side-by-side entity diff, evidence drawer, conflict queue, impact chains, authority/confidence explanation) remains roadmap.
- The Brain MCP live wiring is a CANARY (`BRAIN_MCP_SERVER=1`, default-off); the tool SPECS are always importable but the in-process server + registry registration only activate with the flag. No production canary has run.
- `getContextPackage` exposure (agent-readable role-scoped context) is intentionally deferred — the agentRole-escalation guard stands until a safe role-bound surface is designed.

## PR F — README truth-lock simplification + universal-claim correction (Phase 12)

**Status:** implemented locally on `chore/readme-landing-truth-simplification` (off main `659065b` = PR E merged). Docs-only PR. Local gate green: `pnpm lint:eslint` 0 warnings, `pnpm check:truth` OK (122 tools, 0 unclassified). No code touched → api tsc / vitest / build unaffected (re-verified green from PR E baseline; no source files changed in this PR).

**What this PR closes (Phase 12):**

1. **Stale-claim correction (PR E made these obsolete):** the README carried three claims that PR E's closures contradicted —
   - "the `ShieldMcpClient` is **not yet instantiated in the live action path** (deferred)" (Verified Evidence Safety row + the "How It Works" blockquote + the Long-Term Vision `🟡 Deferred` bullet + the Phase-narrative tail). All corrected: the ShieldMcpClient is now **live-instantiated behind `SHIELD_MCP_CANARY=1`** (observational canary — records signed Ed25519 decisions to the atomic audit chain, does not gate execution; external transport still roadmap).
   - "the `AuditLog` chain's ... fetch-latest-then-write TOCTOU under concurrency" listed as outstanding (blockquote + the `🟡 Env-blocked` bullet). Corrected: the TOCTOU is **CLOSED (PR E)** via the atomic `appendChainedAuditRow` primitive + per-tenant `pg_advisory_xact_lock` + migration 122 partial-unique-seq backstop.
   - The FAQ roadmap list included "AuditLog row chain-hashing" as a future item — it is shipped (migration 117 + PR E atomicity). Removed; replaced with the genuinely-pending items (live production canary of the HyperAgent learning loop + Brain/Shield MCP canaries).

2. **De-duplication + simplification of verbose programme material:**
   - The 600-word single-paragraph blockquote under the "How It Works" mermaid diagram (which duplicated the "Long-Term Vision" `<details>` wired-vs-pure-core breakdown verbatim) is replaced with a 2-paragraph concise summary + a pointer to the detailed section. This is the single largest readability win and also where two of the stale claims lived.
   - The two redundant GEPA/optimizer rows in the Verified Evidence table (Agent Optimizer + Before/after optimization results — both repeated the 6/6 train + 4/4 val + p50 7.6s numbers) are merged into one "Agent Optimizer (GEPA)" row.
   - The ~120-word GEPA narrative paragraph in "Optimization Story" (which restated the same numbers a third time) is condensed to 2 sentences pointing at `qa/benchmark-optimization-before-after.md`.

3. **Truth-lock preservation:** the `pnpm check:truth` pins are untouched — `Classified_Tools-122` badge, the "122 classified tools" headline, "38 AI Agents", "22 connectors" all preserved. No prohibited phrase introduced (Hono / "no api keys required" / "Ducky Duck" / "Nx cheaper" / "Your Entire Company, Automated" / "autonomous multi-agent AI platform" / "production tools" all still absent). The landing page (`apps/web/src/app/page.tsx`) was already simplified on 2026-04-28 (commit d7bbf71 — stat cards + integration chips removed; `product-truth.ts` is the lean canonical registry the truth-check pins) and carries no stale ShieldMcp/TOCTOU claims, so no landing edits were warranted.

**Honest limitations:**
- This is a README honesty + readability pass, NOT a content audit of every linked doc. The detailed HyperAgent wired-vs-pure-core breakdown lives on in the "Long-Term Vision" `<details>` block (now with corrected claims); `docs/hyperagent-current-state-audit.md` and the per-PR sections of this doc remain the deepest source of truth.
- README is still ~997 lines / ~72KB. The mandate's "simplification" is satisfied by removing the worst duplication + stale claims without gutting truthful feature/architecture/deployment content. A more aggressive restructure (extracting sections into separate docs) is a larger editorial effort outside this PR's focused scope.
- The `check:truth` gate does NOT itself check for the "ShieldMcpClient not yet instantiated" string — the stale-claim correction was a manual honesty pass (the truth-check catches quantitative drift + prohibited overclaims, not prose-level staleness). This is a gap worth noting: prose staleness after a capability ships relies on the PR author updating the README, which PR F did for PR E's closures.
