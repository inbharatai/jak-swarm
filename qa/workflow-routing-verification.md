# Workflow routing — verification (commit 769e358 baseline)

## What the spec asks for

A `WorkflowTemplate` library where each of these 16 layman intents maps to a pre-defined workflow specification (intent → required context → agents → tools → graph nodes → approval gates → artifacts → verification criteria → cost policy → retry policy → memory update policy):

1. company strategy review
2. marketing campaign generation
3. website review and improvement
4. codebase review and patch
5. competitor research
6. investor material generation
7. content calendar generation
8. audit/compliance workflow
9. pricing/unit economics review
10. operations SOP generation
11. customer persona generation
12. sales outreach draft generation
13. product positioning review
14. document analysis
15. browser inspection
16. general business advice

## What actually exists

### No `WorkflowTemplate` Prisma model

Grep `packages/db/prisma/schema.prisma` for `WorkflowTemplate` returns 0 hits. There is no template registry in the database.

### Planner does dynamic decomposition

[packages/agents/src/roles/planner.agent.ts](../packages/agents/src/roles/planner.agent.ts) takes the `MissionBrief` from Commander and asks the LLM to decompose it into a `WorkflowPlan` with one `WorkflowTask` per step. Each task gets an `agentRole` assignment via verb-driven heuristics (post-LLM):

- "write" / "draft" → `WORKER_CONTENT`
- "code" / "fix" / "review code" → `WORKER_CODER`
- "SWOT" / "strategy" → `WORKER_STRATEGIST`
- "campaign" / "GTM" → `WORKER_MARKETING`
- ... 12+ more verb mappings

This is real and shipping — but it's a **runtime LLM-driven decomposition**, not a template lookup.

### UI quick-actions

[apps/web/src/lib/templates.ts](../apps/web/src/lib/templates.ts) defines `QUICK_ACTIONS` per job function (CEO, CTO, CMO, ENGINEER, HR, FINANCE, SALES, OPERATIONS, OTHER). Each is a pre-written goal string the user can click to populate the chat input. Examples: `ceo-risk-scan`, `cmo-campaign`, `cto-pr-review`, `ops-bottlenecks`. These are **goal templates, not workflow templates** — the Planner still decomposes them dynamically.

### Audit/compliance — separate path

The audit pack does NOT go through Commander/Planner. It has its own API at `POST /audit/runs` and its own state machine. This is intentional — audit engagements are too high-stakes for LLM-driven decomposition. See [docs/audit-compliance-agent-pack.md](../docs/audit-compliance-agent-pack.md).

## Per-intent verdict

| Spec intent | Today's path | Status |
|---|---|---|
| company strategy review | Free-text → Planner verb routing → likely `WORKER_STRATEGIST` + `WORKER_RESEARCH` + `WORKER_FINANCE` parallel tasks | DYNAMIC |
| marketing campaign generation | Free-text → `WORKER_MARKETING` + `WORKER_CONTENT` + (if URL) `WORKER_BROWSER` | DYNAMIC |
| website review and improvement | Free-text → `WORKER_BROWSER` (URL detection) + `WORKER_TECHNICAL` or `WORKER_DESIGNER` | DYNAMIC |
| codebase review and patch | Free-text → `WORKER_CODER` (verb match "code", "fix", "review") + `WORKER_VERIFIER` | DYNAMIC |
| competitor research | Free-text → `WORKER_RESEARCH` + `WORKER_BROWSER` + `WORKER_CONTENT` | DYNAMIC |
| investor material generation | Free-text → `WORKER_CONTENT` + `WORKER_FINANCE` (if financials mentioned) | DYNAMIC |
| content calendar generation | Free-text → `WORKER_CONTENT` + `WORKER_SEO` | DYNAMIC |
| audit/compliance workflow | **Direct API** at `POST /audit/runs` — does NOT use Commander/Planner. Has its own state machine + 14 endpoints + 5 services + signed final pack. | TEMPLATE_VIA_API |
| pricing/unit economics review | Free-text → `WORKER_FINANCE` + `WORKER_STRATEGIST` | DYNAMIC |
| operations SOP generation | Free-text → `WORKER_OPS` + `WORKER_DOCUMENT` | DYNAMIC |
| customer persona generation | Free-text → `WORKER_RESEARCH` + `WORKER_MARKETING` | DYNAMIC |
| sales outreach draft generation | Free-text → `WORKER_GROWTH` + `WORKER_CONTENT` (with `draft_email` only — never sent) | DYNAMIC |
| product positioning review | Free-text → `WORKER_PRODUCT` + `WORKER_STRATEGIST` | DYNAMIC |
| document analysis | Free-text → `WORKER_DOCUMENT` (PDF parsing real; DOCX/XLSX/image labeled `STORED_NOT_PARSED`) | DYNAMIC |
| browser inspection | Free-text → `WORKER_BROWSER` (URL detection or explicit "screenshot/inspect" verbs) | DYNAMIC |
| general business advice | Commander direct-answer short-circuit OR `WORKER_STRATEGIST` task | DYNAMIC + NAMED |

**Counts:** 14 DYNAMIC, 1 TEMPLATE_VIA_API (audit), 1 NAMED PATH (general advice).

## What's missing for spec compliance

| Item | Effort | Why it matters |
|---|---|---|
| `WorkflowTemplate` Prisma model | ~1 day | Persistable templates per tenant |
| Template registry + selection logic in `Commander` (intent → template) | ~3 days | Pre-tuned best-practice decompositions per workflow type |
| Per-template required-context check (e.g. "marketing_campaign_generation needs: company brand voice, target audience") | ~2 days | Surfaces missing inputs to user before Planner spins up workers |
| Per-template approval gate spec (e.g. "investor_material_generation auto-approves draft, blocks send") | ~2 days | Honest gating per workflow type |
| Per-template artifact spec (e.g. "audit_compliance_workflow produces signed evidence pack") | ~1 day | Sets correct expectations in cockpit |
| 16 hand-tuned templates seeded | ~5 days | One per spec intent |

**Total to fully match spec: ~2 weeks of focused work.**

## Honest summary

Today the Planner works as a **dynamic LLM decomposer** for 14 of 16 layman intents. This is flexible (any new intent works without code changes) but means:
- No pre-tuned best-practice decomposition per workflow type
- Quality depends on Planner prompt quality + LLM judgment on the day
- Required-input checks happen at task-time (when a worker fails), not at Planner-time

The audit/compliance flow is the one TEMPLATE that exists fully end-to-end (state machine + service chain + UI) — and that's because it was built as a deliberate Phase 1 product surface in this session.

## Verdict: PARTIAL_BUT_HONEST

14 of 16 layman intents are served via dynamic Planner decomposition (real LLM, real worker assignment, real execution — just no template lookup). 1 of 16 (audit) is served by a real template-via-API. 1 of 16 (general advice) is served by a named direct-answer path.

`WorkflowTemplate` library is documented as deferred in [qa/conversation-flow-audit.md](conversation-flow-audit.md) (~1 week) and [qa/audit-pack-shipped-report.md](audit-pack-shipped-report.md). No fake template marketing — the README and landing page describe what works (dynamic decomposition + the audit pack template), not what's deferred.
