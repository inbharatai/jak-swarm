'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// A.6 — recharts is isolated in this client component so the parent analytics
// module (KPI cards + period selector) can render without paying the recharts
// chunk cost up front. The parent loads this via next/dynamic({ ssr:false }),
// so recharts + its SVG renderer land in a separate chunk that hydrates after
// the cards paint.

const CHART_COLORS = ['#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#c084fc', '#fb923c', '#ef4444', '#06b6d4'];

interface AnalyticsSummary {
  totals: { tokens: number; costUsd: number; workflows: number };
  costByProvider: Record<string, number>;
  costByAgent: Record<string, number>;
}

export default function AnalyticsCharts({ summary }: { summary: AnalyticsSummary | undefined }) {
  return (
    <>
      {/* Cost by provider — Recharts bar chart */}
      {summary?.costByProvider && Object.keys(summary.costByProvider).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Cost by Provider</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={Object.entries(summary.costByProvider).sort(([, a], [, b]) => (b as number) - (a as number)).map(([name, value]) => ({ name, value: Number(value) }))} layout="vertical" margin={{ left: 60, right: 20, top: 5, bottom: 5 }}>
                <XAxis type="number" tickFormatter={(v: number) => `$${v.toFixed(2)}`} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} width={55} />
                <Tooltip formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Cost']} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {Object.keys(summary.costByProvider).map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Cost by agent — Recharts bar chart */}
      {summary?.costByAgent && Object.keys(summary.costByAgent).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Cost by Agent Role</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(200, Math.min(Object.keys(summary.costByAgent).length, 10) * 32)}>
              <BarChart data={Object.entries(summary.costByAgent).sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 10).map(([name, value]) => ({ name: name.replace('WORKER_', ''), value: Number(value) }))} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
                <XAxis type="number" tickFormatter={(v: number) => `$${v.toFixed(2)}`} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} width={75} />
                <Tooltip formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Cost']} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" fill="#fbbf24" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </>
  );
}