import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentCard } from './AgentCard';
import type { AgentTraceRecord } from '@/types';

// D.2 + D.3 — AgentCard must (a) show a derived USD cost from the persisted
// tokenUsage blob (same formula as the backend), honest "N/A" when no model,
// and (b) render the mapped step as a structured row (action + duration +
// status) with the raw I/O behind a toggle — NOT a default JSON.stringify
// dump. The "Steps not recorded" fallback must be reachable when steps is
// empty.

function makeTrace(overrides: Partial<AgentTraceRecord> = {}): AgentTraceRecord {
  return {
    id: 'trace-1',
    workflowId: 'wf-1',
    tenantId: 't1',
    agentRole: 'WORKER_EMAIL',
    status: 'COMPLETED',
    steps: [
      {
        id: 'step-1',
        traceId: 'trace-1',
        seq: 0,
        agentRole: 'WORKER_EMAIL',
        action: 'execute',
        input: { to: 'founder@example.com' },
        output: { messageId: 'msg-1' },
        durationMs: 1200,
        error: null,
        createdAt: new Date('2026-07-05T12:00:00Z').toISOString(),
      },
    ],
    startedAt: new Date('2026-07-05T12:00:00Z').toISOString(),
    completedAt: new Date('2026-07-05T12:00:01Z').toISOString(),
    createdAt: new Date('2026-07-05T12:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('AgentCard — D.2 derived cost + D.3 structured step render', () => {
  it('renders a derived USD cost from the tokenUsage blob (same formula as backend)', () => {
    // gpt-5.4-mini: 1500 in + 800 out → 0.00235 → "$0.0024"
    render(<AgentCard step={makeTrace({ tokenUsage: { inputTokens: 1500, outputTokens: 800, model: 'gpt-5.4-mini', provider: 'openai' } })} />);
    expect(screen.getByText('$0.0024')).toBeInTheDocument();
  });

  it('renders honest "N/A" when tokenUsage has no model (never a fake $0)', () => {
    render(<AgentCard step={makeTrace({ tokenUsage: { inputTokens: 100, outputTokens: 50 } })} />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('renders honest "N/A" when tokenUsage is absent', () => {
    render(<AgentCard step={makeTrace({ tokenUsage: null })} />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('renders the structured step row after expand (not a default raw JSON dump)', () => {
    render(<AgentCard step={makeTrace()} />);
    fireEvent.click(screen.getByRole('button'));
    // The mapped step action renders as text; the "show raw I/O" toggle is
    // present (raw JSON is gated behind it, not shown by default).
    expect(screen.getByText('execute')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.getByText(/show raw I\/O/i)).toBeInTheDocument();
    // The raw input/output JSON is NOT in the document until toggled.
    expect(screen.queryByText('"founder@example.com"')).not.toBeInTheDocument();
  });

  it('reveals the raw input/output JSON only after toggling "show raw I/O"', () => {
    render(<AgentCard step={makeTrace()} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText(/show raw I\/O/i));
    expect(screen.getByText(/Input/)).toBeInTheDocument();
    expect(screen.getByText(/Output/)).toBeInTheDocument();
    // Raw JSON now present.
    expect(screen.getByText(/founder@example.com/)).toBeInTheDocument();
  });

  it('renders "Steps not recorded" honestly when steps is empty (reachable via expand)', () => {
    render(<AgentCard step={makeTrace({ steps: [] })} />);
    // Header honestly indicates no steps.
    expect(screen.getByText('no steps')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Steps not recorded/i)).toBeInTheDocument();
  });

  it('renders the step error badge + message when the step errored', () => {
    render(
      <AgentCard
        step={makeTrace({
          status: 'FAILED',
          steps: [
            { id: 's1', traceId: 't1', seq: 0, agentRole: 'WORKER_EMAIL', action: 'execute', input: {}, durationMs: 50, error: 'SMTP timeout', createdAt: new Date().toISOString() },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('SMTP timeout')).toBeInTheDocument();
  });
});