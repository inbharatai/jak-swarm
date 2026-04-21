const nodeEnv = process.env['NODE_ENV'] ?? 'development';
const isProd = nodeEnv === 'production';
const isDev = nodeEnv === 'development';

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

function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/^whatsapp:/i, '').replace('@s.whatsapp.net', '').replace(/\D/g, '');
}

function parseNumberMap(value?: string): Array<{ number: string; tenantId: string; userId: string }> {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawNumber, tenantId, userId] = entry.split(':').map((part) => part.trim());
      if (!rawNumber || !tenantId || !userId) return null;
      return {
        number: normalizePhoneNumber(rawNumber),
        tenantId,
        userId,
      };
    })
    .filter((entry): entry is { number: string; tenantId: string; userId: string } => Boolean(entry));
}

const whatsappNumberMap = parseNumberMap(process.env['WHATSAPP_NUMBER_MAP']);
const whatsappAllowedNumbers = (() => {
  const explicit = parseCsv(process.env['WHATSAPP_ALLOWED_NUMBERS']);
  if (explicit.length > 0) return explicit;
  return whatsappNumberMap.map((entry) => entry.number);
})();

export const config = {
  nodeEnv,
  port: parseInt(process.env['API_PORT'] ?? '4000', 10),

  // In production, JWT secret MUST be set to a strong random value.
  jwtSecret: required('AUTH_SECRET', 'dev-secret-change-me-NEVER-USE-IN-PROD'),
  jwtExpiresIn: '7d',

  // Database URL is required in all environments once the DB is up.
  databaseUrl: required('DATABASE_URL', 'postgresql://jakswarm:jakswarm@localhost:5432/jakswarm'),

  redisUrl: process.env['REDIS_URL']?.trim() || null,
  requireRedisInProd: (process.env['REQUIRE_REDIS_IN_PROD'] ?? 'false') === 'true',
  workflowWorkerMode: (process.env['WORKFLOW_WORKER_MODE'] ?? 'embedded') as
    | 'embedded'
    | 'standalone',

  // LLM provider API keys. At least one is required. Agents log a warning if all are missing.
  openaiApiKey: process.env['OPENAI_API_KEY'] ?? '',
  openaiRealtimeModel: process.env['OPENAI_REALTIME_MODEL'] ?? 'gpt-4o-realtime-preview',
  // WebRTC ICE servers for voice sessions.
  // Google STUN is a permissive default that works from most residential networks.
  // For corporate networks behind symmetric NAT, operators should provision a
  // TURN server (e.g. via Twilio Network Traversal or coturn) and set these
  // three env vars; the voice route will then emit a turn: URL alongside the
  // stun: fallback so clients can connect through the relay when direct
  // peer-to-peer fails.
  voiceTurnUrl: process.env['VOICE_TURN_URL'] ?? '',       // e.g. turn:relay.example.com:3478
  voiceTurnUsername: process.env['VOICE_TURN_USERNAME'] ?? '',
  voiceTurnCredential: process.env['VOICE_TURN_CREDENTIAL'] ?? '',

  // Sentry — optional. When SENTRY_DSN is unset, the init becomes a silent
  // no-op and zero bytes are shipped to Sentry. Operators turn this on by
  // adding SENTRY_DSN to the Render env. tracesSampleRate + profilesSampleRate
  // are tunable via env in case the default 10% produces too much volume.
  sentryDsn: process.env['SENTRY_DSN'] ?? '',
  sentryEnvironment: process.env['SENTRY_ENVIRONMENT'] ?? (process.env['NODE_ENV'] ?? 'development'),
  sentryTracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
  sentryProfilesSampleRate: Number(process.env['SENTRY_PROFILES_SAMPLE_RATE'] ?? '0.1'),
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
  // Service-role key — server-side only, NEVER exposed to the client.
  // Required for Supabase Storage uploads in the tenant-documents bucket.
  // Must be rotated whenever it appears in a log/screenshot/commit (see
  // SECURITY.md rotation policy + the 2026-04-18 memory note).
  supabaseServiceRoleKey: process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim() ?? '',

  // WhatsApp control bridge (QR-based, Baileys client)
  whatsappAutoStart: (process.env['WHATSAPP_AUTO_START'] ?? (isDev ? '1' : '0')) === '1',
  whatsappClientPort: parseInt(process.env['WHATSAPP_CLIENT_PORT'] ?? '47891', 10),
  whatsappBridgeToken: process.env['WHATSAPP_BRIDGE_TOKEN'] ?? '',
  whatsappNumberMap,
  whatsappAllowedNumbers,

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
