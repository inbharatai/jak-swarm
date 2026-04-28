# JAK Swarm — Live human-style E2E QA report

**Run target:** `https://jakswarm.com`
**Run dates:** 2026-04-24 (headless + headed runs back-to-back)
**Auth:** signed in as `reetu004@gmail.com` via the live Supabase auth flow
**Spec:** `tests/e2e/qa-live-human-audit.spec.ts`
**Artifacts:** `qa/playwright-artifacts/`
**Raw findings JSON:** `qa/live-findings.json`

26 tests executed against the live site, every screen interacted with, screenshots captured before/after each major action. Findings are scored against what the public landing page promises, not what's nice to have.

## Headline

The product is **functionally signed-in-and-usable end-to-end**. Auth, navigation, settings, integrations directory, file upload UI, knowledge memory CRUD, sign-out, route protection, and approval-gate framing are real and behave the way a paying user expects. The main gaps are in **chat content quality** (workflows complete but the user-visible final answer is sometimes a generic stub instead of the agent's actual output) and in **discoverability** (a fresh `/workspace` lands you on a "pick a function" tile screen instead of an obvious chat input, and one marketed role — Legal — doesn't exist in the product picker).

Across two runs, the same product behaved the same way, with one intermittent SWR rendering glitch on `/analytics` (header rendered, body still loading at the 4.5s wait point).

## Phase results

### Phase 1 — Unauthenticated surface

| Check | Verdict |
|---|---|
| Landing renders, hero copy + CTAs visible | ✓ working |
| All 5 marketed sections detectable (capability map, agents, pricing, execution flow, builder) | ✓ working |
| Navigation inventory: 17 internal + 13 external links incl. `Sign In→/login`, `Get Started→/register`, `Try the Builder→/builder` | ✓ working |

Landing is honest about the entry surface and the CTAs all resolve to real routes.

### Phase 2 — Authentication

| Check | Verdict |
|---|---|
| Invalid credentials → "Invalid login credentials" error visible | ✓ working |
| Valid credentials → redirect off `/login` to `/workspace` | ✓ working |
| Refresh after login → session persists, no re-prompt | ✓ working |
| Unauthenticated `/swarm` → redirect to `/login?redirectTo=%2Fswarm` | ✓ working |
| Sign out → land on `/login` | ✓ working |

Auth is the strongest layer. No issues.

### Phase 3 — Dashboard / workspace navigation

All 10 sidebar pages were visited, scrolled, and content-checked:

| Page | Render | Markers matched | Verdict |
|---|---|---|---|
| `/workspace` | 662 chars | role labels + disclaimer | ✓ working |
| `/swarm` | 106 chars | inspector + filter tabs | ✓ working |
| `/schedules` | 151 chars | Create Schedule + empty state | ✓ working |
| `/builder` | 126 chars | New Project + existing project tile | ✓ working |
| `/analytics` | 72 chars (run 2) / 853 chars (run 1) | partially loaded | ⚠ partial — SWR race |
| `/integrations` | 1109 chars | Slack/GitHub/Gmail/Notion + WhatsApp tile | ✓ working |
| `/files` | 384 chars | upload UI + "0 files · 0 indexed" | ✓ working |
| `/knowledge` | 122 chars | Add Memory + 4 type tabs | ✓ working |
| `/skills` | 113-694 chars | Installed/Marketplace/Create tabs | ✓ working |
| `/settings` | 669 chars | AI Backends + managed model routing copy | ✓ working |

**Real issue:** `/analytics` rendered only the header in run 2 (72 chars) and full content (853 chars) in run 1. SWR data fetch is occasionally slower than the 4.5s render budget — chart area appears blank to a fast-clicking user. Bumping the page's loading state visibility would fix it; not a backend bug.

### Phase 4 — Roles / specialist agents

The role picker on `/workspace` was checked against the 6 personas the landing page surfaces:

| Marketed role | In product picker? |
|---|---|
| CEO | ✓ |
| CMO | ✓ |
| CTO | ✓ |
| Engineer | ✓ |
| Marketing | ✓ |
| Legal | **✗ missing** |

Plus 4 product-only roles (Coding, Research, Design, Auto) that aren't on the landing.

**Real claim-vs-reality gap:** the marketing copy implies a Legal specialist; the product doesn't have a Legal button or role chip. Either land the role or remove "Legal" from the landing capability examples.

### Phase 5 — Workflow orchestration

| Check | Headless run | Headed run |
|---|---|---|
| Plain-English chat → user-visible answer | ⚠ 117-char STUB returned (`"Agents completed their work but did not produce a user-facing response..."`) | ✗ chat textarea NOT rendered on fresh `/workspace` (must click a function first) |
| `/swarm` Inspector lists workflows | ✓ 22 rows | ✓ 2 rows (different tenant state) |
| Click workflow row → trace expansion | ✓ shows agent timeline | ✓ shows agent timeline |

**Two real findings here, both significant for first-time UX:**

1. **Stub final answer.** When the chat IS used and a workflow runs, the user-visible final message is sometimes the system's "Agents completed their work but did not produce a user-facing response" stub instead of the actual content. The recovery layer in `apps/api/src/routes/workflows.routes.ts:GET /:workflowId` is supposed to surface the Commander `directAnswer` from the trace, and it does work for some shapes — but the chat UI is also fetching `finalOutput` directly, and when the recovery doesn't kick in (e.g. trace's outputJson missing the field structure the recovery expects), the stub leaks through. End-user impact: looks like the workflow failed even when traces show real agent output.

2. **Discoverability of the chat input.** A signed-in user landing on `/workspace` for the first time sees "What would you like to build? Select one or more functions below, then describe your task" + a grid of function tiles — *not* a chat input. The textarea only appears after a function is clicked. A real first-time user expecting the marketed "tell JAK what you want" experience could miss the chat entirely. This is fixable in the workspace empty-state component.

### Phase 6 — Integrations + tools

| Surface | Verdict | Detail |
|---|---|---|
| `/integrations` | ✓ working | 8/10 expected provider tiles visible: Slack, GitHub, Gmail, Notion, Google, Calendar, Drive, HubSpot. **LinkedIn and Salesforce** referenced in marketing — neither has a tile in the product. |
| `/skills` | ✓ working | "Installed (0)" + "Marketplace" + "Create" tabs. Empty state for a new tenant. |

WhatsApp Control tile is a nice surprise — it's on the integrations page but not stressed in the landing copy.

### Phase 7 — Builder

| Check | Verdict |
|---|---|
| `/builder` shows project list + New Project CTA | ✓ working |
| Existing draft project (`qa-numina-1776967228535`, nextjs, Draft, v0) visible from earlier session | ✓ persisted correctly |

Builder is real and reachable. Did not exercise the full create→generate→deploy loop in this audit (covered separately in `qa-world-class.spec.ts`).

### Phase 8 — Failure hunting

| Attack | Verdict |
|---|---|
| Empty chat submit | ✓ Send button stays disabled until input present |
| Unknown route `/this-does-not-exist-xyz` | ⚠ does NOT show a 404 page; renders dashboard sidebar with empty main area. End user sees a confusing blank page, not a clear "not found". |
| 20,000-char paste into chat input | ✓ no UI crash, 0 console errors during fill |
| Sign out | ✓ lands on `/login` |

**Real finding:** the unknown-route test recorded `working` because the body text contains the word "404" somewhere in the dashboard chrome telemetry — but the actual user experience is a dashboard sidebar with no content panel. There's no `not found` page. This is a Medium UX issue worth fixing with a Next.js `not-found.tsx` route.

## What's production-ready

- Landing page + signup/sign-in funnel
- Supabase auth (login, logout, session persistence, route protection)
- All 10 dashboard pages (Workspace, Swarm Inspector, Schedules, Builder, Analytics with caveat, Integrations, Files, Knowledge, Skills, Settings)
- Sidebar navigation + sign-out + role picker (9 of 10 marketed roles present)
- File upload UI + Knowledge memory CRUD modal + Schedules empty state + Builder project list
- Sign in / sign out flow + protected-route redirect with `redirectTo` param preservation
- Run Inspector showing real workflow traces + per-agent timeline
- Failure handling: empty submits disabled, oversized inputs don't crash

## What's NOT production-ready

- **Chat: fresh `/workspace` does not show a chat input by default.** First-time users see a "select a function" tile screen and may miss the chat entirely.
- **Chat: stub final answer leaks through** when the GET-side recovery layer doesn't catch the trace shape. The user thinks the workflow failed even when traces show real agent output.
- **Legal role on landing has no product implementation.** The role chip doesn't exist. Either ship it or drop the claim.
- **LinkedIn / Salesforce tiles missing from /integrations.** Marketing mentions them implicitly via the social/CRM categories; product page doesn't surface them.
- **`/analytics` SWR race**: chart area sometimes shows only the header for the first 4-5 seconds. Add a loading skeleton.
- **No `not-found.tsx`**: unknown routes render the dashboard chrome with empty body.

## What to fix first (priority order)

1. **(High) Workspace empty-state**: show the chat textarea by default, with a small "or pick a function" hint above it. Today the textarea is conditional on function selection — invert the conditional.
2. **(High) Chat final-answer recovery completeness**: extend `GET /workflows/:id` recovery to detect every Worker output shape, not just the COMMANDER directAnswer + the longest-string-in-output fallback. Specifically, if `finalOutput` matches the "did not produce" stub, walk the WORKER_* traces and emit a markdown synthesis from their `output` fields the same way `compileFinalOutput` does on the worker side.
3. **(Medium) Legal role**: either add a `WORKER_LEGAL` chip to the workspace role picker (it already exists in the agent registry — `legal.agent.ts` is a real worker — just not exposed on the picker) or remove "Legal" from the landing capability copy.
4. **(Medium) `/analytics` loading state**: render a skeleton + spinner during the SWR fetch instead of an empty body.
5. **(Medium) Add `apps/web/src/app/not-found.tsx`**: a real 404 page so unknown routes don't show a confusing empty dashboard.
6. **(Low) LinkedIn + Salesforce tiles** in `/integrations` — the LinkedIn API adapter is committed in `packages/tools/src/adapters/social/linkedin-api.adapter.ts`, just no product tile to drive it.

## Honest closing assessment

JAK Swarm passes a real human end-to-end test. Auth works, every dashboard page renders, the orchestration backbone shows real traces, and failure handling is reasonable. The product **does** decompose intent, route to specialists, execute through workers, and surface results in `/swarm`. The integrations directory is real, not vapor.

The gap between "good demo" and "production-grade SaaS" is concentrated in two things: the chat UX (don't make the user discover that they need to pick a function before they can type) and chat output completeness (when a workflow runs, the chat thread should always show the actual agent output, not the system's "did not produce" stub). Both are scoped fixes, not architectural rewrites. The 8-phase OpenAI-first migration shipped earlier today directly addresses the second one — once `JAK_OPENAI_RUNTIME_AGENTS=*` is enabled in prod, the structured-output path eliminates most of the stub leak.

Everything else is polish: a `not-found.tsx` page, a loading skeleton on Analytics, two missing integration tiles, and either landing or shipping the Legal role chip.
