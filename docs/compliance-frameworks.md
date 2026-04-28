# Compliance frameworks (SOC 2 Type 2, etc.)

## What this is

A control-framework mapping system on top of the Audit & Compliance v0 foundation. Today's framework: **SOC 2 Type 2** (real AICPA Trust Services Criteria, 2017 revision 2022). Adding new frameworks (HIPAA, ISO 27001, PCI-DSS) is a matter of dropping a new entry in `packages/db/prisma/seed-data/compliance-frameworks.ts` and re-running `pnpm seed:compliance`.

## Why it works

Each control in the catalog has an optional `autoRuleKey` that points at a function in `apps/api/src/services/compliance/auto-mapping-rules.ts`. The function is a pure mapping from `(tenant's recent audit log + workflows + approvals + artifacts) → evidence candidates`. Running the auto-mapper produces `ControlEvidenceMapping` rows linking real records to the controls they satisfy.

A periodic **attestation** materialises the per-control evidence count for a date window into a real PDF artifact — optionally signed via the existing tamper-evident bundle service.

## Three-table model

| Table | Tenant-scoped? | Purpose |
|---|---|---|
| `compliance_frameworks` | NO (global) | Framework definitions (SOC 2 Type 2, etc.) |
| `compliance_controls` | NO (global) | Individual controls within a framework |
| `control_evidence_mappings` | YES | Links between controls + tenant evidence rows |
| `control_attestations` | YES | Period attestation summaries pointing at signed PDFs |

## SOC 2 Type 2 catalog shipped

- **33 Common Criteria** (CC1.1 → CC9.2) covering Security
- **3 Availability** anchors (A1.1 → A1.3)
- **5 Processing Integrity** anchors (PI1.1 → PI1.5)
- **2 Confidentiality** anchors (C1.1, C1.2)
- **5 Privacy** anchors (P1.1, P3.1, P4.1, P6.1, P8.1)

SOC 2 Type 2 total: **63 controls** (37 with auto-mapping rules, 26 require reviewer attestation). Across all three shipped frameworks (SOC 2 + HIPAA + ISO 27001) the totals are **182 seeded · 108 auto-mapped · 74 reviewer-attest** — derived in `FRAMEWORK_COUNTS` at the bottom of `compliance-frameworks.ts` so the split can never drift.

## Auto-mapping rules

10 rules in `auto-mapping-rules.ts`. Each is referenced from one or more controls in the catalog. **Conservative by design** — better to under-map (forcing curation) than over-claim evidence.

| Rule key | Controls it serves | What it captures |
|---|---|---|
| `tenant-rbac-changes` | CC1.3, CC1.4, CC3.4, CC6.2, CC7.1 | USER_*/TENANT_SETTINGS_*/INDUSTRY_PACK_SELECTED audit rows |
| `approval-decisions` | CC1.5, CC5.1, CC6.3, P8.1 | APPROVAL_* audit rows + decided ApprovalRequest rows |
| `workflow-evidence-trail` | CC2.1, CC2.2, A1.1, PI1.1, PI1.3 | WORKFLOW_COMPLETED audit + completed Workflow rows |
| `workflow-failures` | CC4.1, CC4.2, CC7.4 | WORKFLOW_FAILED + GUARDRAIL_TRIGGERED + failed Workflow rows |
| `workflow-resumed-or-rolled-back` | CC7.5, A1.2 | WORKFLOW_RESUMED / WORKFLOW_CANCELLED audit rows |
| `tool-blocked-and-policy` | CC5.2, CC6.1, CC6.8, PI1.2 | TOOL_BLOCKED + PERMISSION_DENIED audit rows |
| `guardrail-and-injection-events` | CC3.2, CC3.3, CC6.6, CC7.2, CC7.3 | GUARDRAIL_TRIGGERED + INJECTION_DETECTED audit rows |
| `pii-detection` | C1.1, P1.1, P3.1, P4.1 | PII_DETECTED audit rows |
| `artifact-approval-gates` | CC6.7, CC8.1, PI1.4, P6.1 | WorkflowArtifact rows in any approval state |
| `evidence-bundle-signed` | PI1.5 | READY evidence_bundle artifacts |

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/compliance/frameworks` | any auth | List active frameworks |
| GET | `/compliance/frameworks/:slug` | any auth | Framework + per-control evidence count for tenant |
| GET | `/compliance/frameworks/:slug/controls/:controlId/evidence` | any auth | Drill-in: list evidence rows for one control |
| POST | `/compliance/frameworks/:slug/auto-map` | REVIEWER+ | Re-run auto-mapping engine for tenant |
| POST | `/compliance/frameworks/:slug/attestations` | REVIEWER+ | Generate signed PDF attestation |
| GET | `/compliance/attestations` | any auth | List previously generated attestations |

All routes are tenant-scoped via `request.user.tenantId`. Failure modes:
- `503 COMPLIANCE_SCHEMA_UNAVAILABLE` — migration `11_compliance_framework` not deployed; run `pnpm db:migrate:deploy`
- `503 ARTIFACT_SCHEMA_UNAVAILABLE` — `10_workflow_artifacts` not deployed
- `503 BUNDLE_SIGNING_UNAVAILABLE` — `EVIDENCE_SIGNING_SECRET` env var unset (only on `sign=true`)
- `404 NOT_FOUND` — framework slug or workflow id not visible to the tenant

## Operator commands

```bash
# 1. Apply the migration (one-time, idempotent)
pnpm db:migrate:deploy

# 2. Seed the framework catalog (idempotent)
pnpm seed:compliance

# 3. Optional — populate demo data so the UI shows real activity
pnpm seed:audit-demo

# 4. Open /audit in the dashboard → Compliance tab → pick framework
# 5. Click "Run auto-map" → see evidence counts populate
# 6. Set period start/end → click "Generate attestation" → PDF artifact created
```

## Adding a new framework (e.g. HIPAA)

1. Append a new `SeedFramework` to `FRAMEWORKS` in `packages/db/prisma/seed-data/compliance-frameworks.ts`
2. Reference existing `autoRuleKey` values OR add new rules in `auto-mapping-rules.ts`
3. Run `pnpm seed:compliance` to upsert into the database
4. The Compliance UI tab automatically picks up the new framework — no UI changes needed

## Adding a new auto-mapping rule

1. Implement the rule function in `auto-mapping-rules.ts` (pure function over `AutoMapInputs`)
2. Add it to the `AUTO_MAPPING_RULES` registry
3. Reference its key from one or more controls in the catalog
4. Re-run `pnpm seed:compliance`
5. Run `pnpm test` to confirm the catalogue→rule key reference is satisfied (the test enforces no broken references)

## Honesty rules enforced

- ✅ The PDF report shows the **real** count of mapped evidence per control. Coverage % is computed from the database.
- ✅ Controls with **zero evidence** are listed explicitly as "0 — UNCOVERED" in the PDF, not hidden.
- ✅ Auto-mapping rules are **conservative**: only obvious 1:1 matches. Most controls require human curation for full coverage — the UI surfaces this so an auditor sees the gap.
- ✅ Attestations are auto-marked `approvalState=REQUIRES_APPROVAL` — they cannot be downloaded until a reviewer approves.
- ✅ Signed bundles use the same HMAC-SHA256 + tenant-scoped key derivation as the rest of the system. See `docs/tamper-evident-bundles.md`.

## What it is NOT (Phase 3 roadmap)

- **Multi-period continuous attestation** — today each attestation is a one-shot snapshot. Continuous monitoring (e.g. weekly auto-attestation cadence) is roadmap.
- **Custom evidence types** — today rules know about audit_log / workflow / approval / artifact / evidence_bundle. Letting tenants add custom evidence types (e.g. "uploaded PDF policy doc") is roadmap.
- **External attestation portals** — today attestations are downloaded by tenant users. Customer-facing portals where an auditor logs in directly (read-only on the tenant's evidence) are roadmap.
- **HIPAA, ISO 27001, PCI-DSS catalogues** — only SOC 2 Type 2 ships today. Other frameworks reuse the same model + UI.
