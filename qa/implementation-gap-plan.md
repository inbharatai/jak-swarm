# JAK Swarm — Implementation gap plan

Ordered fix plan based on the A-to-Z audit. Every item has: WHY, WHAT (exact file touches), HOW TO VERIFY, ESTIMATED EFFORT, and RISK. Written so any engineer (including the author six weeks from now) can pick any item up and ship it without re-deriving context.

This plan **proposes** fixes. It does not implement them. Per the user's directive: "First produce the complete truth-based evaluation. After the report is complete, propose the exact fix plan in priority order. Do not implement fixes during this audit unless explicitly asked."

## § Ordering logic

Priority = (user visibility of the bug) × (1 / estimated effort to fix) × (number of downstream capabilities unlocked).

---

## §1 — Flip the prod flags + extend recovery (unlocks H2, affects 10 of 22 tests)

### Why
The single biggest perceived-quality problem in the product — every chat reply showing the "did not produce a user-facing response" stub — has *two* independently-sufficient fixes both already in the code:
1. The **OpenAI-first runtime** (merged this session at `ef68e75`) uses Responses-API structured output, which makes the stub shape literally unrepresentable. 
2. The **trace-based recovery layer** in `apps/api/src/routes/workflows.routes.ts` is supposed to rebuild a human answer when the legacy runtime produces a stub, but it's not matching the trace shapes in prod.

Prod `/version` at run time: `executionEngine=legacy`, `workflowRuntime=swarmgraph`, `openaiRuntimeAgents=[]`. The migration is compiled-in but dormant.

### What
**Step 1A — flip flags (zero code change):**
In Render env for `srv-d7eed8l8nd3s73bcjv30` (API) and worker service, set:
```
JAK_EXECUTION_ENGINE=openai-first
JAK_OPENAI_RUNTIME_AGENTS=commander,planner,research
OPENAI_API_KEY=<existing>
```
Keep `JAK_WORKFLOW_RUNTIME=swarmgraph` for now (LangGraph wrapper rollout belongs to Phase 6 of the migration plan — don't couple this change to it).

**Step 1B — extend recovery:**
In `apps/api/src/routes/workflows.routes.ts` in the `GET /:workflowId` handler, when `finalOutput` either is missing OR matches the stub string, walk all traces with `agentRole` starting with `WORKER_` (not just COMMANDER), collect `outputJson.content` / `outputJson.answer` / `outputJson.summary` fields in order, and render markdown like:

```md
### Results from your agents

**{ROLE}** — {duration}s
{worker.output.content or best-available field}

---

**{NEXT_ROLE}** …
```

Keep the COMMANDER directAnswer lookup as the preferred path; only fall through to the worker synthesis when the directAnswer is missing or equals the stub.

### How to verify
- Run `tests/e2e/qa-a-to-z.spec.ts` headed against prod — expect 8/8 role tests to produce real content (not the stub) in chat. Test durations should be similar (~25-30s per test).
- Hit `/version` — expect `executionEngine=openai-first`.
- Check Inspector traces for the same runs — worker outputs should be identical in structure (Responses API produces the same shape the legacy path consumed).

### Effort
**4-8 engineer-hours.** Flag flip = 10 minutes. Recovery extension = 3-5 hours of code + tests. Verification run = 1 hour.

### Risk
- **OpenAI-first has cost implications** not yet benchmarked at full prod load. Mitigation: roll flags out to `commander,planner` first (exclude research), monitor 24h, then add research.
- **Recovery walks every worker trace** — if a workflow has 10+ workers, the synthesized reply could be long. Mitigation: hard cap at 6 workers rendered inline, link to `/swarm` for the rest.
- **Rollback:** single env-var flip; no DB migration to revert.

---

## §2 — Render the agent DAG inline in chat (H2 sibling; user explicitly asked)

### Why
User quote mid-audit: "the agent dag and flow should be visible". Today users see a text bubble in chat and have to leave `/workspace` to understand what actually ran. The Inspector view at `/swarm` already has the perfect data. Projecting a compact version into the chat converts JAK from a magic-black-box UX into a see-the-work UX — the thing that actually differentiates multi-agent platforms from GPT wrappers.

### What
Add a new message type to the chat renderer: `{ type: 'agent_trace', workflowId, agents: AgentSummary[] }` where each `AgentSummary` has `role`, `status`, `durationMs`, `toolCalls: { name, argsPreview, ok }[]`, `outputPreview`.

On every `completed` event from SSE, `GET /workflows/:id` and compose the summary. Render it **between** the role-specific question and the final-answer bubble. Use a collapsible card: by default show the agent row (role + status + duration); expand to show tool calls + output preview.

Files likely touched:
- `apps/web/src/components/chat/ChatWorkspace.tsx` — new message type branch
- `apps/web/src/components/chat/AgentTraceCard.tsx` — **new**
- `apps/web/src/lib/workflow-stream.ts` (or wherever SSE is consumed) — emit the new message on `completed`
- `apps/api/src/routes/workflows.routes.ts` — if needed, add a compact `GET /:workflowId/summary` that returns the pre-digested agent summary so the client doesn't need to traverse the whole trace JSON

Reuse whatever component `/swarm/page.tsx` uses to render per-agent rows — don't re-build a visualization from scratch.

### How to verify
- Playwright: send any role prompt; assert `data-testid="agent-trace-card"` appears before the final answer bubble and lists ≥ 1 agent with non-empty role + status.
- Visual: screenshot the chat after a completion — should look like a horizontal stack of agent cards with the final markdown below.

### Effort
**1-2 engineer-days.** Most of the work is the card component + SSE wiring. The data is already available.

### Risk
- **Long tool-call args** could blow up the card. Mitigation: truncate to 120 chars with a "show more" link.
- **SSE race** where `completed` event arrives before the fetch to `/:workflowId` returns. Mitigation: already-handled pattern in the app; render a loading skeleton in the card for < 2s.
- **Rollback:** pure UI additions, no schema change.

---

## §3 — Schedule persistence from chat (H5)

### Why
The CMO "schedule posts" workflow is one of the four demo scenarios the product is built around. Today the workflow runs but produces no `Schedule` row and no user-facing review CTA. This is the same pattern as H2 — the swarm does real work internally; the boundary to durable state never gets crossed.

### What
Three changes working together:

**3A — Detect scheduling intent server-side.**
In `apps/api/src/services/swarm-execution.service.ts`, after a workflow reaches `completed`, inspect worker outputs for a canonical `schedulePlan` field (array of `{ goal, cron, startDate, endDate }`). If present, call `schedulesService.createPending(tenantId, userId, schedulePlan)` which writes rows to the `Schedule` table with `status='pending_approval'`.

**3B — Expose the plan to chat.**
When a `schedulePlan` was persisted, the workflow's final chat message should be a card (reuse the pattern from §2): "I prepared {N} scheduled runs — review and approve." with a button linking to `/schedules` or a per-row approve/deny inline.

**3C — Workers actually emit `schedulePlan`.**
The CMO, Auto, and Marketing workers need a structured-output path for scheduling. With §1 flipped on, the zod schema can guarantee it; without §1, update the prompts in the role agent to instruct `"when the user asks to schedule work, output a JSON schedulePlan: [{goal, cron, startDate, endDate}]"`. This is the weakest link if §1 is deferred.

Files touched:
- `packages/agents/src/runtime/schemas/schedule-plan.schema.ts` — **new** zod schema
- `packages/agents/src/workers/cmo.agent.ts`, `marketing.agent.ts`, `auto.agent.ts` — include schedule-plan field
- `apps/api/src/services/swarm-execution.service.ts` — intent detection
- `apps/api/src/routes/schedules.routes.ts` — ensure `createPending` exists
- `apps/web/src/components/chat/ScheduleReviewCard.tsx` — **new**

### How to verify
- Run the P5.A test from the A-to-Z spec and assert:
  1. Chat response contains a `[data-testid="schedule-review-card"]`
  2. Card lists ≥ 1 schedule row with `cron` visible
  3. Navigate to `/schedules` → row count > 0

### Effort
**1 engineer-day.** The schema + persistence are straightforward; the chat card reuses §2's pattern.

### Risk
- **Tenant-cost explosion** if a worker emits 100 schedule rows. Mitigation: cap at 50 rows per intent; reject beyond.
- **Rollback:** revert the worker prompt change; the schedule intent-detection in swarm-execution.service.ts won't fire without the schema, so it's safe.

---

## §4 — Workspace empty-state fix (H1)

### Why
First-time users land on `/workspace` and see a role-picker grid with no chat input. They don't know where to type. Single-line inversion.

### What
In `apps/web/src/components/chat/ChatWorkspace.tsx`:
- Render the textarea + Send button **unconditionally** at the bottom.
- Move the function-picker tiles ABOVE the textarea as a "Quick start with…" row, with a "Skip" option.
- When a user types without selecting a role, default to "Auto" role.

### How to verify
- Playwright: fresh sign-in → land on `/workspace` → assert `textarea` is visible without any clicks.
- Remove the role-chip-click step from `qa-a-to-z.spec.ts:runRolePrompt` helper.

### Effort
**2-4 engineer-hours.** Pure UI work.

### Risk
Changes first-run behavior — QA the Auto default doesn't break existing flows.

---

## §5 — Approval gate surface in chat (M5)

### Why
The backend approval-node already blocks by default; the HTTP API already exists. What's missing is the chat rendering when `lifecycle_state === 'awaiting_approval'`.

### What
- Extend the SSE event consumer to handle `state=awaiting_approval` events
- Render an `ApprovalCard` with approve/deny buttons wired to `POST /approvals/:id/decide`
- On decide → update the chat state + allow the workflow to resume (backend resume is already implemented)

Files:
- `apps/web/src/components/chat/ApprovalCard.tsx` — **new**
- `apps/web/src/lib/workflow-stream.ts` — branch on `awaiting_approval`

### How to verify
- Run P5.F "send email now" prompt → assert `[data-testid="approval-card"]` appears with Approve / Deny buttons.

### Effort
**4-6 engineer-hours.**

### Risk
Policy confusion: which prompts should require approval is a policy config, not hard-coded. For now, rely on whatever the backend already decides — don't re-implement policy on the client.

---

## §6 — Legal role chip (H3)

### What
In `apps/web/src/lib/role-config.ts`, add:
```ts
{ id: 'legal', label: 'Legal', worker: 'WORKER_LEGAL', icon: 'scale' }
```
to `ROLE_LIST`.

### Effort
**30 minutes.** Worker already exists.

---

## §7 — Integrations tiles (M2 + M3)

### What
Choose one:
- **Ship LinkedIn tile** (15-minute edit; adapter + tool already exist)
- **Drop LinkedIn + Salesforce from landing-page social/CRM framing** (15-minute copy edit)

Pick the one that matches your roadmap. Don't leave the gap open.

---

## §8 — `/analytics` skeletons (H4)

### What
Wrap the body of `apps/web/src/app/(dashboard)/analytics/page.tsx` in a Suspense boundary with a chart-shaped skeleton + spinner while SWR is fetching.

### Effort
**2 hours.**

---

## §9 — `not-found.tsx` (M1)

### What
Create `apps/web/src/app/not-found.tsx`:
```tsx
export default function NotFound() {
  return (
    <div className="max-w-md mx-auto py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">We couldn't find that page.</p>
      <Link href="/workspace" className="mt-6 inline-block">Go to workspace</Link>
    </div>
  );
}
```

### Effort
**15 minutes.**

---

## §10 — `/skills` populated from built-in registry (M4)

### What
In `apps/web/src/app/(dashboard)/skills/page.tsx`, call the registry API (`GET /api/tools?pack=<tenant_industry>`) and render each tool as a read-only tile with name, category, and `maturity` badge. Keep the `Installed` / `Marketplace` / `Create` tab structure but put the 122 built-ins under `Installed` for all tenants.

### Effort
**4-6 hours.**

---

## §11 — File-upload error toast (M6)

### What
In the Files page hook, add `.catch(err => toast.error(...))` on the upload promise with a copy like "We only accept PDF, DOCX, CSV, XLSX, PNG, JPG, TXT, MD files."

### Effort
**30 minutes.**

---

## §12 — SSE reattach after refresh (L3)

### What
On workspace mount, check for an active workflow in the conversation store. If present and not terminal, re-open the SSE stream for it (or fall back to polling `GET /workflows/:id` every 2s until terminal).

### Effort
**3-4 hours.**

---

## §13 — localStorage cleanup on sign-out (L2)

### What
In the sign-out handler, call `useConversationStore.persist.clearStorage()` before redirecting to `/login`.

### Effort
**15 minutes.**

---

## §14 — `/swarm` time-window selector (L1)

### What
Add `All / 7d / 30d` tabs to `/swarm/page.tsx`, pass through to the list query.

### Effort
**1 hour.**

---

## Rollup: minimal batch for a "feels shipped" release

If you can only ship 6 things this week, ship:

1. §1 — H2 fix (flag flip + recovery extension)
2. §2 — inline agent DAG in chat
3. §3 — schedule persistence
4. §4 — workspace empty state
5. §5 — approval card in chat
6. §6 — Legal role chip

That's one engineer-week of focused work and it flips the perceived readiness of the product from "looks broken" to "looks complete". Every item ships behind no feature flag needed — pure forward-merge to main.

## Out-of-scope for this plan

- **The Phase 6 LangGraph migration** (moving workflow-runtime to LangGraph) — this plan does NOT couple that to shipping. Keep `JAK_WORKFLOW_RUNTIME=swarmgraph` until the Phase 6 exit criteria in `.claude/plans/blunt-truth-first-8-5-misty-kettle.md` are met.
- **The Phase 7 provider deletion** (removing Anthropic + Gemini adapters) — do not delete until Phase 8 benchmark parity is proven.
- **Voice → workflow UI** — backend route is real; building the microphone UI is a separate feature, not a QA fix.
- **Computer-use hosted tool activation** — adapter supports it; requires product-side UX design for "permission to take a screenshot of your machine" before enabling.
