/**
 * Circuit-breaker integration tests — proves the resilience contract the
 * landing page claims ("After 5 consecutive failures, the circuit opens...").
 *
 * Covers the real DistributedCircuitBreaker against an in-memory Redis stub
 * so the tests run hermetically in CI without a live Redis instance. The stub
 * implements only the subset of commands the breaker uses, preserving exact
 * semantics (incr, get, set, del, pexpire).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DistributedCircuitBreaker,
  DistributedCircuitOpenError,
  getDistributedCircuitBreaker,
  resetDistributedCircuitBreakers,
} from '../../apps/api/src/coordination/distributed-circuit-breaker';

// ─── In-memory Redis stub ──────────────────────────────────────────────────
// Implements just enough of the ioredis surface for the breaker to function.
// Uses Date.now() for TTL tracking so `vi.useFakeTimers()` can move time.
class MemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private notExpired(entry: { value: string; expiresAt: number | null } | undefined): boolean {
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      return false;
    }
    return true;
  }

  async incr(key: string): Promise<number> {
    const existing = this.store.get(key);
    const current = this.notExpired(existing) ? Number(existing!.value) : 0;
    const next = current + 1;
    this.store.set(key, { value: String(next), expiresAt: existing?.expiresAt ?? null });
    return next;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!this.notExpired(entry)) {
      if (entry) this.store.delete(key);
      return null;
    }
    return entry!.value;
  }

  async set(key: string, value: string): Promise<string> {
    const existing = this.store.get(key);
    this.store.set(key, { value, expiresAt: existing?.expiresAt ?? null });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const had = this.store.has(key);
    this.store.delete(key);
    return had ? 1 : 0;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + ms;
    return 1;
  }

  async eval(): Promise<unknown> {
    throw new Error('eval not stubbed');
  }

  // Test helpers
  clear(): void {
    this.store.clear();
  }
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.store.entries()) {
      if (this.notExpired(v)) out[k] = v.value;
    }
    return out;
  }
}

describe('DistributedCircuitBreaker — core contract', () => {
  let redis: MemoryRedis;
  let breaker: DistributedCircuitBreaker;

  beforeEach(() => {
    redis = new MemoryRedis();
    breaker = new DistributedCircuitBreaker(redis, {
      name: 'test-breaker',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDistributedCircuitBreakers();
  });

  it('starts in CLOSED state and passes calls through', async () => {
    expect(await breaker.getState()).toBe('CLOSED');
    const result = await breaker.call(async () => 42);
    expect(result).toBe(42);
    expect(await breaker.getState()).toBe('CLOSED');
  });

  it('increments failure count on rejected calls', async () => {
    const failing = () => Promise.reject(new Error('provider down'));

    await expect(breaker.call(failing)).rejects.toThrow('provider down');
    await expect(breaker.call(failing)).rejects.toThrow('provider down');

    const failures = Number(await redis.get('jak:cb:test-breaker:failures'));
    expect(failures).toBe(2);
    expect(await breaker.getState()).toBe('CLOSED'); // below threshold
  });

  it('opens the circuit after exactly 5 consecutive failures', async () => {
    const failing = () => Promise.reject(new Error('provider down'));

    for (let i = 1; i <= 5; i++) {
      await expect(breaker.call(failing)).rejects.toThrow();
      if (i < 5) expect(await breaker.getState()).toBe('CLOSED');
    }
    expect(await breaker.getState()).toBe('OPEN');
  });

  it('rejects the 6th call fast (without invoking the wrapped fn) once open', async () => {
    const failing = () => Promise.reject(new Error('provider down'));
    for (let i = 0; i < 5; i++) {
      await expect(breaker.call(failing)).rejects.toThrow();
    }
    expect(await breaker.getState()).toBe('OPEN');

    const spy = vi.fn(() => Promise.resolve('should never run'));
    await expect(breaker.call(spy)).rejects.toBeInstanceOf(DistributedCircuitOpenError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('transitions to HALF_OPEN after resetTimeoutMs elapses', async () => {
    const failing = () => Promise.reject(new Error('provider down'));
    for (let i = 0; i < 5; i++) {
      await expect(breaker.call(failing)).rejects.toThrow();
    }
    expect(await breaker.getState()).toBe('OPEN');

    vi.advanceTimersByTime(30_001);
    expect(await breaker.getState()).toBe('HALF_OPEN');
  });

  it('closes the circuit when a half-open probe succeeds', async () => {
    const failing = () => Promise.reject(new Error('provider down'));
    for (let i = 0; i < 5; i++) {
      await expect(breaker.call(failing)).rejects.toThrow();
    }
    vi.advanceTimersByTime(30_001);
    expect(await breaker.getState()).toBe('HALF_OPEN');

    const result = await breaker.call(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(await breaker.getState()).toBe('CLOSED');
  });

  it('resets failure count on any successful call', async () => {
    const failing = () => Promise.reject(new Error('provider down'));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.call(failing)).rejects.toThrow();
    }
    expect(await redis.get('jak:cb:test-breaker:failures')).toBe('3');

    await breaker.call(async () => 'ok');

    // A success clears the counter — next 5 failures start a fresh trip cycle.
    expect(await redis.get('jak:cb:test-breaker:failures')).toBeNull();
    expect(await breaker.getState()).toBe('CLOSED');
  });

  it('reset() clears all breaker state', async () => {
    const failing = () => Promise.reject(new Error('provider down'));
    for (let i = 0; i < 5; i++) {
      await expect(breaker.call(failing)).rejects.toThrow();
    }
    expect(await breaker.getState()).toBe('OPEN');

    await breaker.reset();

    expect(await breaker.getState()).toBe('CLOSED');
    expect(await redis.get('jak:cb:test-breaker:failures')).toBeNull();
    expect(await redis.get('jak:cb:test-breaker:openedAt')).toBeNull();
  });
});

describe('DistributedCircuitBreaker — per-name isolation', () => {
  // The landing page says "per-agent isolation" — CRM failures must not open
  // the Email breaker. Verified by spinning up two independent breakers on
  // the same Redis and confirming state stays scoped to each name.
  let redis: MemoryRedis;

  beforeEach(() => {
    redis = new MemoryRedis();
    resetDistributedCircuitBreakers();
  });

  it('trips breaker A without affecting breaker B on shared Redis', async () => {
    const crm = new DistributedCircuitBreaker(redis, {
      name: 'worker-crm',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });
    const email = new DistributedCircuitBreaker(redis, {
      name: 'worker-email',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });

    const fail = () => Promise.reject(new Error('crm down'));
    for (let i = 0; i < 5; i++) {
      await expect(crm.call(fail)).rejects.toThrow();
    }

    expect(await crm.getState()).toBe('OPEN');
    expect(await email.getState()).toBe('CLOSED');

    const r = await email.call(async () => 'email still ok');
    expect(r).toBe('email still ok');
  });
});

describe('DistributedCircuitBreaker — Redis-unavailable fallback', () => {
  // When Redis throws on every call, the breaker must fail-OPEN in the
  // "assume closed, keep serving" sense — returning CLOSED so the request
  // path still functions. This matches the documented policy at
  // distributed-circuit-breaker.ts:65: "Redis error → assume closed".
  class BrokenRedis {
    async incr(): Promise<number> {
      throw new Error('redis down');
    }
    async get(): Promise<string | null> {
      throw new Error('redis down');
    }
    async set(): Promise<string> {
      throw new Error('redis down');
    }
    async del(): Promise<number> {
      throw new Error('redis down');
    }
    async pexpire(): Promise<number> {
      throw new Error('redis down');
    }
    async eval(): Promise<unknown> {
      throw new Error('redis down');
    }
  }

  it('reports CLOSED when Redis is unreachable', async () => {
    const breaker = new DistributedCircuitBreaker(new BrokenRedis(), {
      name: 'redis-broken-test',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });
    expect(await breaker.getState()).toBe('CLOSED');
  });

  it('still executes calls when Redis is unreachable (onFailure is non-fatal)', async () => {
    const breaker = new DistributedCircuitBreaker(new BrokenRedis(), {
      name: 'redis-broken-exec',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });
    const result = await breaker.call(async () => 'success');
    expect(result).toBe('success');
  });
});

describe('DistributedCircuitBreaker — registry caching', () => {
  let redis: MemoryRedis;

  beforeEach(() => {
    redis = new MemoryRedis();
    resetDistributedCircuitBreakers();
  });

  it('returns the same breaker instance for the same name', () => {
    const b1 = getDistributedCircuitBreaker(redis, 'cached-breaker');
    const b2 = getDistributedCircuitBreaker(redis, 'cached-breaker');
    expect(b1).toBe(b2);
  });

  it('returns different breakers for different names', () => {
    const b1 = getDistributedCircuitBreaker(redis, 'name-one');
    const b2 = getDistributedCircuitBreaker(redis, 'name-two');
    expect(b1).not.toBe(b2);
  });
});
