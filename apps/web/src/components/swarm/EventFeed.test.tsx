import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EventFeed } from './EventFeed';
import type { WorkflowEvent } from '@/hooks/useWorkflowStream';

// EventFeed renders against the REAL backend SSE taxonomy. Verify a sample
// across every bucket + the honest empty state. No event is fabricated.

describe('EventFeed', () => {
  it('shows the honest waiting state when there are no events', () => {
    render(<EventFeed events={[]} />);
    expect(screen.getByText(/Waiting for events/)).toBeInTheDocument();
  });

  it('renders each real event type with its label + count', () => {
    const events: WorkflowEvent[] = [
      { type: 'created', timestamp: '2026-07-05T10:00:00.000Z' },
      { type: 'planned', timestamp: '2026-07-05T10:00:01.000Z' },
      { type: 'step_started', timestamp: '2026-07-05T10:00:02.000Z', agentRole: 'WORKER_EMAIL' },
      { type: 'step_completed', timestamp: '2026-07-05T10:00:03.000Z' },
      { type: 'approval_required', timestamp: '2026-07-05T10:00:04.000Z' },
      { type: 'completed', timestamp: '2026-07-05T10:00:05.000Z', status: 'COMPLETED' },
    ];
    render(<EventFeed events={events} />);
    expect(screen.getByText('Workflow created')).toBeInTheDocument();
    expect(screen.getByText('Plan created')).toBeInTheDocument();
    expect(screen.getByText('Step started')).toBeInTheDocument();
    expect(screen.getByText('Step completed')).toBeInTheDocument();
    expect(screen.getByText('Approval required')).toBeInTheDocument();
    expect(screen.getByText('Run completed')).toBeInTheDocument();
    // count chip = 6
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('renders an unknown event type honestly (neutral row, not dropped)', () => {
    render(<EventFeed events={[{ type: 'something_new', timestamp: '2026-07-05T10:00:00.000Z' }]} />);
    // unknown types fall through with the raw type as the label
    expect(screen.getByText('something_new')).toBeInTheDocument();
  });

  it('surfaces the error message on a failed event', () => {
    render(
      <EventFeed
        events={[{ type: 'failed', timestamp: '2026-07-05T10:00:00.000Z', error: 'provider 503' }]}
      />,
    );
    expect(screen.getByText('provider 503')).toBeInTheDocument();
  });
});