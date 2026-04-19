# On-Call Runbook — JAK Swarm

One page. Each section matches an alert rule in `ops/prometheus/alerts.yml`.
Goal: know what to check first and what to do next.

Prereqs you should have open:
- Grafana dashboard (`ops/grafana/dashboards/jak-swarm.json`)
- Access to Postgres + Redis of the affected environment
- `kubectl` / container orchestrator CLI
- Log aggregator (Loki / Datadog / CloudWatch)

---

## worker-down

**Alert:** `WorkerDown` — no queue poll in 2+ min.

**Check first:**
1. Is the worker process alive? `kubectl get pods -l app=jak-worker`
2. `curl http://jak-worker:9464/healthz` — does it respond?
3. Tail logs — look for `[Worker] Poll failed` or uncaught exceptions
4. Check `jak_postgres_connectivity_status` — if 0, the worker is stuck on DB

**Most likely cause → action:**
- Pod OOMKilled → bump memory limit, check for a memory leak in the Generator
- DB connection pool exhausted → check `SELECT count(*) FROM pg_stat_activity`
- Event-loop blocked → scale horizontally while you investigate

**If you must recover immediately:** restart the worker pod. P1b reclaim will sweep its in-flight jobs within `WORKFLOW_QUEUE_LEASE_TTL_MS / 2` (default 30s) and another worker picks them up.

---

## no-active-workers

**Alert:** `NoActiveWorkers` — zero worker metric samples for 2 min.

**Check first:**
1. Are any worker pods running?
2. Is Prometheus scrape config pointed at the right target?
3. Is port `9464` (or `WORKER_METRICS_PORT`) actually open on the pod?

**Most likely cause → action:**
- Deployment removed workers by mistake → re-scale
- Service discovery broke (DNS-SRV or k8s selector) → fix the scrape config
- All workers crash-looping at startup → check `validateWorkerEnv` errors in logs; env probably missing `DATABASE_URL`

---

## heartbeat-failures

**Alert:** `HeartbeatFailuresSpike` — >0.2 failures/s for 10 min.

**Check first:**
1. `SELECT count(*) FROM pg_stat_activity WHERE state != 'idle'` — pool saturation?
2. Slow query log — is the heartbeat UPDATE itself stuck?
3. Is another process holding a long-running transaction that blocks the `workflow_jobs` table?

**Action:**
- If pool is saturated, restart API pods (they hold connection pools separately)
- If a long-running tx is blocking, `SELECT pid, now() - xact_start, query FROM pg_stat_activity WHERE state = 'active' ORDER BY xact_start` — find the culprit, `SELECT pg_cancel_backend(pid)` if safe
- Scale Postgres if genuinely under-provisioned

---

## queue-backlog-high

**Alert:** `QueueBacklogHigh` (>100 QUEUED for 5 min) or `QueueBacklogCritical` (>500).

**Check first:**
1. `jak_worker_running_jobs` per instance — are workers at `maxConcurrent`?
2. `rate(jak_workflow_jobs_completed_total[5m])` — are they finishing at the normal rate?
3. Dashboard: worker count × concurrency = throughput ceiling

**Action:**
- If workers are saturated and healthy: scale out (add more worker replicas)
- If workers are idle but queue grows: a row is stuck `ACTIVE` past lease — wait one lease cycle for reclaim or manually reset (see `ops/runbooks/stuck-job.md`, TBD)
- If rate drops to 0: jump to `no-completions`

---

## reclaim-storm

**Alert:** `ReclaimStormDetected` — >50 reclaims/min.

**Check first:**
1. `jak_worker_last_poll_timestamp_seconds` by instance — which instance(s) went silent?
2. That instance's logs for OOM or crash
3. Pod restart count for that deployment

**Action:**
- If one instance is crash-looping: find why (memory, panic, init error); fix and redeploy
- If reclaim is spreading to multiple instances: you have a genuine upstream outage (DB / Redis / LLM) — triage the dependency, not the workers

---

## dead-letter

**Alert:** `DeadLetterIncreasing` — jobs hit DEAD state.

**Check first:**
```sql
SELECT id, "workflowId", "lastError", attempts
FROM workflow_jobs
WHERE status = 'DEAD' AND "updatedAt" > NOW() - INTERVAL '1 hour'
ORDER BY "updatedAt" DESC
LIMIT 20;
```

**Action:**
- Group by `lastError` — is this one systemic bug or many?
- If systemic (e.g. "ENOTFOUND anthropic.com"): fix / work around, then retry affected workflows
- If one-off: decide manually whether to retry (`UPDATE workflow_jobs SET status = 'QUEUED', attempts = 0, "availableAt" = NOW() WHERE id = ...`)

---

## workflow-failure-spike

**Alert:** `WorkflowFailureRateSpike` — >20% of workflows failing.

**Check first:**
1. `jak_integration_provider_errors_total` — any provider (OpenAI / Anthropic / Serper) spiking?
2. Recent deploys (last 1h) — correlate
3. Group failures by `tenantId` — is it one tenant or all?

**Action:**
- If provider issue: check upstream status page; fallback provider chain should kick in automatically but verify
- If recent-deploy correlated: rollback the deploy
- If one tenant: possible config issue for that tenant (env vars, tool permissions)

---

## no-completions

**Alert:** `NoWorkflowsCompleted` — queue has work but zero completes in 15 min.

**Most severe variant.**

**Check first:**
1. Worker logs — are processors even being invoked? Look for `[QueueWorker] Job claimed`
2. `SELECT count(*), status FROM workflow_jobs GROUP BY status` — is ACTIVE pile big?
3. What's the age of the oldest `ACTIVE` row? `SELECT min("startedAt") FROM workflow_jobs WHERE status = 'ACTIVE'`

**Action:**
- If jobs are claimed but processor never returns: LLM provider chain may be blocked (check `rate(jak_integration_provider_errors_total[5m])`)
- If workers can't claim: DB deadlock → check for long-running transactions
- Worst-case: `UPDATE workflow_jobs SET status = 'QUEUED', availableAt = NOW() WHERE status = 'ACTIVE' AND "startedAt" < NOW() - INTERVAL '30 minutes'` to force-release stuck jobs (P1b should do this automatically but double-check)

---

## approval-backlog

**Alert:** `ApprovalBacklogGrowing` — >20 pending for 30 min.

**Action:**
- Notify approvers (Slack / email)
- Triage: are critical workflows in the queue? Prioritize those
- Consider auto-rejecting ancient items if policy allows

---

## build-check-failures

**Alert:** `BuildCheckFailureSpike` — Vibe Coder build-check errors rising.

**Check first:**
1. Which layer? `jak_vibe_coder_build_check_failures_total{layer="..."}` — heuristic / static / docker
2. Recent AppGenerator or AppArchitect prompt edits?
3. `node:20-slim` image updated? Docker checker layer could be breaking on a base-image change

**Action:**
- Roll back the prompt change if recent
- If docker layer: pin a specific node image digest, rebuild

---

## postgres-disconnected

**Alert:** `PostgresDisconnected` — `jak_postgres_connectivity_status == 0` for 1+ min.

**The dependency is down; the worker will auto-recover when connectivity returns.** P1b reclaim handles in-flight work.

**Check first:**
1. Is Postgres actually up? Your managed-DB provider's status page
2. `psql $DATABASE_URL -c "SELECT 1"` from the cluster network
3. Connection pool exhaustion? `SELECT count(*) FROM pg_stat_activity`

**Action:** fix the dependency, not JAK.

---

## redis-disconnected

**Alert:** `RedisDisconnected` — `jak_redis_connectivity_status == 0` for 2+ min.

**The dependency is down; workers fall back to in-memory coordination** (single-instance effective). Cross-instance pause/unpause + SSE relay + distributed locks degrade until recovery.

**Check first:**
1. Is Redis actually up? Provider status page
2. `redis-cli -u $REDIS_URL ping`
3. Network path between worker and Redis

**Action:** fix the dependency, not JAK.

---

## provider-errors

**Alert:** `ProviderErrorRateHigh`

**Action:**
- `jak_integration_provider_errors_total` by `provider` + `kind` → identifies which provider + which error class
- If `kind=rate_limit`: reduce concurrency or upgrade plan
- If `kind=auth`: rotate the API key (see `docs/credential-rotation-runbook.md`)
- If `kind=server` / `kind=unknown` on the primary: provider chain should route to fallback — verify by looking at `jak_routing_decisions_total` tier distribution

---

## General first-aid checklist

When something's on fire and you don't know what yet:

1. Open the Grafana dashboard — scan top-of-funnel (queue depth, active workers)
2. `kubectl get pods -A | grep jak` — everything running?
3. Check the last deploy — was it in the past 30 min?
4. Tail logs: `kubectl logs -f -l app=jak-worker --tail=200`
5. If users are waiting: scale out workers while you root-cause

**When in doubt, escalate.** P1b reclaim means worker death is recoverable — data-loss bugs are not. Err on the side of calling for help.
