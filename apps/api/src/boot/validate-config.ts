/**
 * Boot-time configuration validator.
 *
 * Runs before the server starts listening and produces actionable
 * warnings/errors for missing or misconfigured environment variables,
 * unreachable dependencies, and security concerns.
 *
 * Inspired by DeerFlow's startup diagnostics pattern — fail loudly
 * in production, warn helpfully in development.
 */

import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

const WEAK_SECRET_EXACT_VALUES = new Set([
  'changeme',
  'change-me',
  'default',
  'password',
  'secret',
  'test',
  'dev',
  'local',
]);

const WEAK_SECRET_FRAGMENTS = [
  'dev-secret',
  'change-me',
  'changeme',
  'local-dev',
  'not-for-production',
  'never-use-in-prod',
  'placeholder',
  'example-secret',
  'test-secret',
];

export function isLikelyWeakSecret(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 32) return true;
  if (/^(.)\1+$/.test(trimmed)) return true;
  if (new Set(trimmed).size < 10) return true;

  const lower = trimmed.toLowerCase();
  if (WEAK_SECRET_EXACT_VALUES.has(lower)) return true;

  return WEAK_SECRET_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

export function hasSpaceSeparatedCorsOrigins(value: string | undefined): boolean {
  if (!value) return false;

  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(',')) return false;

  const urlMatches = trimmed.match(/https?:\/\/[^\s,]+/gi) ?? [];
  return urlMatches.length > 1;
}

export function hasUnresolvedTemplateValue(value: string | undefined): boolean {
  if (!value) return false;
  return /\$\{\{[^}]+\}\}/.test(value);
}

export async function validateConfigOnBoot(fastify: FastifyInstance): Promise<void> {
  const results: CheckResult[] = [];
  const isProd = config.nodeEnv === 'production';

  // -----------------------------------------------------------------------
  // 1. Required secrets
  // -----------------------------------------------------------------------
  if (config.jwtSecret === 'dev-secret-change-me-NEVER-USE-IN-PROD') {
    results.push({
      name: 'AUTH_SECRET',
      status: isProd ? 'error' : 'warn',
      message: 'Using default JWT secret — set AUTH_SECRET to a strong random value',
    });
  } else {
    results.push({ name: 'AUTH_SECRET', status: 'ok', message: 'JWT secret configured' });
  }

  const authSecret = process.env['AUTH_SECRET']?.trim();
  if (isProd && authSecret && isLikelyWeakSecret(authSecret)) {
    results.push({
      name: 'AUTH_SECRET_STRENGTH',
      status: 'error',
      message: 'AUTH_SECRET appears weak or placeholder-like — use a high-entropy random value (32+ chars)',
    });
  }

  if (isProd) {
    const unresolvedTemplateVars = [
      'DATABASE_URL',
      'DIRECT_URL',
      'REDIS_URL',
      'AUTH_SECRET',
      'OPENAI_API_KEY',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'EVIDENCE_SIGNING_SECRET',
      'METRICS_TOKEN',
    ].filter((name) => hasUnresolvedTemplateValue(process.env[name]));

    if (unresolvedTemplateVars.length > 0) {
      results.push({
        name: 'ENV_TEMPLATE_RESOLUTION',
        status: 'error',
        message:
          'Critical env vars still contain unresolved template expressions: ' +
          unresolvedTemplateVars.join(', '),
      });
    }
  }

  // -----------------------------------------------------------------------
  // 2. OpenAI model execution
  // -----------------------------------------------------------------------
  if (!config.openaiApiKey) {
    results.push({
      name: 'OPENAI_API_KEY',
      status: isProd ? 'error' : 'warn',
      message: 'OPENAI_API_KEY is not set - OpenAI-only agents will not function.',
    });
  } else {
    results.push({
      name: 'OPENAI_API_KEY',
      status: 'ok',
      message: 'OpenAI API key configured',
    });
  }

  // -----------------------------------------------------------------------
  // 2b. Gemini model execution (only when LLM_PROVIDER=gemini)
  // -----------------------------------------------------------------------
  if (config.llmProvider === 'gemini') {
    if (!config.geminiApiKey) {
      results.push({
        name: 'GEMINI_API_KEY',
        status: isProd ? 'error' : 'warn',
        message: 'GEMINI_API_KEY is not set - LLM_PROVIDER=gemini requires a Gemini API key.',
      });
    } else {
      results.push({
        name: 'GEMINI_API_KEY',
        status: 'ok',
        message: 'Gemini API key configured',
      });
    }
  }

  // -----------------------------------------------------------------------
  // 3. Database connectivity
  // -----------------------------------------------------------------------
  try {
    const dbStart = Date.now();
    await fastify.db.$queryRawUnsafe('SELECT 1');
    const latency = Date.now() - dbStart;
    results.push({
      name: 'DATABASE',
      status: latency > 2000 ? 'warn' : 'ok',
      message: latency > 2000
        ? `Database reachable but slow (${latency}ms) — check connection pool`
        : `Database reachable (${latency}ms)`,
    });
  } catch (err) {
    results.push({
      name: 'DATABASE',
      status: 'error',
      message: `Database unreachable: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // -----------------------------------------------------------------------
  // 4. Redis (optional but recommended)
  // -----------------------------------------------------------------------
  if (config.redisUrl) {
    try {
      await fastify.redis.ping();
      results.push({ name: 'REDIS', status: 'ok', message: 'Redis connected' });
    } catch (err) {
      results.push({
        name: 'REDIS',
        status: 'warn',
        message: `Redis configured but unreachable: ${err instanceof Error ? err.message : String(err)}. Falling back to in-memory coordination.`,
      });
    }
  } else {
    results.push({
      name: 'REDIS',
      status: isProd && config.requireRedisInProd ? 'error' : 'warn',
      message: 'REDIS_URL not set — using in-memory coordination (not suitable for multi-instance)',
    });
  }

  if (config.workflowWorkerMode === 'standalone' && !config.redisUrl) {
    results.push({
      name: 'WORKFLOW_WORKER_MODE',
      status: isProd ? 'warn' : 'warn',
      message: 'Standalone worker mode without Redis reduces coordination safety. Set REDIS_URL for cross-process locks, signals, and SSE relay.',
    });
  }

  // -----------------------------------------------------------------------
  // 5. Security checks
  // -----------------------------------------------------------------------
  if (isProd && hasSpaceSeparatedCorsOrigins(process.env['CORS_ORIGINS'])) {
    results.push({
      name: 'CORS_ORIGINS_FORMAT',
      status: 'error',
      message: 'CORS_ORIGINS appears space-separated without commas — use comma-separated origins',
    });
  }

  if (isProd && config.corsOrigins.includes('http://localhost:3000')) {
    results.push({
      name: 'CORS',
      status: 'warn',
      message: 'CORS allows localhost in production — set CORS_ORIGINS to your actual domain',
    });
  }

  if (isProd && config.webPublicUrl.includes('localhost')) {
    results.push({
      name: 'WEB_PUBLIC_URL',
      status: 'warn',
      message: 'WEB_PUBLIC_URL still points at localhost in production — OAuth/callback links may break',
    });
  }

  if (isProd && config.apiPublicUrl && !config.apiPublicUrl.startsWith('https://')) {
    results.push({
      name: 'API_PUBLIC_URL',
      status: 'warn',
      message: 'API_PUBLIC_URL is not https in production — browser and OAuth flows may fail',
    });
  }

  if (isProd && !process.env['PADDLE_WEBHOOK_SECRET']) {
    results.push({
      name: 'PADDLE_WEBHOOK_SECRET',
      status: 'warn',
      message: 'Paddle webhook secret not set — billing webhooks will be rejected',
    });
  }

  if (isProd && !process.env['METRICS_TOKEN']) {
    results.push({
      name: 'METRICS_TOKEN',
      status: 'error',
      message: 'METRICS_TOKEN is not set — production /metrics must require a bearer token',
    });
  }

  if (isProd && (!config.supabaseUrl || !config.supabaseAnonKey)) {
    results.push({
      name: 'SUPABASE_PUBLIC_KEYS',
      status: 'error',
      message: 'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required for production auth and storage flows',
    });
  }

  if (config.supabaseUrlUsedRestPath) {
    results.push({
      name: 'SUPABASE_URL_SHAPE',
      status: 'warn',
      message:
        'NEXT_PUBLIC_SUPABASE_URL was provided as a REST endpoint (/rest/v1). ' +
        'It was normalized to the project origin automatically, but env should be set to https://<project-ref>.supabase.co.',
    });
  }

  if (isProd && !config.supabaseServiceRoleKey) {
    results.push({
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      status: 'error',
      message: 'SUPABASE_SERVICE_ROLE_KEY is required for production artifact/document storage writes',
    });
  }

  const evidenceSecret = process.env['EVIDENCE_SIGNING_SECRET']?.trim();
  if (isProd && (!evidenceSecret || evidenceSecret.length < 16)) {
    results.push({
      name: 'EVIDENCE_SIGNING_SECRET',
      status: 'error',
      message: 'EVIDENCE_SIGNING_SECRET must be set to at least 16 characters for tamper-evident bundles',
    });
  }

  // -----------------------------------------------------------------------
  // 6. Observability
  // -----------------------------------------------------------------------
  if (isProd && !config.otelExporterUrl) {
    results.push({
      name: 'OTEL',
      status: 'warn',
      message: 'OTEL_EXPORTER_OTLP_ENDPOINT not set — traces and metrics will not be exported',
    });
  }

  // -----------------------------------------------------------------------
  // 7. WhatsApp control bridge (optional)
  // -----------------------------------------------------------------------
  const whatsappConfigured = config.whatsappNumberMap.length > 0 || config.whatsappAllowedNumbers.length > 0;

  if (config.whatsappAutoStart && !config.whatsappBridgeToken) {
    results.push({
      name: 'WHATSAPP_BRIDGE_TOKEN',
      status: 'warn',
      message: 'WHATSAPP_AUTO_START is enabled but WHATSAPP_BRIDGE_TOKEN is missing',
    });
  }

  if (config.whatsappAutoStart && !whatsappConfigured) {
    results.push({
      name: 'WHATSAPP_NUMBER_MAP',
      status: 'warn',
      message: 'WHATSAPP_AUTO_START is enabled but no allowlist is configured (users must register numbers in the dashboard)',
    });
  }

  // -----------------------------------------------------------------------
  // Report
  // -----------------------------------------------------------------------
  const errors = results.filter((r) => r.status === 'error');
  const warnings = results.filter((r) => r.status === 'warn');
  const ok = results.filter((r) => r.status === 'ok');

  for (const r of ok) {
    fastify.log.info(`[boot] ✅ ${r.name}: ${r.message}`);
  }
  for (const r of warnings) {
    fastify.log.warn(`[boot] ⚠️  ${r.name}: ${r.message}`);
  }
  for (const r of errors) {
    fastify.log.error(`[boot] ❌ ${r.name}: ${r.message}`);
  }

  fastify.log.info(
    `[boot] Config validation: ${ok.length} ok, ${warnings.length} warnings, ${errors.length} errors`,
  );

  // In production, refuse to start on FATAL config errors — ones that can
  // never self-heal and would make the server dangerous or non-functional.
  // Recoverable errors (DB/Redis temporarily unreachable, missing optional
  // keys) are logged but do NOT block startup — Cloud Run requires the
  // server to bind its port within a strict timeout, and /ready reports 503
  // for any degraded dependencies while /healthz returns 200 (liveness).
  const fatalErrors = errors.filter((e) => e.name === 'AUTH_SECRET' || e.name === 'ENV_TEMPLATE_RESOLUTION');
  if (isProd && fatalErrors.length > 0) {
    throw new Error(
      `[boot] ${fatalErrors.length} fatal config error(s) — refusing to start:\n` +
        fatalErrors.map((e) => `  - ${e.name}: ${e.message}`).join('\n'),
    );
  }

  // Non-fatal errors: log but continue — the server starts in degraded mode.
  // /ready returns 503 until the issue resolves (e.g. DB reconnects, secrets
  // are rotated in). /healthz returns 200 (liveness) so Cloud Run keeps the
  // container alive.
  if (isProd && errors.length > 0) {
    fastify.log.error(
      `[boot] ${errors.length} config error(s) — server starting in degraded mode; /ready will return 503 until resolved`,
    );
  }
}
