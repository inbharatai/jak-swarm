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

// ─── Token helpers (backward compat) ─────────────────────────────────────────

export function setToken(_token: string): void {
  // No-op: Supabase manages tokens via cookies automatically
}

export function clearToken(): void {
  // No-op: Supabase manages tokens via cookies automatically
}

export function getRawToken(): string | null {
  // For backward compat with api-client.ts
  if (typeof window === 'undefined') return null;
  // Supabase stores the session — we can get the access token from it
  return null; // Will be handled asynchronously
}

// ─── Session check ───────────────────────────────────────────────────────────

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  if (DEV_BYPASS_ACTIVE) return true;
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

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    // In dev-bypass mode, start with the synthetic user already populated
    // so the dashboard layout's "redirect when no user" check is satisfied
    // on the very first render. Skips the loading spinner entirely.
    user: DEV_BYPASS_ACTIVE ? DEV_BYPASS_USER : null,
    isLoading: !DEV_BYPASS_ACTIVE,
    error: null,
  });

  useEffect(() => {
    // DEV-ONLY: in bypass mode the synthetic user is already in state;
    // skip every Supabase round-trip to keep the cockpit responsive
    // and avoid pinging Supabase with a non-existent session.
    if (DEV_BYPASS_ACTIVE) return;

    // Get initial session
    getClient().auth.getUser().then((result) => {
      const user = result.data?.user;
      setState({
        user: user ? mapSupabaseUser(user) : null,
        isLoading: false,
        error: null,
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

  const login = useCallback(async (email: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
      throw new Error(error.message);
    }
  }, []);

  const requestMagicPin = useCallback(async (email: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await getClient().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: buildAbsoluteUrl('/auth/confirm?next=/workspace'),
      },
    });
    if (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
      throw new Error(error.message);
    }

    setState(prev => ({ ...prev, isLoading: false, error: null }));
  }, []);

  const verifyMagicPin = useCallback(async (email: string, token: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await getClient().auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
      throw new Error(error.message);
    }
  }, []);

  const register = useCallback(
    async (data: {
      email: string;
      password: string;
      name: string;
      tenantName: string;
      industry: string;
    }) => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      const { error } = await getClient().auth.signUp({
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
      });
      if (error) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: error.message,
        }));
        throw new Error(error.message);
      }
    },
    [],
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await getClient().auth.resetPasswordForEmail(email, {
      redirectTo: buildAbsoluteUrl('/auth/confirm?next=/reset-password'),
    });

    if (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
      throw new Error(error.message);
    }

    setState(prev => ({ ...prev, isLoading: false, error: null }));
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await getClient().auth.updateUser({ password });

    if (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
      throw new Error(error.message);
    }

    const { data } = await getClient().auth.getUser();
    setState({
      user: data.user ? mapSupabaseUser(data.user) : null,
      isLoading: false,
      error: null,
    });
  }, []);

  const logout = useCallback(async () => {
    await getClient().auth.signOut();
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
