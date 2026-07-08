'use client';

import React from 'react';
import useSWR from 'swr';
import { hyperagentApi, type AutonomyView } from '@/lib/hyperagent';
import { ViewShell, StatTile, SectionCard, DataTable, LoadingState, ErrorState, getErrorMessage, type Column } from '../_shared';
import type { AutonomyDecisionRow } from '@jak-swarm/shared';

export default function AutonomyPage() {
  const { data, error, isLoading } = useSWR<AutonomyView>('/hyperagent/autonomy', hyperagentApi.autonomy);
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={getErrorMessage(error)} />;

  const c = data.config;
  const decCols: Column<AutonomyDecisionRow>[] = [
    { key: 'wf', header: 'Workflow', render: (r) => <span className="font-mono text-xs">{r.outcomeWorkflowId ?? '—'}</span> },
    { key: 'verdict', header: 'Verdict', render: (r) => <span className="font-mono text-xs">{r.verdict ?? '—'}</span> },
    { key: 'at', header: 'Snapshotted', render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.snapshottedAt).toLocaleString()}</span> },
  ];

  return (
    <ViewShell
      title="Autonomy"
      description="The tenant's HyperAgent autonomy policy + recent autonomy decisions snapshotted on workflow outcomes."
      dataAvailable={data.dataAvailable}
      generatedAt={data.generatedAt}
      note={data.note}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Mode" value={c.hyperAgentMode} hint={c.dataAvailable ? `Level ${c.autonomyLevel}` : 'Not configured'} />
        <StatTile label="Enabled" value={c.hyperAgentEnabled ? 'yes' : 'no'} />
        <StatTile label="Recent decisions" value={data.recentDecisions.length} />
      </div>
      <SectionCard title="Autonomy policy">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <PolicyRow label="Max execution retries" value={c.maxExecutionRetries} />
          <PolicyRow label="Max output repairs" value={c.maxOutputRepairs} />
          <PolicyRow label="Max plan repairs" value={c.maxPlanRepairs} />
          <PolicyRow label="Max capability repairs" value={c.maxCapabilityRepairs} />
          <PolicyRow label="Max total cost USD" value={c.maxTotalCostUsd} />
          <PolicyRow label="Max duration ms" value={c.maxDurationMs} />
          <PolicyRow label="Allow shadow optimization" value={c.allowShadowOptimization ? 'yes' : 'no'} />
          <PolicyRow label="Allow canary optimization" value={c.allowCanaryOptimization ? 'yes' : 'no'} />
          <PolicyRow label="Allow code-patch proposal" value={c.allowCodePatchProposal ? 'yes' : 'no'} />
          <PolicyRow label="Approval required (prompt promotion)" value={c.requireApprovalForPromptPromotion ? 'yes' : 'no'} />
          <PolicyRow label="Approval required (workflow promotion)" value={c.requireApprovalForWorkflowPromotion ? 'yes' : 'no'} />
          <PolicyRow label="Last updated" value={c.updatedAt ? new Date(c.updatedAt).toLocaleString() : '—'} />
        </dl>
      </SectionCard>
      <SectionCard title={`Recent autonomy decisions (${data.recentDecisions.length})`}>
        <DataTable columns={decCols} rows={data.recentDecisions} rowKey={(r, i) => `${r.outcomeWorkflowId ?? i}`} emptyHint="No autonomy decisions snapshotted yet." />
      </SectionCard>
    </ViewShell>
  );
}

function PolicyRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-muted/40 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-sm font-medium">{value}</dd>
    </div>
  );
}