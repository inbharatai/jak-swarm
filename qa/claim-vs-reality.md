# JAK Swarm — Landing claim vs. product reality (A-to-Z edition)

Every row cross-checked with a headed Playwright run on 2026-04-24. Supersedes `qa/live-claim-vs-reality.md` for the items re-tested; retains older verdicts where the A-to-Z pass didn't re-exercise.

## Verdict legend

- **Real** — claim is true, observable in the product
- **Real (caveat)** — true with a specific UX/completeness gap
- **Partial** — capability is in the codebase or backend, but not fully surfaced to the user
- **Misleading** — landing implies more than the product delivers
- **Missing** — claim has no observable implementation

## Claim table

| # | Landing claim | Reality (A-to-Z verified) | Evidence |
|---|---|---|---|
| 1 | "The trusted control plane for autonomous work" | **Real (caveat)** — auth + RBAC + approval gates + audit-log persistence all real. "Trusted" framing holds, BUT the chat doesn't visibly show approval state or agent DAG, so the *perception* of control is weaker than the reality. | `roles/ceo-final.png`, `workflows/audit-trace-list.png` |
| 2 | "Decomposes intent, routes to the right capabilities, executes in parallel" | **Real on the backend.** The Commander → Planner → Router → Worker → Verifier pipeline is visible in `/swarm` traces for every run. Parallel fan-out capped at 5 concurrent workers per batch. | `workflows/audit-trace-list.png` (22 rows, per-agent timeline) |
| 3 | "Delivers results" | **Broken.** 10/10 tests: workflow reaches `completed`, worker output exists in the trace, chat renders the generic "did not produce a user-facing response" stub. | `roles/*-final.png` (all 8), `a-to-z-findings.json` findings 1-8 |
| 4 | Specialist agents — CEO, CTO, CMO, Engineer, Legal, Marketing | **Partial.** 5 of 6 present in role picker (CEO ✓, CMO ✓, CTO ✓, Engineer ✓, Marketing ✓). **Legal still missing** — `legal.agent.ts` exists in the codebase but has no role chip. | `roles/*-role-selected.png` |
| 5 | Bonus product-only roles (Coding / Research / Design / Auto) not on landing | **Real (under-promised).** All 4 present in picker. | `roles/{coding,research,design,auto}-role-selected.png` |
| 6 | "Approvals on high-risk actions" | **Backend real, UI missing.** `approval-node.ts` blocks by default; `POST /approvals/:id/decide` exists. BUT in chat, prompts that should trigger the approval state ("send an email now") return the stub, not an approval card. | P5.F finding in `a-to-z-findings.json` |
| 7 | "Audit / event / trace visibility" | **Real.** `/swarm` lists every workflow with status, age, duration, agent count. Clicking a row expands the per-agent timeline. **This is the strongest surface in the product.** | `workflows/audit-trace-list.png`, `workflows/audit-trace-expanded.png` |
| 8 | "Memory across runs" | **Real.** `/knowledge` Knowledge Console has Add Memory modal + 4 type tabs (FACT / PREFERENCE / CONTEXT / SKILL_RESULT). CRUD works. Confirmed in earlier run. | carried over from `qa/live-claim-vs-reality.md` |
| 9 | "Recovery / self-healing retries" | **Real (caveat).** Verifier retries up to 2×, Replanner runs once per workflow. But retries are **silent** in the chat — user sees no "retrying…" narration, so failures look like hangs. | `/swarm` traces show retry counts; chat does not |
| 10 | "Builder flow — describe it, see it, deploy it" | **Real.** Live-tested: created project via modal, `POST /projects` → 201, redirected to `/builder/:id` with editor + prompt + file tree + checkpoint timeline rendered. Did not drive through to deploy in this run. | `workflows/builder-*.png` |
| 11 | "Live execution traces" | **Real.** Every `/swarm` row has a per-agent timeline. Real. | `workflows/audit-trace-expanded.png` |
| 12 | "122 tools" with maturity labels | **Real but narrow UI exposure.** Registry has 122 tools, landing page now discloses maturity breakdown. BUT `/skills` still shows "Installed (0)" for a new tenant — the 122 built-ins aren't surfaced there. | `qa/playwright-artifacts/p3-nav/skills-landing.png` (prior run) |
| 13 | Schedule workflows | **Partial.** Backend runs the workflow, but chat-triggered schedule requests do NOT persist to `/schedules`. Page stays empty. | `workflows/schedules-after-cmo.png`, finding 10 |
| 14 | Voice → workflow | **Real (not UI-exercised in this run).** `voice.routes.ts:trigger-workflow` exists, requires `OPENAI_API_KEY`. | carried over |
| 15 | Browser / docs / CRM / research / memory / calendar / email / spreadsheets / code / voice (capability map) | **Real (category-level).** At least one working tool in each category. Browser via Playwright (27 tools), sandbox via E2B/Docker (7 tools). | code audit |
| 16 | Implied "filesystem capability" | **Misleading.** No local-FS tools in the registry. Only sandbox-virtual-FS tools operate inside E2B/Docker. | unchanged since prior audit |
| 17 | Implied "computer / desktop control" | **Missing.** No computer-use tools wired to the default runtime. The OpenAIRuntime adapter committed this session supports `computer-preview` via `HostedToolsConfig` — but the flag is dormant. | `/version` shows `openaiRuntimeAgents=[]` |
| 18 | LinkedIn integration | **Missing from UI.** `linkedin-api.adapter.ts` + `post_to_linkedin` tool are in the codebase; no tile on `/integrations`. | carried over — `qa/live-bug-matrix.md#M2` |
| 19 | Salesforce integration | **Missing.** No adapter, no tile. HubSpot covers CRM partially. | carried over |
| 20 | Pricing page | **Real (not re-tested in this run).** | unchanged |
| 21 | File upload + "find_document" tool | **Real with UX gap.** Upload UI works; `.exe` is rejected server-side with 415 (good), but UI does not show a user-visible error. | `failures/invalid-filetype.png` |

## Sourcing notes

- "Landing claim" column paraphrased from the public landing page as rendered to an unauthenticated visitor on 2026-04-24.
- "Reality" is from the signed-in product observed via headed Playwright. Every row has a pointer to the artifact that backs it.
- `/version` and `/health` pulled live from the API at `https://jak-swarm-api.onrender.com`.

## What changed since the prior claim-vs-reality pass

- **New HIGH:** Chat scheduling does not persist to `/schedules` (claim #13 went from unverified to Partial).
- **Confirmed deterministic (not intermittent):** Stub-leak on chat final answer is 10/10 reproducible; the prior audit called it intermittent — this one confirms it's the default state on the legacy runtime.
- **Backend migration status surfaced:** `/version` explicitly shows the flags are `legacy` / `swarmgraph`, which explains why the stub-leak is deterministic in prod.
- **Builder went from "seen, not exercised" to "created end-to-end" (working through detail page).**
- **Mobile viewport** confirmed working at 390px.
- **100k-char paste** confirmed not crashing.

## Bottom line

The landing page describes an accurate architecture with a truthful capability map. The specific claims that break down under scrutiny are:

- Chat "delivers results" — no, it delivers stubs when legacy runtime is active
- "Approvals" — real in code, invisible in chat
- "Legal" specialist — real in code, missing from picker
- LinkedIn / Salesforce — marketing-only, no product tile
- "Desktop/computer" framing — hosted computer-preview tool supported but not wired in prod

None of those are architectural. Four of the five are one-session fixes.
