# Production Canary Plan — Phase 13 (PR G)

**Status: PLAN + SAFE LOCAL DRY-RUN ONLY. The live production canary is a NAMED STOP — it requires production credentials not available in this session (managed Postgres `DATABASE_URL`, `OPENAI_API_KEY` or `GEMINI_API_KEY`, `EVIDENCE_SIGNING_SECRET`, and an Ed25519 `SHIELD_SIGNING_KEY`/`SHIELD_VERIFICATION_KEY` keypair). This document is the executable runbook an owner with those credentials follows, plus the safe non-destructive dry-run that needs none of them.**

**Owner input requested:** see §5 — the four credential grants + the go/no-go decisions only an owner can make.

This plan covers the four env-blocked, not-fake-passed items named across PR E + the truth audit:

1. **Measured learning impact in production** — the live 12-step E2E + Cloud Run deploy gate that proves the HyperAgent self-learning loop actually improves outcomes against a real LLM (integration-graph-proven today, NOT production-proven).
2. **Live `executeApprovedSpec` E2E** — the REVIEWER-gated API route + service exist; the live LangGraph + LLM round-trip is env-blocked.
3. **Brain MCP + Shield MCP canaries in a live process** — both are default-off (`BRAIN_MCP_SERVER=1`, `SHIELD_MCP_CANARY=1`); neither has run against live traffic.
4. **Audit-chain + merge atomicity under live Postgres concurrency** — proven against a pgvector testcontainer; not yet exercised against the managed Postgres the production deployment uses.

Every canary here is **default-off, opt-in, reversible, and observable**. None auto-promotes. None deletes company truth. None enables self-learning globally without a canary (the config-lifecycle gate enforces SHADOW→CANARY→PROMOTED; no skip).

---

## 1. Canary flag inventory (verified against source)

| Flag | Default | What it activates | Where proven |
|:-----|:--------|:------------------|:-------------|
| `hyperAgentEnabled` | `false` (110 refs) | The HyperAgent self-learning + repair half inside the live LangGraph graph (`hyperAgentActive(state)` gate) | integration-graph-proven (`hyperagent-spec-execution.test.ts`, learning-impact integration tests) |
| `JAK_ADK_MODE` | unset (off) | ADK `SequentialAgent`/`ParallelAgent` orchestration path | ADK parity tests |
| `BRAIN_MCP_SERVER` | unset (off) | In-process Brain MCP server (`brain_*` tools registered) + `/company`+`/company/graph` reachable from agents | `tests/unit/tools/brain-mcp-server.test.ts` (17) |
| `SHIELD_MCP_CANARY` | unset (off) | ShieldMcpClient live instantiation — records signed Ed25519 decisions to the audit chain (observational, does NOT gate execution) | `tests/integration/shield-mcp-live-audit.test.ts` (3, real Postgres) |
| `BENCHMARKS_PERSISTED` | `false` | Persist benchmark evaluation results | benchmark harness |

All five are off by default. Production today runs with **none** of them set → byte-for-byte the legacy bounded-retry path, no Brain MCP server, no Shield canary. The canary sequence below turns them on one at a time, behind the smallest possible blast radius, with a kill switch for each.

---

## 2. Safe non-destructive dry-run (NO production credentials needed)

This is what was verified locally in this session. It exercises every canary flag against a **local pgvector testcontainer** (Docker) with a **deterministic stub `runPlan`** — no OpenAI/Sarvam key, no managed Postgres, no live traffic. It is the regression floor the live canary must not drop below.

```bash
# 1. Bring up a throwaway Postgres + pgvector (testcontainers does this in-process;
#    or manually for a longer-lived check):
docker run -d --name jak-canary-pg -e POSTGRES_PASSWORD=test -p 5433:5432 pgvector/pgvector:pg16

# 2. Migrate + seed against it.
DATABASE_URL=postgresql://postgres:test@localhost:5433/jak_swarm \
  pnpm --filter @jak-swarm/db db:migrate:deploy
DATABASE_URL=postgresql://postgres:test@localhost:5433/jak_swarm \
  pnpm seed:compliance

# 3. Generate a throwaway Ed25519 Shield keypair (DO NOT reuse in prod).
node -e "import('@jak-swarm/security').then(m => console.log(JSON.stringify(m.generateShieldKeyPair())))"

# 4. Run the canary-flag integration suites with the flags ON + the keypair set:
BRAIN_MCP_SERVER=1 SHIELD_MCP_CANARY=1 \
SHIELD_SIGNING_KEY="<privateKeyPem above>" \
SHIELD_VERIFICATION_KEY="<publicKeyPem above>" \
EVIDENCE_SIGNING_SECRET="$(openssl rand -base64 48)" \
DATABASE_URL=postgresql://postgres:test@localhost:5433/jak_swarm \
  pnpm vitest run integration --exclude '**/circuit-breaker.test.ts' --exclude '**/truth-claims.test.ts'

# 5. Confirm the audit-chain concurrency + merge atomicity suites pass against
#    the SAME Postgres (they are the durable-fix proofs):
DATABASE_URL=postgresql://postgres:test@localhost:5433/jak_swarm \
  pnpm vitest run integration/audit-chain-concurrency.test.ts \
              integration/company-brain-merge-atomicity.test.ts \
              integration/shield-mcp-live-audit.test.ts
```

**Expected (verified in this session):** all green. Audit-chain: concurrent appenders → no duplicate seq, no fork, `verifyChain` valid. Merge: atomic rollback on mid-merge failure → no partial state. Shield: ALLOW + BLOCK signed decisions chain-joined + verifiable; `requestHash` binds the scanned text. Brain MCP: 4 tools registered, cross-tenant escape blocked.

This dry-run is the **go/no-go gate for §3**: if any of it is red against a fresh local Postgres, the live canary does not proceed.

---

## 3. Live production canary sequence (REQUIRES OWNER CREDENTIALS — STOP)

Each stage is independently reversible. Do not advance to the next until the previous has been green for the stated observation window. The operator is a human (TENANT_ADMIN+); the agent never self-promotes.

### Stage 0 — Provision + verify credentials (owner)

```bash
# Managed Postgres (the production DB the Cloud Run API already uses).
# Confirm DATABASE_URL points at the managed instance with pgvector enabled.
gcloud run services describe jak-swarm-api --region asia-south1 \
  --format="value(spec.template.spec.containers[0].env)"

# LLM key — set ONE of:
#   OPENAI_API_KEY  (GPT-5.5/5.4)
#   GEMINI_API_KEY  (Gemini 2.5 Pro/Flash/Flash-Lite)  + optional GEMINI_GOOGLE_SEARCH_GROUNDING=1
# Audit chain signing:
#   EVIDENCE_SIGNING_SECRET="$(openssl rand -base64 48)"
# Shield Ed25519 keypair — generate ONCE, store in Secret Manager, do NOT commit:
node -e "import('@jak-swarm/security').then(m => console.log(JSON.stringify(m.generateShieldKeyPair())))"
#   SHIELD_SIGNING_KEY=<privateKeyPem>   SHIELD_VERIFICATION_KEY=<publicKeyPem>
```

**Go/No-go:** all five secrets present in Secret Manager + mounted into the Cloud Run API service. If any is missing, STOP — do not improvise a key.

### Stage 1 — Audit-chain + merge atomicity against managed Postgres (non-destructive)

**Blast radius: zero user traffic.** This stage only confirms the PR E durable fixes behave against the managed instance's actual concurrency/latency, not a testcontainer.

- Run the audit-chain concurrency + merge atomicity suites pointed at a **staging schema** on the managed instance (NOT the live prod schema — create `jak_swarm_canary` and migrate it).
- Observation window: one pass. Green = proceed. Red = file an incident; the TOCTOU/atomicity fixes are NOT production-viable on this instance until explained.

### Stage 2 — Shield MCP observational canary (default-off, records only)

Set `SHIELD_MCP_CANARY=1` + the Ed25519 keypair on the **staging** Cloud Run API service only.

- This RECORDS signed `SHIELD_DECISION_SIGNED` rows into the audit chain for every workflow goal scan. It does NOT gate execution (a BLOCK verdict is logged at WARN, the workflow still runs).
- Observation window: 24h of staging traffic.
- **What to look for:** audit rows are chain-joined + `verifyChain`-valid; no signature-verify failures (a verify failure = fail-closed refusal = investigate key mismatch); no audit-sink exceptions taking down workflows (`recordShieldDecisionToAudit` never throws, but confirm).
- **Kill switch:** unset `SHIELD_MCP_CANARY`. No data to roll back — the rows are append-only audit evidence.

### Stage 3 — Brain MCP server canary (default-off, in-process)

Set `BRAIN_MCP_SERVER=1` on the **staging** service. Confirm `NODE_ENV !== 'test'` (the boot guard).

- The 4 `brain_*` tools register in the JAK `toolRegistry` and become reachable from agent runs. Tenant identity is sourced from the authenticated `ToolExecutionContext` (never tool args).
- Observation window: 24h. Drive a handful of agent runs that call `brain_get_graph` / `brain_get_entity` (READ_ONLY, no approval) under a real tenant.
- **What to look for:** tools resolve + return the tenant's own graph; a `tenantId` supplied in tool args is ignored (cross-tenant escape blocked); governed writes (`brain_merge_entities`, `brain_decide_claim`) require approval and are NOT auto-applied.
- **Kill switch:** unset `BRAIN_MCP_SERVER` + call `brainMcpRegistration.disconnect()` (wired into graceful shutdown — redeploy without the flag).

### Stage 4 — `executeApprovedSpec` live E2E (one REVIEWER-approved spec)

- Create an `agent_executable_spec` with a tiny, non-destructive plan (e.g. "summarise this document and store the summary as an artifact"). Advance it to APPROVED via the REVIEWER-gated route.
- `POST /company/specs/:id/execute` → materialise → run (real LLM) → harvest → acceptance verdict → resolved drift.
- Observation window: one execution.
- **What to look for:** the spec runs to `completed`, the artifact is harvested with provenance, the drift finding (if any) is resolved. The LLM key is exercised for the first time in this closed loop.
- **Kill switch:** the spec is REVIEWER-gated; do not approve another. Roll back the ConfigVersion if a learning promotion fired (Stage 5).

### Stage 5 — HyperAgent self-learning canary (the env-blocked headline)

This is the item that requires the **most** discipline: it is the "never enable self-learning globally without a canary" constraint.

- Use the **config-lifecycle gate** (PR D): create a DRAFT `ConfigVersion` of kind `AUTONOMY_POLICY` or `REPAIR_BUDGET`, advance DRAFT→PROPOSED→SHADOW (no traffic) → CANARY at **1% ramp** (not 100%). The gate refuses a skip.
- Set `hyperAgentEnabled=true` for the CANARY tenant only (per-tenant, not global).
- Observation window: 7 days at 1%. Look for: measured mutual-information learning signal (the MI gate must clear before any promotion), no regression in acceptance rates, no unpermitted/cyclic plans from the symbolic replanner, Shield fail-closed still behaves.
- **Promotion:** only a human TENANT_ADMIN advances CANARY→PROMOTED after reviewing the MI signal + acceptance delta. The agent may not self-promote. A safety-incident breach ⇒ immediate ROLLBACK (the gate does this automatically).
- **Kill switch:** `POST /hyperagent/experiments/:id/rollback` + unset `hyperAgentEnabled` for the tenant. The PROMOTED config is superseded (ARCHIVED), not deleted.

### Stage 6 — Persisted benchmark evaluation (optional, last)

Set `BENCHMARKS_PERSISTED=true` + run `pnpm bench:search` (or the ADK eval harness) with real keys against staging. This produces the linked benchmark report that unblocks the "Nx cheaper"-style marketing claims the truth-check currently prohibits. Not a safety canary — a marketing-truth canary.

---

## 4. What this canary sequence does NOT do (honest boundaries)

- It does **not** wire the external JAK Shield MCP network *transport* (`JAK_SHIELD_MCP_URL`). The local embedded Shield is live from Stage 2; the remote-transport seam remains roadmap.
- It does **not** expose `getContextPackage` as a Brain MCP tool — the agentRole-escalation guard stands (PR E deliberate exclusion).
- It does **not** gate execution on a Shield BLOCK. Stage 2 is observational; turning a Shield BLOCK into an execution gate is a separate fail-closed policy decision that needs its own canary.
- It does **not** prove the Phase 11 rich merge-comparison UI (evidence drawer, conflict queue, impact chains) — that UI is roadmap; only the nav reachability shipped.
- It does **not** deploy the Cloud Run Worker (`jak-swarm-worker` Dockerfile + Cloud Build config exist; the cutover is a separate deploy task).

---

## 5. Owner input requested (the STOP)

To proceed past the §2 dry-run into §3, the owner must provide:

1. **Credential grants** — confirmation that the five secrets (managed `DATABASE_URL`, `OPENAI_API_KEY` *or* `GEMINI_API_KEY`, `EVIDENCE_SIGNING_SECRET`, `SHIELD_SIGNING_KEY`, `SHIELD_VERIFICATION_KEY`) are provisioned in Secret Manager + mounted into the staging Cloud Run API service. I will not generate or assume any production key.
2. **A staging environment** — a Cloud Run API revision + a `jak_swarm_canary` schema on the managed Postgres that is NOT the live prod schema. (Production traffic must not be touched by Stage 1–5.)
3. **Go/no-go for Stage 5 specifically** — the self-learning canary is the highest-blast-radius step. The owner must explicitly approve a 1%-traffic, 7-day, human-promote-only canary on a named tenant before `hyperAgentEnabled` is set for that tenant.
4. **A second pair of eyes on the Shield keypair** — the Ed25519 signing key is the tamper-evidence root for every `SHIELD_DECISION_SIGNED` row. The owner should generate + store it (not me), and confirm the public verification key is the one mounted.

Until those are in hand, the live canary does not start. The §2 dry-run + this plan + the integration hardening milestone report (`docs/mandate-completion-report.md`) are the deliverables this session can produce for Phase 13.