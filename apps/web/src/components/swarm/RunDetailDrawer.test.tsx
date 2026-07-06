import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunDetailDrawer } from './RunDetailDrawer';
import type { Workflow, AgentTraceRecord } from '@/types';
import type { WorkflowTimeline } from '@/lib/api-client';

// WorkflowDAG is a heavy @xyflow/react component loaded via next/dynamic;
// stub it so the drawer test stays isolated + fast. The LiveDAG test below
// covers the real plan→DAG wiring separately.
vi.mock('./LiveDAG', () => ({
  LiveDAG: ({ plan }: { plan?: unknown }) => (
    <div data-testid="live-dag">{plan ? 'has-plan' : 'no-plan'}</div>
  ),
}));
vi.mock('./LiveGantt', () => ({
  LiveGantt: ({ traces }: { traces: AgentTraceRecord[] }) => (
    <div data-testid="live-gantt">{traces.length} traces</div>
  ),
}));
vi.mock('./CostTokenGauges', () => ({
  CostTokenGauges: ({ timeline }: { timeline: WorkflowTimeline | null }) => (
    <div data-testid="cost-gauges">{timeline ? `$${timeline.totalCostUsd}` : 'no-data'}</div>
  ),
}));
vi.mock('./ToolCallStream', () => ({
  ToolCallStream: ({ traces }: { traces: AgentTraceRecord[] }) => (
    <div data-testid="tool-stream">{traces.length} calls</div>
  ),
}));

const workflow: Workflow = {
  id: 'wf_test_123',
  tenantId: 't1',
  status: 'RUNNING',
  goal: 'Draft outreach to acme',
  industry: 'SAAS',
  createdAt: '2026-07-05T10:00:00.000Z',
  startedAt: '2026-07-05T10:00:00.000Z',
  completedAt: null,
  traces: [],
} as unknown as Workflow;

const timeline: WorkflowTimeline = {
  costByAgent: {},
  costByProvider: {},
  costByModel: {},
  criticalPath: ['PLANNER', 'WORKER_EMAIL'],
  totalCostUsd: 0.42,
  totalInputTokens: 1200,
  totalOutputTokens: 300,
  nodeCount: 3,
  nodes: [],
} as unknown as WorkflowTimeline;

const traces: AgentTraceRecord[] = [
  {
    id: 'tr1',
    workflowId: 'wf_test_123',
    tenantId: 't1',
    agentRole: 'WORKER_EMAIL',
    status: 'COMPLETED',
    steps: [],
    startedAt: '2026-07-05T10:00:01.000Z',
    completedAt: '2026-07-05T10:00:05.000Z',
    createdAt: '2026-07-05T10:00:01.000Z',
  },
];

describe('RunDetailDrawer', () => {
  it('shows the empty state when no workflow is selected', () => {
    render(<RunDetailDrawer workflow={null} isLoading={false} plan={null} timeline={null} traces={[]} />);
    expect(screen.getByText(/Select a run from the rail/)).toBeInTheDocument();
  });

  it('renders the header + passes plan, timeline, traces to children', () => {
    render(
      <RunDetailDrawer
        workflow={workflow}
        isLoading={false}
        plan={{ steps: [{ id: 's1' }] } as unknown as Workflow['plan']}
        timeline={timeline}
        traces={traces}
      />,
    );
    expect(screen.getByText('Draft outreach to acme')).toBeInTheDocument();
    expect(screen.getByText('wf_test_123')).toBeInTheDocument();
    expect(screen.getByText('SAAS')).toBeInTheDocument();
    // DAG is the default tab → rendered immediately.
    expect(screen.getByTestId('live-dag')).toHaveTextContent('has-plan');

    // Gantt tab — click to mount LiveGantt.
    fireEvent.click(screen.getByRole('tab', { name: 'Gantt' }));
    expect(screen.getByTestId('live-gantt')).toHaveTextContent('1 traces');

    // Cost tab — click to mount CostTokenGauges + ToolCallStream.
    fireEvent.click(screen.getByRole('tab', { name: 'Cost' }));
    expect(screen.getByTestId('cost-gauges')).toHaveTextContent('$0.42');
    expect(screen.getByTestId('tool-stream')).toHaveTextContent('1 calls');
  });
});