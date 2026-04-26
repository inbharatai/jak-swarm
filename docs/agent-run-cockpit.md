# Agent Run Cockpit

The cockpit (`ChatWorkspace.tsx`) is the live SSE feed shown next to a workflow conversation. It renders 13 canonical lifecycle events plus the audit-specific event vocabulary added in this pack.

## Event vocabulary

### Workflow lifecycle (13 canonical, pre-existing)
`created`, `planned`, `started`, `step_started`, `step_completed`, `step_failed`, `approval_required`, `approval_granted`, `approval_rejected`, `resumed`, `cancelled`, `completed`, `failed`.

### Audit lifecycle (this pack adds)
`audit_run_started`, `audit_plan_created`, `evidence_mapped`, `control_test_started`, `control_test_completed`, `exception_found`, `workpaper_generated`, `reviewer_action_required`, `final_pack_started`, `final_pack_generated`, `audit_run_completed`, `audit_run_failed`, `audit_run_cancelled`.

Every audit event carries `agentRole` (`AUDIT_COMMANDER`, `CONTROL_TEST_AGENT`, `EXCEPTION_FINDER`, `WORKPAPER_WRITER`, `FINAL_AUDIT_PACK_AGENT`, `COMPLIANCE_MAPPER`) so the cockpit can attribute each step to the responsible role.

## SSE channels

| Channel | Carries | Subscribed by |
|---|---|---|
| `workflow:{workflowId}` | All 13 workflow lifecycle events | ChatWorkspace via existing `/sse/workflows/:id` route |
| `audit_run:{auditRunId}` | All audit lifecycle events for one run | The `/audit/runs/:id` detail page can subscribe (Phase 2 wiring) |

The audit channel reuses `fastify.swarm.emit()` (the same EventEmitter that powers the workflow channel), so the SSE relay already has cross-instance fan-out via Redis.

## Activity events (per-agent telemetry)

`AgentActivityEvent` types `tool_called`, `tool_completed`, `cost_updated` carry the per-call telemetry that the cockpit uses to render the cost ribbon, fallback-model badge, and tool outcome chips. These are emitted by `BaseAgent` during every tool loop iteration.

## Honest visibility

- The cockpit shows only events that actually fired. There is no synthetic "step_completed" emission — every event ties to a real persisted state change.
- Tool outcomes carry the `ToolOutcome` enum (`real_success`, `draft_created`, `mock_provider`, `not_configured`, `blocked_requires_config`, `failed`) so the cockpit renders the badge from the tool registry's own classification, not by string-matching the output.
- The `runtime` field on `cost_updated` distinguishes `'openai-responses'`, `'legacy'`, `'langgraph-shim'` so the cockpit shows the actual code path that ran.

## What the cockpit does NOT show today

- Per-control LLM token cost during control testing — the LLM cost ribbon shows aggregate. Per-control cost stays in `ControlTest.evidenceConsidered` for forensic review but isn't surfaced live.
- The audit detail page polls every 15 seconds. The SSE-subscribed audit channel is wired in the API but the React detail page reads via SWR + polling for v1; SSE wiring is roadmap.

## Where to look

- Cockpit component: `apps/web/src/components/chat/ChatWorkspace.tsx`
- Lifecycle event types: `packages/swarm/src/lifecycle/workflow-event-types.ts` + `apps/api/src/services/audit/audit-run.service.ts` (`AuditLifecycleEventType`)
- SSE route: `apps/api/src/routes/workflows.routes.ts` (`/workflows/:id/events`)
- Activity emit hook: `packages/agents/src/base/agent-context.ts` (`AgentActivityEvent`)
