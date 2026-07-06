import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase C — honest analytics chart tests. Each chart must render its honest
// "No data" empty state when the tenant has no rows (never a faked 100% or
// sample series), and render real rows when data is present. recharts is
// stubbed to trivial divs so we test the data→DOM wiring, not SVG layout.

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="rc-container">{children}</div>,
  BarChart: ({ data }: { data: unknown }) => <div data-testid="rc-bar">{JSON.stringify(data)}</div>,
  Bar: () => <div data-testid="rc-bar-el" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
  Cell: () => <div />,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ data }: { data: unknown }) => <div data-testid="rc-pie">{JSON.stringify(data)}</div>,
}));

// vi.hoisted so the mock objects exist before vi.mock factories are evaluated
// (vi.mock is hoisted above imports; a plain const would be in the TDZ).
const { useSwrMock, analyticsApiMock } = vi.hoisted(() => ({
  useSwrMock: vi.fn(),
  analyticsApiMock: {
    tools: vi.fn(),
    routing: vi.fn(),
    approvalDecisions: vi.fn(),
    intents: vi.fn(),
    latency: vi.fn(),
  },
}));

vi.mock('swr', () => ({
  default: (...args: unknown[]) => useSwrMock(...args),
}));

vi.mock('@/lib/api-client', () => ({
  analyticsApi: analyticsApiMock,
}));

import HonestAnalyticsCharts from './HonestAnalyticsCharts';

beforeEach(() => {
  useSwrMock.mockReset();
  Object.values(analyticsApiMock).forEach((m) => m.mockReset());
  // Default: every SWR returns no data yet → "Loading…"
  useSwrMock.mockReturnValue({ data: undefined, error: undefined });
});

// Map the SWR key arg to a chart so tests can drive one chart at a time.
// The component calls useSWR(key, fetcher). We intercept on the key.
function drive(key: string, data: unknown, error?: unknown) {
  useSwrMock.mockImplementation((k: string) => {
    if (k === key) return { data, error };
    return { data: undefined, error: undefined };
  });
}

describe('HonestAnalyticsCharts — honest empty states + real data', () => {
  it('renders the Tools "No tool calls yet" empty state when tools list is empty', () => {
    drive('analytics/tools', { totalToolCalls: 0, tools: [], tracesExamined: 0, tracesWithoutTools: 0, tenantId: 't', period: { from: '', to: '' } });
    render(<HonestAnalyticsCharts />);
    expect(screen.getByText('No tool calls yet')).toBeInTheDocument();
  });

  it('renders real tool rows when tools data is present', () => {
    drive('analytics/tools', {
      totalToolCalls: 2,
      tracesExamined: 1,
      tracesWithoutTools: 0,
      tenantId: 't',
      period: { from: '', to: '' },
      tools: [
        { toolName: 'send_email', count: 2, successCount: 1, failCount: 1, successRate: 0.5, avgDurationMs: 150, p50DurationMs: 150, p95DurationMs: 200 },
      ],
    });
    render(<HonestAnalyticsCharts />);
    expect(screen.getByText(/Tool Success & Duration/)).toBeInTheDocument();
    // Should NOT render the empty-state copy when there is data.
    expect(screen.queryByText('No tool calls yet')).not.toBeInTheDocument();
  });

  it('renders the Approvals "No approvals yet" empty state when total is 0', () => {
    drive('analytics/approvals', { total: 0, totals: {}, byAgentRole: {}, byRiskLevel: {}, autoApproved: 0, humanApproved: 0, autoApprovalRate: 0, tenantId: 't', period: { from: '', to: '' } });
    render(<HonestAnalyticsCharts />);
    expect(screen.getByText('No approvals yet')).toBeInTheDocument();
  });

  it('renders the Routing admin-only banner when the endpoint 403s', () => {
    drive('analytics/routing', undefined, { status: 403, message: 'forbidden', code: 'FORBIDDEN' });
    render(<HonestAnalyticsCharts />);
    expect(screen.getByText(/Admin only/)).toBeInTheDocument();
  });

  it('renders the Routing "No routing decisions yet" empty state when total is 0', () => {
    drive('analytics/routing', { total: 0, fallbackRate: 0, avgScore: 0, byModel: {}, byProvider: {}, byTaskType: {}, topReasons: [], tenantScoped: false, period: { from: '', to: '' } });
    render(<HonestAnalyticsCharts />);
    expect(screen.getByText('No routing decisions yet')).toBeInTheDocument();
  });

  it('renders the Intents "No intents classified yet" empty state when total is 0', () => {
    drive('analytics/intents', { total: 0, clarificationRate: 0, intents: [], urgencyDistribution: {}, topRiskIndicators: [], tenantId: 't', period: { from: '', to: '' } });
    render(<HonestAnalyticsCharts />);
    expect(screen.getByText('No intents classified yet')).toBeInTheDocument();
  });

  it('renders the Latency "No latency samples yet" empty state when samples is 0', () => {
    drive('analytics/latency', { samples: 0, avgMs: 0, p50Ms: 0, p90Ms: 0, p95Ms: 0, p99Ms: 0, byProvider: [], tenantId: 't', period: { from: '', to: '' } });
    render(<HonestAnalyticsCharts />);
    expect(screen.getByText('No latency samples yet')).toBeInTheDocument();
  });

  it('renders real latency percentiles when samples exist', () => {
    drive('analytics/latency', { samples: 6, avgMs: 100, p50Ms: 30, p90Ms: 500, p95Ms: 500, p99Ms: 500, byProvider: [], tenantId: 't', period: { from: '', to: '' } });
    render(<HonestAnalyticsCharts />);
    expect(screen.getByText(/6 samples/)).toBeInTheDocument();
    expect(screen.queryByText('No latency samples yet')).not.toBeInTheDocument();
  });

  it('renders a failed-to-load message on a non-403 routing error', () => {
    drive('analytics/routing', undefined, new Error('network'));
    render(<HonestAnalyticsCharts />);
    expect(screen.getByText('Failed to load routing analytics')).toBeInTheDocument();
  });
});