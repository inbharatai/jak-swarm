'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthSession } from '@/lib/auth';
import { Spinner } from '@/components/ui/spinner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // useAuthSession resolves in < 50ms (reads Supabase localStorage cache).
  // The shell renders immediately instead of waiting for the /auth/me round-trip.
  // Role-gated child pages use useAuthProfile() and show their own skeletons.
  const { sessionUser, isSessionLoading } = useAuthSession();
  const router = useRouter();

  useEffect(() => {
    if (!isSessionLoading && !sessionUser) {
      router.replace('/login');
    }
  }, [sessionUser, isSessionLoading, router]);

  if (isSessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!sessionUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return <>{children}</>;
}
