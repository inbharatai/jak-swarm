'use client';

import React, { useEffect } from 'react';
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

  // Service-worker registration. Co-located here (already a client
  // component) instead of a raw `<script>` in layout.tsx — Next.js 16
  // emits a console error for any `<script>` element in render output,
  // and `useEffect` is the supported pattern.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[sw] registration failed (non-fatal):', err);
      });
    };
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
    return undefined;
  }, []);

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
