# Agent Run Cockpit — verification (commit 769e358 baseline)

The cockpit is the live-view component that surfaces backend execution to the end user. The user's spec asks it to show real, backend-driven data covering 26 distinct event types.

## What actually exists today

### Canonical lifecycle vocabulary

[packages/swarm/src/workflow-runtime/lifecycle-events.ts](../packages/swarm/src/workflow-runtime/lifecycle-events.ts) defines two layers:

- **Workflow-level events** (13 canonical): `created`, `planned`, `started`, `step_started`, `step_completed`, `step_failed`, `approval_required`, `approval_granted`, `approval_rejected`, `resumed`, `cancelled`, `completed`, `failed`.
- **Agent activity events** (3): `tool_called`, `tool_completed`, `cost_updated` (defined in [packages/agents/src/base/agent-context.ts:12-39](../packages/agents/src/base/agent-context.ts)).
- **Audit-pack lifecycle** (13 added in [audit-run.service.ts](../apps/api/src/services/audit/audit-run.service.ts)): `audit_run_started`, `audit_plan_created`, `evidence_mapped`, `control_test_started`, `control_test_completed`, `exception_found`, `workpaper_generated`, `reviewer_action_required`, `final_pack_started`, `final_pack_generated`, `audit_run_completed`, `audit_run_failed`, `audit_run_cancelled`.

**Total events emitted today: ~29** (across both layers).

### Cockpit consumer

[apps/web/src/components/chat/ChatWorkspace.tsx](../apps/web/src/components/chat/ChatWorkspace.tsx) consumes the SSE channel `workflow:{id}` (route: `GET /workflows/:id/stream`) and renders:
- Live activity stream
- Agent role chips (with `agentRole`)
- Tool call rows with `ToolOutcome` chips (real_success / draft_created / mock_provider / not_configured / blocked_requires_config / failed)
- Cost ribbon (model, runtime, tokens, USD)
- Approval cards
- Plan + step list
- DAG (read-only, derived from plan + statuses — see Graph verification doc)

Backend events drive everything in this list. There are NO frontend-only synthetic events.

## Per-spec-event coverage

| Spec event | Today's status | Real-emitter file:line |
|---|---|---|
| `run_started` | ✅ via `created` + `started` | [swarm-execution.service.ts:717-718](../apps/api/src/services/swarm-execution.service.ts) |
| `intent_detected` | ❌ NOT EMITTED (Commander runs but no event of this name; the `MissionBrief` is in trace, not as a named event) | — |
| `clarification_required` | ❌ NOT EMITTED (Commander returns `clarificationNeeded=true`; UI surfaces it via the brief, but no named event) | — |
| `clarification_answered` | ❌ NOT EMITTED | — |
| `workflow_selected` | ❌ NOT EMITTED (workflow type isn't a separate concept; Planner just builds a plan) | — |
| `plan_created` | ✅ via `planned` | swarm-execution.service.ts |
| `agent_assigned` | ❌ NOT EMITTED (agentRole is on `step_started` instead — implicit) | — |
| `step_started` | ✅ | swarm-execution.service.ts |
| `tool_called` | ✅ | base-agent.ts (per-tool emit) |
| `tool_completed` | ✅ with `ToolOutcome` enum | base-agent.ts |
| `artifact_created` | ✅ implicit via `step_completed` (artifact id in event details) | artifact.service.ts |
| `approval_required` | ✅ | swarm-execution.service.ts + approval-node.ts |
| `approval_granted` | ✅ | approvals.routes.ts |
| `approval_rejected` | ✅ | approvals.routes.ts |
| `step_completed` | ✅ | swarm-execution.service.ts |
| `step_failed` | ✅ | swarm-execution.service.ts |
| `verification_started` | ❌ NOT EMITTED (Verifier runs as a step, emitted as `step_started` with `agentRole='VERIFIER'` — implicit) | — |
| `verification_completed` | ❌ NOT EMITTED (same — implicit via `step_completed`) | — |
| `run_completed` | ✅ via `completed` | swarm-execution.service.ts |
| `run_failed` | ✅ via `failed` | swarm-execution.service.ts |
| `company_context_loaded` | ❌ NOT EMITTED (no Company Brain — see [company-brain-verification.md](company-brain-verification.md)) | — |
| `company_context_used_by_agent` | ❌ NOT EMITTED | — |
| `company_context_missing` | ❌ NOT EMITTED | — |
| `company_memory_suggested` | ❌ NOT EMITTED (no MemoryItem.status — see Brain doc) | — |
| `company_memory_approved` | ❌ NOT EMITTED | — |
| `company_memory_rejected` | ❌ NOT EMITTED | — |

**Coverage:** 11 of 26 spec events are emitted today (43%). 9 are blocked on Company Brain not being built (events 21-26 + 17-18). 6 are implicit (covered by existing events like `step_started`/`step_completed` with `agentRole` field) but not surfaced as named events the cockpit can switch on.

## Other cockpit-relevant events that DO exist (not in the 26-list)

- **All 13 audit-pack events** (`audit_run_started`, `control_test_completed`, `workpaper_generated`, `final_pack_generated`, etc.) — fully wired through `fastify.swarm.emit('audit_run:{id}', ...)` ([audit-runs.routes.ts](../apps/api/src/routes/audit-runs.routes.ts)).
- `cost_updated` per LLM call with model, runtime, tokens, USD breakdown.
- `tool_called` / `tool_completed` per tool invocation with the honest `ToolOutcome` enum.

## What the cockpit shows from REAL backend state

| UI element | Backed by |
|---|---|
| Run timeline | SSE channel `workflow:{id}` |
| Agent chips | `agentRole` field on every step event |
| Tool calls + outcome chips | `tool_called` / `tool_completed` events with `ToolOutcome` enum from tool registry |
| Cost ribbon | `cost_updated` events from BaseAgent + per-run aggregate from `Workflow.totalCostUsd` |
| Plan / step list | `WorkflowPlan` + `WorkflowTask` Prisma rows (refreshed via SSE `step_*` events) |
| Approval cards | `ApprovalRequest` Prisma rows + `approval_*` events |
| Final output | `Workflow.finalOutput` (Markdown) — from real Verifier sign-off |
| DAG | Derived from `WorkflowPlan.tasks` + statuses (READ ONLY — see Graph doc) |
| Agent activity | `tool_called` + `tool_completed` + `cost_updated` (real-time) |

**No fake frontend-only events. No cosmetic cards backed by nothing.** Every UI element is wired to a backend source.

## What's MISSING (would close the spec gap)

| Gap | Effort | Blocker on |
|---|---|---|
| Add 8 named events: `intent_detected`, `clarification_required`, `clarification_answered`, `workflow_selected`, `agent_assigned`, `verification_started`, `verification_completed`, plus the 6 company_context_* and company_memory_* events | ~3-5 days for the first 7 (just naming + emit calls); ~1 week for the 6 company_* events (depends on Brain shipping) | Company Brain (#5-6 of those) |
| Add `agent_assigned` as its own event (vs. inferring from `step_started.agentRole`) | ½ day | — |
| Live SSE on `/audit/runs/[id]` page (cockpit polls every 15s today) | ~1 day | — (backend channel exists) |

## Verdict: PARTIAL_BUT_HONEST

11/26 spec events emitted today. The remaining 15 are either:
- **Implicit and could be made explicit** with named events (~3-5 days for 7 events) — these aren't faked, they're just coarser-grained.
- **Blocked on Company Brain not existing** (6 events) — see [company-brain-verification.md](company-brain-verification.md).

What works is real (no fake events, every UI element backed by backend state). What's missing is missing — clearly named, not pretended.
