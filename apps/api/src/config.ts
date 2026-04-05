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

  redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',

  // OPENAI_API_KEY is required for LLM calls. Agents log a warning if missing.
  openaiApiKey: process.env['OPENAI_API_KEY'] ?? '',
  openaiRealtimeModel: process.env['OPENAI_REALTIME_MODEL'] ?? 'gpt-4o-realtime-preview',

  logLevel: process.env['LOG_LEVEL'] ?? (isProd ? 'info' : 'debug'),
  corsOrigins: (process.env['CORS_ORIGINS'] ?? 'http://localhost:3000').split(','),

  temporalAddress: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  temporalNamespace: process.env['TEMPORAL_NAMESPACE'] ?? 'jak-swarm',
  temporalTaskQueue: process.env['TEMPORAL_TASK_QUEUE'] ?? 'jak-main',
} as const;

export type Config = typeof config;
