'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * A.4 — client island for the landing → workspace redirect.
 *
 * The marketing landing (`/`) is a Server Component (static SSG). The only
 * piece that needs the client is the "send already-authenticated visitors to
 * /workspace" safety net. Supabase session cookies (`sb-*`) are set by the
 * auth flow, so a presence check here is enough — Supabase middleware handles
 * the real session refresh at the edge. Renders nothing.
 */
export default function LandingRedirectClient() {
  const router = useRouter();

  useEffect(() => {
    const supabaseCookie = document.cookie.split(';').find((c) => c.trim().startsWith('sb-'));
    if (supabaseCookie) {
      router.replace('/workspace');
    }
  }, [router]);

  return null;
}