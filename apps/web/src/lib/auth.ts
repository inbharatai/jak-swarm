'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AuthUser } from '@/types';
import { createClient } from './supabase';
import type { User as SupabaseUser, SupabaseClient } from '@supabase/supabase-js';

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
    role: meta['role'] ?? 'END_USER',
    tenantId: meta['tenantId'] ?? '',
    tenantName: meta['tenantName'] ?? '',
    industry: meta['industry'] ?? 'TECHNOLOGY',
    avatarUrl: meta['avatar_url'] ?? undefined,
    jobFunction: meta['jobFunction'] ?? undefined,
  };
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
    role: String(raw['role'] ?? 'TENANT_ADMIN') as AuthUser['role'],
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
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim();
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

    // Get initial session
    runAuthRequest(() => getClient().auth.getUser())
      .then((result) => {
        const user = result.data?.user;
        setState({
          user: user ? mapSupabaseUser(user) : null,
          isLoading: false,
          error: null,
        });
      })
      .catch((error) => {
        setState({
          user: null,
          isLoading: false,
          error: getAuthErrorMessage(error),
        });
      });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = getClient().auth.onAuthStateChange((_event, session) => {
      setState({
        user: session?.user ? mapSupabaseUser(session.user) : null,
        isLoading: false,
        error: null,
      });
    });

    return () => subscription.unsubscribe();
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
    const { data, error } = await runAuthRequest(
      () => getClient().auth.signInWithPassword({ email, password }),
    ).catch(error => failAuth(error));
    if (error) {
      failAuth(error);
    }
    if (data.user) {
      setState({
        user: mapSupabaseUser(data.user),
        isLoading: false,
        error: null,
      });
    }
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
    setState({
      user: data.user ? mapSupabaseUser(data.user) : null,
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
              role: 'ADMIN',
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
      () => getClient().auth.getUser(),
    ).catch(error => failAuth(error));
    setState({
      user: data.user ? mapSupabaseUser(data.user) : null,
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
