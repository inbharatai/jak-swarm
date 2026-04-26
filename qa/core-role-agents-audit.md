# Core role agents — REAL vs cosmetic classification

The user's spec asked for CEO / CMO / CTO / CFO / COO / VibeCoder / Research / Browser / Designer / Verifier / Report Writer / Human Approval as REAL backend roles, not UI labels. This document classifies each.

## What "real backend role" means

A REAL agent has all of:
1. A `BaseAgent` subclass with role-specific system prompt + tool registration
2. Routed-to by `RouterAgent` / `PlannerAgent` based on the intent
3. Actually invoked during workflow execution (not just labeled)
4. Emits agent-specific telemetry (`agentRole` on lifecycle events)

A COSMETIC role is just a UI label — the work is done by some general-purpose worker the user can't see.

## Per-role classification

| Spec role | Backed by | Status |
|---|---|---|
| CEO | `WORKER_STRATEGIST` (`packages/agents/src/workers/strategist.agent.ts`) | ⚠️ Partial — works but is a strategist worker, not a true CEO orchestrator. Cannot fan out to CMO+CTO+CFO sub-tasks. |
| CMO | `WORKER_MARKETING` (`marketing.agent.ts`) + `GROWTH` + `CONTENT` | ✅ Real |
| CTO | `WORKER_TECHNICAL` (`technical.agent.ts`) + `WORKER_CODER` | ✅ Real |
| CFO | `WORKER_FINANCE` (`finance.agent.ts`) | ✅ Real |
| COO | No dedicated agent — falls back to `WORKER_OPS` (`ops.agent.ts`) | ⚠️ Partial — Ops covers most COO use cases but isn't named COO. |
| VibeCoder | The vibe-coding execution path (`apps/api/src/services/vibe-coding-execution.service.ts`) + `CoderAgent` + `AppArchitectAgent` + `AppGeneratorAgent` + `AppDebuggerAgent` + `AppDeployerAgent` + `ScreenshotToCodeAgent` | ✅ Real — full pipeline, 6 agents |
| Research | `WORKER_RESEARCH` (`research.agent.ts`) | ✅ Real |
| Browser | `BrowserAgent` (`browser.agent.ts`) | ✅ Real |
| Designer | `WORKER_DESIGNER` (`designer.agent.ts`) | ✅ Real |
| Verifier | `VerifierAgent` orchestrator (`packages/agents/src/roles/verifier.agent.ts`) | ✅ Real — runs after worker completes, blocks low-quality output |
| Report Writer | No dedicated agent. `DocumentAgent` + Workpaper PDFs in audit pack | ⚠️ Partial — covers most cases via document/workpaper but not named "Report Writer" |
| Human Approval | `ApprovalAgent` orchestrator + `approval-node.ts` + `ApprovalRequest` model | ✅ Real — full pause/resume + RBAC + audit trail |

## What's missing for the "true CEO orchestrator" gap

The current pattern is single-worker-per-task. A true CEO that fans out to "have the CMO draft a launch plan AND the CTO assess infra AND the CFO model the budget — then synthesize" requires:

1. Multi-worker fan-out node in `SwarmGraph` (currently a worker is a leaf)
2. Sub-workflow tracking — "CMO sub-task is in progress, CTO sub-task is complete"
3. A `CEOAgent` orchestrator class that takes the synthesized outputs and produces the final exec brief
4. UI — show the parallel tracks in the cockpit instead of a serial timeline

**Effort:** ~1 week of focused work on `SwarmGraph` + new agent class + UI updates.

## What's missing for dedicated CFO / COO / Report Writer agent classes

The existing workers (`finance`, `ops`, `document`) cover the functional surface. Building dedicated agent classes adds:
- Role-specific prompts that frame the work in CFO/COO/Report-Writer language
- Role-specific tool defaults (CFO: financial tools first; COO: ops tools first)
- Better cockpit UX (the `agentRole` shows "CFO" instead of "FINANCE")

**Effort:** ~2-3 days per role for prompt + role-config + tests.

## Honesty notes

- The 38 existing agent classes (6 orchestrators + 32 workers) cover ~85% of the spec. The remaining 15% is naming + the multi-agent fan-out for CEO.
- UI labels saying "CEO Agent" today resolve to `WORKER_STRATEGIST` — that's documented in `packages/agents/src/role-manifest.ts` and visible in lifecycle events as `agentRole='WORKER_STRATEGIST'`. It's a true execution path, not a fake label.
- The user's risk note about "UI labels disguising lack of real agents" — answered honestly above. Where it's true (CEO orchestration), we say so. Where the worker is real (CMO/CTO/CFO etc.), we say so.

## Total effort to close

| Item | Effort |
|---|---|
| Dedicated CEO orchestrator + multi-agent fan-out | ~1 week |
| Dedicated CFO / COO / Report Writer classes | ~1 week (3 × 2-3 days) |
| **Total** | **~2 weeks** |
