# Conversation Flow + Intent Mapping Audit (Phase 6)

Verified at commit `c2fb125`. Static + tests-based audit.

---

## 1. Intent vocabulary

`packages/agents/src/intents/intent-vocabulary.ts:20-42` exports
`COMPANY_OS_INTENTS` — exactly **18 named intents**:

```ts
'company_strategy_review',
'marketing_campaign_generation',
'website_review_and_improvement',
'codebase_review_and_patch',
'competitor_research',
'investor_material_generation',
'content_calendar_generation',
'audit_compliance_workflow',
'pricing_and_unit_economics_review',
'operations_sop_generation',
'customer_persona_generation',
'sales_outreach_draft_generation',
'product_positioning_review',
'document_analysis',
'browser_inspection',
'research_and_report',
'general_question',
'ambiguous_request',
```

**Matches spec required intents 18/18.** ✅

`CompanyOSIntentSchema = z.enum(COMPANY_OS_INTENTS)` enforces this in the
Commander's structured-output schema, so the LLM CANNOT return an
intent outside this enum without zod throwing.

---

## 2. Per-intent metadata

`INTENT_DESCRIPTIONS` (line 55+): one-line description per intent — used in
Commander system prompt + cockpit tooltip + analytics dashboard.

`INTENT_TO_LIKELY_AGENTS` — required-agent mapping per intent (referenced
in CEO orchestrator + Commander).

`INTENT_REQUIRED_CONTEXT` — required CompanyProfile fields per intent
(verified by company-os-foundation.test.ts:60-65 for `marketing_campaign_generation`
needing `brandVoice` + `targetCustomers`).

✅ Per-intent metadata is data-driven and queryable.

---

## 3. Commander — single source of intent truth

`packages/agents/src/roles/commander.agent.ts`:
- Uses `OpenAIRuntime.respondStructured` with `CommanderResponseSchema` (zod)
- Schema enforces intent ∈ COMPANY_OS_INTENTS
- Detects industry, urgency, riskIndicators, requiredOutputs,
  clarificationNeeded, directAnswer
- Short-circuits with `directAnswer` for trivial questions (greetings)
- Sets `clarificationNeeded` when input is ambiguous

This is the architectural source-of-truth for intent — NOT scattered
keyword matching across agents.

✅ Single classifier; deterministic schema.

---

## 4. Follow-up parser

`apps/api/src/services/conversation/followup-parser.ts` — rule-based
classifier for short follow-up commands inside an active workflow.
14 commands:

| Kind | Trigger examples |
|---|---|
| `approve` / `reject` | "approve", "ok approve it", "yes" (with hasPendingApproval bias) |
| `continue` / `pause` / `resume` / `cancel` | one-word commands |
| `show_graph` / `show_status` / `show_failed` / `show_cost` | "show graph", "what is the CMO doing?", "show failed steps", "total cost" |
| `download_report` / `finalize_workpaper` / `why_waiting` | per-spec keywords |

`show_status` maps role keywords (cto/cmo/cfo/ceo/coo/vibecoder/coder/
designer/research) to AgentRole strings.

Wired into `apps/api/src/routes/workflows.routes.ts:48+` (Sprint 2.1/J):
on `POST /workflows`, when goal length < 200 AND active workflow exists,
parser runs first; if matched, dispatches to the right service instead
of creating a new workflow.

**Tests:** 26 follow-up parser tests in `tests/integration/company-os-foundation.test.ts`.

✅ Real follow-up routing; no new workflow on every "approve".

---

## 5. CEO super-orchestrator (Final hardening / Gap A)

`apps/api/src/services/ceo-orchestrator.service.ts:69-100` —
`detectCEOTrigger(goal, mode?)` matches 8 patterns and maps to executive
functions + agent roles:
- "act as CEO/CMO/CTO/CFO/COO" → all 5 functions
- "review my company/business" → CEO + CMO + CTO + CFO
- "review my company website" → CEO + CMO
- "audit these documents" → CEO + CFO
- "run my company marketing" → CMO
- "business/strategic plan" → CEO + CFO + COO
- "next steps for company" → all 5
- explicit `mode: 'ceo'` → all 5

Wired into `swarm-execution.service.ts` after `started` lifecycle
event. Emits `ceo_*` event chain.

**Tests:** 15 unit tests in `tests/unit/services/ceo-orchestrator.test.ts`.

✅ Real CEO mode detection.

---

## 6. Test the 15 user inputs from Phase 6 spec

I'll classify each spec input through the existing detection logic:

| # | User input | Detection path | Likely intent | Likely agents |
|---|---|---|---|---|
| 1 | "Review this repo and fix the landing page." | Commander LLM | `codebase_review_and_patch` | WORKER_CODER + WORKER_DESIGNER + VERIFIER |
| 2 | "Create a launch campaign for my company." | Commander LLM | `marketing_campaign_generation` | WORKER_MARKETING + WORKER_CONTENT |
| 3 | "Run my company's marketing this week." | **CEO trigger** (`run my company marketing`) | `function_owner_request` (CEO mode) | CMO |
| 4 | "Review my business and tell me what is missing." | **CEO trigger** (`review my business`) | `business_review` (CEO mode) | CEO+CMO+CTO+CFO |
| 5 | "Check my website and improve it." | Commander LLM | `website_review_and_improvement` | WORKER_DESIGNER + WORKER_RESEARCH |
| 6 | "Audit these compliance documents and create workpapers." | **CEO trigger** (`audit these documents`) | `audit_compliance_workflow` (CEO mode) | CEO+CFO + audit pipeline |
| 7 | "Create an investor deck from my company documents." | Commander LLM | `investor_material_generation` | WORKER_DOCUMENT + WORKER_CONTENT + WORKER_DESIGNER |
| 8 | "Research competitors and prepare a report." | Commander LLM | `competitor_research` | WORKER_RESEARCH (needsGrounding=true) |
| 9 | "Act as CEO, CMO, CTO, CFO and COO and plan next steps." | **CEO trigger** (`act as CEO`) | `business_review` (CEO mode) | all 5 executive workers |
| 10 | "Continue." | **Follow-up parser** | `continue` | (resume workflow) |
| 11 | "Approve." | **Follow-up parser** | `approve` (last_pending) | (resolve approval) |
| 12 | "Show me the graph." | **Follow-up parser** | `show_graph` | (return DAG) |
| 13 | "What is the CMO doing?" | **Follow-up parser** | `show_status` (agentRole=WORKER_MARKETING) | (return live status) |
| 14 | "Why is this waiting?" | **Follow-up parser** | `why_waiting` | (return pendingApproval info) |
| 15 | "Download the final report." | **Follow-up parser** | `download_report` | (redirect to /workflows/:id/output) |

✅ **All 15 inputs are classified by code that exists today** — split
across CEO trigger detection, follow-up parser, and Commander LLM.

---

## 7. Required vs implemented intents

| Required intent (Phase 6 spec) | Implemented |
|---|---|
| company_strategy_review | ✅ |
| marketing_campaign_generation | ✅ |
| website_review_and_improvement | ✅ |
| codebase_review_and_patch | ✅ |
| competitor_research | ✅ |
| investor_material_generation | ✅ |
| content_calendar_generation | ✅ |
| audit_compliance_workflow | ✅ |
| pricing_and_unit_economics_review | ✅ |
| operations_sop_generation | ✅ |
| customer_persona_generation | ✅ |
| sales_outreach_draft_generation | ✅ |
| product_positioning_review | ✅ |
| document_analysis | ✅ |
| browser_inspection | ✅ |
| research_and_report | ✅ |
| general_question | ✅ |
| ambiguous_request | ✅ |

**18/18 — perfect match.**

---

## 8. Conversation state

`Conversation` Prisma model exists (Migration 16) with message history.
The cockpit + workflow runtime track:
- `IntentRecord` row per workflow run (intent + confidence + subFunction
  + urgency + riskIndicators + requiredOutputs)
- `clarificationNeeded` short-circuits Planner/Router/Workers (Migration 16)
- Active workflow lookup at `POST /workflows` (Sprint 2.1/J)

✅ Conversation context survives across messages.

---

## 9. NEEDS RUNTIME

The following can only be empirically verified with a live OPENAI_API_KEY
(out of scope for static audit):
- Commander's actual classification accuracy on the 15 test inputs
- Confidence scores (LLM-self-reported)
- Direct-answer short-circuit quality
- Clarification question quality

The CODE PATH is verified — the LLM behavior on real inputs is the
remaining empirical step.

---

## 10. Issues / risks

1. **Commander always runs even for follow-up commands** — actually no,
   this was fixed in Sprint 2.1/J: the follow-up parser short-circuits
   BEFORE creating a new workflow. Verified at workflows.routes.ts:48+.
2. **CEO trigger patterns may overlap with Commander LLM intents** for
   ambiguous goals. The CEO trigger fires FIRST (in pre-flight, before
   Commander) — when both could match, CEO wins, and the workflow gets
   the CEO wrapper. This is by design; not a bug.
3. **`ambiguous_request` intent** — Commander emits it when uncertain;
   the workflow then hits clarification gate. Tested in
   `tests/integration/company-os-foundation.test.ts`.

---

## 11. Rating

**Conversation flow + intent mapping: 9 / 10**

- ✅ 18/18 required intents implemented
- ✅ 14-command follow-up parser real and tested
- ✅ CEO super-orchestrator real with 8 trigger patterns
- ✅ Single source of intent truth (Commander + zod)
- ✅ Conversation state persisted
- ✅ Per-intent agent + context metadata data-driven

**Why not 10/10:**
- Commander's empirical classification accuracy on the 15 spec
  inputs not measured against live LLM (NEEDS RUNTIME)
- No telemetry surface for intent-classification false-positive rate
  (would require sustained production runs to populate)

These are observability follow-ups, not correctness gaps.
