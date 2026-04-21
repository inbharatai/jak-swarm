/**
 * Sentry integration — graceful-no-op when SENTRY_DSN is unset.
 *
 * The landing page's "Sentry MCP" tile already documents that JAK uses Sentry
 * as an MCP-server target for agent queries. This file is the SECOND Sentry
 * surface: the runtime SDK that captures uncaught errors, breaker opens,
 * failed approvals, and realtime provider errors from the API process itself.
 *
 * Both are legitimate and non-overlapping:
 *   - MCP Sentry    → agents can CALL Sentry to query issues/alerts.
 *   - SDK Sentry    → JAK emits telemetry INTO a Sentry project operators own.
 *
 * This module is import-safe even when @sentry/node throws during
 * initialization — we catch + log + continue. Observability failures never
 * take the API down.
 */

import { config } from '../config.js';
import { createLogger } from '@jak-swarm/shared';

const logger = createLogger('sentry');

let sentryInitialized = false;
// Lazily cached SDK export so we don't pay the require cost when unset.
type SentryModule = typeof import('@sentry/node');
let sentry: SentryModule | null = null;

/**
 * Initialize the Sentry SDK exactly once. Safe to call even with no DSN —
 * in that case, this function logs "disabled" and returns without side effects.
 *
 * Call this BEFORE fastify.listen() so uncaught errors during request handling
 * are captured. Tracing sample rate defaults to 10%; increase for staging
 * debugging, decrease for cost-sensitive production.
 */
export async function initSentry(): Promise<void> {
  if (sentryInitialized) return;

  if (!config.sentryDsn) {
    logger.info('[sentry] SENTRY_DSN not set — Sentry disabled (no overhead)');
    sentryInitialized = true;
    return;
  }

  try {
    sentry = await import('@sentry/node');

    sentry.init({
      dsn: config.sentryDsn,
      environment: config.sentryEnvironment,
      tracesSampleRate: config.sentryTracesSampleRate,
      profilesSampleRate: config.sentryProfilesSampleRate,

      // Drop known-noisy transactions from CI + health checks so we don't
      // burn quota on non-production events.
      ignoreTransactions: ['/health', '/ready', '/metrics', 'GET /favicon.ico'],

      // PII scrubbing — remove anything that could leak a tenant secret or
      // a user credential. Runs on every event before it leaves the process.
      beforeSend(event) {
        return scrubSensitive(event) as typeof event;
      },
      beforeBreadcrumb(breadcrumb) {
        return scrubSensitive(breadcrumb) as typeof breadcrumb;
      },
    });

    sentryInitialized = true;
    logger.info(
      {
        environment: config.sentryEnvironment,
        tracesSampleRate: config.sentryTracesSampleRate,
      },
      '[sentry] initialized',
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[sentry] init failed — continuing without Sentry',
    );
    sentryInitialized = true; // mark so we don't retry on every call
    sentry = null;
  }
}

/**
 * Capture an exception. No-op if Sentry is not configured.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!sentry) return;
  try {
    sentry.captureException(err, { extra: context });
  } catch {
    // Never throw from the observability path
  }
}

/**
 * Capture a structured event (breaker open, approval rejected, budget exceeded).
 * No-op if Sentry is not configured.
 */
export function captureEvent(
  name: string,
  data: Record<string, unknown>,
  level: 'info' | 'warning' | 'error' = 'warning',
): void {
  if (!sentry) return;
  try {
    sentry.captureMessage(name, {
      level,
      extra: data,
    });
  } catch {
    // swallow
  }
}

/**
 * Flush pending events before shutdown. 2-second timeout matches Render's
 * default grace period for SIGTERM → SIGKILL.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!sentry) return;
  try {
    await sentry.flush(timeoutMs);
  } catch {
    // swallow
  }
}

// ─── PII scrubbing ─────────────────────────────────────────────────────────
// Runs on every outbound event. Strips anything that looks like a JWT, API
// key, session cookie, or Supabase-signed URL. The patterns are intentionally
// broad: false positives (a "redacted" placeholder for what was a benign
// string) are ALWAYS preferable to leaking a secret.

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{40,}\b/g,
  /\bAIza[A-Za-z0-9_-]{35}\b/g,
  /\bghp_[A-Za-z0-9]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\brediss?:\/\/[^:\s]+:[^@\s]+@\S+/g,                                 // redis URL w/ creds
  /\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@\S+/g,                         // postgres URL w/ creds
];

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token']);

type Scrubbable =
  | { request?: { headers?: Record<string, unknown>; data?: unknown } }
  | { data?: { headers?: Record<string, unknown>; data?: unknown } }
  | Record<string, unknown>;

function scrubSensitive<T extends Scrubbable>(event: T): T {
  // Scrub structured request headers (Sentry puts these on `event.request`
  // for transactions and `event.data` for breadcrumbs).
  const req = (event as { request?: { headers?: Record<string, unknown> } }).request;
  if (req?.headers) {
    for (const key of Object.keys(req.headers)) {
      if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
        req.headers[key] = '[REDACTED]';
      }
    }
  }

  const bc = (event as { data?: { headers?: Record<string, unknown> } }).data;
  if (bc?.headers && typeof bc.headers === 'object') {
    for (const key of Object.keys(bc.headers)) {
      if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
        bc.headers[key] = '[REDACTED]';
      }
    }
  }

  // Scrub secrets anywhere in stringified payload via pattern replacement.
  // JSON stringify the whole event, run replacements, parse back.
  try {
    let s = JSON.stringify(event);
    for (const pat of SECRET_PATTERNS) {
      s = s.replace(pat, '[REDACTED]');
    }
    return JSON.parse(s) as T;
  } catch {
    // If scrubbing fails for any reason, return the original event — better
    // to send it (Sentry scrubs server-side too) than drop it entirely.
    return event;
  }
}
