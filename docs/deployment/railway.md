# Railway Deployment Runbook - JAK Swarm

Date: 2026-05-21

This runbook is the active deployment path.

## Target architecture

- Frontend: Vercel (`https://jakswarm.com`)
- API: Railway web service (`jak-swarm-api`)
- Worker: Railway background service (`jak-swarm-worker`)
- Database: Supabase Postgres (`ttrhawuqydfecndehdhx`)
- Queue/coordination: Railway managed Redis
- LLM provider: OpenAI only

## Project

- Railway project name: `jak-swarm`

## Service 1: `jak-swarm-api`

- Type: web service
- Source: repository root Dockerfile
- Root directory: `.`
- Build: Docker build from root `Dockerfile`
- Start command: default Docker CMD (`/app/apps/api/scripts/start-with-migrations.sh`)
- Public URL: enabled
- Host binding: `0.0.0.0` (already in code)
- Port: `PORT` from Railway (`API_PORT` optional)

Health endpoints to verify:
- `GET /healthz`
- `GET /health`
- `GET /ready`
- `GET /api/version`

Recommended env vars:
- `NODE_ENV=production`
- `LOG_LEVEL=info`
- `CORS_ORIGINS=https://jakswarm.com,https://www.jakswarm.com`
- `WORKFLOW_WORKER_MODE=standalone`
- `REQUIRE_REDIS_IN_PROD=true`
- `DATABASE_URL=<secret>`
- `DIRECT_URL=<secret>`
- `REDIS_URL=${{Redis.REDIS_URL}}`
- `AUTH_SECRET=<secret>`
- `OPENAI_API_KEY=<secret>`
- `NEXT_PUBLIC_SUPABASE_URL=https://ttrhawuqydfecndehdhx.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=<secret>`
- `SUPABASE_SERVICE_ROLE_KEY=<secret>`
- `EVIDENCE_SIGNING_SECRET=<secret>`
- `METRICS_TOKEN=<secret>`
- `API_PUBLIC_URL=https://<railway-api-domain>`
- `WEB_PUBLIC_URL=https://jakswarm.com`

`CORS_ORIGINS` must be comma-separated. Spaces after commas are fine; space-separated values without commas are invalid and will break browser CORS matching.

## Service 2: `jak-swarm-worker`

- Type: background worker
- Source: same repo/image
- Root directory: `.`
- Build: same Docker build
- Start command: `node apps/api/dist/worker-entry.js`
- Public URL: disabled
- Metrics/health port: `WORKER_METRICS_PORT` (default `9464`)

Worker env vars:
- `NODE_ENV=production`
- `LOG_LEVEL=info`
- `WORKFLOW_WORKER_INSTANCE_ID=${RAILWAY_SERVICE_NAME}`
- `WORKFLOW_QUEUE_CONCURRENCY=2`
- `WORKFLOW_QUEUE_POLL_INTERVAL_MS=1000`
- `WORKFLOW_QUEUE_LEASE_TTL_MS=60000`
- `WORKER_METRICS_PORT=9464`
- `PORT=9464`
- `REQUIRE_REDIS_IN_PROD=true`
- `DATABASE_URL=<secret>`
- `DIRECT_URL=<secret>`
- `REDIS_URL=${{Redis.REDIS_URL}}`
- `AUTH_SECRET=<secret>`
- `OPENAI_API_KEY=<secret>`
- `NEXT_PUBLIC_SUPABASE_URL=https://ttrhawuqydfecndehdhx.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=<secret>`
- `SUPABASE_SERVICE_ROLE_KEY=<secret>`
- `EVIDENCE_SIGNING_SECRET=<secret>`
- `METRICS_TOKEN=<secret>`

## Redis

Redis is required for this production topology because queue coordination and signal fan-out are distributed.

- Create Railway Redis service (or use an external Redis with equivalent HA guarantees).
- Set identical `REDIS_URL` on API and worker. For Railway-managed Redis, use `REDIS_URL=${{Redis.REDIS_URL}}` on both services.

## Validation checklist after deploy

API:
- `GET https://<railway-api-domain>/healthz` returns 200 with `ok=true`
- `GET https://<railway-api-domain>/health` returns 200 with `ok=true`
- `GET https://<railway-api-domain>/ready` returns 200 or a clear `missingEnv` list
- `GET https://<railway-api-domain>/api/version` returns 200 with service/runtime metadata

Worker:
- startup logs include:
  - worker starting
  - environment loaded
  - openai key present true/false
  - queue worker started
  - waiting for jobs
- no crash loop

## Vercel cutover

After Railway API is healthy:

1. Set Vercel production env:
   - `NEXT_PUBLIC_API_URL=https://<railway-api-domain>`
2. Trigger Vercel production redeploy.
3. Verify browser calls go to Railway API URL, not Render.

## Security constraints

- Keep `OPENAI_API_KEY` on backend services only.
- Do not create `NEXT_PUBLIC_OPENAI_API_KEY`.
- Do not commit secrets.
- Keep CORS strict in production.
