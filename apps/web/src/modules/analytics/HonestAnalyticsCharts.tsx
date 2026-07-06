'use client';

import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from 'recharts';
import {
  analyticsApi,
  type ToolsReport,
  type ApprovalsDecisionsReport,
  type IntentsReport,
  type LatencyReport,
  type RoutingReport,
} from '@/lib/api-client';

// Phase C honest analytics charts. Each fetches its own aggregation endpoint
// via SWR and renders a recharts chart with an honest "No data" empty state
// when the tenant has no rows. recharts is already isolated in this dynamic
// (ssr:false) chunk because the parent analytics module loads it via
// next/dynamic — see AnalyticsCharts.tsx for the original code-split comment.
//
// No mock graphs: 0 rows → "No data" text, never a faked 100% or sample series.

const CHART_COLORS = ['#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#c084fc', '#fb923c', '#ef4444', '#06b6d4'];

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-[180px] text-xs text-muted-foreground">
      {label}
    </div>
  );
}

const tooltipStyle = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 };

// ─── Tool success + duration ──────────────────────────────────────────────
function ToolsChart() {
  const { data, error } = useSWR<ToolsReport>('analytics/tools', () => analyticsApi.tools());
  const tools = data?.tools ?? [];
  if (error) return <Card><CardHeader><CardTitle className="text-sm">Tool Success &amp; Duration</CardTitle></CardHeader><CardContent><EmptyState label="Failed to load tool analytics" /></CardContent></Card>;
  if (!data) return <Card><CardHeader><CardTitle className="text-sm">Tool Success &amp; Duration</CardTitle></CardHeader><CardContent><EmptyState label="Loading…" /></CardContent></Card>;
  if (tools.length === 0) return <Card><CardHeader><CardTitle className="text-sm">Tool Success &amp; Duration</CardTitle></CardHeader><CardContent><EmptyState label="No tool calls yet" /></CardContent></Card>;
  const rows = tools.slice(0, 10).map((t) => ({
    name: t.toolName.replace(/_/g, ' ').slice(0, 18),
    success: t.successCount,
    fail: t.failCount,
    p95: t.p95DurationMs,
  }));
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Tool Success &amp; Duration (top 10)</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rows} layout="vertical" margin={{ left: 70, right: 20, top: 5, bottom: 5 }}>
            <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} width={65} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            <Bar dataKey="success" stackId="a" fill="#34d399" name="success" radius={[0, 0, 0, 0]} />
            <Bar dataKey="fail" stackId="a" fill="#ef4444" name="fail" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-muted-foreground mt-1">success = no error on the stored call (the persisted ToolCall has no outcome field)</p>
      </CardContent>
    </Card>
  );
}

// ─── Approval decisions (auto vs human + by risk) ─────────────────────────
function ApprovalsChart() {
  const { data, error } = useSWR<ApprovalsDecisionsReport>('analytics/approvals', () => analyticsApi.approvalDecisions());
  if (error) return <Card><CardHeader><CardTitle className="text-sm">Approval Decisions</CardTitle></CardHeader><CardContent><EmptyState label="Failed to load" /></CardContent></Card>;
  if (!data) return <Card><CardHeader><CardTitle className="text-sm">Approval Decisions</CardTitle></CardHeader><CardContent><EmptyState label="Loading…" /></CardContent></Card>;
  if (data.total === 0) return <Card><CardHeader><CardTitle className="text-sm">Approval Decisions</CardTitle></CardHeader><CardContent><EmptyState label="No approvals yet" /></CardContent></Card>;
  const pie = [
    { name: 'Auto-approved', value: data.autoApproved, fill: '#34d399' },
    { name: 'Human-approved', value: data.humanApproved, fill: '#38bdf8' },
    { name: 'Rejected/Deferred', value: Math.max(0, data.total - data.autoApproved - data.humanApproved), fill: '#ef4444' },
  ].filter((d) => d.value > 0);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Approval Decisions ({data.total})</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {pie.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-muted-foreground mt-1">auto-approval rate: {(data.autoApprovalRate * 100).toFixed(1)}%</p>
      </CardContent>
    </Card>
  );
}

// ─── Intents (count + avg confidence) ──────────────────────────────────────
function IntentsChart() {
  const { data, error } = useSWR<IntentsReport>('analytics/intents', () => analyticsApi.intents());
  if (error) return <Card><CardHeader><CardTitle className="text-sm">Intents</CardTitle></CardHeader><CardContent><EmptyState label="Failed to load" /></CardContent></Card>;
  if (!data) return <Card><CardHeader><CardTitle className="text-sm">Intents</CardTitle></CardHeader><CardContent><EmptyState label="Loading…" /></CardContent></Card>;
  if (data.total === 0) return <Card><CardHeader><CardTitle className="text-sm">Intents</CardTitle></CardHeader><CardContent><EmptyState label="No intents classified yet" /></CardContent></Card>;
  const rows = data.intents.slice(0, 10).map((i) => ({ name: i.intent.replace(/_/g, ' ').slice(0, 18), count: i.count, confidence: Math.round(i.avgConfidence * 100) }));
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Intents by count (top 10) — clarification rate {(data.clarificationRate * 100).toFixed(1)}%</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rows} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
            <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} width={75} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" fill="#fbbf24" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─── Latency p50/p90/p95/p99 + by provider ─────────────────────────────────
function LatencyChart() {
  const { data, error } = useSWR<LatencyReport>('analytics/latency', () => analyticsApi.latency());
  if (error) return <Card><CardHeader><CardTitle className="text-sm">Latency</CardTitle></CardHeader><CardContent><EmptyState label="Failed to load" /></CardContent></Card>;
  if (!data) return <Card><CardHeader><CardTitle className="text-sm">Latency</CardTitle></CardHeader><CardContent><EmptyState label="Loading…" /></CardContent></Card>;
  if (data.samples === 0) return <Card><CardHeader><CardTitle className="text-sm">Latency</CardTitle></CardHeader><CardContent><EmptyState label="No latency samples yet" /></CardContent></Card>;
  const overall = [
    { name: 'p50', ms: data.p50Ms },
    { name: 'p90', ms: data.p90Ms },
    { name: 'p95', ms: data.p95Ms },
    { name: 'p99', ms: data.p99Ms },
  ];
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Latency (ms) — {data.samples} samples</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={overall} margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `${v}ms`} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v).toFixed(0)} ms`, 'latency']} />
            <Bar dataKey="ms" radius={[4, 4, 0, 0]}>
              {overall.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-muted-foreground mt-1">only rows with non-null latencyMs counted; null rows excluded</p>
      </CardContent>
    </Card>
  );
}

// ─── Routing (SYSTEM_ADMIN only) ───────────────────────────────────────────
function RoutingChart() {
  // 403 for non-admins is expected — render an honest banner, not a crash.
  const { data, error } = useSWR<RoutingReport>('analytics/routing', () => analyticsApi.routing());
  if (error) {
    const forbidden = (error as { status?: number }).status === 403;
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Routing</CardTitle></CardHeader>
        <CardContent>
          <EmptyState label={forbidden ? 'Admin only — RoutingLog is platform-wide (not tenant-scoped)' : 'Failed to load routing analytics'} />
        </CardContent>
      </Card>
    );
  }
  if (!data) return <Card><CardHeader><CardTitle className="text-sm">Routing</CardTitle></CardHeader><CardContent><EmptyState label="Loading…" /></CardContent></Card>;
  if (data.total === 0) return <Card><CardHeader><CardTitle className="text-sm">Routing</CardTitle></CardHeader><CardContent><EmptyState label="No routing decisions yet" /></CardContent></Card>;
  const rows = Object.entries(data.byModel).sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 8).map(([name, value]) => ({ name, value: Number(value) }));
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Routing by model — fallback rate {(data.fallbackRate * 100).toFixed(1)}%</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} layout="vertical" margin={{ left: 70, right: 20, top: 5, bottom: 5 }}>
            <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} width={65} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" fill="#c084fc" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default function HonestAnalyticsCharts() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
      <ToolsChart />
      <ApprovalsChart />
      <IntentsChart />
      <LatencyChart />
      <RoutingChart />
    </div>
  );
}