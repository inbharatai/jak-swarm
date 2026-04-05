'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui';
import type { WorkflowPlanStep, TaskStatus, AgentRole } from '@/types';
import { formatDistanceToNow, intervalToDuration } from 'date-fns';
import { workflowApi } from '@/lib/api-client';

const AGENT_ROLE_EMOJIS: Record<AgentRole, string> = {
  COMMANDER:          '🎯',
  PLANNER:            '📋',
  ROUTER:             '🔀',
  VERIFIER:           '✅',
  GUARDRAIL:          '🛡️',
  APPROVAL:           '🔏',
  WORKER_EMAIL:       '📧',
  WORKER_CALENDAR:    '📅',
  WORKER_CRM:         '👥',
  WORKER_DOCUMENT:    '📄',
  WORKER_SPREADSHEET: '📊',
  WORKER_BROWSER:     '🌐',
  WORKER_RESEARCH:    '🔍',
  WORKER_KNOWLEDGE:   '🧠',
  WORKER_SUPPORT:     '🎧',
  WORKER_OPS:         '⚙️',
  WORKER_VOICE:       '🎤',
  WORKER_CODER:       '💻',
  WORKER_DESIGNER:    '🎨',
  WORKER_STRATEGIST:  '♟️',
  WORKER_MARKETING:   '📣',
  WORKER_TECHNICAL:   '🏗️',
  WORKER_FINANCE:     '💰',
  WORKER_HR:          '👔',
  WORKER_GROWTH:      '🚀',
};

function StatusBadge({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'IN_PROGRESS':
      return <Badge variant="default" className="text-[10px]">Running</Badge>;
    case 'COMPLETED':
      return <Badge variant="success" className="text-[10px]">Done</Badge>;
    case 'FAILED':
      return <Badge variant="destructive" className="text-[10px]">Failed</Badge>;
    case 'AWAITING_APPROVAL':
      return <Badge variant="warning" className="text-[10px]">Awaiting Approval</Badge>;
    case 'PENDING':
      return <Badge variant="secondary" className="text-[10px]">Pending</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  }
}

function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'IN_PROGRESS':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case 'COMPLETED':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'FAILED':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'AWAITING_APPROVAL':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function ElapsedTime({ startedAt, status }: { startedAt?: string; status: TaskStatus }) {
  const [, forceUpdate] = React.useState(0);

  React.useEffect(() => {
    if (status !== 'IN_PROGRESS' || !startedAt) return;
    const interval = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, [status, startedAt]);

  if (!startedAt) return null;

  const duration = intervalToDuration({
    start: new Date(startedAt),
    end: new Date(),
  });

  const parts: string[] = [];
  if (duration.hours) parts.push(`${duration.hours}h`);
  if (duration.minutes) parts.push(`${duration.minutes}m`);
  parts.push(`${duration.seconds ?? 0}s`);

  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {parts.join(' ')}
    </span>
  );
}

interface TaskItemProps {
  task: WorkflowPlanStep;
  workflowId?: string;
  onStop?: () => void;
}

function TaskItem({ task, workflowId, onStop }: TaskItemProps) {
  const [expanded, setExpanded] = useState(false);
  const emoji = AGENT_ROLE_EMOJIS[task.agentRole] ?? '🤖';
  const isActive = task.status === 'IN_PROGRESS' || task.status === 'AWAITING_APPROVAL';

  return (
    <div className={cn(
      'rounded-lg border transition-all',
      isActive && 'border-primary/40 bg-primary/5',
      task.status === 'FAILED' && 'border-destructive/40 bg-destructive/5',
    )}>
      <div className="flex items-start gap-3 p-3">
        {/* Status icon */}
        <div className="shrink-0 mt-0.5">
          <StatusIcon status={task.status} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <span className="text-sm font-medium">
              {emoji} {task.agentRole}
            </span>
            <StatusBadge status={task.status} />
            {task.startedAt && (
              <ElapsedTime startedAt={task.startedAt} status={task.status} />
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate">{task.taskName}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isActive && onStop && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onStop}
              title="Request stop"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          )}
          {task.toolCalls && task.toolCalls.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Tool calls expansion */}
      {expanded && task.toolCalls && task.toolCalls.length > 0 && (
        <div className="border-t px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Tool Calls ({task.toolCalls.length})
          </p>
          <div className="space-y-1.5">
            {task.toolCalls.map(tc => (
              <div key={tc.id} className="flex items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs">
                <code className="font-medium">{tc.toolName}</code>
                {tc.durationMs && (
                  <span className="text-muted-foreground">{tc.durationMs}ms</span>
                )}
                <span className="ml-auto">
                  {tc.error ? (
                    <XCircle className="h-3 w-3 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {task.errorMessage && (
        <div className="border-t px-4 py-2">
          <p className="text-xs text-destructive">{task.errorMessage}</p>
        </div>
      )}
    </div>
  );
}

interface TaskListProps {
  tasks: WorkflowPlanStep[];
  workflowId?: string;
  isLoading?: boolean;
  showCompleted?: boolean;
  className?: string;
}

export function TaskList({
  tasks,
  workflowId,
  isLoading,
  showCompleted = false,
  className,
}: TaskListProps) {
  const [showingCompleted, setShowingCompleted] = useState(showCompleted);

  const activeTasks = tasks.filter(t =>
    t.status === 'IN_PROGRESS' || t.status === 'AWAITING_APPROVAL' || t.status === 'PENDING',
  );
  const completedTasks = tasks.filter(t =>
    t.status === 'COMPLETED' || t.status === 'FAILED' || t.status === 'SKIPPED',
  );

  const handleStopTask = async (task: WorkflowPlanStep) => {
    if (!workflowId) return;
    if (!confirm(`Stop task "${task.taskName}"?`)) return;
    try {
      await workflowApi.stop(workflowId);
    } catch {
      // ignore
    }
  };

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Spinner />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="h-5 w-5" />}
        title="No tasks running"
        description="Tasks will appear here when a workflow is active"
        className={className}
      />
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Active tasks */}
      {activeTasks.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="text-xs font-medium text-muted-foreground">
              Active ({activeTasks.length})
            </span>
          </div>
          {activeTasks.map(task => (
            <TaskItem
              key={task.id}
              task={task}
              workflowId={workflowId}
              onStop={() => handleStopTask(task)}
            />
          ))}
        </div>
      )}

      {/* Completed tasks toggle */}
      {completedTasks.length > 0 && (
        <div>
          <button
            onClick={() => setShowingCompleted(!showingCompleted)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            {showingCompleted ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Completed ({completedTasks.length})
          </button>

          {showingCompleted && (
            <div className="space-y-2 mt-2">
              {completedTasks.map(task => (
                <TaskItem key={task.id} task={task} workflowId={workflowId} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
