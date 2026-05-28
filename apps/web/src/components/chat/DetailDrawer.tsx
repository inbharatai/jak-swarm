'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { TaskList } from '@/components/workspace/TaskList';
import { WorkflowDAG } from '@/components/graph/WorkflowDAG';
import { useActiveMessages } from '@/store/conversation-store';
import type { CockpitState } from './ChatWorkspace';
import { formatCockpitCost } from '@/lib/chat-helpers';

interface DetailDrawerProps {
  onClose: () => void;
  cockpitByWorkflow: Record<string, CockpitState>;
}

export function DetailDrawer({ onClose, cockpitByWorkflow }: DetailDrawerProps) {
  const messages = useActiveMessages();
  const workflowId = [...messages].reverse().find(m => m.executionTrace?.workflowId)?.executionTrace?.workflowId;
  const cockpit = workflowId ? cockpitByWorkflow[workflowId] : undefined;
  const [showGraph, setShowGraph] = useState(false);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Agent Run Cockpit</h3>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:hidden"
          aria-label="Close drawer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {!workflowId ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Send a message to start a workflow. The plan, agents, tool calls and cost will appear here in real time.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <code className="text-[10px] text-muted-foreground">{workflowId.slice(0, 18)}...</code>
              <CockpitStatusBadge status={cockpit?.status ?? 'queued'} />
            </div>
            {cockpit && cockpit.calls > 0 && (
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {formatCockpitCost(cockpit)}
              </div>
            )}
          </div>

          {cockpit?.plan?.steps?.length ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                  Plan ({cockpit.plan.steps.length} step{cockpit.plan.steps.length === 1 ? '' : 's'})
                </span>
                <button
                  onClick={() => setShowGraph((g) => !g)}
                  className="text-[10px] text-primary hover:underline"
                >
                  {showGraph ? 'Hide DAG' : 'Show DAG'}
                </button>
              </div>
              <TaskList
                tasks={cockpit.plan.steps}
                workflowId={workflowId}
                showCompleted={cockpit.status === 'completed'}
              />
              {showGraph && (
                <div className="h-[280px] rounded-lg border border-border overflow-hidden">
                  <WorkflowDAG plan={cockpit.plan} workflowStatus={cockpit.status} />
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              Waiting for the planner to publish a plan…
            </p>
          )}

          <div className="space-y-1.5 pt-1">
            <a
              href={`/swarm?workflowId=${workflowId}`}
              className="block rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] text-primary hover:bg-muted transition-colors"
            >
              Open in Runs Inspector →
            </a>
            <a
              href={`/traces?workflowId=${workflowId}`}
              className="block rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] text-primary hover:bg-muted transition-colors"
            >
              View full agent traces →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact status badge for the cockpit header. */
function CockpitStatusBadge({ status }: { status: CockpitState['status'] }) {
  const config = {
    queued: { label: 'Queued', cls: 'bg-muted text-muted-foreground' },
    running: { label: 'Running', cls: 'bg-blue-500/10 text-blue-600' },
    paused: { label: 'Awaiting approval', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
    completed: { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-600' },
    failed: { label: 'Failed', cls: 'bg-destructive/10 text-destructive' },
  }[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${config.cls}`}>
      {config.label}
    </span>
  );
}
