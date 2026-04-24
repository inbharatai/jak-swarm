import type { EmailAdapter } from './email/email.interface.js';
import type { CalendarAdapter } from './calendar/calendar.interface.js';
import type { CRMAdapter } from './crm/crm.interface.js';
import { UnconfiguredEmailAdapter, UnconfiguredCalendarAdapter } from './unconfigured.js';
import { GmailImapAdapter } from './email/gmail-imap.adapter.js';
import { CalDAVCalendarAdapter } from './calendar/caldav-calendar.adapter.js';
import { PrismaCRMAdapter } from './crm/prisma-crm.adapter.js';

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SalesforceCRMAdapter } = require('./crm/salesforce-crm.adapter.js');
    return new SalesforceCRMAdapter({ accessToken: sfToken, instanceUrl: sfInstance });
  }

  // 2. Try HubSpot
  const hubspotKey = process.env['HUBSPOT_API_KEY'];
  if (hubspotKey) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HubSpotCRMAdapter } = require('./crm/hubspot-crm.adapter.js');
    return new HubSpotCRMAdapter(hubspotKey);
  }

  // 3. Try Prisma DB
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbModule = require('@jak-swarm/db');
    const prisma = dbModule.prisma;
    if (prisma?.crmContact) {
      return new PrismaCRMAdapter(prisma, tenantId ?? 'default');
    }
  } catch {
    // DB not available
  }

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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SalesforceCRMAdapter } = require('./crm/salesforce-crm.adapter.js');
  return new SalesforceCRMAdapter({
    accessToken: params.accessToken,
    instanceUrl: params.instanceUrl,
  });
}
