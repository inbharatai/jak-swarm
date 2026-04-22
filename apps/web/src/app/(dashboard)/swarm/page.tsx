'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
  Network,
  ArrowRight,
  RefreshCw,
  PauseCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { AgentCard } from '@/components/swarm/AgentCard';
import { useWorkflows } from '@/hooks/useWorkflow';
import type { Workflow, WorkflowStatus } from '@/types';
import { format, formatDistanceToNow, intervalToDuration } from 'date-fns';

function StatusIcon({ status }: { status: WorkflowStatus }) {
  switch (status) {
    case 'RUNNING':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case 'PAUSED':
      return <PauseCircle className="h-4 w-4 text-yellow-500" />;
    case 'COMPLETED':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'FAILED':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'CANCELLED':
      return <XCircle className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

const STATUS_VARIANT: Record<WorkflowStatus, 'default' | 'success' | 'destructive' | 'secondary' | 'warning' | 'outline'> = {
  PENDING:   'secondary',
  RUNNING:   'default',
  PAUSED:    'warning',
  COMPLETED: 'success',
  FAILED:    'destructive',
  CANCELLED: 'outline',
};

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  PENDING:   'Pending',
  RUNNING:   'Running',
  PAUSED:    'Awaiting Approval',
  COMPLETED: 'Completed',
  FAILED:    'Failed',
  CANCELLED: 'Cancelled',
};

function WorkflowStatusBadge({ status }: { status: WorkflowStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'secondary'} className="text-xs">
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

// Timeline bar for agent traces
function AgentTimeline({ traces }: { traces: Workflow['traces'] }) {
  if (!traces || traces.length === 0) return null;

  const withTimes = traces.filter(t => t.startedAt);
  if (withTimes.length === 0) return null;

  const minTime = Math.min(...withTimes.map(t => new Date(t.startedAt!).getTime()));
  const maxTime = Math.max(...withTimes.map(t =>
    t.completedAt ? new Date(t.completedAt).getTime() : Date.now()
  ));
  const totalDuration = maxTime - minTime || 1;

  const ROLE_COLORS: Record<string, string> = {
    COMMANDER:      'bg-purple-500',
    PLANNER:        'bg-blue-500',
    ROUTER:         'bg-cyan-500',
    GUARDRAIL:      'bg-yellow-500',
    WORKER_EMAIL:   'bg-green-500',
    WORKER_BROWSER: 'bg-indigo-500',
    WORKER_RESEARCH:'bg-teal-500',
    WORKER_DOCUMENT:'bg-orange-500',
    WORKER_SUPPORT: 'bg-pink-500',
    VERIFIER:       'bg-red-500',
    APPROVAL:       'bg-amber-500',
  };

  return (
    <div className="space-y-1">
      {withTimes.map(trace => {
        const startOffset = ((new Date(trace.startedAt!).getTime() - minTime) / totalDuration) * 100;
        const durationMs = trace.completedAt
          ? new Date(trace.completedAt).getTime() - new Date(trace.startedAt!).getTime()
          : Date.now() - new Date(trace.startedAt!).getTime();
        const widthPct = (durationMs / totalDuration) * 100;

        return (
          <div key={trace.id} className="flex items-center gap-2">
            <span className="w-32 text-xs text-muted-foreground truncate text-right shrink-0">
              {trace.agentRole}
            </span>
            <div className="flex-1 h-5 rounded bg-muted relative overflow-hidden">
              <div
                className={cn('absolute top-0 h-full rounded', ROLE_COLORS[trace.agentRole] ?? 'bg-primary')}
                style={{ left: `${startOffset}%`, width: `${Math.max(1, widthPct)}%` }}
              />
            </div>
            {durationMs > 0 && (
              <span className="text-xs text-muted-foreground w-14 shrink-0">
                {(durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WorkflowRunCard({ workflow }: { workflow: Workflow }) {
  const [expanded, setExpanded] = useState(workflow.status === 'RUNNING');
  const traces = workflow.traces ?? [];

  const duration = workflow.completedAt && workflow.startedAt
    ? intervalToDuration({ start: new Date(workflow.startedAt), end: new Date(workflow.completedAt) })
    : null;

  const durationStr = duration
    ? [duration.hours && `${duration.hours}h`, duration.minutes && `${duration.minutes}m`, `${duration.seconds ?? 0}s`]
        .filter(Boolean).join(' ')
    : null;

  return (
    <Card className={cn(
      'transition-all',
      workflow.status === 'RUNNING' && 'border-primary/50 shadow-sm shadow-primary/10',
      workflow.status === 'PAUSED' && 'border-yellow-500/40',
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-4 p-4 text-left"
      >
        <div className="shrink-0 mt-0.5">
          <StatusIcon status={workflow.status} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <WorkflowStatusBadge status={workflow.status} />
            <span className="text-xs text-muted-foreground font-mono">{workflow.id.slice(0, 8)}…</span>
            {workflow.industry && (
              <Badge variant="secondary" className="text-xs">{workflow.industry}</Badge>
            )}
            {durationStr && (
              <span className="text-xs text-muted-foreground ml-auto">{durationStr}</span>
            )}
          </div>
          <p className="text-sm font-medium line-clamp-1">{workflow.goal}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {workflow.startedAt
              ? formatDistanceToNow(new Date(workflow.startedAt), { addSuffix: true })
              : formatDistanceToNow(new Date(workflow.createdAt), { addSuffix: true })}
            {' '}· {
              // Prefer the server-populated traceCount (from list endpoint's
              // Prisma _count). Falls back to the embedded traces array
              // length for detail endpoints that ship full trace data.
              workflow.traceCount ?? traces.length
            } agent traces
          </p>
        </div>

        <div className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t">
          {/* Timeline */}
          {traces.length > 0 && (
            <div className="p-4 border-b">
              <h4 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                Agent Timeline
              </h4>
              <AgentTimeline traces={traces} />
            </div>
          )}

          {/* Agent trace cards */}
          {traces.length > 0 && (
            <div className="p-4 space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Agent Traces ({traces.length})
              </h4>
              {traces.map(trace => (
                <AgentCard
                  key={trace.id}
                  step={trace}
                  traceLink={`/traces?workflowId=${workflow.id}`}
                />
              ))}
            </div>
          )}

          {/* Error display */}
          {workflow.error && (
            <div className="mx-4 mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs font-medium text-destructive">Error</p>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{workflow.error}</p>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
            {workflow.startedAt && (
              <span>Started {format(new Date(workflow.startedAt), 'MMM d, HH:mm:ss')}</span>
            )}
            {workflow.completedAt && (
              <span>Finished {format(new Date(workflow.completedAt), 'MMM d, HH:mm:ss')}</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Link
                href={`/traces?workflowId=${workflow.id}`}
                className="text-primary hover:underline flex items-center gap-1"
              >
                View Traces <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function SwarmPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>('all');

  const statusMap = {
    all:       undefined,
    active:    ['RUNNING', 'PAUSED', 'PENDING'] as WorkflowStatus[],
    completed: ['COMPLETED'] as WorkflowStatus[],
    failed:    ['FAILED', 'CANCELLED'] as WorkflowStatus[],
  };

  const { workflows, isLoading, refresh } = useWorkflows(
    statusMap[filter] ? { status: statusMap[filter] } : {},
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" />
            Swarm Inspector
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Inspect agent runs, handoffs, tool calls, and timing
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        {(['all', 'active', 'completed', 'failed'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize',
              filter === f
                ? 'bg-background shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Workflow list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={<Network className="h-6 w-6" />}
          title="No swarm runs found"
          description={
            filter === 'active'
              ? 'No active workflows right now. Submit a goal from the Workspace.'
              : 'No workflows match the current filter.'
          }
        />
      ) : (
        <div className="space-y-4">
          {workflows.map(workflow => (
            <WorkflowRunCard key={workflow.id} workflow={workflow} />
          ))}
        </div>
      )}
    </div>
  );
}
