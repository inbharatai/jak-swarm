/**
 * Prometheus metrics for JAK Swarm.
 *
 * Exposes operational metrics via /metrics endpoint.
 * Covers: workflows, agents, tools, circuit breakers, LLM cost, approvals.
 *
 * Usage:
 *   import { metrics } from './observability/metrics.js';
 *   metrics.workflowsTotal.inc({ status: 'completed', tenantId });
 */

import client from 'prom-client';

// Guard against duplicate registration when this module is evaluated more
// than once in the same process (vitest's single-fork mode re-transpiles
// the same file under slightly different module specifiers, which causes
// prom-client's "name has already been registered" throws).
//
// Strategy: if ANY jak_* metric is already registered in the default
// registry, clear it and rebuild from scratch. In production the module
// is only ever evaluated once, so this branch is a no-op. In tests, it
// gives us a clean slate per test file.
const INIT_SENTINEL = 'jak_workflows_total';
if (client.register.getSingleMetric(INIT_SENTINEL)) {
  client.register.clear();
}

// Collect default Node.js metrics (GC, event loop, heap, etc.)
client.collectDefaultMetrics({ prefix: 'jak_' });

// ─── Workflow Metrics ───────────────────────────────────────────────────────

export const workflowsTotal = new client.Counter({
  name: 'jak_workflows_total',
  help: 'Total workflows by status',
  labelNames: ['status', 'tenant_id'] as const,
});

export const workflowDuration = new client.Histogram({
  name: 'jak_workflow_duration_seconds',
  help: 'Workflow execution duration in seconds',
  labelNames: ['status', 'tenant_id'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
});

export const activeWorkflows = new client.Gauge({
  name: 'jak_active_workflows',
  help: 'Currently running workflows',
  labelNames: ['tenant_id'] as const,
});

// ─── Agent Metrics ──────────────────────────────────────────────────────────

export const agentExecutions = new client.Counter({
  name: 'jak_agent_executions_total',
  help: 'Total agent executions by role and status',
  labelNames: ['agent_role', 'status'] as const,
});

export const agentDuration = new client.Histogram({
  name: 'jak_agent_duration_seconds',
  help: 'Agent execution duration in seconds',
  labelNames: ['agent_role'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
});

// ─── Tool Metrics ───────────────────────────────────────────────────────────

export const toolInvocations = new client.Counter({
  name: 'jak_tool_invocations_total',
  help: 'Total tool invocations by tool name and status',
  labelNames: ['tool_name', 'status'] as const,
});

export const toolDuration = new client.Histogram({
  name: 'jak_tool_duration_seconds',
  help: 'Tool execution duration in seconds',
  labelNames: ['tool_name'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30],
});

// ─── LLM Cost Metrics ──────────────────────────────────────────────────────

export const llmTokensTotal = new client.Counter({
  name: 'jak_llm_tokens_total',
  help: 'Total LLM tokens consumed',
  labelNames: ['model', 'direction'] as const, // direction: prompt | completion
});

export const llmCostTotal = new client.Counter({
  name: 'jak_llm_cost_usd_total',
  help: 'Total LLM cost in USD',
  labelNames: ['model', 'tenant_id'] as const,
});

// ─── Circuit Breaker Metrics ────────────────────────────────────────────────

export const circuitBreakerState = new client.Gauge({
  name: 'jak_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['breaker_name'] as const,
});

export const circuitBreakerTrips = new client.Counter({
  name: 'jak_circuit_breaker_trips_total',
  help: 'Total times a circuit breaker has tripped open',
  labelNames: ['breaker_name'] as const,
});

// ─── Approval Metrics ───────────────────────────────────────────────────────

export const approvalRequests = new client.Counter({
  name: 'jak_approval_requests_total',
  help: 'Approval requests by decision',
  labelNames: ['decision'] as const, // pending | approved | rejected
});

// ─── HTTP Request Metrics ───────────────────────────────────────────────────

export const httpRequestDuration = new client.Histogram({
  name: 'jak_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// ─── Health Metrics ─────────────────────────────────────────────────────────

export const healthCheckDuration = new client.Histogram({
  name: 'jak_health_check_duration_seconds',
  help: 'Health check probe duration by dependency',
  labelNames: ['dependency'] as const, // db | redis
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

// ─── Queue + Worker Metrics (operator-critical) ────────────────────────────
// These describe the health of the durable workflow queue + the worker
// instances consuming it. Scraped from the worker process (each worker
// instance exposes /metrics on WORKER_METRICS_PORT, default 9464).

export const workflowJobsQueued = new client.Gauge({
  name: 'jak_workflow_jobs_queued',
  help: 'Number of workflow_jobs rows in QUEUED state (queue backlog)',
});

export const workflowJobsActive = new client.Gauge({
  name: 'jak_workflow_jobs_active',
  help: 'Number of workflow_jobs rows in ACTIVE state (being processed)',
});

export const workflowJobsCompletedTotal = new client.Counter({
  name: 'jak_workflow_jobs_completed_total',
  help: 'Total workflow jobs that finished COMPLETED',
});

export const workflowJobsFailedTotal = new client.Counter({
  name: 'jak_workflow_jobs_failed_total',
  help: 'Total workflow jobs that finished FAILED (may still retry)',
});

export const workflowJobsDeadTotal = new client.Counter({
  name: 'jak_workflow_jobs_dead_total',
  help: 'Total workflow jobs moved to DEAD after exhausting retries',
});

export const workflowJobsReclaimedTotal = new client.Counter({
  name: 'jak_workflow_jobs_reclaimed_total',
  help: 'Total workflow jobs reclaimed from dead workers via the P1b lease sweep',
  labelNames: ['reclaimer_instance'] as const,
});

export const workflowJobsClaimedTotal = new client.Counter({
  name: 'jak_workflow_jobs_claimed_total',
  help: 'Total workflow jobs claimed by any worker instance',
  labelNames: ['instance_id'] as const,
});

export const workerRunningJobs = new client.Gauge({
  name: 'jak_worker_running_jobs',
  help: 'Number of jobs this worker instance currently holds in memory',
  labelNames: ['instance_id'] as const,
});

export const workerHeartbeatFailuresTotal = new client.Counter({
  name: 'jak_worker_heartbeat_failures_total',
  help: 'Heartbeat writes that failed (worker cannot extend its lease)',
  labelNames: ['instance_id'] as const,
});

export const workerLastPollTimestamp = new client.Gauge({
  name: 'jak_worker_last_poll_timestamp_seconds',
  help: 'Unix timestamp of the last queue poll (gauge freshness — if stale, worker is stuck)',
  labelNames: ['instance_id'] as const,
});

// ─── Signal Bus Metrics ────────────────────────────────────────────────────

export const workflowSignalTotal = new client.Counter({
  name: 'jak_workflow_signal_total',
  help: 'Workflow control signals received (pause / unpause / stop / resume)',
  labelNames: ['signal_type'] as const,
});

// ─── SSE / Stream Metrics ──────────────────────────────────────────────────

export const sseConnectionsActive = new client.Gauge({
  name: 'jak_sse_connections_active',
  help: 'Active Server-Sent-Events stream connections (workflow + project traces)',
  labelNames: ['stream_kind'] as const, // 'workflow' | 'project'
});

// ─── Vibe Coder Metrics ────────────────────────────────────────────────────

export const vibeCoderRunsTotal = new client.Counter({
  name: 'jak_vibe_coder_runs_total',
  help: 'Vibe Coder workflow runs by final status',
  labelNames: ['status'] as const, // 'completed' | 'failed' | 'needs_user_input'
});

export const vibeCoderDebugRetriesTotal = new client.Counter({
  name: 'jak_vibe_coder_debug_retries_total',
  help: 'Debugger loop iterations across Vibe Coder runs',
});

export const vibeCoderBuildCheckFailuresTotal = new client.Counter({
  name: 'jak_vibe_coder_build_check_failures_total',
  help: 'Build-check failures across the 3 layers (heuristic / static / docker)',
  labelNames: ['layer'] as const, // 'heuristic' | 'static' | 'docker'
});

// ─── Integration Provider Error Counter ───────────────────────────────────

export const integrationProviderErrorsTotal = new client.Counter({
  name: 'jak_integration_provider_errors_total',
  help: 'External provider errors by kind (rate_limit, timeout, auth, server, unknown)',
  labelNames: ['provider', 'kind'] as const,
});

// ─── Connectivity Gauges (scraped on /metrics request) ─────────────────────

export const redisConnectivityStatus = new client.Gauge({
  name: 'jak_redis_connectivity_status',
  help: 'Redis connectivity: 1=connected, 0=disconnected',
});

export const postgresConnectivityStatus = new client.Gauge({
  name: 'jak_postgres_connectivity_status',
  help: 'Postgres connectivity: 1=connected, 0=disconnected',
});

// ─── Routing & Billing Metrics ───────────────────────────────────────────────

export const routingDecisions = new client.Counter({
  name: 'jak_routing_decisions_total',
  help: 'Model routing decisions by task type, model, and tier',
  labelNames: ['task_type', 'model', 'tier'] as const,
});

export const creditReservations = new client.Counter({
  name: 'jak_credit_reservations_total',
  help: 'Credit reservations by result (allowed/denied)',
  labelNames: ['result', 'reason'] as const,
});

export const creditReconciliations = new client.Counter({
  name: 'jak_credit_reconciliations_total',
  help: 'Credit reconciliations after execution',
  labelNames: ['status'] as const,
});

// ─── Export ─────────────────────────────────────────────────────────────────

export const metricsRegistry = client.register;

export const metrics = {
  workflowsTotal,
  workflowDuration,
  activeWorkflows,
  agentExecutions,
  agentDuration,
  toolInvocations,
  toolDuration,
  llmTokensTotal,
  llmCostTotal,
  circuitBreakerState,
  circuitBreakerTrips,
  approvalRequests,
  httpRequestDuration,
  healthCheckDuration,
  // Queue + worker
  workflowJobsQueued,
  workflowJobsActive,
  workflowJobsCompletedTotal,
  workflowJobsFailedTotal,
  workflowJobsDeadTotal,
  workflowJobsReclaimedTotal,
  workflowJobsClaimedTotal,
  workerRunningJobs,
  workerHeartbeatFailuresTotal,
  workerLastPollTimestamp,
  // Signals
  workflowSignalTotal,
  // SSE
  sseConnectionsActive,
  // Vibe Coder
  vibeCoderRunsTotal,
  vibeCoderDebugRetriesTotal,
  vibeCoderBuildCheckFailuresTotal,
  // Integration errors + connectivity
  integrationProviderErrorsTotal,
  redisConnectivityStatus,
  postgresConnectivityStatus,
  // Routing + billing
  routingDecisions,
  creditReservations,
  creditReconciliations,
  registry: metricsRegistry,
};
