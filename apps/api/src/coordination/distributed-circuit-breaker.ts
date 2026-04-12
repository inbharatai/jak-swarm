/**
 * Distributed circuit breaker using Redis for shared state.
 *
 * All instances share the same failure count and breaker state via Redis keys:
 *   jak:cb:{name}:failures  — integer counter (TTL = resetTimeoutMs)
 *   jak:cb:{name}:state     — "OPEN" | "HALF_OPEN" | "CLOSED" (TTL = resetTimeoutMs * 2)
 *   jak:cb:{name}:openedAt  — timestamp when circuit opened (TTL = resetTimeoutMs * 2)
 *
 * When Redis is unavailable, falls back to in-process behavior (existing CircuitBreaker).
 */

type RedisLike = {
  incr: (key: string) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  set: (...args: unknown[]) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
  pexpire: (key: string, ms: number) => Promise<unknown>;
  eval: (...args: unknown[]) => Promise<unknown>;
};

export interface DistributedCircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  name: string;
}

export class DistributedCircuitBreaker {
  readonly name: string;
  private redis: RedisLike;
  private failureThreshold: number;
  private resetTimeoutMs: number;

  private keyFailures: string;
  private keyState: string;
  private keyOpenedAt: string;

  constructor(redis: unknown, options: DistributedCircuitBreakerOptions) {
    this.redis = redis as RedisLike;
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;

    this.keyFailures = `jak:cb:${this.name}:failures`;
    this.keyState = `jak:cb:${this.name}:state`;
    this.keyOpenedAt = `jak:cb:${this.name}:openedAt`;
  }

  async getState(): Promise<'CLOSED' | 'OPEN' | 'HALF_OPEN'> {
    try {
      const state = await this.redis.get(this.keyState);
      if (!state || state === 'CLOSED') return 'CLOSED';

      if (state === 'OPEN') {
        // Check if reset timeout has elapsed
        const openedAt = await this.redis.get(this.keyOpenedAt);
        if (openedAt && Date.now() - Number(openedAt) >= this.resetTimeoutMs) {
          await this.redis.set(this.keyState, 'HALF_OPEN');
          return 'HALF_OPEN';
        }
        return 'OPEN';
      }

      return state as 'HALF_OPEN';
    } catch {
      return 'CLOSED'; // Redis error → assume closed (fail-open)
    }
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    const state = await this.getState();

    if (state === 'OPEN') {
      throw new DistributedCircuitOpenError(this.name);
    }

    try {
      const result = await fn();
      await this.onSuccess();
      return result;
    } catch (err) {
      await this.onFailure();
      throw err;
    }
  }

  private async onSuccess(): Promise<void> {
    try {
      await this.redis.del(this.keyFailures);
      await this.redis.set(this.keyState, 'CLOSED');
      await this.redis.del(this.keyOpenedAt);
    } catch {
      // Redis error — non-fatal
    }
  }

  private async onFailure(): Promise<void> {
    try {
      const count = await this.redis.incr(this.keyFailures);
      await this.redis.pexpire(this.keyFailures, this.resetTimeoutMs * 2);

      if (count >= this.failureThreshold) {
        await this.redis.set(this.keyState, 'OPEN');
        await this.redis.set(this.keyOpenedAt, String(Date.now()));
        await this.redis.pexpire(this.keyState, this.resetTimeoutMs * 2);
        await this.redis.pexpire(this.keyOpenedAt, this.resetTimeoutMs * 2);
      }
    } catch {
      // Redis error — non-fatal, local circuit still tracks
    }
  }

  async reset(): Promise<void> {
    try {
      await this.redis.del(this.keyFailures);
      await this.redis.del(this.keyState);
      await this.redis.del(this.keyOpenedAt);
    } catch {
      // Best effort
    }
  }
}

export class DistributedCircuitOpenError extends Error {
  readonly circuitName: string;
  constructor(name: string) {
    super(`Distributed circuit breaker '${name}' is OPEN. Service temporarily unavailable.`);
    this.circuitName = name;
  }
}

// ─── Registry ───────────────────────────────────────────────────────────────

const distributedBreakers = new Map<string, DistributedCircuitBreaker>();

export function getDistributedCircuitBreaker(
  redis: unknown,
  name: string,
  options?: Omit<DistributedCircuitBreakerOptions, 'name'>,
): DistributedCircuitBreaker {
  let breaker = distributedBreakers.get(name);
  if (!breaker) {
    breaker = new DistributedCircuitBreaker(redis, { name, ...options });
    distributedBreakers.set(name, breaker);
  }
  return breaker;
}

export function resetDistributedCircuitBreakers(): void {
  distributedBreakers.clear();
}
