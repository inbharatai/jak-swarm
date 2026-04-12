/**
 * Distributed coordination layer for multi-instance JAK Swarm.
 *
 * Provides:
 * - Distributed locks (Redis SET NX EX / in-memory fallback)
 * - Workflow signal bus (Redis pub/sub / in-memory fallback)
 * - Scheduler leader election (Redis lease / always-leader fallback)
 *
 * Selection: Uses Redis implementations when `redis` instance is provided,
 * falls back to in-memory for local dev.
 */

export type { LockProvider } from './distributed-lock.js';
export { RedisLockProvider, InMemoryLockProvider, withLock } from './distributed-lock.js';

export type { WorkflowSignal, WorkflowSignalBus } from './workflow-signals.js';
export { RedisWorkflowSignalBus, InMemoryWorkflowSignalBus } from './workflow-signals.js';

export type { SchedulerLeader } from './scheduler-leader.js';
export { RedisSchedulerLeader, InMemorySchedulerLeader } from './scheduler-leader.js';

export { DistributedCircuitBreaker, DistributedCircuitOpenError, getDistributedCircuitBreaker, resetDistributedCircuitBreakers } from './distributed-circuit-breaker.js';
