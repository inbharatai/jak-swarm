'use client';

import React from 'react';
import useSWR from 'swr';
import { hyperagentApi, type GovernanceView } from '@/lib/hyperagent';
import { ViewShell, StatTile, SectionCard, DataTable, LoadingState, ErrorState, getErrorMessage, type Column } from '../_shared';
import type { GovernanceViolationRow, GovernanceRuleRow } from '@jak-swarm/shared';

export default function GovernancePage() {
  const { data, error, isLoading } = useSWR<GovernanceView>('/hyperagent/governance', hyperagentApi.governance);
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={getErrorMessage(error)} />;

  const vCols: Column<GovernanceViolationRow>[] = [
    { key: 'source', header: 'Source', render: (r) => <span className="font-mono text-xs">{r.source}</span> },
    { key: 'workflowId', header: 'Workflow', render: (r) => <span className="font-mono text-xs">{r.workflowId}</span> },
    { key: 'taskId', header: 'Task', render: (r) => <span className="font-mono text-xs">{r.taskId}</span> },
    { key: 'class', header: 'Class', render: (r) => <span className="font-mono text-xs">{r.failureClass}</span> },
    { key: 'flags', header: 'Flags', render: (r) => <span className="text-xs">{[r.quarantine && 'quarantine', r.deterministicBlock && 'block'].filter(Boolean).join(', ') || '—'}</span> },
    { key: 'at', header: 'At', render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span> },
  ];
  const rCols: Column<GovernanceRuleRow>[] = [
    { key: 'kind', header: 'Kind', render: (r) => <span className="font-mono text-xs">{r.kind}</span> },
    { key: 'version', header: 'Version', render: (r) => <span className="tabular-nums">{r.version}</span> },
    { key: 'status', header: 'Status', render: (r) => <span className="font-mono text-xs">{r.status}</span> },
    { key: 'reason', header: 'Change reason', render: (r) => <span className="text-xs">{r.changeReason ?? '—'}</span> },
    { key: 'at', header: 'Created', render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span> },
  ];

  return (
    <ViewShell
      title="Governance"
      description="Security-class failure diagnoses surfaced as governance violations, plus versioned governance rules."
      dataAvailable={data.dataAvailable}
      generatedAt={data.generatedAt}
      note={data.note}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile label="Violations" value={data.totalViolations} hint="PERMISSION_DENIED / POLICY_BLOCK / PROMPT_INJECTION" />
        <StatTile label="Governance rules" value={data.totalRules} hint="ConfigVersion GOVERNANCE_RULE" />
      </div>
      <SectionCard title={`Violations (${data.violations.length})`}>
        <DataTable columns={vCols} rows={data.violations} rowKey={(r) => `${r.workflowId}-${r.taskId}`} emptyHint="No security-class failures yet." />
      </SectionCard>
      <SectionCard title={`Governance rules (${data.rules.length})`}>
        <DataTable columns={rCols} rows={data.rules} rowKey={(r) => r.id} emptyHint="No GOVERNANCE_RULE configs yet." />
      </SectionCard>
    </ViewShell>
  );
}