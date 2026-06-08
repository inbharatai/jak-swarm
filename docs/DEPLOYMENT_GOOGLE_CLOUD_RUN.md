# Deploying JAK Swarm to Google Cloud Run

> **Coexistence**: Railway remains the primary deployment. Cloud Run is a parallel path for the Google AI Agents Challenge. Both can run simultaneously — traffic shifts to Cloud Run only after smoke tests pass, and can shift back to Railway at any time.

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
         ┌────────▼─────────┐ ┌────────▼─────────┐     │
         │  Cloud Run Worker│ │  Railway Worker   │     │
         │  (port 9464)     │ │  (port 9464)      │     │
         └────────┬─────────┘ └────────┬─────────┘     │
                  │                     │                │
                  └──────────┬──────────┘                │
                             │                          │
                    ┌────────▼────────┐ ┌────────────────┘
                    │  Railway Redis  │ │ Supabase PostgreSQL
                    │  (shared)       │ │ (shared)
                    └─────────────────┘ └────────────────┘
```

- **API** and **Worker** each deploy as separate Cloud Run services
- **Redis** and **PostgreSQL** stay on Railway/Supabase (shared by both deployments)
- **Vercel** frontend points to whichever API URL passes smoke tests

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
# Build and deploy in one command
gcloud builds submit --config=cloudbuild-api.yaml \
  --substitutions=_REGION=$REGION,_SERVICE_NAME=jak-swarm-api,_REPO_NAME=$REPO_NAME \
  --project=$PROJECT_ID
```

### Configure secrets and env vars after first deploy

After the first deploy succeeds, update the service with secrets:

```bash
gcloud run services update jak-swarm-api \
  --region=$REGION \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,\
AUTH_SECRET=AUTH_SECRET:latest,\
OPENAI_API_KEY=OPENAI_API_KEY:latest,\
REDIS_URL=REDIS_URL:latest,\
NEXT_PUBLIC_SUPABASE_URL=NEXT_PUBLIC_SUPABASE_URL:latest,\
NEXT_PUBLIC_SUPABASE_ANON_KEY=NEXT_PUBLIC_SUPABASE_ANON_KEY:latest,\
SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,\
EVIDENCE_SIGNING_SECRET=EVIDENCE_SIGNING_SECRET:latest,\
METRICS_TOKEN=METRICS_TOKEN:latest,\
CORS_ORIGINS=CORS_ORIGINS:latest" \
  --set-env-vars="NODE_ENV=production,PORT=4000,WORKFLOW_WORKER_MODE=embedded,\
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser,\
LLM_PROVIDER=gemini,JAK_ADK_MODE=1" \
  --project=$PROJECT_ID
```

> **Note**: Add `GEMINI_API_KEY=GEMINI_API_KEY:latest` to `--set-secrets` if you created that secret.

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

```bash
gcloud builds submit --config=cloudbuild-worker.yaml \
  --substitutions=_REGION=$REGION,_SERVICE_NAME=jak-swarm-worker,_REPO_NAME=$REPO_NAME \
  --project=$PROJECT_ID
```

### Configure secrets and env vars after first deploy

```bash
gcloud run services update jak-swarm-worker \
  --region=$REGION \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,\
AUTH_SECRET=AUTH_SECRET:latest,\
OPENAI_API_KEY=OPENAI_API_KEY:latest,\
REDIS_URL=REDIS_URL:latest,\
NEXT_PUBLIC_SUPABASE_URL=NEXT_PUBLIC_SUPABASE_URL:latest,\
SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,\
EVIDENCE_SIGNING_SECRET=EVIDENCE_SIGNING_SECRET:latest,\
METRICS_TOKEN=METRICS_TOKEN:latest" \
  --set-env-vars="NODE_ENV=production,PORT=9464,\
WORKFLOW_WORKER_MODE=standalone,REQUIRE_REDIS_IN_PROD=true,\
WORKER_METRICS_PORT=9464,LLM_PROVIDER=gemini,JAK_ADK_MODE=1" \
  --project=$PROJECT_ID
```

The Worker does NOT need `--allow-unauthenticated` — it only processes internal queue jobs.

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
curl -s "$API_URL/healthz" | jq .
# Expected: { "status": "alive", "uptime": ..., "shuttingDown": false }

curl -s "$API_URL/ready" | jq .
# Expected: { "status": "ready", "checks": { "db": "ok", "redis": "ok", ... } }

curl -s "$API_URL/version" | jq .
# Expected: { "version": "0.1.0-beta.0", "engine": "openai-first", ... }
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

## Step 8: Switch Traffic to Cloud Run

Only after all smoke tests pass:

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
# 1. Switch NEXT_PUBLIC_API_URL back to Railway
# In Vercel: NEXT_PUBLIC_API_URL = https://jak-swarm-api-production.up.railway.app
# Then: vercel --prod

# 2. (Optional) Scale down Cloud Run to save costs
gcloud run services update jak-swarm-api \
  --region=$REGION \
  --min-instances=0 \
  --project=$PROJECT_ID

gcloud run services update jak-swarm-worker \
  --region=$REGION \
  --min-instances=0 \
  --project=$PROJECT_ID

# 3. (Optional) Delete Cloud Run services entirely
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

- **Cloud Run pricing**: Pay per request and container runtime. With `min-instances=1` for API, expect ~$15-25/month for idle time alone.
- **API with min-instances=1**: ~$10-15/month (2 vCPU, 2Gi RAM, always-on)
- **Worker with min-instances=0**: ~$0-5/month (scales to zero, only runs during workflows)
- **Network egress**: Cloud Run → Railway Redis/Supabase traffic is billable
- **Secret Manager**: 6 free secrets, then $0.06/10,000 access operations

To minimize costs for the challenge demo:
- Set `--min-instances=0` for both services after the demo
- Use `--cpu=1 --memory=512Mi` for the worker
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