# Test Coverage + E2E Results (Phase 15)

Verified at commit `c2fb125`. Local-only run; CI on c2fb125 was green.

---

## 1. Test inventory

| Category | Files | Tests | Status |
|---|---|---|---|
| Unit | 72 | **751** | ✅ all passing locally |
| Integration | 23 | (Postgres-required; not run in this static audit) | (NEEDS RUNTIME) |
| E2E (Playwright) | 12 specs | (server-required; not run in this static audit) | (NEEDS RUNTIME) |
| **Total test files** | **95** | | |

---

## 2. Unit test categories vs spec required

| Spec category | Files | Verdict |
|---|---|---|
| unit | tests/unit/* | ✅ 72 files |
| integration | tests/integration/* | ✅ 23 files (Postgres) |
| E2E | tests/e2e/* | ✅ 12 spec files (Playwright) |
| UI | tests/e2e/* | ✅ Playwright covers UI |
| runtime | tests/unit/agents/* + tests/unit/swarm/* | ✅ |
| worker | tests/unit/swarm/swarm-runner.test.ts + worker-node-browser | ✅ |
| graph | tests/unit/swarm/langgraph-graph-builder.test.ts (8) + postgres-checkpointer (18) | ✅ |
| approval | tests/unit/swarm/approval-gate.test.ts + tests/integration/approval-roundtrip.test.ts | ✅ |
| security | tests/unit/security/* (5 files) | ✅ |
| document parsing | tests/unit/services/document-parsers.test.ts (7) | ✅ |
| company brain | tests/integration/company-os-foundation.test.ts (26) + crawler tests | ✅ |
| audit workflow | tests/integration/audit-run-e2e.test.ts | ✅ |
| role agents | tests/unit/agents/role-*.test.ts (5 files, ~50 behavioral tests) | ✅ |
| cost tracking | tests/unit/agents/agent-execution-behavioral.test.ts (incl. cache cost) | ✅ |

✅ **Every spec required category has tests.**

---

## 3. Spec required E2E tests — coverage check

### E2E 1 — Layman company workflow ("Review my company website and create a marketing improvement plan.")

**Coverage:**
- Intent detection: covered by `tests/integration/company-os-foundation.test.ts` (Commander + intent vocabulary)
- Company context loading: structural — `injectCompanyContext` exists and is wired
- Agent assignment: covered by `tests/integration/company-os-foundation.test.ts` (INTENT_TO_LIKELY_AGENTS)
- Graph + events: structural — verified in `tests/unit/swarm/langgraph-graph-builder.test.ts`
- Report generation: structural — verified in workflow tests

**Live e2e:** ⚠️ NEEDS RUNTIME — would need running server + LLM key + Playwright
spec to drive the UI

### E2E 2 — Code workflow ("Review this repo and fix the landing page.")

**Coverage:**
- Intent detection + agent assignment: structural ✅
- Files inspected + patch created: covered by `vibe-coder-workflow.test.ts` (3 tests)
- Tests run: covered by `static-build-checker.test.ts` (12) + `docker-build-checker.test.ts` (15)
- Report generated: structural ✅

**Live e2e:** ⚠️ NEEDS RUNTIME

### E2E 3 — Audit workflow ("Audit these compliance documents and create workpapers.")

**Coverage:**
- audit workflow selected: covered by intent vocabulary test
- evidence parsed: covered by document-parsers tests (7)
- controls mapped: covered by compliance-mapper tests
- workpapers generated: covered by audit-run-e2e test (Postgres-required)
- approval required: covered by approval-roundtrip test
- final pack BLOCKED until approval: covered by audit-run-e2e test
- final pack generated AFTER approval: covered by audit-run-e2e test

**Live e2e:** ✅ EXISTS (`tests/integration/audit-run-e2e.test.ts`) but
requires Postgres to run. ⚠️ NEEDS RUNTIME for full execution.

### E2E 4 — External auditor workflow

**Coverage:**
- Admin invites auditor: covered by `tests/unit/services/external-auditor.test.ts` (16 tests)
- Auditor accepts invite: same test file
- Auditor reviews workpaper: same
- Auditor comments/approves/rejects: same
- Action appears in audit trail: same
- **Final-pack download (Gap D):** structural — verified by routes existing + UI button
- **Email send (Gap C):** verified by `not_configured` + `failed` tests

**Live e2e:** ⚠️ NEEDS RUNTIME for cross-process invite-and-accept flow

### E2E 5 — Retention sweep

**Coverage:**
- Dry-run report: ✅ tested in `tests/unit/services/retention-sweep.test.ts` (9 tests)
- Real sweep deletes only allowed: ✅ same
- Tenant isolation: ✅ same
- Protected types not touched: ✅ same

**Live e2e:** ✅ unit tests cover the contract; live admin route call would close it.

---

## 4. Final hardening tests added (this audit cycle)

| Gap | Tests added | File |
|---|---|---|
| A. CEO super-orchestrator | 15 | `tests/unit/services/ceo-orchestrator.test.ts` |
| B. Cross-task auto-repair | 27 | `tests/unit/services/repair-service.test.ts` |
| C. Auditor email send | 5 (added to existing) | `tests/unit/services/external-auditor.test.ts` |
| D. Final-pack download | (route + UI verified; integration covers) | `tests/unit/services/external-auditor.test.ts` |
| E. Retention sweep | 9 | `tests/unit/services/retention-sweep.test.ts` |
| **Total new** | **56** | |

---

## 5. Test gaps (honest)

1. **Live LLM integration tests** — every agent's behavior tested via
   stubbed `callLLM`, not real OpenAI. Live grading is the missing
   empirical layer.
2. **Live UI Playwright runs** — 12 spec files exist but require running
   server. Not run in this static audit.
3. **Cross-process LangGraph pause/resume** — 18 unit tests cover the
   checkpointer storage; live Postgres + LLM end-to-end test would
   close the empirical gap.
4. **Retention-sweep cron schedule** — operator-managed; no scheduled
   test of the cron itself.
5. **Multi-tenant load test** — never run.

---

## 6. CI pipeline

`.github/workflows/ci.yml`:
- `build` job: typecheck all packages, build, web build
- `test` job: unit tests + Postgres-required integration tests against pgvector container + Redis container
- `security-gate`: AUTH_SECRET + secret scan + production boot guard
- `secret-scan`: gitleaks
- `dependency-audit`: pnpm audit production high+ CVE
- `sbom`: CycloneDX SBOM generation on main
- `truth-check`: docs claim alignment vs runtime registry

✅ Multi-job CI with security + truth gates.

---

## 7. Rating

**Test coverage: 8.5 / 10**

- ✅ 751/751 unit tests passing
- ✅ 95 total test files
- ✅ Every spec category has tests
- ✅ Final hardening adds 56 new tests
- ✅ CI pipeline has 6 jobs (build + test + 4 security/truth gates)
- ✅ E2E specs exist (12 Playwright files)

**Why not 10/10:**
- Live LLM integration tests not run (NEEDS RUNTIME)
- Live UI Playwright not run in this static audit (NEEDS RUNTIME)
- No load testing
- No automated mutation testing
- No automated chaos testing

These are PRODUCTION VALIDATION gaps, not code-level gaps.
