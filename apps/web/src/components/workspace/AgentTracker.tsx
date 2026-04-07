'use client';

import React from 'react';
import { useWorkflowStream, type WorkflowEvent } from '@/hooks/useWorkflowStream';
import { cn } from '@/lib/cn';

const ROLE_EMOJIS: Record<string, string> = {
  COMMANDER: '\u{1F3AF}', PLANNER: '\u{1F4CB}', ROUTER: '\u{1F500}', VERIFIER: '\u2705', GUARDRAIL: '\u{1F6E1}\uFE0F',
  WORKER_EMAIL: '\u{1F4E7}', WORKER_CALENDAR: '\u{1F4C5}', WORKER_CRM: '\u{1F464}', WORKER_DOCUMENT: '\u{1F4C4}',
  WORKER_RESEARCH: '\u{1F50D}', WORKER_CODER: '\u{1F4BB}', WORKER_CONTENT: '\u270F\uFE0F', WORKER_SEO: '\u{1F4C8}',
  WORKER_PR: '\u{1F4F0}', WORKER_LEGAL: '\u2696\uFE0F', WORKER_FINANCE: '\u{1F4B0}', WORKER_HR: '\u{1F454}',
  WORKER_MARKETING: '\u{1F4E3}', WORKER_ANALYTICS: '\u{1F4C9}', WORKER_PRODUCT: '\u{1F5FA}\uFE0F',
  WORKER_PROJECT: '\u{1F4CC}', WORKER_GROWTH: '\u{1F680}', WORKER_STRATEGIST: '\u{1F3AF}',
  WORKER_TECHNICAL: '\u{1F3D7}\uFE0F', WORKER_DESIGNER: '\u{1F3A8}', WORKER_SUPPORT: '\u{1F3A7}',
  WORKER_BROWSER: '\u{1F310}', WORKER_SPREADSHEET: '\u{1F4CA}', WORKER_KNOWLEDGE: '\u{1F9E0}',
  WORKER_OPS: '\u2699\uFE0F', WORKER_VOICE: '\u{1F3A4}', WORKER_SUCCESS: '\u{1F91D}',
  WORKER_APP_ARCHITECT: '\u{1F3DB}\uFE0F', WORKER_APP_GENERATOR: '\u26A1', WORKER_APP_DEBUGGER: '\u{1F527}',
  WORKER_APP_DEPLOYER: '\u{1F680}', WORKER_SCREENSHOT_TO_CODE: '\u{1F4F8}',
};

function formatRole(role: string): string {
  return (role ?? '').replace('WORKER_', '').replace(/_/g, ' ');
}

// Extended event with optional agent telemetry fields
type AgentEvent = WorkflowEvent & {
  agentRole?: string;
  taskName?: string;
  node?: string;
  success?: boolean;
  durationMs?: number;
  toolCalls?: number;
};

interface AgentTrackerProps {
  workflowId: string | null;
  className?: string;
}

export function AgentTracker({ workflowId, className }: AgentTrackerProps) {
  const { events, isConnected } = useWorkflowStream(workflowId);

  // Filter relevant events
  const agentEvents = (events as AgentEvent[]).filter((e) =>
    e.type === 'agent_activity' || e.type === 'node_enter' || e.type === 'node_exit' ||
    e.type === 'worker_started' || e.type === 'worker_completed'
  );

  const latestAgent = agentEvents.filter((e) =>
    e.type === 'worker_started' || e.type === 'agent_activity'
  ).pop();

  const completedCount = agentEvents.filter((e) =>
    e.type === 'worker_completed' || (e.type === 'node_exit' && e.node !== 'commander' && e.node !== 'planner' && e.node !== 'router')
  ).length;

  if (!workflowId || agentEvents.length === 0) return null;

  return (
    <div className={cn('rounded-lg border bg-card p-3 space-y-2', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent Activity</span>
          {isConnected && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] text-green-600">Live</span>
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{completedCount} completed</span>
      </div>

      {/* Current agent */}
      {latestAgent?.agentRole && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/20">
          <span className="text-lg">{ROLE_EMOJIS[latestAgent.agentRole] ?? '\u{1F916}'}</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-primary">{formatRole(latestAgent.agentRole)}</p>
            <p className="text-[10px] text-muted-foreground truncate">{latestAgent.taskName ?? 'Working...'}</p>
          </div>
          {latestAgent.type === 'worker_started' && (
            <span className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      )}

      {/* Event timeline */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {agentEvents.slice(-10).reverse().map((event, i) => {
          const role = event.agentRole || event.node;
          const roleKey = role?.toUpperCase?.() ?? '';
          const emoji = ROLE_EMOJIS[roleKey] ?? (role ? '\u26A1' : '');
          const isCompleted = event.type === 'worker_completed' || event.type === 'node_exit';
          const isFailed = event.success === false;
          const duration = event.durationMs;

          return (
            <div key={i} className={cn(
              'flex items-center gap-2 text-[10px] py-0.5',
              isFailed && 'text-destructive',
              isCompleted && !isFailed && 'text-muted-foreground',
            )}>
              <span className="w-4 text-center">{emoji}</span>
              <span className="flex-1 truncate">
                {formatRole(role ?? '')}
                {event.taskName ? ` \u2014 ${event.taskName}` : ''}
              </span>
              {duration != null && (
                <span className="tabular-nums shrink-0">{(duration / 1000).toFixed(1)}s</span>
              )}
              {event.toolCalls != null && event.toolCalls > 0 && (
                <span className="shrink-0">{'\u{1F527}'}{event.toolCalls}</span>
              )}
              {isCompleted && !isFailed && <span className="shrink-0">{'\u2713'}</span>}
              {isFailed && <span className="shrink-0">{'\u2717'}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
