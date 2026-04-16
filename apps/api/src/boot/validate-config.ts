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

  // -----------------------------------------------------------------------
  // 2. LLM providers — at least one must be configured
  // -----------------------------------------------------------------------
  const llmProviders = [
    { key: 'OPENAI_API_KEY', value: config.openaiApiKey },
    { key: 'ANTHROPIC_API_KEY', value: config.anthropicApiKey },
    { key: 'GEMINI_API_KEY', value: config.geminiApiKey },
    { key: 'DEEPSEEK_API_KEY', value: config.deepseekApiKey },
    { key: 'OPENROUTER_API_KEY', value: config.openrouterApiKey },
  ];
  const configuredProviders = llmProviders.filter((p) => p.value.length > 0);

  if (configuredProviders.length === 0 && !config.ollamaBaseUrl) {
    results.push({
      name: 'LLM_PROVIDERS',
      status: isProd ? 'error' : 'warn',
      message: 'No LLM provider API key set — agents will not function. Set at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY',
    });
  } else {
    results.push({
      name: 'LLM_PROVIDERS',
      status: 'ok',
      message: `${configuredProviders.length} provider(s) configured: ${configuredProviders.map((p) => p.key).join(', ')}${config.ollamaBaseUrl ? ' + Ollama' : ''}`,
    });
  }

  // -----------------------------------------------------------------------
  // 3. Database connectivity
  // -----------------------------------------------------------------------
  try {
    const dbStart = Date.now();
    await fastify.db.$queryRaw`SELECT 1`;
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
      status: 'warn',
      message: 'REDIS_URL not set — using in-memory coordination (not suitable for multi-instance)',
    });
  }

  // -----------------------------------------------------------------------
  // 5. Security checks
  // -----------------------------------------------------------------------
  if (isProd && config.corsOrigins.includes('http://localhost:3000')) {
    results.push({
      name: 'CORS',
      status: 'warn',
      message: 'CORS allows localhost in production — set CORS_ORIGINS to your actual domain',
    });
  }

  if (isProd && !process.env['PADDLE_WEBHOOK_SECRET']) {
    results.push({
      name: 'PADDLE_WEBHOOK_SECRET',
      status: 'warn',
      message: 'Paddle webhook secret not set — billing webhooks will be rejected',
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

  // In production, fail hard if there are critical errors
  if (isProd && errors.length > 0) {
    throw new Error(
      `[boot] ${errors.length} critical config error(s) — refusing to start:\n` +
        errors.map((e) => `  - ${e.name}: ${e.message}`).join('\n'),
    );
  }
}
