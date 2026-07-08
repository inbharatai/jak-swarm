'use client';

import React from 'react';
import useSWR from 'swr';
import { hyperagentApi, type RunsView } from '@/lib/hyperagent';
import { ViewShell, StatTile, SectionCard, DataTable, LoadingState, ErrorState, getErrorMessage, type Column } from '../_shared';
import type { OutcomeRow, DiagnosisRow, RepairRow } from '@jak-swarm/shared';

export default function RunsPage() {
  const { data, error, isLoading } = useSWR<RunsView>('/hyperagent/runs', hyperagentApi.runs);
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={getErrorMessage(error)} />;

  const outcomeCols: Column<OutcomeRow>[] = [
    { key: 'workflowId', header: 'Workflow', render: (r) => <span className="font-mono text-xs">{r.workflowId}</span> },
    { key: 'outcome', header: 'Verdict', render: (r) => <span className="font-mono text-xs">{r.outcome}</span> },
    { key: 'tasks', header: 'Tasks (p/f/b)', render: (r) => <span className="tabular-nums">{r.taskPassed}/{r.taskFailed}/{r.taskBlocked}</span> },
    { key: 'cost', header: 'Cost $', render: (r) => <span className="tabular-nums">{r.totalCostUsd.toFixed(4)}</span> },
    { key: 'dur', header: 'Duration ms', render: (r) => <span className="tabular-nums">{r.durationMs}</span> },
    { key: 'at', header: 'Created', render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span> },
  ];
  const diagCols: Column<DiagnosisRow>[] = [
    { key: 'workflowId', header: 'Workflow', render: (r) => <span className="font-mono text-xs">{r.workflowId}</span> },
    { key: 'taskId', header: 'Task', render: (r) => <span className="font-mono text-xs">{r.taskId}</span> },
    { key: 'failureClass', header: 'Class', render: (r) => <span className="font-mono text-xs">{r.failureClass}</span> },
    { key: 'level', header: 'Repair', render: (r) => <span className="font-mono text-xs">{r.recommendedRepairLevel}</span> },
    { key: 'flags', header: 'Flags', render: (r) => <span className="text-xs">{[r.deterministicBlock && 'block', r.requiresApproval && 'approval', r.quarantine && 'quarantine'].filter(Boolean).join(', ') || '—'}</span> },
    { key: 'conf', header: 'Conf', render: (r) => <span className="tabular-nums">{r.confidence.toFixed(2)}</span> },
  ];
  const repairCols: Column<RepairRow>[] = [
    { key: 'id', header: 'ID', render: (r) => <span className="font-mono text-xs">{r.id.slice(0, 8)}</span> },
    { key: 'kind', header: 'Kind', render: (r) => <span className="font-mono text-xs">{r.kind}</span> },
    { key: 'status', header: 'Status', render: (r) => <span className="font-mono text-xs">{r.status}</span> },
    { key: 'risk', header: 'Risk', render: (r) => <span className="font-mono text-xs">{r.risk}</span> },
    { key: 'safety', header: 'Safety', render: (r) => <span className="font-mono text-xs">{r.safetyClass}</span> },
    { key: 'branch', header: 'Branch', render: (r) => <span className="font-mono text-xs">{r.branchName}</span> },
    { key: 'pr', header: 'PR', render: (r) => (r.prUrl ? <a className="text-xs underline" href={r.prUrl} target="_blank" rel="noreferrer">#{r.prNumber}</a> : <span className="text-xs text-muted-foreground">—</span>) },
  ];

  return (
    <ViewShell
      title="Runs"
      description="Workflow outcomes, failure diagnoses, and R5 code-repair proposals."
      dataAvailable={data.dataAvailable}
      generatedAt={data.generatedAt}
      note={data.note}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Outcomes" value={data.totalOutcomes} />
        <StatTile label="Diagnoses" value={data.totalDiagnoses} />
        <StatTile label="Repairs attempted" value={data.repairsAttempted} hint={`${data.totalRepairs} total proposals`} />
      </div>
      <SectionCard title={`Workflow outcomes (${data.outcomes.length})`}>
        <DataTable columns={outcomeCols} rows={data.outcomes} rowKey={(r) => r.workflowId} emptyHint="No outcome rows yet." />
      </SectionCard>
      <SectionCard title={`Failure diagnoses (${data.diagnoses.length})`}>
        <DataTable columns={diagCols} rows={data.diagnoses} rowKey={(r) => r.id} emptyHint="No diagnosis rows yet." />
      </SectionCard>
      <SectionCard title={`Code-repair proposals (${data.repairs.length})`}>
        <DataTable columns={repairCols} rows={data.repairs} rowKey={(r) => r.id} emptyHint="No repair rows yet." />
      </SectionCard>
    </ViewShell>
  );
}