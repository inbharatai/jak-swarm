# JAK Swarm API — Operator Deploy Notes (Phase A perf)

This is a focused operator runbook for the Phase A performance work. The
canonical, full Cloud Run deployment guide lives at
[`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](../../docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md)
(service name, region, Secret Manager, verification commands). Read that first
for a fresh deploy; this file covers the perf-critical knobs + the JAK JWT
exchange deploy order.

## 1. Cloud Run cold-start: `--min-instances=1`

The single biggest "API is slow after idle" driver is Cloud Run scaling the
service to zero. With `--min-instances=1` at least one instance is always warm,
so the p50 of the first request after idle is the request latency, not a
cold-boot (module import + Prisma client connect + OTel/Sentry init).

```bash
gcloud run services update jak-swarm-api \
  --region asia-south1 \
  --min-instances=1 \
  --max-instances=20 \
  --concurrency=80
```

Honest limit: cold-start *elimination* cannot be verified without a live
deploy. After applying, verify: wait 10+ minutes with no traffic, then:

```bash
curl -w "\n%{time_total}s\n" -o /dev/null -s https://jak-swarm-api-565531938617.asia-south1.run.app/health
```

Target: p50 < 200ms after 10+ min idle. If the first request is still slow,
the instance likely scaled down anyway (check `gcloud run services describe
jak-swarm-api --region asia-south1 --format="value(spec.template.scaling.minInstanceCount)"`)
or a new revision was deployed without the min-instances flag (revisions are
immutable; the flag must be re-applied on redeploy via `gcloud run services
update` or baked into `gcloud run deploy --min-instances=1`).

`--concurrency=80` matches Fastify's single-process throughput; raise
`--max-instances` for your peak QPS.

## 2. `AUTH_SECRET` (the JAK JWT signing key)

`config.jwtSecret` is read from `AUTH_SECRET`
(`apps/api/src/config.ts:96`). It is the secret that signs every JAK JWT
(`fastify.jwt.sign`), including the JAK JWT minted by the A.1 exchange on
`GET /auth/me` + `POST /auth/exchange`.

**It MUST be:**
1. Set to a strong random value (≥ 32 bytes) in production on **both** Cloud
   Run and Railway (the fallback path) — otherwise the API falls back to the
   literal `dev-secret-change-me-NEVER-USE-IN-PROD`, which lets anyone forge
   auth tokens.
2. The **same value** on Cloud Run and Railway. If they differ, a JAK JWT
   minted by one deployment won't verify on the other, forcing a Supabase
   fallback round-trip (the exact thing A.1 eliminates) and, worse, breaking
   sessions mid-rollout.
3. Stored in Google Secret Manager (the canonical doc mounts 12 secrets) and
   referenced, not pasted into the revision.

Rotate by updating the Secret Manager secret + redeploying both surfaces
simultaneously. Existing JAK JWTs (7d TTL) become invalid on rotation — users
are silently re-exchanged on their next `/auth/me` (the web stores the new
Supabase token, which mints a fresh JAK JWT).

## 3. JAK JWT exchange — deploy order (A.1)

The exchange is self-healing and backward-compatible, but deploy order
matters for the perf win to land cleanly:

1. **Deploy the API first.** `GET /auth/me` now mints a `jakToken` when the
   inbound token is a Supabase access token; `POST /auth/exchange` is also
   available. The web hasn't changed yet, so it keeps sending Supabase tokens
   — they still authenticate (Supabase fallback), and now `/auth/me` returns
   a `jakToken` the old web ignores. No regression.
2. **Deploy the web second.** `fetchTrustedAuthUser` now reads `jakToken` and
   stores it via `setToken`. On the first `/auth/me` after this deploy, an
   existing Supabase-token session self-heals: the web stores the minted JAK
   JWT, and every subsequent API call authenticates via `jwtVerify()` on the
   first try — **zero Supabase `/auth/v1/user` round-trips**.
3. **No forced re-login.** Supabase access tokens rotate via
   `onAuthStateChange`; `fetchProfile` re-fires `/auth/me` → new `jakToken`
   overwrites. JAK JWT TTL is 7d (`config.jwtExpiresIn`).

Verify live: open the Network tab on `jakswarm.com`, log in, then navigate
the workspace. After the first `/auth/me`, every subsequent authenticated
request should show **no** `auth/v1/user` call to Supabase. If you still see
one per request, check that the web stored the `jakToken` (localStorage
`jak-auth-token`) and that `AUTH_SECRET` matches between Cloud Run and
Railway (a mismatch makes the minted JWT fail `jwtVerify` on the other
surface, forcing the fallback).

## 4. In-process Supabase identity cache (honest limit)

`AuthService.authenticateSupabaseToken` caches the resolved identity per
Supabase access token for 60s (LRU, max 1000, sha256 key). This caps the
Supabase round-trip to ≤1/min/token per API instance. A revoked Supabase
session is therefore valid for up to 60s on a given instance after
revocation — acceptable for this product; a Redis-based revocation
blocklist is a future hardening step, not Phase A.

## 5. Honest analytics aggregation endpoints (Phase C)

No migration — all columns already existed. Five new tenant-scoped
aggregation endpoints were added to `src/routes/analytics.routes.ts`:

| Endpoint | Source | Scope |
|----------|--------|-------|
| `GET /analytics/tools` | `AgentTrace.toolCallsJson` | tenant (`authenticate` + `enforceTenantIsolation`) |
| `GET /analytics/approvals/decisions` | `ApprovalAuditLog` | tenant |
| `GET /analytics/intents` | `IntentRecord` | tenant |
| `GET /analytics/latency` | `UsageLedger.latencyMs` (null rows excluded) | tenant |
| `GET /analytics/routing` | `RoutingLog` | **`SYSTEM_ADMIN` only** |

`/analytics/routing` is admin-only because `RoutingLog` is platform-wide (no
`tenantId` column). A future migration could add `tenantId` to make it
tenant-scoped; until then non-admins get a 403 and the web renders an "Admin
only" banner. `GET /usage/history` `select` was extended additively with
`provider, inputTokens, outputTokens, usdCost, latencyMs` (backward-compatible).

Deploy: the API auto-deploys on push to main when Railway/Cloud Run are
dashboard-linked; Cloud Run requires a manual `gcloud builds submit
--config=cloudbuild-api.yaml` (push to main does NOT deploy it — see
`DEPLOY_TRIGGER.md`). No env vars added.