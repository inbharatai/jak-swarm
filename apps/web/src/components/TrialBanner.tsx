'use client';

/**
 * TrialBanner — top-of-cockpit ribbon shown when:
 *   1. tenant is in `trialing` status      → "X days left, Y% of cap used"
 *   2. trial has expired                   → "Upgrade to keep going"
 *   3. ANY daily cap >= 80% used           → "Cap will hit soon, resets at UTC 00:00"
 *
 * Hidden on paid plans + when /trial/status returns 401 (unauth — landing).
 */

import React from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Sparkles, AlertTriangle, Clock } from 'lucide-react';
import { dataFetcher } from '@/lib/api-client';

interface TrialStatus {
  ok: true;
  data: {
    allowed: boolean;
    blockedBy?: string;
    counters: {
      agentRuns:    { used: number; cap: number };
      approvals:    { used: number; cap: number };
      toolMinutes:  { used: number; cap: number };
      tokens:       { used: number; cap: number };
    };
    trial: {
      isTrialing: boolean;
      trialEndsAt: string | null;
      daysRemaining: number | null;
      expired: boolean;
    };
    resetsAt: string;
  };
}

function pct(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

export function TrialBanner() {
  const { data } = useSWR<TrialStatus>(
    '/trial/status',
    dataFetcher,
    {
      refreshInterval: 60_000,
      // Silently swallow 401 (e.g. on the landing page where there's no session)
      onError: () => undefined,
      shouldRetryOnError: false,
    },
  );

  if (!data?.data) return null;
  const { trial, counters } = data.data;

  // Paid plan path — banner hidden.
  if (!trial.isTrialing && !trial.expired) return null;

  // Highest cap usage among the four counters.
  const usagePcts = [
    { name: 'agent runs', value: pct(counters.agentRuns.used, counters.agentRuns.cap) },
    { name: 'approvals', value: pct(counters.approvals.used, counters.approvals.cap) },
    { name: 'tool minutes', value: pct(counters.toolMinutes.used, counters.toolMinutes.cap) },
    { name: 'tokens', value: pct(counters.tokens.used, counters.tokens.cap) },
  ];
  const peak = usagePcts.reduce((max, c) => (c.value > max.value ? c : max), usagePcts[0]!);

  if (trial.expired) {
    return (
      <div className="bg-rose-50 border-b border-rose-200 text-rose-900 px-4 py-2 text-sm flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Your 30-day free trial has ended. Workflows are paused until you upgrade.
        </span>
        <Link
          href="/billing"
          className="bg-rose-700 text-white px-3 py-1 rounded text-xs font-medium hover:bg-rose-800"
        >
          Upgrade
        </Link>
      </div>
    );
  }

  const isCapNear = peak.value >= 80;
  const tone = isCapNear
    ? 'bg-amber-50 border-amber-200 text-amber-900'
    : 'bg-blue-50 border-blue-200 text-blue-900';

  return (
    <div className={`${tone} border-b px-4 py-2 text-sm flex items-center justify-between gap-3`}>
      <span className="flex items-center gap-2">
        {isCapNear ? (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        ) : (
          <Sparkles className="h-4 w-4 shrink-0" />
        )}
        <span>
          <strong>Free trial</strong>
          {trial.daysRemaining !== null && ` · ${trial.daysRemaining} day${trial.daysRemaining === 1 ? '' : 's'} left`}
          {' · '}
          Daily {peak.name}: {peak.value}% used
          {isCapNear && (
            <span className="ml-1 text-xs">
              <Clock className="inline h-3 w-3" /> resets UTC midnight
            </span>
          )}
        </span>
      </span>
      <Link href="/billing" className="text-xs font-medium underline whitespace-nowrap">
        Upgrade
      </Link>
    </div>
  );
}
