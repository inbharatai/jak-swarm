# Railway Beta Deployment Guide

This is the active beta deployment path for JAK Swarm:

| Component | Host | Notes |
|---|---|---|
| Frontend | Vercel | Keep `apps/web` on Vercel for the beta. Set `NEXT_PUBLIC_API_URL` to the Railway API URL. |
| API | Railway | One public service using the repo `Dockerfile`; default command starts `apps/api/dist/index.js`. |
| Worker | Railway | One private/background service using the same image; start command is `node apps/api/dist/worker-entry.js`. |
| Postgres | Supabase | Keep Supabase for now because JAK uses pgvector. Do not move DB until pgvector/backups/migration are proven. |
| Redis | Railway managed Redis | Use `REDIS_URL=${{Redis.REDIS_URL}}` on API and worker (shared service in the same Railway project/environment). |
| Models | OpenAI + Gemini | `OPENAI_API_KEY` for OpenAI; `GEMINI_API_KEY` + `LLM_PROVIDER=gemini` for Gemini. Per-tenant switching supported. |

## Why This Shape

JAK Swarm has two long-running backend roles:

- The API handles HTTP, auth, SSE, approvals, enqueueing, and reads.
- The worker consumes the durable queue and runs agent workflows.

Those roles must stay separate in production/beta. Do not run the Cloud Run worker and Railway worker against the same production queue at the same time unless you intentionally want multiple workers and have tested lease/reclaim behavior.

## Railway Services

Create two Railway services from the same GitHub repo.

### `jak-swarm-api`

- Source: `https://github.com/inbharatai/jak-swarm`
- Build: Dockerfile at repo root
- Public networking: enabled
- Healthcheck path: `/healthz`
- Port: Railway should provide `PORT`; the API reads `API_PORT ?? PORT ?? 4000`
- Start command: leave default Docker command, or set `/app/apps/api/scripts/start-with-migrations.sh`

Required env:

```dotenv
NODE_ENV=production
LOG_LEVEL=warn
CORS_ORIGINS=https://jakswarm.com,https://www.jakswarm.com
WORKFLOW_WORKER_MODE=standalone
REQUIRE_REDIS_IN_PROD=true
DATABASE_URL=
DIRECT_URL=
REDIS_URL=${{Redis.REDIS_URL}}
AUTH_SECRET=
OPENAI_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
EVIDENCE_SIGNING_SECRET=
METRICS_TOKEN=
```

`CORS_ORIGINS` must be comma-separated. Entry whitespace is trimmed, so spaces after commas are acceptable.

### `jak-swarm-worker`

- Source: same repo
- Build: same Dockerfile
- Public networking: disabled unless Railway requires it for healthchecks
- Start command: `node apps/api/dist/worker-entry.js`
- Healthcheck path: `/healthz`
- Healthcheck port: `9464`

Required env:

```dotenv
NODE_ENV=production
LOG_LEVEL=info
WORKFLOW_WORKER_INSTANCE_ID=${RAILWAY_SERVICE_NAME}
WORKFLOW_QUEUE_CONCURRENCY=2
WORKFLOW_QUEUE_POLL_INTERVAL_MS=1000
WORKFLOW_QUEUE_LEASE_TTL_MS=60000
WORKER_METRICS_PORT=9464
PORT=9464
REQUIRE_REDIS_IN_PROD=true
DATABASE_URL=
DIRECT_URL=
REDIS_URL=${{Redis.REDIS_URL}}
AUTH_SECRET=
OPENAI_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
EVIDENCE_SIGNING_SECRET=
METRICS_TOKEN=
```

`AUTH_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `OPENAI_API_KEY`, Supabase env, `SUPABASE_SERVICE_ROLE_KEY`, `EVIDENCE_SIGNING_SECRET`, and `METRICS_TOKEN` must match the API service.
`PORT` should match `WORKER_METRICS_PORT` so Railway healthchecks probe the worker's metrics/health listener.

## Vercel Frontend

Set this in the Vercel project after the Railway API healthcheck passes:

```dotenv
NEXT_PUBLIC_API_URL=https://<railway-api-domain>
```

Then redeploy Vercel. Do not switch this before the Railway API and worker have both passed smoke tests.

## Cutover Checklist

1. Rotate any secret that has ever appeared in chat, logs, screenshots, or local reports.
2. Create Railway API service with production env.
3. Create Railway worker service with matching production env.
4. Confirm `GET /healthz` on the API returns 200.
5. Confirm worker logs show it started and is polling the queue.
6. Run database migration status against Supabase.
7. Start a workflow in staging and verify trace/audit events persist.
8. Test approval create, approve, reject, and resume paths.
9. Test document upload/parse with a small PDF or text file.
10. Update Vercel `NEXT_PUBLIC_API_URL` to the Railway API URL.
11. Redeploy Vercel and verify browser network calls go to Railway.

## Rollback

If Railway fails before Vercel cutover, keep Vercel pointed at the current API and fix Railway in isolation.

If Railway fails after Vercel cutover:

1. Pause Railway worker to stop new queue claims.
2. If Cloud Run is deployed, switch Vercel `NEXT_PUBLIC_API_URL` to the Cloud Run API URL and redeploy Vercel.
3. If rolling back without Cloud Run, restore Vercel `NEXT_PUBLIC_API_URL` to the last known-good Railway deploy URL.
4. Inspect queue leases and dead-letter rows before declaring recovery complete.

### Switching to Cloud Run

If you have a Cloud Run deployment running (see [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](DEPLOYMENT_GOOGLE_CLOUD_RUN.md)):

1. Update `NEXT_PUBLIC_API_URL` in Vercel to the Cloud Run API URL.
2. Redeploy Vercel (`vercel --prod`).
3. Verify smoke tests pass against Cloud Run.
4. Optionally scale down Railway services to save costs (keep Redis running — Cloud Run connects to the same Railway Redis instance).

### Switching back to Railway from Cloud Run

1. Update `NEXT_PUBLIC_API_URL` in Vercel to the Railway API URL.
2. Redeploy Vercel (`vercel --prod`).
3. Scale Railway API and worker back up if they were scaled down.

## Do Not Move Yet

- Do not move Supabase Postgres until pgvector support, backups, restore, and migration timing are tested.
- Do not change Redis providers mid-beta unless you have a tested migration/rollback plan for queue + signal continuity.
- Do not host the Next.js frontend on Railway for beta unless Vercel becomes a blocker.