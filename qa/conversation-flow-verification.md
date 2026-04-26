# Conversation flow + intent mapping — verification (commit 769e358 baseline)

## Required intent vocabulary (18 intents)

The user's spec asks for the Commander to map natural language to one of these 18 intents:

`company_strategy_review`, `marketing_campaign_generation`, `website_review_and_improvement`, `codebase_review_and_patch`, `competitor_research`, `investor_material_generation`, `content_calendar_generation`, `audit_compliance_workflow`, `pricing_and_unit_economics_review`, `operations_sop_generation`, `customer_persona_generation`, `sales_outreach_draft_generation`, `product_positioning_review`, `document_analysis`, `browser_inspection`, `research_and_report`, `general_question`, `ambiguous_request`.

## What actually exists

### Commander (real, but free-text intent)

[packages/agents/src/roles/commander.agent.ts](../packages/agents/src/roles/commander.agent.ts) emits a `MissionBrief` validated against [CommanderResponseSchema](../packages/agents/src/runtime/schemas/commander.schema.ts):

```ts
{
  directAnswer: string | null,
  intent: string,                // FREE-TEXT — not a fixed enum
  subFunction: string,
  urgency: number,
  riskIndicators: string[],
  requiredOutputs: string[],
  clarificationNeeded: boolean,
  clarificationQuestion: string | null
}
```

- ✅ Real LLM call via `OpenAIRuntime.respondStructured` with strict zod schema (no prose drift).
- ✅ Direct-answer short-circuit for trivial queries.
- ✅ Clarification gate blocks Planner→Worker pipeline when `clarificationNeeded=true`.
- ✅ Just-fixed (commit `abef53b`) to propagate fatal config errors instead of silently falling back.
- ❌ `intent` is a free-text sentence, NOT one of the 18 named values. Planner / Router don't dispatch on a fixed intent enum.
- ❌ No `IntentRecord` Prisma model — intent is transient, dies with the workflow.

### Planner (verb-driven dynamic routing)

[packages/agents/src/roles/planner.agent.ts](../packages/agents/src/roles/planner.agent.ts) decomposes the MissionBrief into a `WorkflowPlan` with one `WorkflowTask` per step. Each task gets an `agentRole` assignment via verb-driven heuristics:

- "write" / "draft content" → `WORKER_CONTENT`
- "code" / "fix bug" → `WORKER_CODER`
- "SWOT" / "strategy" → `WORKER_STRATEGIST`
- "audit" → routes to compliance services (separate path, not Planner)
- ... etc.

This is dynamic decomposition, not template lookup. Quality depends on Planner prompt + LLM judgment.

### Follow-up commands

❌ Not built. The user can't type "approve", "continue", "show graph", "what is the CTO doing?" and have the system route to the active workflow. UI buttons (the only path) drive resume/pause via `POST /workflows/:id/unpause` and `/approvals/:id/decide`.

## Per-spec-intent classification

| Spec intent | Today's behavior | Status |
|---|---|---|
| `company_strategy_review` | Commander emits free-text intent (e.g. "review company strategy"); Planner decomposes via verb routing → likely `WORKER_STRATEGIST` + `WORKER_RESEARCH` + `WORKER_FINANCE` | DYNAMIC (no named intent) |
| `marketing_campaign_generation` | Free-text → `WORKER_MARKETING` + `WORKER_CONTENT` via verb routing | DYNAMIC |
| `website_review_and_improvement` | Free-text → `WORKER_BROWSER` (when URL detected) + `WORKER_TECHNICAL` or `WORKER_DESIGNER` | DYNAMIC |
| `codebase_review_and_patch` | Free-text → `WORKER_CODER` via verb routing ("code review", "fix") | DYNAMIC |
| `competitor_research` | Free-text → `WORKER_RESEARCH` + `WORKER_BROWSER` | DYNAMIC |
| `investor_material_generation` | Free-text → `WORKER_CONTENT` + `WORKER_FINANCE` (when financial framing detected) | DYNAMIC |
| `content_calendar_generation` | Free-text → `WORKER_CONTENT` + `WORKER_SEO` | DYNAMIC |
| `audit_compliance_workflow` | **Separate path** — POST `/audit/runs` is a DIRECT API entry, not routed through Commander/Planner. Has its own state machine and lifecycle events. | NAMED via API |
| `pricing_and_unit_economics_review` | Free-text → `WORKER_FINANCE` + `WORKER_STRATEGIST` | DYNAMIC |
| `operations_sop_generation` | Free-text → `WORKER_OPS` + `WORKER_DOCUMENT` | DYNAMIC |
| `customer_persona_generation` | Free-text → `WORKER_RESEARCH` + `WORKER_MARKETING` | DYNAMIC |
| `sales_outreach_draft_generation` | Free-text → `WORKER_GROWTH` + `WORKER_CONTENT` | DYNAMIC |
| `product_positioning_review` | Free-text → `WORKER_PRODUCT` + `WORKER_STRATEGIST` | DYNAMIC |
| `document_analysis` | Free-text → `WORKER_DOCUMENT` (when file context present) | DYNAMIC |
| `browser_inspection` | Free-text → `WORKER_BROWSER` (when URL detected) | DYNAMIC |
| `research_and_report` | Free-text → `WORKER_RESEARCH` + `WORKER_DOCUMENT` | DYNAMIC |
| `general_question` | Direct-answer short-circuit (Commander's `directAnswer` field, no Planner/Worker pipeline) | NAMED PATH |
| `ambiguous_request` | Clarification gate (Commander's `clarificationNeeded=true`) | NAMED PATH |

**Status counts:** 1 NAMED via API (audit), 2 NAMED PATHS (direct-answer + clarification), 15 DYNAMIC.

## Required follow-up commands (none exist)

| Command | UI button equivalent | NL handler? |
|---|---|---|
| "continue" | (no UI equivalent — workflows just continue) | ❌ |
| "approve" | Approval card → "Approve" button | ❌ NL parser |
| "reject" | Approval card → "Reject" button | ❌ NL parser |
| "pause this run" | `POST /workflows/:id/pause` button | ❌ NL parser |
| "resume this run" | `POST /workflows/:id/unpause` button | ❌ NL parser |
| "show me the graph" | Always-visible WorkflowDAG component | ❌ NL parser |
| "what is the CMO doing?" | Cockpit live activity stream | ❌ NL parser |
| "what is the CTO doing?" | Cockpit live activity stream | ❌ NL parser |
| "what is VibeCoder doing?" | `/builder/[projectId]` page | ❌ NL parser |
| "why is this waiting?" | Approval card description text | ❌ NL parser |
| "show failed steps" | Cockpit step list with red badges | ❌ NL parser |
| "show token cost" | Cost ribbon (always visible) | ❌ NL parser |
| "download final report" | Final-output download button | ❌ NL parser |
| "finalize this workpaper" | Workpaper detail page → "Approve" button | ❌ NL parser |

**Status:** UI surfaces all functions, but **no natural-language follow-up command parser exists**. To add: a small intent classifier (~14 commands) that runs after Commander and detects follow-ups against the active workflow's pending state.

## What it would take to close the gap honestly

| Gap | Effort | Impact |
|---|---|---|
| Add a fixed `intent` enum to `CommanderResponseSchema` (one of 18 + `ambiguous_request` + `general_question`) | ~2 days | Planner can dispatch on enum; Router can use intent → template lookup; cockpit shows clean "Intent: marketing_campaign_generation" badge |
| Create `IntentRecord` Prisma model + persist on every run | ~1 day | Searchable intent history; analytics on what users actually ask for |
| Build follow-up command NL parser (rule-based, ~14 verbs) | ~2-3 days | "approve" / "show graph" / "what is the CMO doing?" actually work in chat |
| Build `WorkflowTemplate` library (16 named templates + selection logic in Commander) | ~1 week | Pre-tuned best-practice decompositions per common workflow |
| Total | ~3-4 weeks | Conversation surface becomes truly layman-friendly |

These items remain **NOT BUILT** — see [qa/conversation-flow-audit.md](conversation-flow-audit.md) (the original audit) and [qa/audit-pack-shipped-report.md](audit-pack-shipped-report.md) for matching deferral entries.

## Verdict: PARTIAL

What works: Commander does real LLM-driven intent extraction with structured output; clarification gating is real; direct-answer short-circuit is real; Planner does verb-driven dynamic decomposition; UI surfaces every function.

What's missing: fixed intent enum, intent persistence (`IntentRecord`), follow-up command NL parser, `WorkflowTemplate` library. None are faked — they're documented as deferred. ~3-4 weeks to fully close.
