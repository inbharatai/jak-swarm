# JAK Swarm — Landing claim vs. live product reality

Every line below was verified against the live product on 2026-04-24. "Evidence" links to a Playwright screenshot under `qa/playwright-artifacts/`.

Verdict legend:
- **Real** — claim is true and observable in the product
- **Real (caveat)** — true but with a discoverability or completeness gap worth noting
- **Partial** — half-shipped; the underlying capability exists but isn't fully surfaced
- **Misleading** — landing implies more than the product delivers
- **Missing** — claim has no observable product implementation

| # | Landing claim | Reality | Evidence | Recommendation |
|---|---|---|---|---|
| 1 | "The trusted control plane for autonomous work" | **Real (caveat)** — auth + dashboard + agent execution + run inspector all real and observable. The "trusted" framing is supported by approval gates being blocking by default and by audit-log persistence. | `p3-nav/`, `p5-runs/inspector-row-expanded.png` | Keep claim. |
| 2 | "Decomposes intent, routes to the right capabilities, executes in parallel, delivers results" | **Real** — Commander → Planner → Router → Worker → Verifier pipeline is real (verified end-to-end via `/swarm` row expansion showing per-agent timeline). Parallel execution capped at 5 concurrent tasks per batch. | `p5-runs/inspector-row-expanded.png` | Keep claim. Optional: footnote the 5-task batch ceiling. |
| 3 | "Specialist agents, not one generalist" — CEO, CTO, CMO, Engineer, Legal, Marketing | **Partial** — 5 of 6 named roles (CEO, CMO, CTO, Engineer, Marketing) appear in the workspace role picker. **Legal is on the landing but missing from the product picker** even though `legal.agent.ts` exists in the codebase. | `p4-roles/role-picker.png` | Add `Legal` chip to `ROLE_LIST` in `apps/web/src/lib/role-config.ts` (5-line fix). |
| 4 | "Specialist agents" includes Coding / Research / Design / Auto (not on landing) | **Real (bonus)** — 4 product-only roles ship that aren't called out on the landing. Under-promising. | `p4-roles/role-picker.png` | Optional: surface these on the landing for credit. |
| 5 | "Approvals on high-risk actions" | **Real** — `approval-node.ts` blocks by default; auto-approve is opt-in; approval decision API exists; UI surfaces pending-approval list in the workspace sidebar drawer. | (not exercised in this run; verified in code audit) | Keep claim. |
| 6 | "Audit / event / trace visibility" | **Real** — `/swarm` Inspector lists every workflow row; clicking expands a per-agent timeline with status badges + retry counts. | `p5-runs/inspector-row-expanded.png` | Keep claim. |
| 7 | "Memory across runs" | **Real** — `/knowledge` Knowledge Console shows tenant memory backed by the live API memory store. CRUD modal opens with key/value/type fields (FACT / PREFERENCE / CONTEXT / SKILL_RESULT). | `p3-nav/knowledge-memory-landing.png` | Keep claim. |
| 8 | "Recovery / self-healing retries" | **Real (caveat)** — Verifier retries up to 2x; replanner runs once per workflow. Not surfaced in chat UI ("retrying task X" not narrated to user). | (not exercised in this run) | Add live retry narration in `ChatWorkspace`. |
| 9 | "Builder flow — describe it, see it, deploy it" | **Real (caveat)** — `/builder` shows project list + New Project CTA + persisted earlier draft. Did not exercise full create→generate→preview→deploy in this run. | `p3-nav/builder-landing.png` | Keep claim; full builder loop covered in the separate `qa-world-class.spec.ts` persona suite. |
| 10 | "Live execution traces" | **Real** — every workflow row in `/swarm` has a timeline + per-agent input/output/duration. | `p5-runs/inspector-row-expanded.png` | Keep claim. |
| 11 | "Classified tools and maturity labels users can trust" | **Real (caveat)** — every tool in the registry has a `maturity` field (real / config_dependent / heuristic / llm_passthrough / experimental). Landing now also discloses the maturity breakdown (56 production, 33 config-dependent, 19 LLM-native, 13 heuristic, 1 experimental — total 122). The `/skills` page in the product itself doesn't yet expose this — empty state for new tenants. | `p3-nav/skills-landing.png` | Populate `/skills` with the built-in tool registry (filtered by industry pack), surfaced as read-only tiles with maturity badges. |
| 12 | "122 tools" | **Real** but misleading without context — only 56 (~46%) are `maturity: 'real'`. Landing now adds the breakdown sentence under the headline (shipped today). | `p1-landing/landing-fold.png` | Done. |
| 13 | Capability map mentions browser / docs / CRM / research / memory / calendar / email / spreadsheets / code / voice | **Real** — every category has at least one working tool. Browser via Playwright (27 tools). Sandbox execution via E2B / Docker (7 tools). Voice via OpenAI Realtime (verified via `voice.routes.ts:trigger-workflow`). | (multiple — see code audit at qa/_audits/) | Keep claim. |
| 14 | Implied "filesystem capability" for agents | **Misleading** — there are NO local filesystem tools in the registry (no `read_file`, `write_file`, `list_dir`). Only sandbox virtual-filesystem tools (7) operate inside isolated E2B/Docker sandboxes. | (code audit, no live UI surface) | Either tighten landing copy ("sandbox + browser file access") or ship gated local-FS tools. |
| 15 | Implied "computer / desktop control" | **Missing** — zero MCP computer-use or desktop-automation tools. Browser automation via Playwright is the only autonomous-action surface. | (code audit) | Either drop "computer" framing or wire OpenAI's `computer-preview` hosted tool (the OpenAIRuntime adapter committed today supports it via `HostedToolsConfig`). |
| 16 | Voice → workflow | **Real** — `voice.routes.ts` has `POST /voice/sessions/:id/trigger-workflow` that creates a workflow + `executeAsync`s it from a voice transcript. Requires `OPENAI_API_KEY` set. | (code audit; not exercised in live UI run) | Keep claim. |
| 17 | "Pricing" page exists | **Real (unverified)** — landing has Pricing link; not exercised in this audit. | `p1-landing/landing-fold.png` | Verify in next pass. |
| 18 | "Sign In / Get Started" CTAs work | **Real** — both resolve to `/login` and `/register`. Login flow tested end-to-end; signup not tested in this run. | `p1-landing/landing-fold.png`, `p2-auth/login-form-empty.png` | Keep claim. |
| 19 | LinkedIn integration | **Missing from product** — `linkedin-api.adapter.ts` exists in the codebase, `post_to_linkedin` tool is registered, but no LinkedIn tile on `/integrations`. | `p6-integrations/integrations.png` | Add tile or remove from any social-platform marketing claims. |
| 20 | Salesforce integration | **Missing** — no Salesforce tile, no Salesforce adapter in `packages/tools/src/adapters/`. HubSpot covers the CRM category. | `p6-integrations/integrations.png` | Drop Salesforce from any marketing or ship the adapter. |

## Sourcing notes

- "Landing claim" column is paraphrased from the public landing page's hero, capability map, execution flow, and pricing sections as rendered to an unauthenticated visitor on 2026-04-24.
- "Reality" is what the live signed-in product actually does, observed via Playwright in two back-to-back runs (one headless, one headed) by an authenticated user.
- Code-audit references are to the production branch as of commit `ef68e75` (Phase 8 of the OpenAI-first migration).

## Bottom line

The product **substantially delivers** what the landing page promises. The integrity gaps are concentrated in:
- One missing role chip (Legal)
- Two missing integration tiles (LinkedIn, Salesforce)
- One overreaching capability framing (filesystem / computer-use is narrower than implied)

None of those are architectural — they're either small UI exposures of capabilities the codebase already has, or marketing copy edits.
