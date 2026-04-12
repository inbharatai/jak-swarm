/**
 * Scheduler leader election using Redis.
 *
 * Only ONE instance should run the cron scheduler at a time.
 * Uses a Redis key with TTL as a lease:
 *   - Instance acquires `jak:scheduler:leader` with its ID + 90s TTL
 *   - Refreshes the lease every 30s while alive
 *   - If instance dies, TTL expires and another instance takes over
 *
 * Falls back to "always leader" for local dev (single instance).
 */

import crypto from 'crypto';

const LEADER_KEY = 'jak:scheduler:leader';
const LEASE_TTL_MS = 90_000; // 90 seconds
const REFRESH_INTERVAL_MS = 30_000; // 30 seconds

export interface SchedulerLeader {
  /** Try to become leader. Returns true if this instance is now the leader. */
  tryAcquire(): Promise<boolean>;
  /** Check if this instance is currently the leader. */
  isLeader(): Promise<boolean>;
  /** Start the lease refresh loop. */
  start(): void;
  /** Stop and release leadership. */
  stop(): Promise<void>;
}

// ─── Redis Implementation ───────────────────────────────────────────────────

export class RedisSchedulerLeader implements SchedulerLeader {
  private redis: { set: (...args: unknown[]) => Promise<unknown>; get: (key: string) => Promise<string | null>; eval: (...args: unknown[]) => Promise<unknown>; del: (key: string) => Promise<unknown> };
  private instanceId: string;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private _isLeader = false;

  constructor(redis: unknown, instanceId?: string) {
    this.redis = redis as RedisSchedulerLeader['redis'];
    this.instanceId = instanceId ?? `jak-${crypto.randomUUID().slice(0, 8)}`;
  }

  async tryAcquire(): Promise<boolean> {
    const result = await this.redis.set(
      LEADER_KEY,
      this.instanceId,
      'PX', LEASE_TTL_MS,
      'NX',
    );

    if (result === 'OK') {
      this._isLeader = true;
      return true;
    }

    // Check if we already hold the lease (re-entrant)
    const current = await this.redis.get(LEADER_KEY);
    if (current === this.instanceId) {
      this._isLeader = true;
      return true;
    }

    this._isLeader = false;
    return false;
  }

  async isLeader(): Promise<boolean> {
    const current = await this.redis.get(LEADER_KEY);
    this._isLeader = current === this.instanceId;
    return this._isLeader;
  }

  start(): void {
    // Try to acquire immediately
    this.tryAcquire().catch(() => {});

    // Refresh the lease periodically
    this.refreshTimer = setInterval(async () => {
      try {
        if (this._isLeader) {
          // Refresh: extend TTL only if we still hold the lease
          const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("pexpire", KEYS[1], ARGV[2])
            else
              return 0
            end
          `;
          const refreshed = await this.redis.eval(script, 1, LEADER_KEY, this.instanceId, LEASE_TTL_MS) as number;
          if (refreshed === 0) {
            this._isLeader = false;
            // Lease lost — try to re-acquire
            await this.tryAcquire();
          }
        } else {
          // Not leader — try to acquire (previous leader may have died)
          await this.tryAcquire();
        }
      } catch {
        // Redis error — conservatively assume not leader
        this._isLeader = false;
      }
    }, REFRESH_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Release leadership
    if (this._isLeader) {
      try {
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        await this.redis.eval(script, 1, LEADER_KEY, this.instanceId);
      } catch {
        // Best-effort release — TTL will expire anyway
      }
      this._isLeader = false;
    }
  }
}

// ─── In-Memory Implementation (local dev — always leader) ───────────────────

export class InMemorySchedulerLeader implements SchedulerLeader {
  async tryAcquire(): Promise<boolean> { return true; }
  async isLeader(): Promise<boolean> { return true; }
  start(): void {}
  async stop(): Promise<void> {}
}
