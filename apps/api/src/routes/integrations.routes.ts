import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { mcpClientManager, MCP_PROVIDERS } from '@jak-swarm/tools';
import { encrypt as encryptCredentials } from '../utils/crypto.js';
import { generateCodeVerifier, deriveCodeChallenge, generateStateToken } from '../utils/pkce.js';
import { config } from '../config.js';
import { OAUTH_PROVIDERS, listOAuthProviders, type OAuthProviderDef } from '../services/oauth-providers.js';
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

// ─── OAuth (generic registry-backed) ─────────────────────────────────────
// Every OAuth-capable provider is declared in `services/oauth-providers.ts`.
// The helpers below are provider-agnostic — they look up the target
// provider's quirks (auth URL, token URL, PKCE on/off, token-response shape,
// identity endpoint) from the registry and apply them uniformly.

/**
 * Resolve the full public callback URL for a given provider. Callers
 * should pre-validate that the provider exists in OAUTH_PROVIDERS.
 *
 * For Gmail we preserve the historical override env
 * `GOOGLE_OAUTH_REDIRECT_URI` (set on the current Google OAuth app
 * registration). Other providers derive from `API_PUBLIC_URL` +
 * the provider's `callbackPath`.
 */
function resolveRedirectUri(provider: OAuthProviderDef): string {
  if (provider.id === 'GMAIL' && config.googleOAuthRedirectUri) {
    return config.googleOAuthRedirectUri;
  }
  const base = config.apiPublicUrl || `http://localhost:${config.port}`;
  return `${base.replace(/\/$/, '')}${provider.callbackPath}`;
}

/**
 * Provider-agnostic token exchange. Uses the provider's `buildTokenRequest`
 * if present (Notion's basic auth, GitHub's JSON-accept header), otherwise
 * falls back to the standard RFC 6749 form body with PKCE code_verifier.
 */
async function exchangeAuthorizationCode(params: {
  provider: OAuthProviderDef;
  code: string;
  codeVerifier?: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}) {
  const { provider, code, codeVerifier, redirectUri, clientId, clientSecret } = params;

  let requestInit: { headers: Record<string, string>; body: URLSearchParams | string };
  if (provider.buildTokenRequest) {
    requestInit = provider.buildTokenRequest({ code, codeVerifier, redirectUri, clientId, clientSecret });
  } else {
    const form: Record<string, string> = {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    };
    if (codeVerifier) form['code_verifier'] = codeVerifier;
    requestInit = {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    };
  }

  const res = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: requestInit.headers,
    body: requestInit.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = await res.json() as unknown;
  return provider.parseTokenResponse(json);
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

  // ─── OAuth discovery: which providers are configured on this deployment ──
  // Frontend calls this to decide whether to render "Sign in with X" on the
  // ConnectModal. A provider appears as `configured: true` once both its
  // client_id and client_secret env vars are set.
  app.get('/integrations/oauth/providers', {
    preHandler: [app.authenticate],
  }, async (_request, reply) => {
    return reply.send(ok(listOAuthProviders(config)));
  });

  // ─── OAuth: Authorize (auth-guarded, works for EVERY registered provider) ─
  // Starts the redirect dance. Persists the CSRF state + PKCE code_verifier
  // server-side for the callback to read. Returns the auth URL the frontend
  // should redirect the browser to. Provider-specific quirks (scope list,
  // extra params, PKCE on/off) come from the registry.
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

    const creds = oauthProvider.getClientCreds(config);
    if (!creds) {
      return reply.code(503).send(err('NOT_CONFIGURED',
        `${oauthProvider.label} OAuth is not configured on this deployment. ` +
          `Set the provider's CLIENT_ID and CLIENT_SECRET env vars.`,
      ));
    }

    // PKCE is generated only for providers that support it. For legacy-flow
    // providers (Slack v2, Notion) we skip the verifier/challenge; the
    // callback detects an empty codeVerifier and omits it from the token
    // request accordingly.
    const codeVerifier = oauthProvider.usesPkce ? generateCodeVerifier() : '';
    const codeChallenge = oauthProvider.usesPkce ? deriveCodeChallenge(codeVerifier) : '';
    const state = generateStateToken();
    const redirectUri = resolveRedirectUri(oauthProvider);
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

    // Scope param: some providers (Notion) declare no scopes. Only set the
    // parameter if we actually have scopes to request.
    const authParams: Record<string, string> = {
      response_type: 'code',
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      state,
      ...(oauthProvider.extraAuthParams ?? {}),
    };
    if (oauthProvider.scopes.length > 0) {
      authParams['scope'] = oauthProvider.scopes.join(oauthProvider.scopeSeparator);
    }
    if (oauthProvider.usesPkce) {
      authParams['code_challenge'] = codeChallenge;
      authParams['code_challenge_method'] = 'S256';
    }
    const authUrl = `${oauthProvider.authUrl}?${new URLSearchParams(authParams).toString()}`;

    await app.auditLog(request, 'OAUTH_AUTHORIZE_START', 'Integration', state, { provider: providerUpper });

    return reply.send(ok({ authUrl, state, provider: providerUpper }));
  });

  // ─── Generic OAuth callback handler ──────────────────────────────────────
  // Shared by every provider. Registered below at each provider's
  // `callbackPath`. The handler looks up `OAuthState` by `state`, picks the
  // provider from the stored row (not the URL path) so a rogue redirect
  // can't swap providers, runs token exchange, persists credentials +
  // integration row, and 302s back to /integrations/callback.
  async function handleOAuthCallback(request: FastifyRequest, reply: FastifyReply) {
    const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    const webBase = config.webPublicUrl.replace(/\/$/, '');

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

    const creds = oauthProvider.getClientCreds(config);
    if (!creds) {
      return errRedirect(`${oauthProvider.label} OAuth credentials missing on server`);
    }

    let tokens;
    try {
      tokens = await exchangeAuthorizationCode({
        provider: oauthProvider,
        code: query.code,
        codeVerifier: stored.codeVerifier || undefined,
        redirectUri: stored.redirectUri,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errRedirect(`Token exchange failed: ${msg}`);
    }

    const identity = oauthProvider.fetchIdentity
      ? await oauthProvider.fetchIdentity(tokens.accessToken)
      : null;
    const displayName = identity ?? oauthProvider.label;

    // expiresAt is only set when the provider actually returns expires_in.
    // Slack bot tokens don't expire; Notion tokens don't expire. We leave
    // the column null in those cases — the credential.service will just
    // decrypt and use the access token directly.
    const expiresAt = tokens.expiresIn
      ? new Date(Date.now() + (tokens.expiresIn - 60) * 1000)
      : null;

    const metadata: Record<string, unknown> = {
      connectedViaOAuth: true,
      grantedScope: tokens.scope,
      ...(tokens.extraMetadata ?? {}),
    };

    const integration = await app.db.integration.upsert({
      where: { tenantId_provider: { tenantId: stored.tenantId, provider: oauthProvider.id } },
      update: {
        status: 'CONNECTED',
        displayName,
        connectedBy: stored.userId,
        scopes: oauthProvider.scopes,
        metadata: metadata as unknown as object,
        updatedAt: new Date(),
      },
      create: {
        tenantId: stored.tenantId,
        provider: oauthProvider.id,
        status: 'CONNECTED',
        displayName,
        connectedBy: stored.userId,
        scopes: oauthProvider.scopes,
        metadata: metadata as unknown as object,
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
      identity,
    });

    const params = new URLSearchParams({
      connected: oauthProvider.label,
      ...(identity ? { identity } : {}),
    });
    return reply.redirect(`${webBase}/integrations/callback?${params.toString()}`);
  }

  // Register a callback route per provider — providers need their exact
  // callback path pre-registered in their OAuth app dashboard, so we mount
  // them at the paths declared in the registry. The handler body is shared.
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    app.get(provider.callbackPath, handleOAuthCallback);
  }
}
