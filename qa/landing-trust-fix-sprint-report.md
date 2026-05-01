# Landing + Public Trust Fix Sprint — Completion Report

**Date:** 2026-04-30
**Scope:** Public landing page + GitHub README. **No backend/runtime/API/auth/DB changes.**

## What changed (files touched)

| File | Change |
|---|---|
| `apps/web/src/components/landing/HeroCockpit.tsx` | **NEW** — animated hero cockpit mockup (command → plan → agents → execute → approve → output → audit) |
| `apps/web/src/components/landing/index.ts` | Export `HeroCockpit` |
| `apps/web/src/app/page.tsx` | Mounted `HeroCockpit` in hero; **moved** Audit section below Live Execution; reframed Audit heading |
| `apps/web/src/components/landing/LiveDemo.tsx` | Rewrote 3 scenarios with real JAK roles (Commander / Planner / CEO / CMO / Research / Verifier / Approval / Audit Commander / Workpaper Writer); dropped the weak "scenario 1/3 \| 0/6 steps" footer |
| `apps/web/src/components/landing/ShowTheWork.tsx` | Expanded from 4 → **6 product-proof cards**, each with a concrete preview snippet (real artifact shape, not just description); fixed mobile column overflow |
| `README.md` | Softened the "6 Managed AI Providers" feature line to "OpenAI-first runtime" with optional fallback providers |

**No other files** were modified. No backend, no API, no DB schema, no planner / runner / agent code, no installer route, no socials route, no dashboard logic.

## Task-by-task results

### Task A — Public consistency

- **Tool counts**: every public surface consistently says **122**. Grep across `apps/web` and `README.md` finds zero stale `113 tools` references. Sole `113` hits are historical audit/QA docs (closure reports + test counts) — not live claims.
- **Anthropic / Claude positioning**: the landing page (`page.tsx`) has **zero** Anthropic/Claude references. README's "6 Managed AI Providers" line was reframed to lead with **"OpenAI-first runtime"** + Anthropic / Gemini / DeepSeek / Ollama / OpenRouter named honestly as **"optional fallback providers"** (they remain technically wired through the provider router, so removing them would be an under-claim).
- **CI gate** (`pnpm check:truth`): **passes** — 122 tools registered, 0 unclassified, all README badges + landing stats agree with the live registry.

### Task B — Hero visual rebuilt

New `HeroCockpit` component mounted directly under the hero CTA buttons. Six-stage animated reveal:

1. **Type command** — character-by-character: *"Research my top 3 competitors and draft a LinkedIn post"*
2. **Plan card** — 4 numbered rows with role badges (Research Agent, CMO Agent, Verifier, Approval)
3. **Agent execution row** — 3 chips light up sequentially with running/done states
4. **Approval card** — yellow-amber framed, shows tool name (`linkedin_publish`), files affected, expected payload preview, and "Replays with a different payload are rejected" microcopy
5. **Output card** — emerald-framed, 248-word draft snippet
6. **Audit ribbon** — orange, "Audit trail saved · HMAC-SHA256 verified · run #847"

12-second loop. Respects `prefers-reduced-motion` (renders the final frame statically via `useStillMode`). Mobile-fit confirmed at 343px column inside a 375px viewport with 0 horizontal overflow.

### Task C — Live Execution rebuilt

Three new scenarios that match the real JAK orchestration vocabulary:

1. **"Map our top 3 competitors and draft a CMO-voice LinkedIn post"** — Commander → Planner → Research Agent → CEO Agent → CMO Agent → Verifier → Approval → Audit
2. **"Review my landing page and propose 5 copy + design fixes"** — Commander → Planner → Browser Agent → Designer Agent → CTO Agent → Verifier → Approval → Audit
3. **"Help me draft a SOC 2 readiness summary from our last audit run"** — Commander → Planner → Audit Commander → Workpaper Writer → Verifier → Approval → Audit *(intentionally ends with Final Pack refused: 2 workpapers still pending — preserves the FinalPackGateError honesty signal)*

The weak `scenario 1/3 | 0/6 steps` footer is gone. Replaced with a clean progress fill + click-to-jump dots, and a one-line caption below the cockpit naming the three flows.

### Task D — Compliance rebalanced

Audit section moved from position **#5 (above Live Execution)** to position **#6 (below Live Execution, before Pricing)**. Heading reframed:

| Before | After |
|---|---|
| Eyebrow: "Audit & Compliance Pack" | "When you need audit-grade" |
| H2: "A SOC 2 audit you can actually finish." | **"Enterprise-grade auditability when you need it."** |
| Body: front-loaded with 182-control / 108-evidenced / 74-attestation breakdown | New lead: *"You don't need to think about SOC 2 on day one. Every workflow JAK runs is already tamper-evident, signed, and replayable — so when an enterprise customer asks, the evidence is already there."* The control breakdown is now in a smaller paragraph after the framework chips, no longer the lead. |

Section verified live: `#audit h2.textContent === "Enterprise-grade auditability when you need it."`, position #5 in the section index (between Live Execution at #4 and Pricing at #6).

### Task E — Six product-proof cards with previews

ShowTheWork expanded from 4 → 6 cards, each rendering a **concrete preview snippet** in the card body — the kind of artifact JAK actually produces, not a description of one:

| # | Card | Preview snippet |
|---|---|---|
| 1 | Competitor + market research brief | 3 competitor pills + 3 finding bullets with `[evidence: doc_3]` markers |
| 2 | LinkedIn post draft (your brand voice) | Quoted draft body + 3 hashtag chips + author checklist |
| 3 | Website review + 5 fixes mapped to source | Numbered list of file paths (`apps/web/.../page.tsx`, `components/Pricing.tsx`, `app/layout.tsx`) + sandbox-only note |
| 4 | Tool installer with approval gate | Approval card mock: tool name, sandbox runtime, allowlist ✓, REVIEWER+ required |
| 5 | Multi-platform social drafts (4 platforms) | 2x2 grid of LinkedIn/Instagram/YouTube/Meta tiles + manual handoff disclaimer |
| 6 | Tamper-evident audit trail (HMAC-signed) | Bundle-verified panel: 3 run IDs, 63 SOC 2 controls evidenced, signature `hmac:7a4c…f0d2 ✓` |

Each card carries 2 capability badges naming a real subsystem (`Citation density ≥ 0.7`, `pgvector RAG`, `Manual handoff required`, `Sandboxed subprocess`, `REVIEWER+ gate`, `4 adapters wired`, `Never auto-publishes`, `HMAC-SHA256 signed`, `Replay-safe approval`) — every one greppable in code.

### Task F — UX polish

- **Mobile overflow fix** — caught a real layout bug during verification: cards computed to a 369.5px track inside a 343px container on mobile (clipped under landing-root's `overflow-x-hidden`). Fixed by adding explicit `grid-cols-1` on the proof grid + `min-w-0` on each article. Verified post-fix: track 343 → article 340 → 0px overflow.
- **README "6 Managed AI Providers" → "OpenAI-first runtime"** softening preserves the technically-true fallback list without leading with co-equal Anthropic billing.
- **Cockpit caption microcopy** added below the Live Execution cockpit: *"Three real flows in rotation: competitor research + LinkedIn draft · website review + fixes · SOC 2 readiness summary"*.

### Task G — Final gates

| Gate | Result |
|---|---|
| `pnpm --filter @jak-swarm/web typecheck` | ✓ clean |
| `pnpm --filter @jak-swarm/web lint` | ✓ clean |
| `pnpm check:truth` | ✓ **122 tools, 0 unclassified** |
| Mobile (375x812) horizontal overflow | ✓ **0px** |
| Desktop (1280x800) dark-mode | ✓ 3-col proof grid, cockpit 896px centered, no overflow |
| Hero CTA `/register` reachable | ✓ verified via DOM query |
| GitHub CTA `github.com/inbharatai/jak-swarm` reachable | ✓ verified via DOM query |
| Audit CTA `/audit/runs` reachable | ✓ verified via DOM query |
| Section order | ✓ Hero → WhatJakDoes → ShowTheWork → Workflow → **Live Execution** → **Audit (reframed)** → Pricing → Final CTA |
| `<HeroCockpit>` renders | ✓ `cockpitPresent: true`, 4 plan rows present |
| ShowTheWork card count | ✓ **6** |
| Audit H2 text | ✓ `"Enterprise-grade auditability when you need it."` |

## Public-claim consistency check

| Claim | Source of truth | Landing | README | Status |
|---|---|---|---|---|
| Tool count | `toolRegistry.list().length` | 122 (`product-truth.ts`, `PremiumCTA.tsx`) | 122 (badge + headline + Tools table) | ✓ consistent |
| Agent count | `AgentRole` enum | 38 (`product-truth.ts`, `PremiumCTA.tsx`) | 38 (headline) | ✓ consistent |
| Frameworks / controls | `seed-data/compliance-frameworks.ts` | 63 + 37 + 82 = 182 | matches | ✓ consistent |
| LLM positioning | `provider-router.ts` | OpenAI-first (Pro: "Premium OpenAI model routing"; Team: "Managed OpenAI runtime") | "OpenAI-first runtime" with optional fallbacks | ✓ consistent |

## Known limitations / honest deferrals

- **Static screenshots** could not be captured — `mcp__Claude_Preview__preview_screenshot` timed out 3× even after pausing animations and resizing. Verification was performed via the preview's preferred path (a11y-tree DOM queries + `preview_inspect`-style style reads + `clientWidth`/`scrollWidth` overflow checks). Every assertion in the table above was verified live.
- **Hero cockpit is a marketing animation, not a real workflow** — the buttons (`Approve & publish` / `Reject`) are non-interactive (`tabIndex={-1}`, `cursor: 'default'`). The actual cockpit lives at `/workspace`. This is intentional — running a real workflow on the hero would require auth + LLM credits + would be unstable on first paint.
- **Pre-existing console warnings** (Next.js 16 "script tag" hydration error, `useVoice` failed-fetch on auth pages) are NOT introduced by this sprint. They were already documented in `apps/web/src/components/layout/AppShell.tsx:20-22` as a known Next.js 16 issue.
- **Pre-existing settings UI** still lists Anthropic as a provider option (`apps/web/src/modules/settings/index.tsx:22`). Left as-is because Anthropic is technically still wired as a fallback in the provider router — removing the option would be a code/feature change outside this sprint's scope.

## Confirmation

> Only the public landing page and GitHub README were modified. No backend code, no APIs, no auth, no database, no planner / runner / agents, no social / installer / dashboard logic was touched.

Backend production wiring shipped at commit `c596412` (Sprint 6) remains 100% intact.
