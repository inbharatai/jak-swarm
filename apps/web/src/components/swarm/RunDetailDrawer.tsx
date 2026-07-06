'use client';

// ─── JARVIS Inspector — run detail drawer (tabbed) ───────────────────────────
//
// The center panel: a tabbed command readout for the selected run.
//   • DAG   — LiveDAG (code-split @xyflow/react) from planJson.
//   • Gantt — LiveGantt from persisted + live traces.
//   • Cost  — CostTokenGauges (timeline endpoint) + ToolCallStream.
// The live Event Feed + Approval Gate live in the always-on right rail (see
// SwarmInspector) — the JARVIS "right feed" — so they're not duplicated here.
// TabsContent returns null for inactive tabs, so the heavy DAG chunk only
// mounts when its tab is opened.

import { cn } from '@/lib/cn';
import { Badge, Spinner } from '@/components/ui';
import type { Workflow, AgentTraceRecord } from '@/types';
import type { WorkflowPlan } from '@/types';
import type { WorkflowTimeline } from '@/lib/api-client';
import { LiveDAG } from './LiveDAG';
import { LiveGantt } from './LiveGantt';
import { CostTokenGauges } from './CostTokenGauges';
import { ToolCallStream } from './ToolCallStream';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui';

const STATUS_VARIANT: Record<string, string> = {
  PENDING: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  RUNNING: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  PAUSED: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  FAILED: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  CANCELLED: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};

interface Props {
  workflow: Workflow | null;
  isLoading: boolean;
  plan: WorkflowPlan | null;
  timeline: WorkflowTimeline | null;
  traces: AgentTraceRecord[];
}

function EmptyDrawer() {
  return (
    <div className="jarvis-panel flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="jarvis-readout text-sm text-muted-foreground">
        Select a run from the rail
      </p>
      <p className="jarvis-readout text-[10px] text-muted-foreground">
        Live DAG · Gantt · cost &amp; tokens
      </p>
    </div>
  );
}

export function RunDetailDrawer({
  workflow,
  isLoading,
  plan,
  timeline,
  traces,
}: Props) {
  if (!workflow) return <EmptyDrawer />;
  if (isLoading) {
    return (
      <div className="jarvis-panel flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const statusBadge = STATUS_VARIANT[workflow.status] ?? STATUS_VARIANT.PENDING!;

  return (
    <div className="jarvis-panel flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase',
              statusBadge,
            )}
          >
            {workflow.status === 'RUNNING' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 jarvis-pulse" />}
            {workflow.status === 'PAUSED' && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 jarvis-pulse" />}
            {workflow.status}
          </span>
          <span className="jarvis-readout text-[10px] text-muted-foreground">{workflow.id}</span>
          {workflow.industry && (
            <Badge variant="secondary" className="text-[9px]">{workflow.industry}</Badge>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-sm font-medium text-foreground">{workflow.goal}</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="dag" className="flex min-h-0 flex-1 flex-col p-2">
        <TabsList className="bg-white/5">
          <TabsTrigger value="dag" className="data-[state=active]:bg-emerald-400/15 data-[state=active]:text-emerald-200 text-[11px]">DAG</TabsTrigger>
          <TabsTrigger value="gantt" className="data-[state=active]:bg-emerald-400/15 data-[state=active]:text-emerald-200 text-[11px]">Gantt</TabsTrigger>
          <TabsTrigger value="cost" className="data-[state=active]:bg-emerald-400/15 data-[state=active]:text-emerald-200 text-[11px]">Cost</TabsTrigger>
        </TabsList>

        <TabsContent value="dag" className="min-h-0 flex-1">
          <div className="h-full min-h-[300px]">
            <LiveDAG plan={plan ?? undefined} workflowStatus={workflow.status} />
          </div>
        </TabsContent>

        <TabsContent value="gantt" className="min-h-0 flex-1">
          <div className="h-full min-h-[300px]">
            <LiveGantt traces={traces} />
          </div>
        </TabsContent>

        <TabsContent value="cost" className="min-h-0 flex-1">
          <div className="grid h-full min-h-[300px] grid-cols-1 gap-2 lg:grid-cols-2">
            <CostTokenGauges timeline={timeline} />
            <ToolCallStream traces={traces} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}