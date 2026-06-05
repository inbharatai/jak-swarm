'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthSession } from '@/lib/auth-session';
import { Spinner } from '@/components/ui/spinner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // useAuthSession resolves in < 50ms (reads Supabase localStorage cache).
  // The shell renders immediately instead of waiting for the /auth/me round-trip.
  // Role-gated child pages use useAuthProfile() and show their own skeletons.
  const { user, isLoading } = useAuthSession();
  const router = useRouter();

  // Hydration fix: during SSR, isLoading is true and user is null,
  // so SSR renders <Spinner/>. On the client, isLoading resolves to
  // false with a real user, so the client renders <>{children}</>.
  // This structural mismatch causes React error #418. By deferring
  // the auth check until after mount, the first render always matches
  // the SSR output (spinner), then switches on the next tick.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mounted && !isLoading && !user) {
      router.replace('/login');
    }
  }, [mounted, user, isLoading, router]);

  // Before hydration completes, show a neutral spinner that matches SSR
  if (!mounted || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return <>{children}</>;
}