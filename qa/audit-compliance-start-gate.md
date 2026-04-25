# Audit & Compliance product — start gate

**Date:** 2026-04-25
**Purpose:** Decide whether the JAK Swarm core orchestration is mature enough to begin building the Audit & Compliance product on top of it. The Audit & Compliance product needs each of the dependencies below to be **real**, not cosmetic.

**Verdict:** **PARTIALLY READY — block on items #4, #5, #6 until they're real.**

The cockpit + workflow runtime work in this hardening pass closed several silent gaps, but a few load-bearing pieces of the Audit & Compliance value proposition still depend on infrastructure that hasn't been built (export, evidence handling) or hasn't been live-verified (approval pause/resume + tool outcome propagation in production).

## Per-dependency gate

| # | Dependency | Status | Blocker / next action |
|---|---|---|---|
| 1 | Real event stream | **READY** | SSE wiring traced end-to-end; `paused` event gap fixed in this pass. The 8 SSE event types (connected/started/plan_created/worker_started/tool_called/tool_completed/cost_updated/completed/failed/paused) all originate from real backend code paths. See `qa/agent-run-cockpit-realness-audit.md`. |
| 2 | Real graph / DAG visibility | **READY** | WorkflowDAG renders ONLY when `plan_created` (real backend event) populates the cockpit. Empty / missing-plan state shows "Waiting for the planner to publish a plan…" — no fake nodes. |
| 3 | Real workflow runtime | **READY (narrow)** | `WorkflowRuntime` interface routes resume + cancel through SwarmGraphRuntime. The start path still uses direct `runner.run()` because extending StartContext with all the existing callbacks is invasive enough to warrant its own follow-up. Acceptable for Audit & Compliance because the audit log doesn't care which path started a workflow, only what happened during it. |
| 4 | Real approval pause / resume | **PARTIALLY READY** | Pause now emits SSE (this pass) and resume routes through WorkflowRuntime (Phase 6). **What's missing:** integration test confirming the round-trip pauses → reviewer approves → workflow continues from saved checkpoint without re-running completed tasks. Documented as scenario #10 in `qa/benchmark-results-openai-first.md`. **BLOCKER if Audit & Compliance needs reliable approval audit trail.** |
| 5 | Real file / evidence handling | **NOT READY** | Audit & Compliance value prop = "every action has an attached, exportable evidence trail." The current `agentTrace` table captures input/output/tool calls but does NOT package them into a customer-deliverable evidence bundle. No code exists for: evidence export format (PDF? signed JSON?), per-control evidence bundling, time-windowed export, redaction. **BLOCKER. New product surface.** |
| 6 | Real export / artifact system | **NOT READY** | Same gap as #5. Today the only "export" is `GET /workflows/:id/output` which returns the final markdown — useful but not an audit artifact. Audit & Compliance needs: signed JSONL export, evidence bundle ZIP, scheduled exports to S3/GCS, per-tenant retention policy. **BLOCKER. New product surface.** |
| 7 | Real OpenAI runtime | **READY** | `/version` confirms `effectiveExecutionEngine: openai-first`. ModelResolver verified against `/v1/models`. Provider router puts OpenAI first at every tier. See `qa/openai-first-live-verification.md`. |
| 8 | No fake tool success | **READY (after this pass)** | `ToolOutcome` enum (`real_success / draft_created / mock_provider / not_configured / blocked_requires_config / failed`) propagated end-to-end: tool registry → ToolResult → BaseAgent emit → SSE → cockpit. Mock email/calendar adapters now throw NotConfigured on writes; the registry classifies outcome honestly. Cockpit renders distinct icons per outcome (no longer guesses from substrings). |

## What this means for Audit & Compliance product start

**Safe to begin (parallel with the remaining hardening):**

- Audit query UI (read-only views on existing `agentTrace` + `auditLog` tables)
- Compliance dashboards (counts, success rates, approval-decision pivots)
- Per-tenant audit log filters and search

**NOT safe to begin until #4, #5, #6 close:**

- Customer-deliverable evidence bundles (#5 + #6)
- Auto-generated control attestations (#5)
- Evidence export to customer S3 buckets (#6)
- Approval-trail audit reports (#4 — needs the round-trip integration test passing first)
- Anything that promises "every approval is auditable" or "every tool call is exportable" — those are claims that fail #5/#6 today

**Recommendation:** scope the Audit & Compliance v0 to the read-only audit UI + compliance dashboards above. Treat evidence export as a v1 milestone gated on #5 + #6 being implemented and #4 being load-tested.

## Next concrete steps to close the blockers

1. **Close #4 (approval round-trip)** — write an integration test in `tests/integration/` that:
   - creates a workflow that triggers an approval gate
   - asserts DB `workflow.status === 'PAUSED'` and an approval row exists
   - POSTs `/approvals/:id/decide` with APPROVED
   - asserts the workflow continues to COMPLETED
   - asserts no completed tasks were re-run

2. **Close #5 (evidence handling)** — design doc first, no code yet:
   - what's an "evidence bundle"? (zip of: workflow.json + agentTraces[].json + approvals[].json + final output)
   - signing strategy (HMAC with tenant-scoped key? full PKI?)
   - storage (Postgres bytea? S3 with signed URL?)
   - retention (per-tenant policy column on tenant table)
   Implement after design is approved.

3. **Close #6 (export / artifact system)** — depends on #5 design.
   - export endpoint: `GET /audit/export?from=&to=&format=jsonl|zip` returning signed bytes
   - scheduled-export job: cron-like reading tenant export config and pushing to customer S3
   - redaction: PII detection (already in `@jak-swarm/security`) integrated into export pipeline

Until #4, #5, #6 are real, the Audit & Compliance product can ship but **must not market** features that depend on them.
