'use client';

import { decodeJwt } from 'jose';
import { useState, useEffect, useCallback } from 'react';
import type { AuthSession, AuthUser } from '@/types';
import { authApi } from './api-client';

const TOKEN_KEY = 'jak_token';

// ─── Token helpers ────────────────────────────────────────────────────────────

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

export function getRawToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

// ─── Session decode ───────────────────────────────────────────────────────────

export function getSession(): AuthSession | null {
  const token = getRawToken();
  if (!token) return null;

  try {
    const payload = decodeJwt(token);

    const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    if (expiresAt && Date.now() > expiresAt) {
      clearToken();
      return null;
    }

    const user: AuthUser = {
      id: payload.sub ?? (payload['id'] as string) ?? '',
      email: (payload['email'] as string) ?? '',
      name: (payload['name'] as string) ?? '',
      role: (payload['role'] as AuthUser['role']) ?? 'VIEWER',
      tenantId: (payload['tenantId'] as string) ?? '',
      tenantName: (payload['tenantName'] as string) ?? '',
      industry: (payload['industry'] as AuthUser['industry']) ?? 'TECHNOLOGY',
      avatarUrl: (payload['avatarUrl'] as string) ?? undefined,
      jobFunction: (payload['jobFunction'] as AuthUser['jobFunction']) ?? undefined,
    };

    return { user, token, expiresAt };
  } catch {
    clearToken();
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

// ─── useAuth hook ─────────────────────────────────────────────────────────────

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
}

interface UseAuthReturn extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const session = getSession();
    setState({
      user: session?.user ?? null,
      isLoading: false,
      error: null,
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await authApi.login(email, password) as { token: string; user: AuthUser };
      setToken(response.token);
      setState({
        user: response.user,
        isLoading: false,
        error: null,
      });
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message ?? 'Login failed';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setState({ user: null, isLoading: false, error: null });
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, []);

  return {
    ...state,
    login,
    logout,
    isAuthenticated: state.user !== null,
  };
}
