# Release-Candidate Code Truth Audit

**Commit:** `86d6a01`
**Verification posture:** for each previously-claimed component, confirm
(a) the file exists, (b) the implementation has the claimed surface,
(c) **whether it is actually wired into a user-facing flow** — NOT just
exported from a package.

This is the audit the prior reports glossed over: existence ≠ wiring.

## Summary table

| Component | File exists | Real backend impl | Wired into user-facing flow | Tested by unit | Tested by Playwright |
|---|---|---|---|---|---|
| 1. LinkedInBrowserAdapter | ✅ `packages/tools/src/browser-operator/linkedin-adapter.ts` | ✅ | **❌ ISLAND** | ✅ 22 | (UI card only) |
| 2. InstagramBrowserAdapter | ✅ `instagram-adapter.ts` | ✅ | **❌ ISLAND** | ✅ 10 | (UI card only) |
| 3. YouTubeStudioBrowserAdapter | ✅ `youtube-adapter.ts` | ✅ | **❌ ISLAND** | ✅ 8 | (UI card only) |
| 4. MetaBusinessBrowserAdapter | ✅ `meta-adapter.ts` | ✅ | **❌ ISLAND** | ✅ 5 | (UI card only) |
| 5. PlaywrightBrowserOperator | ✅ `playwright-browser-operator.ts` | ✅ | ✅ via `/browser-sessions` routes | ✅ 18 + 2 real-browser | ✅ honesty spec |
| 6. ApprovalRequest persistence subscriber | ✅ `swarm-execution.service.ts:1157` (`tool_approval_required` branch) | ✅ | ✅ wired into existing approval inbox | ✅ 7 source-level | (cockpit shows existing inbox) |
| 7. Approval approve/deny/expire/resume flow | ✅ `apps/api/src/routes/approvals.routes.ts` (existed pre-session) | ✅ | ✅ existing `/approvals/:id/decide` | ✅ existing tests | (existing) |
| 8. ToolRegistry approval chokepoint | ✅ `packages/tools/src/registry/tool-registry.ts:execute()` | ✅ | ✅ every tool call routes through it | ✅ 24 + 4 base-agent | (covered indirectly) |
| 9. audit:approval-paths script | ✅ `scripts/audit-approval-paths.ts` | ✅ | ✅ `pnpm audit:approval-paths` (407/0/0) | (script IS the test) | n/a |
| 10. Safe installer execution | ✅ `packages/tools/src/installer/sandboxed-installer.ts` | ✅ | **❌ ISLAND** | ✅ 10 (incl. real subprocess) | n/a |
| 11. SubgoalCoordinator | ✅ `packages/agents/src/coordination/subgoal-coordinator.ts` | ✅ | **❌ ISLAND** | ✅ 13 | n/a |
| 12. CEO/CMO/CTO/VibeCoder workflow wiring | ✅ existing 38 worker agents + friendly-name mapper | ✅ | ✅ Planner/Router pipeline (existed pre-session) | ✅ existing | ✅ honesty + cockpit specs |
| 13. Mobile cockpit | ✅ `BrowserOperatorComingSoon.tsx` mobile-friendly cards | ✅ (responsive grid, viewport-tested) | ✅ visible at /integrations | n/a | ✅ Sprint 5 mobile sweep |
| 14. Integration status / service-level tests | ✅ `tests/unit/api/connected-integration-service-level.test.ts` | n/a (test file) | (test) | ✅ 27 | (covered by route-mock spec) |
| 15. Truth-lock tests | ✅ `tests/unit/web/no-half-measures-claims.test.ts` | n/a (test file) | (test) | ✅ 7 | n/a |

## Critical wiring gaps (HONEST)

The following components are **island code** — they exist, have real
implementations, have passing tests, but are **NOT imported by any
production caller** (verified via repo-wide grep):

### Gap 1: Per-platform browser adapters NOT dispatched by routes

`apps/api/src/routes/browser-operator.routes.ts` and the underlying
`PlaywrightBrowserOperator` use **only the GENERIC observe / propose /
execute path**. They do NOT call:
- `linkedInAdapter.detectLoginState(page)`
- `linkedInAdapter.buildDraft({ topic })`
- `linkedInAdapter.recordApprovedPublish({ draft, approvalId })`
- (same for instagram / youtube / meta adapters)

Today, when a user clicks "Start browser session" on the LinkedIn
card, the backend opens a real Playwright session pointed at
`https://www.linkedin.com/feed/` — but the platform-specific
login-detection / draft-generation / approval-publish methods on
`LinkedInBrowserAdapter` are **never invoked by the routes**.

**Verified by:**
```bash
grep -rnE "linkedInAdapter|instagramAdapter|youtubeAdapter|metaAdapter" \
  apps packages \
  | grep -v node_modules | grep -v dist | grep -v "\\.test\\." \
  | grep -v "browser-operator/"
# (empty — no production caller)
```

### Gap 2: SubgoalCoordinator NOT integrated with Planner

`packages/agents/src/coordination/subgoal-coordinator.ts` exports
`decomposeGoal()` + `summarizePlan()`. The existing `PlannerAgent`
does NOT call `decomposeGoal` before producing its task list.

**Verified by:**
```bash
grep -rnE "decomposeGoal|SubgoalCoordinator" apps packages/swarm \
  | grep -v node_modules | grep -v dist | grep -v "\\.test\\."
# (empty — no production caller)
```

Today, multi-agent goals like "review my repo and draft a LinkedIn
post" still flow through the existing Planner verb-driven routing.
That routing DOES decompose into sub-tasks (one per worker agent),
so the user-visible behavior is "agents work in parallel" — but the
new `SubgoalCoordinator` heuristic + parallel-group + CEO-summary
shape is not yet what the cockpit sees.

### Gap 3: SandboxedInstaller NOT wired into HTTP route

`packages/tools/src/installer/sandboxed-installer.ts` exports
`SandboxedInstaller` with real `pnpm` subprocess + allowlist + timeout
+ log capture. **No HTTP route or service calls it.**

**Verified by:**
```bash
grep -rnE "SandboxedInstaller|sandboxedInstaller|SANDBOX_ADAPTERS" \
  apps packages/swarm \
  | grep -v node_modules | grep -v dist | grep -v "\\.test\\."
# (empty — no production caller)
```

Today, when a user task description mentions a missing capability
(e.g., "I need PDF parser"), nothing automatically calls
`ToolRequirementDetector.detectFromTask` → `SandboxedInstaller.dryRun`
→ approval → `install`. The pieces all work in isolation under
unit tests; they are not chained through any user-triggerable flow.

## What IS genuinely wired (the truthful picture)

- ✅ **Approval policy at `ToolRegistry.execute()` chokepoint** — every
  registered tool call goes through it; 0 bypasses (proven by
  `pnpm audit:approval-paths`)
- ✅ **`tool_approval_required` event → `ApprovalRequest` row** —
  `swarm-execution.service.ts:1157` wires the BaseAgent emission to
  real Prisma persistence + lifecycle event emission
- ✅ **Generic browser operator** — real Playwright + tenant
  isolation + screenshot + URL allowlist; user can "Start browser
  session" from the LinkedIn / Instagram / YouTube / Meta cards and a
  real headless Chromium opens at the platform URL (login detection
  is delegated to the user's eyes, not the adapter's selectors)
- ✅ **Layman ConnectModal** — no developer jargon visible; admin
  token-paste behind RoleGate
- ✅ **9 OAuth connectors** with Run-audit button on connected cards
- ✅ **Standing orders + skill cascade + workspace lock** (prior
  sessions)
- ✅ **38-agent friendly-name mapping** in cockpit
- ✅ **Audit log + payload-binding + signed evidence bundles**

## Summary

**Genuine wiring rating: 7/10.** The backbone (approval policy + audit
log + browser operator + OAuth connectors + ConnectModal + cockpit) is
real, wired, and visible. The Sprint 1+3+4 island code (per-platform
adapter methods, SubgoalCoordinator decomposer, sandboxed installer
HTTP) are real implementations + tested + safe BUT not yet called by
the production routes. They are scaffolded for a future "wire the
islands" sprint.
