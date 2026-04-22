/**
 * OAuth provider registry — single source of truth for every
 * OAuth-based integration JAK Swarm supports.
 *
 * Adding a new provider is a two-step change:
 *   1. Add a `<PROVIDER>OAuthClientId` + `<PROVIDER>OAuthClientSecret`
 *      env-backed field to `config.ts`.
 *   2. Add an entry to `OAUTH_PROVIDERS` below specifying auth URL,
 *      token URL, scopes, callback path, and any per-provider quirks.
 *
 * The authorize + callback routes in `integrations.routes.ts` then pick
 * up the new provider automatically — no route code changes needed.
 *
 * Design choices:
 *   - PKCE is mandatory where the provider supports it (Google, GitHub,
 *     Linear). Slack v2 and Notion don't advertise PKCE, so we fall back
 *     to the classic authorization-code flow with client_secret for them.
 *   - Each provider keeps its own callback path so their OAuth app
 *     registrations in the respective dashboards remain stable when
 *     adding / removing other providers.
 *   - Token responses are normalized into a single shape so the callback
 *     route doesn't care about per-provider JSON differences (Slack wraps
 *     the bot token at `authed_user.access_token`, etc.).
 *   - `fetchIdentity` pulls the user-facing display name (email, team
 *     name, repo owner) after token exchange so the integration row's
 *     `displayName` is meaningful (e.g. "Connected as acme.slack.com"
 *     instead of just "SLACK").
 */

import type { config as runtimeConfig } from '../config.js';

type RuntimeConfig = typeof runtimeConfig;

export interface OAuthClientCreds {
  clientId: string;
  clientSecret: string;
}

export interface NormalizedTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  // Extra provider-specific data worth persisting on the Integration row
  // (e.g. Slack team.id / team.name / bot_user_id).
  extraMetadata?: Record<string, unknown>;
}

export interface OAuthProviderDef {
  /** Uppercase key. Matches the Integration.provider column. */
  id: string;
  /** Human-facing label shown in ConnectModal + redirect-success page. */
  label: string;
  /** Fully-qualified authorization endpoint. */
  authUrl: string;
  /** Fully-qualified token endpoint. */
  tokenUrl: string;
  /** Scopes the consent screen requests. */
  scopes: string[];
  /** Most providers use space; some (Slack) use comma. */
  scopeSeparator: string;
  /** Extra query params baked into the authorize redirect. */
  extraAuthParams?: Record<string, string>;
  /** Whether the provider supports PKCE S256 (RFC 7636). */
  usesPkce: boolean;
  /**
   * Path the provider redirects back to. Must be registered in the
   * provider's OAuth app dashboard. Appended to `API_PUBLIC_URL`.
   */
  callbackPath: string;
  /** Source the client_id/client_secret from runtime config. */
  getClientCreds: (cfg: RuntimeConfig) => OAuthClientCreds | null;
  /**
   * Custom token request builder. Default: standard RFC 6749 form body
   * with client_id + client_secret + code + code_verifier. Providers
   * that need basic-auth headers (Notion) override this.
   */
  buildTokenRequest?: (ctx: {
    code: string;
    codeVerifier?: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }) => { headers: Record<string, string>; body: URLSearchParams | string };
  /** Normalize the provider's token-response JSON into our shape. */
  parseTokenResponse: (raw: unknown) => NormalizedTokenResponse;
  /**
   * Optional: after a successful token exchange, call the provider's
   * "who am I" endpoint to populate the integration's displayName.
   * Returns null if the call fails — we fall back to the provider label.
   */
  fetchIdentity?: (accessToken: string) => Promise<string | null>;
}

// ─── Shared parsers ────────────────────────────────────────────────────────

/** RFC 6749 default token response shape. Used by Gmail, GitHub, Linear. */
function parseStandardTokenResponse(raw: unknown): NormalizedTokenResponse {
  const json = raw as Record<string, unknown>;
  const accessToken = typeof json['access_token'] === 'string' ? json['access_token'] : '';
  if (!accessToken) throw new Error('Token exchange returned no access_token');
  return {
    accessToken,
    refreshToken: typeof json['refresh_token'] === 'string' ? json['refresh_token'] : undefined,
    expiresIn: typeof json['expires_in'] === 'number' ? json['expires_in'] : undefined,
    scope: typeof json['scope'] === 'string' ? json['scope'] : undefined,
  };
}

// ─── Provider: Gmail (existing — preserved from commit d43febe) ───────────

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json() as { email?: unknown };
    return typeof json.email === 'string' ? json.email : null;
  } catch {
    return null;
  }
}

const GMAIL: OAuthProviderDef = {
  id: 'GMAIL',
  label: 'Gmail',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  scopeSeparator: ' ',
  extraAuthParams: {
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  },
  usesPkce: true,
  // Kept at `/google/callback` for backward compat with existing Google
  // OAuth app registrations. Drive (when added) will share this route
  // since both use the same Google OAuth app.
  callbackPath: '/integrations/oauth/google/callback',
  getClientCreds: (cfg) =>
    cfg.googleOAuthClientId && cfg.googleOAuthClientSecret
      ? { clientId: cfg.googleOAuthClientId, clientSecret: cfg.googleOAuthClientSecret }
      : null,
  parseTokenResponse: parseStandardTokenResponse,
  fetchIdentity: fetchGoogleEmail,
};

// ─── Provider: Slack ──────────────────────────────────────────────────────

async function fetchSlackTeamName(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://slack.com/api/team.info', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json() as { ok?: boolean; team?: { name?: string } };
    return json.ok && typeof json.team?.name === 'string' ? json.team.name : null;
  } catch {
    return null;
  }
}

/**
 * Slack's OAuth v2 endpoint returns:
 *   { ok, access_token, token_type, scope, bot_user_id, app_id,
 *     team: { id, name }, enterprise: {}, authed_user: { id, access_token? } }
 * We use the bot `access_token` for all subsequent API calls.
 */
function parseSlackTokenResponse(raw: unknown): NormalizedTokenResponse {
  const json = raw as Record<string, unknown>;
  if (json['ok'] === false) {
    throw new Error(`Slack OAuth rejected: ${String(json['error'] ?? 'unknown')}`);
  }
  const accessToken = typeof json['access_token'] === 'string' ? json['access_token'] : '';
  if (!accessToken) throw new Error('Slack OAuth returned no access_token');
  const team = (json['team'] as Record<string, unknown> | undefined) ?? {};
  return {
    accessToken,
    scope: typeof json['scope'] === 'string' ? json['scope'] : undefined,
    extraMetadata: {
      slackTeamId: typeof team['id'] === 'string' ? team['id'] : undefined,
      slackTeamName: typeof team['name'] === 'string' ? team['name'] : undefined,
      slackBotUserId: typeof json['bot_user_id'] === 'string' ? json['bot_user_id'] : undefined,
      slackAppId: typeof json['app_id'] === 'string' ? json['app_id'] : undefined,
    },
  };
}

const SLACK: OAuthProviderDef = {
  id: 'SLACK',
  label: 'Slack',
  authUrl: 'https://slack.com/oauth/v2/authorize',
  tokenUrl: 'https://slack.com/api/oauth.v2.access',
  scopes: [
    'chat:write',
    'channels:read',
    'channels:history',
    'groups:read',
    'im:read',
    'users:read',
    'users:read.email',
  ],
  scopeSeparator: ',', // Slack is one of the few that uses commas
  usesPkce: false,     // Slack v2 doesn't implement PKCE; uses client_secret
  callbackPath: '/integrations/oauth/slack/callback',
  getClientCreds: (cfg) =>
    cfg.slackClientId && cfg.slackClientSecret
      ? { clientId: cfg.slackClientId, clientSecret: cfg.slackClientSecret }
      : null,
  parseTokenResponse: parseSlackTokenResponse,
  fetchIdentity: fetchSlackTeamName,
};

// ─── Provider: GitHub ─────────────────────────────────────────────────────

async function fetchGitHubLogin(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) return null;
    const json = await res.json() as { login?: unknown };
    return typeof json.login === 'string' ? json.login : null;
  } catch {
    return null;
  }
}

/**
 * GitHub's token endpoint defaults to URL-encoded response unless the
 * caller sends `Accept: application/json`. We send that header so the
 * callback always sees JSON.
 */
function buildGitHubTokenRequest(ctx: {
  code: string;
  codeVerifier?: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}) {
  const params: Record<string, string> = {
    client_id: ctx.clientId,
    client_secret: ctx.clientSecret,
    code: ctx.code,
    redirect_uri: ctx.redirectUri,
  };
  if (ctx.codeVerifier) params['code_verifier'] = ctx.codeVerifier;
  return {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
  };
}

const GITHUB: OAuthProviderDef = {
  id: 'GITHUB',
  label: 'GitHub',
  authUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scopes: ['repo', 'read:org', 'read:user', 'user:email'],
  scopeSeparator: ' ',
  usesPkce: true,
  callbackPath: '/integrations/oauth/github/callback',
  getClientCreds: (cfg) =>
    cfg.githubOAuthClientId && cfg.githubOAuthClientSecret
      ? { clientId: cfg.githubOAuthClientId, clientSecret: cfg.githubOAuthClientSecret }
      : null,
  buildTokenRequest: buildGitHubTokenRequest,
  parseTokenResponse: parseStandardTokenResponse,
  fetchIdentity: fetchGitHubLogin,
};

// ─── Provider: Notion ─────────────────────────────────────────────────────

async function fetchNotionWorkspaceName(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (!res.ok) return null;
    const json = await res.json() as { bot?: { workspace_name?: unknown } };
    return typeof json.bot?.workspace_name === 'string' ? json.bot.workspace_name : null;
  } catch {
    return null;
  }
}

/** Notion's token endpoint requires basic auth with client_id:client_secret. */
function buildNotionTokenRequest(ctx: {
  code: string;
  codeVerifier?: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}) {
  const basic = Buffer.from(`${ctx.clientId}:${ctx.clientSecret}`).toString('base64');
  const body = JSON.stringify({
    grant_type: 'authorization_code',
    code: ctx.code,
    redirect_uri: ctx.redirectUri,
  });
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${basic}`,
    },
    body,
  };
}

/** Notion adds workspace_id + bot_id fields — capture them in metadata. */
function parseNotionTokenResponse(raw: unknown): NormalizedTokenResponse {
  const json = raw as Record<string, unknown>;
  const accessToken = typeof json['access_token'] === 'string' ? json['access_token'] : '';
  if (!accessToken) throw new Error('Notion OAuth returned no access_token');
  return {
    accessToken,
    extraMetadata: {
      notionWorkspaceId: typeof json['workspace_id'] === 'string' ? json['workspace_id'] : undefined,
      notionWorkspaceName: typeof json['workspace_name'] === 'string' ? json['workspace_name'] : undefined,
      notionBotId: typeof json['bot_id'] === 'string' ? json['bot_id'] : undefined,
      notionOwnerType: typeof (json['owner'] as Record<string, unknown> | undefined)?.['type'] === 'string'
        ? ((json['owner'] as Record<string, unknown>)?.['type'] as string)
        : undefined,
    },
  };
}

const NOTION: OAuthProviderDef = {
  id: 'NOTION',
  label: 'Notion',
  authUrl: 'https://api.notion.com/v1/oauth/authorize',
  tokenUrl: 'https://api.notion.com/v1/oauth/token',
  scopes: [], // Notion doesn't use space-delimited scope param; permissions set per-integration
  scopeSeparator: ' ',
  extraAuthParams: {
    owner: 'user',
  },
  usesPkce: false,
  callbackPath: '/integrations/oauth/notion/callback',
  getClientCreds: (cfg) =>
    cfg.notionOAuthClientId && cfg.notionOAuthClientSecret
      ? { clientId: cfg.notionOAuthClientId, clientSecret: cfg.notionOAuthClientSecret }
      : null,
  buildTokenRequest: buildNotionTokenRequest,
  parseTokenResponse: parseNotionTokenResponse,
  fetchIdentity: fetchNotionWorkspaceName,
};

// ─── Provider: Linear ─────────────────────────────────────────────────────

async function fetchLinearOrgName(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: accessToken, // Linear uses raw token, not Bearer prefix
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ organization { name } }' }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: { organization?: { name?: unknown } } };
    return typeof json.data?.organization?.name === 'string'
      ? json.data.organization.name
      : null;
  } catch {
    return null;
  }
}

const LINEAR: OAuthProviderDef = {
  id: 'LINEAR',
  label: 'Linear',
  authUrl: 'https://linear.app/oauth/authorize',
  tokenUrl: 'https://api.linear.app/oauth/token',
  scopes: ['read', 'write'],
  scopeSeparator: ',',
  usesPkce: true,
  callbackPath: '/integrations/oauth/linear/callback',
  getClientCreds: (cfg) =>
    cfg.linearOAuthClientId && cfg.linearOAuthClientSecret
      ? { clientId: cfg.linearOAuthClientId, clientSecret: cfg.linearOAuthClientSecret }
      : null,
  parseTokenResponse: parseStandardTokenResponse,
  fetchIdentity: fetchLinearOrgName,
};

// ─── Registry ─────────────────────────────────────────────────────────────

export const OAUTH_PROVIDERS: Record<string, OAuthProviderDef> = {
  GMAIL,
  SLACK,
  GITHUB,
  NOTION,
  LINEAR,
};

/**
 * List of provider IDs that have an OAuth implementation registered.
 * The frontend ConnectModal reads this (via GET /integrations/oauth/providers)
 * to decide whether to show "Sign in with X" instead of the credential-paste
 * form — so new providers go live the moment they're added to the registry.
 */
export function listOAuthProviders(cfg: RuntimeConfig): Array<{
  id: string;
  label: string;
  configured: boolean;
}> {
  return Object.values(OAUTH_PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.getClientCreds(cfg) !== null,
  }));
}
