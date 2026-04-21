# JAK Swarm Grafana Pack

This directory contains everything an operator needs to get a JAK Swarm deployment into Grafana Cloud (or self-hosted Grafana + Prometheus).

**What's here:**

- `dashboards/jak-swarm-tenant-health.json` — the main operator dashboard. Active workflows, approvals backlog, tool failure rate, circuit breaker states, workflow latency percentiles, queue lag, realtime success rate, auto-vs-human approval ratio.
- `alerts/jak-swarm-alerts.yaml` — five minimum-viable alert rules (see inline comments).

**What's NOT here** (yet):

- Log pipeline (`pino` → Loki). Planned for a follow-up; until then the API log stream is readable via `render logs` or `docker compose logs`.
- Tenant-level cost dashboards. Planned alongside per-utterance voice cost tracking in a future phase.

## Prerequisites

- A Grafana Cloud account (free tier is enough to start — 10k series + 50GB logs).
- A Prometheus scrape target pointing at `https://jak-swarm-api.onrender.com/metrics` (or your own API URL). The metrics endpoint is already exposed by the `prom-client` wiring in `apps/api/src/observability/metrics.ts`.
- A Grafana API key with `Editor` scope.

## Step 1 — import the dashboard

From Grafana Cloud UI:

1. **Dashboards → New → Import**.
2. Upload `dashboards/jak-swarm-tenant-health.json`.
3. Select your Prometheus data source when prompted.
4. Save.

Or via the Grafana API:

```bash
curl -X POST https://<org>.grafana.net/api/dashboards/db \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d @dashboards/jak-swarm-tenant-health.json
```

## Step 2 — import the alert rules

```bash
grafana-cli --config ops/grafana/alerts/jak-swarm-alerts.yaml alerts provision
```

Or paste the YAML into Grafana Cloud → Alerting → Alert rules → Import.

Configure your contact point (Slack webhook, PagerDuty service key, email) once; the rules reference severity labels that your notification policy routes on.

## Step 3 — verify metrics are landing

After the API has been running for a few minutes, hit:

```
https://<org>.grafana.net/explore
```

Query:

```
sum(rate(jak_workflow_started_total[5m]))
```

You should see a non-empty series per tenant. If empty, check:

- `apps/api/src/observability/metrics.ts` is being imported at boot (grep `registerMetrics` in `apps/api/src/index.ts`).
- Prometheus is scraping `/metrics` (not `/api/metrics`).
- The tenant has actually started at least one workflow.

## Step 4 — Sentry (parallel observability surface)

For runtime exception capture, set `SENTRY_DSN` in Render env and the API will emit uncaught errors + approval / breaker / realtime events to Sentry automatically. Zero-config when DSN is unset (silent no-op, no overhead). PII scrubbing is on by default; see `apps/api/src/observability/sentry.ts`.

## Customisation

- Add panels to the dashboard by editing the JSON and re-importing.
- Tighten alert thresholds (`for: 2m` → `for: 5m`) if you find pages too noisy.
- The tenant-id template variable lets you scope the whole dashboard to one tenant; use this for customer-support calls.

## What "production-ready observability" actually means here

The definition the Phase 6 hardening plan targets:

1. Uncaught errors go to Sentry with PII scrubbed.
2. Operator can see at-a-glance on one dashboard: are workflows running, are they fast, are approvals stuck, are tools failing, are circuits open.
3. Five named alert conditions fire before the user-facing signal would.
4. Every claim on the landing page that implies observability has a corresponding wire in this directory.

If you add a new landing-page claim about observability, add the matching panel or alert here first.
