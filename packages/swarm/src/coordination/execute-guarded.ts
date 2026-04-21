/**
 * executeGuarded — single source of truth for async-call resilience in the
 * swarm runtime. Composes timeout + retry + circuit breaker + normalized
 * error taxonomy behind one API so tool loops, LLM calls, and adapter calls
 * all surface failures the same way.
 *
 * Why one wrapper, not ad-hoc composition:
 *
 *   Before this, some call sites wrapped `breaker.call(fn)`, others wrapped
 *   `retry(fn, { backoff })`, a third did both in the "wrong" order (retry
 *   inside breaker vs outside), and a fourth skipped both entirely. This
 *   meant the same failure class (rate_limit, timeout, server_error) got
 *   counted differently by the circuit breaker depending on where in the
 *   stack it originated — a 429 burst from one provider could open a
 *   breaker intended for another.
 *
 *   Centralizing the composition + error taxonomy makes the resilience
 *   contract visible in one file and testable in isolation.
 *
 * Layering order (outside → inside):
 *
 *   1. Circuit breaker — refuses the call outright if the breaker is OPEN.
 *   2. Retry loop      — up to `retries` attempts with exponential backoff.
 *                        Only retries errors classified as `retryable`.
 *   3. Timeout         — each individual attempt is wrapped in Promise.race
 *                        with a setTimeout. A timeout counts as a retryable
 *                        failure for the retry loop but NOT as a breaker
 *                        failure (to avoid opening the breaker on a slow
 *                        downstream that recovers — the retry already
 *                        handles that case).
 *   4. fn              — the user-supplied async function.
 *
 * Error taxonomy:
 *
 *   retryable   → rate_limit, network, timeout, server_error
 *   fatal       → auth_error, bad_output, unknown
 *
 *   Retryable errors burn retries + eventually trip the breaker on
 *   consecutive failures. Fatal errors bypass retry and fail fast.
 */

import type { CircuitBreaker } from '../supervisor/circuit-breaker.js';

// ─── Error taxonomy ────────────────────────────────────────────────────────

export type ExecutionErrorClass =
  | 'rate_limit'
  | 'auth_error'
  | 'timeout'
  | 'server_error'
  | 'bad_output'
  | 'network'
  | 'unknown';

const RETRYABLE_CLASSES: ReadonlySet<ExecutionErrorClass> = new Set([
  'rate_limit',
  'network',
  'timeout',
  'server_error',
]);

/**
 * ExecutionError — wraps the underlying error with a normalized class.
 *
 * Call sites should throw/return instances of this class so downstream
 * observability (Sentry, traces, logs) can group failures by class rather
 * than by message string.
 */
export class ExecutionError extends Error {
  readonly errorClass: ExecutionErrorClass;
  readonly cause: unknown;
  readonly attempt: number;
  readonly elapsedMs: number;

  constructor(
    errorClass: ExecutionErrorClass,
    message: string,
    opts: { cause?: unknown; attempt?: number; elapsedMs?: number } = {},
  ) {
    super(message);
    this.name = 'ExecutionError';
    this.errorClass = errorClass;
    this.cause = opts.cause;
    this.attempt = opts.attempt ?? 1;
    this.elapsedMs = opts.elapsedMs ?? 0;
  }
}

/**
 * classifyError — best-effort mapping of a thrown value to an ExecutionErrorClass.
 * Callers can also construct ExecutionError directly when they know the class;
 * this function is the fallback when we only have a string/Error to go on.
 */
export function classifyError(err: unknown): ExecutionErrorClass {
  if (err instanceof ExecutionError) return err.errorClass;

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (/rate\s*limit|429|quota exceeded|too many requests/.test(lower)) return 'rate_limit';
  if (/unauthorized|401|403|forbidden|invalid api key|auth|token expired/.test(lower)) return 'auth_error';
  if (/timeout|timed out|etimedout|deadline exceeded/.test(lower)) return 'timeout';
  if (/network|enotfound|econnrefused|econnreset|dns|socket hang up/.test(lower)) return 'network';
  if (/\b5\d\d\b|internal server error|bad gateway|service unavailable|gateway timeout/.test(lower)) return 'server_error';
  if (/invalid\s+(output|schema|response|json)|schema validation|malformed/.test(lower)) return 'bad_output';

  return 'unknown';
}

// ─── Guarded execution ─────────────────────────────────────────────────────

export interface ExecuteGuardedOptions {
  /** Per-attempt wall-clock timeout. Default 30s. */
  timeoutMs?: number;
  /** Max retries (NOT counting the initial attempt). Default 2 (→ 3 total tries). */
  retries?: number;
  /** Initial backoff ms. Default 1000. Doubles each retry. */
  retryBackoffMs?: number;
  /**
   * Optional circuit breaker wrapping the entire retry loop. When provided,
   * the breaker sees ONE call per top-level invocation — retries happen inside
   * the breaker, so a burst of transient 429s that eventually succeed never
   * opens the breaker. Only a persistent failure across all retry attempts
   * counts as a breaker failure.
   */
  breaker?: Pick<CircuitBreaker, 'call'>;
  /** Abort signal — if signalled, the current attempt is cancelled. */
  signal?: AbortSignal;
  /** Observability hook called on every retry with the classified error. */
  onRetry?: (attempt: number, errorClass: ExecutionErrorClass, cause: unknown) => void;
}

/**
 * Run `fn` with timeout + retry + circuit breaker + normalized error taxonomy.
 *
 * On success → returns the function's value.
 * On failure after all retries → throws ExecutionError with the final class.
 * On breaker OPEN → throws the breaker's error (DistributedCircuitOpenError or similar).
 *
 * Usage:
 *
 *   const result = await executeGuarded(
 *     () => providerApi.callModel(prompt),
 *     {
 *       timeoutMs: 15_000,
 *       retries: 2,
 *       breaker: getCircuitBreaker(`llm:${provider}`, { failureThreshold: 5 }),
 *       onRetry: (attempt, cls, err) => logger.warn({ attempt, cls, err }, 'LLM retry'),
 *     },
 *   );
 */
export async function executeGuarded<T>(
  fn: () => Promise<T>,
  options: ExecuteGuardedOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 2;
  const retryBackoffMs = options.retryBackoffMs ?? 1_000;
  const { breaker, signal, onRetry } = options;

  const runWithRetries = async (): Promise<T> => {
    let lastError: unknown;
    const started = Date.now();

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      if (signal?.aborted) {
        throw new ExecutionError('timeout', 'Aborted by signal', {
          cause: signal.reason,
          attempt,
          elapsedMs: Date.now() - started,
        });
      }

      try {
        return await runWithTimeout(fn, timeoutMs, signal);
      } catch (err) {
        lastError = err;
        const cls = classifyError(err);

        // Fatal errors → do not retry
        if (!RETRYABLE_CLASSES.has(cls)) {
          throw new ExecutionError(cls, errorMessage(err), {
            cause: err,
            attempt,
            elapsedMs: Date.now() - started,
          });
        }

        // Last attempt failed → re-throw as normalized
        if (attempt > retries) {
          throw new ExecutionError(cls, errorMessage(err), {
            cause: err,
            attempt,
            elapsedMs: Date.now() - started,
          });
        }

        onRetry?.(attempt, cls, err);

        // Exponential backoff with small jitter to avoid thundering herd.
        const delay = retryBackoffMs * 2 ** (attempt - 1);
        const jittered = delay + Math.floor(Math.random() * 100);
        await sleep(jittered);
      }
    }

    // Unreachable — the loop either returns or throws.
    throw new ExecutionError('unknown', 'executeGuarded exited retry loop unexpectedly', {
      cause: lastError,
    });
  };

  if (breaker) {
    return breaker.call<T>(runWithRetries);
  }
  return runWithRetries();
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ExecutionError('timeout', `Operation exceeded ${timeoutMs}ms timeout`));
    }, timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ExecutionError('timeout', 'Aborted by signal', { cause: signal?.reason }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    fn().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
