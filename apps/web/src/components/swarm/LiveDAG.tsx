'use client';

// ─── JARVIS Inspector — live DAG (code-split) ────────────────────────────────
//
// next/dynamic wraps WorkflowDAG so @xyflow/react + dagre (+ its CSS) only
// load when the inspector drawer's DAG tab is opened — keeping the /swarm
// entry chunk free of the graph renderer. Fed by the workflow's planJson
// (replayed as plan_created on SSE reconnect) + live step status from the
// stream. Neon glowing edges are applied by the .jarvis-surface CSS scope
// on the SVG edges WorkflowDAG renders.

import dynamic from 'next/dynamic';
import type { WorkflowPlan } from '@/types';

const WorkflowDAG = dynamic(() => import('@/components/graph/WorkflowDAG').then((m) => m.WorkflowDAG), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground jarvis-readout">
      Loading graph<span className="jarvis-pulse">…</span>
    </div>
  ),
});

export function LiveDAG({
  plan,
  workflowStatus,
  onNodeClick,
}: {
  plan?: WorkflowPlan;
  workflowStatus?: string;
  onNodeClick?: (stepId: string) => void;
}) {
  if (!plan || !plan.steps || plan.steps.length === 0) {
    return (
      <div className="jarvis-panel flex h-full flex-col p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Plan DAG
        </h4>
        <div className="flex flex-1 items-center justify-center py-8 text-center">
          <p className="jarvis-readout text-xs text-muted-foreground">
            No plan yet — waiting for planner<span className="jarvis-pulse">…</span>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="jarvis-panel h-full p-2">
      <WorkflowDAG plan={plan} workflowStatus={workflowStatus} onNodeClick={onNodeClick} className="h-full" />
    </div>
  );
}