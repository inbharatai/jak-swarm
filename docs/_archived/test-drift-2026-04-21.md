# Integration Test Drift — Known Pre-Existing Failures (ARCHIVED — resolved 2026-04-21)

> **Status:** Closed. All 12 drifts fixed in Sprint 6. The integration CI job
> is now blocking again. This doc is kept as historical reference only.
>
> See commit that removed `continue-on-error` from `.github/workflows/ci.yml`
> for the fix diff.

---


When Phase 3.2 of the hardening plan replaced `pnpm test` (which ran via Turbo and silently swallowed `DATABASE_URL`) with a direct `vitest run --coverage` invocation, the integration test suite ran end-to-end in CI for the first time in a while. It immediately surfaced **12 failing tests** in `tests/integration/api-endpoints.test.ts`.

The failures are **not regressions from the Phase 1-3 commits**. Git archaeology confirms the underlying routes had evolved across many commits before hardening began, and the tests simply hadn't been updated to match. The integration job is therefore marked `continue-on-error: true` in CI — the failures are visible for accountability but do not block merges. This document tracks each drift explicitly so a future session can fix them.

**DO NOT add new entries to this list without first trying to fix the test.** The list should only shrink.

---

## The 12 drifts

### 1-2. Queue admin RBAC

- `Queue admin RBAC > GET /workflows/queue/stats returns 403 for non-admin` — got 200.
- `Queue admin RBAC > GET /workflows/queue/health returns 403 for non-admin` — got 200.

**Likely cause:** the test mints a VIEWER role via `db.user.update({ role: 'VIEWER' })` after registering and then re-logs in. Either the re-login path doesn't pick up the new role, or the route's `requireRole` filter allows VIEWERs.

**Fix guidance:** trace how `request.user.role` is populated; assert the token carries the VIEWER claim after the DB update + relogin.

---

### 3. POST /auth/logout

- `POST /auth/logout > returns 200 and clears the session` — got 400.

**Likely cause:** the logout route's body schema changed or now requires a refresh-token field the test doesn't send.

**Fix guidance:** read `apps/api/src/routes/auth.routes.ts` for the current `/logout` handler; update the test to match its body shape.

---

### 4-5. Workflow CRUD

- `Workflow CRUD > GET /workflows/ returns empty array for fresh user` — `Array.isArray(body?.data)` false.
- `Workflow CRUD > POST /workflows/ creates a workflow` — got 202 (not 201).

**Likely cause:** the workflow creation route was rewritten to async-enqueue behavior and now correctly returns 202 Accepted instead of 201 Created. The test hard-codes 201. The GET failure is probably secondary cascading from a broken setup.

**Fix guidance:** update test to `expect([201, 202]).toContain(status)`.

---

### 6. DELETE /projects/:id

- `Projects + Checkpoints > DELETE /projects/:id removes the project` — got 400.

**Likely cause:** the delete endpoint now requires a confirmation body or stricter path validation.

**Fix guidance:** inspect `apps/api/src/routes/projects.routes.ts` DELETE handler; match the current contract.

---

### 7. GET /approvals/

- `GET /approvals/ > returns empty array for new tenant` — `Array.isArray(body?.data)` false.

**Likely cause:** likely cascading from the setup failures above. If the fresh tenant wasn't created properly, the subsequent GET may return an error envelope instead of `{data: []}`.

---

### 8. GET /skills/

- `Skills routes > GET /skills/ returns array` — `Array.isArray(body?.data)` false.

**Likely cause:** same pattern as GET /approvals/.

---

### 9-10. Memory CRUD

- `Memory CRUD > DELETE /memory/:key removes the entry` — got 400.
- `Memory CRUD > GET /memory/:key returns 404 after deletion` — got 200.

**Likely cause:** DELETE signature may have changed (body required? scope query param?) and the follow-up GET finds the entry still there because the delete didn't actually execute.

---

### 11. POST /schedules/

- `Schedule CRUD > POST /schedules/ creates a schedule` — got 400.

**Likely cause:** schedule create route validation now requires additional fields (industry?, maxCostUsd?) that the test doesn't provide.

---

### 12. GET /traces/

- `Traces routes > GET /traces/ returns array` — `Array.isArray(body?.data)` false.

**Likely cause:** same cascading pattern, or the route now requires a `workflowId` query param.

---

## How to close each item

1. Run the integration suite locally against a real Postgres + Redis:

   ```bash
   docker compose up -d postgres redis
   DATABASE_URL=postgresql://jakswarm:jakswarm@localhost:5432/jakswarm \
   DIRECT_URL=postgresql://jakswarm:jakswarm@localhost:5432/jakswarm \
   REDIS_URL=redis://localhost:6379 \
   AUTH_SECRET=local-test-secret \
   pnpm --filter @jak-swarm/tests exec vitest run integration/api-endpoints.test.ts
   ```

2. For each failing test, read the corresponding route handler and update the assertion or request body to match current reality.

3. Do NOT weaken the assertions to make them pass (e.g., do not change `expect(Array.isArray(body?.data)).toBe(true)` to `expect(true).toBe(true)`). If a route genuinely returns a non-array on success, that is a route bug, not a test bug.

4. Remove the entry from this document as each test is fixed. When all 12 are gone, delete `continue-on-error: true` from the integration-tests CI step and rename this doc to `docs/_archived/test-drift-2026-04-21.md` as a historical record.

## Why this doc exists

- Silent failures are worse than loud ones. Hiding these 12 failures behind a skipped test suite was how they stayed broken for months.
- Fixing them properly is a separate, focused session's work.
- Meanwhile, the rest of the hardening plan (Phases 5-9) should not be blocked on test-drift cleanup.

## Changelog

- `2026-04-21` — Initial entry. 12 failures documented. Integration CI job set to `continue-on-error: true`.
- `2026-04-21` — RESOLVED. All 12 drifts fixed in Sprint 6:
  - `inject()` helper no longer sends `content-type: application/json` on empty-body
    requests (was causing FST_ERR_CTP_EMPTY_JSON_BODY 400s on DELETE/logout).
  - `beforeAll` re-login now hard-fails if it doesn't mint a VIEWER token, so
    Queue admin RBAC tests can't silently run against a TENANT_ADMIN.
  - `POST /workflows/` accepts 202 (not 201) — route is async-by-design.
  - `GET /workflows/`, `/approvals/`, `/skills/`, `/traces/` now assert on
    `data.items` + `data.total` instead of treating `data` as a bare array.
  - `POST /schedules/` body uses `name` + `cronExpression` (route contract)
    instead of `cron` + `timezone`.
  - `.github/workflows/ci.yml` — integration job is blocking again.
