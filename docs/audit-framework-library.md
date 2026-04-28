# Audit framework library

JAK Swarm ships with three frameworks pre-seeded — **182 controls total** (108 operationally backed + 74 require reviewer attestation). Each `AuditRun` references a framework by `frameworkSlug`; the `plan()` step seeds one `ControlTest` row per control.

## Frameworks shipped

| Framework | Slug | Issuer | Version | Seeded | Auto-mapped | Reviewer attest |
|---|---|---|---|---|---|---|
| SOC 2 Type 2 | `soc2-type2` | AICPA | 2017 | 63 | 37 | 26 |
| HIPAA Security Rule | `hipaa-security` | HHS | 2013 | 37 | 25 | 12 |
| ISO/IEC 27001:2022 | `iso27001-2022` | ISO/IEC | 2022 | 82 | 46 | 36 |
| **Total** | | | | **182** | **108** | **74** |

Counts derived at module load via `FRAMEWORK_COUNTS` in the seed file; cross-verified by `pnpm check:truth`.

## Per-control structure

```ts
interface ComplianceControl {
  id:           string;
  frameworkId:  string;
  code:         string;     // e.g. "CC6.1", "164.308(a)(1)", "A.5.1"
  category:     string;     // e.g. "Security", "Administrative Safeguards", "Organizational"
  series:       string;     // e.g. "CC6", "164.308", "A.5"
  title:        string;
  description:  string;     // The actual control text
  autoRuleKey:  string|null; // Maps to AUTO_MAPPING_RULES — null if no automation
  subControls:  Json|null;  // Array of {code, title, description} for sub-points
  sortOrder:    number;
}
```

The `autoRuleKey` resolves to one of 10 implemented rules in `AUTO_MAPPING_RULES`:
- `tenant-rbac-changes`
- `approval-decisions`
- `workflow-evidence-trail`
- `workflow-failures`
- `workflow-resumed-or-rolled-back`
- `tool-blocked-and-policy`
- `guardrail-and-injection-events`
- `pii-detection`
- `artifact-approval-gates`
- `evidence-bundle-signed`

Controls without an `autoRuleKey` are human-mapped only (admin policies, signed BAAs, vendor SOC reports, training records — anything no audit log can produce). They show up in the workpaper with `manualEvidenceCount > 0` once a reviewer attaches a `ManualEvidence` row.

## Adding a new framework

1. Add a new entry to `packages/db/prisma/seed-data/compliance-frameworks.ts` with the framework metadata + control list.
2. For each control with automation, set `autoRuleKey` to one of the 10 implemented keys (or implement a new rule in `apps/api/src/services/compliance/auto-mapping-rules.ts`).
3. Run `pnpm seed:compliance` to upsert. The seeder is idempotent; existing audits keep working.

## Honesty notes

- The 182 controls are real seeded rows, not placeholders. They were sourced from the published standards and can be inspected via `GET /compliance/frameworks/:slug`. Of those, 108 carry an `autoRuleKey` (auto-mapping rule pulls evidence from system activity) and 74 are policy / paperwork / physical and require reviewer attestation — the seed-time helper `withAttestationFlags()` derives `requiresHumanAttestation` from the absence of an `autoRuleKey` so the split can never drift.
- Controls that lack an `autoRuleKey` are clearly classified — the framework summary endpoint reports `controlsWithoutRule` separately. JAK never claims auto-coverage for a control without a rule.
- Sub-controls (`subControls` JSON) are populated for SOC 2 CC6.1's 11 sub-points and a handful of others. Most are still null pending catalog updates — sub-point routing is roadmap.

## Where to look

- Seed data: `packages/db/prisma/seed-data/compliance-frameworks.ts`
- Auto-mapping rules: `apps/api/src/services/compliance/auto-mapping-rules.ts`
- Per-rule tests: `tests/integration/compliance-auto-mapping.test.ts` (16 tests, all passing)
- Schema: `packages/db/prisma/schema.prisma` (`ComplianceFramework`, `ComplianceControl`)
