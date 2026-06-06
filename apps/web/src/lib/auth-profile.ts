'use client';

import type { AuthUser } from '@/types';
import {
  useAuthProfile as useCoreAuthProfile,
  type AuthProfileState,
} from './auth';

export interface UseAuthProfileReturn {
  profile: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  // Backward-compatible aliases for existing consumers.
  user: AuthUser | null;
  isProfileLoading: boolean;
}

export function useAuthProfile(): UseAuthProfileReturn {
  const state: AuthProfileState = useCoreAuthProfile();
  return {
    profile: state.profile,
    isLoading: state.isLoading,
    error: state.error,
    user: state.user,
    isProfileLoading: state.isProfileLoading,
  };
}
