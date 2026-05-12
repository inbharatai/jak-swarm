'use client';

/**
 * /trial/verify/[token] — landing page for the email-verification link.
 *
 * Calls POST /trial/verify/:token which (atomically) marks the signup
 * VERIFIED + creates a Tenant + first User (TENANT_ADMIN) + a 30-day
 * trialing Subscription. Returns a JWT we drop in localStorage and the
 * one-time initial password the user can record.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { CheckCircle2, Loader2, AlertTriangle, Copy } from 'lucide-react';
import { trialApi } from '@/lib/api-client';
import { setToken } from '@/lib/auth';
import type { AuthUser } from '@/types';

interface PromoteResponse {
  ok: true;
  data: {
    token: string;
    initialPassword: string;
    tenant: { id: string; slug: string; name: string };
    user: { id: string; email: string; name: string; role: string };
    reusedExistingTenant: boolean;
    message: string;
  };
}

export default function TrialVerifyPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [state, setState] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PromoteResponse['data'] | null>(null);
  const [copiedPassword, setCopiedPassword] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = (await trialApi.verify(token)) as PromoteResponse;
        if (cancelled) return;

        // Store the same JWT shape used by the dashboard/API client.
        if (typeof window !== 'undefined' && resp.data.token) {
          setToken(resp.data.token, {
            id: resp.data.user.id,
            email: resp.data.user.email,
            name: resp.data.user.name,
            role: resp.data.user.role as AuthUser['role'],
            tenantId: resp.data.tenant.id,
            tenantName: resp.data.tenant.name,
            industry: 'TECHNOLOGY',
          });
        }

        setResult(resp.data);
        setState('success');
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Verification failed.';
        setError(msg);
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function copyPassword() {
    if (!result) return;
    navigator.clipboard.writeText(result.initialPassword).then(
      () => {
        setCopiedPassword(true);
        setTimeout(() => setCopiedPassword(false), 2000);
      },
      () => undefined,
    );
  }

  if (state === 'verifying') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b] text-slate-100 px-4">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-emerald-400" />
          <p className="text-sm text-slate-400">Verifying your email and creating your workspace…</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b] text-slate-100 px-4">
        <div className="max-w-md text-center space-y-4">
          <AlertTriangle className="h-10 w-10 text-rose-400 mx-auto" />
          <h1 className="text-xl font-semibold">Verification failed</h1>
          <p className="text-sm text-slate-400">{error}</p>
          <Link
            href="/trial"
            className="inline-block px-4 py-2 rounded bg-white/5 border border-white/10 text-sm text-slate-200 hover:bg-white/10"
          >
            Sign up again
          </Link>
        </div>
      </div>
    );
  }

  // Success
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b] text-slate-100 px-4 py-12">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-semibold">
            {result?.reusedExistingTenant ? 'Welcome back' : 'Workspace ready'}
          </h1>
          <p className="text-slate-400 text-sm">{result?.message}</p>
        </div>

        {result && !result.reusedExistingTenant && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
            <div className="text-xs uppercase tracking-wider text-amber-300 font-semibold">
              Your one-time initial password — save it now
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 rounded bg-black/40 border border-amber-500/20 text-amber-200 font-mono text-sm break-all">
                {result.initialPassword}
              </code>
              <button
                type="button"
                onClick={copyPassword}
                className="px-3 py-2 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-xs text-amber-100"
              >
                <Copy className="inline h-3 w-3 mr-1" />
                {copiedPassword ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-slate-500">
              You're signed in via the verification link — but if you ever sign out, this is the
              password you'll need to log back in. We won't show it again. You can change it from
              Settings later.
            </p>
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Workspace</span>
              <span className="text-slate-200 font-mono">{result.tenant.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Email</span>
              <span className="text-slate-200">{result.user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Role</span>
              <span className="text-slate-200 font-mono">{result.user.role}</span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => router.push('/workspace')}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-base font-semibold text-[#09090b]"
          style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24)' }}
        >
          Open my workspace
        </button>

        <p className="text-xs text-slate-500 text-center">
          Trial active for 30 days. Caps reset at UTC midnight.
        </p>
      </div>
    </div>
  );
}
