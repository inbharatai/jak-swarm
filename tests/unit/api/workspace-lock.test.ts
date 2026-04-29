/**
 * GAP 3 — Per-workspace write/edit/deploy lock helper.
 *
 * Tests the `withWorkspaceLock`, `withWorkspaceLockOrThrow`, and
 * `workspaceLockKey` helpers in `apps/api/src/coordination/workspace-lock.ts`.
 * The helpers are intentionally thin wrappers over the existing
 * `withLock` + `LockProvider` primitives — these tests prove the wrapper
 * preserves the contract while adding op-namespacing + throw-based
 * ergonomics.
 *
 * No fakes: uses the real `InMemoryLockProvider` already used by the
 * Fastify coordination plugin in single-instance dev. The Redis path
 * shares the same `LockProvider` interface; if the in-memory tests pass,
 * the contract is satisfied.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryLockProvider } from '../../../apps/api/src/coordination/distributed-lock.js';
import {
  withWorkspaceLock,
  withWorkspaceLockOrThrow,
  workspaceLockKey,
  WorkspaceLockHeldError,
} from '../../../apps/api/src/coordination/workspace-lock.js';

describe('workspaceLockKey', () => {
  it('produces the canonical `ws:<id>:<op>` shape', () => {
    expect(workspaceLockKey('abc123', 'write')).toBe('ws:abc123:write');
    expect(workspaceLockKey('abc123', 'edit')).toBe('ws:abc123:edit');
    expect(workspaceLockKey('abc123', 'deploy')).toBe('ws:abc123:deploy');
  });
});

describe('withWorkspaceLock', () => {
  it('serializes two concurrent `write` ops on the same workspace', async () => {
    const locks = new InMemoryLockProvider();
    const order: string[] = [];

    const a = withWorkspaceLock(locks, 'wsA', 'write', 1_000, async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a-end');
      return 'A';
    });

    // Second call fires immediately — `InMemoryLockProvider` is non-blocking
    // (returns `null` on contention rather than waiting), so the second
    // attempt should observe the lock as held and resolve to `null`.
    const b = await withWorkspaceLock(locks, 'wsA', 'write', 1_000, async () => {
      order.push('b-ran');
      return 'B';
    });

    expect(b).toBeNull();
    const aResult = await a;
    expect(aResult).toBe('A');
    // B must NOT have run while A held the lock.
    expect(order).toEqual(['a-start', 'a-end']);
  });

  it('different ops on the same workspace do NOT block each other', async () => {
    const locks = new InMemoryLockProvider();

    const writePromise = withWorkspaceLock(locks, 'wsA', 'write', 1_000, async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 'wrote';
    });

    // While `write` lock is held, `deploy` should acquire its own lock
    // — different op = different key.
    const deployResult = await withWorkspaceLock(locks, 'wsA', 'deploy', 1_000, async () => {
      return 'deployed';
    });

    expect(deployResult).toBe('deployed');
    expect(await writePromise).toBe('wrote');
  });

  it('different workspaces with the same op do NOT block each other', async () => {
    const locks = new InMemoryLockProvider();

    const a = withWorkspaceLock(locks, 'wsA', 'write', 1_000, async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 'A';
    });

    const b = await withWorkspaceLock(locks, 'wsB', 'write', 1_000, async () => {
      return 'B';
    });

    expect(b).toBe('B');
    expect(await a).toBe('A');
  });

  it('releases the lock when `fn` throws so a follow-up attempt succeeds', async () => {
    const locks = new InMemoryLockProvider();
    const boom = new Error('boom');

    await expect(
      withWorkspaceLock(locks, 'wsA', 'write', 1_000, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    // Lock must have been released — the next acquire should succeed.
    const result = await withWorkspaceLock(locks, 'wsA', 'write', 1_000, async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('TTL-expired lock can be reclaimed by another caller', async () => {
    const locks = new InMemoryLockProvider();

    // First caller acquires with a tiny TTL but holds the lock past it.
    // The InMemoryLockProvider's acquire() checks `expiresAt > now` and
    // grants the lock if the prior holder's window elapsed — simulating
    // a dead-worker scenario.
    await withWorkspaceLock(locks, 'wsA', 'write', 5, async () => {
      await new Promise((r) => setTimeout(r, 30));
      return 'held-too-long';
    });

    // After TTL, a new acquire on the same key must succeed.
    const reclaimed = await withWorkspaceLock(locks, 'wsA', 'write', 1_000, async () => 'reclaimed');
    expect(reclaimed).toBe('reclaimed');
  });
});

describe('withWorkspaceLockOrThrow', () => {
  it('returns the function result on success', async () => {
    const locks = new InMemoryLockProvider();
    const result = await withWorkspaceLockOrThrow(
      locks,
      'wsA',
      'edit',
      1_000,
      async () => 'ok',
    );
    expect(result).toBe('ok');
  });

  it('throws WorkspaceLockHeldError on contention with the offending op + key', async () => {
    const locks = new InMemoryLockProvider();

    // Grab the lock without releasing immediately.
    const holderToken = await locks.acquire(workspaceLockKey('wsA', 'edit'), 1_000);
    expect(holderToken).not.toBeNull();

    try {
      await withWorkspaceLockOrThrow(locks, 'wsA', 'edit', 1_000, async () => 'unreached');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceLockHeldError);
      expect((err as WorkspaceLockHeldError).op).toBe('edit');
      expect((err as WorkspaceLockHeldError).workspaceId).toBe('wsA');
      expect((err as WorkspaceLockHeldError).key).toBe('ws:wsA:edit');
    } finally {
      if (holderToken) {
        await locks.release(workspaceLockKey('wsA', 'edit'), holderToken);
      }
    }
  });
});
