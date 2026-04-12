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

// Collect default Node.js metrics (GC, event loop, heap, etc.)
client.collectDefaultMetrics({
  prefix: 'jak_',
});

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
  registry: metricsRegistry,
};
