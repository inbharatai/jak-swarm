'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui/spinner';

const AUTH_PATHS = ['/login', '/register', '/'];

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();

  const isAuthPage = AUTH_PATHS.some(
    p => pathname === p || pathname.startsWith('/(auth)'),
  ) || pathname === '/login' || pathname === '/register';

  // Landing / auth pages render without shell
  if (isAuthPage || !user) {
    if (isLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <Spinner size="lg" />
        </div>
      );
    }
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
