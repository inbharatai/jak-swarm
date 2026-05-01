# Landing Rebuild — Premium Conversion-Focused Refresh

**Date:** 2026-04-30
**Scope:** Public landing page only.
**Touched:** ZERO backend / runtime / API / auth / DB / agent / dashboard files.

## Summary of what changed

The landing page was rebuilt to a 9-section premium structure that visually communicates the JAK loop instead of explaining it. The previous page felt like a long-form README; the new page reads as a product page that shows the magic up front, frames the pain, walks through the pipeline visibly, demonstrates the cockpit, lists outcomes, anchors trust, then closes with compliance + pricing.

**Before:** Hero + 3-pillar block + 4 outcome cards + 5-icon workflow strip + terminal-style live demo + audit panel + pricing + CTA.

**After:**
1. **Hero** — new headline, subhead, CTAs + animated cockpit asset (kept from prior sprint, prominently mounted as the main hero asset)
2. **PainSection** *(new)* — "AI chat gives answers. JAK gets work done." + 3 pain-vs-fix cards
3. **HowItWorks** *(new, 7 steps)* — Command → Plan → Route → Execute → Approve → Verify → Deliver
4. **ProductCockpit** *(new, premium dashboard mockup)* — left rail (command + recent runs) + center (live agent graph with 6 nodes + animated edges) + right rail (approval card + output preview) + bottom (audit timeline)
5. **ShowTheWork** *(reduced 6 → 4 cards)* — competitor research, LinkedIn + outreach drafts, website review + fixes, audit-ready evidence pack — each with a concrete preview snippet
6. **TrustLayer** *(new, 6 trust points)* — approval gates, source-grounded outputs, tool maturity labels, audit trail, self-hostable open-source core, OpenAI-first runtime
7. **Audit & Compliance** *(reframed, kept)* — "Enterprise-grade auditability when you need it." moved AFTER trust layer
8. **Pricing** *(visually rebuilt)* — height-aligned cards (every card 480px), Pro stands out via border + glow + badge (no awkward `scale-105`), OpenAI-consistent tier descriptions
9. **PremiumCTA** *(new copy)* — "Stop chatting with AI. Start operating with it."

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/landing/PainSection.tsx` | **NEW** — 3 pain-vs-fix cards |
| `apps/web/src/components/landing/HowItWorks.tsx` | **NEW** — 7-step pipeline with numbered icon discs + animated connector glow |
| `apps/web/src/components/landing/ProductCockpit.tsx` | **NEW** — premium dashboard mockup with 4 panels (left/center/right/bottom audit) |
| `apps/web/src/components/landing/TrustLayer.tsx` | **NEW** — 6 trust guarantees with greppable code references |
| `apps/web/src/components/landing/index.ts` | Re-exports updated; stops exporting `LiveDemo` + `WhatJakDoes` (kept on disk for reuse on /docs) |
| `apps/web/src/app/page.tsx` | Hero copy rewritten; section order rebuilt; pricing card layout improved (height parity); old inline workflow strip removed; nav anchors updated (`#workflow` → `#how-it-works`) |
| `apps/web/src/components/landing/ShowTheWork.tsx` | Reduced 6 cards → 4 (per spec). Two card types removed (Tool installer + Multi-platform social) — both surfaces still ship in the product, they just don't need their own homepage tile |
| `apps/web/src/components/landing/PremiumCTA.tsx` | New headline + subtext per spec |

**Not touched** (per the rules in the brief):
- Backend (`apps/api/**`)
- Database / Prisma schema (`packages/db/**`)
- Auth / Supabase (`apps/web/src/lib/auth.ts`, `lib/supabase*`)
- Agent runtime (`packages/agents/**`, `packages/swarm/**`)
- API routes (`apps/api/src/routes/**`)
- Dashboard (`apps/web/src/app/(dashboard)/**`)
- Pricing logic (only the marketing card content changed; billing services untouched)
- Deployment files (`docker-compose*`, `render*`, `Dockerfile*`)

`git status` confirms only README.md + landing files + auto-generated artifacts (next-env.d.ts, audit reports) changed.

## Before / after reasoning

| Issue with before | Fix |
|---|---|
| Page read as a technical README turned into a webpage | Replaced 3-pillar capability block + 5-icon workflow strip with a 7-step animated pipeline + a multi-panel cockpit mockup. Visitors *see* the loop instead of reading bullet lists about it |
| Hero had no product visual showing the magic | The hero now mounts `HeroCockpit` directly under the CTAs — a 6-stage animated reveal (command → plan → agents → approval → output → audit) that runs in a 12-second loop |
| No "why chat fails" framing — page assumed visitors already knew the value | Added `PainSection` with 3 pain-vs-fix cards that name exactly what's broken about chat-only AI, then point at JAK's specific solution |
| Compliance dominated the third fold (SOC 2 framework chips above the live demo) | Moved Audit section *after* the Trust Layer. New heading: "Enterprise-grade auditability when you need it." Lead copy: *"You don't need to think about SOC 2 on day one"* |
| Pricing cards were unequal heights (Free had 6 features, others had 7 → cards visibly different sizes) | Switched to `flex flex-col h-full` + CTA pinned via `mt-auto` → every card is exactly 480px tall, measured live |
| Pro tier emphasized via `lg:scale-105` made it both wider AND taller, mis-aligning the row | Removed `scale-105`. Pro now stands out via thicker emerald border (1.5px) + radial glow + badge — same dimensions, premium feel, no awkward larger column |
| Provider language was inconsistent (Free said "Standard AI models", Pro said "Premium OpenAI", Team said "Managed OpenAI", Enterprise didn't mention models) | All four tiers now consistent: Free = "Bring-your-own OpenAI key", Pro/Team/Enterprise = "Managed OpenAI runtime". Anthropic / Gemini / DeepSeek / Ollama / OpenRouter remain wired in code as fallback but no longer surface as marketing language anywhere on the page |
| Live execution panel showed a weak "scenario 1/3 \| 0/6 steps" footer that read like a slideshow indicator | LiveDemo dropped from homepage entirely. Its role (showing live agent execution) is now better served by the `ProductCockpit` dashboard mockup which shows the full multi-panel cockpit, not just a scrolling terminal |
| 6 outcome cards in a 3×2 grid felt content-heavy | Reduced to 4 (per spec). The previously-shipped Tool installer + Multi-platform social cards were removed from the homepage but their underlying Sprint 6 wiring is unchanged in the product |

## Tests run

| Gate | Result |
|---|---|
| `pnpm --filter @jak-swarm/web typecheck` | ✓ clean (0 errors) |
| `pnpm check:truth` | ✓ **122 tools registered, 0 unclassified** |

**Browser verification** (preview server on `localhost:3000`, run via the preview tool):

| Check | Mobile (375×812) | Tablet (768×1024) | Desktop (1280×800, dark) |
|---|---|---|---|
| Horizontal overflow | ✓ 0px | ✓ 0px | ✓ 0px |
| PainSection grid cols | 1 | 3 | 3 |
| HowItWorks grid cols | 2 | 3 | 7 |
| ProductCockpit body grid | 1 | 1 | `230px / 650px / 270px` 3-col |
| Outcomes grid cols | 1 | 2 | 2 (4 cards in 2×2) |
| Trust grid cols | 1 | 2 | 3 (6 points in 2×3) |
| Pricing grid cols | 1 | 2 | 4 |
| Pricing card height parity | n/a | n/a | ✓ **480px / 480px / 480px / 480px** (heightSpread = 0) |
| Hero `<HeroCockpit>` rendered | ✓ | ✓ | ✓ |
| ProductCockpit graph nodes | 6 | 6 | 6 |

**Section order live** (DOM-verified, in order):
1. PainSection — *"AI chat gives answers. JAK gets work done."*
2. HowItWorks — *"Seven steps from intent to delivered work."*
3. ProductCockpit — *"Every workflow, one operating surface."*
4. ShowTheWork — *"Finished work, not chat output."*
5. TrustLayer — *"Built for controlled autonomy."*
6. Audit — *"Enterprise-grade auditability when you need it."*
7. Pricing — *"Transparent pricing. Open-source core."*
8. PremiumCTA — *"Stop chatting with AI. Start operating with it."*

**CTAs verified reachable:**
- Hero `Start Free` → `/register` ✓
- Hero `View on GitHub` → `github.com/inbharatai/jak-swarm` ✓
- Pricing Free / Pro / Team → `/register` (3 links) ✓
- Pricing Enterprise → `mailto:contact@inbharat.ai` ✓
- Audit `Open Audit Workspace` → `/audit/runs` ✓

**Typography / contrast spot-checks:**
- All 7 `.landing-gradient-text` instances have `padding-bottom: 0.22em` + `overflow: visible` + line-height ≥ 1.18 → no descender clipping (e.g. `g` in "operating", `p` in "pipeline")
- Pricing "Most Popular" badge: dark text (`rgb(9, 9, 11)`) on emerald-amber gradient → high contrast
- All 6 ProductCockpit graph nodes render with state-correct colors (3 done emerald, 1 running pink, 2 queued slate)

## Honest claims

Every quantitative claim on the page passes the truth-check CI gate:

| Claim | Source of truth | Status |
|---|---|---|
| 38 specialist agents | `AgentRole` enum | ✓ matches `product-truth.ts` + `PremiumCTA.tsx` stat |
| 122 classified tools | `toolRegistry.list().length` | ✓ matches everywhere (badge + headline + stat) |
| 20+ connectors | `INTEGRATIONS_CORE + INTEGRATIONS_INFRA` count | ✓ matches |
| Open-source / MIT | `LICENSE` | ✓ |
| Approval gates | `approval-node.ts` (payload-bound) | ✓ |
| Audit trail | `audit-log` plugin + `bundle.service.ts` | ✓ |
| Tool maturity labels | `check:truth` CI gate (122 / 0 unclassified) | ✓ |
| OpenAI-first runtime | `openai-runtime.ts` (Responses API) | ✓ |

## Known limitations

- **Screenshots could not be captured.** `mcp__Claude_Preview__preview_screenshot` consistently times out (3+ minutes per retry) on this preview pane even after pausing animations. Verification was performed via the preview tool's preferred path (a11y DOM queries + computed-style reads + overflow checks). Every assertion in the test table above was verified live against the running browser. If you want raw image artifacts, run `pnpm exec playwright test tests/e2e/landing-screenshots.spec.ts` (the existing screenshot harness) against the dev server.
- **Hero cockpit + product cockpit are marketing animations, not interactive workflows.** The "Approve" / "Reject" buttons inside both cockpits are non-interactive (`tabIndex={-1}`, `cursor: 'default'`). The actual cockpit lives at `/workspace`. This is intentional — driving a real workflow on the marketing page would need auth + LLM credits + would be unstable on first paint.
- **HowItWorks on mobile uses 2 columns**, which leaves the 7th step on its own row. Single-column would be cleaner but would push the section to ~7 screens of vertical scroll on phone. Acceptable trade-off; can be revisited if mobile UX testing surfaces a complaint.
- **Pre-existing console warnings** (Next.js 16 "script tag" hydration error, `useVoice` failed-fetch on auth pages) are NOT introduced by this rebuild. They were already documented in `apps/web/src/components/layout/AppShell.tsx:20-22` as known Next.js 16 issues.
- **`LiveDemo.tsx` and `WhatJakDoes.tsx` files remain in `/components/landing/`** but are no longer exported from `index.ts` and are no longer rendered on the homepage. Deleting them is a separate cleanup; keeping them in the folder lets us reuse them on `/docs` or marketing sub-pages without re-implementation.

## Confirmation

> **Only the public landing page (`apps/web/src/app/page.tsx`), the landing component folder (`apps/web/src/components/landing/*`), and the README's "6 Managed AI Providers" line were modified.**
>
> No backend, no APIs, no auth, no database, no agents, no runtime, no dashboard, no pricing/billing logic, no deployment files were touched. `git status` shows only landing-page files plus auto-generated artifacts.

Sprint 6 production wiring (commit `c596412`) and the Phase-1 OpenClaw extraction work (commits up to `255153c`) remain 100% intact.
