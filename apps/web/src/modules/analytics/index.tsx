'use client';

import React, { useState } from 'react';
import { BarChart3, DollarSign, Zap, Activity, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui';
import useSWR from 'swr';
import { fetcher } from '@/lib/api-client';
import type { ModuleProps } from '@/modules/registry';

type Period = '7d' | '30d' | '90d';

interface AnalyticsSummary {
  totals: { tokens: number; costUsd: number; workflows: number };
  costByProvider: Record<string, number>;
  costByAgent: Record<string, number>;
}

const PERIOD_LABELS: Record<Period, string> = { '7d': '7 Days', '30d': '30 Days', '90d': '90 Days' };

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function HorizontalBar({ label, value, maxValue, color }: { label: string; value: number; maxValue: number; color: string }) {
  const pct = maxValue > 0 ? Math.max(1, (value / maxValue) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium truncate mr-2">{label}</span>
        <span className="text-muted-foreground shrink-0">{formatCost(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AnalyticsModule({ moduleId, isActive }: ModuleProps) {
  const [period, setPeriod] = useState<Period>('30d');
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  const { data, isLoading } = useSWR<{ data: AnalyticsSummary }>(`/analytics/usage?from=${from}&to=${to}`, fetcher, { refreshInterval: 30000 });
  const summary = data?.data;

  if (isLoading) return <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>;

  return (
    <div className="flex flex-col h-full p-4 gap-6 overflow-auto">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" />Analytics</h2>
          <p className="text-xs text-muted-foreground">Usage metrics and cost tracking</p>
        </div>
        <div className="flex rounded-md border p-0.5 bg-muted/30">
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`rounded px-3 py-1 text-xs font-medium transition-colors ${period === p ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-muted-foreground mb-1"><Zap className="h-4 w-4" /><span className="text-xs">Total Tokens</span></div><p className="text-2xl font-bold">{formatTokens(summary?.totals?.tokens ?? 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-muted-foreground mb-1"><DollarSign className="h-4 w-4" /><span className="text-xs">Total Cost</span></div><p className="text-2xl font-bold">{formatCost(summary?.totals?.costUsd ?? 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-muted-foreground mb-1"><Activity className="h-4 w-4" /><span className="text-xs">Workflows</span></div><p className="text-2xl font-bold">{summary?.totals?.workflows ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-muted-foreground mb-1"><TrendingUp className="h-4 w-4" /><span className="text-xs">Avg Cost/Workflow</span></div><p className="text-2xl font-bold">{summary?.totals?.workflows ? formatCost((summary.totals.costUsd ?? 0) / summary.totals.workflows) : '$0.00'}</p></CardContent></Card>
      </div>

      {/* Cost by provider */}
      {summary?.costByProvider && Object.keys(summary.costByProvider).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Cost by Provider</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(summary.costByProvider).sort(([,a],[,b]) => (b as number) - (a as number)).map(([provider, cost]) => (
              <HorizontalBar key={provider} label={provider} value={cost as number} maxValue={Math.max(...Object.values(summary.costByProvider).map(Number))} color="bg-primary" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Cost by agent */}
      {summary?.costByAgent && Object.keys(summary.costByAgent).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Cost by Agent Role</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(summary.costByAgent).sort(([,a],[,b]) => (b as number) - (a as number)).slice(0, 10).map(([agent, cost]) => (
              <HorizontalBar key={agent} label={agent} value={cost as number} maxValue={Math.max(...Object.values(summary.costByAgent).map(Number))} color="bg-amber-500" />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
