'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, Loader2, Mail, Zap } from 'lucide-react';
import { useAuth } from '@/lib/auth';

const emailSchema = z.object({
  email: z.string().email('Please enter a valid email'),
});

const tokenSchema = z.object({
  token: z.string().min(6, 'Enter the 6-digit code from your email').max(6, 'Enter the 6-digit code from your email'),
});

type EmailFormData = z.infer<typeof emailSchema>;
type TokenFormData = z.infer<typeof tokenSchema>;

export default function MagicLoginPage() {
  const router = useRouter();
  const { requestMagicPin, verifyMagicPin } = useAuth();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [serverError, setServerError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const emailForm = useForm<EmailFormData>({
    resolver: zodResolver(emailSchema),
  });

  const tokenForm = useForm<TokenFormData>({
    resolver: zodResolver(tokenSchema),
  });

  const submitEmail = async (data: EmailFormData) => {
    setServerError(null);
    setMessage(null);
    try {
      await requestMagicPin(data.email);
      setEmail(data.email);
      setStep('verify');
      setMessage('Check your email for a magic link or 6-digit PIN.');
    } catch (error: unknown) {
      setServerError((error as { message?: string })?.message ?? 'Unable to send sign-in email.');
    }
  };

  const submitToken = async (data: TokenFormData) => {
    setServerError(null);
    try {
      await verifyMagicPin(email, data.token);
      router.push('/workspace');
      router.refresh();
    } catch (error: unknown) {
      setServerError((error as { message?: string })?.message ?? 'Unable to verify code.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-primary/5 to-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">JAK Swarm</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold">Sign in with magic PIN</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Request a one-time code or magic link from Supabase email auth.
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          {step === 'request' ? (
            <form onSubmit={emailForm.handleSubmit(submitEmail)} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    {...emailForm.register('email')}
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="flex h-10 w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                  />
                </div>
                {emailForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{emailForm.formState.errors.email.message}</p>
                )}
              </div>

              {serverError && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {serverError}
                </div>
              )}

              <button
                type="submit"
                disabled={emailForm.formState.isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              >
                {emailForm.formState.isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send magic PIN'
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={tokenForm.handleSubmit(submitToken)} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="token" className="text-sm font-medium">
                  One-time PIN
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    {...tokenForm.register('token')}
                    id="token"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className="flex h-10 w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm tracking-[0.3em] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                  />
                </div>
                {tokenForm.formState.errors.token && (
                  <p className="text-xs text-destructive">{tokenForm.formState.errors.token.message}</p>
                )}
              </div>

              {message && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                  {message}
                </div>
              )}

              {serverError && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {serverError}
                </div>
              )}

              <button
                type="submit"
                disabled={tokenForm.formState.isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              >
                {tokenForm.formState.isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify PIN'
                )}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Prefer a password?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}