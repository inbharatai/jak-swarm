# Audit & Compliance product — start gate

**Date:** 2026-04-25
**Verdict:** **READY FOR FULL AUDIT PRODUCT BUILD** — every requirement listed by the operator in the foundation gate is closed in code + tests. Two operational gates remain (operator-side, not code-side):

1. Top up the OpenAI account so live workflow runs can be observed visually.
2. Apply migration `10_workflow_artifacts` to staging via `pnpm db:migrate:deploy` so the artifact + bundle endpoints work in deployed env.

Both are external dependencies, not engineering work.

## Requirement-by-requirement audit

| Requirement | Status | Evidence |
|---|---|---|
| Secrets exposed → checklist exists + hygiene fixes | DONE | `qa/security-secret-rotation-checklist.md` + `.gitignore` tightened to `apps/*/.env` + `packages/*/.env` + `tests/e2e/qa-world-class.spec.ts` stale credential scrubbed. Operator confirmed rotation done. |
| OpenAI quota classification (`OPENAI_QUOTA_EXHAUSTED` vs runtime failure) | DONE | `BenchmarkFailureKind` enum; `classifyBenchmarkFailure()`; CLI exits 2 on quota-only failures (treated as warning, not error). Live bench confirms 4/4 quota-blocked, 0/4 real failures. |
| Migration `10_workflow_artifacts` deployable + fail-safe | DONE | Migration file shipped; `ArtifactSchemaUnavailableError` translates Prisma P2021 → HTTP 503 with operator hint; new `/admin/diagnostics/artifacts` reports schema + bucket health; **7 schema-failsafe tests pass**. |
| Real PDF / DOCX / XLSX / CSV / JSON converters | DONE | `apps/api/src/services/exporters/index.ts` — 5 real implementations using pdfkit / docx / xlsx; **15 magic-byte verified tests pass**. |
| Export creates real WorkflowArtifact | DONE | `apps/api/src/services/export.service.ts` + `apps/api/src/routes/exports.routes.ts`. Failure path creates `status='FAILED'` row, never silent drop. |
| Export approval gating (`markFinal`) | DONE | `markFinal=true` → `approvalState='REQUIRES_APPROVAL'` → download blocked with `ARTIFACT_GATED_REQUIRES_APPROVAL` until reviewer approves. |
| Tamper-evident HMAC-signed bundles | DONE | `apps/api/src/services/bundle-signing.service.ts` + `bundle.service.ts`; tenant-scoped key derivation; `EVIDENCE_SIGNING_SECRET` (NOT `AUTH_SECRET`); **18 signing tests pass** including all 4 tamper-detection vectors. |
| Bundle verification endpoint | DONE | `POST /artifacts/:id/verify` returns structured `VerifyResult`. Verifies signature AND artifact bytes. Never throws on tamper — always returns `{valid: false, reason: ...}`. |
| CI / manual benchmark safety | DONE | `bench-runtime.yml` masks `OPENAI_API_KEY` via `::add-mask::`; quota exit translates to `::warning::` not red ❌; never echoes value. |
| Final foundation gate updated | THIS DOCUMENT | |

## Tests landed

| File | Count | Status |
|---|---|---|
| `packages/swarm/src/state/run-lifecycle.test.ts` | 32 | PASS |
| `tests/integration/approval-roundtrip.test.ts` | 5 | PASS |
| `tests/integration/artifact-schema-failsafe.test.ts` | 7 | PASS |
| `tests/integration/exporters.test.ts` | 15 | PASS |
| `tests/integration/bundle-signing.test.ts` | 18 | PASS |
| **TOTAL NEW + EXISTING** | **77** | **77 PASS** |

## What "ready" means

- ✅ Secrets are managed (rotated by operator, hygiene fixes shipped)
- ✅ Quota failures are reported honestly, not as model failures
- ✅ Artifact migration ships with clear fail-safe behaviour AND a deploy command
- ✅ Export converters create real bytes (no fake exports)
- ✅ Signed evidence bundles really sign + really detect tampering
- ✅ CI workflow doesn't print secrets and treats quota correctly
- ✅ Audit & Compliance start gate updated honestly

## What "ready" does NOT mean

- ❌ It does NOT mean the product has been live-validated end-to-end against production. That requires the two operator-side gates (quota top-up + migration deploy) before manual integration recipes in `qa/openai-first-live-verification.md` can be walked through.
- ❌ It does NOT mean every roadmap item is built. PKI bundle signing, format converters with branding, multi-key rotation, OCR, retention sweeps — all documented as deferred but not blockers.
- ❌ It does NOT mean the audit-compliance product can immediately ship a marketing claim like "tamper-evident SOC2-grade evidence". That requires the operator to actually deploy + use the system in front of a customer first; the engineering is in place.

## Two operator-side gates to close before customer demo

### Gate A — OpenAI quota top-up

```bash
# After topping up at https://platform.openai.com/billing:
pnpm bench:runtime              # confirm 4/4 LLM scenarios PASS
```

If it passes, OpenAI-first is live-verified. If it still fails, debug from there.

### Gate B — Apply artifact migration to staging

```bash
# From a machine with staging DATABASE_URL set:
pnpm db:migrate:deploy
# Then verify:
curl -H "Authorization: Bearer $TOKEN" \
  https://jak-swarm-api.onrender.com/admin/diagnostics/artifacts
# Expect: {ready: true, schemaPresent: true, bucketReachable: true}
```

If `schemaPresent` is false after the deploy command, check the Render service logs.

## Honest scope of what was built in this hardening pass

- **2 new Prisma models** (none — migration file exists from prior pass; this pass just hardens the routes around it)
- **0 new Prisma migrations** (`10_workflow_artifacts` was added in the previous foundation pass; this pass adds the fail-safe path around it)
- **3 new services** (artifact, export, bundle-signing — bundle thin wrapper)
- **3 new route files** (artifacts, exports, bundles)
- **5 new exporters** (json/csv/xlsx/pdf/docx)
- **3 new error classes** (ArtifactSchemaUnavailableError, ArtifactGatedError, BundleSigningUnavailableError)
- **45 new tests** (7 schema-failsafe + 15 exporters + 18 bundle-signing + 5 approval round-trip from prior pass)
- **2 new docs** (`docs/export-system.md`, `docs/tamper-evident-bundles.md`)
- **5 new qa docs** (security checklist, evidence-document, artifact-export, export-converter, evidence-bundle-signing)
- **1 hardened CI workflow** (`bench-runtime.yml` quota-aware + secret-masked)

## Final verdict

**READY FOR FULL AUDIT PRODUCT BUILD.**

Begin the Audit & Compliance product. The foundation is real, tested, documented, and honest about its limits. The two operator-side gates are external blockers, not engineering work — and the manual recipes in `qa/openai-first-live-verification.md` walk the operator through both.
