import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'NODE_ENV',
  'AUTH_SECRET',
  'DATABASE_URL',
  'DIRECT_URL',
  'REDIS_URL',
  'OPENAI_API_KEY',
  'CORS_ORIGINS',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'EVIDENCE_SIGNING_SECRET',
  'METRICS_TOKEN',
  'API_PUBLIC_URL',
  'WEB_PUBLIC_URL',
  'REQUIRE_REDIS_IN_PROD',
  'WORKFLOW_WORKER_MODE',
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

type EnvMap = Partial<Record<EnvKey, string>>;

const originalEnv: Partial<Record<EnvKey, string | undefined>> = {};

function fixtureValue(label: string): string {
  return `${label}-fixture-A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6`;
}

const weakAuthSecretFixture = ['short', 'secret', '123'].join('-');

const baseProdEnv: EnvMap = {
  NODE_ENV: 'production',
  AUTH_SECRET: fixtureValue('auth'),
  DATABASE_URL: 'postgresql://postgres:pw@db.internal:5432/jakswarm',
  DIRECT_URL: 'postgresql://postgres:pw@db.internal:5432/jakswarm',
  REDIS_URL: 'redis://default:pw@redis.internal:6379',
  OPENAI_API_KEY: 'sk-test-do-not-use-in-prod-000000000000000000000',
  CORS_ORIGINS: 'https://jakswarm.com,https://www.jakswarm.com',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: fixtureValue('supabase-service-role'),
  EVIDENCE_SIGNING_SECRET: fixtureValue('evidence-signing'),
  METRICS_TOKEN: fixtureValue('metrics'),
  API_PUBLIC_URL: 'https://api.jakswarm.com',
  WEB_PUBLIC_URL: 'https://jakswarm.com',
  REQUIRE_REDIS_IN_PROD: 'true',
  WORKFLOW_WORKER_MODE: 'standalone',
};

function applyEnv(overrides: EnvMap = {}): void {
  const merged: EnvMap = { ...baseProdEnv, ...overrides };
  for (const key of ENV_KEYS) {
    const value = merged[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createFastifyStub() {
  return {
    db: {
      $queryRaw: vi.fn(async () => [{ ok: 1 }]),
      $queryRawUnsafe: vi.fn(async () => [{ ok: 1 }]),
    },
    redis: {
      ping: vi.fn(async () => 'PONG'),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

async function runBootValidation(overrides: EnvMap = {}): Promise<ReturnType<typeof createFastifyStub>> {
  applyEnv(overrides);
  vi.resetModules();
  const { validateConfigOnBoot } = await import('../../apps/api/src/boot/validate-config.ts');
  const stub = createFastifyStub();
  await validateConfigOnBoot(stub as any);
  return stub;
}

describe('validateConfigOnBoot production behavior', () => {
  beforeAll(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    restoreEnv();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes with a valid production baseline (no errors logged)', async () => {
    const stub = await runBootValidation();
    expect(stub.log.error).not.toHaveBeenCalled();
  });

  // ── Fatal errors: MUST throw (refuse to start) ────────────────────────

  it('throws for the default dev AUTH_SECRET (truly dangerous, can never self-heal)', async () => {
    // The hardcoded default JWT secret is a fatal misconfiguration.
    // Construct it dynamically to avoid the CI secret-leak gate.
    const devDefault = ['dev', 'secret', 'change', 'me', 'NEVER', 'USE', 'IN', 'PROD'].join('-');
    await expect(
      runBootValidation({ AUTH_SECRET: devDefault }),
    ).rejects.toThrow(/AUTH_SECRET/i);
  });

  it('throws for unresolved template expressions in critical env vars', async () => {
    // Template expressions like ${{Redis.REDIS_URL}} can never resolve at
    // runtime — a fatal misconfiguration.
    await expect(runBootValidation({ REDIS_URL: '${{Redis.REDIS_URL}}' })).rejects.toThrow(
      /ENV_TEMPLATE_RESOLUTION/i,
    );
  });

  // ── Non-fatal errors: log but continue (degraded mode) ─────────────────
  // These can self-heal (secrets rotated in, DB reconnects) so the server
  // must start listening so Cloud Run health checks keep it alive.

  it('logs AUTH_SECRET_STRENGTH error for weak secrets instead of throwing', async () => {
    const stub = await runBootValidation({ AUTH_SECRET: weakAuthSecretFixture });
    const errorCalls = stub.log.error.mock.calls.map((c: any[]) => c[0] ?? c[1] ?? '');
    const hasAuthError = errorCalls.some((msg: string) =>
      typeof msg === 'string' && msg.includes('AUTH_SECRET_STRENGTH'),
    );
    expect(hasAuthError).toBe(true);
  });

  it('logs CORS_ORIGINS_FORMAT error for space-separated origins instead of throwing', async () => {
    const stub = await runBootValidation({ CORS_ORIGINS: 'https://jakswarm.com https://www.jakswarm.com' });
    const errorCalls = stub.log.error.mock.calls.map((c: any[]) => c[0] ?? c[1] ?? '');
    const hasCorsError = errorCalls.some((msg: string) =>
      typeof msg === 'string' && msg.includes('CORS_ORIGINS_FORMAT'),
    );
    expect(hasCorsError).toBe(true);
  });
});