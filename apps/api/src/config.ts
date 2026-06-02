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

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function normalizeSupabaseProjectUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

function hasSupabaseRestPathSuffix(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return false;

  try {
    const pathname = new URL(trimmed).pathname.toLowerCase();
    return pathname === '/rest/v1' || pathname === '/rest/v1/';
  } catch {
    return /\/rest\/v1\/?$/i.test(trimmed);
  }
}

const whatsappNumberMap = parseNumberMap(process.env['WHATSAPP_NUMBER_MAP']);
const whatsappAllowedNumbers = (() => {
  const explicit = parseCsv(process.env['WHATSAPP_ALLOWED_NUMBERS']);
  if (explicit.length > 0) return explicit;
  return whatsappNumberMap.map((entry) => entry.number);
})();
const rawSupabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() ?? '';
const supabaseUrlUsedRestPath = hasSupabaseRestPathSuffix(rawSupabaseUrl);
const normalizedSupabaseUrl = normalizeSupabaseProjectUrl(rawSupabaseUrl);

export const config = {
  nodeEnv,
  port: parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '4000', 10),

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

  // Runtime selection
  // Runtime policy: production API execution supports OpenAI and Gemini providers.
  // LLM_PROVIDER selects the active provider; defaults to 'existing' (OpenAI-only,
  // identical to pre-Gemini behavior). Old JAK_EXECUTION_ENGINE values are accepted
  // only when they name an active runtime; unknown values fail loud.
  llmProvider: (function () {
    const raw = (process.env['LLM_PROVIDER'] ?? 'existing').trim().toLowerCase();
    if (raw !== '' && raw !== 'existing' && raw !== 'openai' && raw !== 'gemini') {
      throw new Error(`LLM_PROVIDER must be 'existing', 'openai', or 'gemini' (got '${raw}')`);
    }
    return (raw || 'existing') as 'existing' | 'openai' | 'gemini';
  })(),
  executionEngine: (function () {
    const raw = (process.env['JAK_EXECUTION_ENGINE'] ?? 'openai-first').trim().toLowerCase();
    if (raw !== '' && raw !== 'openai-first') {
      throw new Error(`JAK_EXECUTION_ENGINE must be unset or 'openai-first' (got '${raw}')`);
    }
    return 'openai-first' as const;
  })(),
  workflowRuntime: (function () {
    const raw = (process.env['JAK_WORKFLOW_RUNTIME'] ?? 'langgraph').trim().toLowerCase();
    if (raw !== '' && raw !== 'langgraph') {
      throw new Error(`JAK_WORKFLOW_RUNTIME must be unset or 'langgraph' (got '${raw}')`);
    }
    return 'langgraph' as const;
  })(),
  // Deprecated migration allowlist retained only for diagnostics/backward
  // compatibility. Empty or populated, the effective production runtime is
  // still OpenAI-only.
  openaiRuntimeAgents: (process.env['JAK_OPENAI_RUNTIME_AGENTS'] ?? '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean),

  // OpenAI API key. Required for production LLM execution.
  openaiApiKey: process.env['OPENAI_API_KEY'] ?? '',
  openaiRealtimeModel: process.env['OPENAI_REALTIME_MODEL'] ?? 'gpt-4o-realtime-preview',
  // Gemini API key. Required when LLM_PROVIDER=gemini.
  geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
  geminiModel: process.env['GEMINI_MODEL'] ?? '',
  geminiRequestTimeoutMs: parseInt(process.env['GEMINI_REQUEST_TIMEOUT_MS'] ?? '60000', 10),
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
  // Slack channel bridge
  slackSigningSecret: process.env['SLACK_SIGNING_SECRET'] ?? '',
  slackClientId: process.env['SLACK_CLIENT_ID'] ?? '',
  slackClientSecret: process.env['SLACK_CLIENT_SECRET'] ?? '',

  // Google OAuth — powers the "Sign in with Google" flow for Gmail / Calendar
  // / Drive integrations. When unset, the OAuth routes return 503 and the
  // frontend falls back to the app-password cred form (legacy path).
  //
  // Setup: https://console.cloud.google.com/apis/credentials
  //   - Application type: Web application
  //   - Authorized redirect URI: ${API_URL}/integrations/oauth/google/callback
  //   - Scopes requested per-integration: Gmail = gmail.send + gmail.readonly
  googleOAuthClientId: process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? '',
  googleOAuthClientSecret: process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? '',
  // Explicit override so deploys behind a reverse proxy / custom domain can
  // set the redirect URI Google is configured with. Falls back to
  // `${API_PUBLIC_URL}/integrations/oauth/google/callback` when unset.
  googleOAuthRedirectUri: process.env['GOOGLE_OAUTH_REDIRECT_URI'] ?? '',
  apiPublicUrl: process.env['API_PUBLIC_URL']?.trim() ?? '',
  webPublicUrl: process.env['WEB_PUBLIC_URL']?.trim() ?? 'http://localhost:3000',

  // ── Additional OAuth app client credentials ───────────────────────────
  // Each provider here requires a separate OAuth app registration in that
  // provider's developer dashboard. Until both ID and SECRET are set,
  // the corresponding OAuth flow returns 503 NOT_CONFIGURED and the
  // ConnectModal falls back to its cred-paste path.
  //
  // Redirect URIs to register (all relative to API_PUBLIC_URL):
  //   Slack   → /integrations/oauth/slack/callback
  //   GitHub  → /integrations/oauth/github/callback
  //   Notion  → /integrations/oauth/notion/callback
  //   Linear  → /integrations/oauth/linear/callback

  // GitHub (separate from slackClientId; Slack already has its own below).
  // Setup: https://github.com/settings/developers → New OAuth App
  githubOAuthClientId: process.env['GITHUB_OAUTH_CLIENT_ID'] ?? '',
  githubOAuthClientSecret: process.env['GITHUB_OAUTH_CLIENT_SECRET'] ?? '',

  // Notion — setup: https://www.notion.so/my-integrations → New public integration
  notionOAuthClientId: process.env['NOTION_OAUTH_CLIENT_ID'] ?? '',
  notionOAuthClientSecret: process.env['NOTION_OAUTH_CLIENT_SECRET'] ?? '',

  // Linear — setup: https://linear.app/settings/api/applications/new
  linearOAuthClientId: process.env['LINEAR_OAUTH_CLIENT_ID'] ?? '',
  linearOAuthClientSecret: process.env['LINEAR_OAUTH_CLIENT_SECRET'] ?? '',

  // LinkedIn — setup: https://www.linkedin.com/developers/apps → Auth tab
  // Required scopes: openid, profile, email, w_member_social (for posting)
  // Redirect URI to register: ${API_PUBLIC_URL}/integrations/oauth/linkedin/callback
  linkedinOAuthClientId: process.env['LINKEDIN_OAUTH_CLIENT_ID'] ?? '',
  linkedinOAuthClientSecret: process.env['LINKEDIN_OAUTH_CLIENT_SECRET'] ?? '',

  // Salesforce — setup: https://help.salesforce.com/articleView?id=connected_app_create.htm
  //   - Connected App with OAuth 2.0 enabled
  //   - Required scopes: api, refresh_token, offline_access
  //   - Redirect URI to register: ${API_PUBLIC_URL}/integrations/oauth/salesforce/callback
  // SALESFORCE_OAUTH_DOMAIN defaults to login.salesforce.com (production).
  // Use test.salesforce.com for sandbox orgs.
  salesforceOAuthClientId: process.env['SALESFORCE_OAUTH_CLIENT_ID'] ?? '',
  salesforceOAuthClientSecret: process.env['SALESFORCE_OAUTH_CLIENT_SECRET'] ?? '',
  salesforceOAuthDomain: (process.env['SALESFORCE_OAUTH_DOMAIN'] ?? 'login.salesforce.com').trim(),

  logLevel: process.env['LOG_LEVEL'] ?? (isProd ? 'info' : 'debug'),
  corsOrigins: (() => {
    const configured = parseCsv(process.env['CORS_ORIGINS']);
    if (configured.length > 0) return configured;
    if (isProd) {
      return ['https://jakswarm.com', 'https://www.jakswarm.com'];
    }
    return ['http://localhost:3000'];
  })(),

  supabaseUrl: normalizedSupabaseUrl,
  supabaseUrlUsedRestPath,
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

  // Company connector autosync runtime (leader-gated in swarm.plugin).
  // Defaults are conservative to keep API load predictable while still
  // giving tenants a hands-free freshness loop for wave-1 providers.
  companyConnectorSyncEnabled: (process.env['COMPANY_CONNECTOR_SYNC_ENABLED'] ?? 'true') === 'true',
  companyConnectorSyncIntervalMs: parsePositiveInt(process.env['COMPANY_CONNECTOR_SYNC_INTERVAL_MS'], 5 * 60 * 1000),
  companyConnectorSyncStaleRunningMs: parsePositiveInt(process.env['COMPANY_CONNECTOR_SYNC_STALE_RUNNING_MS'], 45 * 60 * 1000),
  companyConnectorSyncMaxRunsPerTick: parsePositiveInt(process.env['COMPANY_CONNECTOR_SYNC_MAX_RUNS_PER_TICK'], 12),

  // Observability
  metricsEnabled: (process.env['METRICS_ENABLED'] ?? 'true') === 'true',
  otelExporterUrl: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? '', // empty = disabled
  otelServiceName: process.env['OTEL_SERVICE_NAME'] ?? 'jak-swarm-api',
  shutdownDrainTimeoutMs: parseInt(process.env['SHUTDOWN_DRAIN_TIMEOUT_MS'] ?? '30000', 10),
} as const;

export type Config = typeof config;
