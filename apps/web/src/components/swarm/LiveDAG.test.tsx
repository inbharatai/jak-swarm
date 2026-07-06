import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveDAG } from './LiveDAG';
import type { WorkflowPlan } from '@/types';

// LiveDAG code-splits WorkflowDAG via next/dynamic. Stub the heavy graph
// renderer so we can assert the plan → DAG wiring (the Phase B "renders plan
// from plan_created" contract) without pulling @xyflow/react into jsdom.
vi.mock('@/components/graph/WorkflowDAG', () => ({
  WorkflowDAG: ({ plan }: { plan?: WorkflowPlan }) => (
    <div data-testid="workflow-dag">{plan?.steps?.length ?? 0} steps</div>
  ),
}));

describe('LiveDAG', () => {
  it('shows the honest empty state when there is no plan yet', () => {
    render(<LiveDAG plan={undefined} workflowStatus="RUNNING" />);
    expect(screen.getByText(/No plan yet/)).toBeInTheDocument();
  });

  it('renders WorkflowDAG once a plan arrives (plan_created / planned payload)', async () => {
    const plan = { steps: [{ id: 's1' }, { id: 's2' }] } as unknown as WorkflowPlan;
    render(<LiveDAG plan={plan} workflowStatus="RUNNING" />);
    await waitFor(() => {
      expect(screen.getByTestId('workflow-dag')).toHaveTextContent('2 steps');
    });
  });

  it('treats an empty-steps plan as no-plan (honest, not a broken render)', () => {
    const plan = { steps: [] } as unknown as WorkflowPlan;
    render(<LiveDAG plan={plan} workflowStatus="RUNNING" />);
    expect(screen.getByText(/No plan yet/)).toBeInTheDocument();
  });
});