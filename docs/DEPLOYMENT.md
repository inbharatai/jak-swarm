# JAK Swarm — Production Deployment Guide

## Active topology (Cloud Run primary + Railway fallback + Vercel + Supabase + Railway Redis)

The primary API deployment is Google Cloud Run (`jak-swarm-api` in `asia-south1`). Railway remains the rollback/fallback path for both API and worker. Vercel serves the frontend (currently still pointing to Railway until `NEXT_PUBLIC_API_URL` is switched). Supabase Postgres for pgvector-backed state, Railway-managed Redis for queue/signals/cache. See [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](DEPLOYMENT_GOOGLE_CLOUD_RUN.md) for Cloud Run setup and [`docs/railway-deployment.md`](railway-deployment.md) for the Railway runbook.

| Piece | Where | What runs |
|---|---|---|
| `apps/web` (Next.js landing + builder UI) | **Vercel** | Points at the API via `NEXT_PUBLIC_API_URL`. Supabase session cookies. |
| `apps/api` (Fastify HTTP + SSE + auth + enqueue) | **Railway** `jak-swarm-api` (public service) | `WORKFLOW_WORKER_MODE=standalone` — API DOES NOT run the queue worker |
| `apps/api/dist/worker-entry.js` (durable queue consumer) | **Railway** `jak-swarm-worker` (private/background service) | Owns all queue claims. Exposes `/metrics` + `/healthz` + `/ready` on :9464 |
| Postgres (+ pgvector) | **Supabase** | `DATABASE_URL` = pooler:6543, `DIRECT_URL` = direct:5432 (migrations only) |
| Redis | **Railway managed Redis** | `REDIS_URL=${{Redis.REDIS_URL}}` shared by API + worker over Railway private networking |
| Observability | **Railway logs/metrics + optional Sentry/OTel** | Adequate pre-launch; add Grafana Cloud only after real user load. |

**When to add a 3rd observability service** (Grafana Agent + Grafana Cloud): only after you have real user load (>50 paying users OR >500 workflows/day). Until then, Railway logs/metrics plus Sentry cover the critical failure modes.

**CORS alignment:** the API's `CORS_ORIGINS` must list your exact Vercel origins. For production beta use `https://jakswarm.com,https://www.jakswarm.com`. Parsing is comma-separated with trim per entry, so spaces after commas are accepted, but commas are still required.

**The whole migration runbook** (rotate credentials → provision worker → flip env → import dashboards → smoke test) is documented in [docs/founder-action-list.md](founder-action-list.md). Read it start-to-finish before touching any dashboard.

---

## Parallel deployment: Google Cloud Run

A parallel Cloud Run deployment exists for the Google AI Agents Challenge. Both Railway and Cloud Run can run simultaneously — traffic shifts via `NEXT_PUBLIC_API_URL` in Vercel. See [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](DEPLOYMENT_GOOGLE_CLOUD_RUN.md) for the full setup guide.

| Piece | Where | What runs |
|---|---|---|
| `apps/api` | **Cloud Run** `jak-swarm-api` (public) | 2 GiB RAM, 2 CPU, min 1 instance. Port 4000. |
| `apps/api/dist/worker-entry.js` | **Cloud Run** `jak-swarm-worker` (private) | **Not yet deployed.** See [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](DEPLOYMENT_GOOGLE_CLOUD_RUN.md) for setup instructions. Target: 1 GiB RAM, 1 CPU, min 0 (scales to zero). Port 9464. |
| Redis | **Railway** (shared) | Same Railway Redis instance used by both deployments |
| Postgres | **Supabase** (shared) | Same Supabase instance used by both deployments |
| Secrets | **Google Secret Manager** | All sensitive env vars mounted as secrets |

**Traffic switching**: Update `NEXT_PUBLIC_API_URL` in Vercel and redeploy. No code changes. Rollback is switching the URL back to Railway.

---

## Two deploy modes — which one you're on

JAK ships with ONE binary + TWO runtime roles. The env var `WORKFLOW_WORKER_MODE` picks which role(s) the API process plays. The worker binary (`apps/api/dist/worker-entry.js`) is always the standalone worker.

### Mode B — Two-service (production default)

`WORKFLOW_WORKER_MODE=standalone` on the API + separate worker service running `node apps/api/dist/worker-entry.js`. This is the Railway beta shape and the Cloud Run shape.

- API p95 latency stays flat regardless of queue depth.
- Worker scales horizontally without touching the API plan.
- Each worker exposes its own `/metrics` + `/healthz` + `/ready` on :9464.
- On Railway: internal DNS (`jak-swarm-api:4000`, `jak-swarm-worker:9464`).
- On Cloud Run: Cloud Run internal URLs + load balancer.

### Mode A — Single-service (development / staging only)

`WORKFLOW_WORKER_MODE=embedded`. One process does HTTP + queue. Legitimate for local dev, staging, or a genuinely tiny deploy. **Not what production runs.** Do not use Mode A on the same Railway project as Mode B — the API's embedded worker would race the standalone worker (safe under `FOR UPDATE SKIP LOCKED` but wasteful).

### The critical flip during migration

If you currently run Mode A and are moving to Mode B: **create the worker service first, watch it claim jobs, THEN flip `WORKFLOW_WORKER_MODE=standalone` on the API.** Doing the flip before the worker is live means the queue stops draining. Order is enforced in the founder-action-list checklist.

---

## Topology diagram — two-service mode

When deployed as two services, the graph is:

```
            ┌────────────┐       ┌─────────────┐
   HTTPS →  │  jak-api   │──────▶│  Postgres   │
            │  (Fastify) │   ┌──▶│ (pgvector)  │
            └─────┬──────┘   │   └─────────────┘
                  │          │
                  │ enqueue  │
                  ▼          │
            ┌────────────┐   │   ┌─────────────┐
            │ workflow_  │   │   │   Redis     │
            │   jobs     │   │   │ (locks +    │
            └─────┬──────┘   │   │  SSE relay  │
                  │          │   │  + signals) │
                  │ claim    │   └──────┬──────┘
                  ▼          │          │
            ┌────────────┐   │          │
            │ jak-worker │───┴──────────┘
            │ (1..N pods)│
            │ :9464/metrics
            └─────┬──────┘
                  │
                  ▼
            ┌────────────┐        ┌──────────┐
            │ Prometheus │◀───────│  Sentry  │
            │ /metrics   │        │  (opt)   │
            └────────────┘        └──────────┘
```

Reference implementation: `docker-compose.prod.yml` at repo root shows the
full topology locally. Use it as a template for Railway, Cloud Run, Kubernetes, or
Fly.io deployments.

## What the application provides (code-side)

| Capability | Endpoint / Module | Notes |
|---|---|---|
| API Prometheus metrics | `GET /metrics` on API (:4000) | prom-client, 20+ custom metric types (workflow, agent, tool, LLM cost, queue, worker, signal, SSE, Vibe Coder, provider) |
| Worker Prometheus metrics | `GET /metrics` on Worker (:9464) | Same registry; each worker exposes per-instance gauges |
| Liveness probe | `GET /healthz` on API AND Worker | Process alive check, no dependencies |
| Readiness probe | `GET /ready` on API AND Worker | DB + Redis connectivity, returns 503 during shutdown |
| Legacy health | `GET /health` on API | DB + Redis (kept for backward compat) |
| Request ID propagation | `X-Request-ID` header | Auto-generated, attached to all logs |
| Graceful shutdown | SIGTERM handler on both processes | API drains in-flight; worker drains queue, in-flight lease → another worker reclaims |
| Structured logging | Pino JSON | Request ID, tenant ID, workflow ID, instanceId in all logs |
| Agent tracing | AgentTrace table | Input, output, tool calls, cost, duration per agent |
| Supervisor events | SupervisorBus | Workflow lifecycle events |
| Circuit breakers | Per-agent role | Exponential backoff, auto-purge |
| Cost tracking | Per-LLM-call | Token count + USD cost per model |
| P1b worker-lease reclaim | `workflow_jobs.leaseExpiresAt` | Dead worker's jobs are reclaimed in lease_ttl / 2 |

## Worker-specific environment

| Var | Default | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL` | — | **yes** | Postgres; worker refuses to start without it in production |
| `REDIS_URL` | — | recommended | Without it: no cross-instance signals, no SSE relay, no distributed locks |
| `WORKFLOW_WORKER_INSTANCE_ID` | `${HOSTNAME}` or random | recommended | Stable identity so reclaim logs correlate with dead workers. **Set to pod name in k8s.** |
| `WORKFLOW_QUEUE_CONCURRENCY` | 2 | | Max in-flight jobs per worker instance |
| `WORKFLOW_QUEUE_POLL_INTERVAL_MS` | 1000 | | How often the worker polls for new jobs |
| `WORKFLOW_QUEUE_LEASE_TTL_MS` | 60000 | | How long a claim lasts before reclaim-eligible. Worker heartbeats at TTL/2. |
| `WORKER_METRICS_PORT` | 9464 | | Port for `/metrics` + `/healthz` + `/ready` |
| `LOG_LEVEL` | info | | |

Worker start command: `pnpm --filter @jak-swarm/api worker` (dev) or `node apps/api/dist/worker-entry.js` (prod).

---

## Railway Redis wiring (active)

JAK's Redis client ([apps/api/src/plugins/redis.plugin.ts:128](../apps/api/src/plugins/redis.plugin.ts), [apps/api/src/worker-entry.ts:90](../apps/api/src/worker-entry.ts)) is ioredis. In the active Railway topology, both API and worker should consume Railway's managed Redis URL via service reference.

```
${{Redis.REDIS_URL}}
```

- Set the **identical** `REDIS_URL` expression on both `jak-swarm-api` and `jak-swarm-worker` (same Railway Redis service — they coordinate through it).
- `REQUIRE_REDIS_IN_PROD=true` on both services. Without this, a missing `REDIS_URL` silently degrades to in-memory coordination which breaks cross-instance signals and SSE fan-out ([apps/api/src/config.ts:72](../apps/api/src/config.ts)).
- If you intentionally use an external Redis provider, keep the same URL on API and worker and prefer TLS endpoints (`rediss://`) where supported.
- On Cloud Run, `REDIS_URL` points to the same Railway Redis instance over the public internet (TLS required).

## CORS_ORIGINS gotcha

`CORS_ORIGINS` is parsed as a comma-separated list and each entry is trimmed. Both `https://jakswarm.com,https://www.jakswarm.com` and `https://jakswarm.com, https://www.jakswarm.com` are valid. A space-separated value without commas (for example `https://jakswarm.com https://www.jakswarm.com`) is invalid and will fail origin matching.

---

## External Infrastructure Required

### Required for Staging

| Service | Purpose | Minimum Setup |
|---|---|---|
| **PostgreSQL 15+** | Primary database | Single instance, 2GB RAM, with pgvector extension |
| **Redis 7+** | Session cache, voice sessions, rate limiting | Single instance, 512MB |
| **Node.js 20+** | API runtime | Single process, 1GB RAM |

```bash
# Docker Compose for staging
docker compose -f docker-compose.staging.yml up -d
```

### Required for Production

| Service | Purpose | Recommended Setup |
|---|---|---|
| **PostgreSQL 15+ with pgvector** | Primary DB + vector search | Managed (RDS/Supabase/Neon), read replica |
| **Redis 7+** | Cache + rate limiting | Managed (Railway Redis / ElastiCache), 1GB |
| **Prometheus** | Metrics collection | Scrapes `/metrics` every 15s |
| **Grafana** | Dashboards + alerting | Connect to Prometheus data source |

#### Prometheus scrape + alert config

A production-ready scrape config + full alert ruleset lives at:
- `ops/prometheus/prometheus.yml` — scrape jobs for API + every worker instance
- `ops/prometheus/alerts.yml` — 13 operator-grade alert rules (WorkerDown, QueueBacklogHigh, ReclaimStormDetected, HeartbeatFailuresSpike, DeadLetterIncreasing, WorkflowFailureRateSpike, NoWorkflowsCompleted, BuildCheckFailureSpike, Postgres/RedisDisconnected, ApprovalBacklogGrowing, ProviderErrorRateHigh, NoActiveWorkers)
- `ops/runbooks/on-call.md` — per-alert response playbook
- `ops/grafana/dashboards/jak-swarm.json` — operator dashboard scaffold (queue depth, worker health, throughput, Vibe Coder runs, LLM cost, provider errors)

Minimum scrape config:
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'jak-api'
    scrape_interval: 15s
    static_configs:
      - targets: ['jak-api:4000']
    metrics_path: /metrics

  - job_name: 'jak-worker'
    scrape_interval: 15s
    static_configs:
      - targets: ['jak-worker:9464']  # or k8s SD — see ops/prometheus/prometheus.yml
    metrics_path: /metrics
```

#### Key Grafana dashboards to create

**Workflow Operations**
- `jak_workflows_total` by status (rate)
- `jak_workflow_duration_seconds` (p50, p95, p99)
- `jak_active_workflows` (gauge)

**Agent Performance**
- `jak_agent_executions_total` by role (rate)
- `jak_agent_duration_seconds` by role (histogram)
- `jak_tool_invocations_total` by tool (rate)

**Cost Tracking**
- `jak_llm_cost_usd_total` by model (rate)
- `jak_llm_tokens_total` by model + direction

**Infrastructure**
- `jak_http_request_duration_seconds` by route (p95)
- `jak_health_check_duration_seconds` by dependency
- `jak_circuit_breaker_state` by breaker

#### Alerting rules
```yaml
# alerts.yml
groups:
  - name: jak-swarm
    rules:
      - alert: HighWorkflowFailureRate
        expr: rate(jak_workflows_total{status="FAILED"}[5m]) > 0.1
        for: 5m
        labels: { severity: warning }

      - alert: CircuitBreakerOpen
        expr: jak_circuit_breaker_state > 0
        for: 1m
        labels: { severity: critical }

      - alert: HighLLMCost
        expr: rate(jak_llm_cost_usd_total[1h]) > 10
        for: 15m
        labels: { severity: warning }

      - alert: APILatencyHigh
        expr: histogram_quantile(0.95, rate(jak_http_request_duration_seconds_bucket[5m])) > 5
        for: 5m
        labels: { severity: warning }
```

### Optional but Recommended

| Service | Purpose | When to Add |
|---|---|---|
| **Jaeger / Grafana Tempo** | Distributed tracing | When debugging cross-service issues |
| **Sentry** | Error tracking with stack traces | When you need proactive error alerts |
| **NATS / Redis Streams** | Distributed SupervisorBus | When scaling to 2+ API instances |

### Enterprise-Grade Upgrades

| Service | Purpose | When to Add |
|---|---|---|
| **Kubernetes** | Auto-scaling, rolling deploys, resource limits | 3+ instances, tenant isolation |
| **Temporal** | Durable workflow execution | Mission-critical workflows that can't be lost |
| **DataDog / New Relic** | Full APM with code-level profiling | Large team, SLA requirements |
| **Vault / AWS Secrets Manager** | Secrets rotation | SOC2 / compliance requirements |

---

## Kubernetes Deployment (Not Yet Deployed)

> **Note:** JAK Swarm is not currently deployed on Kubernetes/GKE. The section below is a reference architecture for future scaling. Do not claim Kubernetes deployment is live. See [`docs/EVOLUTION-PLAN.md`](EVOLUTION-PLAN.md) for deployment truth.

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jak-swarm-api
spec:
  replicas: 2
  template:
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: api
          image: jak-swarm-api:latest
          ports:
            - containerPort: 4000
          env:
            - name: NODE_ENV
              value: production
          livenessProbe:
            httpGet:
              path: /healthz
              port: 4000
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /ready
              port: 4000
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "2Gi"
              cpu: "1000m"
```

### Multi-instance limitation

The SupervisorBus is currently in-process (Node EventEmitter). For multi-instance deployments:

1. **Workflow state** is already in PostgreSQL — no data loss on failover
2. **Supervisor events** are local-only — instances don't see each other's events
3. **Circuit breakers** are in-memory — each instance tracks failures independently

**Mitigation**: For 2-3 instances, this is acceptable. PostgreSQL-backed state ensures no workflow loss. For 5+ instances, implement Redis pub/sub transport for SupervisorBus.

---

## Environment Variables

### Required
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | JWT signing secret (strong random, 32+ chars) |
| `OPENAI_API_KEY` | Primary LLM provider |

### Required for the Audit & Compliance Agent Pack
| Variable | Description |
|---|---|
| `EVIDENCE_SIGNING_SECRET` | 32+ byte HMAC-SHA256 secret for final-pack + evidence-bundle signing. Generate with `openssl rand -base64 48`. Without it, `POST /audit/runs/:id/final-pack` and `POST /bundles` return `503 BUNDLE_SIGNING_UNAVAILABLE`. **Rotate independently of `AUTH_SECRET`** — they intentionally do not share key material. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL — required by `ArtifactService` for storing workpaper PDF / bundle bytes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key — used by `ArtifactService` to upload to the `tenant-artifacts` bucket |

After the first deploy with these set, run:
```bash
pnpm db:migrate:deploy             # applies migration 15_audit_runs (additive)
pnpm seed:compliance               # seeds 182 controls (idempotent; 108 auto-mapped + 74 reviewer attest)
```

### Optional (enable features when set)
| Variable | Feature |
|---|---|
| `JAK_SHIELD_MCP_URL` | JAK Shield MCP gateway URL (when set, routes high-risk actions through the 10-stage security pipeline). Defaults to local-only policy enforcement if unset. |
| `JAK_SHIELD_MCP_ENABLED` | Set to `1` to enable JAK Shield MCP integration for signed security decisions. Defaults to `0` (local policy enforcement only). |
| `JAK_SHIELD_MCP_API_KEY` | API key for JAK Shield MCP gateway (required if `JAK_SHIELD_MCP_ENABLED=1`). |
| `REDIS_URL` | Session cache, rate limiting, voice |
| `GEMINI_API_KEY` | Gemini LLM provider (required when `LLM_PROVIDER=gemini`) |
| `LLM_PROVIDER` | `openai`, `gemini`, or `existing` (default) |
| `JAK_ADK_MODE` | Set to `1` to enable Google ADK pipeline |
| `HUBSPOT_API_KEY` | CRM integration |
| `GITHUB_PAT` | Repo creation, PR review, code push |
| `VERCEL_TOKEN` | App deployment |
| `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD` | Real email/calendar |
| `TWITTER_API_KEY` + related | Social posting |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry trace export |
| `METRICS_ENABLED` | Prometheus metrics (default: true) |
| `CORS_ORIGINS` | Comma-separated allowed origins |

---

## Cost Awareness

| Component | Free Tier | Production Cost |
|---|---|---|
| PostgreSQL (Supabase) | 500MB | ~$25/mo (Pro) |
| PostgreSQL (Neon) | 500MB | ~$19/mo |
| Redis (Railway managed) | Varies by plan | ~$5-10/mo |
| Cloud Run API (min 1 instance) | — | ~$10-15/mo |
| Cloud Run Worker (min 0 instances) | — | ~$0-5/mo |
| Prometheus + Grafana (Cloud) | 10K metrics | ~$0 (free tier) |
| Sentry | 5K events/mo | ~$0 (free tier) |
| Total staging | — | ~$0-25/mo |
| Total production | — | ~$50-100/mo |