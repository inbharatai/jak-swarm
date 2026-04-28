# Agent Accuracy Rating Matrix (Phase 7)

Verified at commit `c2fb125`. Static + tests-based audit. Every rating
is grounded in observable code + test coverage. **NEEDS RUNTIME** marks
items that require live LLM to fully grade.

The role-manifest at `packages/agents/src/role-manifest.ts` provides
the project's own maturity classification per agent — used as one input.

---

## 1. Orchestrators (6)

| Role | File | Real backend? | Tests | OpenAI runtime | Events emitted | Maturity claim | Static rating |
|---|---|---|---|---|---|---|---|
| Commander | roles/commander.agent.ts | ✅ Real BaseAgent w/ structured output | role-behavioral.test.ts | OpenAIRuntime tier-3 | intent_detected, clarification_required | world_class | **9/10** |
| Planner | roles/planner.agent.ts | ✅ Real DAG decomposition | full-pipeline + behavioral tests | OpenAIRuntime tier-3 | planned (taskCount) | world_class | **9/10** |
| Router | roles/router.agent.ts | ✅ Real role-mapping | router-node tests, Sprint 2.1/K | OpenAIRuntime | agent_assigned (per task) | world_class | **9/10** |
| Verifier | roles/verifier.agent.ts | ✅ Real 4-layer hallucination + Sprint 2.4/F citation density | verifier-grounding.test.ts (16 tests) | OpenAIRuntime tier-2 | verification_started/completed | world_class | **9/10** |
| Guardrail | roles/guardrail.agent.ts | ✅ Real policy + PII + injection | guardrail.test.ts | OpenAIRuntime | (no fine-grained event yet) | world_class | **8/10** |
| Approval | roles/approval.agent.ts | ✅ Real auto-approve + interrupt | approval-gate.test.ts | (no LLM — rule-based) | approval_required | world_class | **9/10** |

**Orchestrator average: 8.8/10.** Why not perfect: no live behavior
verification (NEEDS RUNTIME for Commander/Planner/Verifier accuracy).

---

## 2. Executive workers (5 — the "C-suite")

| Role | File | Maturity | Special features | Static rating |
|---|---|---|---|---|
| WORKER_STRATEGIST (CEO) | strategist.agent.ts | world_class | "Fortune 500 CEO persona, Strategic frameworks, Second-order thinking" | **8/10** |
| WORKER_MARKETING (CMO) | marketing.agent.ts | world_class | "CMO-grade prompt, Revenue attribution, Campaign design, 9 dedicated tools" | **8/10** |
| WORKER_TECHNICAL (CTO) | technical.agent.ts | world_class | "Principal engineer persona, FAANG-scale systems judgment" | **8/10** |
| WORKER_FINANCE (CFO) | finance.agent.ts | world_class | "CFO-grade analysis, Every number cited or labeled estimate, PE-operator thinking" | **8/10** |
| WORKER_OPS (COO) | ops.agent.ts | upgraded | "Severity triage p0-p4, Rollback plan for every destructive action, Five-whys root cause" | **7/10** |

**Executive worker average: 7.8/10.**

The CEO super-orchestrator (`apps/api/src/services/ceo-orchestrator.service.ts`)
sits ABOVE these workers. It loads Company Brain + tags executive
functions + emits ceo_* events + generates an executive summary at
workflow end. **Not a replacement for the executive workers — a wrapper.**

---

## 3. Specialised workers (27)

| Role | Maturity | Tests | Static rating |
|---|---|---|---|
| WORKER_GROWTH | world_class | role-strong-tier-behavioral | 8/10 |
| WORKER_HR | strong | role-behavioral | 7/10 |
| WORKER_EMAIL | upgraded | role-behavioral.test.ts | 8/10 |
| WORKER_CRM | upgraded | role-behavioral.test.ts | 8/10 |
| WORKER_RESEARCH | upgraded + needsGrounding=0.7 | role-behavioral.test.ts + verifier-grounding | 8/10 |
| WORKER_CALENDAR | upgraded | role-behavioral.test.ts | 8/10 |
| WORKER_DOCUMENT | upgraded | role-behavioral-extended.test.ts | 7/10 |
| WORKER_SUPPORT | upgraded | role-world-class-upgrades.test.ts | 8/10 |
| WORKER_VOICE | upgraded | (voice-specific tests) | 7/10 |
| WORKER_BROWSER | upgraded + limitations declared | worker-node-browser.test.ts | 7/10 |
| WORKER_CODER | world_class | coder-related tests | 8/10 |
| WORKER_DESIGNER | strong + needsGrounding=0.5 | role-strong-tier-behavioral | 7/10 |
| WORKER_KNOWLEDGE | strong | knowledge-related tests | 7/10 |
| WORKER_LEGAL | strong | role-strong-tier-behavioral | 7/10 |
| WORKER_PRODUCT | strong | role-strong-tier-behavioral | 7/10 |
| WORKER_PROJECT | strong | role-strong-tier-behavioral | 7/10 |
| WORKER_SUCCESS | upgraded | role-world-class-upgrades | 7/10 |
| WORKER_PR | strong | role-strong-tier-behavioral | 7/10 |
| WORKER_CONTENT | strong | role-strong-tier-behavioral | 7/10 |
| WORKER_SEO | strong | role-strong-tier-behavioral | 7/10 |
| WORKER_SPREADSHEET | strong | role-strong-tier-behavioral | 7/10 |
| WORKER_ANALYTICS | strong | role-strong-tier-behavioral | 7/10 |
| WORKER_APP_GENERATOR (VibeCoder) | world_class | vibe-coder-workflow.test.ts (3 tests) | 8/10 |
| WORKER_APP_ARCHITECT | upgraded | role-vibe-coder-behavioral.test.ts | 8/10 |
| WORKER_APP_DEBUGGER | upgraded | role-behavioral-extended.test.ts | 7/10 |
| WORKER_APP_DEPLOYER | upgraded | role-behavioral-extended.test.ts | 7/10 |
| WORKER_SCREENSHOT_TO_CODE | upgraded | (screenshot-specific tests) | 7/10 |

**Specialised worker average: 7.4/10.**

---

## 4. Audit-pack-related agent labels (real services, not BaseAgent classes)

The product spec mentions:
- Audit Commander
- Compliance Mapper
- Evidence Collector
- Control Test Agent
- Exception Finder
- Workpaper Writer
- Remediation Agent
- Final Audit Pack Agent

**Implementation reality:** these are NOT BaseAgent subclasses. They are
**SERVICES** in `apps/api/src/services/audit/` and
`apps/api/src/services/compliance/` that emit lifecycle events with
`agentRole='AUDIT_COMMANDER'` (etc.) so the cockpit shows them as
agents. Per `qa/audit-compliance-readiness-audit.md`, this was an
explicit Phase-1 vs Phase-2 design decision.

Honest classification:
- Functionally real ✅ (services do real work)
- Architecturally NOT BaseAgent classes ⚠️ (they don't have prompt files)
- Cockpit-visible ✅ (events tagged with agent role)

**Audit agent group rating: 7/10** — fully functional, not yet
prompt-driven LLM agents.

---

## 5. CEO super-orchestrator (orchestration layer, not a worker)

`apps/api/src/services/ceo-orchestrator.service.ts`:
- Pre-flight: detect trigger → load CompanyProfile → emit 4-event chain → blocker detection
- Post-completion: generate executive summary via OpenAIRuntime tier-2
- 8 ceo_* lifecycle events
- 15 unit tests passing

**Rating: 8/10.** Honest LLM-failure path tested. Only deduction: it
delegates execution to the existing Planner+Workers pipeline; doesn't
yet have a "true delegation" pattern where CEO assigns sub-tasks to
CMO/CTO directly.

---

## 6. Per-agent verification table for spec-required test prompts

| Agent | Spec test prompt | Code path | Verdict |
|---|---|---|---|
| CEO/Commander | "Act as CEO and review my company's next 30-day plan." | CEO trigger → preFlight → Commander → Planner → Workers → executive summary | ✅ Real path |
| CTO | "Review the technical architecture and find risks." | Commander → routes to WORKER_TECHNICAL | ✅ Real path; WORKER_TECHNICAL has FAANG-scale prompt |
| CMO | "Create a marketing campaign from my company profile." | Commander → marketing_campaign_generation intent → WORKER_MARKETING (with 9 dedicated tools) | ✅ Real path |
| CFO | "Review pricing, API cost, and unit economics." | Commander → pricing_and_unit_economics_review intent → WORKER_FINANCE | ✅ Real path |
| COO | "Create an operations execution plan." | Commander → operations_sop_generation intent → WORKER_OPS | ✅ Real path |
| VibeCoder | "Review this repo and fix the landing page." | Commander → codebase_review_and_patch → WORKER_APP_GENERATOR/CODER + dedicated vibe-coder-workflow with build-check + retry | ✅ Real path |
| Research | "Research competitors and prepare cited summary." | Commander → competitor_research → WORKER_RESEARCH (needsGrounding=0.7) → Verifier enforces citation density | ✅ Real grounding |
| Browser | "Open this website and inspect UI issues." | Commander → browser_inspection → WORKER_BROWSER | ⚠️ Real path, but adapter is Playwright + tenant-scoped; needs config to be live |
| Designer | "Review the landing page UX and suggest world-class improvements." | Commander → website_review_and_improvement → WORKER_DESIGNER (needsGrounding=0.5) | ✅ Real path |
| Verifier | "Verify this task is actually complete." | Verifier runs after every worker; 4 hallucination layers + citation density (Sprint 2.4/F) | ✅ Real verification |
| Report Writer | "Generate final report." | swarm-execution.service `compileFinalOutput` + workflow output route + (CEO mode) executive summary | ✅ Real |
| Human Approval | "Approve this final export." | approval-node + LangGraph interrupt → Command(resume); audit log via approvals.routes | ✅ Real |

✅ **Every spec-required agent has a real code path.** None are
cosmetic UI labels.

---

## 7. Agent output quality audit (Phase 8)

**Static portion done.** Each worker has a structured-output zod schema
that constrains the LLM's response shape. The Verifier enforces:
- 4-layer hallucination heuristics
- Sprint 2.4/F citation density check for `needsGrounding=true` roles

What I CAN'T grade without live LLM:
- Actual narrative quality of agent prose
- Specificity of recommendations
- Source-grounding accuracy in real research outputs
- Whether company-context injection produces noticeably better outputs

**Recommendation:** an operator running 5–10 prompts through each agent
with a live key would close this gap empirically. The infrastructure
to grade is built (Verifier emits `groundingScore`, `cost_updated`,
`pii_redacted`, etc.) — only the live LLM runs are missing.

**Static rating for output quality discipline: 8/10.** Live empirical
rating: NEEDS RUNTIME.

---

## 8. Critical gaps found in this phase

1. **Audit-product agents (Compliance Mapper, Evidence Collector, etc.)**
   are services, not BaseAgent classes. Spec language could mislead
   readers. Already documented in `qa/audit-compliance-readiness-audit.md`
   as an explicit Phase-1 vs Phase-2 decision. Not new.
2. **WORKER_BROWSER limitations** are honestly declared in role-manifest
   (`limitations: ['Browser automation against logged-in consumer sites
   (Twitter/Reddit) remains fragile by nature']`). ✅ honest.
3. **Live agent behavior not measured.** All ratings above are static
   (file existence + maturity claims + tests passing). Live grading
   would be a multi-session empirical effort.

---

## 9. Final per-category averages

- Orchestrators: 8.8/10
- Executive workers (CEO/CMO/CTO/CFO/COO): 7.8/10
- Specialised workers (27): 7.4/10
- Audit-product agents (services tagged as agents): 7/10
- CEO super-orchestrator: 8/10

**Weighted overall agent rating: 7.6/10.**

The big rating cap is "live LLM behavior unmeasured." Code paths are real,
schemas are real, tests are real. The empirical gap is the single
biggest reason no agent gets a 10/10.
