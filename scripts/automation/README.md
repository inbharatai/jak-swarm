# JAK Swarm — Deployment Automation

Scripts that replace dashboard clicking for the Render API+Worker split migration. Each script accepts tokens via **env vars only** — never hardcoded, never passed as CLI args (so they don't end up in shell history).

## TL;DR

```bash
# 1. After rotating leaked credentials (section A of docs/founder-action-list.md)
export RENDER_API_KEY=rnd_…                 # the NEW key, not the leaked one
export RENDER_OWNER_ID=tea-…                 # from dashboard.render.com/u/settings/general
export JAK_REPO_URL=https://github.com/inbharatai/jak-swarm
export JAK_REPO_BRANCH=main
export SUPABASE_PROJECT_REF=xxx              # your project ref from Supabase URL
export SUPABASE_MANAGEMENT_TOKEN=sbp_…       # from supabase.com/dashboard/account/tokens
export VERCEL_API_TOKEN=…                    # vercel.com/account/tokens (full-access scoped to your team)
export VERCEL_PROJECT_ID=prj_…               # vercel project → Settings → General → "Project ID"

# 2. Read-only probe — verifies every token works before doing anything destructive
./scripts/automation/probe-tokens.sh

# 3. Provision the two new Render services
./scripts/automation/provision-render-worker.sh

# 4. Configure Supabase redirect URLs + Vercel env
./scripts/automation/configure-supabase-redirects.sh
./scripts/automation/configure-vercel-env.sh

# 5. Sync env vars onto each Render service from local .env files
./scripts/automation/sync-env-to-render.sh jak-swarm-worker < .env.render-worker
./scripts/automation/sync-env-to-render.sh jak-swarm-api < .env.render-api  # this is the flip
./scripts/automation/sync-env-to-render.sh jak-swarm-grafana-agent < .env.render-grafana-agent
```

All scripts are idempotent — safe to re-run.

## Security contract

1. **Tokens via env only.** Never pass a secret on the command line (it would show up in shell history, `ps`, and system logs).
2. **Scripts never persist tokens.** No temp files, no caching. Tokens live in your shell env for the duration of the script.
3. **Rotated tokens only.** Do not use the `rnd_I38L…` / Supabase service-role / Upstash tokens that were pasted in Claude chat on 2026-04-18 and 2026-04-20 — those are burned. Rotate first (founder-action-list section A), then run these scripts with fresh tokens.
4. **Pair-of-eyes recommended** on first run. Scripts print what they are about to do and ask for `y/N` confirmation before any mutating call (unless `--yes` is passed).

## Prerequisites

- `bash` 4+
- `curl`
- `jq` (JSON parsing — `brew install jq` / `apt install jq` / `choco install jq`)

On Windows, use Git Bash or WSL. PowerShell is not supported.

## Scripts

### `probe-tokens.sh` — read-only connectivity check

Makes one `GET` call per platform to confirm your env-var tokens work:
- Render: `GET /v1/services?limit=1` — lists one service (your API). No mutation.
- Supabase: `GET /v1/projects/$SUPABASE_PROJECT_REF` — reads project metadata.
- Vercel: `GET /v9/projects/$VERCEL_PROJECT_ID` — reads project info.

Use this to verify your rotated tokens before running destructive scripts.

### `provision-render-worker.sh` — create Render services

Creates two private services (pserv) via Render API:
1. `jak-swarm-worker` — runs `node apps/api/dist/worker-entry.js`
2. `jak-swarm-grafana-agent` — runs `grafana/agent:v0.40.0` with committed config

Both use the committed `Dockerfile` / `ops/grafana-agent/Dockerfile` from your repo. Env vars are NOT set here — use `sync-env-to-render.sh` for that. Script is idempotent: if a service with the target name already exists, it skips creation and reports the existing ID.

### `sync-env-to-render.sh <service-name>` — bulk env upload

Reads a `KEY=VALUE`-per-line .env file from STDIN and uploads each as a Render env var (overwriting existing) on the named service. Commented lines (`#`) and blank lines are skipped. `=` in VALUE is preserved.

Example local file `.env.render-worker`:
```
NODE_ENV=production
LOG_LEVEL=info
DATABASE_URL=postgresql://...
REDIS_URL=rediss://default:...@...upstash.io:6379
# LLM keys
OPENAI_API_KEY=sk-proj-...
```

### `configure-supabase-redirects.sh` — Supabase auth URLs

Idempotently sets Supabase Auth Site URL + Redirect URLs to match the committed list (localhost:3000, jakswarm.com, www.jakswarm.com — `/auth/callback` and `/auth/confirm` for each).

### `configure-vercel-env.sh` — Vercel project env sync

Reads a `KEY=VALUE`-per-line .env file from STDIN and uploads each as a Vercel project env var (production scope). Only `NEXT_PUBLIC_*` variables belong here — the script warns if a non-public key is in the file to prevent accidentally exposing a backend secret to the browser bundle.

## What these scripts do NOT do

- They do NOT touch Upstash — Upstash's management API can create/delete DBs but can't reset a password for a free-tier DB, and you've got one DB already. Faster to reset the password in the Upstash UI and copy the new URL into `REDIS_URL`.
- They do NOT run the smoke tests from section H step 18-21 of founder-action-list. Those require a real browser, a real user session, and eyeballs on a trace.
- They do NOT provision Grafana Cloud. You still need to sign up once, grab the remote_write URL + user + API key, and paste those three values into the Grafana Agent service env (via `sync-env-to-render.sh`).
