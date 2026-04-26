# Conversation flow + intent mapping — readiness audit

Honest classification of the user's expanded spec for "intent mapping + workflow routing + conversation state + follow-up commands". This document captures what is already real vs what would need to be built.

## Spec items

The user asked for:

1. **Natural-language commands** — user types "Run a SOC 2 audit for Q1 2026", system extracts structured intent.
2. **Structured intent persistence** — intent records survive workflow completion and can be referenced later.
3. **Conversation-level state** — workflow id + pending approvals + current agent persisted at the conversation level.
4. **Follow-up commands** — "approve", "continue", "show graph" parsed and routed to the active workflow.
5. **Workflow templates library** — pre-defined CMO / CTO / audit / research templates instead of dynamically planned each time.

## Per-item classification

### 1. Natural-language commands → structured intent

**Status: REAL (partial).** Built and shipping.

- `CommanderAgent` (`packages/agents/src/roles/commander.agent.ts`) extracts a `MissionBrief`:
  ```ts
  {
    intent: string;
    subFunction: string;
    urgency: 'low'|'normal'|'high';
    riskIndicators: string[];
    requiredOutputs: string[];
    clarificationNeeded: boolean;
    clarificationQuestion?: string;
    directAnswer?: string;
  }
  ```
- Validated via zod schema (`CommanderResponseSchema` in `packages/agents/src/runtime/schemas/`).
- OpenAI-first: uses Responses API `text.format: json_schema` for strict structured output (no prose drift).
- Direct-answer short-circuit returns the answer immediately when no workflow is needed.
- Clarification gate blocks Planner→Worker pipeline when `clarificationNeeded=true`.

**Gap:** the `MissionBrief` is transient — lives in memory during the workflow run, not persisted to DB. Once the workflow completes the brief is gone except in lifecycle event details.

### 2. Structured intent persistence

**Status: NOT BUILT.** Honest gap.

- No `IntentRecord` Prisma model exists.
- The intent currently lives only in:
  - `Workflow.planJson` (the full plan, not the structured brief)
  - lifecycle event `details.brief` (not queryable)
- Building this requires: new Prisma model + migration + service to upsert from `CommanderAgent` output + index by tenantId + intent vocabulary.

**Effort:** ~3-5 days for the model, persistence layer, and a basic intent search endpoint.

### 3. Conversation-level state

**Status: NOT BUILT.** Frontend has message history only.

- `apps/web/src/stores/conversation-store.ts` carries message history + selected roles.
- No workflow id is stored at the conversation level — the relationship is implicit (latest workflow per conversation).
- No pending approvals panel — approvals show up in the cockpit but aren't surfaced as a per-conversation queue.
- No "current agent" indicator outside the live SSE feed.

**Effort:** ~3-5 days. Backend `Conversation` model + frontend store rewrite + SSE wiring.

### 4. Follow-up commands ("approve", "continue", "show graph")

**Status: NOT BUILT.** Only UI buttons drive resume/pause today.

- The approval UI button calls `POST /approvals/:id/decide`. There is no NL parser that maps "approve the last one" → the same call.
- No follow-up-command vocabulary is defined.
- Building this needs: a small intent classifier (or rule-based parser) that runs after `CommanderAgent` and detects follow-ups against the active workflow's pending state.

**Effort:** ~2-3 days for a rule-based parser covering ~10 common verbs ("approve", "reject", "cancel", "resume", "pause", "show graph", "show artifacts", "rerun", "explain", "summarize"). LLM-driven parser would be ~1 week.

### 5. Workflow templates library

**Status: NOT BUILT.** Every workflow is dynamically planned by `PlannerAgent`.

- `PlannerAgent` does verb-driven routing: `write→CONTENT`, `code→CODER`, `SWOT→STRATEGIST`, `audit→...`. Real and shipping.
- No `WorkflowTemplate` model — there's nothing to reference in a "use the SOC 2 audit template" request.
- For audits this gap is closed by `AuditRunService.plan()` which IS a template-like operation: pick framework, seed control tests. So one specific template ("audit run") effectively exists.
- For other domains (CMO campaigns, CTO infra setup), templates would need to be defined.

**Effort:** ~1 week. Schema for template definition (steps + agents + parameters), template-selection logic in `CommanderAgent`, template-to-graph compilation in `PlannerAgent`.

## Summary

| Surface | Status | Effort to close |
|---|---|---|
| 1. NL → structured intent | ✅ Real | — |
| 2. Intent persistence | ❌ Not built | ~3-5 days |
| 3. Conversation state model | ❌ Not built | ~3-5 days |
| 4. Follow-up commands | ❌ Not built | ~2-3 days (rules) or ~1 week (LLM) |
| 5. Workflow templates | ❌ Not built (audit is the only template) | ~1 week |

**Total to fully close: ~3-4 weeks of focused engineering.**

## Honesty notes

- The Commander → Planner → Router → Worker pipeline is real and ships in production. The intent extraction is not faked.
- What's missing is the persistence + multi-turn conversation surface, which is a separate product workstream.
- This document does not claim deferred items are "in flight". They are not.
