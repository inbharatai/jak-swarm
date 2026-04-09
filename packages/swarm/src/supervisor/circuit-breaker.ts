import { supervisorBus } from './supervisor-bus.js';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5. */
  failureThreshold?: number;
  /** Time in ms to wait before moving from OPEN to HALF_OPEN. Default: 30s. */
  resetTimeoutMs?: number;
  /** Tenant ID for event reporting. */
  tenantId?: string;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * CircuitBreaker — prevents cascading failures when an agent or tool
 * fails repeatedly. Wraps async calls with fail-fast logic.
 *
 * States:
 *   CLOSED   → Normal operation. Failures are counted.
 *   OPEN     → Calls fail immediately without executing. Resets after timeout.
 *   HALF_OPEN → Allows a single probe call. Success → CLOSED, failure → OPEN.
 *
 * Usage:
 *   const breaker = new CircuitBreaker('openai-gpt4o', { failureThreshold: 3 });
 *   const result = await breaker.call(() => callLLM(messages));
 */
export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private probeInFlight = false;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly tenantId: string;

  constructor(name: string, options?: CircuitBreakerOptions) {
    this.name = name;
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.resetTimeoutMs = options?.resetTimeoutMs ?? 30_000;
    this.tenantId = options?.tenantId ?? 'system';
  }

  getState(): CircuitState {
    if (this.state === 'OPEN') {
      // Check if reset timeout has elapsed → transition to HALF_OPEN
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      }
    }
    return this.state;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is OPEN.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      throw new CircuitOpenError(this.name, this.failureCount, this.resetTimeoutMs);
    }

    // In HALF_OPEN, only one probe call is allowed at a time
    if (currentState === 'HALF_OPEN' && this.probeInFlight) {
      throw new CircuitOpenError(this.name, this.failureCount, this.resetTimeoutMs);
    }

    if (currentState === 'HALF_OPEN') {
      this.probeInFlight = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    } finally {
      this.probeInFlight = false;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(err: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      const errorMessage = err instanceof Error ? err.message : String(err);

      supervisorBus.publish('circuit:open', {
        type: 'circuit:open',
        tenantId: this.tenantId,
        service: this.name,
        failureCount: this.failureCount,
        lastError: errorMessage,
      });
    }
  }

  /** Force-reset the breaker to CLOSED (e.g., after manual intervention). */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

export class CircuitOpenError extends Error {
  readonly circuitName: string;
  readonly failureCount: number;
  readonly resetMs: number;

  constructor(name: string, failureCount: number, resetMs: number) {
    super(`Circuit breaker '${name}' is OPEN after ${failureCount} failures. Retry after ${resetMs}ms.`);
    this.circuitName = name;
    this.failureCount = failureCount;
    this.resetMs = resetMs;
  }
}

/**
 * Registry of named circuit breakers for shared access.
 * Use this to get-or-create breakers for recurring services (LLM providers, tools, etc.).
 */
const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
  let breaker = breakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, options);
    breakers.set(name, breaker);
  }
  return breaker;
}

export function resetAllCircuitBreakers(): void {
  for (const breaker of breakers.values()) breaker.reset();
  breakers.clear();
}
