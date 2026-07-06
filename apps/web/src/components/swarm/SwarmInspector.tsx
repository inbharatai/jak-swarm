'use client';

// ─── JARVIS Swarm Inspector — top-level command surface ──────────────────────
//
// Three-column JARVIS layout (dark-only via JarvisTheme):
//   ┌────────────── KpiBar (honest live readouts, 15s poll) ──────────────┐
//   │ RunRail │  RunDetailDrawer (DAG · Gantt · Cost & Tokens)            │
//   │ (left)  │  (center, tabbed — @xyflow/react code-split on DAG tab)   │
//   │         │  ┌──────── right rail ────────┐                          │
//   │         │  │ EventFeed (live SSE)       │                          │
//   │         │  │ ApprovalGateState          │                          │
//   │         │  └────────────────────────────┘                          │
//   └────────────────────────────────────────────────────────────────────-┘
//
// SSE fan-out is capped: SwarmInspector opens ONE stream for the selected
// run only. Non-selected runs refresh via RunRail's 5s useWorkflows poll.
// `paused` is derived from the persisted workflow status (source of truth),
// not from a heuristic over the event stream.

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { dataFetcher } from '@/lib/api-client';
import type { ApprovalRequest } from '@/types';
import { useWorkflow, useWorkflowTraces, useWorkflowTimeline } from '@/hooks/useWorkflow';
import { useWorkflowStream } from '@/hooks/useWorkflowStream';
import { JarvisTheme } from './JarvisTheme';
import { KpiBar } from './KpiBar';
import { RunRail } from './RunRail';
import { RunDetailDrawer } from './RunDetailDrawer';
import { EventFeed } from './EventFeed';
import { ApprovalGateState } from './ApprovalGateState';
import type { WorkflowPlan } from '@/types';

export function SwarmInspector() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { workflow, isLoading } = useWorkflow(selectedId, {
    // SSE drives live updates for the selected run; stop SWR polling.
    disablePolling: true,
  });

  const { events } = useWorkflowStream(selectedId);
  const isRunning = workflow ? !['COMPLETED', 'FAILED', 'CANCELLED'].includes(workflow.status) : false;
  const { traces } = useWorkflowTraces(selectedId, isRunning);
  const { timeline } = useWorkflowTimeline(selectedId);

  // Approvals for the selected run only. useSWR so a null selectedId skips.
  const { data: approvalsData } = useSWR<ApprovalRequest[]>(
    selectedId ? `/workflows/${selectedId}/approvals` : null,
    dataFetcher,
    { refreshInterval: 5_000, revalidateOnFocus: false },
  );
  const approvals = approvalsData ?? [];

  // Derive the plan from the SSE stream. `plan_created` (replay) carries
  // `event.plan` directly; the live `planned` event carries it under
  // `event.data.planJson`. Prefer the most recent one seen. Never fabricated.
  const plan = useMemo<WorkflowPlan | null>(() => {
    let found: WorkflowPlan | null = null;
    for (const ev of events) {
      if (ev.type === 'plan_created' && ev.plan) found = ev.plan;
      else if (ev.type === 'planned' && ev.data?.planJson) found = ev.data.planJson;
    }
    return found;
  }, [events]);

  const paused = workflow?.status === 'PAUSED';

  return (
    <JarvisTheme>
      <div className="flex h-[calc(100vh-7rem)] min-h-[600px] flex-col gap-3">
        {/* Top: KPI bar */}
        <KpiBar />

        {/* Body: 3 columns */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
          {/* Left rail — virtualized run list */}
          <div className="min-h-0">
            <RunRail selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          {/* Center — tabbed detail drawer */}
          <div className="min-h-0">
            <RunDetailDrawer
              workflow={workflow ?? null}
              isLoading={isLoading}
              plan={plan}
              timeline={timeline}
              traces={traces}
            />
          </div>

          {/* Right rail — always-on event feed + approval gate */}
          <div className="hidden min-h-0 flex-col gap-3 lg:flex">
            <div className="min-h-0 flex-1">
              <EventFeed events={events} />
            </div>
            <div className="min-h-0 flex-1">
              <ApprovalGateState approvals={approvals} paused={paused} />
            </div>
          </div>
        </div>
      </div>
    </JarvisTheme>
  );
}