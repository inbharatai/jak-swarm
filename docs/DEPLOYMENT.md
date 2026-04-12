# JAK Swarm — Production Deployment Guide

## What the application provides (code-side)

| Capability | Endpoint / Module | Notes |
|---|---|---|
| Prometheus metrics | `GET /metrics` | prom-client, 15+ metric types |
| Liveness probe | `GET /healthz` | Process alive check, no dependencies |
| Readiness probe | `GET /ready` | DB + Redis connectivity, returns 503 during shutdown |
| Legacy health | `GET /health` | DB + Redis (kept for backward compat) |
| Request ID propagation | `X-Request-ID` header | Auto-generated, attached to all logs |
| Graceful shutdown | SIGTERM handler | Drains in-flight workflows up to 30s |
| Structured logging | Pino JSON | Request ID, tenant ID, workflow ID in all logs |
| Agent tracing | AgentTrace table | Input, output, tool calls, cost, duration per agent |
| Supervisor events | SupervisorBus | Workflow lifecycle events (in-process) |
| Circuit breakers | Per-agent role | Exponential backoff, auto-purge |
| Cost tracking | Per-LLM-call | Token count + USD cost per model |

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

#### Prometheus scrape config
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'jak-swarm-api'
    scrape_interval: 15s
    static_configs:
      - targets: ['jak-api:4000']
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
