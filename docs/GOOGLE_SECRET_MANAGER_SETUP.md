# Google Secret Manager Setup — JAK Swarm

> **Project**: `crafty-haiku-498807-v8` · **Region**: `asia-south1` · **Service Account**: `jak-cloud-run-sa@crafty-haiku-498807-v8.iam.gserviceaccount.com`

This guide walks you through creating every secret Google Cloud Run needs, copying values from your existing Railway/Supabase/Vercel setup.

---

## Overview

JAK Swarm has two Cloud Run services:

| Service | Port | Secrets Needed | Non-Secret Env Vars |
|---------|------|----------------|---------------------|
| **API** (`jak-swarm-api`) | 4000 | 12 required, 1 conditional | 5 |
| **Worker** (`jak-swarm-worker`) | 9464 | 9 required, 1 conditional | 5 |

---

## Secret vs Non-Secret

**Secrets** go in Google Secret Manager — API keys, passwords, connection strings, tokens. They're mounted at runtime and never appear in Cloud Run config.

**Non-secrets** are configuration flags, port numbers, and feature toggles. They go in `--set-env-vars` on the Cloud Run deploy command.

---

## Step 1: Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project=crafty-haiku-498807-v8
```

---

## Step 2: Create Artifact Registry Repository

```bash
gcloud artifacts repositories create jak-docker \
  --repository-format=docker \
  --location=asia-south1 \
  --description="JAK Swarm Docker images" \
  --project=crafty-haiku-498807-v8
```

---

## Step 3: Grant Service Account Access to Secrets

```bash
SA=jak-cloud-run-sa@crafty-haiku-498807-v8.iam.gserviceaccount.com

# Grant Secret Manager access
gcloud projects add-iam-policy-binding crafty-haiku-498807-v8 \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet

# Grant Cloud Run admin (for deployments)
gcloud projects add-iam-policy-binding crafty-haiku-498807-v8 \
  --member="serviceAccount:${SA}" \
  --role="roles/run.admin" \
  --quiet
```

---

## Step 4: Create All Secrets

### Where to find each value

| Secret | Where to copy from |
|--------|-------------------|
| `DATABASE_URL` | Railway → jak-swarm-api → Variables → `DATABASE_URL` (Supabase pooler URL, port 6543) |
| `DIRECT_URL` | Railway → jak-swarm-api → Variables → `DIRECT_URL` (Supabase direct URL, port 5432) |
| `AUTH_SECRET` | Railway → jak-swarm-api → Variables → `AUTH_SECRET` |
| `OPENAI_API_KEY` | OpenAI dashboard → https://platform.openai.com/api-keys |
| `GEMINI_API_KEY` | Google AI Studio → https://aistudio.google.com/apikey |
| `REDIS_URL` | Railway → jak-swarm-worker → Variables → `REDIS_URL` (starts with `rediss://`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → service_role secret key |
| `EVIDENCE_SIGNING_SECRET` | Railway → jak-swarm-api → Variables → `EVIDENCE_SIGNING_SECRET` |
| `METRICS_TOKEN` | Railway → jak-swarm-api → Variables → `METRICS_TOKEN` |
| `CORS_ORIGINS` | **NOT a secret** — but stored in Secret Manager for convenience. Value: `https://jakswarm.com,https://www.jakswarm.com` |

### How to copy from Railway

1. Go to https://railway.app → click your project → click `jak-swarm-api` service → **Variables** tab
2. Click the eye icon next to each variable to reveal its value
3. Copy the value (you'll paste it when running the script below)

### How to copy from Supabase

1. Go to https://supabase.com/dashboard → select your project → **Project Settings** → **API**
2. `NEXT_PUBLIC_SUPABASE_URL` = "Project URL" (e.g. `https://xxxxx.supabase.co`)
3. `NEXT_PUBLIC_SUPABASE_ANON_KEY` = "anon public" key
4. `SUPABASE_SERVICE_ROLE_KEY` = "service_role" key (⚠️ this is a secret — never expose to client)

### How to get Gemini API key

1. Go to https://aistudio.google.com/apikey
2. Click "Create API Key"
3. Select your Google Cloud project (`crafty-haiku-498807-v8`)
4. Copy the key (starts with `AIza...`)

### Create secrets manually (alternative to the script)

```bash
# Example: create one secret
echo -n "YOUR_VALUE_HERE" | \
  gcloud secrets create SECRET_NAME \
    --data-file=- \
    --project=crafty-haiku-498807-v8

# Grant access after creating
gcloud secrets add-iam-policy-binding SECRET_NAME \
  --member="serviceAccount:jak-cloud-run-sa@crafty-haiku-498807-v8.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=crafty-haiku-498807-v8
```

### Use the helper script (recommended)

```bash
# Make the script executable
chmod +x scripts/create-gcp-secrets.sh

# Run it — it will prompt you for each value
./scripts/create-gcp-secrets.sh
```

The script uses `read -s` (silent mode) for secrets so values don't echo to your terminal.

---

## Step 5: Verify Secrets

```bash
# Quick check — list all secrets
gcloud secrets list --project=crafty-haiku-498807-v8

# Detailed verification — checks every required secret
chmod +x scripts/verify-gcp-secrets.sh
./scripts/verify-gcp-secrets.sh
```

---

## Step 6: Update a Secret Value

If a value changes (e.g., rotating a key), add a new version:

```bash
# Add a new version to an existing secret
echo -n "NEW_VALUE_HERE" | \
  gcloud secrets versions add SECRET_NAME \
    --data-file=- \
    --project=crafty-haiku-498807-v8

# Cloud Run always uses the "latest" version, so no service restart needed
# if you used SECRET_NAME:latest in --set-secrets.
# If you pinned to a specific version number, update the Cloud Run service.
```

---

## Step 7: Build and Deploy

After all secrets are created and verified:

```bash
# Set a unique image tag for this deploy
export IMAGE_TAG=manual-$(date +%Y%m%d%H%M%S)

# Build and deploy API
# Secrets and env vars are configured inline in cloudbuild-api.yaml
# so no separate gcloud run services update step is needed.
gcloud builds submit --config=cloudbuild-api.yaml \
  --substitutions=_REGION=asia-south1,_SERVICE_NAME=jak-swarm-api,_REPO_NAME=jak-docker,_IMAGE_TAG=$IMAGE_TAG \
  --project=crafty-haiku-498807-v8

# Build and deploy Worker (after API is verified)
# Secrets and env vars are configured inline in cloudbuild-worker.yaml
gcloud builds submit --config=cloudbuild-worker.yaml \
  --substitutions=_REGION=asia-south1,_SERVICE_NAME=jak-swarm-worker,_REPO_NAME=jak-docker,_IMAGE_TAG=$IMAGE_TAG \
  --project=crafty-haiku-498807-v8
```

> **Note**: The cloudbuild files now include `--set-secrets` and `--set-env-vars` inline, so secrets
> are mounted during the first deploy. No separate `gcloud run services update` step is needed.
> Do NOT set `PORT` in env vars — Cloud Run injects it automatically and the app reads `process.env.PORT`.

### Allow unauthenticated access to the API

```bash
gcloud run services add-iam-policy-binding jak-swarm-api \
  --region=asia-south1 \
  --member="allUsers" \
  --role="roles/run.invoker" \
  --project=crafty-haiku-498807-v8
```

The Worker does NOT need `--allow-unauthenticated` — it only processes internal queue jobs.

---

```bash
gcloud run services update jak-swarm-worker \
  --region=asia-south1 \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,\
AUTH_SECRET=AUTH_SECRET:latest,\
## Step 8: Smoke Tests

```bash
# Get the API URL
API_URL=$(gcloud run services describe jak-swarm-api \
  --region=asia-south1 \
  --format='value(status.url)' \
  --project=crafty-haiku-498807-v8)

echo "API URL: $API_URL"

# Health check
curl -s "$API_URL/healthz" | jq .
# Expected: { "status": "alive", "uptime": ..., "shuttingDown": false }

curl -s "$API_URL/ready" | jq .
# Expected: { "status": "ready", "checks": { "db": "ok", "redis": "ok", ... } }

curl -s "$API_URL/version" | jq .
# Expected: { "version": "0.1.0-beta.0", "engine": "gemini", ... }
```

---

## Step 9: Safe Deployment Sequence

> ⚠️ **Do NOT run Railway Worker and Cloud Run Worker against the same queue simultaneously.** They use `FOR UPDATE SKIP LOCKED` which is safe but wasteful — duplicate polling and cross-instance signal noise.

1. **Deploy Cloud Run API** (Step 7 — API only)
2. **Test with Railway Worker still active**: Update `NEXT_PUBLIC_API_URL` in Vercel to the Cloud Run API URL, redeploy, create a test workflow
3. **Pause Railway Worker**: Railway dashboard → jak-swarm-worker → Settings → Deploy → Pause (or set `WORKFLOW_QUEUE_CONCURRENCY=0`)
4. **Deploy Cloud Run Worker** (Step 7 — Worker)
5. **Verify Worker health**: `curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$WORKER_URL/healthz"`
6. **Create another test workflow** — verify the Cloud Run Worker picks it up
7. **Monitor 15-30 min**, then keep Railway as hot standby

### Rollback to Railway

1. Resume Railway Worker (Railway dashboard → jak-swarm-worker → Settings → Deploy → Resume)
2. Update `NEXT_PUBLIC_API_URL` in Vercel back to Railway API URL
3. Redeploy Vercel (`vercel --prod`)

---

## Complete Secret Reference

### Required for API (12 secrets)

| # | Secret Name | Source | Notes |
|---|-------------|--------|-------|
| 1 | `DATABASE_URL` | Railway → jak-swarm-api | Supabase pooler connection string (port 6543) |
| 2 | `DIRECT_URL` | Railway → jak-swarm-api | Supabase direct connection (port 5432, for migrations) |
| 3 | `AUTH_SECRET` | Railway → jak-swarm-api | JWT signing secret, 32+ chars |
| 4 | `OPENAI_API_KEY` | OpenAI dashboard | Starts with `sk-...` |
| 5 | `GEMINI_API_KEY` | Google AI Studio | Starts with `AIza...` |
| 6 | `REDIS_URL` | Railway → jak-swarm-worker | Starts with `rediss://` (TLS) |
| 7 | `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard | e.g. `https://xxxxx.supabase.co` |
| 8 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard | Public anon key (starts with `eyJ...`) |
| 9 | `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard | Secret service role key (starts with `eyJ...`) |
| 10 | `EVIDENCE_SIGNING_SECRET` | Railway → jak-swarm-api | HMAC signing secret, 16+ chars |
| 11 | `METRICS_TOKEN` | Railway → jak-swarm-api | Bearer token for /metrics endpoint |
| 12 | `CORS_ORIGINS` | Manual | `https://jakswarm.com,https://www.jakswarm.com` |

### Required for Worker (9 secrets)

| # | Secret Name | Same as API? | Notes |
|---|-------------|-------------|-------|
| 1 | `DATABASE_URL` | ✅ Same | Shared |
| 2 | `AUTH_SECRET` | ✅ Same | Shared |
| 3 | `OPENAI_API_KEY` | ✅ Same | Shared |
| 4 | `GEMINI_API_KEY` | ✅ Same | Shared |
| 5 | `REDIS_URL` | ✅ Same | Shared |
| 6 | `DIRECT_URL` | ✅ Same | Shared (needed for Prisma) |
| 7 | `SUPABASE_SERVICE_ROLE_KEY` | ✅ Same | Shared |
| 8 | `EVIDENCE_SIGNING_SECRET` | ✅ Same | Shared |
| 9 | `METRICS_TOKEN` | ✅ Same | Shared |

### Non-Secret Environment Variables (set via --set-env-vars)

#### API

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | |
| `PORT` | `4000` | |
| `WORKFLOW_WORKER_MODE` | `embedded` | API runs embedded worker in Cloud Run single-service mode |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | `/usr/bin/chromium-browser` | Path in Docker image |
| `REQUIRE_REDIS_IN_PROD` | `true` | Fail fast if Redis is missing |
| `LLM_PROVIDER` | `gemini` | Use Gemini as default provider for Google AI Agents Challenge |
| `JAK_ADK_MODE` | `1` | Enable Google ADK orchestration |
| `GEMINI_GOOGLE_SEARCH_GROUNDING` | `1` | Enable Google Search grounding |
| `OPENAI_WEB_SEARCH` | `1` | Enable OpenAI web_search_preview |

#### Worker

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | |
| `PORT` | `9464` | Must match WORKER_METRICS_PORT |
| `WORKFLOW_WORKER_MODE` | `standalone` | Worker runs as separate process |
| `REQUIRE_REDIS_IN_PROD` | `true` | Fail fast if Redis is missing |
| `WORKER_METRICS_PORT` | `9464` | Health/metrics endpoint port |
| `LLM_PROVIDER` | `gemini` | Same as API |
| `JAK_ADK_MODE` | `1` | Same as API |
| `GEMINI_GOOGLE_SEARCH_GROUNDING` | `1` | Same as API |
| `OPENAI_WEB_SEARCH` | `1` | Same as API |

### Worker Cloud Run Configuration

| Setting | Value | Why |
|---------|-------|-----|
| `--min-instances` | `1` | Worker is a long-running queue listener that must always be running |
| `--max-instances` | `5` | Scale up under load |
| `--cpu-allocated-always` | (set) | Worker polls DB continuously; CPU throttling would cause latency spikes |
| `--no-allow-unauthenticated` | (set) | Worker has no public API; only internal queue processing |
| `--timeout` | `300` | Max request duration (5 min) |

---

## Values You Must Copy from Railway

Log into https://railway.app, open the JAK Swarm project, and copy these from the **jak-swarm-api** service Variables tab:

| Railway Variable | Copy to Secret |
|----------------|---------------|
| `DATABASE_URL` | `DATABASE_URL` |
| `DIRECT_URL` | `DIRECT_URL` |
| `AUTH_SECRET` | `AUTH_SECRET` |
| `OPENAI_API_KEY` | `OPENAI_API_KEY` |
| `EVIDENCE_SIGNING_SECRET` | `EVIDENCE_SIGNING_SECRET` |
| `METRICS_TOKEN` | `METRICS_TOKEN` |

From the **jak-swarm-worker** service Variables tab:

| Railway Variable | Copy to Secret |
|----------------|---------------|
| `REDIS_URL` | `REDIS_URL` (click the eye icon to reveal the `rediss://` URL) |

## Values You Must Copy from Supabase

Log into https://supabase.com/dashboard, select your project, go to **Project Settings** → **API**:

| Supabase Field | Copy to Secret |
|----------------|---------------|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| anon public key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| service_role secret key | `SUPABASE_SERVICE_ROLE_KEY` |

## Values You Must Get from Google AI Studio

Go to https://aistudio.google.com/apikey, create an API key for project `crafty-haiku-498807-v8`:

| Google AI Studio Field | Copy to Secret |
|----------------------|---------------|
| API Key | `GEMINI_API_KEY` |

## Values You Set Manually

| Secret | Value |
|--------|-------|
| `CORS_ORIGINS` | `https://jakswarm.com,https://www.jakswarm.com` |

## Optional Secrets (set later if needed)

| Secret | When to set |
|--------|------------|
| `SENTRY_DSN` | When enabling Sentry error tracking |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | When enabling OpenTelemetry tracing |
| `JAK_FIELD_ENCRYPTION_KEY` | When enabling AES-256-GCM PII field encryption |
| `GITHUB_PAT` | When enabling GitHub MCP integration |
| `SLACK_SIGNING_SECRET` | When enabling Slack webhook integration |
| `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET` | When enabling Slack OAuth |
| `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD` | When enabling Gmail integration |
| `PADDLE_WEBHOOK_SECRET` | When enabling Paddle billing |