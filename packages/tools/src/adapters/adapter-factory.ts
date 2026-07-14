import type { EmailAdapter } from './email/email.interface.js';
import type { CalendarAdapter } from './calendar/calendar.interface.js';
import type { CRMAdapter } from './crm/crm.interface.js';
import { UnconfiguredEmailAdapter, UnconfiguredCalendarAdapter, UnconfiguredCRMAdapter } from './unconfigured.js';
import { GmailImapAdapter } from './email/gmail-imap.adapter.js';
import { CalDAVCalendarAdapter } from './calendar/caldav-calendar.adapter.js';
import { PrismaCRMAdapter } from './crm/prisma-crm.adapter.js';
import type { CrmPrisma } from './crm/prisma-crm.adapter.js';
import { SalesforceCRMAdapter } from './crm/salesforce-crm.adapter.js';
import { HubSpotCRMAdapter } from './crm/hubspot-crm.adapter.js';
// Static import (not a lazy require) so the per-tenant resolver's DB fallback
// is statically resolvable + mockable. @jak-swarm/db is a declared workspace
// dep; constructing PrismaClient is side-effect-free (it connects lazily on
// first query), so importing it here is safe in every environment.
import { prisma as globalPrisma } from '@jak-swarm/db';

export interface GmailCredentials {
  email: string;
  appPassword: string;
}

/**
 * Resolve Gmail credentials from environment variables.
 * Returns null if credentials are not available.
 */
function resolveGmailCredentials(): GmailCredentials | null {
  const email = process.env['GMAIL_EMAIL'];
  const appPassword = process.env['GMAIL_APP_PASSWORD'];

  if (email && appPassword) {
    return { email, appPassword };
  }

  return null;
}

/**
 * Get an email adapter instance.
 * Uses real Gmail IMAP adapter if credentials are available,
 * otherwise returns an unconfigured stub that throws on use.
 */
export function getEmailAdapter(): EmailAdapter {
  const creds = resolveGmailCredentials();

  if (creds) {
    return new GmailImapAdapter(creds);
  }

  return new UnconfiguredEmailAdapter();
}

/**
 * Get a calendar adapter instance.
 * Uses real CalDAV adapter if credentials are available,
 * otherwise returns an unconfigured stub that throws on use.
 */
export function getCalendarAdapter(): CalendarAdapter {
  const creds = resolveGmailCredentials();

  if (creds) {
    return new CalDAVCalendarAdapter(creds);
  }

  return new UnconfiguredCalendarAdapter();
}

/**
 * Check whether real (non-mock) adapters are available.
 */
export function hasRealAdapters(): boolean {
  return resolveGmailCredentials() !== null;
}

/**
 * Get a CRM adapter backed by Prisma/PostgreSQL.
 * Requires a Prisma client and tenant ID (for row-level isolation).
 * If no db is provided, returns undefined — the caller can decide
 * whether to fall back to the unconfigured stub.
 */
export function getCRMAdapter(db: unknown, tenantId: string): CRMAdapter | undefined {
  if (db && typeof db === 'object' && 'crmContact' in db) {
    return new PrismaCRMAdapter(db as any, tenantId);
  }
  return undefined;
}

/**
 * Get the best available CRM adapter from environment.
 * Priority: Salesforce (env token) > HubSpot API > Prisma DB > undefined
 *
 * Salesforce is env-keyed here for one-off scripts and tests; the primary
 * production path is the per-tenant adapter constructed by
 * `getSalesforceCRMAdapterForTenant()` below, which reads the decrypted
 * access token + instance URL from the Integration row.
 */
export function getCRMAdapterFromEnv(tenantId?: string): CRMAdapter | undefined {
  // 1. Try Salesforce (env-keyed fallback for local dev + tests)
  const sfToken = process.env['SALESFORCE_ACCESS_TOKEN'];
  const sfInstance = process.env['SALESFORCE_INSTANCE_URL'];
  if (sfToken && sfInstance) {
    return new SalesforceCRMAdapter({ accessToken: sfToken, instanceUrl: sfInstance });
  }

  // 2. Try HubSpot
  const hubspotKey = process.env['HUBSPOT_API_KEY'];
  if (hubspotKey) {
    return new HubSpotCRMAdapter(hubspotKey);
  }

  // 3. Try Prisma DB
  const prisma = loadPrisma();
  if (prisma) {
    return new PrismaCRMAdapter(prisma, tenantId ?? 'default');
  }

  return undefined;
}

/**
 * Lazily load the process-global Prisma client from @jak-swarm/db.
 * Returns undefined when the DB client has no CRM models (e.g. a schema
 * without crm_* tables). Kept as a helper so both the env-keyed fallback
 * above and the per-tenant resolver below share one load path.
 */
function loadPrisma(): CrmPrisma | undefined {
  const prisma = globalPrisma as unknown as CrmPrisma | undefined;
  if (prisma?.crmContact) return prisma;
  return undefined;
}

/**
 * Construct a Salesforce adapter from the per-tenant OAuth credentials
 * stored during the /integrations/oauth/salesforce/callback flow.
 * Returns undefined when the tenant hasn't connected Salesforce or when
 * the access token/instance URL are missing.
 *
 * Callers pass the already-decrypted token (from
 * `credential.service.getDecryptedToken`) and the instance URL from the
 * Integration row's metadata.
 */
export function getSalesforceCRMAdapterForTenant(params: {
  accessToken: string | null | undefined;
  instanceUrl: string | null | undefined;
}): CRMAdapter | undefined {
  if (!params.accessToken || !params.instanceUrl) return undefined;
  return new SalesforceCRMAdapter({
    accessToken: params.accessToken,
    instanceUrl: params.instanceUrl,
  });
}

/**
 * Per-tenant credentials carried on the tool execution context. The
 * `salesforce` pair is the already-decrypted OAuth token + instance URL
 * that apps/api reads from the tenant's Integration row via
 * `credential.service.getDecryptedToken` — it must never come from a
 * process-global env var in a multi-tenant deployment.
 */
export interface TenantCrmCredentials {
  salesforce?: { accessToken: string; instanceUrl: string };
}

/**
 * The minimal slice of {@link ToolExecutionContext} the resolver reads.
 * Kept structural so this factory stays decoupled from @jak-swarm/shared;
 * the real context satisfies it.
 */
export interface CrmResolutionContext {
  /** Trusted tenant id, set by the workflow/auth layer — never from request input. */
  tenantId: string;
  /** Optional DB client forwarded by the runtime; falls back to the global prisma. */
  db?: { crmContact?: unknown };
  /** Per-tenant decrypted OAuth/API credentials, when the tenant has connected them. */
  crmCredentials?: TenantCrmCredentials;
}

/**
 * Resolve a CRM adapter for a single tool execution, scoped to the calling
 * tenant. This replaces the process-global singleton
 * `getCRMAdapterFromEnv()` that previously bound the whole process to one
 * tenant's adapter (or `'default'`).
 *
 * Resolution order:
 *  1. **Labelled single-tenant dev mode** (`JAK_CRM_SINGLE_TENANT_DEV=1`):
 *     the env-keyed adapter (Salesforce > HubSpot > Prisma). Explicit opt-in
 *     for local scripts/tests ONLY — never the default in a multi-tenant
 *     deployment, because env-keyed creds are shared across all tenants.
 *  2. **Per-tenant Salesforce**: when the context carries decrypted OAuth
 *     creds for this tenant, build the Salesforce adapter via
 *     {@link getSalesforceCRMAdapterForTenant}. This is the wire-up that
 *     makes the per-tenant factory REACHABLE from the live tool path.
 *  3. **Per-tenant Prisma**: a fresh `PrismaCRMAdapter` constructed with
 *     `context.tenantId` (row-level isolation). The DB client comes from
 *     `context.db` when the runtime forwards one, else the global prisma.
 *  4. **Unconfigured**: a stub that throws on use — no silent fallthrough
 *     to another tenant's data.
 */
export function resolveCrmAdapterForContext(context: CrmResolutionContext): CRMAdapter {
  // 1. Labelled single-tenant dev mode.
  if (process.env['JAK_CRM_SINGLE_TENANT_DEV'] === '1') {
    const env = getCRMAdapterFromEnv(context.tenantId);
    if (env) return env;
  }

  // 2. Per-tenant Salesforce (OAuth creds decrypted by apps/api credential service).
  const sf = context.crmCredentials?.salesforce;
  if (sf?.accessToken && sf?.instanceUrl) {
    const tenantSf = getSalesforceCRMAdapterForTenant(sf);
    if (tenantSf) return tenantSf;
  }

  // 3. Per-tenant Prisma adapter — row-level isolation by context.tenantId.
  const db = (context.db && 'crmContact' in context.db ? context.db : undefined) ?? loadPrisma();
  if (db && 'crmContact' in db) {
    return new PrismaCRMAdapter(db as any, context.tenantId);
  }

  // 4. No tenant-specific CRM configured — fail loudly, never fall back to a
  //    process-global adapter that could serve another tenant's data.
  return new UnconfiguredCRMAdapter();
}
