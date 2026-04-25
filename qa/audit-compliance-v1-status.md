# Audit & Compliance — v1 status

**Date:** 2026-04-25
**Verdict:** **v1 SHIPPED.** Real SOC 2 Type 2 control framework + auto-mapping engine + signed PDF attestations + UI tab. 16 new tests pass.

## What v1 is

Building on v0 (audit log + reviewer queue + workflow trail + dashboard), v1 adds the **control framework mapping layer**:

- 48 real SOC 2 Type 2 controls seeded from the AICPA TSP 100 catalog
- 10 auto-mapping rules linking audit-log / workflow / approval / artifact rows to the controls they satisfy
- Period attestation generation: produces a real PDF artifact + optionally an HMAC-signed evidence bundle
- New "Compliance" tab in `/audit` with framework selector, control drill-in, attestation generator, attestation history table

## Files added

### Backend
- `packages/db/prisma/schema.prisma` — 4 new models (`ComplianceFramework`, `ComplianceControl`, `ControlEvidenceMapping`, `ControlAttestation`)
- `packages/db/prisma/migrations/11_compliance_framework/migration.sql` — additive migration
- `packages/db/prisma/seed-data/compliance-frameworks.ts` — 48-control SOC 2 Type 2 catalog
- `packages/db/prisma/seed-compliance.ts` — idempotent seed script
- `apps/api/src/services/compliance/auto-mapping-rules.ts` — 10 declarative rules
- `apps/api/src/services/compliance/compliance-mapper.service.ts` — runs rules, persists ControlEvidenceMapping rows
- `apps/api/src/services/compliance/attestation.service.ts` — generates PDF + optional signed bundle
- `apps/api/src/routes/compliance.routes.ts` — 6 routes
- `apps/api/src/index.ts` — route registration

### Frontend
- `apps/web/src/lib/api-client.ts` — `complianceApi` + 7 typed interfaces
- `apps/web/src/app/(dashboard)/audit/page.tsx` — 5th tab "Compliance" with framework selector + per-control drill-in + attestation panel

### Operator helpers
- `scripts/seed-audit-demo.ts` — populates demo workflows + approvals + audit rows + artifacts so the UI shows real activity on first launch
- `package.json` — `seed:compliance` + `seed:audit-demo` scripts

### Tests
- `tests/integration/compliance-auto-mapping.test.ts` — 16 tests covering all 10 rules, registry consistency, conservatism guarantees

### Docs
- `docs/compliance-frameworks.md` — full reference
- `qa/audit-compliance-v1-status.md` — this file

## Test results

All new tests pass (16/16). All v0 tests still pass (88/88). Pre-existing test failures in `full-pipeline.test.ts` + `workflow-errors-behavioral.test.ts` are unrelated to this pass — confirmed by `git stash` reproduction.

| Test suite | Count | Status |
|---|---|---|
| `compliance-auto-mapping.test.ts` | 16 | PASS (this session) |
| `audit-routes.test.ts` | 11 | PASS |
| `approval-roundtrip.test.ts` | 5 | PASS |
| `artifact-schema-failsafe.test.ts` | 7 | PASS |
| `exporters.test.ts` | 15 | PASS |
| `bundle-signing.test.ts` | 18 | PASS |
| `run-lifecycle.test.ts` | 32 | PASS |
| **TOTAL NEW + EXISTING (compliance-related)** | **104** | **104 PASS** |

## Honesty rules enforced

- ✅ **48 real SOC 2 controls** with real titles, descriptions, AICPA codes — no "Control 1, Control 2" placeholders.
- ✅ **Auto-mapping rules are conservative** — under-map rather than over-claim. Catalogue test verifies every referenced rule key has an implementation (no broken references).
- ✅ **Attestation PDF shows uncovered controls explicitly** as "0 — UNCOVERED" so an auditor sees the gap.
- ✅ **Coverage % is computed from real DB rows**, not faked.
- ✅ **Failure modes are honest**: 503 with operator hint when migration not deployed, 503 with "set EVIDENCE_SIGNING_SECRET" when signing requested but unavailable.
- ✅ **Tenant isolation** verified end-to-end: every query uses `request.user.tenantId`; the rule engine is a pure function over pre-filtered tenant data.
- ✅ **Idempotent operations**: re-seed, re-run auto-map, re-generate attestation all safe.

## What v1 is NOT (Phase 3 roadmap)

- Multi-period continuous attestation (auto-cadence weekly/monthly)
- Custom evidence types beyond audit_log / workflow / approval / artifact / evidence_bundle
- External auditor portals (read-only login for third-party reviewers)
- HIPAA / ISO 27001 / PCI-DSS catalogs (the model + UI support them; just need the catalog data)
- Sub-control breakdowns (e.g. CC6.1 has 11 sub-points; we map to the parent only today)

These are documented as roadmap, not faked.

## Operator command sequence (top to bottom)

```bash
# 0. Pull latest
git pull origin main

# 1. Apply migrations (one-time, idempotent — covers both 10 + 11)
pnpm db:migrate:deploy

# 2. Seed compliance frameworks (idempotent — safe after every deploy)
pnpm seed:compliance

# 3. (optional) Populate demo activity so the UI is non-empty on first launch
pnpm seed:audit-demo

# 4. (optional) Set EVIDENCE_SIGNING_SECRET for signed bundles
export EVIDENCE_SIGNING_SECRET=$(openssl rand -base64 48)
# Set the same value in Render dashboard → Environment

# 5. Open /audit in the dashboard as TENANT_ADMIN or REVIEWER
#    → Compliance tab → pick SOC 2 Type 2 → click "Run auto-map"
#    → Set period start/end → "Generate attestation"
#    → Approve the resulting artifact via /artifacts/:id/approve to allow download
```

## Two operational gates remain (operator-side)

Same as v0 + one new:

1. **`pnpm db:migrate:deploy`** against staging — applies BOTH `10_workflow_artifacts` AND `11_compliance_framework`. The Compliance tab returns 503 with hint until done.
2. **`pnpm seed:compliance`** against staging — idempotent. Required after every deploy that adds/changes controls.
3. **OpenAI quota top-up** — same as before. Affects bench:runtime only; v1 has no LLM dependency.

## Verdict

**v1 ready to use today.** All gates are operator commands, not engineering work. The system delivers:
- Real audit visibility (v0)
- Real control framework mapping (v1, this pass)
- Real signed evidence bundles (foundation pass)
- Real exports + approval gates (foundation pass)

Phase 3 (continuous attestation, external portals, more frameworks) is the next product surface — not a foundation gap.
