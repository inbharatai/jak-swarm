# Tamper-evident evidence bundles

## What this is

A signed evidence bundle is a JSON document that cryptographically commits to a set of workflow artefacts. Any modification to the manifest OR to the underlying artifact bytes is detectable on verification.

## Why HMAC-SHA256 (not PKI)

For v1 we control both signer and verifier (same server). HMAC-SHA256 gives:

- Integrity check on the manifest itself.
- Integrity check on each referenced artifact (via content hash).
- Tenant-scoped key derivation (a bundle signed for tenant A cannot be presented as tenant B's).
- Constant-time signature comparison (timing-attack safe).
- ~zero deploy footprint (built-in `node:crypto`).

PKI (signed certificates, third-party verifiers, hardware key stores) is overkill for v1 and introduces operational complexity (certificate rotation, CA trust, revocation lists) we don't need yet. Roadmap entry below for when we do.

## Key derivation

```
server_secret  = process.env.EVIDENCE_SIGNING_SECRET    (≥16 bytes; 32+ recommended)
tenant_key     = HMAC-SHA256(server_secret, tenantId)
manifest_sig   = HMAC-SHA256(tenant_key, canonicalJson(manifest))
```

The server secret never touches the database. Per-tenant keys are derived on demand and held only in memory. Rotating the server secret invalidates EVERY existing bundle's signature — see "Rotation" below.

`canonicalJson` produces a stable, key-sorted JSON serialisation. Identical manifests always produce identical signed bytes.

## Manifest shape

```json
{
  "version": 1,
  "tenantId": "tenant-a",
  "workflowId": "wf_abc123",
  "generatedAt": "2026-04-25T10:30:00.000Z",
  "artifacts": [
    {
      "artifactId": "art_111",
      "fileName": "workflow_report.pdf",
      "contentHash": "sha256-hex",
      "sizeBytes": 4317,
      "artifactType": "export"
    }
  ],
  "metadata": { "controlFramework": "SOC2-Type2" }
}
```

## Producing a bundle

`POST /workflows/:workflowId/bundle`

```json
{
  "metadata": { "controlFramework": "SOC2-Type2" }
}
```

Response:

```json
{
  "data": {
    "artifactId": "art_bundle_xyz",
    "manifest": { "...": "..." },
    "signature": "<64-hex-chars>",
    "signatureAlgo": "HMAC-SHA256"
  }
}
```

The bundle itself is persisted as a `WorkflowArtifact` with:

- `artifactType='evidence_bundle'`
- `mimeType='application/json'`
- `inlineContent` = the full `{manifest, signatureAlgo, signature}` JSON
- `approvalState='REQUIRES_APPROVAL'` (always — bundles are binding)

## Verifying a bundle

`POST /artifacts/:id/verify`

```json
{ "data": { "valid": true } }
```

or

```json
{ "data": { "valid": false, "reason": "manifest_signature_mismatch" } }
```

Verification performs TWO checks:

1. **Signature check** — recomputes the HMAC over the (canonicalised) manifest and compares against the stored signature. Catches any modification to the manifest itself.
2. **Artifact-bytes check** — for each referenced artifact, fetches the current bytes and compares the recomputed sha256 against the manifest's `contentHash`. Catches tampering with the artifacts AFTER signing.

Possible verification outcomes:

| Outcome | Meaning |
|---|---|
| `{ valid: true }` | Bundle is intact and every referenced artifact's bytes still match |
| `{ valid: false, reason: 'manifest_signature_mismatch' }` | Manifest body was modified (or signature was forged with the wrong key) |
| `{ valid: false, reason: 'artifact_hash_mismatch', artifactId }` | A specific artifact's bytes have changed since the bundle was signed |
| `{ valid: false, reason: 'signing_unavailable' }` | `EVIDENCE_SIGNING_SECRET` is unset (verifier can't recompute) |
| `{ valid: false, reason: 'malformed_bundle' }` | Bundle JSON shape is wrong (missing manifest, unknown algo, etc.) |

Verification NEVER throws on tamper — it always returns a structured `VerifyResult`.

## What it catches

- Anyone editing the bundle JSON after creation
- Anyone swapping out an artifact's bytes in storage
- Anyone deleting an artifact and trying to keep the bundle valid
- Cross-tenant signature forgery (different tenantId → different key)
- Replay of a bundle from a different workflow (workflowId is in the manifest)

## What it does NOT catch (yet)

- A compromise of `EVIDENCE_SIGNING_SECRET` itself — an attacker with the secret can produce arbitrary signed bundles. Mitigation: rotate the secret regularly; store in a secret manager (Render/Vercel env, not in code).
- Replay of a bundle to a third party — without PKI / public verifiability, the recipient must trust JAK Swarm's HMAC oracle.
- Time-bounded validity — bundles don't expire. If you need expiry, add a `validUntil` field to `metadata` and check it at verification time (out of scope for v1).

## Rotation

```
openssl rand -base64 48     # generate a fresh secret
```

Then set `EVIDENCE_SIGNING_SECRET=<new-value>` in:
- `apps/api/.env` (local dev)
- Render service → Environment
- Vercel project → Environment Variables (preview + production)

**Rotating invalidates EVERY bundle signed under the old secret.** All re-verifications will return `{valid: false, reason: 'manifest_signature_mismatch'}` — by design. If you need to keep old bundles verifiable, store the prior secret as `EVIDENCE_SIGNING_SECRET_PREVIOUS` and extend the verifier to try both (out of scope for v1; documented as a rotation roadmap item).

## Rotation roadmap

- Multi-key verifier (try current then previous secret)
- Per-secret `keyId` stamped in the manifest
- Time-bounded secret validity windows
- Eventually: PKI with public-key verification for third-party recipients

## Security notes

- The server secret is NEVER reused for anything else (NOT for JWT signing, NOT for password hashing, NOT for cookies). If `AUTH_SECRET` is rotated, `EVIDENCE_SIGNING_SECRET` is unaffected and vice versa.
- Signatures use timing-safe comparison (`crypto.timingSafeEqual`) to defeat timing attacks.
- The signing path validates `EVIDENCE_SIGNING_SECRET.length >= 16`; shorter secrets throw `BundleSigningUnavailableError`.

## Tests

- `tests/integration/bundle-signing.test.ts` — 18 tests covering:
  - Round-trip: sign then verify
  - Tamper with manifest body / artifacts / signature → all detected
  - Cross-tenant signature forgery rejected
  - Missing secret produces honest `signing_unavailable` outcome
  - Constant-time comparison verified
  - Artifact-bytes verification catches swapped bytes AND deleted artifacts
