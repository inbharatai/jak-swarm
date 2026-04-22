/**
 * Per-tenant credential resolution service.
 *
 * JAK Swarm has two credential models co-existing:
 *
 *   1. Global env-var credentials — simplest, suitable for single-tenant dev
 *      or self-hosted deploys. Keys like GMAIL_EMAIL, GMAIL_APP_PASSWORD,
 *      VERCEL_TOKEN live on the API's process env. All tenants share them.
 *
 *   2. Per-tenant BYO credentials — stored encrypted in the
 *      integration_credentials table, keyed by (tenantId, provider). Required
 *      for any commercial multi-tenant deploy so one tenant's Gmail doesn't
 *      send another tenant's email.
 *
 * This service is the ONE place that resolves which of the two applies. Tool
 * adapters call `resolveCredentials(tenantId, 'GMAIL' | 'VERCEL' | ...)` and
 * get back a typed credentials object — or null if not configured.
 *
 * Resolution order:
 *   1. Per-tenant stored credentials (if any) — win always
 *   2. Global env-var fallback (if env is set) — useful for single-tenant
 *      deploys where the operator has their own Gmail/Vercel and every
 *      tenant is "them"
 *   3. null — credentials not available; tool should return a graceful
 *      "not configured" error to the user, not crash
 *
 * Usage from a tool adapter (example — email sender):
 *
 *   import { resolveCredentials } from '../services/credential.service.js';
 *   const creds = await resolveCredentials(ctx.tenantId, 'GMAIL', db);
 *   if (!creds) return { error: 'Gmail not connected for this tenant' };
 *   await sendViaImap({ user: creds.email, password: creds.appPassword }, ...);
 *
 * Providers supported (add here + add to MCP_PROVIDERS or a credentials-only
 * provider list on the frontend when adding a new one):
 *   - GMAIL        { email, appPassword }
 *   - VERCEL       { token, teamId? }
 *   - CALDAV       { url, username, password }
 *   - GITHUB       { pat }
 *   - (MCP providers handled separately via IntegrationCredential table)
 */

import type { PrismaClient } from '@jak-swarm/db';
import { decrypt as decryptCredentials, encrypt as encryptCredentials } from '../utils/crypto.js';

export type BYOProvider = 'GMAIL' | 'VERCEL' | 'CALDAV' | 'GITHUB';

// ─── Typed credentials per provider ────────────────────────────────────────

/**
 * Two shapes live under the GMAIL provider:
 *
 *   - Legacy App-Password flow: { email, appPassword } — IMAP/SMTP auth.
 *     The user generates an app password at google.com/apppasswords and
 *     pastes it into ConnectModal. Still supported for single-tenant
 *     deploys / operators who prefer not to register an OAuth app.
 *
 *   - OAuth PKCE flow: { email, accessToken, refreshToken?, expiresAt? } —
 *     populated by the /integrations/oauth/google/callback route. The
 *     accessToken is short-lived (~60 min); callers get a fresh one via
 *     `resolveCredentials` which auto-refreshes when expiresAt is past.
 *
 * Tool adapters should accept whichever shape comes back and branch on the
 * presence of `accessToken` vs `appPassword`.
 */
export type GmailCredentials =
  | { email: string; appPassword: string }
  | { email: string; accessToken: string; refreshToken?: string; expiresAt?: Date };

export interface VercelCredentials {
  token: string;
  teamId?: string;
}

export interface CalDavCredentials {
  url: string;
  username: string;
  password: string;
}

export interface GitHubCredentials {
  pat: string;
}

export type ProviderCredentials =
  | { provider: 'GMAIL'; creds: GmailCredentials }
  | { provider: 'VERCEL'; creds: VercelCredentials }
  | { provider: 'CALDAV'; creds: CalDavCredentials }
  | { provider: 'GITHUB'; creds: GitHubCredentials };

// ─── Env-var fallback resolvers ────────────────────────────────────────────
// These mirror the current single-tenant env lookups at
// packages/tools/src/adapters/adapter-factory.ts — so behaviour when a
// tenant has not connected their own creds matches the pre-BYO state.

function envGmail(): GmailCredentials | null {
  const email = process.env['GMAIL_EMAIL'];
  const appPassword = process.env['GMAIL_APP_PASSWORD'];
  if (email && appPassword) return { email, appPassword };
  return null;
}

function envVercel(): VercelCredentials | null {
  const token = process.env['VERCEL_TOKEN'];
  if (!token) return null;
  const teamId = process.env['VERCEL_TEAM_ID'];
  return teamId ? { token, teamId } : { token };
}

function envCalDav(): CalDavCredentials | null {
  const url = process.env['CALDAV_URL'];
  const username = process.env['CALDAV_USERNAME'];
  const password = process.env['CALDAV_PASSWORD'];
  if (url && username && password) return { url, username, password };
  return null;
}

function envGitHub(): GitHubCredentials | null {
  const pat = process.env['GITHUB_PAT'];
  if (!pat) return null;
  return { pat };
}

// ─── Per-tenant resolver ──────────────────────────────────────────────────

interface TenantCredentialLookupOptions {
  /**
   * Allow fallback to env vars when no tenant-stored credential exists.
   * Default true — preserves single-tenant dev behaviour. Set to false
   * in strict multi-tenant deploys to force BYO.
   */
  allowEnvFallback?: boolean;
}

/**
 * Resolve credentials for a specific (tenant, provider) pair.
 *
 * Returns null if neither tenant storage nor env fallback has valid creds.
 * Caller is expected to handle null gracefully (return "not configured" to
 * the user rather than crashing the tool call).
 *
 * The decryption path runs against the encrypted blob stored by
 * integrations.routes.ts during the "Connect Gmail" / "Connect Vercel"
 * OAuth / app-password flow.
 */
export async function resolveCredentials(
  tenantId: string,
  provider: 'GMAIL',
  db: PrismaClient,
  opts?: TenantCredentialLookupOptions,
): Promise<GmailCredentials | null>;
export async function resolveCredentials(
  tenantId: string,
  provider: 'VERCEL',
  db: PrismaClient,
  opts?: TenantCredentialLookupOptions,
): Promise<VercelCredentials | null>;
export async function resolveCredentials(
  tenantId: string,
  provider: 'CALDAV',
  db: PrismaClient,
  opts?: TenantCredentialLookupOptions,
): Promise<CalDavCredentials | null>;
export async function resolveCredentials(
  tenantId: string,
  provider: 'GITHUB',
  db: PrismaClient,
  opts?: TenantCredentialLookupOptions,
): Promise<GitHubCredentials | null>;
export async function resolveCredentials(
  tenantId: string,
  provider: BYOProvider,
  db: PrismaClient,
  opts: TenantCredentialLookupOptions = {},
): Promise<unknown> {
  const allowEnvFallback = opts.allowEnvFallback ?? true;

  // 1. Try tenant-scoped stored credentials
  try {
    const integration = await db.integration.findFirst({
      where: { tenantId, provider, status: 'CONNECTED' },
      include: { credentials: true },
    });
    if (integration?.credentials?.accessTokenEnc) {
      // GMAIL via OAuth PKCE: metadata.connectedViaOAuth=true, accessTokenEnc
      // holds the raw access_token (NOT a JSON blob). Refresh if expired.
      const isOAuth =
        provider === 'GMAIL' &&
        (integration.metadata as Record<string, unknown> | null)?.['connectedViaOAuth'] === true;

      if (isOAuth) {
        const refreshed = await ensureFreshOAuthToken(db, integration.id, integration.credentials);
        if (refreshed) {
          return {
            email: integration.displayName ?? '',
            accessToken: refreshed.accessToken,
            ...(refreshed.refreshToken ? { refreshToken: refreshed.refreshToken } : {}),
            ...(refreshed.expiresAt ? { expiresAt: refreshed.expiresAt } : {}),
          } as GmailCredentials;
        }
        // Refresh failed — fall through to legacy parse attempt so the old
        // app-password path still resolves for tenants who haven't migrated.
      }

      const decrypted = decryptCredentials(integration.credentials.accessTokenEnc);
      const parsed = (() => { try { return JSON.parse(decrypted) as unknown; } catch { return null; } })();
      if (parsed && typeof parsed === 'object') {
        // Map the stored fields to the typed provider shape
        const c = parsed as Record<string, string>;
        switch (provider) {
          case 'GMAIL':
            if (c['email'] && c['appPassword']) {
              return { email: c['email'], appPassword: c['appPassword'] };
            }
            break;
          case 'VERCEL':
            if (c['token']) {
              return c['teamId'] ? { token: c['token'], teamId: c['teamId'] } : { token: c['token'] };
            }
            break;
          case 'CALDAV':
            if (c['url'] && c['username'] && c['password']) {
              return { url: c['url'], username: c['username'], password: c['password'] };
            }
            break;
          case 'GITHUB':
            if (c['pat']) return { pat: c['pat'] };
            break;
        }
      }
    }
  } catch {
    // DB lookup failure falls through to env fallback rather than erroring;
    // the caller sees "not configured" and can prompt the user.
  }

  // 2. Env-var fallback (single-tenant / dev behaviour)
  if (allowEnvFallback) {
    switch (provider) {
      case 'GMAIL':
        return envGmail();
      case 'VERCEL':
        return envVercel();
      case 'CALDAV':
        return envCalDav();
      case 'GITHUB':
        return envGitHub();
    }
  }

  return null;
}

// ─── OAuth token refresh ──────────────────────────────────────────────────
// When a Gmail integration was connected via the OAuth PKCE flow, the stored
// access_token is short-lived (~60 min). We refresh on the fly and persist
// the new token + expiresAt so the caller always gets a fresh credential.

interface IntegrationCredentialRow {
  id: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
}

async function ensureFreshOAuthToken(
  db: PrismaClient,
  integrationId: string,
  creds: IntegrationCredentialRow,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date } | null> {
  const accessToken = (() => {
    try { return decryptCredentials(creds.accessTokenEnc); } catch { return null; }
  })();
  if (!accessToken) return null;

  const now = Date.now();
  const expiresAtMs = creds.expiresAt?.getTime() ?? 0;
  const needsRefresh = expiresAtMs > 0 && expiresAtMs < now;

  if (!needsRefresh) {
    return {
      accessToken,
      expiresAt: creds.expiresAt ?? new Date(now + 55 * 60 * 1000),
    };
  }

  if (!creds.refreshTokenEnc) return null; // no refresh possible

  const refreshToken = (() => {
    try { return decryptCredentials(creds.refreshTokenEnc!); } catch { return null; }
  })();
  if (!refreshToken) return null;

  const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? '';
  const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? '';
  if (!clientId || !clientSecret) return null;

  try {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    const newAccess = typeof json['access_token'] === 'string' ? json['access_token'] : '';
    if (!newAccess) return null;
    const expiresInSec = typeof json['expires_in'] === 'number' ? json['expires_in'] : 3600;
    const newRefresh = typeof json['refresh_token'] === 'string' ? json['refresh_token'] : undefined;
    const newExpiresAt = new Date(Date.now() + (expiresInSec - 60) * 1000);

    await db.integrationCredential.update({
      where: { id: creds.id },
      data: {
        accessTokenEnc: encryptCredentials(newAccess),
        ...(newRefresh ? { refreshTokenEnc: encryptCredentials(newRefresh) } : {}),
        expiresAt: newExpiresAt,
      },
    });

    return {
      accessToken: newAccess,
      ...(newRefresh ? { refreshToken: newRefresh } : { refreshToken }),
      expiresAt: newExpiresAt,
    };
  } catch {
    return null;
  } finally {
    // Touch lastUsedAt so admin surfaces can show a useful "last activity" row.
    await db.integration.update({ where: { id: integrationId }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
}

/**
 * Check whether a tenant has ANY connected BYO provider — useful for UI
 * dashboards ("you have 2 integrations connected") without leaking the
 * decrypted credentials.
 */
export async function listConnectedProviders(
  tenantId: string,
  db: PrismaClient,
): Promise<Array<{ provider: string; connectedAt: Date; displayName: string | null }>> {
  const integrations = await db.integration.findMany({
    where: { tenantId, status: 'CONNECTED' },
    select: { provider: true, createdAt: true, displayName: true },
  });
  return integrations.map((i) => ({
    provider: i.provider,
    connectedAt: i.createdAt,
    displayName: i.displayName,
  }));
}
