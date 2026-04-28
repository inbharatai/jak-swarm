# JAK Swarm — Live bug matrix

Bugs found during the 2026-04-24 live human-style audit against `https://jakswarm.com`. Organized by severity. Every row has reproduction steps + an evidence pointer + a recommended fix.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 4 |
| Medium | 4 |
| Low | 2 |

No Critical bugs. The product is fundamentally usable end-to-end. The four Highs are all UX/copy/discoverability gaps, not crashes or data loss.

---

## High

### H1 — Chat textarea is hidden until you click a function

**Repro**
1. Sign in fresh, no prior conversation.
2. Land on `/workspace`.
3. Look for a chat input.

**Actual:** screen shows "What would you like to build? Select one or more functions below, then describe your task" + a tile grid (Build & Ship, Architect, etc.). No textarea visible.

**Expected:** chat input visible by default, function tiles optional.

**Why it matters:** marketing promises "tell JAK what you want and it executes." A first-time user lands and can't tell where to type.

**Evidence:** `qa/playwright-artifacts/p3-nav/workspace-landing.png`. Spec finding `P5/Chat — No textarea on /workspace`.

**Fix:** invert the conditional in `apps/web/src/components/chat/ChatWorkspace.tsx` (or wherever the workspace renders) — show textarea by default; render the function tiles below it as "or quick-start with…" rather than as a gate.

---

### H2 — Chat final answer is sometimes the "did not produce a user-facing response" stub

**Repro**
1. Sign in.
2. On `/workspace`, click any function (e.g. CEO).
3. Type "hi" and Send.
4. Wait for the workflow to complete (~20–25 s).

**Actual (intermittent):** the assistant bubble that lands says verbatim *"Agents completed their work but did not produce a user-facing response. View the run in Traces for structured output."* The Inspector trace shows the COMMANDER agent did emit a real `directAnswer` ("Hello! I'm JAK Swarm…") — just not surfaced in chat.

**Expected:** chat shows the agent's actual reply.

**Why it matters:** looks like the workflow failed even when it succeeded. Single biggest reason a real user would lose trust in their first conversation.

**Evidence:** `qa/playwright-artifacts/p5-chat/chat-final.png`. Spec finding `P5/Chat — "hi" → user-visible answer rendered (117 chars)` with body `"Agents completed their work but did not produce..."`.

**Fix:** extend the `GET /workflows/:id` recovery in [apps/api/src/routes/workflows.routes.ts](apps/api/src/routes/workflows.routes.ts) so when `finalOutput` matches the stub, it walks ALL non-orchestration traces (not just COMMANDER) and emits a markdown synthesis from their `output` fields the same way `compileFinalOutput` does. The OpenAI-first migration commits shipped today (a4ebc9e → ef68e75) make this less likely once `JAK_OPENAI_RUNTIME_AGENTS=*` is enabled, but the recovery layer is the safety net.

---

### H3 — Marketed "Legal" role does not exist in the product role picker

**Repro**
1. Open `https://jakswarm.com` (signed out).
2. Read the capability map / agents section — Legal is listed.
3. Sign in. Open `/workspace`.
4. Look for a Legal button.

**Actual:** present in landing copy. Missing from the product picker. Picker shows: CEO, CMO, CTO, Coding, Research, Design, Auto, Engineer, Marketing.

**Expected:** Legal chip in the picker, OR remove from landing.

**Why it matters:** classic claim-vs-reality gap. The agent backend has a real `legal.agent.ts` worker — it just isn't surfaced on the picker. This is a 5-line UI fix, not a backend gap.

**Evidence:** `qa/playwright-artifacts/p4-roles/role-picker.png`. Spec finding `P4/Roles — Role picker: present [...] missing [Legal]`.

**Fix:** add Legal to the `ROLE_LIST` in [apps/web/src/lib/role-config.ts](apps/web/src/lib/role-config.ts), wire it to `WORKER_LEGAL` in the canonical role mapping. Worker exists already.

---

### H4 — `/analytics` SWR race: header renders, body stays empty for ~5s on cold load

**Repro**
1. Sign in. Navigate to `/analytics` cold (no recent visit).
2. Within the first 5 seconds, look at the body area.

**Actual:** title "Analytics" + period tabs render immediately. Charts + cost-by-role + workflow counts area is empty for 4–5 seconds. Run-2 of the audit captured a 72-char main body (header only) at the 4500ms mark; run-1 captured 853 chars (loaded).

**Expected:** loading skeleton visible during the fetch.

**Why it matters:** looks broken on first impression. User sees empty page, refreshes, gets the same thing for another 4 seconds.

**Evidence:** `qa/playwright-artifacts/p3-nav/analytics-landing.png`. Spec finding `P3/Nav — Analytics main area too small (72<100)`.

**Fix:** wrap the Analytics body in a Suspense boundary with a chart-shaped skeleton + spinner. Or render the empty cards immediately and fill them as data arrives.

---

## Medium

### M1 — Unknown route renders dashboard shell instead of a 404 page

**Repro**
1. Sign in.
2. Visit `https://jakswarm.com/this-does-not-exist-xyz` (or any unknown path).

**Actual:** dashboard sidebar renders, main content area is empty. No "404" / "page not found" message.

**Expected:** a real Not Found page with a link back to `/workspace`.

**Why it matters:** user mistypes a URL, gets a confusing blank screen, can't tell if it's a bug.

**Evidence:** `qa/playwright-artifacts/p8-failures/unknown-route.png`. Spec finding `P8/Failure — Unknown route renders 404` (false-positive in test — body just has the word "404" somewhere in dashboard chrome telemetry; actual user experience is blank main).

**Fix:** add `apps/web/src/app/not-found.tsx` (Next.js convention) with a clear message + button back to `/workspace`.

---

### M2 — LinkedIn integration tile missing from `/integrations`

**Repro**
1. Sign in. Open `/integrations`.
2. Look for a LinkedIn provider tile.

**Actual:** Slack, GitHub, Gmail, Notion, Google, Calendar, Drive, HubSpot all visible. No LinkedIn tile.

**Expected:** LinkedIn tile, since `packages/tools/src/adapters/social/linkedin-api.adapter.ts` is committed and the `post_to_linkedin` tool is registered in the tool registry.

**Why it matters:** marketing categories include "social" but the only actionable social path in the product UI is the WhatsApp Control tile.

**Evidence:** `qa/playwright-artifacts/p6-integrations/integrations.png`. Spec finding `P6/Integrations — Visible integrations: 8/10 present: missing: [linkedin,salesforce]`.

**Fix:** add LinkedIn to the integrations directory page's provider list. Tool + adapter exist.

---

### M3 — Salesforce integration tile missing

Same shape as M2 but for Salesforce. CRM category implied; no Salesforce tile. HubSpot covers it partially.

**Fix:** either ship the Salesforce adapter + tile or drop Salesforce from any "supported CRMs" landing copy.

---

### M4 — `/skills` shows "Installed (0)" with no built-in skills surfaced

**Repro**
1. Sign in. Open `/skills`.

**Actual:** "Installed (0)" + "Marketplace" + "Create" tabs. Empty for a new tenant.

**Expected:** the 122 built-in tools the product ships should be visible somewhere — even if read-only — so users can see what their agents can do without trial-and-error.

**Evidence:** `qa/playwright-artifacts/p3-nav/skills-landing.png`. Spec finding `P6/Tools — Skills page lists capabilities (113 chars)`.

**Fix:** populate the Skills page with the built-in tool registry contents (filtered by tenant industry pack). Each tile shows tool name, category, maturity label.

---

## Low

### L1 — Run Inspector row count differs across runs without explanation

Run 1 saw 22 workflow rows; Run 2 saw 2. Both runs used the same auth session against the same tenant. Likely a tenant-scoping issue — possibly the test session was on a different tenant or the workflow list is filtered by recency without an obvious time-window control. Worth investigating but not blocking.

**Fix:** add an explicit time-window selector ("Last 7 days / 30 days / All") on `/swarm` so the row count is predictable.

---

### L2 — Workspace persists "RECENT" entries even after sign out + sign in

Run 2 of the audit landed on `/workspace` and saw a "RECENT" sidebar entry from a prior run ("hi"). The conversation store persists in `localStorage` (Zustand persist middleware) and isn't cleared on sign out.

**Fix:** in the sign-out handler, also call `useConversationStore.persist.clearStorage()` (Zustand) so a fresh session starts clean.

---

## Triage

If shipping a stable v1 in the next week, fix in this order:

1. H1 (workspace empty-state) — every first-time user trips on this
2. H2 (chat stub leak) — every workflow user trips on this
3. H3 (Legal role) — small UI fix, removes a marketing lie
4. M1 + M3 (LinkedIn/Salesforce tiles or copy edit) — same shape
5. H4 (Analytics skeleton)
6. M2 (not-found page)
7. M4 (Skills page populated)
8. L1, L2 — nice-to-haves
