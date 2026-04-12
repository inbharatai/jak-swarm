/**
 * Distributed lock using Redis SET NX EX pattern.
 *
 * Provides:
 * - acquireLock: Attempt to acquire a named lock with TTL
 * - releaseLock: Release a lock (only if you own it)
 * - withLock: Execute a function while holding a lock
 *
 * Falls back to in-memory locks when Redis is unavailable (local dev).
 */

import crypto from 'crypto';

export interface LockProvider {
  acquire(key: string, ttlMs: number): Promise<string | null>; // Returns lock token or null
  release(key: string, token: string): Promise<boolean>;
}

// ─── Redis Implementation ───────────────────────────────────────────────────

export class RedisLockProvider implements LockProvider {
  private redis: { set: (...args: unknown[]) => Promise<unknown>; eval: (...args: unknown[]) => Promise<unknown> };

  constructor(redis: unknown) {
    this.redis = redis as RedisLockProvider['redis'];
  }

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = crypto.randomUUID();
    const result = await this.redis.set(
      `jak:lock:${key}`,
      token,
      'PX', ttlMs,
      'NX',
    );
    return result === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<boolean> {
    // Atomic: only delete if we still own the lock
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await this.redis.eval(script, 1, `jak:lock:${key}`, token) as number;
    return result === 1;
  }
}

// ─── In-Memory Implementation (local dev) ───────────────────────────────────

export class InMemoryLockProvider implements LockProvider {
  private locks = new Map<string, { token: string; expiresAt: number }>();

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return null; // Lock held by someone else
    }
    const token = crypto.randomUUID();
    this.locks.set(key, { token, expiresAt: Date.now() + ttlMs });
    return token;
  }

  async release(key: string, token: string): Promise<boolean> {
    const existing = this.locks.get(key);
    if (existing?.token === token) {
      this.locks.delete(key);
      return true;
    }
    return false;
  }
}

// ─── Helper: Execute under lock ─────────────────────────────────────────────

export async function withLock<T>(
  provider: LockProvider,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const token = await provider.acquire(key, ttlMs);
  if (!token) return null; // Could not acquire lock

  try {
    return await fn();
  } finally {
    await provider.release(key, token).catch(() => {
      // Lock release failed — will auto-expire via TTL
    });
  }
}
