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
  private consecutiveOpens = 0; // tracks how many times circuit re-opened after probe failure
  private lastFailureTime = 0;
  /** @internal Used by purgeIdleCircuitBreakers */
  lastAccessTime = Date.now();
  private probeInFlight = false;
  private readonly failureThreshold: number;
  private readonly baseResetTimeoutMs: number;
  private readonly maxResetTimeoutMs: number;
  private readonly tenantId: string;

  constructor(name: string, options?: CircuitBreakerOptions) {
    this.name = name;
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.baseResetTimeoutMs = options?.resetTimeoutMs ?? 30_000;
    this.maxResetTimeoutMs = 5 * 60 * 1000; // 5 min max
    this.tenantId = options?.tenantId ?? 'system';
  }

  /** Current effective reset timeout with exponential backoff. */
  private get currentResetTimeoutMs(): number {
    // Exponential backoff: 30s, 60s, 120s, 240s, capped at 5min
    const timeout = this.baseResetTimeoutMs * Math.pow(2, this.consecutiveOpens);
    return Math.min(timeout, this.maxResetTimeoutMs);
  }

  getState(): CircuitState {
    this.lastAccessTime = Date.now();
    if (this.state === 'OPEN') {
      // Check if reset timeout has elapsed → transition to HALF_OPEN
      if (Date.now() - this.lastFailureTime >= this.currentResetTimeoutMs) {
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
      throw new CircuitOpenError(this.name, this.failureCount, this.currentResetTimeoutMs);
    }

    // In HALF_OPEN, only one probe call is allowed at a time
    if (currentState === 'HALF_OPEN' && this.probeInFlight) {
      throw new CircuitOpenError(this.name, this.failureCount, this.currentResetTimeoutMs);
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
    this.consecutiveOpens = 0; // Reset backoff on successful recovery
    this.state = 'CLOSED';
  }

  private onFailure(err: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      if (this.state === 'HALF_OPEN') {
        this.consecutiveOpens++; // Probe failed — increase backoff
      }
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

/**
 * Purge circuit breakers that haven't been accessed for longer than maxIdleMs.
 * Prevents memory leaks from accumulating breakers for historical agent roles.
 */
export function purgeIdleCircuitBreakers(maxIdleMs = 60 * 60 * 1000 /* 1 hour */): number {
  const now = Date.now();
  let purged = 0;
  for (const [name, breaker] of breakers) {
    if (now - breaker.lastAccessTime > maxIdleMs) {
      breakers.delete(name);
      purged++;
    }
  }
  return purged;
}
