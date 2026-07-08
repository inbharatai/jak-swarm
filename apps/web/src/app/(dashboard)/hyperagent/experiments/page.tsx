'use client';

import React from 'react';
import useSWR from 'swr';
import { hyperagentApi, type ExperimentsView } from '@/lib/hyperagent';
import { ViewShell, StatTile, SectionCard, DataTable, RoadmapNote, LoadingState, ErrorState, getErrorMessage, type Column } from '../_shared';
import type { ExperimentRow, RolloutEventRow } from '@jak-swarm/shared';

export default function ExperimentsPage() {
  const { data, error, isLoading } = useSWR<ExperimentsView>('/hyperagent/experiments', hyperagentApi.experiments);
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={getErrorMessage(error)} />;

  const expCols: Column<ExperimentRow>[] = [
    { key: 'kind', header: 'Kind', render: (r) => <span className="font-mono text-xs">{r.kind}</span> },
    { key: 'version', header: 'Version', render: (r) => <span className="tabular-nums">{r.version}</span> },
    { key: 'status', header: 'Status', render: (r) => <span className="font-mono text-xs">{r.status}</span> },
    { key: 'rollout', header: 'Rollout %', render: (r) => <span className="tabular-nums">{r.rolloutPercent}</span> },
    { key: 'reason', header: 'Change reason', render: (r) => <span className="text-xs">{r.changeReason ?? '—'}</span> },
    { key: 'eval', header: 'Evaluation', render: (r) => <span className="text-xs">{r.evaluationSummary ?? '—'}</span> },
  ];
  const evCols: Column<RolloutEventRow>[] = [
    { key: 'from', header: 'From', render: (r) => <span className="font-mono text-xs">{r.fromStatus}</span> },
    { key: 'to', header: 'To', render: (r) => <span className="font-mono text-xs">{r.toStatus}</span> },
    { key: 'stage', header: 'Stage', render: (r) => <span className="font-mono text-xs">{r.stage ?? '—'}</span> },
    { key: 'decision', header: 'Decision', render: (r) => <span className="font-mono text-xs">{r.decision ?? '—'}</span> },
    { key: 'rollout', header: 'Rollout %', render: (r) => <span className="tabular-nums">{r.rolloutPercent}</span> },
    { key: 'reason', header: 'Reason', render: (r) => <span className="text-xs">{r.reason}</span> },
    { key: 'at', header: 'Occurred', render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.occurredAt).toLocaleString()}</span> },
  ];

  return (
    <ViewShell
      title="Experiments"
      description="Versioned configs in shadow / canary / promoted / rolled-back, with the immutable rollout audit trail."
      dataAvailable={data.dataAvailable}
      generatedAt={data.generatedAt}
      note={data.note}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="In shadow" value={data.inShadow.length} />
        <StatTile label="In canary" value={data.inCanary.length} />
        <StatTile label="Promoted" value={data.promoted.length} />
        <StatTile label="Rolled back" value={data.rolledBack.length} />
      </div>
      {!data.controlsWired && (
        <RoadmapNote>
          Promote / rollback controls are display-only here. Advancing a config through shadow → canary → promote (or rollback) is decided by the Phase 9 config-lifecycle gate via a write endpoint — the control centre surfaces the resulting audit trail, it does not fabricate or perform the transition client-side.
        </RoadmapNote>
      )}
      <SectionCard title={`Experiments (${data.experiments.length})`}>
        <DataTable columns={expCols} rows={data.experiments} rowKey={(r) => r.id} emptyHint="No ConfigVersion experiments yet." />
      </SectionCard>
      <SectionCard title={`Rollout audit trail (${data.rolloutEvents.length})`}>
        <DataTable columns={evCols} rows={data.rolloutEvents} rowKey={(r) => r.id} emptyHint="No rollout events yet." />
      </SectionCard>
    </ViewShell>
  );
}