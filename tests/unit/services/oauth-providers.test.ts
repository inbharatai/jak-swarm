/**
 * Unit tests for the OAuth provider registry — `apps/api/src/services/oauth-providers.ts`.
 *
 * SCOPE NOTE — read this before adding cases:
 *   `oauth-providers.ts` is intentionally a *registry of definitions* + token-
 *   response parsers + identity-fetcher helpers + Salesforce domain switcher.
 *   It does **NOT** implement:
 *     - state-token generation (lives in `apps/api/src/utils/pkce.ts`)
 *     - state storage / TTL / replay-prevention (lives in `integrations.routes.ts`,
 *       backed by Prisma model `OAuthState`)
 *     - state→tenant binding / cross-tenant isolation (route layer)
 *     - redirect_uri resolution & allowlist (route layer: `resolveRedirectUri`)
 *     - the actual `fetch(tokenUrl, …)` call (route layer: `exchangeAuthorizationCode`)
 *     - refresh-token grant flow (NOT IMPLEMENTED ANYWHERE — see "Behavioural
 *       surprises" in this file's comments at the bottom)
 *
 *   Where the brief asked for tests of those concerns, we either:
 *     a) skip with `it.todo(...)` pointing to where they belong, OR
 *     b) write a *negative* assertion that fails fast if a future commit
 *        sneaks half-baked logic into this file (e.g. introducing a Math.random
 *        state generator, or hard-coding a redirect_uri without allowlist).
 *
 * What this test DOES cover (faithful to the source):
 *   - Registry shape: every advertised provider has the fields the auth/cb
 *     routes rely on.
 *   - `usesPkce` flag matches each provider's official capability (Slack v2
 *     and Notion are PKCE-less; Google/GitHub/Linear/LinkedIn/Salesforce are
 *     PKCE-enabled).
 *   - Token-response parsers normalize correctly for each provider, and throw
 *     a *generic* error (no token text) when the response is malformed.
 *   - Notion's `buildTokenRequest` uses Basic auth + JSON body with the
 *     RFC 6749 `grant_type=authorization_code`.
 *   - GitHub's `buildTokenRequest` sends `Accept: application/json` so the
 *     callback always sees JSON, and forwards `code_verifier` when present.
 *   - `applySalesforceDomain` rewrites authUrl/tokenUrl for sandbox orgs
 *     without touching any other provider.
 *   - `listOAuthProviders` reflects whether each provider's client_id +
 *     client_secret are configured.
 *   - Identity fetchers (`fetchLinkedInIdentity`, `fetchSalesforceIdentity`,
 *     plus the per-provider `fetchIdentity` closures) hit the right URL with
 *     `Authorization: Bearer …`, swallow non-200 into `null`, and never
 *     surface the access token through thrown errors.
 *
 * Style follows `tests/unit/services/trial-promotion.test.ts` — in-memory
 * stubs, vi.spyOn for global fetch, each test self-contained.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OAUTH_PROVIDERS,
  applySalesforceDomain,
  fetchLinkedInIdentity,
  fetchSalesforceIdentity,
  listOAuthProviders,
  type OAuthProviderDef,
} from '../../../apps/api/src/services/oauth-providers.js';

// ─── fetch stub helpers ─────────────────────────────────────────────────────

interface FetchCall { url: string; init: RequestInit | undefined }

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    calls.push({ url, init });
    return handler(url, init);
  });
  return { spy, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Minimal RuntimeConfig stub ─────────────────────────────────────────────
//
// The registry only needs the OAuth client_id/client_secret env-backed fields
// plus `salesforceOAuthDomain`. We create a "fully configured" baseline and
// override per test where we want a provider absent.

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    googleOAuthClientId: 'google-id',
    googleOAuthClientSecret: 'google-secret',
    slackClientId: 'slack-id',
    slackClientSecret: 'slack-secret',
    githubOAuthClientId: 'gh-id',
    githubOAuthClientSecret: 'gh-secret',
    notionOAuthClientId: 'notion-id',
    notionOAuthClientSecret: 'notion-secret',
    linearOAuthClientId: 'linear-id',
    linearOAuthClientSecret: 'linear-secret',
    linkedinOAuthClientId: 'li-id',
    linkedinOAuthClientSecret: 'li-secret',
    salesforceOAuthClientId: 'sf-id',
    salesforceOAuthClientSecret: 'sf-secret',
    salesforceOAuthDomain: 'login.salesforce.com',
    ...overrides,
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. Registry shape ─────────────────────────────────────────────────────

describe('OAUTH_PROVIDERS registry', () => {
  it('exposes the full set of expected providers', () => {
    expect(Object.keys(OAUTH_PROVIDERS).sort()).toEqual([
      'DRIVE', 'GCAL', 'GITHUB', 'GMAIL', 'LINEAR', 'LINKEDIN', 'NOTION', 'SALESFORCE', 'SLACK',
    ]);
  });

  it.each(Object.entries(OAUTH_PROVIDERS))(
    '%s has all fields the authorize/callback routes rely on',
    (key, p: OAuthProviderDef) => {
      expect(p.id).toBe(key); // id must match registry key (lookup invariant)
      expect(p.label).toMatch(/.+/);
      expect(p.authUrl).toMatch(/^https:\/\//);
      expect(p.tokenUrl).toMatch(/^https:\/\//);
      expect(Array.isArray(p.scopes)).toBe(true);
      expect([',', ' ']).toContain(p.scopeSeparator);
      expect(typeof p.usesPkce).toBe('boolean');
      expect(p.callbackPath).toMatch(/^\/integrations\/oauth\//);
      expect(typeof p.getClientCreds).toBe('function');
      expect(typeof p.parseTokenResponse).toBe('function');
    },
  );

  it('PKCE flags match per-provider capability (Slack v2 + Notion lack PKCE; rest support it)', () => {
    expect(OAUTH_PROVIDERS['GMAIL']!.usesPkce).toBe(true);
    expect(OAUTH_PROVIDERS['GCAL']!.usesPkce).toBe(true);
    expect(OAUTH_PROVIDERS['GITHUB']!.usesPkce).toBe(true);
    expect(OAUTH_PROVIDERS['LINEAR']!.usesPkce).toBe(true);
    expect(OAUTH_PROVIDERS['LINKEDIN']!.usesPkce).toBe(true);
    expect(OAUTH_PROVIDERS['SALESFORCE']!.usesPkce).toBe(true);
    expect(OAUTH_PROVIDERS['SLACK']!.usesPkce).toBe(false);
    expect(OAUTH_PROVIDERS['NOTION']!.usesPkce).toBe(false);
  });

  it('Slack uses comma scope separator; everyone else with multi-scope uses space (or comma for Linear)', () => {
    expect(OAUTH_PROVIDERS['SLACK']!.scopeSeparator).toBe(',');
    expect(OAUTH_PROVIDERS['GMAIL']!.scopeSeparator).toBe(' ');
    expect(OAUTH_PROVIDERS['GCAL']!.scopeSeparator).toBe(' ');
    expect(OAUTH_PROVIDERS['GITHUB']!.scopeSeparator).toBe(' ');
    expect(OAUTH_PROVIDERS['LINEAR']!.scopeSeparator).toBe(','); // Linear quirks: comma
    expect(OAUTH_PROVIDERS['LINKEDIN']!.scopeSeparator).toBe(' ');
    expect(OAUTH_PROVIDERS['SALESFORCE']!.scopeSeparator).toBe(' ');
  });

  it('callback paths are stable and only the Google providers share one', () => {
    const byPath = new Map<string, string[]>();
    for (const provider of Object.values(OAUTH_PROVIDERS)) {
      const list = byPath.get(provider.callbackPath) ?? [];
      list.push(provider.id);
      byPath.set(provider.callbackPath, list);
    }

    const shared = [...byPath.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([path, ids]) => [path, [...ids].sort()] as const)
      .sort(([a], [b]) => a.localeCompare(b));

    expect(shared).toEqual([
      ['/integrations/oauth/google/callback', ['DRIVE', 'GCAL', 'GMAIL']],
    ]);
  });

  it('getClientCreds returns null when client_id or secret env-fields are missing', () => {
    expect(OAUTH_PROVIDERS['GMAIL']!.getClientCreds(makeConfig({ googleOAuthClientId: '' }))).toBeNull();
    expect(OAUTH_PROVIDERS['GMAIL']!.getClientCreds(makeConfig({ googleOAuthClientSecret: undefined }))).toBeNull();
    expect(OAUTH_PROVIDERS['SLACK']!.getClientCreds(makeConfig({ slackClientId: '' }))).toBeNull();
    expect(OAUTH_PROVIDERS['NOTION']!.getClientCreds(makeConfig({ notionOAuthClientSecret: '' }))).toBeNull();
  });

  it('getClientCreds returns the configured pair when both fields are set', () => {
    const cfg = makeConfig();
    expect(OAUTH_PROVIDERS['GMAIL']!.getClientCreds(cfg)).toEqual({
      clientId: 'google-id', clientSecret: 'google-secret',
    });
    expect(OAUTH_PROVIDERS['SALESFORCE']!.getClientCreds(cfg)).toEqual({
      clientId: 'sf-id', clientSecret: 'sf-secret',
    });
  });
});

// ─── 2. Token-response parsers ─────────────────────────────────────────────

describe('parseTokenResponse — per provider', () => {
  it('Gmail (RFC 6749 standard) maps access_token / refresh_token / expires_in / scope', () => {
    const out = OAUTH_PROVIDERS['GMAIL']!.parseTokenResponse({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'gmail.send gmail.readonly',
      token_type: 'Bearer',
    });
    expect(out).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 3600,
      scope: 'gmail.send gmail.readonly',
    });
  });

  it('Gmail throws when access_token is missing', () => {
    expect(() => OAUTH_PROVIDERS['GMAIL']!.parseTokenResponse({ refresh_token: 'rt' }))
      .toThrow(/no access_token/);
  });

  it('Slack happy path: pulls bot access_token + team metadata into extraMetadata', () => {
    const out = OAUTH_PROVIDERS['SLACK']!.parseTokenResponse({
      ok: true,
      access_token: 'xoxb-bot',
      scope: 'chat:write,channels:read',
      bot_user_id: 'U-bot',
      app_id: 'A-app',
      team: { id: 'T-1', name: 'Acme' },
      authed_user: { id: 'U-user' },
    });
    expect(out.accessToken).toBe('xoxb-bot');
    expect(out.scope).toBe('chat:write,channels:read');
    expect(out.extraMetadata).toEqual({
      slackTeamId: 'T-1',
      slackTeamName: 'Acme',
      slackBotUserId: 'U-bot',
      slackAppId: 'A-app',
    });
  });

  it('Slack rejects ok:false with the provider error code (NOT the access_token if present)', () => {
    expect(() => OAUTH_PROVIDERS['SLACK']!.parseTokenResponse({
      ok: false,
      error: 'invalid_code',
      // Even if Slack erroneously echoed a token in an error response, the
      // thrown Error message must not surface it.
      access_token: 'leaked-token-should-not-appear',
    })).toThrow(/Slack OAuth rejected: invalid_code/);

    try {
      OAUTH_PROVIDERS['SLACK']!.parseTokenResponse({ ok: false, error: 'x', access_token: 'leaked-token' });
    } catch (e) {
      expect((e as Error).message).not.toContain('leaked-token');
    }
  });

  it('Notion captures workspace_id, workspace_name, bot_id, owner.type into metadata', () => {
    const out = OAUTH_PROVIDERS['NOTION']!.parseTokenResponse({
      access_token: 'secret_xx',
      workspace_id: 'ws-1',
      workspace_name: 'Acme HQ',
      bot_id: 'bot-1',
      owner: { type: 'workspace' },
    });
    expect(out.accessToken).toBe('secret_xx');
    expect(out.extraMetadata).toEqual({
      notionWorkspaceId: 'ws-1',
      notionWorkspaceName: 'Acme HQ',
      notionBotId: 'bot-1',
      notionOwnerType: 'workspace',
    });
  });

  it('Notion throws on missing access_token without leaking response body', () => {
    expect(() => OAUTH_PROVIDERS['NOTION']!.parseTokenResponse({ workspace_id: 'ws-1' }))
      .toThrow(/Notion OAuth returned no access_token/);
  });

  it('LinkedIn keeps the OIDC id_token in extraMetadata (used by frontend session bootstrap)', () => {
    const out = OAUTH_PROVIDERS['LINKEDIN']!.parseTokenResponse({
      access_token: 'li-at',
      expires_in: 5184000,
      scope: 'openid profile email w_member_social',
      id_token: 'eyJ.li.id',
    });
    expect(out.accessToken).toBe('li-at');
    expect(out.extraMetadata).toEqual({ linkedinIdToken: 'eyJ.li.id' });
  });

  it('Salesforce captures instance_url + issued_at + signature + id URL into metadata', () => {
    const out = OAUTH_PROVIDERS['SALESFORCE']!.parseTokenResponse({
      access_token: 'sf-at',
      refresh_token: 'sf-rt',
      scope: 'api refresh_token',
      instance_url: 'https://acme.my.salesforce.com',
      issued_at: '1717000000000',
      signature: 'sig=',
      id: 'https://login.salesforce.com/id/00D/005',
    });
    expect(out.accessToken).toBe('sf-at');
    expect(out.refreshToken).toBe('sf-rt');
    expect(out.extraMetadata).toMatchObject({
      salesforceInstanceUrl: 'https://acme.my.salesforce.com',
      salesforceIssuedAt: '1717000000000',
      salesforceSignature: 'sig=',
      salesforceIdUrl: 'https://login.salesforce.com/id/00D/005',
    });
  });

  it('Salesforce throws on missing access_token', () => {
    expect(() => OAUTH_PROVIDERS['SALESFORCE']!.parseTokenResponse({ instance_url: 'https://x' }))
      .toThrow(/Salesforce OAuth returned no access_token/);
  });

  it('parser errors never echo the request payload or any token-shaped string in the message', () => {
    // Defensive: cycle every parser through a malformed input and check the
    // error message is structured and short, not a JSON dump.
    const bad = { foo: 'access_token=should-not-be-quoted-back', bar: 'sk-secret' };
    for (const id of ['GMAIL', 'NOTION', 'SALESFORCE'] as const) {
      try {
        OAUTH_PROVIDERS[id]!.parseTokenResponse(bad);
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain('sk-secret');
        expect(msg).not.toContain('should-not-be-quoted-back');
        // Generic, structured error — not a 500-style stack dump.
        expect(msg.length).toBeLessThan(120);
      }
    }
  });
});

// ─── 3. Per-provider buildTokenRequest (only Notion + GitHub override) ─────

describe('buildTokenRequest — provider-specific overrides', () => {
  it('GitHub forces Accept: application/json so token responses come back as JSON', () => {
    const req = OAUTH_PROVIDERS['GITHUB']!.buildTokenRequest!({
      code: 'auth-code-1',
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'https://api.example.com/integrations/oauth/github/callback',
      clientId: 'gh-id',
      clientSecret: 'gh-secret',
    });
    expect(req.headers['Accept']).toBe('application/json');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(req.body).toBeInstanceOf(URLSearchParams);
    const body = req.body as URLSearchParams;
    expect(body.get('client_id')).toBe('gh-id');
    expect(body.get('client_secret')).toBe('gh-secret');
    expect(body.get('code')).toBe('auth-code-1');
    expect(body.get('redirect_uri')).toBe(
      'https://api.example.com/integrations/oauth/github/callback',
    );
    expect(body.get('code_verifier')).toBe('v'.repeat(43));
  });

  it('GitHub omits code_verifier when not supplied (defensive — keeps body lean)', () => {
    const req = OAUTH_PROVIDERS['GITHUB']!.buildTokenRequest!({
      code: 'c',
      redirectUri: 'https://x',
      clientId: 'i',
      clientSecret: 's',
    });
    const body = req.body as URLSearchParams;
    expect(body.has('code_verifier')).toBe(false);
  });

  it('Notion uses HTTP Basic auth + JSON body with grant_type=authorization_code', () => {
    const req = OAUTH_PROVIDERS['NOTION']!.buildTokenRequest!({
      code: 'auth-code',
      redirectUri: 'https://api.example.com/integrations/oauth/notion/callback',
      clientId: 'n-id',
      clientSecret: 'n-secret',
    });
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers['Authorization']).toMatch(/^Basic /);
    // Decode the basic credential and verify it's the configured pair —
    // no other secret should be embedded.
    const b64 = req.headers['Authorization']!.slice('Basic '.length);
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    expect(decoded).toBe('n-id:n-secret');

    expect(typeof req.body).toBe('string');
    const parsed = JSON.parse(req.body as string);
    expect(parsed).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: 'https://api.example.com/integrations/oauth/notion/callback',
    });
    // client_secret must NOT be in the body when sent via Basic header
    // (defense-in-depth — duplicate auth would let secret leak via logged
    // request bodies).
    expect((req.body as string)).not.toContain('n-secret');
  });

  it('only Notion + GitHub override buildTokenRequest; everyone else relies on the route default', () => {
    const overrides = Object.values(OAUTH_PROVIDERS)
      .filter((p) => p.buildTokenRequest)
      .map((p) => p.id)
      .sort();
    expect(overrides).toEqual(['GITHUB', 'NOTION']);
  });
});

// ─── 4. Identity fetchers (mock global fetch) ──────────────────────────────

describe('per-provider fetchIdentity helpers', () => {
  it('Gmail fetchIdentity hits userinfo with Bearer auth and returns the email', async () => {
    const { calls } = mockFetch(() => jsonResponse({ email: 'alice@example.com' }));
    const out = await OAUTH_PROVIDERS['GMAIL']!.fetchIdentity!('access-1');
    expect(out).toBe('alice@example.com');
    expect(calls[0]!.url).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect((calls[0]!.init!.headers as Record<string, string>)['Authorization']).toBe('Bearer access-1');
  });

  it('Gmail fetchIdentity returns null on non-200 (does not throw, never leaks token)', async () => {
    mockFetch(() => new Response('forbidden', { status: 403 }));
    await expect(OAUTH_PROVIDERS['GMAIL']!.fetchIdentity!('top-secret-token'))
      .resolves.toBeNull();
  });

  it('Gmail fetchIdentity swallows network errors into null (token never exposed via thrown error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET top-secret-token'));
    // We don't even surface the upstream error message — just null. A future
    // change that decides to rethrow MUST scrub the token first.
    await expect(OAUTH_PROVIDERS['GMAIL']!.fetchIdentity!('top-secret-token'))
      .resolves.toBeNull();
  });

  it('Slack fetchIdentity returns team.name on ok:true, null on ok:false', async () => {
    mockFetch(() => jsonResponse({ ok: true, team: { name: 'Acme HQ' } }));
    expect(await OAUTH_PROVIDERS['SLACK']!.fetchIdentity!('xoxb')).toBe('Acme HQ');

    vi.restoreAllMocks();
    mockFetch(() => jsonResponse({ ok: false, error: 'not_authed' }));
    expect(await OAUTH_PROVIDERS['SLACK']!.fetchIdentity!('xoxb')).toBeNull();
  });

  it('GitHub fetchIdentity sends Accept: application/vnd.github+json + Bearer auth', async () => {
    const { calls } = mockFetch(() => jsonResponse({ login: 'octocat' }));
    expect(await OAUTH_PROVIDERS['GITHUB']!.fetchIdentity!('gh-token')).toBe('octocat');
    expect(calls[0]!.url).toBe('https://api.github.com/user');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer gh-token');
    expect(headers['Accept']).toBe('application/vnd.github+json');
  });

  it('Notion fetchIdentity reads bot.workspace_name with Notion-Version header', async () => {
    const { calls } = mockFetch(() => jsonResponse({ bot: { workspace_name: 'Acme Notion' } }));
    expect(await OAUTH_PROVIDERS['NOTION']!.fetchIdentity!('secret_x')).toBe('Acme Notion');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['Notion-Version']).toBe('2022-06-28');
    expect(headers['Authorization']).toBe('Bearer secret_x');
  });

  it('Linear fetchIdentity uses raw token (no "Bearer " prefix) — Linear quirk', async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ data: { organization: { name: 'Acme Org' } } }),
    );
    expect(await OAUTH_PROVIDERS['LINEAR']!.fetchIdentity!('lin-token')).toBe('Acme Org');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('lin-token'); // raw, no Bearer prefix
    expect(calls[0]!.init!.method).toBe('POST');
    expect(calls[0]!.init!.body).toBe(JSON.stringify({ query: '{ organization { name } }' }));
  });

  it('LinkedIn provider fetchIdentity falls back from displayName → email when name is absent', async () => {
    mockFetch(() => jsonResponse({ sub: 'ABC', email: 'a@b.com' /* no name */ }));
    expect(await OAUTH_PROVIDERS['LINKEDIN']!.fetchIdentity!('li-token')).toBe('a@b.com');
  });

  it('Salesforce provider fetchIdentity is a no-op (returns null) — needs instance_url from metadata', async () => {
    // Verify by contract — the registry sets it to a function that returns
    // null because the standard fetchIdentity signature lacks instance_url.
    expect(await OAUTH_PROVIDERS['SALESFORCE']!.fetchIdentity!('sf-token')).toBeNull();
  });
});

// ─── 5. fetchLinkedInIdentity (named export, used directly by route) ───────

describe('fetchLinkedInIdentity', () => {
  it('builds the personUrn from sub and returns name + email', async () => {
    mockFetch(() => jsonResponse({ sub: 'ABC123', name: 'Alice', email: 'a@b.com' }));
    const ident = await fetchLinkedInIdentity('li-token');
    expect(ident).toEqual({
      displayName: 'Alice',
      personUrn: 'urn:li:person:ABC123',
      email: 'a@b.com',
    });
  });

  it('returns nulls (not undefined) when sub is missing — caller relies on null check', async () => {
    mockFetch(() => jsonResponse({ name: 'Alice' }));
    const ident = await fetchLinkedInIdentity('li-token');
    expect(ident.personUrn).toBeNull();
    expect(ident.email).toBeNull();
    expect(ident.displayName).toBe('Alice');
  });

  it('returns the all-null shape on non-200 without throwing or leaking the token', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    const ident = await fetchLinkedInIdentity('top-secret');
    expect(ident).toEqual({ displayName: null, personUrn: null, email: null });
  });
});

// ─── 6. fetchSalesforceIdentity ────────────────────────────────────────────

describe('fetchSalesforceIdentity', () => {
  it('hits {instance_url}/services/oauth2/userinfo with Bearer auth', async () => {
    const { calls } = mockFetch(() => jsonResponse({ name: 'Alice', email: 'a@b.com' }));
    const out = await fetchSalesforceIdentity('sf-at', 'https://acme.my.salesforce.com');
    expect(out).toBe('Alice');
    expect(calls[0]!.url).toBe('https://acme.my.salesforce.com/services/oauth2/userinfo');
    expect((calls[0]!.init!.headers as Record<string, string>)['Authorization']).toBe('Bearer sf-at');
  });

  it('falls back to preferred_username then email when name is absent', async () => {
    mockFetch(() => jsonResponse({ preferred_username: 'alice@acme', email: 'a@b.com' }));
    expect(await fetchSalesforceIdentity('sf', 'https://x')).toBe('alice@acme');
    vi.restoreAllMocks();
    mockFetch(() => jsonResponse({ email: 'a@b.com' }));
    expect(await fetchSalesforceIdentity('sf', 'https://x')).toBe('a@b.com');
  });

  it('returns null on non-200 (never throws, never leaks token through error path)', async () => {
    mockFetch(() => new Response('', { status: 401 }));
    await expect(fetchSalesforceIdentity('top-secret', 'https://x')).resolves.toBeNull();
  });
});

// ─── 7. applySalesforceDomain ──────────────────────────────────────────────

describe('applySalesforceDomain', () => {
  // Save and restore the URLs because applySalesforceDomain mutates the
  // exported registry object in place (deliberate — see source comment).
  let originalAuthUrl = '';
  let originalTokenUrl = '';

  beforeEach(() => {
    originalAuthUrl = OAUTH_PROVIDERS['SALESFORCE']!.authUrl;
    originalTokenUrl = OAUTH_PROVIDERS['SALESFORCE']!.tokenUrl;
  });
  afterEach(() => {
    OAUTH_PROVIDERS['SALESFORCE']!.authUrl = originalAuthUrl;
    OAUTH_PROVIDERS['SALESFORCE']!.tokenUrl = originalTokenUrl;
  });

  it('rewrites Salesforce auth + token URLs to the configured sandbox domain', () => {
    applySalesforceDomain(makeConfig({ salesforceOAuthDomain: 'test.salesforce.com' }));
    expect(OAUTH_PROVIDERS['SALESFORCE']!.authUrl).toBe(
      'https://test.salesforce.com/services/oauth2/authorize',
    );
    expect(OAUTH_PROVIDERS['SALESFORCE']!.tokenUrl).toBe(
      'https://test.salesforce.com/services/oauth2/token',
    );
  });

  it('defaults to login.salesforce.com when domain is undefined', () => {
    applySalesforceDomain(makeConfig({ salesforceOAuthDomain: undefined }));
    expect(OAUTH_PROVIDERS['SALESFORCE']!.authUrl).toBe(
      'https://login.salesforce.com/services/oauth2/authorize',
    );
  });

  it('does NOT mutate any other provider', () => {
    const beforeGmail = OAUTH_PROVIDERS['GMAIL']!.authUrl;
    const beforeSlack = OAUTH_PROVIDERS['SLACK']!.tokenUrl;
    applySalesforceDomain(makeConfig({ salesforceOAuthDomain: 'test.salesforce.com' }));
    expect(OAUTH_PROVIDERS['GMAIL']!.authUrl).toBe(beforeGmail);
    expect(OAUTH_PROVIDERS['SLACK']!.tokenUrl).toBe(beforeSlack);
  });

  it('trims whitespace; an all-whitespace domain is treated as "no override"', () => {
    OAUTH_PROVIDERS['SALESFORCE']!.authUrl = 'sentinel-auth';
    OAUTH_PROVIDERS['SALESFORCE']!.tokenUrl = 'sentinel-token';
    applySalesforceDomain(makeConfig({ salesforceOAuthDomain: '   ' }));
    // Empty post-trim -> early-return without writing anything.
    expect(OAUTH_PROVIDERS['SALESFORCE']!.authUrl).toBe('sentinel-auth');
    expect(OAUTH_PROVIDERS['SALESFORCE']!.tokenUrl).toBe('sentinel-token');
  });
});

// ─── 8. listOAuthProviders ─────────────────────────────────────────────────

describe('listOAuthProviders', () => {
  it('reports configured:true for every provider when all client creds are set', () => {
    const list = listOAuthProviders(makeConfig());
    expect(list.every((p) => p.configured)).toBe(true);
    expect(list.map((p) => p.id).sort()).toEqual(
      ['DRIVE', 'GCAL', 'GITHUB', 'GMAIL', 'LINEAR', 'LINKEDIN', 'NOTION', 'SALESFORCE', 'SLACK'],
    );
  });

  it('marks a provider as configured:false when its client_id is missing', () => {
    const list = listOAuthProviders(makeConfig({ githubOAuthClientId: '' }));
    const gh = list.find((p) => p.id === 'GITHUB')!;
    expect(gh.configured).toBe(false);
    // Other providers unaffected
    expect(list.find((p) => p.id === 'GMAIL')!.configured).toBe(true);
  });

  it('returns id + label + configured (and nothing more) — no secrets leak through this list', () => {
    const list = listOAuthProviders(makeConfig());
    for (const entry of list) {
      expect(Object.keys(entry).sort()).toEqual(['configured', 'id', 'label']);
      // Sanity: client_id/client_secret values must not appear anywhere.
      expect(JSON.stringify(entry)).not.toMatch(/secret|google-id|gh-id|sf-secret/);
    }
  });
});

// ─── 9. ABSENCE TESTS — concerns NOT in this module, with regression guards ─
//
// These cases were on the test brief but the source file deliberately does
// NOT implement them. We pin the absence so a sloppy future commit that adds
// half-baked logic to oauth-providers.ts (rather than to the proper layer)
// fails CI.

describe('out-of-scope concerns are NOT silently re-implemented in oauth-providers.ts', () => {
  it('does not export a state-token generator (lives in utils/pkce.ts as generateStateToken)', async () => {
    const mod: Record<string, unknown> = await import(
      '../../../apps/api/src/services/oauth-providers.js'
    );
    expect(mod['generateStateToken']).toBeUndefined();
    expect(mod['generateState']).toBeUndefined();
    expect(mod['createState']).toBeUndefined();
    // If a future PR moves the helper into this file, the move should also
    // update this assertion to verify ≥ 32 bytes / URL-safe / crypto-random.
  });

  it('does not export a code-verifier or code-challenge generator (lives in utils/pkce.ts)', async () => {
    const mod: Record<string, unknown> = await import(
      '../../../apps/api/src/services/oauth-providers.js'
    );
    expect(mod['generateCodeVerifier']).toBeUndefined();
    expect(mod['deriveCodeChallenge']).toBeUndefined();
  });

  it('does not export a redirect_uri resolver or allowlist (lives in integrations.routes.ts)', async () => {
    const mod: Record<string, unknown> = await import(
      '../../../apps/api/src/services/oauth-providers.js'
    );
    expect(mod['resolveRedirectUri']).toBeUndefined();
    expect(mod['validateRedirectUri']).toBeUndefined();
    expect(mod['REDIRECT_URI_ALLOWLIST']).toBeUndefined();
  });

  it('does not implement the token-exchange POST itself (lives in integrations.routes.ts)', async () => {
    const mod: Record<string, unknown> = await import(
      '../../../apps/api/src/services/oauth-providers.js'
    );
    expect(mod['exchangeAuthorizationCode']).toBeUndefined();
    expect(mod['exchangeCode']).toBeUndefined();
  });

  it('does not implement a refresh-token grant flow (NOT YET IMPLEMENTED ANYWHERE in JAK Swarm)', async () => {
    const mod: Record<string, unknown> = await import(
      '../../../apps/api/src/services/oauth-providers.js'
    );
    expect(mod['refreshAccessToken']).toBeUndefined();
    expect(mod['refreshToken']).toBeUndefined();
    // Audit follow-up P1: tokens get persisted with expiresAt but no
    // background refresh loop reads them back. Surface this as a real gap,
    // not a half-built abstraction.
  });

  // The following items belong to the route + Prisma layer. We mark them
  // explicitly so the file's coverage report shows the skipped intent.
  it.todo('TODO[route layer test]: state ≥32B random URL-safe — covered in tests/unit/utils/pkce.test.ts');
  it.todo('TODO[route layer test]: state stored with tenant + provider + 10-min TTL — covered in integrations.routes.test.ts');
  it.todo('TODO[route layer test]: callback w/ wrong state → errRedirect (single-use delete on redeem)');
  it.todo('TODO[route layer test]: callback w/ expired state → errRedirect("Authorization request expired")');
  it.todo('TODO[route layer test]: cross-tenant — state row from tenant A cannot mutate tenant B integrations');
  it.todo('TODO[route layer test]: redirect_uri exact-match against API_PUBLIC_URL + callbackPath');
  it.todo('TODO[route layer test]: token-exchange 4xx → errRedirect (NOT 500)');
  it.todo('TODO[route layer test]: refresh-token grant — service does not yet exist; track as roadmap item');
});
