import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mcpClientManager, MCP_PROVIDERS } from '@jak-swarm/tools';
import { encrypt as encryptCredentials } from '../utils/crypto.js';
import { generateCodeVerifier, deriveCodeChallenge, generateStateToken } from '../utils/pkce.js';
import { config } from '../config.js';
import { ok, err } from '../types.js';

type IntegrationMaturity = 'production-ready' | 'beta' | 'partial' | 'placeholder';

const INTEGRATION_MATURITY: Record<string, { maturity: IntegrationMaturity; note: string }> = {
  // ── Anthropic-published MCP servers ──
  SLACK: {
    maturity: 'production-ready',
    note: 'MCP-backed, webhook-verified in API runtime. Anthropic-published package.',
  },
  GITHUB: {
    maturity: 'beta',
    note: 'MCP-backed tools via Anthropic package. Reliability depends on GitHub API and MCP server availability.',
  },
  FILESYSTEM: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server. Sandboxed to configured directories.',
  },
  FETCH: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server for HTTP fetching.',
  },
  MEMORY: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server for knowledge graph memory.',
  },
  PUPPETEER: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server. Requires headless Chrome.',
  },
  POSTGRES: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server. Read-only by default for safety.',
  },
  BRAVE_SEARCH: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server. Requires Brave Search API key.',
  },
  SEQUENTIAL_THINKING: {
    maturity: 'beta',
    note: 'Anthropic-published experimental reasoning server.',
  },
  // ── Official vendor MCP servers ──
  NOTION: {
    maturity: 'beta',
    note: 'Official Notion MCP server. Coverage depends on provider implementation.',
  },
  HUBSPOT: {
    maturity: 'beta',
    note: 'Official HubSpot MCP server. Comprehensive CRM tool coverage.',
  },
  STRIPE: {
    maturity: 'beta',
    note: 'Official Stripe MCP server. Payment/subscription management tools.',
  },
  SALESFORCE: {
    maturity: 'partial',
    note: 'Official Salesforce MCP server. Adapter depth varies; verify per-tenant before production.',
  },
  LINEAR: {
    maturity: 'beta',
    note: 'Official Linear MCP server. Issue/project management tools.',
  },
  SUPABASE: {
    maturity: 'beta',
    note: 'Official Supabase MCP server. Database and auth management tools.',
  },
  SENTRY: {
    maturity: 'beta',
    note: 'Official Sentry MCP server. Error tracking and project management.',
  },
  // ── Community-maintained MCP servers ──
  AIRTABLE: {
    maturity: 'partial',
    note: 'Community-maintained MCP server. Functional but not officially supported.',
  },
  DISCORD: {
    maturity: 'partial',
    note: 'Community-maintained MCP server. Functional but not officially supported.',
  },
  CLICKUP: {
    maturity: 'partial',
    note: 'Community-maintained MCP server. Functional but not officially supported.',
  },
  SENDGRID: {
    maturity: 'partial',
    note: 'Community-maintained MCP server. Functional but not officially supported.',
  },
};

function getIntegrationMaturity(providerUpper: string): { maturity: IntegrationMaturity; note: string } {
  return INTEGRATION_MATURITY[providerUpper] ?? {
    maturity: 'partial',
    note: 'Provider available via MCP configuration; production readiness depends on provider-specific adapter depth.',
  };
}

// ─── OAuth (PKCE) provider configuration ───────────────────────────────
// Keeps provider-specific details (scope list, auth URL, token URL) out of
// the route handler so the handler stays readable. Add a new provider by
// dropping a new entry here.
interface OAuthProvider {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra query params baked into the authorize redirect (e.g. access_type=offline). */
  extraAuthParams?: Record<string, string>;
  /** Which IntegrationProvider string this OAuth flow produces. */
  integrationProvider: string;
  /** Label shown back to the UI on redirect. */
  label: string;
}

const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  GMAIL: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    extraAuthParams: {
      access_type: 'offline',
      // Force the consent screen so Google always returns a refresh_token
      // on the FIRST authorize — without this, re-authorizing returns only
      // an access_token and the refresh path breaks silently.
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
    integrationProvider: 'GMAIL',
    label: 'Gmail',
  },
};

function resolveGoogleRedirectUri(): string {
  if (config.googleOAuthRedirectUri) return config.googleOAuthRedirectUri;
  const base = config.apiPublicUrl || `http://localhost:${config.port}`;
  return `${base.replace(/\/$/, '')}/integrations/oauth/google/callback`;
}

/**
 * Exchange an authorization code for access + refresh tokens against the
 * provider's token endpoint. Returns the raw Google response shape; callers
 * persist the relevant fields.
 */
async function exchangeAuthorizationCode(params: {
  provider: OAuthProvider;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scope: string }> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: config.googleOAuthClientId,
    client_secret: config.googleOAuthClientSecret,
    code_verifier: params.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });

  const res = await fetch(params.provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = await res.json() as Record<string, unknown>;
  const accessToken = typeof json['access_token'] === 'string' ? json['access_token'] : '';
  if (!accessToken) throw new Error('Token exchange returned no access_token');
  return {
    accessToken,
    refreshToken: typeof json['refresh_token'] === 'string' ? json['refresh_token'] : undefined,
    expiresIn: typeof json['expires_in'] === 'number' ? json['expires_in'] : 3600,
    scope: typeof json['scope'] === 'string' ? json['scope'] : '',
  };
}

/**
 * Fetch the authenticated user's email from the userinfo endpoint. Used as
 * the integration's displayName so the UI can show "Connected as alice@x.com"
 * without requiring the user to type their own email during the redirect.
 */
async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
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

export async function integrationRoutes(app: FastifyInstance) {
  // List connected integrations for tenant
  app.get('/integrations', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user;
    const integrations = await app.db.integration.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(ok(
      integrations.map((integration) => ({
        ...integration,
        ...getIntegrationMaturity(integration.provider),
      })),
    ));
  });

  // Get provider setup info (credential fields, instructions)
  app.get('/integrations/providers/:provider', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const providerDef = MCP_PROVIDERS[provider.toUpperCase()];
    if (!providerDef) {
      return reply.code(404).send(err('NOT_FOUND', `Unknown provider: ${provider}`));
    }
    return reply.send(ok({
        name: providerDef.name,
        description: providerDef.description,
        credentialFields: providerDef.credentialFields,
        setupInstructions: providerDef.setupInstructions,
        isMcp: true,
        ...getIntegrationMaturity(provider.toUpperCase()),
      }));
  });

  // Connect integration with credentials
  app.post('/integrations/connect', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId, userId } = request.user;
    const connectSchema = z.object({
      provider: z.string().min(1).max(100),
      credentials: z.record(z.string(), z.string()),
    });
    const parsed = connectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(err('VALIDATION_ERROR', 'Invalid request body', parsed.error.flatten()));
    }
    const { provider, credentials } = parsed.data;

    const providerUpper = provider.toUpperCase();
    const providerDef = MCP_PROVIDERS[providerUpper];
    if (!providerDef) {
      return reply.code(400).send(err('VALIDATION_ERROR', `Unsupported provider: ${provider}`));
    }

    // Validate all required credentials are provided
    for (const field of providerDef.credentialFields) {
      if (!credentials[field.key]) {
        return reply.code(422).send(err('VALIDATION_ERROR', `Missing required credential: ${field.label}`));
      }
    }

    try {
      // Build MCP server config and connect
      const config = providerDef.buildConfig(credentials);
      const tools = await mcpClientManager.connect(providerUpper, config);

      // Store integration record
      const firstFieldKey = providerDef.credentialFields[0]?.key;
      const displayName = (firstFieldKey ? credentials[firstFieldKey] : undefined) ?? providerUpper;

      const metadata = JSON.parse(JSON.stringify({ toolCount: tools.length, tools }));

      const integration = await app.db.integration.upsert({
        where: { tenantId_provider: { tenantId, provider: providerUpper } },
        update: {
          status: 'CONNECTED',
          displayName,
          connectedBy: userId,
          metadata,
          updatedAt: new Date(),
        },
        create: {
          tenantId,
          provider: providerUpper,
          status: 'CONNECTED',
          displayName,
          connectedBy: userId,
          metadata,
        },
      });

      // Store encrypted credentials
      await app.db.integrationCredential.upsert({
        where: { integrationId: integration.id },
        update: { accessTokenEnc: encryptCredentials(JSON.stringify(credentials)) },
        create: { integrationId: integration.id, accessTokenEnc: encryptCredentials(JSON.stringify(credentials)) },
      });

      await app.auditLog(request, 'CONNECT_INTEGRATION', 'Integration', integration.id, { provider: providerUpper });

      return reply.send(ok({
          id: integration.id,
          provider: providerUpper,
          status: 'CONNECTED',
          toolsRegistered: tools,
        }));
    } catch (connectErr) {
      return reply.code(500).send(err('INTERNAL_ERROR', `Failed to connect ${provider}: ${connectErr instanceof Error ? connectErr.message : String(connectErr)}`));
    }
  });

  // Test connection
  app.post('/integrations/:id/test', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const integration = await app.db.integration.findFirst({ where: { id, tenantId } });
    if (!integration) return reply.code(404).send(err('NOT_FOUND', 'Integration not found'));

    const isConnected = mcpClientManager.isConnected(integration.provider);
    const tools = mcpClientManager.getRegisteredTools(integration.provider);

    return reply.send(ok({
        connected: isConnected,
        provider: integration.provider,
        toolCount: tools.length,
        tools,
      }));
  });

  // Disconnect an integration
  app.delete('/integrations/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params as { id: string };

    const integration = await app.db.integration.findFirst({ where: { id, tenantId } });
    if (integration) {
      await mcpClientManager.disconnect(integration.provider);
    }

    await app.db.integration.deleteMany({
      where: { id, tenantId },
    });
    if (integration) {
      await app.auditLog(request, 'DISCONNECT_INTEGRATION', 'Integration', id, { provider: integration.provider });
    }
    return reply.code(204).send();
  });

  // ─── OAuth PKCE: Authorize (auth-guarded) ────────────────────────────────
  // Starts the redirect dance. Persists the CSRF state + PKCE code_verifier
  // server-side for the callback to read. Returns the auth URL the frontend
  // should redirect the browser to.
  app.post('/integrations/oauth/:provider/authorize', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const providerUpper = provider.toUpperCase();
    const { tenantId, userId } = request.user;

    const oauthProvider = OAUTH_PROVIDERS[providerUpper];
    if (!oauthProvider) {
      return reply.code(400).send(err('VALIDATION_ERROR', `OAuth not supported for provider: ${provider}`));
    }
    if (!config.googleOAuthClientId || !config.googleOAuthClientSecret) {
      return reply.code(503).send(err('NOT_CONFIGURED',
        'Google OAuth is not configured on this deployment. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.',
      ));
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);
    const state = generateStateToken();
    const redirectUri = resolveGoogleRedirectUri();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10-minute TTL

    await app.db.oAuthState.create({
      data: {
        tenantId,
        userId,
        provider: providerUpper,
        state,
        codeVerifier,
        redirectUri,
        scopes: oauthProvider.scopes,
        expiresAt,
      },
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.googleOAuthClientId,
      redirect_uri: redirectUri,
      scope: oauthProvider.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...(oauthProvider.extraAuthParams ?? {}),
    });
    const authUrl = `${oauthProvider.authUrl}?${params.toString()}`;

    await app.auditLog(request, 'OAUTH_AUTHORIZE_START', 'Integration', state, { provider: providerUpper });

    return reply.send(ok({ authUrl, state, provider: providerUpper }));
  });

  // ─── OAuth PKCE: Callback (UNAUTH — Google redirects here) ──────────────
  // Google's redirect lands here with ?code=&state= (or ?error=). We look
  // up the state row to recover tenantId/userId/codeVerifier, exchange the
  // code, persist the encrypted tokens, then 302 the browser back to the
  // web app's integrations page with a status flag.
  app.get('/integrations/oauth/google/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    const webBase = config.webPublicUrl.replace(/\/$/, '');

    // Match the contract the existing /integrations/callback page already
    // reads: ?connected=<ProviderName> on success, ?error=<message> on fail.
    // Short URLs so users don't see a wall of error text in their browser.
    const errRedirect = (reason: string) => {
      const short = reason.length > 120 ? reason.slice(0, 117) + '...' : reason;
      const params = new URLSearchParams({ error: short });
      return reply.redirect(`${webBase}/integrations/callback?${params.toString()}`);
    };

    if (query.error) {
      return errRedirect(query.error_description || query.error);
    }
    if (!query.code || !query.state) {
      return errRedirect('Missing code or state parameter');
    }

    const stored = await app.db.oAuthState.findUnique({ where: { state: query.state } });
    if (!stored) return errRedirect('Invalid or already-used state token');
    // Single-use: delete immediately so a replayed callback fails fast.
    await app.db.oAuthState.delete({ where: { state: query.state } }).catch(() => {});
    if (stored.expiresAt.getTime() < Date.now()) {
      return errRedirect('Authorization request expired. Please try again.');
    }

    const oauthProvider = OAUTH_PROVIDERS[stored.provider];
    if (!oauthProvider) return errRedirect(`Unknown OAuth provider: ${stored.provider}`);

    let tokens;
    try {
      tokens = await exchangeAuthorizationCode({
        provider: oauthProvider,
        code: query.code,
        codeVerifier: stored.codeVerifier,
        redirectUri: stored.redirectUri,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errRedirect(`Token exchange failed: ${msg}`);
    }

    const userEmail = await fetchGoogleUserEmail(tokens.accessToken);
    const expiresAt = new Date(Date.now() + (tokens.expiresIn - 60) * 1000); // refresh 60s early

    const integration = await app.db.integration.upsert({
      where: { tenantId_provider: { tenantId: stored.tenantId, provider: oauthProvider.integrationProvider } },
      update: {
        status: 'CONNECTED',
        displayName: userEmail ?? oauthProvider.label,
        connectedBy: stored.userId,
        scopes: oauthProvider.scopes,
        metadata: { connectedViaOAuth: true, grantedScope: tokens.scope } as unknown as object,
        updatedAt: new Date(),
      },
      create: {
        tenantId: stored.tenantId,
        provider: oauthProvider.integrationProvider,
        status: 'CONNECTED',
        displayName: userEmail ?? oauthProvider.label,
        connectedBy: stored.userId,
        scopes: oauthProvider.scopes,
        metadata: { connectedViaOAuth: true, grantedScope: tokens.scope } as unknown as object,
      },
    });

    await app.db.integrationCredential.upsert({
      where: { integrationId: integration.id },
      update: {
        accessTokenEnc: encryptCredentials(tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken ? encryptCredentials(tokens.refreshToken) : null,
        expiresAt,
      },
      create: {
        integrationId: integration.id,
        accessTokenEnc: encryptCredentials(tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken ? encryptCredentials(tokens.refreshToken) : null,
        expiresAt,
      },
    });

    await app.auditLog(request, 'OAUTH_AUTHORIZE_COMPLETE', 'Integration', integration.id, {
      provider: stored.provider,
      email: userEmail,
    });

    const params = new URLSearchParams({
      connected: oauthProvider.label,
      ...(userEmail ? { email: userEmail } : {}),
    });
    return reply.redirect(`${webBase}/integrations/callback?${params.toString()}`);
  });
}
