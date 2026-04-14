const nodeEnv = process.env['NODE_ENV'] ?? 'development';
const isProd = nodeEnv === 'production';

/**
 * Reads a required environment variable. In production, throws if absent.
 * In development, returns the fallback silently.
 */
function required(key: string, fallback: string): string {
  const value = process.env[key];
  if (!value) {
    if (isProd) {
      throw new Error(
        `[Config] Required environment variable '${key}' is not set. ` +
          'Check your deployment configuration.',
      );
    }
    return fallback;
  }
  return value;
}

export const config = {
  nodeEnv,
  port: parseInt(process.env['API_PORT'] ?? '4000', 10),

  // In production, JWT secret MUST be set to a strong random value.
  jwtSecret: required('AUTH_SECRET', 'dev-secret-change-me-NEVER-USE-IN-PROD'),
  jwtExpiresIn: '7d',

  // Database URL is required in all environments once the DB is up.
  databaseUrl: required('DATABASE_URL', 'postgresql://jakswarm:jakswarm@localhost:5432/jakswarm'),

  redisUrl: process.env['REDIS_URL']?.trim() || null,

  // LLM provider API keys. At least one is required. Agents log a warning if all are missing.
  openaiApiKey: process.env['OPENAI_API_KEY'] ?? '',
  openaiRealtimeModel: process.env['OPENAI_REALTIME_MODEL'] ?? 'gpt-4o-realtime-preview',
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
  geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
  deepseekApiKey: process.env['DEEPSEEK_API_KEY'] ?? '',
  ollamaBaseUrl: process.env['OLLAMA_BASE_URL'] ?? '',
  openrouterApiKey: process.env['OPENROUTER_API_KEY'] ?? '',

  // Slack channel bridge
  slackSigningSecret: process.env['SLACK_SIGNING_SECRET'] ?? '',
  slackClientId: process.env['SLACK_CLIENT_ID'] ?? '',
  slackClientSecret: process.env['SLACK_CLIENT_SECRET'] ?? '',

  logLevel: process.env['LOG_LEVEL'] ?? (isProd ? 'info' : 'debug'),
  corsOrigins: (process.env['CORS_ORIGINS'] ?? 'http://localhost:3000').split(','),

  supabaseUrl: process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() ?? '',
  supabaseAnonKey: process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']?.trim() ?? '',

  temporalAddress: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  temporalNamespace: process.env['TEMPORAL_NAMESPACE'] ?? 'jak-swarm',
  temporalTaskQueue: process.env['TEMPORAL_TASK_QUEUE'] ?? 'jak-main',

  // Observability
  metricsEnabled: (process.env['METRICS_ENABLED'] ?? 'true') === 'true',
  otelExporterUrl: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? '', // empty = disabled
  otelServiceName: process.env['OTEL_SERVICE_NAME'] ?? 'jak-swarm-api',
  shutdownDrainTimeoutMs: parseInt(process.env['SHUTDOWN_DRAIN_TIMEOUT_MS'] ?? '30000', 10),
} as const;

export type Config = typeof config;
