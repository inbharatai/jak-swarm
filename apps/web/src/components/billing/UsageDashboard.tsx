'use client';

import { useEffect, useState, useCallback } from 'react';
import { usageApi } from '@/lib/api-client';

interface UsageData {
  plan: string;
  credits: { used: number; total: number; remaining: number };
  premium: { used: number; total: number; remaining: number };
  daily: { used: number; cap: number; remaining: number; resetsAt: string };
  monthly: { resetsAt: string };
  perTaskCap: number;
  maxModelTier: number;
}

interface UsageEntry {
  id: string;
  taskType: string;
  modelUsed: string;
  creditsCost: number;
  status: string;
  createdAt: string;
}

/**
 * Full usage dashboard showing credit balance, limits, and history.
 */
export function UsageDashboard() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [history, setHistory] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [usageData, historyData] = await Promise.all([
        usageApi.getUsage(),
        usageApi.getHistory({ limit: 20 }),
      ]);
      setUsage(usageData);
      setHistory(historyData.entries ?? []);
    } catch {
      // Error handled by showing empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm">Loading usage data...</div>
    );
  }

  if (!usage) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm">No subscription found. Sign up for a plan to get started.</div>
    );
  }

  const creditsPct = Math.round((usage.credits.used / usage.credits.total) * 100);
  const dailyPct = Math.round((usage.daily.used / usage.daily.cap) * 100);
  const premiumPct = usage.premium.total > 0 ? Math.round((usage.premium.used / usage.premium.total) * 100) : 0;

  const tierNames = ['', 'Standard', 'Pro', 'Premium'];

  return (
    <div className="space-y-6">
      {/* Plan info */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-semibold text-white">Usage & Billing</h2>
          <p className="text-sm text-slate-400">
            Plan: <span className="font-semibold text-emerald-400 uppercase">{usage.plan}</span>
            {' '}&middot;{' '}
            Model access: {tierNames[usage.maxModelTier] ?? 'Standard'}
          </p>
        </div>
        <button
          onClick={refresh}
          className="text-xs text-slate-500 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Credit gauges */}
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Monthly credits */}
        <CreditGauge
          label="Monthly Credits"
          used={usage.credits.used}
          total={usage.credits.total}
          pct={creditsPct}
          sublabel={`Resets ${new Date(usage.monthly.resetsAt).toLocaleDateString()}`}
        />

        {/* Daily credits */}
        <CreditGauge
          label="Today's Credits"
          used={usage.daily.used}
          total={usage.daily.cap}
          pct={dailyPct}
          sublabel={`Resets ${formatTimeUntil(usage.daily.resetsAt)}`}
        />

        {/* Premium credits */}
        {usage.premium.total > 0 && (
          <CreditGauge
            label="Premium Models"
            used={usage.premium.used}
            total={usage.premium.total}
            pct={premiumPct}
            sublabel="Tier 3 models (Opus, etc.)"
          />
        )}
      </div>

      {/* Limits */}
      <div className="grid gap-3 sm:grid-cols-3 text-xs">
        <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02]">
          <div className="text-slate-500 mb-1">Per-task limit</div>
          <div className="text-white font-mono">{usage.perTaskCap} credits</div>
        </div>
        <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02]">
          <div className="text-slate-500 mb-1">Model access</div>
          <div className="text-white font-mono">Tier 1{usage.maxModelTier >= 2 ? ' + 2' : ''}{usage.maxModelTier >= 3 ? ' + 3' : ''}</div>
        </div>
        <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02]">
          <div className="text-slate-500 mb-1">Credits remaining</div>
          <div className="text-emerald-400 font-mono font-bold">{usage.credits.remaining.toLocaleString()}</div>
        </div>
      </div>

      {/* Usage history */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Recent Usage</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No usage yet. Run a workflow to see history here.</p>
        ) : (
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-slate-500">
                  <th className="text-left p-2 font-mono">Type</th>
                  <th className="text-left p-2 font-mono">Model</th>
                  <th className="text-right p-2 font-mono">Credits</th>
                  <th className="text-right p-2 font-mono">Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-2 text-slate-300">{entry.taskType}</td>
                    <td className="p-2 text-slate-400 font-mono">{entry.modelUsed.split('-').slice(0, 2).join('-')}</td>
                    <td className="p-2 text-right text-white font-mono">{entry.creditsCost}</td>
                    <td className="p-2 text-right text-slate-500">{formatTimeAgo(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CreditGauge({ label, used, total, pct, sublabel }: { label: string; used: number; total: number; pct: number; sublabel: string }) {
  const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="rounded-xl border border-white/10 p-4 bg-white/[0.02]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-300">{label}</span>
        <span className="text-xs font-mono text-slate-500">{pct}%</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-2">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-white">{used.toLocaleString()} / {total.toLocaleString()}</span>
        <span className="text-slate-500">{sublabel}</span>
      </div>
    </div>
  );
}

function formatTimeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff < 0) return 'now';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `in ${hours}h ${mins}m` : `in ${mins}m`;
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / (1000 * 60));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
