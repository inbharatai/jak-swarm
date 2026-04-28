# JAK Swarm — Feature readiness matrix

Every named capability bucketed. Based on the 2026-04-24 A-to-Z audit plus prior `qa/live-human-e2e-report.md`. When classifications differ between a chat surface and a backend, the row reflects the **user-visible** state (that's the bucket that matters for shipping).

## Legend

| Tier | Meaning |
|---|---|
| **Production-ready** | User can find it, use it, complete the happy path, and no HIGH-severity bug observed. |
| **Beta** | Works for the primary use-case but has a specific UX gap or edge-case failure. User would still succeed. |
| **UI-only** | The page exists and looks complete but the backend action doesn't actually execute or persist. |
| **Backend-only** | The capability is real in the server / registry but has no user-reachable UI surface. |
| **Broken** | User-reachable but fails deterministically or shows misleading output. |
| **Missing** | Claimed or implied by marketing, no implementation observed. |

## Matrix

| # | Feature | Tier | Evidence | Notes |
|---|---|---|---|---|
| 1 | Landing page (hero, capability map, CTAs, pricing link) | **Production-ready** | prior audit | Honest copy, CTAs route correctly |
| 2 | Supabase Auth (login, session, route protect, sign out) | **Production-ready** | prior audit findings 3-7 | Zero issues in two full runs |
| 3 | Dashboard shell + sidebar navigation (10 pages) | **Production-ready** | prior audit Phase 3 | All 10 routes render |
| 4 | `/swarm` Run Inspector (list + expand + per-agent timeline) | **Production-ready** | `workflows/audit-trace-list.png` + expanded | The strongest surface in the product |
| 5 | `/health` + `/version` endpoints | **Production-ready** | findings 17-18 | db=ok, redis=ok, commit visible |
| 6 | Input resilience (100k paste, mobile viewport, refresh) | **Production-ready** | findings 20-22 | No crashes, no console errors |
| 7 | `/builder` project creation → detail page | **Beta** | finding 11 | Create flow works; full generate→deploy not exercised here |
| 8 | `/files` upload UI | **Beta** | finding 12 | UI works; `.exe` rejection is silent to the user |
| 9 | `/knowledge` Knowledge Console (CRUD memory) | **Beta** | prior audit | Tabs + modal + save work; UX polish opportunity |
| 10 | `/schedules` page (list view) | **Beta** | finding 10 (contextual) | Empty state renders; creation via modal not exercised here |
| 11 | Role picker (8 of 9 marketed roles) | **Beta** | `roles/*-role-selected.png` | Legal is missing (bug H3) |
| 12 | `/integrations` directory | **Beta** | prior audit | 8 tiles visible; LinkedIn + Salesforce absent |
| 13 | `/settings` AI Backends view | **Beta** | prior audit | Renders + masks keys; owner-only correctly gated |
| 14 | `/analytics` (period tabs + charts) | **Beta** | prior H4 | SWR race on cold load — header-only for 4-5s |
| 15 | Chat final-answer rendering | **Broken** | findings 1-8, 13-14 | Stub leak 10/10 deterministic on legacy runtime |
| 16 | Chat-driven schedule persistence (`/schedules` row creation from CMO prompt) | **Broken** | finding 10 | No DB row created; page stays empty |
| 17 | Approval gate UI (pending-approval card + sidebar drawer in chat) | **UI-only** (surface missing) | finding 15 | Backend `approval-node.ts` real; chat doesn't render it |
| 18 | `/skills` page — listing installed tools | **UI-only** | prior M4 | 122 tools in registry; Skills tab shows Installed(0) |
| 19 | Unknown-route handling (`/not-exist-xyz`) | **Broken** | prior M1 | Dashboard shell + empty main panel, no 404 |
| 20 | Legal specialist role chip | **Backend-only** | prior H3, finding set | `legal.agent.ts` worker exists; no role chip |
| 21 | Built-in tool registry (122 tools w/ maturity labels) | **Backend-only** | prior audit claim #11-12 | Exposed on landing copy; not in product UI |
| 22 | Voice → workflow trigger (`/voice/sessions/:id/trigger-workflow`) | **Backend-only** | prior audit claim #16 | Route real, no UI surface in this audit |
| 23 | OpenAI-first runtime + LangGraph workflow runtime (migration) | **Backend-only (dormant)** | finding 17 | Code shipped at `ef68e75`; flags = legacy + swarmgraph |
| 24 | Hosted tools (`web_search`, `file_search`, `code_interpreter`, `computer-preview`) | **Backend-only (dormant)** | `openaiRuntimeAgents=[]` | Adapter wired; not active in prod |
| 25 | Retry / recovery narration in chat ("retrying agent X…") | **Missing** | prior audit claim #9 | Backend does retries silently; chat doesn't show them |
| 26 | Streaming resume after refresh (chat picks up live events after reload) | **Missing** | finding 22 | Sidebar row persists; SSE does not reattach |
| 27 | LinkedIn integration tile | **Missing** | prior audit M2 | `linkedin-api.adapter.ts` + `post_to_linkedin` tool exist; no UI tile |
| 28 | Salesforce integration | **Missing** | prior audit M3 | No adapter, no tile |
| 29 | `apps/web/src/app/not-found.tsx` | **Missing** | prior audit M1 | Unknown route = empty dashboard body |
| 30 | Computer-use / desktop automation | **Missing** | prior audit claim #15 | Supported by OpenAIRuntime adapter, not activated; flag dormant |
| 31 | Inline agent-DAG visualization in chat (user's explicit ask this session) | **Missing** | user comment mid-run | Backend data exists in `/swarm`; chat doesn't render a compact version |

## Counts

| Tier | Count |
|---|---|
| Production-ready | 6 |
| Beta | 8 |
| UI-only | 2 |
| Backend-only | 5 |
| Broken | 3 |
| Missing | 7 |
| **Total** | 31 |

## The "highest-leverage" features by impact-of-fix

Ordered by (user visibility × number of downstream capabilities affected):

1. **#15 Chat final-answer rendering.** Single biggest blocker. Fixing this makes 8 roles + 4 workflow tests go from "appears broken" to "appears to work" overnight.
2. **#31 Inline agent-DAG in chat.** User explicitly asked. Projecting `/swarm`'s data inline transforms the chat from "magic black box" to "I can see my agents working".
3. **#16 Schedule persistence.** Closes the "CMO scheduling" demo story.
4. **#17 Approval gate UI.** Makes the trust narrative concrete.
5. **#25 Retry narration.** Turns silent hangs into visible progress.
6. **#20 + #27 + #28 + #29.** Small UI exposures of already-real backends.

## What the matrix implies for positioning

If JAK Swarm markets itself as **"autonomous agents with full transparency"** — the #4 `/swarm` Inspector is the best evidence. Lean harder on it. Consider screenshots of the Inspector on the landing page, because that's the part of the product that most clearly differentiates from GPT wrappers.

If the positioning is **"tell JAK what you want and see results in chat"** — that story is currently broken and needs #15 + #31 shipped before that claim holds.
