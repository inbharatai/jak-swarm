'use client';

import React, { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
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
    const timer = setTimeout(() => {
      router.push('/integrations');
    }, 2000);
    return () => clearTimeout(timer);
  }, [router]);

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
          <p className="text-sm text-muted-foreground">
            Redirecting to integrations...
          </p>
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
