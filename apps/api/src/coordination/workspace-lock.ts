/**
 * Per-workspace write/edit/deploy locks.
 *
 * Thin wrapper over the existing distributed-lock primitives in
 * `./distributed-lock.ts`. We deliberately do NOT introduce a new lock
 * provider — `RedisLockProvider` and `InMemoryLockProvider` already
 * handle persistence + TTL + ownership-checked release. This module
 * adds:
 *
 *   1. A canonical key shape (`ws:<workspaceId>:<op>`) so concurrent
 *      writes to a workspace serialize while reads + concurrent ops on
 *      a *different* workspace stay parallel.
 *   2. Three named operations (`write`, `edit`, `deploy`) so the same
 *      workspace can be deploying while an edit waits, instead of every
 *      mutation contending for one global key.
 *   3. A throw-based ergonomic (`withWorkspaceLockOrThrow`) for callers
 *      who'd rather propagate a typed error than branch on `null`.
 *
 * Recommended call sites: any handler that mutates Workspace state in a
 * way the user can observe (publish, deploy, multi-step edits, etc.).
 * Reads + idempotent metadata writes do NOT need this — the cost of
 * the round-trip outweighs the benefit when no contention is possible.
 */

import { withLock, type LockProvider } from './distributed-lock.js';

export type WorkspaceLockOp = 'write' | 'edit' | 'deploy';

/**
 * Canonical key shape for a workspace lock. Keep this stable — it is
 * persisted across processes and a key drift would silently divide the
 * lock holders into incompatible namespaces.
 */
export function workspaceLockKey(
  workspaceId: string,
  op: WorkspaceLockOp,
): string {
  return `ws:${workspaceId}:${op}`;
}

/**
 * Thrown by `withWorkspaceLockOrThrow` when the lock is already held.
 * The HTTP layer can `instanceof`-check this and respond 409 Conflict
 * with `Retry-After` so callers can back off cleanly.
 */
export class WorkspaceLockHeldError extends Error {
  readonly workspaceId: string;
  readonly op: WorkspaceLockOp;
  readonly key: string;
  constructor(workspaceId: string, op: WorkspaceLockOp) {
    super(
      `Workspace lock held: workspace=${workspaceId} op=${op}. Another ${op} is in progress.`,
    );
    this.name = 'WorkspaceLockHeldError';
    this.workspaceId = workspaceId;
    this.op = op;
    this.key = workspaceLockKey(workspaceId, op);
  }
}

/**
 * Run `fn` while holding the (workspace, op) lock. Returns the result
 * of `fn`, or `null` if the lock could not be acquired. Mirrors the
 * existing `withLock` contract — callers that prefer throw-based flow
 * use `withWorkspaceLockOrThrow` instead.
 *
 * On error inside `fn`, the lock is released (TTL-or-explicit) so a
 * crashed handler can never orphan the lock for the full TTL.
 */
export async function withWorkspaceLock<T>(
  provider: LockProvider,
  workspaceId: string,
  op: WorkspaceLockOp,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const key = workspaceLockKey(workspaceId, op);
  return withLock(provider, key, ttlMs, fn);
}

/**
 * Same as `withWorkspaceLock` but throws `WorkspaceLockHeldError` when
 * the lock cannot be acquired, instead of returning `null`. Use this in
 * HTTP handlers where a 409 + Retry-After is the natural response.
 */
export async function withWorkspaceLockOrThrow<T>(
  provider: LockProvider,
  workspaceId: string,
  op: WorkspaceLockOp,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const result = await withWorkspaceLock(provider, workspaceId, op, ttlMs, fn);
  if (result === null) {
    throw new WorkspaceLockHeldError(workspaceId, op);
  }
  return result;
}
