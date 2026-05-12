# Team + 30-Day Free Trial — Migration 106

**Shipped:** 2026-05-08 (initial) + 2026-05-08 (carry-overs closed)
**Migration:** `packages/db/prisma/migrations/106_team_and_trial/`

This is the JAK wedge: humans and AI agents on **one task graph, one approval flow, one audit trail**, plus a free 30-day trial as the public-facing wedge that gets design partners in the door without billing risk.

## What this delivers

### Team
- **Departments** with optional parent-child hierarchy (Engineering > Backend > Auth)
- **Employees** carry `departmentId`, `jobTitle`, `managerId` — real org chart
- **Task assignment** to humans (sibling to AI agent assignment)
- **Inbox** aggregator: tasks + approvals + notifications, one round-trip
- **Org-chart UI** at `/team` — searchable directory, drag-to-department

### Trial
- **30-day free trial** triggered from the landing page CTA
- **4 daily caps** that auto-pause workflows when hit (no surprise charges):
  - 20 agent runs / day
  - 5 external-action approvals / day
  - 120 tool minutes / day
  - 200,000 LLM tokens / day
- **Email-only signup** — no credit card required
- **Anti-abuse** — 1 trial per email, fingerprint-throttled to 1 per IP+UA per 90 days
- **Lazy daily reset** at UTC midnight (idempotent, no cron)

## File map

| File | Purpose |
|---|---|
| `packages/db/prisma/schema.prisma` | 4 new models + User/Subscription extensions |
| `packages/db/prisma/migrations/106_team_and_trial/migration.sql` | Additive migration |
| `apps/api/src/services/trial/usage-counter.service.ts` | Cap check + record + lazy reset + startTrial |
| `apps/api/src/services/trial/trial-promotion.service.ts` | VERIFIED signup → Tenant + admin User + trialing Sub (atomic) |
| `apps/api/src/services/trial/trial-email.service.ts` | Verify-email send (gmail / file / noop backends) |
| `apps/api/src/plugins/trial-cap-guard.ts` | Reusable Fastify preHandler |
| `apps/web/src/app/(auth)/trial/verify/[token]/page.tsx` | Verify landing page — drops JWT + shows initial password |
| `apps/api/src/routes/task-assignments.routes.ts` | 8 endpoints (create / list / me / get / acknowledge / complete / decline / cancel) |
| `apps/api/src/routes/inbox.routes.ts` | Aggregated inbox + mark-read |
| `apps/api/src/routes/team.routes.ts` | Department CRUD + member directory + assign-to-dept |
| `apps/api/src/routes/trial.routes.ts` | Public signup + verify, authed status |
| `apps/web/src/app/(dashboard)/my-tasks/page.tsx` | "My Tasks" inbox UI |
| `apps/web/src/app/(dashboard)/team/page.tsx` | Org-chart + member directory |
| `apps/web/src/components/TrialBanner.tsx` | Cockpit ribbon (days-remaining + cap-near + expired) |
| `apps/web/src/app/(auth)/trial/page.tsx` | Public trial signup form |

## API surface added (12 routes)

```
POST   /trial/signup                         (public)
POST   /trial/verify/:token                  (public)
GET    /trial/status                         (authed)

GET    /inbox
POST   /inbox/notifications/:id/read
POST   /inbox/notifications/read-all

POST   /task-assignments
GET    /task-assignments
GET    /task-assignments/me
GET    /task-assignments/:id
POST   /task-assignments/:id/acknowledge
POST   /task-assignments/:id/complete
POST   /task-assignments/:id/decline
POST   /task-assignments/:id/cancel

GET    /team/departments
GET    /team/departments/:id
POST   /team/departments
PATCH  /team/departments/:id
DELETE /team/departments/:id
GET    /team/members
PATCH  /team/members/:userId
```

## Cap-hit behavior

When any of the four daily caps trips, `POST /workflows` returns:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{
  "ok": false,
  "error": {
    "code": "TRIAL_DAILY_CAP_HIT",
    "message": "Daily agentRuns cap reached. Resets at UTC midnight.",
    "resource": "agentRuns",
    "counters": { "agentRuns": { "used": 20, "cap": 20 }, ... },
    "resetsAt": "2026-05-09T00:00:00.000Z",
    "daysRemaining": 22
  }
}
```

When the trial expires (past `trialEndsAt`):

```http
HTTP/1.1 402 Payment Required

{
  "ok": false,
  "error": {
    "code": "TRIAL_EXPIRED",
    "message": "Your 30-day free trial has ended. Please upgrade to continue.",
    "trialEndsAt": "2026-06-07T00:00:00.000Z"
  }
}
```

The cockpit `TrialBanner` reads `/trial/status` every 60s and renders a banner at the top of every dashboard page when the tenant is in either state.

## Testing

| Test | Coverage |
|---|---|
| `tests/unit/services/trial-usage-counter.test.ts` | 11 tests — under-cap allowed, over-cap blocked per resource, paid-plan exempt, lazy reset, recordUsage swallows errors, 30-day startTrial |
| `tests/unit/landing/landing-claim-vs-code.test.ts` | 40 tests (was 33, +7 for trial truth-lock) — every landing claim about the trial maps to a real file |

Run:

```bash
cd tests && pnpm exec vitest run unit/services/trial-usage-counter.test.ts unit/landing/landing-claim-vs-code.test.ts
```

## Carry-overs status

| Gap | Status | Files |
|---|---|---|
| Email send for verify token | ✅ **CLOSED** — three transparent backends (gmail / file logger / noop) with structured warning when no backend configured | `apps/api/src/services/trial/trial-email.service.ts` |
| Tenant promotion during /trial/verify | ✅ **CLOSED** — atomic `$transaction` creates Tenant + admin User + trialing Subscription + OnboardingState; idempotent on PROMOTED signup; returns JWT + one-time initial password | `apps/api/src/services/trial/trial-promotion.service.ts` + `apps/web/src/app/(auth)/trial/verify/[token]/page.tsx` |
| Daily approvals cap actually counts | ✅ **CLOSED** — `POST /approvals/:id/decide` checks + records on `decision === 'APPROVED'` only | `apps/api/src/routes/approvals.routes.ts` |
| Live Render deployment | ⏸ Honestly deferred — API is offline (Render minutes exhausted). Migration is additive + safe against running data; applies cleanly when Render restores. |
| Twilio voice + customer chat widget | ⏸ Next sprint per the plan. |
| HubSpot CRM read-through | ⏸ Adapter exists; UI integration is next sprint. |

## Demo path (when API is up)

1. Top up Render → API redeploys → migration 106 applies
2. Visit jakswarm.com → "Start 30-Day Free Trial" → email captured
3. Click verify link → workspace bootstrapped, trial active
4. Create a workflow → counter increments
5. CEO opens `/team` → adds departments, places team members
6. CEO creates a workflow with a step assigned to a human → assignee sees it in `/my-tasks`
7. Assignee completes → workflow resumes → audit trail captures both AI and human steps
8. After 20 workflows in a day → 429 TRIAL_DAILY_CAP_HIT → banner shows reset time
9. After 30 days → 402 TRIAL_EXPIRED → upgrade CTA
