# Railway Migration Report - JAK Swarm

Date: 2026-05-21
Status: In progress (blocked on Railway auth + user-assisted login verification)

## 1. What changed

Implemented in repository:
- Added Railway audit artifact and deployment runbook.
- Added `.env.railway.example` placeholder template.
- Updated API readiness/version contracts for Railway migration:
  - `/health` includes `ok`, `service`, `timestamp`.
  - Added `/api/version` alias while preserving `/version`.
  - `/ready` now reports `requiredEnv` and `missingEnv` without exposing values.
- Updated worker startup diagnostics:
  - explicit environment loaded log
  - explicit OpenAI key presence flag
  - explicit waiting-for-jobs log
- Updated active frontend env templates to remove old Render endpoint defaults.

## 2. Files changed

- `apps/api/src/config.ts`
- `apps/api/src/index.ts`
- `apps/api/src/observability/plugin.ts`
- `apps/api/src/worker-entry.ts`
- `apps/api/src/services/queue-worker.ts`
- `apps/web/.env.example`
- `scripts/automation/env-templates/vercel-production.env.example`
- `.env.railway.example`
- `docs/deployment/railway-audit.md`
- `docs/deployment/railway.md`
- `docs/deployment/railway-migration-report.md`

## 3. Commands used

Local validation:
- `pnpm install --frozen-lockfile` (pass)
- `pnpm typecheck` (initial fail due missing Prisma client, then pass after generation)
- `pnpm lint` (pass)
- `pnpm test` (fail in current local environment due Prisma/runtime dependencies)
- `pnpm --filter @jak-swarm/api build` (pass after Prisma client generation)
- `pnpm --filter @jak-swarm/api worker --help` (connectivity fail to local Postgres expected in this environment)

Prisma remediation:
- `pnpm --filter @jak-swarm/db db:generate` (pass)

Platform access checks:
- `railway --version` (installed)
- `railway whoami --json` (unauthorized)
- `railway login --browserless` (started; waiting for activation)
- `vercel whoami` (authenticated)
- `vercel project ls --json` (resolved `jak-swarm` project id)
- `vercel domains ls` + `vercel inspect jakswarm.com` (domain mapping confirmed)

## 4. Railway project

- Target project name: `jak-swarm`
- Project creation status: pending (CLI not yet authenticated)

## 5. Railway API URL

- Pending (available only after Railway project/service creation)

## 6. Worker service status

- Pending (available only after Railway project/service creation)

## 7. Redis status

- Pending (available only after Railway project/service creation)

## 8. Required env vars

Core required vars are documented in:
- `docs/deployment/railway.md`
- `.env.railway.example`

## 9. Missing env vars

Not available in repo by design and must be set securely in Railway/Vercel:
- `OPENAI_API_KEY`
- `AUTH_SECRET`
- `DATABASE_URL`
- `DIRECT_URL`
- `REDIS_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EVIDENCE_SIGNING_SECRET`
- `METRICS_TOKEN`

## 10. Endpoint health results

- Local runtime verification: blocked by unavailable local Docker daemon / missing local Postgres.
- Remote runtime verification: pending Railway deployment.

## 11. Vercel API env update

- Project resolved: `jak-swarm` (`prj_LiX2ns7UvNUeQz4zcubGtHL9nKZB`)
- `NEXT_PUBLIC_API_URL`: pending Railway API URL
- Vercel production redeploy: pending Railway API URL

## 12. Browser E2E result

- Landing page verified at https://jakswarm.com (loaded successfully).
- Magic PIN auth flow initiated for `reetu004@gmail.com`; waiting for PIN completion.
- Dashboard/chat command flow pending authenticated session.

## 13. Remaining risks

- Supabase MCP context appears bound to a different project than `ttrhawuqydfecndehdhx`; direct MCP verification cannot be trusted until rebinding is corrected.
- Railway CLI auth is currently incomplete and blocks project/service creation.
- Local Docker daemon unavailable blocks local `/health` `/ready` `/api/version` smoke against running API process.

## 14. Exact next action

1. Complete Railway activation for code `SLJN-HHRV` at `https://railway.com/activate`.
2. Create Railway project `jak-swarm`, deploy API + worker, and capture API public URL.
3. Set Vercel production `NEXT_PUBLIC_API_URL` to Railway URL and trigger redeploy.
4. Complete authenticated browser E2E workflow and capture screenshots.
