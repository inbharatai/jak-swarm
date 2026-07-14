/**
 * Unit tests for `resolveTenantConnectorCredentials` — the live population
 * half of the tenant-credential backbone (PR 2). This is the function the
 * swarm runtime calls to turn a tenant's connected integrations into the
 * decrypted `{ emailCredentials, calendarCredentials, crmCredentials }`
 * bundle that gets registered in the workflowId-keyed side-channel
 * registry (never on serialized SwarmState).
 *
 * What is REAL here:
 *   - `resolveTenantConnectorCredentials` runs unmodified — the Gmail
 *     app-password → email+calendar mapping, the Salesforce access-token
 *     decrypt + instance-URL read, and the "never throw" contract are the
 *     production code path.
 *   - `resolveCredentials` (credential.service) runs for real against the
 *     in-memory Prisma fake; its per-tenant where-clause + decrypt path is
 *     exercised end-to-end.
 *
 * What is faked:
 *   - Prisma (in-memory; mirrors tests/unit/services/credential.service.test.ts).
 *   - crypto encrypt/decrypt (reversible base64 wrapper) so we can assert
 *     the Salesforce token is decrypted from its stored ciphertext without a
 *     real key.
 *
 * Security properties asserted (mandate rules 7 + 8):
 *   - Gmail OAuth access-token shape does NOT populate emailCredentials (the
 *     IMAP adapter can't drive it yet → Unconfigured, never another tenant).
 *   - No env fallback (allowEnvFallback:false): a tenant with no stored Gmail
 *     gets undefined even if the operator's env GMAIL_* is set.
 *   - Salesforce creds come ONLY from this tenant's Integration row (the
 *     where-clause filters by tenantId).
 *   - A tenant with nothing connected gets an all-undefined bundle (never throws).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock crypto BEFORE importing the service (same pattern as
// credential.service.test.ts — config.ts throws without AUTH_SECRET, and we
// want a deterministic reversible transform).
vi.mock('../../../apps/api/src/utils/crypto.js', () => {
  const PREFIX = 'enc::v1::';
  return {
    encrypt: (plaintext: string): string => `${PREFIX}${Buffer.from(plaintext, 'utf8').toString('base64')}`,
    decrypt: (ciphertext: string): string => {
      if (typeof ciphertext !== 'string' || !ciphertext.startsWith(PREFIX)) {
        throw new Error('Invalid encrypted format');
      }
      return Buffer.from(ciphertext.slice(PREFIX.length), 'base64').toString('utf8');
    },
  };
});

import { encrypt as mockedEncrypt } from '../../../apps/api/src/utils/crypto.js';
import { resolveTenantConnectorCredentials } from '../../../apps/api/src/services/tenant-connector-credentials.js';

// ─── In-memory Prisma fake (mirrors credential.service.test.ts) ───────────

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

function makeFakeDb() {
  const integrations: FakeIntegration[] = [];
  const integrationCredentials: FakeIntegrationCredential[] = [];
  let cuid = 0;
  const id = (p: string) => `${p}-${++cuid}`;

  const credsFor = (row: FakeIntegration) =>
    row.credentialsId ? integrationCredentials.find((c) => c.id === row.credentialsId) ?? null : null;
  const match = (row: FakeIntegration, where: any) =>
    (!where.tenantId || row.tenantId === where.tenantId) &&
    (!where.provider || row.provider === where.provider) &&
    (!where.status || row.status === where.status);

  const db: any = {
    integration: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const row = integrations.find((r) => match(r, where ?? {}));
        if (!row) return null;
        const out: any = { ...row };
        if (include?.credentials) out.credentials = credsFor(row);
        return out;
      }),
      findMany: vi.fn(async ({ where }: any) => integrations.filter((r) => match(r, where ?? {})).map((r) => ({ ...r }))),
    },
    integrationCredential: {
      update: vi.fn(async () => ({})),
    },
  };

  const seed = {
    gmailAppPassword(tenantId: string, email: string, appPassword: string) {
      const cred = { id: id('cred'), accessTokenEnc: mockedEncrypt(JSON.stringify({ email, appPassword })), refreshTokenEnc: null, expiresAt: null };
      integrationCredentials.push(cred);
      integrations.push({ id: id('intg'), tenantId, provider: 'GMAIL', status: 'CONNECTED', displayName: email, metadata: { connectedViaOAuth: false }, createdAt: new Date(), lastUsedAt: null, credentialsId: cred.id });
    },
    gmailOauth(tenantId: string, email: string, accessToken: string) {
      // OAuth row: metadata.connectedViaOAuth=true, accessTokenEnc holds the
      // raw access token (NOT a JSON blob). No refresh token here.
      const cred = { id: id('cred'), accessTokenEnc: mockedEncrypt(accessToken), refreshTokenEnc: null, expiresAt: new Date(Date.now() + 60 * 60 * 1000) };
      integrationCredentials.push(cred);
      integrations.push({ id: id('intg'), tenantId, provider: 'GMAIL', status: 'CONNECTED', displayName: email, metadata: { connectedViaOAuth: true }, createdAt: new Date(), lastUsedAt: null, credentialsId: cred.id });
    },
    salesforce(tenantId: string, accessToken: string, instanceUrl: string) {
      const cred = { id: id('cred'), accessTokenEnc: mockedEncrypt(accessToken), refreshTokenEnc: null, expiresAt: null };
      integrationCredentials.push(cred);
      integrations.push({ id: id('intg'), tenantId, provider: 'SALESFORCE', status: 'CONNECTED', displayName: null, metadata: { connectedViaOAuth: true, salesforceInstanceUrl: instanceUrl }, createdAt: new Date(), lastUsedAt: null, credentialsId: cred.id });
    },
  };

  return { db, seed };
}

const ENV_KEYS = ['GMAIL_EMAIL', 'GMAIL_APP_PASSWORD', 'AUTH_SECRET'];
let envSnapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  envSnapshot = {};
  for (const k of ENV_KEYS) envSnapshot[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k]!;
  }
});

describe('resolveTenantConnectorCredentials', () => {
  it('populates email + calendar from a tenant Gmail app-password connection', async () => {
    const { db, seed } = makeFakeDb();
    seed.gmailAppPassword('tenant-a', 'owner@acme.io', 'app-pw-42');

    const bundle = await resolveTenantConnectorCredentials('tenant-a', db);

    expect(bundle.emailCredentials).toEqual({ email: 'owner@acme.io', appPassword: 'app-pw-42' });
    // The CalDAV adapter is Google-specific and uses the SAME app-password.
    expect(bundle.calendarCredentials).toEqual({ email: 'owner@acme.io', appPassword: 'app-pw-42' });
    expect(bundle.crmCredentials).toBeUndefined();
  });

  it('does NOT populate email/calendar for a Gmail OAuth (access-token) connection — IMAP cannot drive it', async () => {
    // Security property (PR 1 contract): an OAuth access-token Gmail connection
    // is NOT driveable by the IMAP/CalDAV adapters. Leaving emailCredentials
    // unset makes the tool resolve to Unconfigured rather than silently using
    // another tenant's creds or the operator's env Gmail.
    const { db, seed } = makeFakeDb();
    seed.gmailOauth('tenant-b', 'oauth@acme.io', 'ya29.oauth-access-token');

    const bundle = await resolveTenantConnectorCredentials('tenant-b', db);

    expect(bundle.emailCredentials).toBeUndefined();
    expect(bundle.calendarCredentials).toBeUndefined();
  });

  it('populates crmCredentials.salesforce by decrypting the token + reading instanceUrl from metadata', async () => {
    const { db, seed } = makeFakeDb();
    seed.salesforce('tenant-c', 'sf-access-token-secret', 'https://acme.my.salesforce.com');

    const bundle = await resolveTenantConnectorCredentials('tenant-c', db);

    expect(bundle.crmCredentials).toEqual({
      salesforce: { accessToken: 'sf-access-token-secret', instanceUrl: 'https://acme.my.salesforce.com' },
    });
    // No Gmail connected → email/calendar stay undefined.
    expect(bundle.emailCredentials).toBeUndefined();
  });

  it('resolves Gmail + Salesforce together for one tenant', async () => {
    const { db, seed } = makeFakeDb();
    seed.gmailAppPassword('tenant-d', 'owner@acme.io', 'app-pw-d');
    seed.salesforce('tenant-d', 'sf-token-d', 'https://acme.my.salesforce.com');

    const bundle = await resolveTenantConnectorCredentials('tenant-d', db);

    expect(bundle.emailCredentials).toEqual({ email: 'owner@acme.io', appPassword: 'app-pw-d' });
    expect(bundle.calendarCredentials).toEqual({ email: 'owner@acme.io', appPassword: 'app-pw-d' });
    expect(bundle.crmCredentials).toEqual({
      salesforce: { accessToken: 'sf-token-d', instanceUrl: 'https://acme.my.salesforce.com' },
    });
  });

  it('returns an all-undefined bundle for a tenant with no connected integrations (never throws)', async () => {
    const { db } = makeFakeDb();

    const bundle = await resolveTenantConnectorCredentials('tenant-empty', db);

    expect(bundle.emailCredentials).toBeUndefined();
    expect(bundle.calendarCredentials).toBeUndefined();
    expect(bundle.crmCredentials).toBeUndefined();
  });

  it('never uses the operator env Gmail for a tenant (allowEnvFallback:false — multi-tenant isolation)', async () => {
    // Operator env creds present, but the tenant has no stored Gmail. The
    // resolver must NOT fall through to env — that would send the tenant's
    // email as the operator.
    process.env['GMAIL_EMAIL'] = 'operator@acme.io';
    process.env['GMAIL_APP_PASSWORD'] = 'op-pw';
    const { db } = makeFakeDb();

    const bundle = await resolveTenantConnectorCredentials('tenant-strict', db);

    expect(bundle.emailCredentials).toBeUndefined();
    expect(bundle.calendarCredentials).toBeUndefined();
  });

  it('is tenant-scoped: a second tenant with no Salesforce gets no crmCredentials even if tenant-c has one', async () => {
    const { db, seed } = makeFakeDb();
    seed.salesforce('tenant-c', 'sf-token-c', 'https://c.my.salesforce.com');

    const bundleOther = await resolveTenantConnectorCredentials('tenant-other', db);

    expect(bundleOther.crmCredentials).toBeUndefined();
    // And tenant-c still resolves its own.
    const bundleC = await resolveTenantConnectorCredentials('tenant-c', db);
    expect(bundleC.crmCredentials?.salesforce?.accessToken).toBe('sf-token-c');
  });

  it('omits crmCredentials.salesforce when the instance URL is missing from metadata', async () => {
    // Defensive: a Salesforce row whose metadata lost the instanceUrl must
    // NOT produce a half crmCredentials (token without instanceUrl is unusable
    // and would let the adapter guess the host). Leave the whole field unset.
    const db: any = {
      integration: {
        findFirst: vi.fn(async () => ({
          id: 'intg-no-url',
          tenantId: 'tenant-e',
          provider: 'SALESFORCE',
          status: 'CONNECTED',
          displayName: null,
          metadata: { connectedViaOAuth: true }, // no salesforceInstanceUrl
          createdAt: new Date(),
          lastUsedAt: null,
          credentialsId: 'cred-no-url',
          credentials: { id: 'cred-no-url', accessTokenEnc: mockedEncrypt('sf-token-no-url'), refreshTokenEnc: null, expiresAt: null },
        })),
      },
    };
    const bundle = await resolveTenantConnectorCredentials('tenant-e', db);
    expect(bundle.crmCredentials).toBeUndefined();
  });

  it('omits crmCredentials.salesforce when the stored token cannot be decrypted (never throws)', async () => {
    // A malformed accessTokenEnc makes decrypt throw. The resolver must
    // swallow it and leave crmCredentials unset — never crash the workflow.
    const db: any = {
      integration: {
        findFirst: vi.fn(async () => ({
          id: 'intg-bad',
          tenantId: 'tenant-bad',
          provider: 'SALESFORCE',
          status: 'CONNECTED',
          displayName: null,
          metadata: { salesforceInstanceUrl: 'https://bad.my.salesforce.com' },
          createdAt: new Date(),
          lastUsedAt: null,
          credentialsId: 'cred-bad',
          credentials: { id: 'cred-bad', accessTokenEnc: 'not-a-valid-cipher', refreshTokenEnc: null, expiresAt: null },
        })),
      },
    };
    const bundle = await resolveTenantConnectorCredentials('tenant-bad', db);
    expect(bundle.crmCredentials).toBeUndefined();
  });
});