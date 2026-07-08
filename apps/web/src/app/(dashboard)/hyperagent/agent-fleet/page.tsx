'use client';

import React from 'react';
import useSWR from 'swr';
import { hyperagentApi, type AgentFleetView } from '@/lib/hyperagent';
import { ViewShell, StatTile, SectionCard, DataTable, LoadingState, ErrorState, getErrorMessage, type Column } from '../_shared';
import type { AgentFleetStatsRow } from '@jak-swarm/shared';

export default function AgentFleetPage() {
  const { data, error, isLoading } = useSWR<AgentFleetView>('/hyperagent/agent-fleet', hyperagentApi.agentFleet);
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={getErrorMessage(error)} />;

  const cols: Column<AgentFleetStatsRow>[] = [
    { key: 'role', header: 'Agent role', render: (r) => <span className="font-mono text-xs">{r.agentRole}</span> },
    { key: 'runs', header: 'Total runs', render: (r) => <span className="tabular-nums">{r.totalRuns}</span> },
    { key: 'failed', header: 'Failed', render: (r) => <span className="tabular-nums">{r.failedRuns}</span> },
    { key: 'median', header: 'Median duration ms', render: (r) => <span className="tabular-nums">{r.medianDurationMs}</span> },
  ];

  return (
    <ViewShell
      title="Agent Fleet"
      description="Per-agent-role aggregates from real agent trace rows (runs, failures, median duration)."
      dataAvailable={data.dataAvailable}
      generatedAt={data.generatedAt}
      note={data.note}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Total traces" value={data.totalTraces} />
        <StatTile label="Roles active" value={data.byRole.length} />
        <StatTile label="Failed runs" value={data.byRole.reduce((s, r) => s + r.failedRuns, 0)} />
      </div>
      <SectionCard title={`By role (${data.byRole.length})`}>
        <DataTable columns={cols} rows={data.byRole} rowKey={(r) => r.agentRole} emptyHint="No agent traces yet." />
      </SectionCard>
    </ViewShell>
  );
}