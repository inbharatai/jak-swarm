'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Timer,
  Wrench,
  PauseCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui';
import type { AgentTraceRecord, AgentRole } from '@/types';
import { formatDistanceToNow, intervalToDuration } from 'date-fns';

// ─── Role metadata ────────────────────────────────────────────────────────────

const AGENT_META: Record<AgentRole, { icon: string; colorClass: string; label: string }> = {
  COMMANDER:          { icon: '🎯', label: 'Commander',         colorClass: 'border-purple-300 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-800' },
  PLANNER:            { icon: '📋', label: 'Planner',           colorClass: 'border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800' },
  ROUTER:             { icon: '🔀', label: 'Router',            colorClass: 'border-cyan-300 bg-cyan-50 dark:bg-cyan-900/20 dark:border-cyan-800' },
  VERIFIER:           { icon: '✅', label: 'Verifier',          colorClass: 'border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-800' },
  GUARDRAIL:          { icon: '🛡️', label: 'Guardrail',         colorClass: 'border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800' },
  APPROVAL:           { icon: '🔏', label: 'Approval',          colorClass: 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800' },
  WORKER_EMAIL:       { icon: '📧', label: 'Email Worker',      colorClass: 'border-pink-300 bg-pink-50 dark:bg-pink-900/20 dark:border-pink-800' },
  WORKER_CALENDAR:    { icon: '📅', label: 'Calendar Worker',   colorClass: 'border-rose-300 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800' },
  WORKER_CRM:         { icon: '👥', label: 'CRM Worker',        colorClass: 'border-orange-300 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800' },
  WORKER_DOCUMENT:    { icon: '📄', label: 'Document Worker',   colorClass: 'border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-800' },
  WORKER_SPREADSHEET: { icon: '📊', label: 'Spreadsheet Worker',colorClass: 'border-teal-300 bg-teal-50 dark:bg-teal-900/20 dark:border-teal-800' },
  WORKER_BROWSER:     { icon: '🌐', label: 'Browser Worker',    colorClass: 'border-sky-300 bg-sky-50 dark:bg-sky-900/20 dark:border-sky-800' },
  WORKER_RESEARCH:    { icon: '🔍', label: 'Research Worker',   colorClass: 'border-violet-300 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-800' },
  WORKER_KNOWLEDGE:   { icon: '🧠', label: 'Knowledge Worker',  colorClass: 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800' },
  WORKER_SUPPORT:     { icon: '🎧', label: 'Support Worker',    colorClass: 'border-lime-300 bg-lime-50 dark:bg-lime-900/20 dark:border-lime-800' },
  WORKER_OPS:         { icon: '⚙️', label: 'Ops Worker',        colorClass: 'border-gray-300 bg-gray-50 dark:bg-gray-900/20 dark:border-gray-700' },
  WORKER_VOICE:       { icon: '🎤', label: 'Voice Worker',      colorClass: 'border-fuchsia-300 bg-fuchsia-50 dark:bg-fuchsia-900/20 dark:border-fuchsia-800' },
  WORKER_CODER:       { icon: '💻', label: 'Software Engineer', colorClass: 'border-blue-400 bg-blue-100 dark:bg-blue-900/30 dark:border-blue-700' },
  WORKER_DESIGNER:    { icon: '🎨', label: 'Designer',          colorClass: 'border-pink-400 bg-pink-100 dark:bg-pink-900/30 dark:border-pink-700' },
  WORKER_STRATEGIST:  { icon: '♟️', label: 'Chief Strategist',  colorClass: 'border-slate-400 bg-slate-100 dark:bg-slate-900/30 dark:border-slate-600' },
  WORKER_MARKETING:   { icon: '📣', label: 'Marketing Lead',    colorClass: 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800' },
  WORKER_TECHNICAL:   { icon: '🏗️', label: 'Tech Architect',    colorClass: 'border-cyan-400 bg-cyan-100 dark:bg-cyan-900/30 dark:border-cyan-700' },
  WORKER_FINANCE:     { icon: '💰', label: 'Finance Analyst',   colorClass: 'border-green-400 bg-green-100 dark:bg-green-900/30 dark:border-green-700' },
  WORKER_HR:          { icon: '👔', label: 'HR & People',       colorClass: 'border-amber-400 bg-amber-100 dark:bg-amber-900/30 dark:border-amber-700' },
  WORKER_GROWTH:      { icon: '🚀', label: 'Growth Engine',    colorClass: 'border-orange-400 bg-orange-100 dark:bg-orange-900/30 dark:border-orange-700' },
};

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const statusUpper = status.toUpperCase();
  type BV = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline';
  const map: Record<string, { label: string; variant: BV }> = {
    RUNNING:           { label: 'Running',           variant: 'default' },
    IN_PROGRESS:       { label: 'Running',           variant: 'default' },
    COMPLETED:         { label: 'Completed',         variant: 'success' },
    FAILED:            { label: 'Failed',            variant: 'destructive' },
    AWAITING_APPROVAL: { label: 'Awaiting Approval', variant: 'warning' },
    PAUSED:            { label: 'Paused',            variant: 'warning' },
    PENDING:           { label: 'Pending',           variant: 'secondary' },
    SKIPPED:           { label: 'Skipped',           variant: 'outline' },
    CANCELLED:         { label: 'Cancelled',         variant: 'outline' },
  };
  const cfg = map[statusUpper] ?? { label: status, variant: 'outline' as BV };
  return <Badge variant={cfg.variant} className="text-[10px]">{cfg.label}</Badge>;
}

// ─── Duration helper ──────────────────────────────────────────────────────────

function durationStr(startedAt: string, completedAt: string | null): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const dur = intervalToDuration({ start: 0, end: ms });
  return [
    dur.hours   && `${dur.hours}h`,
    dur.minutes && `${dur.minutes}m`,
    `${dur.seconds ?? 0}s`,
  ].filter(Boolean).join(' ');
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AgentCardProps {
  step: AgentTraceRecord;
  traceLink?: string;
  className?: string;
}

export function AgentCard({ step, traceLink, className }: AgentCardProps) {
  const [expanded, setExpanded] = useState(false);

  const meta = AGENT_META[step.agentRole] ?? { icon: '🤖', label: step.agentRole, colorClass: '' };
  const isRunning = !step.completedAt;
  const dur = step.startedAt ? durationStr(step.startedAt, step.completedAt) : null;

  // steps is unknown[] — try to surface useful info
  const stepCount = Array.isArray(step.steps) ? step.steps.length : 0;

  const statusUpper = step.status?.toUpperCase() ?? '';
  const isFailed = statusUpper === 'FAILED';

  return (
    <div className={cn('rounded-xl border overflow-hidden transition-all', meta.colorClass, className)}>
      {/* Header row */}
      <button
        onClick={() => stepCount > 0 && setExpanded(e => !e)}
        className={cn(
          'flex w-full items-start gap-3 p-4 text-left',
          stepCount > 0 && 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5',
        )}
      >
        {/* Icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 dark:bg-white/10 text-lg shadow-sm">
          {meta.icon}
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold">{meta.label}</span>
            <StatusBadge status={step.status} />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {dur && (
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" />
                {dur}
              </span>
            )}
            {step.startedAt && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(step.startedAt), { addSuffix: true })}
              </span>
            )}
            {stepCount > 0 && (
              <span className="flex items-center gap-1">
                <Wrench className="h-3 w-3" />
                {stepCount} step{stepCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Right side */}
        <div className="shrink-0 flex items-center gap-2">
          {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          {isFailed && <XCircle className="h-3.5 w-3.5 text-destructive" />}
          {!isRunning && !isFailed && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
          {stepCount > 0 && (
            expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded steps */}
      {expanded && stepCount > 0 && (
        <div className="border-t bg-white/30 dark:bg-black/20 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Steps ({stepCount})
          </p>
          {(step.steps as Record<string, unknown>[]).map((s, i) => (
            <div key={i} className="rounded border bg-white/50 dark:bg-black/20 px-3 py-2 text-xs">
              {typeof s === 'object' && s !== null ? (
                <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground overflow-x-auto max-h-32">
                  {JSON.stringify(s, null, 2)}
                </pre>
              ) : (
                <span>{String(s)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {traceLink && (
        <div className="border-t bg-white/20 dark:bg-black/20 px-4 py-2">
          <a href={traceLink} className="text-xs text-primary hover:underline">
            View full trace →
          </a>
        </div>
      )}
    </div>
  );
}
