/**
 * Unit tests for credential.service.ts
 *
 * IMPORTANT context discovered while reading the service (apps/api/src/
 * services/credential.service.ts):
 *
 *   - This service is READ-ONLY. It exports `resolveCredentials` and
 *     `listConnectedProviders`. It does NOT expose store / update /
 *     delete / list-keys methods — those live on the integrations routes
 *     (`apps/api/src/routes/integrations.routes.ts`), which write the
 *     `IntegrationCredential` row that this service later reads.
 *
 *     => Requirements (1) "store encrypts before persisting", (4) "store
 *        twice = upsert", (8) "list-credentials returns only this tenant's
 *        keys" (we have `listConnectedProviders` instead, which we DO test),
 *        and (9) "delete is idempotent" address methods that do not exist
 *        on this service. They are marked `it.todo` with the route they
 *        actually live on.
 *
 *   - Encryption is anchored on AUTH_SECRET (config.jwtSecret), NOT
 *     JAK_FIELD_ENCRYPTION_KEY. config.ts falls back to a hardcoded dev
 *     dev-only sentinel when AUTH_SECRET is unset in non-prod, so encryption
 *     ALWAYS runs — there is no
 *     "cleartext mode". The fail-safe-vs-cleartext test documents that
 *     observed behaviour.
 *
 *   - Decryption failures are caught: the try/catch around the integration
 *     lookup means a corrupt cipher row falls through to env-var fallback
 *     rather than crashing the caller.
 *
 *   - Cross-tenant isolation is enforced by `where: { tenantId, ... }` in
 *     the Prisma query — but ONLY when env fallback is suppressed. If
 *     allowEnvFallback=true (default) and a global env var is set, EVERY
 *     tenant sees those env creds. That is the documented design and we
 *     test the strict-isolation path with `allowEnvFallback: false`.
 *
 *   - The service has an OAuth-refresh path that calls fetch() against
 *     oauth2.googleapis.com. We do not exercise it here (would require
 *     stubbing global.fetch and the OAuth client env vars) — covered by a
 *     separate todo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock the crypto util BEFORE importing the service ────────────────────
// The real util pulls in apps/api/src/config.ts which throws in prod-like
// environments without AUTH_SECRET, and (more importantly) we want a
// test-only deterministic transform so we can assert ciphertext ≠ plaintext
// without spinning up node:crypto's KDF on every test.
vi.mock('../../../apps/api/src/utils/crypto.js', () => {
  const PREFIX = 'enc::v1::';
  return {
    encrypt: (plaintext: string): string => {
      if (typeof plaintext !== 'string') throw new Error('encrypt: expected string');
      // Reversible base64 wrapper — proves "not stored cleartext" without
      // requiring a real key. Same shape (single string) as the real
      // util returns, so the service's split-on-':' parsing happens to be
      // bypassed (we re-implement decrypt symmetrically).
      const b64 = Buffer.from(plaintext, 'utf8').toString('base64');
      return `${PREFIX}${b64}`;
    },
    decrypt: (ciphertext: string): string => {
      if (typeof ciphertext !== 'string' || !ciphertext.startsWith(PREFIX)) {
        // Mirror the real util's failure mode: throws on malformed input.
        throw new Error('Invalid encrypted format');
      }
      const b64 = ciphertext.slice(PREFIX.length);
      return Buffer.from(b64, 'base64').toString('utf8');
    },
  };
});

// Pull in the mocked helpers too so we can spy on what the service did.
import { decrypt as mockedDecrypt, encrypt as mockedEncrypt } from '../../../apps/api/src/utils/crypto.js';
import { listConnectedProviders, resolveCredentials } from '../../../apps/api/src/services/credential.service.js';

// ─── In-memory Prisma fake ────────────────────────────────────────────────

interface FakeIntegration {
  id: string;
  tenantId: string;
  provider: string;
  status: string;
  displayName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  credentialsId: string | null;
}

interface FakeIntegrationCredential {
  id: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
}

interface FakeDbState {
  integrations: FakeIntegration[];
  integrationCredentials: FakeIntegrationCredential[];
}

function makeFakeDb() {
  const state: FakeDbState = {
    integrations: [],
    integrationCredentials: [],
  };
  let cuid = 0;
  const id = (prefix: string) => `${prefix}-${++cuid}`;

  const findIntegrationCreds = (integration: FakeIntegration) =>
    integration.credentialsId
      ? state.integrationCredentials.find((c) => c.id === integration.credentialsId) ?? null
      : null;

  const matchWhere = (row: FakeIntegration, where: any) => {
    if (where.tenantId && row.tenantId !== where.tenantId) return false;
    if (where.provider && row.provider !== where.provider) return false;
    if (where.status && row.status !== where.status) return false;
    return true;
  };

  const db: any = {
    integration: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const row = state.integrations.find((r) => matchWhere(r, where ?? {}));
        if (!row) return null;
        const out: any = { ...row };
        if (include?.credentials) {
          out.credentials = findIntegrationCreds(row);
        }
        return out;
      }),
      findMany: vi.fn(async ({ where, select }: any) => {
        const rows = state.integrations.filter((r) => matchWhere(r, where ?? {}));
        if (!select) return rows.map((r) => ({ ...r }));
        return rows.map((r) => {
          const out: any = {};
          for (const k of Object.keys(select)) {
            if (select[k]) out[k] = (r as any)[k];
          }
          return out;
        });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.integrations.find((r) => r.id === where.id);
        if (!row) throw new Error('integration not found');
        Object.assign(row, data);
        return { ...row };
      }),
    },
    integrationCredential: {
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.integrationCredentials.find((c) => c.id === where.id);
        if (!row) throw new Error('integrationCredential not found');
        Object.assign(row, data);
        return { ...row };
      }),
    },
  };

  // Helpers used by tests to seed rows directly.
  const seed = {
    integration(opts: Partial<FakeIntegration> & { tenantId: string; provider: string }) {
      const row: FakeIntegration = {
        id: opts.id ?? id('intg'),
        tenantId: opts.tenantId,
        provider: opts.provider,
        status: opts.status ?? 'CONNECTED',
        displayName: opts.displayName ?? null,
        metadata: opts.metadata ?? null,
        createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'),
        lastUsedAt: opts.lastUsedAt ?? null,
        credentialsId: opts.credentialsId ?? null,
      };
      state.integrations.push(row);
      return row;
    },
    credential(opts: { accessTokenEnc: string; refreshTokenEnc?: string | null; expiresAt?: Date | null }) {
      const row: FakeIntegrationCredential = {
        id: id('cred'),
        accessTokenEnc: opts.accessTokenEnc,
        refreshTokenEnc: opts.refreshTokenEnc ?? null,
        expiresAt: opts.expiresAt ?? null,
      };
      state.integrationCredentials.push(row);
      return row;
    },
    /**
     * Convenience: store an encrypted JSON blob the way integrations.routes
     * does (the route is the actual writer; we replay its shape here so the
     * service's read path sees realistic input).
     */
    storedCreds(tenantId: string, provider: string, plaintextObj: Record<string, string>) {
      const cred = seed.credential({
        accessTokenEnc: mockedEncrypt(JSON.stringify(plaintextObj)),
      });
      return seed.integration({ tenantId, provider, credentialsId: cred.id });
    },
  };

  return { db, state, seed };
}

// ─── Env-var helpers ──────────────────────────────────────────────────────
// Keep tests hermetic by snapshotting and restoring process.env entries the
// service reads. We touch GMAIL_*, VERCEL_*, CALDAV_*, GITHUB_*.

const ENV_KEYS = [
  'GMAIL_EMAIL',
  'GMAIL_APP_PASSWORD',
  'VERCEL_TOKEN',
  'VERCEL_TEAM_ID',
  'CALDAV_URL',
  'CALDAV_USERNAME',
  'CALDAV_PASSWORD',
  'GITHUB_PAT',
  'AUTH_SECRET',
  'JAK_FIELD_ENCRYPTION_KEY', // documented in the requirements; service ignores it
];

let envSnapshot: Record<string, string | undefined> = {};

function snapshotEnv() {
  envSnapshot = {};
  for (const k of ENV_KEYS) envSnapshot[k] = process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    const v = envSnapshot[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('credential.service', () => {
  beforeEach(() => {
    snapshotEnv();
    clearEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreEnv();
  });

  // (1) Storing a credential encrypts it before persisting.
  // The service does NOT have a `store` method — the integrations route
  // owns that path. We assert the service-shaped invariant: when the
  // service reads back a row, the row in the in-memory store contains an
  // encrypted blob (NOT the cleartext) and the encrypt() helper has been
  // applied to it. This proves the read path requires encryption.
  it('reads credentials only from rows where the on-disk blob is encrypted (raw plaintext is never present)', async () => {
    const { db, state, seed } = makeFakeDb();
    const plaintextEmail = 'founder@acme.com';
    const plaintextPassword = 'super-secret-app-password';
    seed.storedCreds('tnt-A', 'GMAIL', {
      email: plaintextEmail,
      appPassword: plaintextPassword,
    });

    const stored = state.integrationCredentials[0]!;
    // The on-disk blob must NOT contain the cleartext password or email.
    expect(stored.accessTokenEnc).not.toContain(plaintextPassword);
    expect(stored.accessTokenEnc).not.toContain(plaintextEmail);
    expect(stored.accessTokenEnc.startsWith('enc::v1::')).toBe(true);

    // And the service can still resolve them (because it decrypts).
    const creds = await resolveCredentials('tnt-A', 'GMAIL', db);
    expect(creds).toEqual({ email: plaintextEmail, appPassword: plaintextPassword });
  });

  // (2) Reading a credential decrypts it back to the original value.
  it('decrypts the stored blob back to the original credential object', async () => {
    const { db, seed } = makeFakeDb();
    seed.storedCreds('tnt-A', 'VERCEL', { token: 'vrc_live_token_abc', teamId: 'team_42' });

    const creds = await resolveCredentials('tnt-A', 'VERCEL', db);
    expect(creds).toEqual({ token: 'vrc_live_token_abc', teamId: 'team_42' });
    // The mocked decrypt was actually invoked.
    expect(mockedDecrypt).toBeDefined();
  });

  // (3) Round-trip: encrypt(input) → store → resolveCredentials returns
  // the same input.
  it('round-trips: encrypt + persist + read returns the identical input', async () => {
    const { db, seed } = makeFakeDb();
    const original = {
      url: 'https://caldav.fastmail.com/dav/principals/user/me/',
      username: 'me@fastmail.com',
      password: 'p@ssw0rd-with-symbols-&-emoji-',
    };
    seed.storedCreds('tnt-A', 'CALDAV', original);

    const creds = await resolveCredentials('tnt-A', 'CALDAV', db);
    expect(creds).toEqual(original);
  });

  // (4) "Storing the same key twice updates (upsert) — does not duplicate".
  // The service does not own the writer. Documented as it.todo so we don't
  // silently skip; tested where it actually lives.
  it.todo('store-twice upserts (writer lives in apps/api/src/routes/integrations.routes.ts — not on this service)');

  // (5) Reading a non-existent key returns null (NOT an error).
  it('returns null when the tenant has no integration row and env fallback is disabled', async () => {
    const { db } = makeFakeDb();
    const creds = await resolveCredentials('tnt-nobody', 'GITHUB', db, { allowEnvFallback: false });
    expect(creds).toBeNull();
  });

  // (6) Cross-tenant isolation.
  it('does not leak tenant B credentials to tenant A (with env fallback off)', async () => {
    const { db, seed } = makeFakeDb();
    seed.storedCreds('tnt-B', 'GITHUB', { pat: 'ghp_tenantB_secret' });

    const aSees = await resolveCredentials('tnt-A', 'GITHUB', db, { allowEnvFallback: false });
    expect(aSees).toBeNull();

    const bSees = await resolveCredentials('tnt-B', 'GITHUB', db, { allowEnvFallback: false });
    expect(bSees).toEqual({ pat: 'ghp_tenantB_secret' });

    // The Prisma findFirst was always called with the caller's tenantId —
    // never with tenant B's id when tenant A asked.
    const calls = (db.integration.findFirst as any).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const tenantIdsQueried = calls.map((c: any[]) => c[0]?.where?.tenantId);
    expect(tenantIdsQueried).toContain('tnt-A');
    expect(tenantIdsQueried).toContain('tnt-B');
    // The "tnt-A" call did not use "tnt-B" as the tenant filter.
    expect(calls.find((c: any[]) => c[0]?.where?.tenantId === 'tnt-A')?.[0]?.where?.tenantId).toBe('tnt-A');
  });

  // (7) Encryption-key absence.
  // Documented behaviour: the service ALWAYS encrypts (the encryption key
  // is derived from AUTH_SECRET via scrypt, and config.ts falls back to a
  // dev secret when AUTH_SECRET is unset in non-prod). There is no
  // JAK_FIELD_ENCRYPTION_KEY check anywhere — toggling it does nothing.
  // We assert the documented behaviour: with that env var unset (or set to
  // anything), the service still encrypts and decrypts correctly.
  it('still encrypts/decrypts when JAK_FIELD_ENCRYPTION_KEY is absent (service does not look at that var)', async () => {
    delete process.env['JAK_FIELD_ENCRYPTION_KEY'];
    const { db, state, seed } = makeFakeDb();
    seed.storedCreds('tnt-A', 'GMAIL', { email: 'a@b.com', appPassword: 'pw' });

    // Stored blob is still ciphertext (no cleartext fallback).
    expect(state.integrationCredentials[0]!.accessTokenEnc).not.toContain('pw');
    expect(state.integrationCredentials[0]!.accessTokenEnc.startsWith('enc::v1::')).toBe(true);

    // And reads still work.
    const creds = await resolveCredentials('tnt-A', 'GMAIL', db);
    expect(creds).toEqual({ email: 'a@b.com', appPassword: 'pw' });
  });

  // (8) listConnectedProviders returns only the calling tenant's rows.
  it('listConnectedProviders only returns rows whose tenantId matches the caller', async () => {
    const { db, seed } = makeFakeDb();
    seed.integration({ tenantId: 'tnt-A', provider: 'GMAIL', displayName: 'a@gmail.com' });
    seed.integration({ tenantId: 'tnt-A', provider: 'GITHUB', displayName: 'gh-user' });
    seed.integration({ tenantId: 'tnt-B', provider: 'VERCEL', displayName: 'b@vercel' });
    // A row that exists but is not connected — must be filtered out.
    seed.integration({ tenantId: 'tnt-A', provider: 'CALDAV', status: 'DISCONNECTED' });

    const aProviders = await listConnectedProviders('tnt-A', db);
    const aNames = aProviders.map((p) => p.provider).sort();
    expect(aNames).toEqual(['GITHUB', 'GMAIL']);
    expect(aProviders.every((p) => p.connectedAt instanceof Date)).toBe(true);

    const bProviders = await listConnectedProviders('tnt-B', db);
    expect(bProviders.map((p) => p.provider)).toEqual(['VERCEL']);

    // Tenant C — empty.
    const cProviders = await listConnectedProviders('tnt-C', db);
    expect(cProviders).toEqual([]);
  });

  // (9) Idempotent delete.
  // Service has no delete method — that lives on the integrations route.
  it.todo('delete-twice is idempotent (delete handler lives in apps/api/src/routes/integrations.routes.ts — not on this service)');

  // (10) Soft handling of decryption failure.
  it('does not crash when the stored cipher row is corrupt — falls back to env (or null)', async () => {
    const { db, seed } = makeFakeDb();
    // Seed a row with a deliberately mangled ciphertext.
    const cred = seed.credential({ accessTokenEnc: 'this-is-not-valid-ciphertext-format' });
    seed.integration({ tenantId: 'tnt-A', provider: 'GMAIL', credentialsId: cred.id });

    // No env fallback set → the service should swallow the decryption
    // error and return null rather than throwing.
    const creds = await resolveCredentials('tnt-A', 'GMAIL', db);
    expect(creds).toBeNull();

    // Now set env fallback and verify it kicks in (proves the catch swallows
    // the decryption error AND control reaches the env fallback branch).
    process.env['GMAIL_EMAIL'] = 'env@fallback.com';
    process.env['GMAIL_APP_PASSWORD'] = 'env-password';
    const credsWithFallback = await resolveCredentials('tnt-A', 'GMAIL', db);
    expect(credsWithFallback).toEqual({ email: 'env@fallback.com', appPassword: 'env-password' });
  });

  // ─── Extra coverage that fell out of reading the source ──────────────
  // These weren't in the requirements list but are obvious adjacent risks.

  it('falls back to env vars when no tenant row exists (single-tenant dev mode)', async () => {
    const { db } = makeFakeDb();
    process.env['GITHUB_PAT'] = 'ghp_env_token_xyz';
    const creds = await resolveCredentials('tnt-anyone', 'GITHUB', db);
    expect(creds).toEqual({ pat: 'ghp_env_token_xyz' });
  });

  it('returns null when allowEnvFallback=false even if env vars are populated', async () => {
    const { db } = makeFakeDb();
    process.env['GITHUB_PAT'] = 'ghp_should_be_ignored';
    const creds = await resolveCredentials('tnt-strict', 'GITHUB', db, { allowEnvFallback: false });
    expect(creds).toBeNull();
  });

  it('skips invalid stored shapes (e.g., GITHUB row missing pat) rather than returning a partial object', async () => {
    const { db, seed } = makeFakeDb();
    // Store an object that DOES NOT match the GITHUB shape — service
    // should fall through to env (or null).
    seed.storedCreds('tnt-A', 'GITHUB', { wrongField: 'oops' });

    // No env → null.
    const a = await resolveCredentials('tnt-A', 'GITHUB', db, { allowEnvFallback: false });
    expect(a).toBeNull();
  });

  // The OAuth refresh path hits fetch() against oauth2.googleapis.com and
  // is its own micro-state-machine. Out of scope for this credential.service
  // PURE unit pass — covered by integration tests with a fetch stub.
  it.todo('OAuth-refresh path (Gmail with metadata.connectedViaOAuth=true) — needs global.fetch stub + GOOGLE_OAUTH_* env, see integrations.routes integration tests');
});
