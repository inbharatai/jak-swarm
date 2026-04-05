'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Spinner, EmptyState } from '@/components/ui';
import type { WorkflowPlan, WorkflowPlanStep, AgentRole, RiskLevel, TaskStatus } from '@/types';
import { formatDistanceToNow } from 'date-fns';

const AGENT_COLORS: Record<AgentRole, string> = {
  COMMANDER:          'bg-purple-500/10 text-purple-600 border-purple-200 dark:text-purple-400',
  PLANNER:            'bg-blue-500/10 text-blue-600 border-blue-200 dark:text-blue-400',
  ROUTER:             'bg-cyan-500/10 text-cyan-600 border-cyan-200 dark:text-cyan-400',
  VERIFIER:           'bg-green-500/10 text-green-600 border-green-200 dark:text-green-400',
  GUARDRAIL:          'bg-yellow-500/10 text-yellow-600 border-yellow-200 dark:text-yellow-400',
  APPROVAL:           'bg-amber-500/10 text-amber-600 border-amber-200 dark:text-amber-400',
  WORKER_EMAIL:       'bg-pink-500/10 text-pink-600 border-pink-200 dark:text-pink-400',
  WORKER_CALENDAR:    'bg-rose-500/10 text-rose-600 border-rose-200 dark:text-rose-400',
  WORKER_CRM:         'bg-orange-500/10 text-orange-600 border-orange-200 dark:text-orange-400',
  WORKER_DOCUMENT:    'bg-indigo-500/10 text-indigo-600 border-indigo-200 dark:text-indigo-400',
  WORKER_SPREADSHEET: 'bg-teal-500/10 text-teal-600 border-teal-200 dark:text-teal-400',
  WORKER_BROWSER:     'bg-sky-500/10 text-sky-600 border-sky-200 dark:text-sky-400',
  WORKER_RESEARCH:    'bg-violet-500/10 text-violet-600 border-violet-200 dark:text-violet-400',
  WORKER_KNOWLEDGE:   'bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:text-emerald-400',
  WORKER_SUPPORT:     'bg-lime-500/10 text-lime-600 border-lime-200 dark:text-lime-400',
  WORKER_OPS:         'bg-gray-500/10 text-gray-600 border-gray-200 dark:text-gray-400',
  WORKER_VOICE:       'bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-200 dark:text-fuchsia-400',
  WORKER_CODER:       'bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-300',
  WORKER_DESIGNER:    'bg-pink-500/10 text-pink-700 border-pink-300 dark:text-pink-300',
  WORKER_STRATEGIST:  'bg-slate-500/10 text-slate-700 border-slate-300 dark:text-slate-300',
  WORKER_MARKETING:   'bg-red-500/10 text-red-600 border-red-200 dark:text-red-400',
  WORKER_TECHNICAL:   'bg-cyan-500/10 text-cyan-700 border-cyan-300 dark:text-cyan-300',
  WORKER_FINANCE:     'bg-green-500/10 text-green-700 border-green-300 dark:text-green-300',
  WORKER_HR:          'bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-300',
  WORKER_GROWTH:      'bg-orange-500/10 text-orange-700 border-orange-300 dark:text-orange-300',
};

const RISK_VARIANTS: Record<RiskLevel, 'success' | 'warning' | 'destructive' | 'default'> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'destructive',
  CRITICAL: 'destructive',
};

function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'FAILED':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'IN_PROGRESS':
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case 'AWAITING_APPROVAL':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case 'PENDING':
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case 'SKIPPED':
      return <Clock className="h-4 w-4 text-muted-foreground opacity-50" />;
    default:
      return null;
  }
}

function statusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    PENDING:           'Pending',
    IN_PROGRESS:       'Running',
    AWAITING_APPROVAL: 'Awaiting Approval',
    COMPLETED:         'Completed',
    FAILED:            'Failed',
    SKIPPED:           'Skipped',
  };
  return labels[status] ?? status;
}

interface PlanStepRowProps {
  step: WorkflowPlanStep;
  index: number;
  isLast: boolean;
}

function PlanStepRow({ step, index, isLast }: PlanStepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const agentColor = AGENT_COLORS[step.agentRole] ?? 'bg-muted text-foreground';

  return (
    <div className="relative">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-5 top-10 bottom-0 w-px bg-border" />
      )}

      <div className={cn(
        'relative z-10 rounded-lg border bg-card transition-all',
        step.status === 'IN_PROGRESS' && 'border-primary/50 shadow-sm shadow-primary/10',
        step.status === 'FAILED' && 'border-destructive/50',
        step.status === 'AWAITING_APPROVAL' && 'border-yellow-500/50',
      )}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-start gap-3 p-3 text-left"
        >
          {/* Step number + status */}
          <div className="flex flex-col items-center gap-1 pt-0.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold bg-background">
              {index + 1}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {/* Agent role badge */}
              <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium', agentColor)}>
                {step.agentRole}
              </span>

              {/* Risk badge */}
              <Badge variant={RISK_VARIANTS[step.riskLevel]} className="text-xs">
                {step.riskLevel}
              </Badge>

              {/* Status */}
              <div className="flex items-center gap-1 ml-auto">
                <StatusIcon status={step.status} />
                <span className="text-xs text-muted-foreground">{statusLabel(step.status)}</span>
              </div>
            </div>

            <p className="text-sm font-medium">{step.taskName}</p>
            {!expanded && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{step.description}</p>
            )}

            {/* Timing */}
            {step.startedAt && (
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                {step.actualDuration ? (
                  <span>{(step.actualDuration / 1000).toFixed(1)}s</span>
                ) : (
                  <span>{formatDistanceToNow(new Date(step.startedAt))} ago</span>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </div>
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div className="border-t px-4 py-3 space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{step.description}</p>
            </div>

            {step.inputSummary && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Input</p>
                <p className="text-sm font-mono bg-muted/50 rounded p-2">{step.inputSummary}</p>
              </div>
            )}

            {step.outputSummary && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Output</p>
                <p className="text-sm font-mono bg-muted/50 rounded p-2">{step.outputSummary}</p>
              </div>
            )}

            {step.errorMessage && (
              <div>
                <p className="text-xs font-medium text-destructive mb-1">Error</p>
                <p className="text-sm text-destructive font-mono bg-destructive/5 rounded p-2">{step.errorMessage}</p>
              </div>
            )}

            {step.toolCalls && step.toolCalls.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Tool Calls ({step.toolCalls.length})</p>
                <div className="space-y-1">
                  {step.toolCalls.map(tc => (
                    <div key={tc.id} className="flex items-center gap-2 text-xs rounded border px-2 py-1.5 bg-muted/30">
                      <span className="font-medium font-mono">{tc.toolName}</span>
                      {tc.durationMs && <span className="text-muted-foreground">{tc.durationMs}ms</span>}
                      {tc.error ? (
                        <XCircle className="h-3 w-3 text-destructive ml-auto" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step.dependsOn && step.dependsOn.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Dependencies</p>
                <div className="flex flex-wrap gap-1">
                  {step.dependsOn.map(dep => (
                    <span key={dep} className="rounded border px-2 py-0.5 text-xs bg-muted/30">{dep}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Arrow connector */}
      {!isLast && (
        <div className="flex justify-center py-1 relative z-10">
          <ArrowRight className="h-3 w-3 text-muted-foreground rotate-90" />
        </div>
      )}
    </div>
  );
}

interface PlanViewProps {
  plan?: WorkflowPlan;
  isLoading?: boolean;
  className?: string;
}

export function PlanView({ plan, isLoading, className }: PlanViewProps) {
  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="text-center space-y-3">
          <Spinner size="lg" className="mx-auto" />
          <p className="text-sm text-muted-foreground">Planning workflow…</p>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <EmptyState
        icon={<ArrowRight className="h-5 w-5" />}
        title="No plan yet"
        description="Submit a command to generate an execution plan"
        className={className}
      />
    );
  }

  const completedSteps = plan.steps.filter(s => s.status === 'COMPLETED').length;
  const progress = plan.steps.length > 0 ? (completedSteps / plan.steps.length) * 100 : 0;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium">Plan Progress</span>
          <span className="text-xs text-muted-foreground">
            {completedSteps}/{plan.steps.length} steps
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-0">
        {plan.steps.map((step, index) => (
          <PlanStepRow
            key={step.id}
            step={step}
            index={index}
            isLast={index === plan.steps.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
