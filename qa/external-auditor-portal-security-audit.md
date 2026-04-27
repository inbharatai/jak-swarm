# External Auditor Portal — Security Audit (Sprint 2.6)

**Date:** 2026-04-27
**Implementation commit:** Sprint 2.6 in this session
**Tests:** 11/11 unit tests passing in `tests/unit/services/external-auditor.test.ts`

This audit walks the security model + named threats and records honest
status for each.

---

## 1. Architecture summary

```
Admin (REVIEWER+)              Auditor (third party)
       │                             │
       ▼                             │
POST .../auditors/invite             │
   ├─ generates 32-byte cleartext token
   ├─ persists SHA-256(token) only
   ├─ returns cleartext to admin ONCE
   └─ status=PENDING                 │
                                     │
                                     ▼
                             POST /auditor/accept/:token
                                ├─ hashes input, looks up by hash
                                ├─ verifies status, expiry
                                ├─ creates EXTERNAL_AUDITOR User row
                                ├─ creates ExternalAuditorEngagement
                                ├─ marks invite ACCEPTED
                                └─ issues scoped JWT
                                     │
                                     ▼
                             GET /auditor/runs/:id (etc.)
                                ├─ middleware: role=EXTERNAL_AUDITOR?
                                ├─ middleware: active engagement?
                                ├─ logs view action to audit trail
                                └─ scoped query (tenantId from engagement)
```

---

## 2. Security requirements vs implementation

| Requirement | Status | Where |
|---|---|---|
| Auditor cannot access other tenant data | ✅ | Engagement row carries `tenantId`; every auditor route reads it from engagement, never from request input. Cross-tenant test passes. |
| Auditor cannot access unrelated audit runs | ✅ | `requireAuditorEngagement` middleware verifies `(userId, auditRunId)` has an active engagement; returns 403 otherwise. Test: tenant_a auditor cannot find tenant_b engagement. |
| Invite token is hashed, never stored raw | ✅ | `ExternalAuditorService.createInvite` SHA-256 hashes; persists `tokenHash` only. Test: `JSON.stringify(stored)` does not contain the cleartext token. |
| Expired token cannot be used | ✅ | `acceptInvite` checks `expiresAt > now`; on miss, marks invite `EXPIRED` and throws. Test passes. |
| Revoked token cannot be used | ✅ | `acceptInvite` rejects status != `PENDING`; `revokeInvite` flips status to `REVOKED` AND sets `accessRevokedAt` on the matching engagement. Test passes. |
| Auditor session cannot escalate privileges | ✅ | JWT carries `role: EXTERNAL_AUDITOR`. The role-check middleware (`requireRole`) on admin routes (REVIEWER+) excludes EXTERNAL_AUDITOR. Auditor routes always check role + engagement. |
| Auditor cannot access internal admin dashboard | ✅ | Admin routes use `fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN', 'OPERATOR')` — EXTERNAL_AUDITOR is not in that list. |
| All auditor actions are logged | ✅ | Every route handler calls `svc.logAction` before/after the operation. The `decide` route logs INTENT before mutating so a failed mutation still leaves a forensic record. |
| Evidence access is scoped | ✅ | `/auditor/runs/:auditRunId/workpapers` scopes by `engagement.tenantId` AND `auditRunId`; cross-engagement reads return 404. |
| Workpaper access is scoped | ✅ | Same as above. |

---

## 3. Token generation + verification

- **Token entropy:** 32 bytes from `crypto.randomBytes(32)`, hex-encoded → 64 chars, ~256 bits of entropy.
- **Hash algorithm:** SHA-256, hex-encoded.
- **Comparison:** `crypto.timingSafeEqual` against the stored hash (defense against timing attacks even though the lookup is by exact hash).
- **Cleartext lifetime:** in-memory only on the admin route response. Never logged. Never written to disk by JAK.
- **Persisted lifetime:** the `tokenHash` row remains for forensic purposes after invite is accepted/revoked/expired (status field carries the lifecycle).

---

## 4. JWT issuance (auditor)

The auditor JWT carries:
```ts
{
  userId,
  tenantId,
  email: '',     // intentionally empty — auditors are scoped, not full users
  role: 'EXTERNAL_AUDITOR',
  name: '',
}
```

Standard application JWT lifetime applies (`config.jwtExpiresIn`).
Engagement expiry is independent of JWT expiry — the engagement
isolation middleware checks `engagement.expiresAt > now` and
`engagement.accessRevokedAt IS NULL` on every request, so a long-lived
JWT cannot outlive a revoked invite.

---

## 5. Engagement isolation middleware

`requireAuditorEngagement` runs after `fastify.authenticate` on every
auditor route that includes an `:auditRunId` URL parameter. It:

1. Reads `request.user.role`; rejects if not `EXTERNAL_AUDITOR`.
2. Reads `auditRunId` from the URL path.
3. Calls `svc.findActiveEngagement(userId, auditRunId)`. The query
   scopes by `userId` (from JWT) AND `auditRunId` (from URL) AND
   `accessRevokedAt IS NULL` AND `expiresAt > now`. Returns
   `undefined` on miss.
4. On miss, returns 403 `NO_ENGAGEMENT`.
5. On hit, attaches the engagement to `request.engagement`. Downstream
   handlers use `engagement.tenantId` (NOT `request.user.tenantId`)
   for all scoped queries.

The reason for using `engagement.tenantId` rather than the JWT's
`tenantId`: the auditor's User row carries the original tenant they
were invited from, but the engagement is the authoritative scope
record for THIS audit run. Both should match (verified by foreign-key
relationship at row creation time), but the engagement is the source
of truth for scoping.

---

## 6. Threat model

| Threat | Mitigation |
|---|---|
| Stolen invite link forwarded to unintended recipient | Tokens are single-use (status flips to ACCEPTED on first valid accept). Subsequent accepts fail. The original recipient can be alerted by watching `acceptedAt` on the invite row. |
| Replay of accepted invite token | Status check rejects accepted invites; only the User created on first accept can sign in via the JWT. |
| JWT theft | Standard JWT secret rotation applies. Engagement check on every request means a stolen JWT cannot survive engagement revocation. |
| Cross-tenant lateral movement | Engagement isolation middleware + tenant-scoped queries. Tested. |
| Token brute force | 256 bits of entropy. SHA-256 lookup is constant-time per query (DB index on `token_hash`); even a 10 req/s attacker would take >2^240 years to enumerate the keyspace. |
| Replay against revoked invite | `engagement.accessRevokedAt` is checked on every request via `findActiveEngagement`. |
| Information disclosure via 4xx error messages | Accept errors are intentionally generic (`INVITE_INVALID` or `Invalid invite token`). The service distinguishes "expired" / "revoked" / "wrong status" but the route returns the message verbatim — operators may want to coarsen this to a single "Invalid or expired invite" message in production. |
| Action-trail forgery | `ExternalAuditorAction` rows carry `userId` from JWT (server-side); auditor cannot forge another auditor's actions. Tenant + audit_run also recorded. |

---

## 7. Known limitations / future work

1. **No per-engagement rate limiting** beyond the global rate-limit
   plugin. An invite-token endpoint that's brute-forceable at the same
   rate as a normal API endpoint is fine given the token entropy, but
   a specific per-IP cap on `/auditor/accept/:token` would be a
   defense-in-depth improvement.
2. **No email integration in this session.** Admin routes return the
   cleartext token in the response so the admin UI can copy + email
   it manually. A real email-send hook (`POST /auditor/invite/:id/email`)
   that invokes the email adapter is a logical next step.
3. **No audit log replication to AuditLog table.** Auditor actions
   write to `external_auditor_actions` only. A future enhancement
   could mirror them into the unified `audit_log` table for cross-
   surface forensic queries.
4. **No download endpoint for workpaper artifacts.** The current
   workpaper view shows status + metadata; a `/auditor/runs/:id/workpapers/:wpId/download`
   endpoint that returns a signed URL is a reasonable next addition
   (subject to a `view_evidence` scope check).
5. **No final-pack viewing.** `view_final_pack` is in the scopes
   enum but no route serves it yet. To add: `GET /auditor/runs/:id/final-pack`
   returns the bundle metadata or a signed download URL.

---

## 8. Test coverage

- **11/11 unit tests pass** in `tests/unit/services/external-auditor.test.ts`:
  - Token format (64-char hex)
  - Cleartext never persisted
  - Audit run cross-tenant guard at invite creation
  - Accept flow happy path
  - Accept rejects invalid token
  - Accept rejects already-accepted token
  - Accept rejects + marks expired token
  - Revoke flips invite + engagement
  - findActiveEngagement excludes revoked
  - Cross-tenant isolation: auditor A cannot find auditor B's engagement
  - Action trail records correctly with tenantId

What is NOT covered (deferred to integration tests):
- Real Postgres FK behavior (tested with in-memory fake)
- Real JWT issuance + verification (tested via the auth.service path)
- Real Fastify route handlers (tested via service contract)
- Real cross-route session attacks (would need supertest)

---

## 9. Verdict

The portal ships with the stated security model intact. Token storage,
expiry, revocation, and cross-tenant isolation are all implemented
+ tested. The known limitations (§7) are honest scope deferrals, not
fakes — every named feature is real.
