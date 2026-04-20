/**
 * Per-workflow circuit-breaker factory registry.
 *
 * The factory is a Function, which is non-serializable — passing it through
 * workflow state (which gets persisted to Prisma on every onStateChange)
 * crashes with `Invalid value for argument: [object Function]`. Instead,
 * SwarmRunner registers the factory here keyed by workflowId, worker-node
 * looks it up by workflowId, and state stays JSON-safe.
 *
 * Lifecycle:
 *  - register() is called before graph.invoke() starts
 *  - unregister() is called in the finally block after graph.invoke() ends
 *    (success or failure) so the Map doesn't leak across long-running processes
 *
 * Safe with concurrent workflows across the same process: each workflowId
 * owns its own entry.
 */

export type CircuitBreakerFactory = (
  name: string,
  opts: { failureThreshold: number; resetTimeoutMs: number },
) => { call: <T>(fn: () => Promise<T>) => Promise<T> };

const registry = new Map<string, CircuitBreakerFactory>();

export function registerBreakerFactory(
  workflowId: string,
  factory: CircuitBreakerFactory,
): void {
  registry.set(workflowId, factory);
}

export function unregisterBreakerFactory(workflowId: string): void {
  registry.delete(workflowId);
}

export function getBreakerFactory(workflowId: string): CircuitBreakerFactory | undefined {
  return registry.get(workflowId);
}

/** For tests — drop everything. Do not call in production code. */
export function __clearBreakerRegistry(): void {
  registry.clear();
}
