'use client';

import React, { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui';

function CallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const connected = searchParams.get('connected');
  const error = searchParams.get('error');

  const isSuccess = !!connected && !error;
  const message = isSuccess
    ? `${connected} connected successfully!`
    : error ?? 'Something went wrong.';

  useEffect(() => {
    // QA fix: only auto-redirect on SUCCESS. On error, hold the user on
    // the page so they can read the failure + click the support CTA.
    // Previously both states redirected after 2s, flashing error text too
    // briefly to act on.
    if (!isSuccess) return;
    const timer = setTimeout(() => {
      router.push('/integrations');
    }, 2000);
    return () => clearTimeout(timer);
  }, [router, isSuccess]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="max-w-sm w-full">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          {isSuccess ? (
            <CheckCircle2 className="h-12 w-12 text-green-500" />
          ) : (
            <XCircle className="h-12 w-12 text-red-500" />
          )}
          <p className="text-lg font-semibold">{message}</p>
          {isSuccess ? (
            <p className="text-sm text-muted-foreground">
              Redirecting to integrations...
            </p>
          ) : (
            <div className="flex flex-col items-center gap-3 w-full">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Common causes: the connection window timed out, the provider
                denied consent, or the OAuth app isn&apos;t configured on this
                deployment.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2 w-full">
                <Link
                  href="/integrations"
                  className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors flex-1"
                >
                  Try again
                </Link>
                <a
                  href="mailto:contact@inbharat.ai?subject=Integration%20connect%20failed"
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors flex-1"
                >
                  Contact support
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
