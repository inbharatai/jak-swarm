'use client';

import React from 'react';
import useSWR from 'swr';
import { hyperagentApi, type OverviewView } from '@/lib/hyperagent';
import { ViewShell, StatTile, BucketList, SectionCard, LoadingState, ErrorState, getErrorMessage } from './_shared';

export default function OverviewPage() {
  const { data, error, isLoading } = useSWR<OverviewView>('/hyperagent/overview', hyperagentApi.overview);
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={getErrorMessage(error)} />;
  return (
    <ViewShell
      title="Overview"
      description="HyperAgent mode + outcome, plan, repair, and learning buckets for this tenant."
      dataAvailable={data.dataAvailable}
      generatedAt={data.generatedAt}
      note={data.note}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="HyperAgent mode" value={data.mode.hyperAgentMode} hint={data.mode.dataAvailable ? `Autonomy ${data.mode.autonomyLevel}` : 'Not configured'} />
        <StatTile label="Workflow outcomes" value={data.totalOutcomes} />
        <StatTile label="Plan versions (max)" value={data.planVersions} hint="Deepest plan-history depth" />
        <StatTile label="Learnings" value={data.learningsByStatus.reduce((s, b) => s + b.count, 0)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Outcomes by verdict">
          <BucketList buckets={data.outcomesByVerdict} emptyHint="No outcome rows yet." />
        </SectionCard>
        <SectionCard title="Repairs by status">
          <BucketList buckets={data.repairsByStatus} emptyHint="No repair rows yet." />
        </SectionCard>
        <SectionCard title="Learnings by status">
          <BucketList buckets={data.learningsByStatus} emptyHint="No learning rows yet." />
        </SectionCard>
      </div>
    </ViewShell>
  );
}