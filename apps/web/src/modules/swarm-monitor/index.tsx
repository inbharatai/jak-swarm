'use client';

import React, { useState } from 'react';
import {
  CheckCircle2, XCircle, Clock, Loader2, ChevronDown, ChevronRight,
  Network, RefreshCw, PauseCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { useWorkflows } from '@/hooks/useWorkflow';
import { eventBus, SHELL_EVENTS } from '@/lib/event-bus';
import type { WorkflowStatus } from '@/types';
import type { ModuleProps } from '@/modules/registry';
import { formatDistanceToNow } from 'date-fns';

function StatusIcon({ status }: { status: WorkflowStatus }) {
  switch (status) {
    case 'RUNNING': return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case 'PAUSED': return <PauseCircle className="h-4 w-4 text-yellow-500" />;
    case 'COMPLETED': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'FAILED': return <XCircle className="h-4 w-4 text-destructive" />;
    case 'CANCELLED': return <XCircle className="h-4 w-4 text-muted-foreground" />;
    default: return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

const STATUS_VARIANT: Record<WorkflowStatus, 'default' | 'success' | 'destructive' | 'secondary' | 'warning' | 'outline'> = {
  PENDING: 'secondary', RUNNING: 'default', PAUSED: 'warning',
  COMPLETED: 'success', FAILED: 'destructive', CANCELLED: 'outline',
};

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  PENDING: 'Pending', RUNNING: 'Running', PAUSED: 'Awaiting Approval',
  COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled',
};

export default function SwarmMonitorModule({ moduleId, isActive }: ModuleProps) {
  const { workflows, isLoading, refresh } = useWorkflows();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'ALL'>('ALL');

  // Listen for workflow events from other modules
  React.useEffect(() => {
    const sub = eventBus.on(SHELL_EVENTS.WORKFLOW_STARTED, () => { refresh(); });
    return () => sub.unsubscribe();
  }, [refresh]);

  const filteredWorkflows = statusFilter === 'ALL'
    ? workflows
    : workflows.filter(w => w.status === statusFilter);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>;
  }

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" />
            Swarm Monitor
          </h2>
          <p className="text-xs text-muted-foreground">{workflows.length} workflows tracked</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as WorkflowStatus | 'ALL')}
            className="text-xs rounded-md border px-2 py-1.5 bg-background"
          >
            <option value="ALL">All Status</option>
            {Object.entries(STATUS_LABEL).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => refresh()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {filteredWorkflows.length === 0 ? (
        <EmptyState icon={<Network className="h-12 w-12" />} title="No workflows" description="Workflows will appear here when they run." />
      ) : (
        <div className="space-y-3">
          {filteredWorkflows.map(wf => (
            <Card key={wf.id} className={cn(
              'transition-all',
              wf.status === 'RUNNING' && 'border-primary/50 shadow-sm shadow-primary/10',
            )}>
              <button
                onClick={() => setExpandedId(expandedId === wf.id ? null : wf.id)}
                className="flex w-full items-center gap-4 p-4 text-left"
              >
                <StatusIcon status={wf.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{wf.goal}</p>
                  <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(wf.createdAt), { addSuffix: true })}</p>
                </div>
                <Badge variant={STATUS_VARIANT[wf.status]} className="text-xs">{STATUS_LABEL[wf.status]}</Badge>
                {expandedId === wf.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {expandedId === wf.id && wf.traces && (
                <CardContent className="pt-0 pb-4 space-y-2">
                  {wf.traces.map(trace => (
                    <div key={trace.id} className="flex items-center gap-2 text-xs">
                      <span className="w-28 truncate text-muted-foreground">{trace.agentRole}</span>
                      <span className={cn('flex-1 truncate', trace.error ? 'text-destructive' : 'text-foreground')}>{trace.error || trace.output?.slice(0, 80) || '—'}</span>
                      {trace.durationMs && <span className="text-muted-foreground">{(trace.durationMs / 1000).toFixed(1)}s</span>}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
