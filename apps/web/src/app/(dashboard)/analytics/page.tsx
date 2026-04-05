'use client';

import React, { useState } from 'react';
import { BarChart3, DollarSign, Zap, Activity, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Spinner, EmptyState } from '@/components/ui';
import useSWR from 'swr';
import { fetcher } from '@/lib/api-client';

// ─── Types (mirrors @jak-swarm/shared analytics types) ───────────────────────

interface UsageTimeSeries {
  period: string;
  tokens: number;
  costUsd: number;
  workflowCount: number;
}

interface TenantUsageSummary {
  tenantId: string;
  period: { from: string; to: string };
  totals: { tokens: number; costUsd: number; workflows: number };
  timeSeries: UsageTimeSeries[];
  topWorkflows: Array<{ id: string; goal: string; costUsd: number; tokens: number }>;
  costByProvider: Record<string, number>;
  costByAgent: Record<string, number>;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// ─── Period selector ─────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d';

const PERIOD_LABELS: Record<Period, string> = {
  '7d': '7 Days',
  '30d': '30 Days',
  '90d': '90 Days',
};

function getPeriodDates(period: Period): { from: string; to: string } {
  const now = new Date();
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const from = new Date(now.getTime() - days * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

// ─── Bar components ──────────────────────────────────────────────────────────

function HorizontalBar({ label, value, maxValue, color }: {
  label: string;
  value: number;
  maxValue: number;
  color: string;
}) {
  const pct = maxValue > 0 ? Math.max(1, (value / maxValue) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium truncate mr-2">{label}</span>
        <span className="text-muted-foreground shrink-0">{formatCost(value)}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TokenBarChart({ data }: { data: UsageTimeSeries[] }) {
  if (data.length === 0) return null;
  const maxTokens = Math.max(...data.map((d) => d.tokens), 1);

  return (
    <div className="flex items-end gap-1 h-40">
      {data.map((d) => {
        const pct = (d.tokens / maxTokens) * 100;
        return (
          <div
            key={d.period}
            className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
            title={`${d.period}: ${formatTokens(d.tokens)} tokens, ${formatCost(d.costUsd)}`}
          >
            <div
              className="w-full rounded-t bg-primary/80 hover:bg-primary transition-colors min-h-[2px]"
              style={{ height: `${Math.max(2, pct)}%` }}
            />
            <span className="text-[9px] text-muted-foreground truncate w-full text-center">
              {d.period.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ProviderStackedBar({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return <p className="text-xs text-muted-foreground">No data</p>;

  const colors = [
    'bg-primary', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
    'bg-rose-500', 'bg-violet-500', 'bg-cyan-500', 'bg-orange-500',
  ];

  return (
    <div className="space-y-2">
      <div className="flex h-4 w-full overflow-hidden rounded-full">
        {entries.map(([name, value], i) => {
          const pct = (value / total) * 100;
          return (
            <div
              key={name}
              className={`${colors[i % colors.length]} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${name}: ${formatCost(value)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        {entries.map(([name, value], i) => (
          <div key={name} className="flex items-center gap-1.5 text-xs">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${colors[i % colors.length]}`} />
            <span className="text-muted-foreground">{name}</span>
            <span className="font-medium">{formatCost(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('30d');
  const { from, to } = getPeriodDates(period);

  const { data: response, isLoading } = useSWR<ApiResponse<TenantUsageSummary>>(
    `/analytics/usage?from=${from}&to=${to}`,
    fetcher,
    { refreshInterval: 60_000 },
  );

  const summary = response?.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Analytics
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Usage, cost, and performance insights
          </p>
        </div>

        {/* Period selector */}
        <div className="flex rounded-lg border overflow-hidden">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : !summary ? (
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="No analytics data"
          description="Analytics data will appear here once workflows start running."
        />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Zap className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{formatTokens(summary.totals.tokens)}</p>
                    <p className="text-xs text-muted-foreground">Total Tokens</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                    <DollarSign className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{formatCost(summary.totals.costUsd)}</p>
                    <p className="text-xs text-muted-foreground">Total Cost</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <Activity className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{summary.totals.workflows}</p>
                    <p className="text-xs text-muted-foreground">Workflows Run</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                    <TrendingUp className="h-5 w-5 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {summary.totals.workflows > 0
                        ? formatCost(summary.totals.costUsd / summary.totals.workflows)
                        : '$0'}
                    </p>
                    <p className="text-xs text-muted-foreground">Avg Cost / Workflow</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Token usage chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Token Usage Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              {summary.timeSeries.length > 0 ? (
                <TokenBarChart data={summary.timeSeries} />
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">No time series data for this period</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Cost by provider */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Cost by Provider</CardTitle>
              </CardHeader>
              <CardContent>
                <ProviderStackedBar data={summary.costByProvider} />
              </CardContent>
            </Card>

            {/* Cost by agent role */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Cost by Agent Role</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.keys(summary.costByAgent).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No data</p>
                ) : (
                  (() => {
                    const entries = Object.entries(summary.costByAgent).sort(([, a], [, b]) => b - a);
                    const maxVal = entries[0]?.[1] ?? 0;
                    const barColors = [
                      'bg-primary', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
                      'bg-rose-500', 'bg-violet-500', 'bg-cyan-500', 'bg-orange-500',
                    ];
                    return entries.map(([role, cost], i) => (
                      <HorizontalBar
                        key={role}
                        label={role}
                        value={cost}
                        maxValue={maxVal}
                        color={barColors[i % barColors.length]}
                      />
                    ));
                  })()
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top 5 most expensive workflows */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top Workflows by Cost</CardTitle>
            </CardHeader>
            <CardContent>
              {summary.topWorkflows.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No workflow data</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">#</th>
                        <th className="pb-2 pr-4 font-medium">Workflow</th>
                        <th className="pb-2 pr-4 font-medium text-right">Tokens</th>
                        <th className="pb-2 font-medium text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {summary.topWorkflows.slice(0, 5).map((wf, i) => (
                        <tr key={wf.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 pr-4 text-muted-foreground">{i + 1}</td>
                          <td className="py-2.5 pr-4">
                            <div className="max-w-sm">
                              <p className="truncate font-medium text-xs">{wf.goal}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{wf.id.slice(0, 16)}...</p>
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">
                            <Badge variant="secondary" className="text-[10px]">
                              {formatTokens(wf.tokens)}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-right tabular-nums font-medium">
                            {formatCost(wf.costUsd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
