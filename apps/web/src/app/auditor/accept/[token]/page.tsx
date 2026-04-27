'use client';

/**
 * External Auditor — accept invite landing page (Sprint 2.6).
 *
 * Reads the cleartext invite token from the URL, calls
 * POST /auditor/accept/:token, stores the returned JWT in localStorage,
 * and redirects to /auditor/runs.
 *
 * No authentication is required to reach this page — the token IS the
 * authentication. Successful accept returns a scoped JWT.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { externalAuditorApi } from '@/lib/api-client';

const STORAGE_KEY = 'jak_auditor_token';
const ENGAGEMENT_KEY = 'jak_auditor_engagement';

export default function AuditorAcceptPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<'pending' | 'accepting' | 'accepted' | 'error'>('pending');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    const token = params?.token;
    if (!token) {
      setStatus('error');
      setErrorMsg('No invite token in URL.');
      return;
    }
    setStatus('accepting');
    externalAuditorApi
      .acceptInvite(token)
      .then((res) => {
        // Persist auditor JWT separately from the main user JWT so the
        // two flows don't collide if an admin shares a browser with an auditor.
        try {
          localStorage.setItem(STORAGE_KEY, res.token);
          localStorage.setItem(ENGAGEMENT_KEY, JSON.stringify(res.engagement));
        } catch {
          // localStorage may be unavailable in private browsing.
        }
        setStatus('accepted');
        setTimeout(() => router.push('/auditor/runs'), 600);
      })
      .catch((err: Error) => {
        setStatus('error');
        setErrorMsg(err.message ?? 'Could not accept invite.');
      });
  }, [params, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 px-4">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-xl">
        <h1 className="text-2xl font-bold mb-2">External Auditor Portal</h1>
        <p className="text-zinc-400 text-sm mb-6">
          You&apos;re accepting a per-engagement invite to review an audit run on JAK Swarm.
          Your access is scoped to this engagement only — you cannot see other tenant data.
        </p>
        {status === 'pending' && <p className="text-zinc-500">Preparing&hellip;</p>}
        {status === 'accepting' && (
          <p className="text-blue-300">
            <span className="inline-block animate-pulse">●</span> Verifying your invite&hellip;
          </p>
        )}
        {status === 'accepted' && (
          <p className="text-emerald-300">
            ✓ Invite accepted. Redirecting to your engagement dashboard&hellip;
          </p>
        )}
        {status === 'error' && (
          <div>
            <p className="text-red-300 mb-2">✗ Could not accept this invite.</p>
            <p className="text-sm text-zinc-400">{errorMsg}</p>
            <p className="mt-4 text-xs text-zinc-500">
              The link may have expired, been revoked, or already been used. Contact the
              tenant administrator who sent the invite.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
