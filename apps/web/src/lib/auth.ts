'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AuthUser } from '@/types';
import { createClient } from './supabase';
import type { User as SupabaseUser, SupabaseClient } from '@supabase/supabase-js';
import { normalizeSupabaseProjectUrl } from './supabase-url';

let _supabase: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!_supabase) _supabase = createClient();
  return _supabase;
}

/**
 * DEV-ONLY auth bypass — when `NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS=1` the
 * `useAuth` hook short-circuits to a synthetic AuthUser whose IDs
 * match the dev tenant + user seeded by `scripts/seed-dev-bypass.ts`,
 * and `isAuthenticated()` returns true. The dashboard layout's
 * "redirect to /login when no user" check is automatically satisfied.
 *
 * Paired with the API-side bypass in apps/api/src/plugins/auth.plugin.ts;
 * the same three-layer safety contract applies (NODE_ENV gate +
 * env-flag opt-in + literal bypass token in api-client.ts).
 */
const DEV_BYPASS_ACTIVE = process.env['NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS'] === '1';
const JAK_TOKEN_KEY = 'jak-auth-token';
const JAK_USER_KEY = 'jak-auth-user';

const DEV_BYPASS_USER: AuthUser = {
  id: 'dev-user-id',
  email: 'dev@local.test',
  name: 'Local Dev User',
  role: 'TENANT_ADMIN',
  tenantId: 'dev-tenant-id',
  tenantName: 'Local Dev Tenant',
  // The web `Industry` type doesn't include 'GENERAL' (the API DB does);
  // pick TECHNOLOGY since dev workflows are unlabeled and TECHNOLOGY
  // imposes no restricted-tool list, matching GENERAL semantics.
  industry: 'TECHNOLOGY',
};

// ─── Map Supabase user to JAK AuthUser ──────────────────────────────────────

function mapSupabaseUser(user: SupabaseUser): AuthUser {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? '',
    name: meta['name'] ?? meta['full_name'] ?? user.email?.split('@')[0] ?? '',
    // Never trust Supabase user_metadata for authorization. The API resolves
    // roles and tenant membership from local DB / trusted app_metadata.
    role: 'VIEWER',
    tenantId: '',
    tenantName: meta['tenantName'] ?? '',
    industry: meta['industry'] ?? 'TECHNOLOGY',
    avatarUrl: meta['avatar_url'] ?? undefined,
    jobFunction: meta['jobFunction'] ?? undefined,
  };
}

function isLocalhostApi(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(url);
}

function resolveAuthApiBaseUrl(): string {
  const configured = process.env['NEXT_PUBLIC_API_URL']?.trim();
  const isProd = process.env['NODE_ENV'] === 'production';
  if (configured) {
    if (isProd && isLocalhostApi(configured)) {
      throw new Error('Backend API is not configured. NEXT_PUBLIC_API_URL points at localhost in a production build.');
    }
    return configured.replace(/\/$/, '');
  }
  if (isProd) {
    throw new Error('Backend API is not configured. Set NEXT_PUBLIC_API_URL to your deployed API URL.');
  }
  return 'http://localhost:4000';
}

function buildAuthApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${resolveAuthApiBaseUrl()}${normalized}`;
}

interface BackendAuthLoginPayload {
  token?: unknown;
  user?: unknown;
}

function unwrapApiEnvelope<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'success' in payload &&
    (payload as { success?: unknown }).success === true &&
    'data' in payload
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function extractApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const maybeMessage =
    (payload as { error?: { message?: unknown } }).error?.message ??
    (payload as { message?: unknown }).message;
  return typeof maybeMessage === 'string' && maybeMessage.trim().length > 0
    ? maybeMessage.trim()
    : null;
}

function shouldFallbackToBackendAuth(error: unknown): boolean {
  const message = getAuthErrorMessage(error, AUTH_SERVICE_UNAVAILABLE_MESSAGE).toLowerCase();
  return (
    message === AUTH_SERVICE_UNAVAILABLE_MESSAGE.toLowerCase() ||
    /failed to fetch|fetch failed|network request failed|networkerror|load failed|auth profile lookup failed/.test(message)
  );
}

async function loginWithBackendPassword(email: string, password: string): Promise<AuthUser> {
  const response = await fetch(buildAuthApiUrl('/auth/login'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(payload) ??
      `Login failed (${response.status})`,
    );
  }

  const auth = unwrapApiEnvelope<BackendAuthLoginPayload | null>(payload);
  const token = auth && typeof auth.token === 'string' ? auth.token : '';
  const user = coerceAuthUser(auth?.user);
  if (!token || !user) {
    throw new Error('Login succeeded but auth payload was incomplete');
  }
  setToken(token, user);
  return user;
}

async function fetchTrustedAuthUser(accessToken: string | null | undefined, fallbackUser?: SupabaseUser | null): Promise<AuthUser | null> {
  if (!accessToken) return fallbackUser ? mapSupabaseUser(fallbackUser) : null;
  const response = await fetch(buildAuthApiUrl('/auth/me'), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
    throw new Error(body?.error?.message ?? body?.message ?? `Auth profile lookup failed (${response.status})`);
  }
  const payload = await response.json().catch(() => null) as { data?: unknown } | null;
  const trusted = coerceAuthUser(payload?.data);
  if (!trusted) {
    throw new Error('Auth profile lookup returned an invalid user profile');
  }
  return trusted;
}

function setJakCookie(token: string): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${JAK_TOKEN_KEY}=${encodeURIComponent(token)}; Path=/; Max-Age=${60 * 60 * 24 * 7}; SameSite=Lax${secure}`;
}

function clearJakCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${JAK_TOKEN_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
  document.cookie = 'jak_token=; Path=/; Max-Age=0; SameSite=Lax';
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(window.atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function coerceAuthUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw['id'] ?? raw['userId'] ?? raw['sub'] ?? '');
  const email = String(raw['email'] ?? '');
  const tenantId = String(raw['tenantId'] ?? '');
  if (!id || !email || !tenantId) return null;
  return {
    id,
    email,
    name: String(raw['name'] ?? email.split('@')[0] ?? ''),
    role: String(raw['role'] ?? 'VIEWER') as AuthUser['role'],
    tenantId,
    tenantName: String(raw['tenantName'] ?? ''),
    industry: String(raw['industry'] ?? 'TECHNOLOGY') as AuthUser['industry'],
    jobFunction: raw['jobFunction'] ? String(raw['jobFunction']) as AuthUser['jobFunction'] : undefined,
  };
}

function getStoredJakUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(JAK_USER_KEY);
  if (stored) {
    try {
      const user = coerceAuthUser(JSON.parse(stored));
      if (user) return user;
    } catch {
      window.localStorage.removeItem(JAK_USER_KEY);
    }
  }
  const token = window.localStorage.getItem(JAK_TOKEN_KEY) ?? window.localStorage.getItem('jak_token');
  if (!token) return null;
  return coerceAuthUser(decodeJwtPayload(token));
}

// ─── Token helpers (backward compat) ─────────────────────────────────────────

export function setToken(token: string, user?: AuthUser): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(JAK_TOKEN_KEY, token);
  setJakCookie(token);
  if (user) {
    window.localStorage.setItem(JAK_USER_KEY, JSON.stringify(user));
  }
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(JAK_TOKEN_KEY);
  window.localStorage.removeItem(JAK_USER_KEY);
  window.localStorage.removeItem('jak_token');
  clearJakCookie();
}

export function getRawToken(): string | null {
  // For backward compat with api-client.ts
  if (typeof window === 'undefined') return null;
  // Supabase stores the session — we can get the access token from it
  return window.localStorage.getItem(JAK_TOKEN_KEY) ?? window.localStorage.getItem('jak_token');
}

// ─── Session check ───────────────────────────────────────────────────────────

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  if (DEV_BYPASS_ACTIVE) return true;
  if (getRawToken()) return true;
  // Sync check: Supabase stores auth tokens in localStorage
  const storageKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
  if (!storageKey) return false;
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return !!data?.access_token;
  } catch {
    return false;
  }
}

// ─── useAuth hook (Supabase-powered) ────────────────────────────────────────

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
}

interface UseAuthReturn extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  requestMagicPin: (email: string) => Promise<void>;
  verifyMagicPin: (email: string, token: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    name: string;
    tenantName: string;
    industry: string;
  }) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

function buildAbsoluteUrl(path: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URL(path, window.location.origin).toString();
}

const AUTH_SERVICE_UNAVAILABLE_MESSAGE =
  'Authentication service is unavailable. Please try again shortly.';

function hasUsableSupabaseConfig(): boolean {
  const url = normalizeSupabaseProjectUrl(process.env['NEXT_PUBLIC_SUPABASE_URL']);
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']?.trim();
  if (!url || !anonKey) return false;

  const combined = `${url} ${anonKey}`.toLowerCase();
  if (/placeholder|local-e2e|yourproject|example|not-real|dummy|changeme/.test(combined)) {
    return false;
  }

  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function getAuthErrorMessage(error: unknown, fallback = AUTH_SERVICE_UNAVAILABLE_MESSAGE): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';

  if (!rawMessage) return fallback;
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(rawMessage)) {
    return fallback;
  }

  return rawMessage;
}

async function runAuthRequest<T>(
  operation: () => Promise<T>,
  fallback?: string,
): Promise<T> {
  if (!hasUsableSupabaseConfig()) {
    throw new Error(fallback ?? AUTH_SERVICE_UNAVAILABLE_MESSAGE);
  }

  try {
    return await operation();
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, fallback));
  }
}

export function useAuth(): UseAuthReturn {
  // Both hooks now resolve in parallel — useAuthSession reads Supabase session,
  // useAuthProfile reads the token from localStorage directly and fires /auth/me
  // immediately on first render (no React state waterfall).
  const { sessionUser, isSessionLoading } = useAuthSession();
  const { user: profileUser, error: profileError } = useAuthProfile();
  const [isMutating, setIsMutating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const user = profileUser ?? sessionUser;
  const isLoading = isMutating || isSessionLoading;
  const error = authError ?? profileError;

  const failAuth = useCallback((error: unknown, fallback?: string): never => {
    const message = getAuthErrorMessage(error, fallback);
    setIsMutating(false);
    setAuthError(message);
    throw new Error(message);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    clearToken();
    setIsMutating(true);
    setAuthError(null);

    // Primary path: Supabase password auth (near instant).
    // Profile/role hydration continues asynchronously via useAuthProfile().
    // Fallback path: backend /auth/login when Supabase is unavailable.
    if (hasUsableSupabaseConfig()) {
      try {
        const { data, error } = await runAuthRequest(
          () => getClient().auth.signInWithPassword({ email, password }),
        );
        if (error) {
          failAuth(error);
        }

        if (data.session?.access_token && data.user) {
          setToken(data.session.access_token, mapSupabaseUser(data.user));
        }
        setIsMutating(false);
        return;
      } catch (error) {
        if (!shouldFallbackToBackendAuth(error)) {
          failAuth(error);
        }
      }
    }

    await loginWithBackendPassword(email, password).catch((error) => failAuth(error));
    setIsMutating(false);
    setAuthError(null);
  }, [failAuth]);

  const requestMagicPin = useCallback(async (email: string) => {
    clearToken();
    setIsMutating(true);
    setAuthError(null);
    const { error } = await runAuthRequest(
      () => getClient().auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: buildAbsoluteUrl('/auth/confirm?next=/workspace'),
        },
      }),
    ).catch(error => failAuth(error));
    if (error) {
      failAuth(error);
    }

    setIsMutating(false);
    setAuthError(null);
  }, [failAuth]);

  const verifyMagicPin = useCallback(async (email: string, token: string) => {
    setIsMutating(true);
    setAuthError(null);
    const { data, error } = await runAuthRequest(
      () => getClient().auth.verifyOtp({
        email,
        token,
        type: 'email',
      }),
    ).catch(error => failAuth(error));
    if (error) {
      failAuth(error);
    }

    if (data.session?.access_token && data.user) {
      setToken(data.session.access_token, mapSupabaseUser(data.user));
    }

    setIsMutating(false);
    setAuthError(null);
  }, [failAuth]);

  const register = useCallback(
    async (data: {
      email: string;
      password: string;
      name: string;
      tenantName: string;
      industry: string;
    }) => {
      clearToken();
      setIsMutating(true);
      setAuthError(null);
      const { error } = await runAuthRequest(
        () => getClient().auth.signUp({
          email: data.email,
          password: data.password,
          options: {
            data: {
              name: data.name,
              full_name: data.name,
              tenantName: data.tenantName,
              industry: data.industry,
            },
          },
        }),
      ).catch(error => failAuth(error));
      if (error) {
        failAuth(error);
      }
      setIsMutating(false);
      setAuthError(null);
    },
    [failAuth],
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    setIsMutating(true);
    setAuthError(null);
    const { error } = await runAuthRequest(
      () => getClient().auth.resetPasswordForEmail(email, {
        redirectTo: buildAbsoluteUrl('/auth/confirm?next=/reset-password'),
      }),
    ).catch(error => failAuth(error));

    if (error) {
      failAuth(error);
    }

    setIsMutating(false);
    setAuthError(null);
  }, [failAuth]);

  const updatePassword = useCallback(async (password: string) => {
    setIsMutating(true);
    setAuthError(null);
    const { error } = await runAuthRequest(
      () => getClient().auth.updateUser({ password }),
    ).catch(error => failAuth(error));

    if (error) {
      failAuth(error);
    }

    setIsMutating(false);
    setAuthError(null);
  }, [failAuth]);

  const logout = useCallback(async () => {
    clearToken();
    setIsMutating(true);
    setAuthError(null);
    await runAuthRequest(
      () => getClient().auth.signOut(),
      'Unable to reach the authentication service; local session was cleared.',
    ).catch(() => undefined);
    setIsMutating(false);
    setAuthError(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, []);

  return {
    user,
    isLoading,
    error,
    login,
    requestMagicPin,
    verifyMagicPin,
    register,
    requestPasswordReset,
    updatePassword,
    logout,
    isAuthenticated: user !== null,
  };
}

// ─── useAuthSession ──────────────────────────────────────────────────────────
//
// Reads the Supabase session from localStorage — typically resolves in < 50ms
// on the first render. Returns a minimal AuthUser (role=VIEWER, no tenant
// profile) sufficient for the dashboard shell to render immediately.
// Role-gated features MUST wait for useAuthProfile().

export interface AuthSessionState {
  user: AuthUser | null;
  /** @deprecated Use getRawToken() or useAuthProfile() instead — accessToken will be removed in a future release. */
  session: { accessToken: string | null };
  isLoading: boolean;
  sessionUser: AuthUser | null;
  /** @deprecated Use getRawToken() or useAuthProfile() instead — accessToken will be removed in a future release. */
  accessToken: string | null;
  isSessionLoading: boolean;
}

function createAuthSessionState(
  sessionUser: AuthUser | null,
  accessToken: string | null,
  isSessionLoading: boolean,
): AuthSessionState {
  return {
    user: sessionUser,
    session: { accessToken },
    isLoading: isSessionLoading,
    sessionUser,
    accessToken,
    isSessionLoading,
  };
}

function readSessionFromStorage(): { user: SupabaseUser | null; accessToken: string | null } {
  if (typeof window === 'undefined') return { user: null, accessToken: null };
  const storageKey = Object.keys(localStorage).find(
    (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
  );
  if (!storageKey) return { user: null, accessToken: null };
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as {
      access_token?: string;
      user?: SupabaseUser;
    };
    if (data?.access_token && data?.user) {
      return { user: data.user, accessToken: data.access_token };
    }
  } catch {
    // ignore — fall through
  }
  return { user: null, accessToken: null };
}

export function useAuthSession(): AuthSessionState {
  const [state, setState] = useState<AuthSessionState>(() => {
    if (DEV_BYPASS_ACTIVE) {
      return createAuthSessionState(DEV_BYPASS_USER, null, false);
    }
    // Try JAK's own stored user first (already fully hydrated)
    const storedUser = getStoredJakUser();
    if (storedUser) {
      return createAuthSessionState(storedUser, getRawToken(), false);
    }
    // Try Supabase localStorage session for near-instant auth detection
    const { user: sbUser, accessToken } = readSessionFromStorage();
    if (sbUser) {
      return createAuthSessionState(mapSupabaseUser(sbUser), accessToken, false);
    }
    return createAuthSessionState(null, null, true);
  });

  useEffect(() => {
    if (DEV_BYPASS_ACTIVE) return;

    if (!hasUsableSupabaseConfig()) {
      setState(createAuthSessionState(null, null, false));
      return;
    }

    let cancelled = false;

    // getSession() reads from Supabase's in-memory/localStorage cache — fast
    getClient()
      .auth.getSession()
      .then((result) => {
        if (cancelled) return;
        const session = result.data.session;
        setState(
          createAuthSessionState(
            session?.user ? mapSupabaseUser(session.user) : null,
            session?.access_token ?? null,
            false,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setState(createAuthSessionState(null, null, false));
      });

    const {
      data: { subscription },
    } = getClient().auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setState(
        createAuthSessionState(
          session?.user ? mapSupabaseUser(session.user) : null,
          session?.access_token ?? null,
          false,
        ),
      );
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}

// ─── useAuthProfile ──────────────────────────────────────────────────────────
//
// Fetches the trusted user profile from GET /auth/me. Self-contained — reads
// the access token from localStorage directly so it can fire in parallel with
// useAuthSession, eliminating the 3-hop serial waterfall on cold starts:
//
//   Before: localStorage → getSession() → [React re-render] → GET /auth/me
//   After:  localStorage → getSession() ║ GET /auth/me  (parallel)
//
// Consume this only where role/tenant data is needed; show skeleton states
// while it resolves.

export interface AuthProfileState {
  profile: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  user: AuthUser | null;
  isProfileLoading: boolean;
}

function createAuthProfileState(
  user: AuthUser | null,
  isProfileLoading: boolean,
  error: string | null,
): AuthProfileState {
  return {
    profile: user,
    isLoading: isProfileLoading,
    error,
    user,
    isProfileLoading,
  };
}

/**
 * Read the access token directly from localStorage — no React state dependency.
 * This lets useAuthProfile fire /auth/me on the first render instead of waiting
 * for useAuthSession's state to propagate.
 */
function getAccessTokenSync(): string | null {
  if (typeof window === 'undefined') return null;
  // Try JAK's own stored token first (set by setToken())
  const jakToken = window.localStorage.getItem(JAK_TOKEN_KEY) ?? window.localStorage.getItem('jak_token');
  if (jakToken) return jakToken;
  // Fall back to Supabase localStorage session
  const storageKey = Object.keys(localStorage).find(
    (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
  );
  if (!storageKey) return null;
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as {
      access_token?: string;
    };
    return data?.access_token ?? null;
  } catch {
    return null;
  }
}

export function useAuthProfile(): AuthProfileState {
  const [state, setState] = useState<AuthProfileState>(() => {
    if (DEV_BYPASS_ACTIVE) return createAuthProfileState(DEV_BYPASS_USER, false, null);
    // Try cached user from localStorage — avoids network hop on repeat visits
    const storedUser = getStoredJakUser();
    if (storedUser) return createAuthProfileState(storedUser, false, null);
    // No cached user, but token exists — mark loading so the effect fires immediately
    const token = getAccessTokenSync();
    return createAuthProfileState(null, token !== null, null);
  });

  useEffect(() => {
    if (DEV_BYPASS_ACTIVE) return;

    // Read token synchronously from localStorage (not React state)
    const initialToken = getAccessTokenSync();

    let cancelled = false;
    let currentToken = initialToken;

    function fetchProfile(token: string | null): void {
      if (!token) {
        if (!cancelled) setState(createAuthProfileState(null, false, null));
        return;
      }
      if (!cancelled) setState((prev) => createAuthProfileState(prev.user, true, prev.error));
      fetchTrustedAuthUser(token)
        .then((user) => {
          if (!cancelled) setState(createAuthProfileState(user, false, null));
        })
        .catch((err) => {
          if (!cancelled) {
            setState(createAuthProfileState(getStoredJakUser(), false, getAuthErrorMessage(err)));
          }
        });
    }

    // Fire /auth/me immediately using the localStorage token — no React re-render gap
    fetchProfile(initialToken);

    // Subscribe to Supabase auth state changes for token refresh / login / logout
    if (!hasUsableSupabaseConfig()) return;

    const {
      data: { subscription },
    } = getClient().auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const newToken = session?.access_token ?? null;
      // Re-fetch profile when token changes (login, refresh, logout)
      if (newToken !== currentToken) {
        currentToken = newToken;
        fetchProfile(newToken);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
