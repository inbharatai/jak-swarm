# Sprint 6 — Production-Wiring Completion Report

**Base commit:** `897c23f` (release-candidate verification — 5 Partials named)
**Goal:** wire the previously-island code into production user flows.

## What was wired (the 5 Partials → Complete)

### Part A — PlannerAgent ↔ SubgoalCoordinator (Criterion #3 + #4)

**Before:** `decomposeGoal()` exported, tested, but `PlannerAgent` never called it.

**After (`packages/agents/src/roles/planner.agent.ts`):**
- Imports `decomposeGoal` + `summarizePlan` from `coordination/subgoal-coordinator.js`
- In `execute()`, BEFORE the LLM call: runs `decomposeGoal(missionBrief.goal)`
- When the decomposition is multi-domain (≥2 specialists, e.g. CTO + CMO + CEO), prepends a `SUBGOAL COORDINATOR HINT` system message to the LLM messages with `summarizePlan(coord)`
- Single-domain goals don't get the hint (no noise)

**Production caller:** `PlannerAgent.execute()` is called by `packages/swarm/src/graph/nodes/planner-node.ts` for every workflow.

**Tests:** `tests/unit/api/sprint-6-wiring.test.ts` Part A (4 tests).

### Part C — /browser-sessions ↔ platform adapters (Criterion #7)

**Before:** 4 adapter classes existed but `/browser-sessions` routes never called them.

**After (`apps/api/src/routes/browser-operator.routes.ts`):**
- Imports all 4 adapters + `PlatformAdapter` type
- New `ADAPTER_BY_ID` dispatch map (LINKEDIN/INSTAGRAM/YOUTUBE_STUDIO/META_BUSINESS_SUITE)
- New route: `POST /browser-sessions/:sessionId/platform/:platform/action`
- Discriminated zod body schema with 3 actions:
  - `detect_login` — proxies to `op.observe()` + applies adapter login heuristic
  - `build_draft` — calls `adapter.buildDraft({ topic, tone })` (stateless)
  - `record_publish` — calls `adapter.recordApprovedPublish({ draft, approvalId })`; **`approvalId` is required by zod schema**
- Unknown platform → 400 `UNKNOWN_PLATFORM`

**Production caller:** registered at `/browser-sessions` in `apps/api/src/index.ts`.

**Tests:** `tests/unit/api/sprint-6-wiring.test.ts` Part C (8 tests).

### Part D — Social drafts API + UI (Criterion #10)

**Before:** adapter `buildDraft()` methods existed + 55 unit tests passed but NO HTTP route or UI.

**After:**
- `apps/api/src/routes/social-drafts.routes.ts` — POST `/social-drafts` dispatches to platform adapter, returns `{ adapter, displayName, draft, manualHandoffRequired: true, manualHandoffMessage }`. Audit log row `SOCIAL_DRAFT_CREATED` per request.
- `apps/web/src/app/(dashboard)/social-drafts/page.tsx` — full layman UI: 4-platform picker, topic input, 3-tone selector, Generate button. Result card shows draft body (with copy button), hashtag chips, author checklist, manual-handoff disclaimer + "Open Platform" external link.
- `apps/web/src/lib/api-client.ts` adds `socialDraftsApi.generate({ platform, topic, tone })`.
- `apps/web/src/components/CommandPalette.tsx` adds Social Drafts nav entry.

**Production caller:** UI button → `socialDraftsApi.generate()` → `POST /social-drafts` → adapter `buildDraft()`.

**Tests:** unit + 2 Playwright e2e (page renders + end-to-end mock-driven generate).

### Part E — Tool installer API + UI (Criterion #13)

**Before:** `SandboxedInstaller` real subprocess existed + 10 tests passed but NO HTTP route or UI.

**After:**
- `apps/api/src/routes/tool-installer.routes.ts`:
  - `POST /tool-installer/detect` — auth user — `ToolRequirementDetector.detectFromTask(task)` augmented with sandbox availability flag
  - `POST /tool-installer/plan` — auth user — `installer.dryRun(req)` returns plan
  - `POST /tool-installer/execute` — **REVIEWER+ only**, requires `approvalId`, calls real `installer.install(...)`. Audit log `TOOL_INSTALL_EXECUTED` row per attempt. Maps `InstallApprovalRequiredError` → 409, `InstallNotAllowedError` → 400.
- `apps/web/src/app/(dashboard)/tool-installer/page.tsx` — full layman UI: task input → Detect button → Requirements card with sandbox-availability badges → Show plan button → step-by-step plan with safe/unsafe icons → approval-id input + Execute button → result card with stdout/stderr.
- `apps/web/src/lib/api-client.ts` adds `toolInstallerApi.{detect,plan,execute}`.
- `apps/web/src/components/CommandPalette.tsx` adds Tool Installer nav entry.

**Production caller:** UI button → `toolInstallerApi.detect/plan/execute` → routes → `SandboxedInstaller` real subprocess.

**Tests:** unit + 2 Playwright e2e (page renders + detect path mock-driven).

## Tests added this sprint

| File | Tests |
|---|---|
| `tests/unit/api/sprint-6-wiring.test.ts` | **28** (4 Part A + 8 Part C + 6 Part D + 7 Part E + 5 UI surfaces verification) |
| `tests/e2e/sprint-6-new-ui-surfaces.spec.ts` | **4** (2 social-drafts + 2 tool-installer) |

All 32 pass.

## Updated acceptance criteria

`docs/full-fledged-jak-acceptance-criteria.md` updated — all 5 previously-Partial criteria now marked **Complete** with the wiring path documented inline.

## Hard rules ENFORCED (no fake completion)

- ✅ **No more island code** — every claimed Sprint 6 wiring has a verified production caller via grep
- ✅ **Every UI button hits a real backend route** (verified: social-drafts UI calls `/social-drafts`; tool-installer UI calls `/tool-installer/{detect,plan,execute}`)
- ✅ **Every social publish stays manual handoff** — `record_publish` returns `manualHandoffRequired: true`; truth-lock test still passes
- ✅ **No destructive action without approval** — installer execute requires REVIEWER+ AND approvalId; 409 on missing approvalId
- ✅ **No tenant leakage** — every route reads `request.user.tenantId` from auth context, never from body
- ✅ **Argv shell-metachar guard** still runs in `SandboxedInstaller` for every install
- ✅ **Audit log row** emitted on social draft create + tool install execute
- ✅ **Approval gate** at `/tool-installer/execute` returns 409 on missing approvalId

## Final all-gate verification

(Run-time results in commit message.)

## Final decision

> **JAK now meets the full-fledged tool acceptance criteria because all previously Partial criteria are wired into production user flows.**
>
> 1. Multi-agent task execution — PlannerAgent calls `decomposeGoal()` for multi-domain goals
> 2. CEO/CMO/CTO/VibeCoder modules — same wiring as #1
> 3. Browser operator per-platform — `/browser-sessions/:id/platform/:platform/action` dispatches to all 4 adapters
> 4. Social media draft workflows — `/social-drafts` route + `/social-drafts` UI page with platform picker + result card
> 5. Tool installer workflow — `/tool-installer/{detect,plan,execute}` routes + `/tool-installer` UI page
>
> Every previously-island component now has a verified production caller. Every UI button hits a real route. Every route enforces approval, tenant isolation, and audit log emission. No fake completion.
