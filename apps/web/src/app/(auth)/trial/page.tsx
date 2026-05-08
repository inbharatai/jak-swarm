'use client';

/**
 * /trial — public 30-day-free-trial signup landing page.
 *
 * Step 1: collect email + (optional) company info → POST /trial/signup
 * Step 2: show "Check your email" + (in dev) the cleartext token for click-through
 * Step 3 (verify/[token]/page.tsx): verify + promote to a real workspace
 *
 * Honesty notes shown to user:
 *   - "Free during beta. We may add paid plans for power features."
 *   - Daily caps spelled out (no surprise throttling)
 *   - "We will email you ONCE to verify"
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, CheckCircle2, Sparkles, ShieldCheck } from 'lucide-react';
import { trialApi } from '@/lib/api-client';

const trialSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  companyName: z.string().min(1, 'Company / team name is required').max(200),
  industry: z.string().optional(),
  teamSize: z.enum(['1', '2-5', '6-20', '21-100', '100+']).optional(),
});

type TrialFormData = z.infer<typeof trialSchema>;

const INDUSTRY_OPTIONS = [
  { value: '', label: '— Choose one —' },
  { value: 'TECHNOLOGY', label: 'Technology' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'HEALTHCARE', label: 'Healthcare' },
  { value: 'LEGAL', label: 'Legal' },
  { value: 'RETAIL', label: 'Retail' },
  { value: 'LOGISTICS', label: 'Logistics' },
  { value: 'MANUFACTURING', label: 'Manufacturing' },
  { value: 'REAL_ESTATE', label: 'Real Estate' },
  { value: 'EDUCATION', label: 'Education' },
  { value: 'HOSPITALITY', label: 'Hospitality' },
];

const TEAM_SIZE_OPTIONS: { value: TrialFormData['teamSize']; label: string }[] = [
  { value: '1', label: 'Just me' },
  { value: '2-5', label: '2–5 people' },
  { value: '6-20', label: '6–20 people' },
  { value: '21-100', label: '21–100 people' },
  { value: '100+', label: '100+ people' },
];

interface SignupResponse {
  ok: true;
  data: { message: string; devToken?: string };
}

export default function TrialSignupPage() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [devToken, setDevToken] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TrialFormData>({
    resolver: zodResolver(trialSchema),
  });

  async function onSubmit(values: TrialFormData) {
    setServerError(null);
    try {
      const resp = (await trialApi.signup({
        email: values.email,
        companyName: values.companyName,
        industry: values.industry || undefined,
        teamSize: values.teamSize,
        source: 'landing',
      })) as SignupResponse;
      setSubmittedEmail(values.email);
      setSubmitted(true);
      if (resp.data?.devToken) setDevToken(resp.data.devToken);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Signup failed. Please try again.');
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b] text-slate-100 px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-semibold">Check your email</h1>
          <p className="text-slate-400">
            We sent a verification link to{' '}
            <strong className="text-slate-100">{submittedEmail}</strong>. Click it to
            create your workspace and start your 30-day free trial.
          </p>

          {devToken && (
            <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-4 text-left">
              <p className="text-xs uppercase tracking-wider text-amber-300 mb-2">
                Dev mode — token shown locally
              </p>
              <Link
                href={`/trial/verify/${devToken}`}
                className="text-sm text-emerald-400 underline break-all"
              >
                /trial/verify/{devToken.slice(0, 12)}…
              </Link>
              <p className="text-xs text-slate-500 mt-2">
                In production, this token is only delivered via the verification
                email — never shown in the response body.
              </p>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Link expires in 24 hours.
          </p>
          <div>
            <Link href="/" className="text-sm text-slate-400 hover:text-white">
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-slate-100 px-4 py-12">
      <div className="max-w-md mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-8"
        >
          ← Back
        </Link>

        <header className="mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-rose-400/40 bg-rose-400/[0.08] text-rose-200 text-[11px] font-semibold tracking-[0.16em] uppercase mb-4">
            <ShieldCheck className="h-3 w-3" />
            Powered by JAK Shield
          </div>
          <h1 className="text-3xl font-semibold mb-2">
            Start your 30-day free trial
          </h1>
          <p className="text-sm text-slate-400">
            No credit card. No surprise charges. Daily usage caps protect your budget.
          </p>
        </header>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Work email <span className="text-rose-400">*</span>
            </label>
            <input
              type="email"
              autoComplete="email"
              {...register('email')}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 outline-none text-slate-100 placeholder-slate-500"
              placeholder="you@company.com"
            />
            {errors.email && (
              <p className="text-xs text-rose-400 mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Company / team name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              {...register('companyName')}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 outline-none text-slate-100 placeholder-slate-500"
              placeholder="Acme Inc."
            />
            {errors.companyName && (
              <p className="text-xs text-rose-400 mt-1">{errors.companyName.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Industry <span className="text-slate-500">(optional)</span>
            </label>
            <select
              {...register('industry')}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 outline-none text-slate-100"
              defaultValue=""
            >
              {INDUSTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-[#09090b]">
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Team size <span className="text-slate-500">(optional)</span>
            </label>
            <select
              {...register('teamSize')}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 outline-none text-slate-100"
              defaultValue=""
            >
              <option value="" className="bg-[#09090b]">— Select —</option>
              {TEAM_SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-[#09090b]">
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {serverError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-300">
              {serverError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-base font-semibold text-[#09090b] disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #34d399, #fbbf24)',
            }}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Start free trial
              </>
            )}
          </button>

          <p className="text-xs text-slate-500 text-center">
            By signing up you agree to our beta terms (no warranty, free during beta).
          </p>
        </form>

        {/* Honesty: spell out the daily caps so there are no surprises. */}
        <div className="mt-10 border-t border-white/5 pt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Daily caps during trial
          </h2>
          <ul className="text-sm text-slate-400 space-y-1 font-mono tabular-nums">
            <li className="flex justify-between border-b border-white/5 py-1.5">
              <span>Agent runs</span> <span className="text-slate-200">20 / day</span>
            </li>
            <li className="flex justify-between border-b border-white/5 py-1.5">
              <span>External-action approvals</span>
              <span className="text-slate-200">5 / day</span>
            </li>
            <li className="flex justify-between border-b border-white/5 py-1.5">
              <span>Tool execution time</span>
              <span className="text-slate-200">120 min / day</span>
            </li>
            <li className="flex justify-between py-1.5">
              <span>LLM tokens</span>
              <span className="text-slate-200">200,000 / day</span>
            </li>
          </ul>
          <p className="text-xs text-slate-500 mt-3">
            Caps reset at UTC midnight. When a cap hits, your workflows pause —
            never silently fail. Resumes automatically when reset.
          </p>
        </div>
      </div>
    </div>
  );
}
