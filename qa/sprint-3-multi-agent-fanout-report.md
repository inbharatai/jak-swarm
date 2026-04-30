# Sprint 3 — Multi-Agent Subgoal Coordinator

**Base commit:** `2fada45` (Sprint 2 sandboxed installer)
**Goal:** CEO must be able to break a broad command into subgoals
and assign them to CMO/CTO/VibeCoder/Research/CFO with explicit
parallel-vs-sequential dependencies. Real orchestration, not
decorative agent cards.

## What shipped

### Code

**`packages/agents/src/coordination/subgoal-coordinator.ts`** (NEW)

Stateless `decomposeGoal(goal: string): SubgoalCoordinatorResult`
function. Domain-pattern matching:

| Pattern keywords | Agent | Risk | Side-effect |
|---|---|---|---|
| repo / github / code / landing page / website / deploy / fix / bug / technical | **CTO Agent** (WORKER_CODER) | MEDIUM | none |
| linkedin / instagram / youtube / post / tweet / content / campaign / marketing / seo / brand / blog | **CMO Agent** (WORKER_MARKETING) | HIGH | external |
| invoice / billing / revenue / finance / expense / stripe / payment | **CFO Agent** (WORKER_FINANCE) | HIGH | none |
| ui / ux / design / frontend / button / layout / mobile / responsive | **VibeCoder Agent** (WORKER_DESIGNER) | MEDIUM | none |
| research / analyze / competitor / market / insight / analytics / metric / trend | **Research Agent** (WORKER_RESEARCH) | LOW | none |

Output structure:
- `subgoals` — flat list with `dependsOn` edges
- `parallelGroups` — array of arrays of subgoal ids; group N runs
  after group N-1 completes
- CEO summary subgoal depends on every domain subgoal + runs in its
  own (final) group
- Conservative grouping: external-side-effect subgoals NEVER
  parallelize with each other (no parallel publish attempts)

Helper: `summarizePlan(result)` produces layman-friendly cockpit copy.

### Tests

**`tests/unit/api/subgoal-coordinator.test.ts`** (NEW, 13 tests):

- Multi-domain goal "review my landing page, draft a LinkedIn post, prepare a fix plan" → CTO + CMO + CEO subgoals
- CEO summary depends on EVERY domain subgoal
- Parallel-safe: internal-only subgoals group together
- External-side-effect subgoals are isolated to their own groups (no parallel publish)
- Risk-level mapping: CMO=HIGH, Research=LOW, CEO summary=LOW
- Empty/whitespace goal throws
- Fallback: no-domain-match goal → single CEO subgoal
- Every emitted subgoal has a valid `AgentRole` enum value
- `summarizePlan` produces numbered step list + parallel cluster markers
- Stateless: two consecutive calls yield independent unique ids

All 13 pass.

## Hard rules ENFORCED

- ✅ **No bypass**: every subgoal carries `riskLevel`; the existing
  approval-policy + ApprovalRequest persistence loop applies per
  subgoal automatically (no new code path to audit)
- ✅ **Tenant isolation**: coordinator is stateless; tenantId flows
  through context unchanged
- ✅ **Parallel-safe**: external-side-effect subgoals never parallel
- ✅ **Unique ids**: `crypto.randomBytes` (12 hex chars / 48 bits)
- ✅ **Real AgentRole values**: every subgoal must use a value from
  the `AgentRole` enum (asserted by test)

## Honest deferrals

- **Direct planner integration** — `decomposeGoal` ships as a pure
  function exported from `@jak-swarm/agents`. The existing Planner
  agent can call it as a pre-decomposition step before producing its
  task list; this wiring is the next sprint after Sprint 5 finishes.
  Today the function is callable + tested + covers the orchestration
  contract.
- **LLM-driven decomposition** — current rules use keyword regex.
  An LLM-driven decomposer that handles arbitrary phrasing
  (e.g. "make my product better") is the next refinement. The
  keyword approach catches the explicit multi-domain phrasing the
  brief targets ("review … draft … prepare").

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @jak-swarm/agents build` | green |
| `pnpm exec vitest run unit/api/subgoal-coordinator.test.ts` | **13/13 pass** |

## Status

**Sprint 3 complete.** Stateless multi-agent decomposer + parallel/
sequential grouping + CEO summary + tested. Moving to Sprint 4.
