/**
 * Observability module for JAK Swarm API.
 *
 * Provides:
 * - Prometheus metrics via /metrics endpoint
 * - HTTP request timing instrumentation
 * - Supervisor bus event → metrics bridge
 * - Health probe helpers
 * - Request ID response headers
 * - Structured error monitoring hooks
 *
 * Usage: Register as a Fastify plugin early in the boot sequence.
 */

export { metrics, metricsRegistry } from './metrics.js';
export { registerObservability } from './plugin.js';
