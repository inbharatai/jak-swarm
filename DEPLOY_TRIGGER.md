# Deploy Triggers — what pushes a change to production

This documents, per surface, **what causes a deploy** and **what gates it**.
Read this before assuming a push to `main` has reached users — most surfaces
auto-deploy, but Cloud Run does not.

The repo is single-branch: all work lands on `main`. There is no staging
branch and no release branch.

---

## Surfaces + triggers

| Surface | Host | Triggered by | Gated by |
|---|---|---|---|
| Web (`apps/web`, Next 16) | Vercel | Auto on push to `main` (Git integration). Preview deploys on every PR. | Vercel build = `pnpm install --frozen-lockfile` + `next build` |
| API — Railway beta | Railway (one public service, repo `Dockerfile`) | Auto on push to the watched branch **if** the Railway service is linked to the GitHub repo (configured in the Railway dashboard, not in-repo). | Railway build from `Dockerfile`; healthcheck `/healthz`; start command `apps/api/scripts/start-with-migrations.sh` |
| Worker — Railway beta | Railway (one private/background service, same image) | Same as API — only if linked. | Start command `node apps/api/dist/worker-entry.js` |
| API — Cloud Run (asia-south1) | Google Cloud Run (`jak-swarm-api`) | **MANUAL only.** `gcloud builds submit --config=cloudbuild-api.yaml --substitutions=_REGION=asia-south1,_SERVICE_NAME=jak-swarm-api,_REPO_NAME=jak-docker,_IMAGE_TAG=<tag> --project=<project>`. A push to `main` does NOT deploy Cloud Run. | Cloud Build → Artifact Registry → Cloud Run revision. `--min-instances=1` must be re-applied per revision (revisions are immutable). |
| Worker — Cloud Run | Cloud Run (`jak-swarm-worker`) | **MANUAL only.** `gcloud builds submit --config=cloudbuild-worker.yaml ...`. Never scales to zero (`--min-instances=1`, cpu-always-allocated) — it polls the DB queue. | Same as API. |
| Postgres + pgvector | Supabase | Schema changes via `pnpm --filter @jak-swarm/db db:migrate:deploy` (manual, against the pooler). Migrations are versioned in `packages/db/prisma/migrations/`. | None automated — operator-run. |
| Redis | Railway managed | Provisioned in the Railway project. | n/a |

### Honest gaps
- **Cloud Run is behind Railway for any push that isn't followed by a manual `gcloud builds submit`.** If you rely on Cloud Run as the prod API, a push to `main` does not roll forward until you run the manual step. Do not assume "merged = live" for Cloud Run.
- **Railway auto-deploy depends on dashboard-side repo linking.** It is NOT verifiable from the repo alone. Confirm in the Railway service settings that the GitHub repo + watched branch (`main`) are connected and "deploy on push" is on.
- **Vercel is the only surface that reliably auto-deploys on every push to `main`.** For the web, "merged = live" (after Vercel build passes).

---

## CI gates (run on every push to `main` + every PR — `.github/workflows/ci.yml`)

These run before/around a deploy. A red CI does not block Vercel/Railway
auto-deploys (they are independent of GitHub Actions), but it IS the signal
that something is broken — treat red CI as a broken deploy.

1. **build** — `pnpm install --frozen-lockfile` → Prisma generate → build the 13 workspace packages + `@jak-swarm/api` in dependency order → `next build` for web → production Docker image.
2. **test** — unit + integration suites against real Postgres (pgvector/pg16) + Redis services. Coverage floor enforced via `tests/vitest.config.ts`.
3. **security-gate** — fails on hardcoded default `AUTH_SECRET`, real-looking API keys, tracked `.env`, missing production boot guard.
4. **secret-scan** — gitleaks over full history (`.gitleaks.toml` allowlist).
5. **dependency-audit** — `pnpm audit --audit-level=high --prod` (transitive prod CVEs block).
6. **sbom** — CycloneDX SBOM artifact on push to `main`.
7. **truth-check** — `pnpm check:truth` blocks if README / landing claims drift from the live tool manifest + integration matrix.
8. **lint (eslint)** — `pnpm lint:eslint` runs the root flat config (`eslint.config.mjs`) with `--max-warnings=0`. Real quality gate (unused vars, unreachable code) — not just `tsc --noEmit`.
9. **dependabot-lockfile** (`.github/workflows/dependabot-lockfile.yml`) — on Dependabot PRs only, regenerates `pnpm-lock.yaml` and commits it back so Vercel preview deploys pass `--frozen-lockfile`.

---

## Operator checklist — "I merged a PR to main, is it live?"

1. **Web (Vercel):** yes, within ~1-2 min of the push (Vercel build time). Check the Vercel dashboard for the `main` deployment status.
2. **API (Railway, if linked):** yes, after Railway rebuilds the Docker image. Check the Railway service deploy log.
3. **API (Cloud Run):** NO. Run `gcloud builds submit --config=cloudbuild-api.yaml --substitutions=...,_IMAGE_TAG=<date>` then verify `--min-instances=1` is set on the new revision.
4. **Worker (Cloud Run):** NO. Same manual step with `cloudbuild-worker.yaml`.
5. **DB migrations:** if the PR includes a Prisma migration, run `pnpm --filter @jak-swarm/db db:migrate:deploy` against the production pooler. The API will not boot cleanly against an out-of-date schema.
6. **Env vars:** if the PR reads a new env var, set it on Vercel (web), Railway (api/worker), and Cloud Run Secret Manager BEFORE merging, else the deploy boots with a missing var and the production boot guard (`apps/api/src/boot/validate-config.ts`) exits 1.

---

## Canonical deploy docs (deeper detail)
- Cloud Run fresh deploy: [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md)
- API perf knobs + JAK JWT deploy order: [`apps/api/DEPLOY.md`](apps/api/DEPLOY.md)
- Railway beta shape: [`docs/railway-deployment.md`](docs/railway-deployment.md)
- GCP secrets: `scripts/create-gcp-secrets.sh` + `docs/GOOGLE_SECRET_MANAGER_SETUP.md`