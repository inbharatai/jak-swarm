# Railway Migration Audit - JAK Swarm

Date: 2026-05-21
Scope: migrate backend from deleted Render setup to Railway, keep frontend on Vercel at https://jakswarm.com.

## 1. Repository shape

- Type: monorepo
- Workspace manager: pnpm workspaces + Turbo
- Package manager: pnpm (`pnpm@9.15.4`)
- Node engine: `>=20.0.0`

Top-level backend/frontend roots:
- API: `apps/api`
- Worker entrypoint: `apps/api/src/worker-entry.ts`
- Frontend: `apps/web`

## 2. Build and start commands (verified)

Root scripts:
- Build all: `pnpm build`
- Typecheck all: `pnpm typecheck`
- Lint all: `pnpm lint`
- Tests: `pnpm test`

API scripts (`apps/api/package.json`):
- Build: `pnpm --filter @jak-swarm/api build`
- Dev: `pnpm --filter @jak-swarm/api dev`
- Start (dist): `pnpm --filter @jak-swarm/api start`
- Worker (src dev): `pnpm --filter @jak-swarm/api worker`

Container runtime:
- Dockerfile at repo root builds all workspace deps and API dist.
- API runtime command (default): `/app/apps/api/scripts/start-with-migrations.sh`
- Worker runtime command override: `node apps/api/dist/worker-entry.js`

## 3. API and worker readiness state

### API (`apps/api/src/index.ts`, observability plugin)
- Already listens on `0.0.0.0`.
- Port resolution: `API_PORT ?? PORT ?? 4000`.
- Endpoints available after migration updates:
  - `GET /health`
  - `GET /healthz`
  - `GET /ready`
  - `GET /version`
  - `GET /api/version` (added alias)

### Worker (`apps/api/src/worker-entry.ts`)
- Standalone background process is implemented.
- Exposes health endpoints on metrics server (`WORKER_METRICS_PORT`, default `9464`):
  - `GET /healthz`
  - `GET /ready`
  - `GET /version`
  - `GET /metrics` (token-gated in prod)
- Graceful shutdown handlers present for `SIGTERM` and `SIGINT`.

## 4. Queue and Redis usage

Queue worker architecture is real and production-relevant.

Evidence:
- Queue consumer implemented in `apps/api/src/services/queue-worker.ts`
- Worker process starts queue worker in standalone mode.
- Redis is used for distributed locks/signals/SSE relay when configured.
- In-memory fallback exists but is degraded and not ideal for multi-instance production.

Conclusion:
- Deploy worker service on Railway.
- Provision Redis for production-grade coordination.

## 5. OpenAI and secret boundaries

OpenAI usage:
- Server-side only via `OPENAI_API_KEY` (`apps/api/src/config.ts`).

Frontend-safe env vars:
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Backend-only env vars:
- `OPENAI_API_KEY`
- `AUTH_SECRET`
- `DATABASE_URL`
- `DIRECT_URL`
- `REDIS_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EVIDENCE_SIGNING_SECRET`
- `METRICS_TOKEN`
- OAuth provider secrets

Hard rule:
- Never set `NEXT_PUBLIC_OPENAI_API_KEY`.

## 6. CORS and frontend API wiring

CORS:
- API uses `CORS_ORIGINS` (plural).
- Production defaults were hardened to:
  - `https://jakswarm.com`
  - `https://www.jakswarm.com`

Frontend API env:
- Web app uses `NEXT_PUBLIC_API_URL` in client API resolver.
- Production fails loud when missing/misconfigured rather than silently using localhost.

## 7. Render residue scan summary

Runtime-sensitive templates updated:
- `apps/web/.env.example` now uses Railway placeholder URL.
- `scripts/automation/env-templates/vercel-production.env.example` now uses Railway placeholder URL.

Legacy/historical Render docs and QA artifacts remain in repo history/docs for audit context, but should not be used for active operations.

## 8. Required environment variables

Minimum required (API in production):
- `NODE_ENV=production`
- `CORS_ORIGINS=https://jakswarm.com,https://www.jakswarm.com`
- `WORKFLOW_WORKER_MODE=standalone`
- `DATABASE_URL`
- `AUTH_SECRET`
- `OPENAI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EVIDENCE_SIGNING_SECRET`
- `METRICS_TOKEN`
- `REDIS_URL` (required for distributed production mode)

Worker-specific additions:
- `WORKFLOW_WORKER_INSTANCE_ID`
- `WORKFLOW_QUEUE_CONCURRENCY`
- `WORKFLOW_QUEUE_POLL_INTERVAL_MS`
- `WORKFLOW_QUEUE_LEASE_TTL_MS`
- `WORKER_METRICS_PORT`

## 9. Missing values to be supplied securely

Not in repository by design:
- `OPENAI_API_KEY`
- `AUTH_SECRET`
- `DATABASE_URL`
- `DIRECT_URL`
- `REDIS_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `EVIDENCE_SIGNING_SECRET`
- `METRICS_TOKEN`

## 10. Risks

- Supabase MCP context currently appears bound to a different project than `ttrhawuqydfecndehdhx`; direct MCP verification is unreliable until corrected.
- If `REDIS_URL` is omitted in production, system can degrade to in-memory coordination and lose cross-instance guarantees.
- Vercel API URL changes do nothing until a fresh production redeploy is triggered.
- Legacy Render docs can confuse operators if used as active runbook.

## 11. Exact Railway deployment plan

1. Create Railway project `jak-swarm`.
2. Create service `jak-swarm-api` from repo root Dockerfile.
3. Enable public networking for API service.
4. Set API env vars from `.env.railway.example` (API section).
5. Configure health checks:
  - primary path: `/healthz`
  - additional diagnostic probes: `/ready`, `/api/version`
6. Create service `jak-swarm-worker` from same repo/image.
7. Disable public networking on worker.
8. Set worker env vars from `.env.railway.example` (worker section).
  - ensure `PORT=9464` and `WORKER_METRICS_PORT=9464` are aligned.
9. Provision Redis service and wire `REDIS_URL` to both API and worker.
10. Verify API and worker logs show healthy startup and no secret leakage.
11. Update Vercel production `NEXT_PUBLIC_API_URL` to Railway API URL.
12. Trigger Vercel production redeploy.
13. Run browser E2E smoke on https://jakswarm.com and confirm requests hit Railway URL.
