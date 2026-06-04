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
  const storedJakUser = getStoredJakUser();
  const [state, setState] = useState<AuthState>({
    // In dev-bypass mode, start with the synthetic user already populated
    // so the dashboard layout's "redirect when no user" check is satisfied
    // on the very first render. Skips the loading spinner entirely.
    user: DEV_BYPASS_ACTIVE ? DEV_BYPASS_USER : storedJakUser,
    isLoading: !DEV_BYPASS_ACTIVE && !storedJakUser,
    error: null,
  });

  useEffect(() => {
    // DEV-ONLY: in bypass mode the synthetic user is already in state;
    // skip every Supabase round-trip to keep the cockpit responsive
    // and avoid pinging Supabase with a non-existent session.
    if (DEV_BYPASS_ACTIVE) return;
    const localUser = getStoredJakUser();
    if (localUser) {
      setState({ user: localUser, isLoading: false, error: null });
      return;
    }

    if (!hasUsableSupabaseConfig()) {
      setState({
        user: null,
        isLoading: false,
        error: AUTH_SERVICE_UNAVAILABLE_MESSAGE,
      });
      return;
    }

    let cancelled = false;
    const hydrateTrustedUser = async (
      supabaseUser: SupabaseUser | null | undefined,
      accessToken?: string | null,
    ): Promise<void> => {
      if (!supabaseUser) {
        if (!cancelled) {
          setState({ user: null, isLoading: false, error: null });
        }
        return;
      }
      try {
        const trustedUser = await fetchTrustedAuthUser(accessToken, supabaseUser);
        if (!cancelled) {
          setState({
            user: trustedUser,
            isLoading: false,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          // Never strand the dashboard on a blank/suspended loading view if
          // trusted profile hydration fails. Fall back to a safe minimal user
          // shape (role=VIEWER) so navigation can recover and show errors.
          setState({
            user: mapSupabaseUser(supabaseUser),
            isLoading: false,
            error: getAuthErrorMessage(error),
          });
        }
      }
    };

    // Get initial session and hydrate role/tenant from the trusted API.
    runAuthRequest(() => getClient().auth.getSession())
      .then((result) => {
        void hydrateTrustedUser(result.data.session?.user, result.data.session?.access_token);
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            user: null,
            isLoading: false,
            error: getAuthErrorMessage(error),
          });
        }
      });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = getClient().auth.onAuthStateChange((_event, session) => {
      void hydrateTrustedUser(session?.user, session?.access_token).catch((error) => {
        if (!cancelled) {
          setState({
            user: null,
            isLoading: false,
            error: getAuthErrorMessage(error),
          });
        }
      });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const failAuth = useCallback((error: unknown, fallback?: string): never => {
    const message = getAuthErrorMessage(error, fallback);
    setState(prev => ({
      ...prev,
      isLoading: false,
      error: message,
    }));
    throw new Error(message);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    clearToken();
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    // Primary path: Supabase password auth + trusted profile hydration.
    // Fallback path: backend /auth/login when Supabase is unavailable.
    if (hasUsableSupabaseConfig()) {
      try {
        const { data, error } = await runAuthRequest(
          () => getClient().auth.signInWithPassword({ email, password }),
        );
        if (error) {
          failAuth(error);
        }

        if (data.user) {
          const trustedUser = await fetchTrustedAuthUser(data.session?.access_token, data.user);
          setState({
            user: trustedUser,
            isLoading: false,
            error: null,
          });
          return;
        }
      } catch (error) {
        if (!shouldFallbackToBackendAuth(error)) {
          failAuth(error);
        }
      }
    }

    const backendUser = await loginWithBackendPassword(email, password).catch((error) => failAuth(error));
    setState({
      user: backendUser,
      isLoading: false,
      error: null,
    });
  }, [failAuth]);

  const requestMagicPin = useCallback(async (email: string) => {
    clearToken();
    setState(prev => ({ ...prev, isLoading: true, error: null }));
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

    setState(prev => ({ ...prev, isLoading: false, error: null }));
  }, [failAuth]);

  const verifyMagicPin = useCallback(async (email: string, token: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
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
    const trustedUser = await fetchTrustedAuthUser(data.session?.access_token, data.user).catch(error => failAuth(error));
    setState({
      user: trustedUser,
      isLoading: false,
      error: null,
    });
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
      setState(prev => ({ ...prev, isLoading: true, error: null }));
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
      setState(prev => ({ ...prev, isLoading: false, error: null }));
    },
    [failAuth],
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await runAuthRequest(
      () => getClient().auth.resetPasswordForEmail(email, {
        redirectTo: buildAbsoluteUrl('/auth/confirm?next=/reset-password'),
      }),
    ).catch(error => failAuth(error));

    if (error) {
      failAuth(error);
    }

    setState(prev => ({ ...prev, isLoading: false, error: null }));
  }, [failAuth]);

  const updatePassword = useCallback(async (password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await runAuthRequest(
      () => getClient().auth.updateUser({ password }),
    ).catch(error => failAuth(error));

    if (error) {
      failAuth(error);
    }

    const { data } = await runAuthRequest(
      () => getClient().auth.getSession(),
    ).catch(error => failAuth(error));
    const trustedUser = await fetchTrustedAuthUser(data.session?.access_token, data.session?.user).catch(error => failAuth(error));
    setState({
      user: trustedUser,
      isLoading: false,
      error: null,
    });
  }, [failAuth]);

  const logout = useCallback(async () => {
    clearToken();
    await runAuthRequest(
      () => getClient().auth.signOut(),
      'Unable to reach the authentication service; local session was cleared.',
    ).catch(() => undefined);
    setState({ user: null, isLoading: false, error: null });
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, []);

  return {
    ...state,
    login,
    requestMagicPin,
    verifyMagicPin,
    register,
    requestPasswordReset,
    updatePassword,
    logout,
    isAuthenticated: state.user !== null,
  };
}

// ─── useAuthSession ──────────────────────────────────────────────────────────
//
// Reads the Supabase session from localStorage — typically resolves in < 50ms
// on the first render. Returns a minimal AuthUser (role=VIEWER, no tenant
// profile) sufficient for the dashboard shell to render immediately.
// Role-gated features MUST wait for useAuthProfile().

export interface AuthSessionState {
  sessionUser: AuthUser | null;
  accessToken: string | null;
  isSessionLoading: boolean;
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
      return { sessionUser: DEV_BYPASS_USER, accessToken: null, isSessionLoading: false };
    }
    // Try JAK's own stored user first (already fully hydrated)
    const storedUser = getStoredJakUser();
    if (storedUser) {
      return {
        sessionUser: storedUser,
        accessToken: getRawToken(),
        isSessionLoading: false,
      };
    }
    // Try Supabase localStorage session for near-instant auth detection
    const { user: sbUser, accessToken } = readSessionFromStorage();
    if (sbUser) {
      return {
        sessionUser: mapSupabaseUser(sbUser),
        accessToken,
        isSessionLoading: false,
      };
    }
    return { sessionUser: null, accessToken: null, isSessionLoading: true };
  });

  useEffect(() => {
    if (DEV_BYPASS_ACTIVE) return;

    if (!hasUsableSupabaseConfig()) {
      setState({ sessionUser: null, accessToken: null, isSessionLoading: false });
      return;
    }

    let cancelled = false;

    // getSession() reads from Supabase's in-memory/localStorage cache — fast
    getClient()
      .auth.getSession()
      .then((result) => {
        if (cancelled) return;
        const session = result.data.session;
        setState({
          sessionUser: session?.user ? mapSupabaseUser(session.user) : null,
          accessToken: session?.access_token ?? null,
          isSessionLoading: false,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ sessionUser: null, accessToken: null, isSessionLoading: false });
      });

    const {
      data: { subscription },
    } = getClient().auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setState({
        sessionUser: session?.user ? mapSupabaseUser(session.user) : null,
        accessToken: session?.access_token ?? null,
        isSessionLoading: false,
      });
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
// Fetches the trusted user profile from GET /auth/me. This is the slow call
// (network round-trip to the backend). Consume this only where role/tenant
// data is actually needed; show skeleton states while it resolves.

export interface AuthProfileState {
  user: AuthUser | null;
  isProfileLoading: boolean;
  error: string | null;
}

export function useAuthProfile(accessToken: string | null): AuthProfileState {
  const [state, setState] = useState<AuthProfileState>(() => {
    if (DEV_BYPASS_ACTIVE) return { user: DEV_BYPASS_USER, isProfileLoading: false, error: null };
    const storedUser = getStoredJakUser();
    return {
      user: storedUser,
      isProfileLoading: !storedUser && accessToken !== null,
      error: null,
    };
  });

  useEffect(() => {
    if (DEV_BYPASS_ACTIVE) return;
    if (!accessToken) {
      setState({ user: null, isProfileLoading: false, error: null });
      return;
    }

    let cancelled = false;

    fetchTrustedAuthUser(accessToken)
      .then((user) => {
        if (!cancelled) setState({ user, isProfileLoading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            user: getStoredJakUser(),
            isProfileLoading: false,
            error: getAuthErrorMessage(err),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return state;
}
