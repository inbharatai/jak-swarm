'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { AppLayout } from './AppLayout';
import { useAuth } from '@/lib/auth';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const AUTH_PATHS = ['/login', '/register', '/', '/forgot-password', '/reset-password', '/onboarding', '/privacy', '/terms'];

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { user } = useAuth();
  const pathname = usePathname();

  const isAuthPage = AUTH_PATHS.some(
    p => pathname === p,
  ) || pathname.startsWith('/auth/');

  // Auth/landing pages and unauthenticated users render without shell
  if (isAuthPage || !user) {
    return <>{children}</>;
  }

  // All authenticated routes use the chat-first AppLayout
  return (
    <ErrorBoundary>
      <AppLayout>{children}</AppLayout>
    </ErrorBoundary>
  );
}
