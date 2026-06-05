'use client';

import type { AuthUser } from '@/types';
import {
  useAuthSession as useCoreAuthSession,
  type AuthSessionState,
} from './auth';

export interface SessionSnapshot {
  accessToken: string | null;
}

export interface UseAuthSessionReturn {
  user: AuthUser | null;
  session: SessionSnapshot;
  isLoading: boolean;
  // Backward-compatible aliases for existing consumers.
  sessionUser: AuthUser | null;
  accessToken: string | null;
  isSessionLoading: boolean;
}

export function useAuthSession(): UseAuthSessionReturn {
  const state: AuthSessionState = useCoreAuthSession();
  return {
    user: state.user,
    session: state.session,
    isLoading: state.isLoading,
    sessionUser: state.sessionUser,
    accessToken: state.accessToken,
    isSessionLoading: state.isSessionLoading,
  };
}
