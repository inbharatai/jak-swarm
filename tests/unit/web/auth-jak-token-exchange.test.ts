/**
 * A.1 — fetchTrustedAuthUser stores the JAK JWT the API mints on /auth/me.
 *
 * When the API resolves a request via the Supabase fallback it returns
 * `jakToken` alongside the profile. The web must store it so subsequent
 * API + SSE calls authenticate via jwtVerify() with zero Supabase
 * round-trips. When `jakToken` is absent (the request was already
 * authenticated via a JAK JWT, or the API predates the exchange) the
 * existing stored-token flow continues unchanged — backward compatible.
 *
 * Node-env safe: stubs `window`/`document`/`fetch` and mocks the supabase
 * client module so importing auth.ts has no side effects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../apps/web/src/lib/supabase', () => ({
  createClient: vi.fn(() => ({})),
}));

import { fetchTrustedAuthUser } from '../../../apps/web/src/lib/auth';

// ─── window / document / fetch stubs ─────────────────────────────────────────

interface WindowStub {
  localStorage: { setItem: ReturnType<typeof vi.fn>; getItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
  location: { protocol: string };
}
interface DocStub { cookie: string }

let originalFetch: typeof globalThis.fetch;
let originalWindow: typeof globalThis.window | undefined;
let originalDocument: typeof globalThis.document | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalWindow = (globalThis as { window?: typeof globalThis.window }).window;
  originalDocument = (globalThis as { document?: typeof globalThis.document }).document;

  const store: Record<string, string> = {};
  const setItem = vi.fn((k: string, v: string) => { store[k] = v; });
  const getItem = vi.fn((k: string) => store[k] ?? null);
  const removeItem = vi.fn((k: string) => { delete store[k]; });

  (globalThis as { window?: WindowStub }).window = {
    localStorage: { setItem, getItem, removeItem },
    location: { protocol: 'http:' },
  };
  (globalThis as { document?: DocStub }).document = { cookie: '' };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
  if (originalDocument === undefined) {
    delete (globalThis as { document?: unknown }).document;
  } else {
    (globalThis as { document?: unknown }).document = originalDocument;
  }
  vi.restoreAllMocks();
});

const USER_PAYLOAD = {
  id: 'usr-seed',
  email: 'founder@acme.com',
  tenantId: 'tnt-seed',
  name: 'Ada Founder',
  role: 'TENANT_ADMIN',
  tenantName: 'Acme Inc',
  industry: 'TECHNOLOGY',
};

function mockFetch(payload: unknown): ReturnType<typeof vi.fn> {
  const f = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response));
  globalThis.fetch = f as unknown as typeof globalThis.fetch;
  return f;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('A.1 fetchTrustedAuthUser — JAK JWT storage', () => {
  it('stores the minted jakToken via setToken when the API returns one', async () => {
    mockFetch({ success: true, data: USER_PAYLOAD, jakToken: 'jak.jwt.minted' });

    const user = await fetchTrustedAuthUser('supabase-access-token');

    expect(user).not.toBeNull();
    expect(user?.id).toBe('usr-seed');

    // setToken wrote the JAK JWT to localStorage under the canonical key.
    const setItem = (globalThis as { window?: WindowStub }).window!.localStorage.setItem;
    expect(setItem).toHaveBeenCalledWith('jak-auth-token', 'jak.jwt.minted');
    // The hydrated user is also cached.
    expect(setItem).toHaveBeenCalledWith('jak-auth-user', JSON.stringify(user));
  });

  it('backward compat: does NOT overwrite the stored token when jakToken is absent', async () => {
    // Simulates an already-minted JAK JWT re-calling /auth/me (the API
    // resolves via jwtVerify and omits jakToken), or an old API that
    // never minted. The stored token must be left untouched.
    mockFetch({ success: true, data: USER_PAYLOAD });

    const user = await fetchTrustedAuthUser('an-already-stored-jak-jwt');

    expect(user).not.toBeNull();
    expect(user?.id).toBe('usr-seed');

    const setItem = (globalThis as { window?: WindowStub }).window!.localStorage.setItem;
    // jak-auth-token is NOT written by fetchTrustedAuthUser in this path.
    expect(setItem).not.toHaveBeenCalledWith('jak-auth-token', expect.anything());
  });

  it('throws when the API responds non-2xx', async () => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid or expired token' } }),
    } as unknown as Response));
    globalThis.fetch = f as unknown as typeof globalThis.fetch;

    await expect(fetchTrustedAuthUser('bad-token')).rejects.toThrow(/Invalid or expired token/);
  });
});