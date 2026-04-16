# JAK Swarm — Operational Runbook

A practical reference for on-call engineers. Each section covers a failure
mode, its symptoms, root cause, and the fastest path to recovery.

---

## Table of Contents

1. [API won't start](#1-api-wont-start)
2. [Database unreachable](#2-database-unreachable)
3. [Redis unreachable / lock contention](#3-redis-unreachable--lock-contention)
4. [WhatsApp client fails to start or QR expires](#4-whatsapp-client-fails-to-start-or-qr-expires)
5. [Workflow stuck in RUNNING state](#5-workflow-stuck-in-running-state)
6. [High token / cost usage spike](#6-high-token--cost-usage-spike)
7. [LLM provider outage](#7-llm-provider-outage)
8. [JWT / auth failures at scale](#8-jwt--auth-failures-at-scale)
9. [CI failure reference](#9-ci-failure-reference)
10. [Deployment rollback (Render)](#10-deployment-rollback-render)
11. [Key environment variables reference](#11-key-environment-variables-reference)

---

## 1. API Won't Start

### Symptoms
- Render deploy shows "Deploy failed" or health check times out.
- Logs contain `[boot] ❌` lines.

### Common causes and fixes

| Error in logs | Fix |
|---|---|
| `Using default JWT secret` | Set `AUTH_SECRET` to a 32+ char random string in Render env vars. |
| `No LLM provider API key set` | Set at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. |
| `Database unreachable` | Check `DATABASE_URL` / `DIRECT_URL`. Confirm Postgres is running and credentials are correct. |
| `PrismaClientInitializationError` | Run `pnpm db:migrate:deploy` against the target database. |
| TypeScript / missing module error | Rebuild: `pnpm --filter @jak-swarm/api build` |

### Escalation
If the API starts but crashes within 60 s, check `GET /health` response body for `checks` detail — it identifies which dependency is failing.

---

## 2. Database Unreachable

### Symptoms
- `GET /health` returns `503` with `"database": { "status": "error" }`.
- Workflows fail immediately with a Prisma error.

### Diagnosis
```bash
# From any machine with network access to the DB host:
psql "$DATABASE_URL" -c "SELECT 1;"
```

### Recovery steps
1. **Connection pool exhausted** — Check `DATABASE_URL` pool size param (`connection_limit`). Default Prisma pool = `num_cpus * 2 + 1`. Reduce if over-provisioned.
2. **DB host down** — Render Postgres: go to Dashboard → Database → Restart. External Postgres: check cloud provider status.
3. **Migrations out of sync** — run `pnpm db:migrate:deploy` (safe, idempotent, production-ready).
4. **Credential rotation** — Update `DATABASE_URL` + `DIRECT_URL` in Render env vars and redeploy.

> `DIRECT_URL` bypasses PgBouncer for migrations. Always set both.

---

## 3. Redis Unreachable / Lock Contention

### Symptoms
- API starts but logs `⚠️ REDIS: Redis configured but unreachable`.
- WhatsApp spawner logs `[whatsapp-spawner] distributed lock unavailable`.
- Multiple WhatsApp client processes started (duplicate QR codes).

### Diagnosis
```bash
redis-cli -u "$REDIS_URL" ping   # should return PONG
```

### Recovery steps

**Redis down:**
1. Render Redis: Dashboard → Redis → Restart.
2. External Redis: check cloud provider status page.
3. The API falls back to in-memory coordination automatically — only multi-instance scenarios are affected.

**Lock contention (stale lock):**
```bash
# Remove the stale WhatsApp spawner lock:
redis-cli -u "$REDIS_URL" DEL whatsapp:spawn:lock
```
Then restart the API. The spawner will re-acquire the lock on next boot.

**Lock key reference:**
| Key | Purpose | TTL |
|---|---|---|
| `whatsapp:spawn:lock` | Prevents duplicate WhatsApp client processes | 60 s auto-expire |

---

## 4. WhatsApp Client Fails to Start or QR Expires

### Symptoms
- `GET /whatsapp/status` returns `{ "status": "DISCONNECTED" }`.
- Users report commands are not being processed.
- Dashboard shows "Waiting for QR scan" indefinitely.

### QR refresh procedure
1. Open the dashboard → WhatsApp Integration page.
2. Click **Disconnect** (clears the session).
3. Click **Reconnect** — a new QR code appears.
4. Scan within 60 seconds using the WhatsApp mobile app.
5. Status should transition: `DISCONNECTED → CONNECTING → CONNECTED`.

### Session file corruption
If QR appears but scanning fails repeatedly:
```bash
# On the server running the WhatsApp client:
rm -rf /tmp/whatsapp-session
# Then restart the API / whatsapp-client service.
```

### Environment checklist
```
WHATSAPP_AUTO_START=1           # Enable auto-connect on boot
WHATSAPP_BRIDGE_TOKEN=<secret>  # Must match what the API is configured with
WHATSAPP_CLIENT_PORT=47891      # Port the child process listens on
```

---

## 5. Workflow Stuck in RUNNING State

### Symptoms
- `GET /workflows/:id` returns `{ "status": "RUNNING" }` but no progress in traces.
- No agent activity in logs for > 10 minutes.

### Diagnosis
```bash
# Check recent trace entries:
GET /workflows/:id/traces
# Check for LLM provider errors in logs:
grep "LLMProviderError\|rate limit\|timeout" <log file>
```

### Recovery steps
1. **Force stop:** `POST /workflows/:id/stop` — marks as CANCELLED, releases resources.
2. **LLM timeout:** Check `GET /settings/llm/status` — switch to a different provider if primary is down.
3. **Budget exceeded:** The workflow may have hit the token budget. Check `GET /analytics/cost`.
4. **Swarm deadlock:** Rare. Stop workflow, then restart the API process to clear in-memory state.

---

## 6. High Token / Cost Usage Spike

### Symptoms
- `GET /analytics/cost` shows unexpected spike.
- Budget enforcement logs show repeated warnings.

### Immediate actions
1. **Pause active workflows:** `POST /workflows/:id/pause` for all running workflows.
2. **Identify the cause:** `GET /analytics/usage/workflow/:workflowId` per workflow.
3. **Reduce limits (temporary):** Update `MAX_TOKENS_PER_WORKFLOW` env var and redeploy.

### Permanent fix
Set per-tenant budget limits via the admin panel or directly in the DB:
```sql
UPDATE "Tenant" SET "monthlyTokenBudget" = 500000 WHERE id = '<tenant-id>';
```

---

## 7. LLM Provider Outage

### Symptoms
- Workflows fail with `LLMProviderError: 503` or `rate limit exceeded`.
- `GET /settings/llm/status` shows a provider as unconfigured/erroring.

### Provider failover
JAK Swarm has automatic provider failover. If the primary provider fails 3 times in a row, it routes to the next configured provider.

**Manual override — disable a failing provider temporarily:**
```bash
DELETE /settings/llm/openai   # removes OpenAI from rotation
# Re-add when recovered:
PUT /settings/llm/openai  { "apiKey": "..." }
```

**Fallback priority** (configure via `LLM_PROVIDER_PRIORITY` env var, comma-separated):
```
openai,anthropic,gemini,deepseek,openrouter,ollama
```

---

## 8. JWT / Auth Failures at Scale

### Symptoms
- Sudden 401 spike across all authenticated endpoints.
- `GET /auth/me` returns 401 for all users.

### Common causes

| Cause | Fix |
|---|---|
| `AUTH_SECRET` changed | Revert to previous secret or ask users to re-login. |
| Clock skew on server | Ensure NTP is synced — JWT `iat`/`exp` are time-sensitive. |
| `AUTH_SECRET` not set in new deploy | Add env var in Render dashboard, redeploy. |

> **Warning:** Changing `AUTH_SECRET` invalidates all existing sessions. All users will be logged out.

---

## 9. CI Failure Reference

| Failure | Cause | Fix |
|---|---|---|
| `P3018` migration error | UTF-8 BOM in .sql file | Edit file to remove BOM (use UTF-8 without BOM encoding) |
| `packageEntryFailure: @jak-swarm/db` | Missing vitest alias | Add `'@jak-swarm/db'` to `tests/vitest.config.ts` `resolve.alias` |
| `PrismaClientInitializationError` | `DATABASE_URL` missing in CI env | Add to GitHub Actions secrets / CI env vars |
| `beforeAll timeout` | DB/app startup too slow | Bump `beforeAll` timeout to ≥ 30000 ms |
| Security gate: `Default AUTH_SECRET found` | Hardcoded secret in source | Remove from source; use env var |
| Security gate: `Possible real API key` | Key committed by mistake | Remove commit, rotate key with provider |
| Build job: `next build` fails | Missing `NEXT_PUBLIC_*` env vars | Add placeholder env vars in the build step |

---

## 10. Deployment Rollback (Render)

### Render automatic deploys
Every push to `main` triggers a Render deploy. To roll back:

1. Go to **Render Dashboard** → select the `jak-api` service.
2. Click **Deploys** tab.
3. Find the last known-good deploy and click **Rollback to this deploy**.

### Database rollback caveat
DB schema migrations run automatically on deploy. Rolling back the code without rolling back the DB schema can cause errors if the old code doesn't understand the new schema.

**Safe rollback procedure:**
1. Roll back the Render service to the previous deploy.
2. If a breaking migration was applied, restore the DB from the pre-migration snapshot (Render Postgres → Backups).
3. Redeploy the rolled-back code commit.

---

## 11. Key Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | **Yes** | JWT signing secret. Min 32 chars. Never use default in prod. |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string (pooled, e.g. PgBouncer). |
| `DIRECT_URL` | **Yes** | Direct PostgreSQL connection (bypasses pooler, used for migrations). |
| `REDIS_URL` | Recommended | Redis connection string. Falls back to in-memory if not set. |
| `OPENAI_API_KEY` | One of these required | LLM provider keys. |
| `ANTHROPIC_API_KEY` | One of these required | |
| `GEMINI_API_KEY` | One of these required | |
| `DEEPSEEK_API_KEY` | One of these required | |
| `OPENROUTER_API_KEY` | One of these required | |
| `OLLAMA_BASE_URL` | One of these required | Local Ollama instance base URL. |
| `WHATSAPP_BRIDGE_TOKEN` | If WhatsApp enabled | Shared secret for WhatsApp bridge auth. |
| `WHATSAPP_AUTO_START` | Optional | `1` to start WhatsApp client on boot. |
| `CORS_ORIGINS` | Recommended in prod | Comma-separated allowed origins. |
| `PADDLE_WEBHOOK_SECRET` | If billing enabled | Validates Paddle webhook signatures. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional | OpenTelemetry collector endpoint for traces/metrics. |
| `NODE_ENV` | **Yes** | `development` / `production` / `test` |
| `PORT` | Optional | API listen port. Default: `4000`. |

---

*Last updated: April 2026. Open a PR to keep this runbook current.*
