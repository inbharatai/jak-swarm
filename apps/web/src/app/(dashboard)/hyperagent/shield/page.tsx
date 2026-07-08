'use client';

import React from 'react';
import useSWR from 'swr';
import { hyperagentApi, type ShieldView } from '@/lib/hyperagent';
import { ViewShell, StatTile, SectionCard, BucketList, DataTable, RoadmapNote, LoadingState, ErrorState, getErrorMessage, type Column } from '../_shared';
import type { ShieldDecisionRow } from '@jak-swarm/shared';

export default function ShieldPage() {
  const { data, error, isLoading } = useSWR<ShieldView>('/hyperagent/shield', hyperagentApi.shield);
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={getErrorMessage(error)} />;

  const cols: Column<ShieldDecisionRow>[] = [
    { key: 'id', header: 'Audit event', render: (r) => <span className="font-mono text-xs">{r.auditEventId.slice(0, 8)}</span> },
    { key: 'verdict', header: 'Verdict', render: (r) => <span className="font-mono text-xs">{r.verdict}</span> },
    { key: 'subject', header: 'Subject kind', render: (r) => <span className="font-mono text-xs">{r.subjectKind ?? '—'}</span> },
    { key: 'tenant', header: 'Tenant', render: (r) => <span className="font-mono text-xs">{r.tenantId ?? '—'}</span> },
    { key: 'at', header: 'Issued', render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.issuedAt).toLocaleString()}</span> },
  ];

  return (
    <ViewShell
      title="Shield"
      description="Signed Shield decisions (ALLOW / BLOCK / APPROVE_REQUIRED) and their verdict buckets."
      dataAvailable={data.dataAvailable}
      generatedAt={data.generatedAt}
      note={data.note}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile label="Total decisions" value={data.total} />
        <StatTile label="Dedicated store" value={data.decisionsPersisted ? 'persisted' : 'audit-log only'} hint={data.decisionsPersisted ? 'shield_decisions table' : 'Roadmap'} />
      </div>
      {!data.decisionsPersisted && (
        <RoadmapNote>
          The signed Shield-decision crypto core + MCP client (Phase 8) are wired, but a persisted shield_decisions table is roadmap. Decisions shown here are surfaced from the audit log only — honest, not fabricated.
        </RoadmapNote>
      )}
      <SectionCard title="Verdict buckets">
        <BucketList buckets={data.byVerdict} emptyHint="No shield decisions recorded." />
      </SectionCard>
      <SectionCard title={`Decisions (${data.decisions.length})`}>
        <DataTable columns={cols} rows={data.decisions} rowKey={(r) => r.auditEventId} emptyHint="No shield decisions recorded." />
      </SectionCard>
    </ViewShell>
  );
}