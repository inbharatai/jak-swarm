import { describe, it, expect } from 'vitest';
import { withJakExecutionContext, getJakExecutionContext } from '../../../packages/adk/src/bridge/jak-tool-bridge.js';
import type { ToolExecutionContext } from '@jak-swarm/shared';

/**
 * Locks the AsyncLocalStorage-backed execution-context contract that
 * replaced the prior module-level mutable `currentExecutionContext`
 * singleton in the ADK tool bridge.
 *
 * The prior `set`/`clear` design was a CRITICAL concurrency bug on the
 * stateless concurrent Fastify API: two interleaved ADK runs (different
 * tenants) would read each other's context (cross-tenant data leakage) or
 * `undefined`, and the first-finishing run's `clear` would wipe the
 * context out from under the still-running one. `AsyncLocalStorage`
 * propagates per-async-chain across awaits, which is the guarantee ADK's
 * `Runner.runAsync` `for await` loop needs.
 *
 * These tests prove: (a) nested runs see their OWN context, (b) the
 * context is `undefined` outside a `withJakExecutionContext` block, (c)
 * the context survives across `await` boundaries within the same async
 * chain, (d) two CONCURRENT async chains see their OWN contexts without
 * cross-contamination, (e) clearing is automatic — the context does not
 * leak out of the `with` block after it returns.
 */

function ctx(tenantId: string, workflowId: string): ToolExecutionContext {
  return {
    tenantId,
    userId: `u-${tenantId}`,
    workflowId,
    runId: `r-${workflowId}`,
  };
}

describe('withJakExecutionContext (AsyncLocalStorage)', () => {
  it('returns undefined outside any with-block', () => {
    expect(getJakExecutionContext()).toBeUndefined();
  });

  it('exposes the context inside the with-block and clears it after', () => {
    const c = ctx('tA', 'w1');
    withJakExecutionContext(c, () => {
      expect(getJakExecutionContext()).toBe(c);
    });
    expect(getJakExecutionContext()).toBeUndefined();
  });

  it('propagates the context across awaited microtasks within the same async chain', async () => {
    const c = ctx('tAwait', 'w-await');
    const seen = await withJakExecutionContext(c, async () => {
      const a = getJakExecutionContext();
      await Promise.resolve();
      const b = getJakExecutionContext();
      await new Promise((r) => setTimeout(r, 5));
      const d = getJakExecutionContext();
      return [a, b, d];
    });
    expect(seen).toEqual([c, c, c]);
    expect(getJakExecutionContext()).toBeUndefined();
  });

  it('isolates two concurrent async chains so each sees its OWN context', async () => {
    const cA = ctx('tA', 'wA');
    const cB = ctx('tB', 'wB');

    // Two interleaved awaits. Without AsyncLocalStorage, the prior
    // module-global singleton would have whichever caller `set` last win
    // — both chains would see the SAME (or undefined) context at the
    // resolution point. With ALS, each chain reads its own store.
    const runA = withJakExecutionContext(cA, async () => {
      await new Promise((r) => setTimeout(r, 15)); // let B set its context
      return getJakExecutionContext()?.tenantId;
    });
    const runB = withJakExecutionContext(cB, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getJakExecutionContext()?.tenantId;
    });
    const [a, b] = await Promise.all([runA, runB]);
    expect(a).toBe('tA');
    expect(b).toBe('tB');
    expect(getJakExecutionContext()).toBeUndefined();
  });

  it('does not let a nested inner context leak into the outer chain after the inner block returns', () => {
    const outer = ctx('tOuter', 'wO');
    const inner = ctx('tInner', 'wI');
    withJakExecutionContext(outer, () => {
      expect(getJakExecutionContext()).toBe(outer);
      withJakExecutionContext(inner, () => {
        expect(getJakExecutionContext()).toBe(inner);
      });
      // After the inner block, the outer context must be restored.
      expect(getJakExecutionContext()).toBe(outer);
    });
    expect(getJakExecutionContext()).toBeUndefined();
  });

  it('returns the wrapped function\'s value (sync + async)', async () => {
    const sync = withJakExecutionContext(ctx('t', 'w'), () => 42);
    expect(sync).toBe(42);
    const asyncOut = await withJakExecutionContext(ctx('t', 'w'), async () => 'hello');
    expect(asyncOut).toBe('hello');
  });
});