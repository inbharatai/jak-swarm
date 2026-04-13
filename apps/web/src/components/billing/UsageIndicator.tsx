'use client';

import { useEffect, useState, useCallback } from 'react';
import { usageApi } from '@/lib/api-client';

interface UsageData {
  plan: string;
  credits: { used: number; total: number; remaining: number };
  daily: { used: number; cap: number; remaining: number; resetsAt: string };
}

/**
 * Compact usage indicator for the shell header.
 * Shows credits remaining as a progress bar with plan badge.
 * Refreshes every 60 seconds.
 */
export function UsageIndicator() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await usageApi.getUsage();
      setUsage(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (error || !usage) return null;

  const creditsPct = Math.min(100, Math.round((usage.credits.used / usage.credits.total) * 100));
  const isLow = usage.credits.remaining < usage.credits.total * 0.2;
  const isDailyLow = usage.daily.remaining < usage.daily.cap * 0.2;

  const barColor = isLow ? 'bg-red-500' : creditsPct > 60 ? 'bg-amber-400' : 'bg-emerald-400';
  const planColors: Record<string, string> = {
    free: 'text-slate-400 border-slate-700',
    pro: 'text-emerald-400 border-emerald-700',
    team: 'text-amber-400 border-amber-700',
    enterprise: 'text-purple-400 border-purple-700',
  };

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-xs" title={`${usage.credits.remaining} credits remaining (${usage.daily.remaining} today)`}>
      {/* Plan badge */}
      <span className={`font-mono font-bold uppercase text-[10px] px-1.5 py-0.5 rounded border ${planColors[usage.plan] ?? planColors['free']}`}>
        {usage.plan}
      </span>

      {/* Credit bar */}
      <div className="flex flex-col gap-0.5 min-w-[80px]">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 font-mono text-[10px]">
            {usage.credits.remaining.toLocaleString()}
          </span>
          <span className="text-slate-600 font-mono text-[10px]">
            / {usage.credits.total.toLocaleString()}
          </span>
        </div>
        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} rounded-full transition-all duration-500`}
            style={{ width: `${100 - creditsPct}%` }}
          />
        </div>
      </div>

      {/* Low credit warning */}
      {(isLow || isDailyLow) && (
        <span className="text-red-400 text-[10px]" title={isDailyLow ? 'Daily limit almost reached' : 'Monthly credits low'}>
          {'⚠'}
        </span>
      )}
    </div>
  );
}
