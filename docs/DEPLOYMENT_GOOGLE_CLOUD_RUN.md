# Deploying JAK Swarm to Google Cloud Run

> **Primary deployment**: Cloud Run is the primary deployment for the JAK Swarm API. Railway remains available as a rollback/fallback path — switch `NEXT_PUBLIC_API_URL` in Vercel to return to Railway at any time.

> **Google AI Agents Challenge**: This deployment demonstrates JAK Swarm running on Google Cloud infrastructure with Gemini integration. The API uses per-tenant LLM provider switching (OpenAI ↔ Gemini) with zero code changes, and Google ADK orchestration via `JAK_ADK_MODE=1`.

---

## Current Deployment Status

JAK Swarm API is deployed on Google Cloud Run as the primary production backend.

| Field | Value |
|-------|-------|
| Service | `jak-swarm-api` |
| Region | `asia-south1` |
| URL | `https://jak-swarm-api-565531938617.asia-south1.run.app` |
| Last deployed by | `reetu004@gmail.com` |
| Last deployed at | `2026-06-09T05:50:22Z` (≈ 11:20 AM IST) |

> **Note**: Only `jak-swarm-api` is deployed. The `jak-swarm-worker` service has not been created yet on Cloud Run.

### Verification Commands

```bash
# Confirm the GCP project
gcloud config get-value project

# List all Cloud Run services
gcloud run services list --platform managed

# Get service URL and status
gcloud run services describe jak-swarm-api \
  --region asia-south1 \
  --format="value(status.url,status.conditions[0].status,status.conditions[0].type)"

# Test the API health endpoint
curl -i https://jak-swarm-api-565531938617.asia-south1.run.app/health

# Read recent logs
gcloud run services logs read jak-swarm-api \
  --region asia-south1 \
  --limit=50
```

### Component Status

| Component | Status |
|-----------|--------|
| Cloud Run API (`jak-swarm-api`) | ✅ Deployed, publicly reachable |
| Cloud Run Worker (`jak-swarm-worker`) | ⏳ Not deployed yet |
| Supabase PostgreSQL | ✅ Connected (shared with Railway) |
| Redis | ✅ Connected via Railway public endpoint (`rediss://`, not `.railway.internal`) |
| Google Secret Manager | ✅ Configured, 12 secrets mounted |
| Vercel `NEXT_PUBLIC_API_URL` | ⏳ Still pointing at Railway (switch after Worker validation) |

### Health Endpoints

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /ready` | ✅ PASS | Primary readiness check. Env, DB, Redis, LLM all pass. |
| `GET /health` | ⚠️ PARTIAL | Deep diagnostic. Redis OK. Prisma/Supabase pooler has a prepared-statement compatibility warning (non-blocking — queries still work). |
| `GET /healthz` | ❌ NOT WIRED | Returns 404. Liveness endpoint needs to be added or Cloud Run health probe configured to use `/ready` instead. |

### Known Remaining Work

1. **Wire `/healthz`** as a fast liveness probe (no dependency checks, always returns 200) — or configure Cloud Run liveness probe to use `/ready`
2. **Fix `/health` Prisma prepared-statement warning** — Supabase pooler (port 6543) uses transaction mode which conflicts with Prisma prepared statements. Options: use session mode, switch to direct URL (port 5432), or configure `pgbouncer` compatibility
3. **Deploy Cloud Run Worker** after API validation is complete
4. **Switch Vercel `NEXT_PUBLIC_API_URL`** to Cloud Run URL after Worker and API are fully validated
5. **Rotate exposed secrets** after final validation

### Rollback to Railway

If Cloud Run has issues, switch back to Railway immediately — no code changes needed:

```bash
# In Vercel, update the environment variable:
# NEXT_PUBLIC_API_URL = https://jak-swarm-api-production.up.railway.app
# Then: vercel --prod
```

Do not delete Railway services until rollback is no longer needed.

---

## Architecture

```
                        ┌──────────────────┐
                        │   Vercel (Web)   │
                        │   NEXT_PUBLIC_   │
                        │   API_URL ──┐    │
                        └─────────────┼────┘
                                      │
                    ┌─────────────────┼──────────────────┐
                    │                 │                  │
                    ▼                 ▼                  │
         ┌──────────────────┐ ┌──────────────────┐      │
         │  Cloud Run API   │ │  Railway API     │      │
         │  (port 4000)     │ │  (port 4000)     │      │
         └────────┬─────────┘ └────────┬─────────┘      │
                  │                     │                │
         ┌──────────────────┐          │                │
         │  Cloud Run Worker│          │                │
         │  (not deployed)  │          │                │
         └────────┬─────────┘          │                │
                  │                     │                │
                  └──────────┬──────────┘                │
                             │                          │
                    ┌────────▼────────┐ ┌────────────────┘
                    │  Railway Redis    │ │ Supabase PostgreSQL
                    │  (public endpoint│ │ (shared)
                    │   rediss://)     │ │
                    └─────────────────┘ └────────────────┘
```

- **API** deploys as a Cloud Run service; **Worker** is not yet deployed
- **Redis** uses Railway's **public endpoint** (`rediss://`) — the `.railway.internal` private DNS is unreachable from Cloud Run
- **PostgreSQL** stays on Supabase (shared by both deployments)
- **Vercel** frontend currently points to Railway; switching to Cloud Run requires updating `NEXT_PUBLIC_API_URL`
- **Cloud Run is the primary deployment**; Railway is the rollback/fallback path

---

## Prerequisites

1. **Google Cloud account** with billing enabled
2. **gcloud CLI** installed ([install guide](https://cloud.google.com/sdk/docs/install))
3. **Project created** — note your `$PROJECT_ID`
4. **APIs enabled**: Cloud Run, Cloud Build, Artifact Registry, Secret Manager

```bash
# Set these once per terminal session
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"
export REPO_NAME="jak-swarm"

gcloud config set project $PROJECT_ID
gcloud auth login
```

---

## Step 1: Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project=$PROJECT_ID
```

---

## Step 2: Create Artifact Registry Repository

```bash
gcloud artifacts repositories create $REPO_NAME \
  --repository-format=docker \
  --location=$REGION \
  --description="JAK Swarm Docker images" \
  --project=$PROJECT_ID
```

---

## Step 3: Create Service Account

```bash
gcloud iam service-accounts create jak-swarm-run \
  --display-name="JAK Swarm Cloud Run" \
  --project=$PROJECT_ID

# Grant necessary roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:jak-swarm-run@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:jak-swarm-run@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:jak-swarm-run@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

---

## Step 4: Create Secrets in Secret Manager

Replace each value with your actual credentials. These match the env vars the API and Worker read at startup.

```bash
# ── Required secrets ──

echo -n "postgresql://user:pass@host:5432/dbname" | \
  gcloud secrets create DATABASE_URL --data-file=-

echo -n "your-auth-secret-min-32-chars-long" | \
  gcloud secrets create AUTH_SECRET --data-file=-

echo -n "sk-..." | \
  gcloud secrets create OPENAI_API_KEY --data-file=-

echo -n "rediss://default:pass@host:6379" | \
  gcloud secrets create REDIS_URL --data-file=-

echo -n "https://your-project.supabase.co" | \
  gcloud secrets create NEXT_PUBLIC_SUPABASE_URL --data-file=-

echo -n "eyJ..." | \
  gcloud secrets create NEXT_PUBLIC_SUPABASE_ANON_KEY --data-file=-

echo -n "eyJ..." | \
  gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-

echo -n "your-signing-secret-min-16-chars" | \
  gcloud secrets create EVIDENCE_SIGNING_SECRET --data-file=-

echo -n "your-metrics-bearer-token" | \
  gcloud secrets create METRICS_TOKEN --data-file=-

echo -n "https://your-api-url,https://your-web-url" | \
  gcloud secrets create CORS_ORIGINS --data-file=-

# ── Optional: Gemini (required for LLM_PROVIDER=gemini) ──

echo -n "AIza..." | \
  gcloud secrets create GEMINI_API_KEY --data-file=-

# ── Optional: Gemini ADK mode ──
# JAK_ADK_MODE is not a secret — set it as an env var if needed

# ── Optional: field encryption ──

echo -n "64-hex-char-aes-256-gcm-key" | \
  gcloud secrets create JAK_FIELD_ENCRYPTION_KEY --data-file=-

# ── Optional: observability ──

echo -n "https://otel-collector:4318" | \
  gcloud secrets create OTEL_EXPORTER_OTLP_ENDPOINT --data-file=-

echo -n "https://sentry-dsn@sentry.io/project" | \
  gcloud secrets create SENTRY_DSN --data-file=-
```

Grant the Cloud Run service account access to each secret:

```bash
for SECRET in DATABASE_URL AUTH_SECRET OPENAI_API_KEY REDIS_URL \
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_ROLE_KEY EVIDENCE_SIGNING_SECRET METRICS_TOKEN \
  CORS_ORIGINS GEMINI_API_KEY; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:jak-swarm-run@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT_ID
done
```

---

## Step 5: Build & Deploy the API

```bash
# Set a unique image tag for this deploy
export IMAGE_TAG=manual-$(date +%Y%m%d%H%M%S)

# Build and deploy in one command
# Secrets and env vars are configured inline in cloudbuild-api.yaml
# so no separate gcloud run services update step is needed.
gcloud builds submit --config=cloudbuild-api.yaml \
  --substitutions=_REGION=$REGION,_SERVICE_NAME=jak-swarm-api,_REPO_NAME=$REPO_NAME,_IMAGE_TAG=$IMAGE_TAG \
  --project=$PROJECT_ID
```

> **Note**: The `cloudbuild-api.yaml` now includes `--set-secrets` and `--set-env-vars` inline,
> so secrets are mounted during the first deploy. No separate update step is needed.
> Do NOT set `PORT` in `--set-env-vars` — Cloud Run injects it automatically and the app reads `process.env.PORT`.

### Allow unauthenticated access (API needs to accept requests from Vercel)

```bash
gcloud run services add-iam-policy-binding jak-swarm-api \
  --region=$REGION \
  --member="allUsers" \
  --role="roles/run.invoker" \
  --project=$PROJECT_ID
```

---

## Step 6: Build & Deploy the Worker

> **⚠️ The Worker is a long-running queue listener.** It polls PostgreSQL with `FOR UPDATE SKIP LOCKED` and subscribes to Redis for workflow signals. Scaling to zero would stop background processing entirely. `min-instances=1` is set in `cloudbuild-worker.yaml` to keep the worker always-on.

```bash
# Set a unique image tag for this deploy
export IMAGE_TAG=manual-$(date +%Y%m%d%H%M%S)

# Build and deploy in one command
# Secrets and env vars are configured inline in cloudbuild-worker.yaml
gcloud builds submit --config=cloudbuild-worker.yaml \
  --substitutions=_REGION=$REGION,_SERVICE_NAME=jak-swarm-worker,_REPO_NAME=$REPO_NAME,_IMAGE_TAG=$IMAGE_TAG \
  --project=$PROJECT_ID
```

The Worker does NOT need `--allow-unauthenticated` — it only processes internal queue jobs.

### Worker port and health endpoints

The Worker listens on `WORKER_METRICS_PORT` (default `9464`), not `process.env.PORT`. Cloud Run's `--port=9464` flag must match. The `PORT=9464` env var is set for consistency but the Worker code uses `WORKER_METRICS_PORT`.

| Endpoint | Purpose | Cloud Run Use |
|----------|---------|---------------|
| `GET /healthz` | Liveness — process alive, not shutting down | Liveness probe |
| `GET /ready` | Readiness — Postgres connected, Redis connected (if configured) | Readiness probe |
| `GET /metrics` | Prometheus metrics (bearer token gated via `METRICS_TOKEN`) | Monitoring |

---

## Step 7: Smoke Tests

Get the API URL:

```bash
API_URL=$(gcloud run services describe jak-swarm-api \
  --region=$REGION \
  --format='value(status.url)' \
  --project=$PROJECT_ID)

echo "API URL: $API_URL"
```

### Health check

```bash
# Note: /healthz currently returns 404 (not yet wired as a liveness probe).
# Use /ready for readiness checks and /health for deep diagnostics.
curl -s "$API_URL/healthz" | jq .
# Currently returns 404 — see Known Remaining Work above

curl -s "$API_URL/ready" | jq .
# Expected: { "status": "ready", "checks": { "db": "ok", "redis": "ok", ... } }

curl -s "$API_URL/health" | jq .
# Deep diagnostic — may show Prisma pooler warning (non-blocking)

curl -s "$API_URL/version" | jq .
# Expected: { "version": "0.1.0-beta.0", "engine": "gemini", ... }
```

### Worker health check

```bash
WORKER_URL=$(gcloud run services describe jak-swarm-worker \
  --region=$REGION \
  --format='value(status.url)' \
  --project=$PROJECT_ID)

# Worker requires auth — use identity token
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "$WORKER_URL/healthz" | jq .
# Expected: { "status": "ok", "instanceId": "..." }
```

### Workflow test (via frontend)

1. Update `NEXT_PUBLIC_API_URL` in Vercel to point to the Cloud Run API URL
2. Create a test workflow from the dashboard
3. Verify SSE streaming works (events should appear in the cockpit)
4. Check Cloud Run logs: `gcloud run logs read jak-swarm-api --region=$REGION`

---

## Step 8: Safe Deployment Sequence

> **⚠️ Do NOT deploy both API and Worker at the same time and switch traffic in one step.** The worker processes a shared PostgreSQL queue. If both Railway Worker and Cloud Run Worker run simultaneously without coordination, they will race for the same jobs. Follow this sequence:

### Phase 1: Deploy and test the Cloud Run API

1. Deploy the API service (Steps 1–5)
2. Configure secrets and env vars
3. Run API smoke tests: `/healthz`, `/ready`, `/version`
4. **Do NOT switch Vercel traffic yet** — Railway API is still serving production

### Phase 2: Test Cloud Run API with Railway Worker

5. Update `NEXT_PUBLIC_API_URL` in Vercel to the Cloud Run API URL
6. Redeploy Vercel (`vercel --prod`)
7. Create a test workflow from the dashboard
8. Verify SSE streaming works — the Railway Worker should process jobs from the Cloud Run API
9. Verify workflow completes end-to-end (Commander → Planner → Workers → Verifier)

### Phase 3: Switch the Worker

10. **Pause the Railway Worker** (Railway dashboard → jak-swarm-worker → Settings → Pause, or set `WORKFLOW_QUEUE_CONCURRENCY=0`)
11. Deploy the Cloud Run Worker (Step 6)
12. Configure Worker secrets and env vars
13. Wait for `/healthz` to return `{ "status": "ok" }`
14. Wait for `/ready` to return `{ "ready": true }`
15. Create another test workflow — verify the Cloud Run Worker picks it up
16. Check Cloud Run logs: `gcloud run logs read jak-swarm-worker --region=$REGION --limit=50`

### Phase 4: Full traffic on Cloud Run

17. Monitor for 15–30 minutes — check for workflow failures, queue depth, error rate
18. If stable, the Railway Worker can remain paused as a hot standby
19. If issues arise, see rollback steps below

---

## Step 9: Switch Traffic to Cloud Run

Only after Phase 2 smoke tests pass:

```bash
# In Vercel, update the environment variable:
# NEXT_PUBLIC_API_URL = https://jak-swarm-api-XXXXX-uc.a.run.app
#
# Then redeploy the frontend:
# vercel --prod
```

> **Important**: Keep Railway running. If Cloud Run has issues, switch `NEXT_PUBLIC_API_URL` back to the Railway URL and redeploy Vercel. No code changes needed.

---

## Rollback to Railway

If Cloud Run has issues:

```bash
# 1. Resume the Railway Worker if it was paused
# Railway dashboard → jak-swarm-worker → Settings → Resume (or reset WORKFLOW_QUEUE_CONCURRENCY)

# 2. Switch NEXT_PUBLIC_API_URL back to Railway
# In Vercel: NEXT_PUBLIC_API_URL = https://jak-swarm-api-production.up.railway.app
# Then: vercel --prod

# 3. (Optional) Scale down Cloud Run to save costs
gcloud run services update jak-swarm-api \
  --region=$REGION \
  --min-instances=0 \
  --project=$PROJECT_ID

gcloud run services update jak-swarm-worker \
  --region=$REGION \
  --min-instances=0 \
  --project=$PROJECT_ID

# 4. (Optional) Delete Cloud Run services entirely
gcloud run services delete jak-swarm-api --region=$REGION --project=$PROJECT_ID
gcloud run services delete jak-swarm-worker --region=$REGION --project=$PROJECT_ID
```

---

## Environment Variables Reference

### Required (app won't start without)

| Variable | Source | Description |
|----------|--------|-------------|
| `AUTH_SECRET` | Secret Manager | JWT signing secret (min 32 chars) |
| `DATABASE_URL` | Secret Manager | PostgreSQL connection string |
| `OPENAI_API_KEY` | Secret Manager | OpenAI API key |
| `CORS_ORIGINS` | Secret Manager | Comma-separated allowed origins |
| `NEXT_PUBLIC_SUPABASE_URL` | Secret Manager | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Secret Manager | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret Manager | Supabase service role key |
| `EVIDENCE_SIGNING_SECRET` | Secret Manager | HMAC signing secret (min 16 chars) |
| `METRICS_TOKEN` | Secret Manager | Bearer token for /metrics |
| `REDIS_URL` | Secret Manager | Redis connection string |

### Optional (feature flags)

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `existing` | `openai`, `gemini`, or `existing` |
| `GEMINI_API_KEY` | — | Required when `LLM_PROVIDER=gemini` |
| `GEMINI_MODEL` | — | Global Gemini model override |
| `GEMINI_MODEL_TIER_1` | `gemini-2.5-flash-lite` | Economy tier |
| `GEMINI_MODEL_TIER_2` | `gemini-2.5-flash` | Balanced tier |
| `GEMINI_MODEL_TIER_3` | `gemini-2.5-pro` | Premier tier |
| `GEMINI_GOOGLE_SEARCH_GROUNDING` | — | Set to `1` to enable |
| `GEMINI_VERTEX_AI_SEARCH_DATASTORE` | — | Vertex AI Search datastore path |
| `JAK_ADK_MODE` | — | Set to `1` to enable Google ADK pipeline |
| `JAK_FIELD_ENCRYPTION_KEY` | — | AES-256-GCM key (64 hex chars) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OpenTelemetry trace export URL |
| `SENTRY_DSN` | — | Sentry error reporting DSN |
| `LOG_LEVEL` | `info` | Logging verbosity |

---

## Cost Considerations

- **Cloud Run pricing**: Pay per request and container runtime. With `min-instances=1` for both API and Worker, expect ~$25-40/month for idle time.
- **API with min-instances=1**: ~$10-15/month (2 vCPU, 2Gi RAM, always-on)
- **Worker with min-instances=1**: ~$10-15/month (1 vCPU, 1Gi RAM, always-on — required because the Worker is a long-running queue listener that must continuously poll PostgreSQL)
- **Network egress**: Cloud Run → Railway Redis/Supabase traffic is billable
- **Secret Manager**: 6 free secrets, then $0.06/10,000 access operations

To minimize costs after the challenge demo:
- Scale the Worker to `min-instances=0` only if you accept that background queue processing stops when idle — the Worker is a long-running listener, not a request-driven service
- Use `--cpu=1 --memory=512Mi` for the worker in low-traffic periods
- Delete Cloud Run services when not needed

---

## Monitoring

### View logs

```bash
# API logs
gcloud run logs read jak-swarm-api --region=$REGION --project=$PROJECT_ID

# Worker logs
gcloud run logs read jak-swarm-worker --region=$REGION --project=$PROJECT_ID

# Follow logs in real-time
gcloud run logs tail jak-swarm-api --region=$REGION --project=$PROJECT_ID
```

### Cloud Run metrics

- **Console**: https://console.cloud.google.com/run?project=$PROJECT_ID
- **API metrics**: Request count, latency, error rate, memory/CPU usage
- **Custom metrics**: `/metrics` endpoint (requires `METRICS_TOKEN` bearer header)

### Alerts

```bash
# Create an alert for high error rate
gcloud alpha monitoring policies create \
  --display-name="JAK Swarm API Error Rate" \
  --condition-display-name="Error rate > 5%" \
  --condition-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="jak-swarm-api"' \
  --condition-threshold-value=0.05 \
  --condition-threshold-comparison=COMPARISON_GT \
  --project=$PROJECT_ID
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `Dockerfile.api` | Cloud Run API image (Chromium included) |
| `Dockerfile.worker` | Cloud Run Worker image (no Chromium) |
| `cloudbuild-api.yaml` | Cloud Build + deploy config for API |
| `cloudbuild-worker.yaml` | Cloud Build + deploy config for Worker |
| `Dockerfile` | Railway (unchanged, rollback) |
| `railway.toml` | Railway config (unchanged) |