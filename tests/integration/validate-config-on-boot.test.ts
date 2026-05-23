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

async function runBootValidation(overrides: EnvMap = {}): Promise<void> {
  applyEnv(overrides);
  vi.resetModules();
  const { validateConfigOnBoot } = await import('../../apps/api/src/boot/validate-config.ts');
  await validateConfigOnBoot(createFastifyStub() as any);
}

describe('validateConfigOnBoot production fail-hard behavior', () => {
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

  it('passes with a valid production baseline', async () => {
    await expect(runBootValidation()).resolves.toBeUndefined();
  });

  it('fails hard for weak AUTH_SECRET values', async () => {
    await expect(runBootValidation({ AUTH_SECRET: weakAuthSecretFixture })).rejects.toThrow(
      /AUTH_SECRET_STRENGTH/i,
    );
  });

  it('fails hard for malformed space-separated CORS_ORIGINS', async () => {
    await expect(
      runBootValidation({ CORS_ORIGINS: 'https://jakswarm.com https://www.jakswarm.com' }),
    ).rejects.toThrow(/CORS_ORIGINS_FORMAT/i);
  });

  it('fails hard for unresolved template expressions in critical env vars', async () => {
    await expect(runBootValidation({ REDIS_URL: '${{Redis.REDIS_URL}}' })).rejects.toThrow(
      /ENV_TEMPLATE_RESOLUTION/i,
    );
  });
});
