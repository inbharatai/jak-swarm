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
  // This is a sync check — for actual auth state, use the useAuth hook
  return false;
}

// ─── useAuth hook (Supabase-powered) ────────────────────────────────────────

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
}

interface UseAuthReturn extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    name: string;
    tenantName: string;
    industry: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
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
    register,
    logout,
    isAuthenticated: state.user !== null,
  };
}
