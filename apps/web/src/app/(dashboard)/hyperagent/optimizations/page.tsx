'use client';

import React from 'react';
import useSWR from 'swr';
import { hyperagentApi, type OptimizationsView } from '@/lib/hyperagent';
import { ViewShell, StatTile, SectionCard, DataTable, RoadmapNote, LoadingState, ErrorState, getErrorMessage, type Column } from '../_shared';
import type { OptimizationProposalRow, DiffRow } from '@jak-swarm/shared';

export default function OptimizationsPage() {
  const { data, error, isLoading } = useSWR<OptimizationsView>('/hyperagent/optimizations', hyperagentApi.optimizations);
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={getErrorMessage(error)} />;

  const propCols: Column<OptimizationProposalRow>[] = [
    { key: 'kind', header: 'Kind', render: (r) => <span className="font-mono text-xs">{r.kind}</span> },
    { key: 'version', header: 'Version', render: (r) => <span className="tabular-nums">{r.version}</span> },
    { key: 'status', header: 'Status', render: (r) => <span className="font-mono text-xs">{r.status}</span> },
    { key: 'rollout', header: 'Rollout %', render: (r) => <span className="tabular-nums">{r.rolloutPercent}</span> },
    { key: 'reason', header: 'Change reason', render: (r) => <span className="text-xs">{r.changeReason ?? '—'}</span> },
    { key: 'at', header: 'Created', render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span> },
  ];
  const diffCols: Column<DiffRow>[] = [
    { key: 'source', header: 'Source', render: (r) => <span className="font-mono text-xs">{r.source}</span> },
    { key: 'ref', header: 'Ref', render: (r) => <span className="font-mono text-xs">{r.workflowId ?? r.kind ?? '—'}</span> },
    { key: 'version', header: 'Version', render: (r) => <span className="tabular-nums">{r.version ?? '—'}</span> },
    { key: 'reason', header: 'Change reason', render: (r) => <span className="text-xs">{r.changeReason}</span> },
    { key: 'at', header: 'At', render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span> },
  ];

  return (
    <ViewShell
      title="Optimizations"
      description="Versioned optimisation proposals + prompt/workflow diffs from plan and config history."
      dataAvailable={data.dataAvailable}
      generatedAt={data.generatedAt}
      note={data.note}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Proposals" value={data.totalProposals} />
        <StatTile label="Diffs" value={data.diffs.length} />
        <StatTile label="Benchmarks" value={data.benchmarks.length} hint={data.benchmarksPersisted ? 'Persisted' : 'Not persisted (in-process only)'} />
      </div>
      {!data.benchmarksPersisted && (
        <RoadmapNote>
          Benchmark results are not yet persisted — the Phase 8 benchmark harness runs in-process only. A benchmark-results store is roadmap. No benchmark rows are shown here until that store exists.
        </RoadmapNote>
      )}
      <SectionCard title={`Optimisation proposals (${data.proposals.length})`}>
        <DataTable columns={propCols} rows={data.proposals} rowKey={(r) => r.id} emptyHint="No ConfigVersion proposals yet." />
      </SectionCard>
      <SectionCard title={`Prompt / workflow diffs (${data.diffs.length})`}>
        <DataTable columns={diffCols} rows={data.diffs} rowKey={(r, i) => `${r.source}-${r.version ?? i}`} emptyHint="No versioned diffs yet." />
      </SectionCard>
    </ViewShell>
  );
}