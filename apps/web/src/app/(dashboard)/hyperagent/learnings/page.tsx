'use client';

import React from 'react';
import useSWR from 'swr';
import { hyperagentApi, type LearningsView } from '@/lib/hyperagent';
import { ViewShell, StatTile, SectionCard, DataTable, RoadmapNote, LoadingState, ErrorState, getErrorMessage, type Column } from '../_shared';
import type { LearningRow } from '@jak-swarm/shared';

export default function LearningsPage() {
  const { data, error, isLoading } = useSWR<LearningsView>('/hyperagent/learnings', hyperagentApi.learnings);
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={getErrorMessage(error)} />;

  const cols: Column<LearningRow>[] = [
    { key: 'key', header: 'Key', render: (r) => <span className="font-mono text-xs">{r.key}</span> },
    { key: 'kind', header: 'Kind', render: (r) => <span className="font-mono text-xs">{r.kind}</span> },
    { key: 'source', header: 'Source', render: (r) => <span className="font-mono text-xs">{r.source}</span> },
    { key: 'status', header: 'Status', render: (r) => <span className="font-mono text-xs">{r.status}</span> },
    { key: 'conf', header: 'Conf', render: (r) => <span className="tabular-nums">{r.confidence.toFixed(2)}</span> },
    { key: 'mi', header: 'MI', render: (r) => <span className="tabular-nums">{r.mutualInformation === null ? '—' : r.mutualInformation.toFixed(3)}</span> },
    { key: 'summary', header: 'Summary', render: (r) => <span className="text-xs">{r.summary}</span> },
  ];

  return (
    <ViewShell
      title="Learnings"
      description="Extracted learning candidates, promoted learnings, and applied-learning impact (measured by mutual information)."
      dataAvailable={data.dataAvailable}
      generatedAt={data.generatedAt}
      note={data.note}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Total" value={data.total} />
        <StatTile label="Candidates" value={data.candidates.length} />
        <StatTile label="Promoted" value={data.promoted.length} />
        <StatTile label="With measured impact" value={data.promotedWithMeasuredImpact} hint={data.impactMeasured ? 'MI-gated (innovation #2)' : 'No MI measured yet'} />
      </div>
      {!data.impactMeasured && data.promoted.length > 0 && (
        <RoadmapNote>
          Promoted learnings exist but none carry a measured mutual-information value — the info-theoretic gate (innovation #2) has not yet recorded impact for these. Impact is reported only when measured.
        </RoadmapNote>
      )}
      <SectionCard title={`Candidates (${data.candidates.length})`}>
        <DataTable columns={cols} rows={data.candidates} rowKey={(r) => r.id} emptyHint="No candidate learnings." />
      </SectionCard>
      <SectionCard title={`Promoted (${data.promoted.length})`}>
        <DataTable columns={cols} rows={data.promoted} rowKey={(r) => r.id} emptyHint="No promoted learnings." />
      </SectionCard>
      <SectionCard title={`Deprecated / expired / rejected (${data.deprecatedOrExpired.length})`}>
        <DataTable columns={cols} rows={data.deprecatedOrExpired} rowKey={(r) => r.id} emptyHint="None." />
      </SectionCard>
    </ViewShell>
  );
}