import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @jak-swarm/db so loadPrisma() deterministically returns undefined,
// giving the resolver tests full control over every branch. The real prisma
// singleton IS present in the unit environment, which would otherwise make
// the Unconfigured + "env ignored" branches unreachable.
vi.mock('@jak-swarm/db', () => ({ prisma: undefined }));

import {
  resolveCrmAdapterForContext,
  type CrmResolutionContext,
} from '../../../packages/tools/src/adapters/adapter-factory.js';
import { PrismaCRMAdapter } from '../../../packages/tools/src/adapters/crm/prisma-crm.adapter.js';
import { SalesforceCRMAdapter } from '../../../packages/tools/src/adapters/crm/salesforce-crm.adapter.js';
import { UnconfiguredCRMAdapter } from '../../../packages/tools/src/adapters/unconfigured.js';

/**
 * Unit-level coverage for the per-tenant CRM resolver (the component that
 * replaced the process-global singleton). The DB-level cross-tenant proof
 * lives in tests/integration/crm-tenant-isolation.integration.test.ts; this
 * file covers the resolver's branch logic — Salesforce creds, dev-mode env
 * fallback, per-tenant Prisma construction, and the loud Unconfigured stub.
 */
describe('resolveCrmAdapterForContext', () => {
  const envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      'JAK_CRM_SINGLE_TENANT_DEV',
      'SALESFORCE_ACCESS_TOKEN',
      'SALESFORCE_INSTANCE_URL',
      'HUBSPOT_API_KEY',
    ]) {
      envSnapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function ctx(partial: Partial<CrmResolutionContext> & { tenantId: string }): CrmResolutionContext {
    return { tenantId: partial.tenantId, ...partial };
  }

  it('returns an Unconfigured stub when nothing is available (never a process-global fallback)', () => {
    // No dev mode, no creds, no db, and loadPrisma() is mocked to undefined.
    const adapter = resolveCrmAdapterForContext(ctx({ tenantId: 'tenant-x' }));
    expect(adapter).toBeInstanceOf(UnconfiguredCRMAdapter);
  });

  it('constructs a per-tenant Prisma adapter scoped to context.tenantId', async () => {
    let captured: any;
    const stubDb = {
      crmContact: {
        findMany: (...args: any[]) => {
          captured = args[0];
          return Promise.resolve([] as any[]);
        },
      },
    };

    const adapter = resolveCrmAdapterForContext(
      ctx({ tenantId: 'tenant-42', db: stubDb as unknown as CrmResolutionContext['db'] }),
    );

    expect(adapter).toBeInstanceOf(PrismaCRMAdapter);
    // Behavioral proof of tenant scoping: listContacts must filter by the
    // trusted context.tenantId, not 'default' or a process-global tenant.
    await adapter.listContacts();
    expect(captured.where).toEqual({ tenantId: 'tenant-42' });
  });

  it('uses per-tenant Salesforce creds from the context (not process env)', () => {
    // Process env deliberately has NO Salesforce creds here.
    const adapter = resolveCrmAdapterForContext(
      ctx({
        tenantId: 'tenant-sf',
        crmCredentials: { salesforce: { accessToken: 'tok-a', instanceUrl: 'https://acme.my.salesforce.com' } },
      }),
    );
    expect(adapter).toBeInstanceOf(SalesforceCRMAdapter);
    expect(adapter).not.toBeInstanceOf(UnconfiguredCRMAdapter);
  });

  it('in labelled single-tenant dev mode, falls back to env-keyed Salesforce', () => {
    process.env['JAK_CRM_SINGLE_TENANT_DEV'] = '1';
    process.env['SALESFORCE_ACCESS_TOKEN'] = 'env-tok';
    process.env['SALESFORCE_INSTANCE_URL'] = 'https://dev.my.salesforce.com';

    const adapter = resolveCrmAdapterForContext(ctx({ tenantId: 'tenant-dev' }));
    expect(adapter).toBeInstanceOf(SalesforceCRMAdapter);
  });

  it('dev mode is opt-in: without the flag, env Salesforce creds are NOT used (no cross-tenant env bleed)', () => {
    // Env creds present but dev flag NOT set → multi-tenant mode must ignore
    // them. The security property is "env Salesforce is not used"; whether the
    // fallback is Prisma or Unconfigured depends on DB availability, so assert
    // the negative: NOT a Salesforce adapter built from process env.
    process.env['SALESFORCE_ACCESS_TOKEN'] = 'env-tok';
    process.env['SALESFORCE_INSTANCE_URL'] = 'https://dev.my.salesforce.com';

    const adapter = resolveCrmAdapterForContext(ctx({ tenantId: 'tenant-strict' }));
    expect(adapter).not.toBeInstanceOf(SalesforceCRMAdapter);
  });
});