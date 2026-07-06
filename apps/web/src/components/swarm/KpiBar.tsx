'use client';

// ─── JARVIS Inspector — KPI bar ──────────────────────────────────────────────
//
// Four honest readouts, polled at a slow cadence (15s) so the command
// surface feels live without hammering the API:
//   • Active Runs  — useWorkflows total for RUNNING+PAUSED+PENDING.
//   • Cost 30d     — analyticsApi.cost() totalUsd (last 30 days; the label
//                    is honest about the window, not "today").
//   • Success 24h  — completed / (completed + failed + cancelled) over the
//                    last 24h from useWorkflows totals. Honest "—" when no
//                    runs in the window (no division by zero, no fake 100%).
//   • Queue Depth  — workflowApi.queueStats() queued+active. TENANT_ADMIN+
//                    only; a 403 renders "N/A — admin only" honestly rather
//                    than fabricating a number.
// Tokens/min is intentionally omitted here (Phase C will add it from real
// cost_updated events; faking it now would violate the no-dummies rule).

import useSWR from 'swr';
import { cn } from '@/lib/cn';
import { useWorkflows } from '@/hooks/useWorkflow';
import { type CostBreakdown, type ToolsReport, type ApprovalsDecisionsReport, analyticsApi } from '@/lib/api-client';
import { dataFetcher } from '@/lib/api-client';
import { StatusDot } from '@/components/ui';

const POLL_MS = 15_000;

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function KpiCell({
  label,
  value,
  sub,
  accent,
  pulse,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  pulse?: boolean;
}) {
  return (
    <div className="jarvis-panel flex flex-1 flex-col gap-0.5 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {pulse && <StatusDot variant="running" />}
        {label}
      </div>
      <div className={cn('jarvis-readout text-xl font-semibold text-foreground', accent)}>{value}</div>
      {sub && <div className="jarvis-readout text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

interface QueueStats {
  queued: number;
  active: number;
  completed: number;
  failed: number;
  dead: number;
  running: number;
  maxConcurrent: number;
}

export function KpiBar() {
  // Active runs — total count across RUNNING+PAUSED+PENDING. pageSize:1 so
  // we only pull one row; `total` is what we read.
  const active = useWorkflows(
    { status: ['RUNNING', 'PAUSED', 'PENDING'], page: 1, pageSize: 1 },
    { refreshInterval: POLL_MS },
  );

  // 24h success rate — three totals. Each uses pageSize:1.
  const since = isoHoursAgo(24);
  const completed24 = useWorkflows({ status: ['COMPLETED'], dateFrom: since, page: 1, pageSize: 1 }, { refreshInterval: POLL_MS });
  const failed24 = useWorkflows({ status: ['FAILED', 'CANCELLED'], dateFrom: since, page: 1, pageSize: 1 }, { refreshInterval: POLL_MS });

  const completedN = completed24.total ?? 0;
  const failedN = failed24.total ?? 0;
  const denom = completedN + failedN;
  const successRate = denom > 0 ? Math.round((completedN / denom) * 100) : null;

  // Cost (30d) — analyticsApi.cost.
  const { data: cost } = useSWR<CostBreakdown>('/analytics/cost', dataFetcher, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: false,
  });

  // Queue depth — admin-only. useSWR with onErrorReturn to distinguish 403.
  const { data: queue, error: queueErr } = useSWR<QueueStats>(
    '/workflows/queue/stats',
    dataFetcher,
    { refreshInterval: POLL_MS, revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const queueAdminLocked = !!queueErr && !queue;
  const queueDepth = queue ? queue.queued + queue.active : null;

  // Phase C — Tool Success (aggregated across AgentTrace.toolCallsJson) +
  // Auto-Approval Rate (ApprovalAuditLog). Both tenant-scoped, honest "—"
  // when there are no samples (no fake 100%).
  const { data: tools } = useSWR<ToolsReport>('analytics/tools', () => analyticsApi.tools(), {
    refreshInterval: POLL_MS,
    revalidateOnFocus: false,
  });
  const totalCalls = tools?.totalToolCalls ?? 0;
  const toolSuccessRate =
    totalCalls > 0
      ? Math.round(
          ((tools?.tools.reduce((s, t) => s + t.successCount, 0) ?? 0) / totalCalls) * 100,
        )
      : null;

  const { data: approvals } = useSWR<ApprovalsDecisionsReport>(
    'analytics/approvals',
    () => analyticsApi.approvalDecisions(),
    { refreshInterval: POLL_MS, revalidateOnFocus: false },
  );
  const approvalTotal = approvals?.total ?? 0;
  const autoApprovalRate =
    approvalTotal > 0 ? Math.round(((approvals?.autoApproved ?? 0) / approvalTotal) * 100) : null;

  return (
    <div className="flex flex-wrap gap-2">
      <KpiCell
        label="Active Runs"
        value={String(active.total ?? 0)}
        sub={active.isLoading ? 'loading' : 'live'}
        accent="jarvis-neon"
        pulse={(active.total ?? 0) > 0}
      />
      <KpiCell
        label="Success 24h"
        value={successRate === null ? '—' : `${successRate}%`}
        sub={denom > 0 ? `${completedN}/${denom} runs` : 'no runs in window'}
        accent={successRate === null ? undefined : successRate >= 80 ? 'text-emerald-300' : successRate >= 50 ? 'text-amber-300' : 'text-rose-300'}
      />
      <KpiCell
        label="Tool Success"
        value={toolSuccessRate === null ? '—' : `${toolSuccessRate}%`}
        sub={totalCalls > 0 ? `${totalCalls} calls` : 'no tool calls'}
        accent={toolSuccessRate === null ? undefined : toolSuccessRate >= 80 ? 'text-emerald-300' : toolSuccessRate >= 50 ? 'text-amber-300' : 'text-rose-300'}
      />
      <KpiCell
        label="Auto-Approve"
        value={autoApprovalRate === null ? '—' : `${autoApprovalRate}%`}
        sub={approvalTotal > 0 ? `${approvals?.autoApproved ?? 0}/${approvalTotal}` : 'no approvals'}
        accent={autoApprovalRate === null ? undefined : autoApprovalRate >= 80 ? 'text-emerald-300' : 'text-amber-300'}
      />
      <KpiCell
        label="Cost 30d"
        value={cost ? `$${cost.totalUsd.toFixed(2)}` : '—'}
        sub={cost ? `${Object.keys(cost.byProvider).length} providers` : 'loading'}
      />
      <KpiCell
        label="Queue Depth"
        value={queueAdminLocked ? 'N/A' : queueDepth === null ? '…' : String(queueDepth)}
        sub={queueAdminLocked ? 'admin only' : queue ? `running ${queue.running}/${queue.maxConcurrent}` : 'loading'}
      />
    </div>
  );
}