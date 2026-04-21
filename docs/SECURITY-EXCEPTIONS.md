# Security Exceptions — Documented CVE Acknowledgements

`pnpm audit` flags 3 vulnerabilities in transitive `fast-jwt` pulled in through `@fastify/jwt@9.1.0`. The newer `fast-jwt@6.2.0+` and `@fastify/jwt@10.0.0` that fix these CVEs introduced runtime regressions in our integration test suite (see commit `9194e1a` attempt). Until either upstream backports the fix to `@fastify/jwt@9.x` or our integration suite is adapted to `@fastify/jwt@10`'s breaking changes, these three advisories are explicitly ignored in [`package.json`](../package.json) under `pnpm.auditConfig.ignoreGhsas`.

This document explains each exception, why it is acceptable for JAK Swarm's specific config, and what the rollback plan is.

---

## Ignored advisories

### [GHSA-mvf2-f6gm-w987](https://github.com/advisories/GHSA-mvf2-f6gm-w987) — Incomplete fix for CVE-2023-48223 (critical)

**Description:** JWT algorithm confusion when an RSA public key is prefixed with whitespace. An attacker who can influence the public key lookup could trick `fast-jwt` into verifying an HMAC signature against the RSA key bytes.

**Why it does not apply to our deployment:**
- JAK Swarm signs all internally issued JWTs with **HS256 only**. The server-side `AUTH_SECRET` is a symmetric key, never an RSA public key.
- We do not accept RSA-signed JWTs from external callers. Supabase JWT verification is a separate code path that calls `supabase.auth.getUser()` via HTTPS and does not round-trip through `fast-jwt`.

**Mitigation:**
- `apps/api/src/index.ts:79` fixes the signing algorithm to HS256 via `@fastify/jwt` defaults.
- CI gate in `scripts/check-docs-truth.ts` is extended (Phase 2) to assert no `RS256`/`ES256` references in the JWT config.

**Rollback trigger:** remove the ignore entry once `@fastify/jwt@9.x` ships a patched `fast-jwt@5.x`, OR once we migrate to `@fastify/jwt@10.x` with integration-test adaptation.

---

### [GHSA-rp9m-7r4c-75qg](https://github.com/advisories/GHSA-rp9m-7r4c-75qg) — Cache Confusion via cacheKeyBuilder collisions (critical)

**Description:** `fast-jwt`'s default `cacheKeyBuilder` concatenates JWT header and body strings. Certain crafted payloads can hash-collide, causing cached claim objects to be returned for a DIFFERENT (unrelated) token, potentially mixing identities.

**Why it does not apply to our deployment:**
- We do NOT enable the `cache: true` option in `@fastify/jwt`. Every verify call computes claims fresh. The vulnerable code path is unreachable in our config.

**Mitigation:**
- `apps/api/src/index.ts:79` registers `@fastify/jwt` with no `cache` option (default is `false`).
- CI gate (Phase 2) asserts no `cache: true` appears in the JWT plugin registration.

**Rollback trigger:** same as above.

---

### [GHSA-hm7r-c7qw-ghp6](https://github.com/advisories/GHSA-hm7r-c7qw-ghp6) — Unknown `crit` header extensions (high)

**Description:** `fast-jwt` does not enforce RFC 7515 §4.1.11: tokens carrying unknown `crit` (critical) header extensions should be rejected, but `fast-jwt` silently accepts them. An attacker setting `crit: ["foo"]` in a JWT header could bypass consumers that rely on the library to reject unrecognized critical extensions.

**Why it does not apply to our deployment:**
- JAK Swarm does not inspect or honor the `crit` header field. Our JWT consumers only read `sub`, `iat`, `exp`, and the custom claims `tenantId`, `userId`, `role` defined in `AuthSession`.
- No code path branches on the `crit` claim; a spoofed `crit` extension is silently ignored by our verify logic.

**Mitigation:**
- `apps/api/src/plugins/auth.plugin.ts:49` uses `request.jwtVerify<AuthSession>()` which decodes only the declared payload fields. Unknown claims are discarded.

**Rollback trigger:** same as above.

---

## How to remove an exception

1. Upgrade `@fastify/jwt` (and transitively `fast-jwt`) to a version that fixes the advisory.
2. Run the integration test suite against the new version to confirm no regression.
3. Delete the corresponding GHSA entry from `package.json` `pnpm.auditConfig.ignoreGhsas`.
4. Run `pnpm audit --audit-level=high --prod` — the advisory should no longer appear.
5. Update this doc by removing the closed section and adding a line to the changelog at the bottom.

## Audit policy

- This file lists every `ignoreGhsas` entry. If the list in `package.json` grows without a corresponding entry here, CI fails via the truth-check script (Phase 7 extension — tracked, not yet enforced).
- Each exception MUST include: description, why-it-does-not-apply, mitigation, rollback trigger.
- Review quarterly. If a vulnerability has been in this file >6 months without a rollback plan, escalate to the security list.

## Changelog

- `2026-04-21` — Initial entry: 3 fast-jwt advisories accepted with documented mitigations. Tracking at [inbharatai/jak-swarm#TBD](https://github.com/inbharatai/jak-swarm/issues) for the `@fastify/jwt@10` migration.
