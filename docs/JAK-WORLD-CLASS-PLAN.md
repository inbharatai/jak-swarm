# JAK Swarm -- World-Class Company Brain + Accurate Hyperagents

> Planning document only. No code changes were made to produce this.
> Audited commit: main HEAD after PR 1 / PR 2 (f619629 / 45d0f1b).
> Method: read-only trace of README, AGENTS.md, the AgentRole enum, product-truth.ts, the Company Brain services, the Hyperagent pure core + live seam, and docs/current-runtime-truth.md. Every finding is grounded in a file path.

## 0. The one-sentence verdict

JAK Swarm is the most honest agent platform I have audited, and that is exactly why it is not yet a world-class company brain. Every claim is truth-gated, but the two flagship engines the README leads with (Company Brain and the Hyperagent) are both half-live. The numbers are accurate: 38 agents, 122 tools, 22 connectors, and 3157 CI tests are all source-enforced. The capability depth behind those numbers is where the gap to world-class lives.

---

## 1. What is accurate (verified against source)

| Claim | Source of truth | Verdict |
|---|---|---|
| 38 agents | AgentRole enum in packages/shared/src/types/agent.ts (6 orchestrators + 11 core + 8 executive + 8 ops + 5 vibe = 38) | Accurate |
| 122 classified tools | toolRegistry.register count, CI-enforced by pnpm check:truth | Accurate |
| 22 connectors | INTEGRATIONS_CORE (13) + INTEGRATIONS_INFRA (9) in apps/web/src/lib/product-truth.ts | Accurate |
| Beta 0.1.0-beta.0, not production-ready | README blunt beta truth | Accurate, honestly stated |
| Per-tenant email / calendar / CRM resolver (PR 1 / PR 2) | adapter-factory.ts + tenant-connector-credentials.ts side-channel | Accurate, but only LIVE_RUNTIME_WIRED, not production-proven |
| HMAC per-tenant audit row-chain | migration 117, computeRowHash / verifyChain | Accurate, testcontainer-proven only |
| Hyperagent pure-core self-healing | spec-executor.ts (20-class classifier, counterfactual, symbolic replanner) | Accurate, integration-proven with a stub runPlan |
| Hyperagent governed self-learning gate | config-lifecycle.ts DRAFT to PROPOSED to SHADOW to CANARY to PROMOTED, MI gate, human approval | Accurate, wired but default-off and never run vs managed Postgres |

The repo culture of self-auditing (docs/current-runtime-truth.md re-traces every capability file:line) is genuinely rare. The plan below is built on top of that truth doc, not in opposition to it.

---

## 2. Inaccuracies, bugs, and half-live capabilities (the audit)

### 2.1 Documentation inaccuracy: AGENTS.md describes 17 of 38 agents

The repo AgentRole enum has 38 entries. AGENTS.md documents only the original 17 (6 orchestrators + 11 core workers) plus 6 audit-compliance service-backed roles. Twenty-one agent roles have no documented system instructions, input/output contracts, or handoff logic:

- 8 executive: WORKER_CODER, WORKER_DESIGNER, WORKER_STRATEGIST, WORKER_MARKETING, WORKER_TECHNICAL, WORKER_FINANCE, WORKER_HR, WORKER_GROWTH
- 8 operations: WORKER_CONTENT, WORKER_SEO, WORKER_PR, WORKER_LEGAL, WORKER_SUCCESS, WORKER_ANALYTICS, WORKER_PRODUCT, WORKER_PROJECT
- 5 vibe-coding: WORKER_APP_ARCHITECT, WORKER_APP_GENERATOR, WORKER_APP_DEBUGGER, WORKER_APP_DEPLOYER, WORKER_SCREENSHOT_TO_CODE

Each of these has a real .agent.ts file under packages/agents/src/roles, but the collaboration guide a new contributor reads is silent about them. The README badge 38 Agents is right; AGENTS.md is the doc that is wrong. This is the single largest documentation-vs-code drift in the project.

### 2.2 Hyperagent live seam returns empty artifacts (the headline engine is half-live)

spec-executor-runtime.ts (file header, lines 7-30) states explicitly: Artifact harvesting remains an OPEN EDGE: the real graph does not yet extract artifact ids from taskResults, so artifacts is [] and an ARTIFACT_PRESENT criterion will be UNMET unless the run explicitly produces one. Metrics are limited to accumulatedCostUsd.

Verified: the live seam returns artifacts: [] and metrics: { accumulatedCostUsd } only. failureClassByTask is computed inside the graph but never surfaced into FinishedRun (truth doc D1 ROADMAP, D2 ROADMAP, D3 PARTIAL). So the self-healing loop the README leads with can classify failures and replan in pure-core tests, but in the live runtime it cannot see what artifacts a run produced and cannot report why it failed. A self-healing engine that is blind to its own evidence is not yet a hyperagent.

### 2.3 Company Brain retrieval has no vector half (the brain is lexical-only)

README is honest about this. The gap is that a company brain claiming to ground agents in evidence uses only alias + stable-identifier ILIKE + ts_rank FTS + 1-hop graph expansion (company-brain-v2.context.ts:41, 153-171). There is no embedding similarity signal fused into the Brain context retrieval path. VectorDocument chunks are created by the crawler (crawler.service.ts) and the profile service reads them, so embeddings exist for uploaded/crawled docs, but the Brain multi-signal retrieval does not query them. pgvector is provisioned and unused by the retrieval path. There is also no temporal, authority, or confidence signal, and no reciprocal-rank fusion.

### 2.4 Connector ingestion is metadata-only (the brain is fed on snippets)

- Gmail (B1 PARTIAL): syncGmail fetches format=metadata with only Subject/From/Date headers plus the Gmail snippet. No body, no body HTML, no To/CC/BCC, no attachments. Dedupe is provider-ID only; bodyHash is computed but not used. A re-ingested message ID with a changed snippet overwrites in place.
- Drive (B2 PARTIAL): metadata-only, no content export, pagination capped at 100.
- GitHub (B3 PARTIAL): user-events stream only. No repos, issues, PRs, reviews, commits, releases, webhooks.

A company brain that runs its drift detector and spec generator on email snippets cannot extract the decisions, risks, owners, and deadlines that actually live in message bodies and code reviews. This is the depth ceiling on the entire Company Brain.

### 2.5 Connector-sync atomicity is non-atomic (A9 PARTIAL)

In company-connector-sync.service.ts the status check and the status write are two separate statements with no transaction, no SELECT FOR UPDATE, no conditional UPDATE WHERE status=idle, no advisory lock. The manual trigger POST /company/sync/:provider/trigger bypasses the scheduler inFlight + isLeader guards. Two triggers can both read status=idle, both create SyncRun rows, both fetch the same cursor window, and ingest duplicates. The stale-running safety net only reclaims after 45 minutes.

### 2.6 MCP reconnect is broken (A7 PARTIAL)

Encrypted MCP config is JSON.parsed directly, but the bytes are AES-GCM ciphertext. JSON.parse on ciphertext throws, which surfaces as NEEDS_REAUTH. An encrypted MCP connector cannot reconnect; it can only be reauthorized. This is a latent bug, not just a roadmap item.

### 2.7 Provenance and identity gaps in the Brain (C1 PARTIAL, C2 ROADMAP)

No human_approved / evidence_backed / expired artifact states. Source-less V2 entities can enter agent context. There is no CompanyEntityIdentifier model; matching is properties::TEXT ILIKE, which is fuzzy and leaky. Stable identifiers (emails, GitHub handles, external IDs) are not indexed, so the same person can be split or merged incorrectly.

### 2.8 Claims are untyped with one universal threshold (C4 PARTIAL, C5 UNIT_PROVEN)

Claims are stored as untyped JSONB with one universal confidence threshold. There is no per-predicate policy (a deadline claim and a vibe claim should not need the same confidence bar). Source authority is global hardcoded constants, not per-tenant or per-predicate. A claims graph with no per-predicate policy cannot be the canonical company brain.

### 2.9 No accuracy benchmark for the Brain (C6 ROADMAP)

There is no precision / recall / F1, false-merge, missed-merge, P@K, or access-leakage harness. Without a benchmark, world-class company brain is an assertion, not a measurement. Every other system in the repo is truth-gated; the brain own accuracy is the one thing that is not.

### 2.10 Access control is flat (E1)

user / department / project / team / group / ACL / purpose / region / sensitivity are not modeled. Cross-department inference-leakage is untested. A company brain that surfaces a confidential legal claim to an END_USER is a compliance incident, not a feature.

### 2.11 No live production canary (D5 / F3 ROADMAP, named stops)

Everything stops at integration-graph-proven. There is no managed-Postgres plus real-LLM 1-percent-traffic 7-day learning canary. There is no third-party security audit, no SOC 2 attestation, no lawyer-reviewed ToS / Privacy Policy / DPA. The README says this honestly; it remains the gating stop for any production-ready claim.

### 2.12 The truth checker itself is shallow (G1 PARTIAL)

check-docs-truth.ts only checks numeric/phrase drift against the registry. It does NOT verify live-runtime callership, connector contract-test passage, canary evidence for production-proven claims, placeholder-counted-as-ready mislabeling, or source-path existence. Every file read is wrapped in try/catch that silently skips missing paths. So accurate claims can still drift, and a capability with no live caller passes the gate. For a world-class brain, the truth checker must be as rigorous as the brain.

### 2.13 External JAK Shield MCP is not wired (roadmap)

The enforced gateway inside JAK Swarm today is the embedded local one (packages/security). The MCP network transport to the external 10-stage signed-decision Shield is a roadmap item. ShieldMcpClient is an observational canary that records signed decisions to the audit chain but does NOT gate execution. So the trust gateway the README headlines is local policy logic, not the signed-decision pipeline.

### 2.14 Deployment tools are not per-tenant (A3)

Deployment tools read process.env inline with no per-tenant resolver, unlike the email/calendar/CRM resolvers that PR 1 / PR 2 added. A tenant cannot bring its own deploy credentials.

---

## 3. What world-class company brain + accurate hyperagents means (acceptance criteria)

These are measurable, not aspirational. A capability counts only when the truth checker can fail CI on its absence.

### Brain (the company brain)
1. Deep evidence: every auto-sync connector ingests full content (Gmail bodies/threads/attachments/recipients; Drive content export with pagination; GitHub repos/issues/PRs/reviews/commits). Body-hash dedupe, not provider-ID-only.
2. Structured provenance: artifact state machine (raw, human_approved, evidence_backed, expired); source-less entities are gated out of agent context; no source-less claim may influence a workflow.
3. Stable identity: CompanyEntityIdentifier model with indexed normalized lookup replaces properties::TEXT ILIKE. Same-person merge/split is explicit and reviewable.
4. Typed claims + per-predicate policy: typed value discriminator; per-predicate confidence thresholds and source-authority weights are per-tenant.
5. Hybrid retrieval: vector similarity (pgvector) + lexical (ts_rank) + graph + temporal + authority + confidence, fused by reciprocal-rank fusion. The Brain context path queries VectorDocument chunks it already creates.
6. Accuracy benchmark: a CI harness measuring precision, recall, F1, false-merge rate, missed-merge rate, P@K, and access-leakage against a held-out tenant corpus. The brain is not world-class until it has a number and a regression gate.
7. Scoped access: user/dept/project/team/group/ACL/purpose/region/sensitivity enforced at retrieval, with inference-leakage tests in CI.

### Hyperagents (self-healing + self-learning)
1. Live seam wired: artifact ids harvested from taskResults into FinishedRun; failureClassByTask and richer metrics surfaced. An ARTIFACT_PRESENT acceptance criterion can actually pass in the live runtime.
2. Real replanner in the live graph: the dead/removed replanner is replaced by a wired, OFF-gated, autonomy-gated re-plan node that the Verifier can invoke after bounded retry is exhausted. Default workflows stay byte-for-byte unchanged.
3. Measured learning: a 1-percent-traffic 7-day canary against managed Postgres + real LLM, with a measured mutual-information learning signal and a human TENANT_ADMIN promotion gate. Not integration-graph-proven, production-proven.
4. Safety floor: destructive / permission / approval-timeout failures never auto-retried; the autonomy L0-L5 NEVER-set is unbypassable; the security floor cannot be downgraded by learning.
5. External Shield gating: high-risk actions route through the external JAK Shield MCP for signed decisions; fall back to local policy only if Shield is unavailable, and that fallback is audited.

### Trust and production
1. Third-party SOC 2 attestation started; ToS / Privacy Policy / DPA lawyer-reviewed.
2. Connector health contract: a unified authenticated / reachable / permissionStatus / lastSuccessfulCallAt / maturity runtime surface for all 22 connectors, not just GitHub/Gmail/Drive.
3. Sync atomicity: advisory-lock or conditional UPDATE WHERE status=idle on (tenantId, provider, running); manual trigger respects the same guards as the scheduler.
4. MCP reconnect: decrypt through crypto.ts before JSON.parse; reconnect contract test.
5. Truth checker v2: fails on no-live-caller, live-no-contract, production-proven-no-canary, placeholder-counted-as-ready, and source-path-missing.

---

## 4. The plan (sequenced, dependency-ordered, no code)

This sharpens the existing 14-PR sequence in docs/current-runtime-truth.md and the EVOLUTION-PLAN phases. It is grouped into tracks so progress is visible per engine. Each track lists its exit criterion (what makes it honestly done).

### Track A -- Make the two flagship engines actually live

A1. Wire the Hyperagent live seam. Harvest artifact ids from taskResults into FinishedRun via the pure-core evaluateOutcome path; surface failureClassByTask and richer metrics. Exit: an ARTIFACT_PRESENT acceptance criterion passes in the live runtime, not just pure-core.
A2. Wire a real, OFF-gated replanner node into the live LangGraph graph, invoked by the Verifier after bounded retry is exhausted, autonomy-gated (L2+ only), default workflows unchanged. Exit: a failing workflow that exhausts retries is re-planned and re-executed in the live graph behind hyperAgentEnabled.
A3. Wire ingest-to-Brain auto-enqueue (B4 ROADMAP): connector ingest automatically enqueues Brain processing, so deep evidence reaches the graph without a manual trigger. Exit: a synced Gmail thread produces entities/claims without a second manual step.

### Track B -- Deep evidence (the brain input ceiling)

B1. Deep Gmail: full body/threads/attachments/labels/recipients; body-hash dedupe. Replaces the metadata-only path.
B2. Deep Drive: content export + unbounded pagination.
B3. Deep GitHub: repos/issues/PRs/reviews/commits/releases/webhooks.
B4. Connector-sync atomicity (A9): advisory-lock claim or conditional UPDATE WHERE status=idle + unique index on (tenantId, provider, running); manual trigger respects leader/inFlight guards.
B5. MCP reconnect hardening (A7): decrypt through crypto.ts before JSON.parse; reconnect contract test.

Exit: the brain ingests full content atomically and reconnects encrypted connectors.

### Track C -- Brain structure and identity

C1. Provenance state machine (C1): raw/human_approved/evidence_backed/expired; gate source-less V2 entities out of agent context.
C2. CompanyEntityIdentifier (C2): indexed normalized lookup replacing properties::TEXT ILIKE; explicit reviewable merge/split.
C3. Typed claims + per-predicate policy (C4/C5): typed value discriminator; per-predicate confidence thresholds and source-authority weights, per-tenant.

Exit: every claim influencing a workflow is typed, source-cited, and confidence-gated by predicate.

### Track D -- Hybrid retrieval + the accuracy benchmark

D1. Vector retrieval fused into the Brain context path (C3): query the VectorDocument chunks the crawler already creates; add temporal + authority + confidence signals; reciprocal-rank fusion.
D2. Company Brain accuracy benchmark (C6): a CI harness over a held-out tenant corpus measuring precision/recall/F1, false-merge, missed-merge, P@K, access-leakage; regression-gated.

Exit: the brain has a measured accuracy number and a regression gate, like every other system in the repo.

### Track E -- Access control and connector health

E1. Scoped access (E1): user/dept/project/team/group/ACL/purpose/region/sensitivity at retrieval; inference-leakage tests in CI.
E2. Unified connector-health contract (A8): authenticated/reachable/permissionStatus/lastSuccessfulCallAt/maturity for all 22 connectors, not just the 3 sync providers.
E3. Per-tenant deployment tools (A3): a DeploymentAdapter interface + resolver mirroring email/calendar/CRM.

Exit: no confidential claim can leak across department/role boundaries; every connector has a live health badge backed by a real call.

### Track F -- Trust, governance, and production canary

F1. External JAK Shield MCP gating (EVOLUTION-PLAN Phase 11B): high-risk actions route through the external Shield for signed decisions; audited local-policy fallback.
F2. Truth checker v2 (G1): fail on no-live-caller, live-no-contract, production-proven-no-canary, placeholder-counted-as-ready, source-path-missing. The gate that enforces accuracy must itself be accurate.
F3. Live production canary (D5/F3, named stop): 1-percent-traffic 7-day learning canary against managed Postgres + real LLM, with measured MI signal and human promotion. Gated on owner production credentials.
F4. Third-party security audit start + lawyer-reviewed ToS/Privacy/DPA.

Exit: a PRODUCTION_PROVEN label exists only where a canary and a third-party attestation back it.

### Track G -- Documentation truth (the cheapest, highest-leverage fix)

G1. Rewrite AGENTS.md to cover all 38 agents: system instructions, input/output contracts, handoff logic, and risk classification for the 21 undocumented executive/operations/vibe roles. The AGENTS.md a contributor reads must match the AgentRole enum the CI enforces.
G2. Keep the two-engine framing, but make every half-live label machine-readable: each Brain/Hyperagent row in the README should link to the truth doc row it claims, and the truth checker v2 (F2) should cross-verify.

Exit: the collaboration guide and the README describe the same 38 agents at the same depth, and CI fails if they drift.

---

## 5. Sequencing and named stops

Build order (each step prerequisite is the seam it writes into):

1. G1 first -- zero-risk, fixes the largest doc drift, unblocks onboarding.
2. B4 + B5 -- atomicity and MCP reconnect are latent bugs; fix before any deeper ingestion so the deep-evidence work is not built on a racing, non-reconnecting base.
3. B1/B2/B3 -- deep evidence feeds everything downstream in the brain.
4. A3 -- auto-enqueue so deep evidence reaches the graph.
5. C1/C2/C3 -- provenance, identity, typed claims structure the now-deep evidence.
6. D1/D2 -- hybrid retrieval and the benchmark turn the structured evidence into a measured brain.
7. A1/A2 -- the Hyperagent live seam and real replanner make self-healing actually live on top of the now-rich brain.
8. E1/E2/E3 -- scoped access and connector health.
9. F1/F2 -- external Shield gating and truth checker v2.
10. F3/F4 -- the production canary and third-party attestation (named stops, gated on owner production credentials).

PRs 1-9 plus G1 are buildable with local + contract-test proof this session. F3 and the live-provider portion of F4 are named stops: they require managed Postgres, real LLM keys, real provider credentials, EVIDENCE_SIGNING_SECRET, and an Ed25519 Shield keypair, all owned by the human owner. No PRODUCTION_PROVEN label is claimed until those run.

---

## 6. What this plan deliberately does not do

- It does not add new agents. The roster is 38 and CI-enforced; the gap is depth and wiring, not breadth.
- It does not chase the ADK/LangGraph dual-runtime parity beyond what Track A requires. ADK is additive; the live seam is the priority.
- It does not promise a date for SOC 2 or the canary. Those are owner-credential-gated named stops, and claiming otherwise would undo the honesty that makes this repo worth building on.

The shortest path to world-class company brain with accurate hyperagents is not more agents or more tools. It is: deep evidence into a structured, identity-stable, typed-claim, hybrid-retrieval brain with a measured accuracy gate; a Hyperagent whose live seam is wired and whose replanner is real; and a truth checker strict enough that the README can never again outrun the runtime.
