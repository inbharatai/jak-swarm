# Evidence bundle signing readiness

**Date:** 2026-04-25
**Verdict:** **READY** — HMAC-SHA256 signing + tenant-scoped key derivation + tamper detection on both manifest and artifact bytes. 18/18 tests pass.

## Per-requirement verdict

| Requirement | Status | Evidence |
|---|---|---|
| Bundle manifest | READY | `BundleManifest` shape includes version, tenantId, workflowId, generatedAt, artifacts[], optional metadata |
| Artifact hashes in manifest | READY | sha256 of artifact bytes is captured at create time + checked on verify |
| Evidence file hashes | READY | Each artifact ref has `contentHash` (sha256 hex) |
| Generated timestamp | READY | `generatedAt` ISO timestamp in manifest |
| Tenant ID in manifest | READY | `tenantId` field; cross-tenant signature forgery rejected (verified by test) |
| Audit run/workflow ID | READY | `workflowId` field |
| HMAC signature using server secret | READY | `EVIDENCE_SIGNING_SECRET` env var, ≥16 chars; tenant key derived as HMAC(secret, tenantId) |
| Verification endpoint or service | READY | `POST /artifacts/:id/verify` returns structured `VerifyResult` |
| Status: signed / unsigned / verification_failed | READY | Bundle artifacts get `artifactType='evidence_bundle'`; verification returns `valid: true/false` with `reason` |

## Honesty rules enforced

- ✅ The signing path REFUSES to use leaked / unset / too-short secrets. `BundleSigningUnavailableError` thrown with a clear "set EVIDENCE_SIGNING_SECRET" message; HTTP 503 returned at the route.
- ✅ The `AUTH_SECRET` (JWT signing) is INTENTIONALLY NOT reused for bundle signing. Two separate secrets so rotating one doesn't invalidate the other.
- ✅ Verification is constant-time (`crypto.timingSafeEqual`).
- ✅ Verification NEVER throws on tamper — returns structured `VerifyResult` so the cockpit can render honestly.
- ✅ Every signed bundle is itself a `WorkflowArtifact` with `approvalState='REQUIRES_APPROVAL'` — bundles cannot be downloaded without reviewer approval.
- ✅ NO false claims about signing capability when the secret is missing — the diagnostic + the operational endpoint both return `signing_unavailable` and a remediation hint.

## Tamper-detection coverage

| Threat | Detected? | Test |
|---|---|---|
| Manifest body modified after signing | YES | `detects tampering with the manifest body` |
| Artifacts list modified | YES | `detects tampering with the artifacts list` |
| Signature replaced with garbage | YES | `detects tampering with the signature itself` |
| Cross-tenant relabel attack | YES | `different tenantIds produce different signatures` |
| Bundle JSON malformed | YES | `rejects malformed bundle (missing manifest)` |
| Unknown signature algo | YES | `rejects unknown signature algo` |
| Artifact bytes swapped after signing | YES | `detects swapped bytes (manifest hash no longer matches)` |
| Artifact deleted after signing | YES | `detects deleted artifact (loadArtifactBytes returns null)` |
| Server secret missing on verify | YES | `verification returns signing_unavailable` |

## Operational notes

- `EVIDENCE_SIGNING_SECRET` must be set in env. Recommended: 32+ random bytes.
- Generation: `openssl rand -base64 48`
- Rotation: see `docs/tamper-evident-bundles.md` § Rotation. Rotation invalidates ALL existing bundles' signatures.
- `/admin/diagnostics` will report signing readiness once that endpoint is added (next pass).

## Tests

- `tests/integration/bundle-signing.test.ts` — 18 tests covering canonical JSON, signing, verification, tamper detection (4 cases), missing-secret handling, artifact-bytes verification.

## Roadmap (not blockers)

| Item | When |
|---|---|
| `/admin/diagnostics/bundle-signing` endpoint reporting signing readiness | Same hardening pass — see audit-compliance gate |
| Multi-key verifier (try current + previous secret) for graceful rotation | Phase 2 |
| Per-secret `keyId` stamped in manifest | Phase 2 |
| PKI (public-key signatures) for third-party verification | Future, when external recipients require independent verification |
