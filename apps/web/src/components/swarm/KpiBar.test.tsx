import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// KpiBar must be honest: 0 active runs (not blank), "—" success with no runs
// in window (no fake 100%), "N/A — admin only" on queue 403. Mock the two
// data sources (useWorkflows + useSWR) to drive each branch.

const useWorkflowsMock = vi.fn();
vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflows: (...args: unknown[]) => useWorkflowsMock(...args),
}));

const useSwrMock = vi.fn();
vi.mock('swr', () => ({
  default: (...args: unknown[]) => useSwrMock(...args),
}));

import { KpiBar } from './KpiBar';

beforeEach(() => {
  useWorkflowsMock.mockReset();
  useSwrMock.mockReset();
});

describe('KpiBar — honest readouts', () => {
  it('shows 0 active runs and the honest "no runs in window" sub when 24h is empty', () => {
    // active, completed24, failed24 each return total:0
    useWorkflowsMock.mockReturnValue({ total: 0, isLoading: false });
    // cost + queue
    useSwrMock.mockReturnValue({ data: undefined, error: undefined });
    const { container } = render(<KpiBar />);
    // Active Runs cell value = "0"
    const activeCell = screen.getByText('Active Runs').closest('.jarvis-panel');
    expect(activeCell?.textContent).toContain('0');
    // Success 24h honest sub
    expect(screen.getByText(/no runs in window/)).toBeInTheDocument();
    // Sanity: no fake 100% rendered anywhere.
    expect(container.textContent).not.toContain('100%');
  });

  it('computes success rate from completed / (completed + failed)', () => {
    useWorkflowsMock
      .mockReturnValueOnce({ total: 3, isLoading: false }) // active
      .mockReturnValueOnce({ total: 8, isLoading: false }) // completed24
      .mockReturnValueOnce({ total: 2, isLoading: false }); // failed24
    useSwrMock
      .mockReturnValueOnce({ data: { totalUsd: 1.23, byProvider: { openai: 1.23 } }, error: undefined }) // cost
      .mockReturnValueOnce({ data: { queued: 1, active: 2, running: 2, maxConcurrent: 5 }, error: undefined }); // queue
    render(<KpiBar />);
    // 8/(8+2) = 80%
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('8/10 runs')).toBeInTheDocument();
    expect(screen.getByText('$1.23')).toBeInTheDocument();
  });

  it('shows N/A for queue depth when the admin-only endpoint 403s', () => {
    useWorkflowsMock.mockReturnValue({ total: 0, isLoading: false });
    useSwrMock
      .mockReturnValueOnce({ data: undefined, error: undefined }) // cost loading
      .mockReturnValueOnce({ data: undefined, error: new Error('403') }); // queue forbidden
    render(<KpiBar />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.getByText('admin only')).toBeInTheDocument();
  });
});