/**
 * Per-tenant connector credential resolution for a workflow run.
 *
 * This is the live population half of the tenant-credential backbone
 * (PR 1 added the resolvers + ToolExecutionContext fields; this resolves
 * the actual decrypted credentials from the tenant's Integration rows).
 * It is the ONE place that turns a tenant's connected integrations into
 * the decrypted `{ emailCredentials, calendarCredentials, crmCredentials }`
 * bundle the swarm runtime registers in the side-channel registry.
 *
 * Security contract (mandate rule 7 + the no-secret-in-SwarmState rule):
 *  - Reads ONLY the calling tenant's Integration rows (filtered by tenantId).
 *  - Returns decrypted secrets to the caller in-memory; the caller registers
 *    them in the workflowId-keyed side-channel registry, never on SwarmState.
 *  - `allowEnvFallback: false` — in a multi-tenant deploy, process-env
 *    connector creds are the OPERATOR's and must never be used on a tenant's
 *    behalf. Single-tenant dev that wants env-keyed connectors uses the
 *    labelled opt-in flags the resolvers already check
 *    (JAK_EMAIL_SINGLE_TENANT_DEV etc.), NOT this path.
 *  - Never throws: a tenant who hasn't connected a provider gets `undefined`
 *    for that field, and the tool resolver returns its Unconfigured stub.
 *
 * Gmail note: only the app-password shape drives the IMAP/CalDAV adapters.
 * An OAuth-access-token Gmail connection is NOT IMAP-driveable yet (the
 * adapter would need an XOAUTH2 path), so it is deliberately left unset —
 * the tool resolves to Unconfigured rather than silently using another
 * tenant's creds or the operator's env Gmail.
 */

import type { PrismaClient } from '@jak-swarm/db';
import { resolveCredentials } from './credential.service.js';
import { decrypt as decryptCredentialBlob } from '../utils/crypto.js';

export interface TenantConnectorCredentials {
  emailCredentials?: { email: string; appPassword: string };
  calendarCredentials?: { email: string; appPassword: string };
  crmCredentials?: { salesforce?: { accessToken: string; instanceUrl: string } };
}

/**
 * Resolve the decrypted connector credentials for a single tenant.
 *
 * Returns an object whose fields are `undefined` when the tenant hasn't
 * connected (or couldn't be decrypted for) that provider. Never throws —
 * callers register the whole bundle in the side-channel registry and
 * the resolvers treat each `undefined` field as "not configured".
 */
export async function resolveTenantConnectorCredentials(
  tenantId: string,
  db: PrismaClient,
): Promise<TenantConnectorCredentials> {
  const bundle: TenantConnectorCredentials = {};

  // Gmail app-password → drives BOTH email (IMAP/SMTP) and calendar
  // (CalDAV basic-auth is Google-specific and uses the same app-password).
  // allowEnvFallback:false so a multi-tenant deploy never silently uses the
  // operator's env Gmail for a tenant.
  const gmail = await resolveCredentials(tenantId, 'GMAIL', db, { allowEnvFallback: false });
  if (gmail && 'appPassword' in gmail && gmail.appPassword) {
    bundle.emailCredentials = { email: gmail.email, appPassword: gmail.appPassword };
    bundle.calendarCredentials = { email: gmail.email, appPassword: gmail.appPassword };
  }

  // Salesforce OAuth: the access token is stored raw (not JSON) in
  // IntegrationCredential.accessTokenEnc; the instance URL is kept in the
  // Integration row's metadata under `salesforceInstanceUrl` (written by the
  // /integrations/oauth/salesforce/callback flow). Wrapped so a corrupt row
  // (failed decrypt, missing instanceUrl) leaves crmCredentials unset rather
  // than throwing — this helper's contract is "never throws"; the caller
  // registers whatever bundle comes back and the resolver treats undefined
  // as "not configured".
  try {
    const sfIntegration = await db.integration.findFirst({
      where: { tenantId, provider: 'SALESFORCE', status: 'CONNECTED' },
      include: { credentials: true },
    });
    if (sfIntegration?.credentials?.accessTokenEnc) {
      const sfToken = decryptCredentialBlob(sfIntegration.credentials.accessTokenEnc);
      const sfInstanceUrl = (sfIntegration.metadata as Record<string, unknown> | null)?.['salesforceInstanceUrl'] as
        | string
        | undefined;
      if (sfToken && sfInstanceUrl) {
        bundle.crmCredentials = { salesforce: { accessToken: sfToken, instanceUrl: sfInstanceUrl } };
      }
    }
  } catch {
    // Salesforce resolution failure must never block the workflow; the CRM
    // tool resolver falls back to Unconfigured (or per-tenant Prisma) for
    // this tenant.
  }

  return bundle;
}