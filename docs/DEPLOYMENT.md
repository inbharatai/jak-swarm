# JAK Swarm — Production Deployment Guide

## Topology at a glance (Vercel + Render-split + Supabase + Upstash)

This is the exact topology the committed `render.yaml` ships. Every env var, healthcheck, and dashboard step below targets this stack — not a generic "cloud" deploy.

| Piece | Where | What runs |
|---|---|---|
| `apps/web` (Next.js landing + builder UI) | **Vercel** | Points at the Render API via `NEXT_PUBLIC_API_URL`. Supabase session cookies. |
| `apps/api` (Fastify HTTP + SSE + auth + enqueue) | **Render** `jak-swarm-api` (web service, public) | `WORKFLOW_WORKER_MODE=standalone` — API DOES NOT run the queue worker |
| `apps/api/dist/worker-entry.js` (durable queue consumer) | **Render** `jak-swarm-worker` (pserv, private) | Owns all queue claims. Exposes `/metrics` + `/healthz` + `/ready` on :9464 |
| Postgres (+ pgvector) | **Supabase** | `DATABASE_URL` = pooler:6543, `DIRECT_URL` = direct:5432 (migrations only) |
| Redis | **Upstash** | `rediss://default:PASS@host.upstash.io:6379` — ioredis handles TLS transparently |
| Observability | **Render dashboard (built-in)** | Log streaming + service-down email alerts. Adequate pre-launch. |

**When to add a 3rd observability service** (Grafana Agent + Grafana Cloud): only after you have real user load (>50 paying users OR >500 workflows/day). Until then, Render's built-in logs + alerts cover the critical failure modes. All config needed to resurrect the observability stack later is committed at `ops/grafana-agent/*` and in `render.yaml` (commented out) — one-liner to re-enable.

**CORS alignment:** the API's `CORS_ORIGINS` must list your exact Vercel origins. `render.yaml` ships with `https://jakswarm.com,https://www.jakswarm.com`. The split is raw comma — NO spaces after commas ([apps/api/src/config.ts:92](apps/api/src/config.ts:92) splits without trimming).

**The whole migration runbook** (rotate credentials → provision worker → flip env → import dashboards → smoke test) is documented in [docs/founder-action-list.md](founder-action-list.md). Read it start-to-finish before touching any dashboard.

---

## Two deploy modes — which one you're on

JAK ships with ONE binary + TWO runtime roles. The env var `WORKFLOW_WORKER_MODE` picks which role(s) the API process plays. The worker binary (`apps/api/dist/worker-entry.js`) is always the standalone worker.

### Mode B — Two-service (production default, `render.yaml`)

`WORKFLOW_WORKER_MODE=standalone` on the API + separate `jak-swarm-worker` pserv running `node apps/api/dist/worker-entry.js`. This is what the committed `render.yaml` applies.

- API p95 latency stays flat regardless of queue depth.
- Worker scales horizontally without touching the API plan.
- Each worker exposes its own `/metrics` + `/healthz` + `/ready` on :9464.
- Grafana Agent scrapes both by internal DNS (`jak-swarm-api:4000`, `jak-swarm-worker:9464`).

### Mode A — Single-service (development / staging only)

`WORKFLOW_WORKER_MODE=embedded`. One process does HTTP + queue. Legitimate for local dev, staging, or a genuinely tiny deploy. **Not what production runs.** Do not use Mode A on the same Render project as Mode B — the API's embedded worker would race the standalone worker (safe under `FOR UPDATE SKIP LOCKED` but wasteful).

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
            │ Prometheus │◀───────│ Grafana  │
            │ /metrics   │        │ dashbrd  │
            └─────┬──────┘        └──────────┘
                  │
                  ▼
            ┌────────────┐
            │Alertmanager│
            └────────────┘
```

Reference implementation: `docker-compose.prod.yml` at repo root shows the
full topology locally. Use it as a template for Kubernetes / ECS / Render /
Fly.io deployments.

## What the application provides (code-side)

| Capability | Endpoint / Module | Notes |
|---|---|---|
| API Prometheus metrics | `GET /metrics` on API (:4000) | prom-client, 35+ metric types (workflow, agent, tool, LLM cost, queue, worker, signal, SSE, Vibe Coder, provider) |
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

Worker start command: `pnpm --filter @jak-swarm/api worker` (dev) or `node apps/api/dist/worker-entry.js` (prod — this is the exact command `render.yaml` sets for `jak-swarm-worker`).

---

## Upstash Redis wiring (exactly)

JAK's Redis client ([apps/api/src/plugins/redis.plugin.ts:128](../apps/api/src/plugins/redis.plugin.ts), [apps/api/src/worker-entry.ts:90](../apps/api/src/worker-entry.ts)) is ioredis, which auto-detects `rediss://` (double `s`) and enables TLS + SNI with no extra config. Use the Redis-protocol endpoint from the Upstash UI — NOT the REST URL.

```
rediss://default:<PASSWORD>@<db-name>.upstash.io:6379
```

- Set the **identical** `REDIS_URL` on both `jak-swarm-api` and `jak-swarm-worker` (same Upstash DB — they coordinate through it).
- `REQUIRE_REDIS_IN_PROD=true` on both services. Without this, a missing `REDIS_URL` silently degrades to in-memory coordination which breaks cross-instance signals and SSE fan-out ([apps/api/src/config.ts:72](../apps/api/src/config.ts)).
- Free-tier Upstash limits: 10k commands/day and (tier-dependent) 1 concurrent connection. ioredis reuses one connection per process, so API+Worker = 2 concurrent connections. Paid tier if you exceed.

## Render healthcheck gotcha

The worker pserv's `/healthz` is on **port 9464**, not the default `PORT`. In the Render dashboard, when you create `jak-swarm-worker`, you MUST explicitly set "Health Check Port: 9464". If you leave it blank, Render tries `PORT` (unset on worker) and enters a restart loop that looks like a build failure. `render.yaml` can't express this yet — it's a dashboard-only field — so verify in the UI after `render blueprint apply`.

## CORS_ORIGINS gotcha

`CORS_ORIGINS` splits on raw `,` without trimming. If you paste `https://jakswarm.com, https://www.jakswarm.com` with a space, the second origin becomes ` https://www.jakswarm.com` (leading space) which never matches — every www request gets rejected. Comma only, no space.

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
| **Redis 7+** | Cache + rate limiting | Managed (ElastiCache/Upstash), 1GB |
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

## Kubernetes Deployment

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

### Optional (enable features when set)
| Variable | Feature |
|---|---|
| `REDIS_URL` | Session cache, rate limiting, voice |
| `ANTHROPIC_API_KEY` | Claude models |
| `HUBSPOT_API_KEY` | CRM integration |
| `GITHUB_PAT` | Repo creation, PR review, code push |
| `VERCEL_TOKEN` | App deployment |
| `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD` | Real email/calendar |
| `TWITTER_API_KEY` + related | Social posting |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry trace export |
| `METRICS_ENABLED` | Prometheus metrics (default: true) |

---

## Cost Awareness

| Component | Free Tier | Production Cost |
|---|---|---|
| PostgreSQL (Supabase) | 500MB | ~$25/mo (Pro) |
| PostgreSQL (Neon) | 500MB | ~$19/mo |
| Redis (Upstash) | 10K commands/day | ~$10/mo |
| Prometheus + Grafana (Cloud) | 10K metrics | ~$0 (free tier) |
| Sentry | 5K events/mo | ~$0 (free tier) |
| Total staging | — | ~$0-25/mo |
| Total production | — | ~$50-100/mo |
