/**
 * executeGuarded resilience contract tests.
 *
 * The wrapper composes timeout + retry + circuit breaker + normalized error
 * taxonomy. These tests prove each layer works in isolation AND that the
 * composition order is correct (retries inside breaker, timeouts inside
 * retries, etc.). Any future refactor of the wrapper must keep this suite
 * green or explicitly change the contract + update the landing claims.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeGuarded,
  classifyError,
  ExecutionError,
} from '@jak-swarm/swarm';
import type { ExecutionErrorClass } from '@jak-swarm/swarm';

describe('executeGuarded — happy path', () => {
  it('returns the wrapped function value on success', async () => {
    const fn = vi.fn(async () => 42);
    const result = await executeGuarded(fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not call the function more than once on success', async () => {
    const fn = vi.fn(async () => 'ok');
    await executeGuarded(fn, { retries: 5 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('executeGuarded — retry behavior', () => {
  it('retries on rate_limit errors up to the configured limit', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('429 rate limit exceeded'))
      .mockRejectedValueOnce(new Error('429 too many requests'))
      .mockResolvedValueOnce('recovered');

    const result = await executeGuarded(fn, { retries: 2, retryBackoffMs: 1 });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on network errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce('ok');

    const result = await executeGuarded(fn, { retries: 1, retryBackoffMs: 1 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx server errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('503 service unavailable'))
      .mockResolvedValueOnce('ok');

    const result = await executeGuarded(fn, { retries: 1, retryBackoffMs: 1 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on auth_error — fails fast', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('401 Unauthorized: invalid API key'));

    await expect(executeGuarded(fn, { retries: 3, retryBackoffMs: 1 })).rejects.toThrow(
      ExecutionError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on bad_output', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid output schema'));

    await expect(executeGuarded(fn, { retries: 3, retryBackoffMs: 1 })).rejects.toThrow(
      ExecutionError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on unknown/unclassified errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('weird frobnicator malfunction'));

    await expect(executeGuarded(fn, { retries: 3, retryBackoffMs: 1 })).rejects.toThrow(
      ExecutionError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('surfaces the final classified error after all retries are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('429 rate limit'));

    try {
      await executeGuarded(fn, { retries: 2, retryBackoffMs: 1 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ExecutionError);
      expect((err as ExecutionError).errorClass).toBe('rate_limit');
      expect((err as ExecutionError).attempt).toBe(3); // 1 initial + 2 retries
    }
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls onRetry hook with attempt, class, and cause', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('503 server error'))
      .mockResolvedValueOnce('ok');

    await executeGuarded(fn, { retries: 1, retryBackoffMs: 1, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      1,
      'server_error',
      expect.any(Error),
    );
  });
});

describe('executeGuarded — timeout behavior', () => {
  it('rejects with timeout class when per-attempt wall-clock exceeds timeoutMs', async () => {
    const fn = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('late'), 500)));

    try {
      await executeGuarded(fn, { timeoutMs: 50, retries: 0 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ExecutionError);
      expect((err as ExecutionError).errorClass).toBe('timeout');
    }
  });

  it('treats timeout as retryable — retries and eventually succeeds', async () => {
    let callCount = 0;
    const fn = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        // First call: too slow (will time out at 50ms)
        return new Promise((resolve) => setTimeout(() => resolve('late'), 200));
      }
      // Second call: fast enough
      return Promise.resolve('fast');
    });

    const result = await executeGuarded(fn, {
      timeoutMs: 50,
      retries: 1,
      retryBackoffMs: 1,
    });

    expect(result).toBe('fast');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honors AbortSignal and cancels in-flight calls', async () => {
    const controller = new AbortController();
    const fn = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('late'), 500)));

    const promise = executeGuarded(fn, {
      timeoutMs: 5_000,
      retries: 0,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(new Error('user cancelled')), 30);

    await expect(promise).rejects.toThrow(ExecutionError);
  });
});

describe('executeGuarded — circuit breaker composition', () => {
  // The critical invariant: retries happen INSIDE the breaker, so a burst
  // of transient failures that eventually succeeds registers as ONE success
  // with the breaker, not N failures. Otherwise a temporary rate-limit
  // could open the breaker even though the wrapped call recovered.

  function makeBreakerStub(): { call: <T>(fn: () => Promise<T>) => Promise<T>; callCount: number; lastError?: unknown } {
    const stub = {
      callCount: 0,
      lastError: undefined as unknown,
      call: async function <T>(inner: () => Promise<T>): Promise<T> {
        stub.callCount++;
        try {
          return await inner();
        } catch (err) {
          stub.lastError = err;
          throw err;
        }
      },
    };
    return stub;
  }

  it('invokes the breaker exactly once per top-level call, even with retries', async () => {
    const breaker = makeBreakerStub();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce('ok');

    await executeGuarded(fn, { breaker, retries: 2, retryBackoffMs: 1 });

    expect(breaker.callCount).toBe(1);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('propagates the breaker-open error without invoking the wrapped function', async () => {
    const openBreaker = {
      call: async <T>(_inner: () => Promise<T>): Promise<T> => {
        throw new Error("Circuit breaker 'test' is OPEN");
      },
    };
    const fn = vi.fn().mockResolvedValue('never');

    await expect(
      executeGuarded(fn, { breaker: openBreaker, retries: 2, retryBackoffMs: 1 }),
    ).rejects.toThrow(/OPEN/);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('classifyError — taxonomy mapping', () => {
  const cases: Array<{ input: unknown; expected: ExecutionErrorClass }> = [
    { input: new Error('429 Too Many Requests'), expected: 'rate_limit' },
    { input: new Error('Rate limit exceeded'), expected: 'rate_limit' },
    { input: new Error('quota exceeded'), expected: 'rate_limit' },
    { input: new Error('401 Unauthorized'), expected: 'auth_error' },
    { input: new Error('403 Forbidden'), expected: 'auth_error' },
    { input: new Error('Invalid API key'), expected: 'auth_error' },
    { input: new Error('Token expired'), expected: 'auth_error' },
    { input: new Error('Operation timed out'), expected: 'timeout' },
    { input: new Error('ETIMEDOUT'), expected: 'timeout' },
    { input: new Error('deadline exceeded'), expected: 'timeout' },
    { input: new Error('ECONNREFUSED'), expected: 'network' },
    { input: new Error('ENOTFOUND'), expected: 'network' },
    { input: new Error('socket hang up'), expected: 'network' },
    { input: new Error('500 Internal Server Error'), expected: 'server_error' },
    { input: new Error('502 Bad Gateway'), expected: 'server_error' },
    { input: new Error('503 Service Unavailable'), expected: 'server_error' },
    { input: new Error('Invalid output from tool'), expected: 'bad_output' },
    { input: new Error('schema validation failed'), expected: 'bad_output' },
    { input: new Error('whatever'), expected: 'unknown' },
    { input: 'plain string', expected: 'unknown' },
    // Already an ExecutionError: preserve its class
    { input: new ExecutionError('timeout', 'nested'), expected: 'timeout' },
  ];

  for (const { input, expected } of cases) {
    it(`classifies "${input instanceof Error ? input.message : String(input)}" as ${expected}`, () => {
      expect(classifyError(input)).toBe(expected);
    });
  }
});
