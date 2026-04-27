'use client';

/**
 * External Auditor — engagement dashboard (Sprint 2.6).
 *
 * Lists every audit run the signed-in auditor has an active engagement
 * for. Reads the auditor JWT from localStorage and uses it for the
 * /auditor/runs request via a fetch override (the standard api-client
 * uses the main user JWT).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const STORAGE_KEY = 'jak_auditor_token';

interface Engagement {
  id: string;
  auditRunId: string;
  scopes: string[];
  expiresAt: string;
  accessGrantedAt: string;
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || 'http://localhost:4000';

async function auditorFetch<T>(path: string): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (!token) throw new Error('Not signed in as auditor — accept your invite link first.');
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data as T;
}

export default function AuditorEngagementsPage() {
  const router = useRouter();
  const [engagements, setEngagements] = useState<Engagement[] | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    auditorFetch<{ engagements: Engagement[] }>('/auditor/runs')
      .then((res) => setEngagements(res.engagements))
      .catch((err: Error) => setError(err.message));
  }, []);

  const signOut = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('jak_auditor_engagement');
    } catch { /* noop */ }
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">External Auditor Portal — Your Engagements</h1>
        <button onClick={signOut} className="text-sm text-zinc-400 hover:text-zinc-100">
          Sign out
        </button>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {engagements === null && !error && (
          <p className="text-zinc-500 text-sm">Loading your engagements&hellip;</p>
        )}
        {engagements && engagements.length === 0 && (
          <div className="rounded-md border border-zinc-800 bg-zinc-900 px-6 py-12 text-center">
            <p className="text-zinc-300 mb-2">No active engagements.</p>
            <p className="text-sm text-zinc-500">
              You don&apos;t have any audit runs assigned to you. Ask the tenant
              administrator who invited you for a fresh invite link.
            </p>
          </div>
        )}
        {engagements && engagements.length > 0 && (
          <ul className="space-y-3">
            {engagements.map((e) => (
              <li key={e.id} className="rounded-md border border-zinc-800 bg-zinc-900 hover:border-zinc-700 transition-colors">
                <Link
                  href={`/auditor/runs/${e.auditRunId}`}
                  className="block px-5 py-4"
                >
                  <p className="font-medium">Audit Run: {e.auditRunId}</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    Scopes: {e.scopes.length > 0 ? e.scopes.join(', ') : '(read-only view)'}
                    {' '}&middot;{' '}
                    Expires {new Date(e.expiresAt).toLocaleDateString()}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-8 text-xs text-zinc-600">
          Engagements are scoped per audit run. You only see the runs you were
          explicitly invited to. All your actions (views, comments, decisions)
          are recorded in the immutable audit trail.
        </p>
      </main>
    </div>
  );
}
