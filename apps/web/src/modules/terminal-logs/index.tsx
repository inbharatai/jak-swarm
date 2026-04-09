'use client';

import React, { useState } from 'react';
import {
  FileText, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader, CardTitle, Badge, Spinner, EmptyState } from '@/components/ui';
import useSWR from 'swr';
import { fetcher } from '@/lib/api-client';
import type { Trace, TraceStep, AgentRole } from '@/types';
import type { ModuleProps } from '@/modules/registry';
import { formatDistanceToNow } from 'date-fns';

const AGENT_ROLE_OPTIONS: AgentRole[] = [
  'COMMANDER', 'PLANNER', 'ROUTER', 'VERIFIER', 'GUARDRAIL', 'APPROVAL',
  'WORKER_EMAIL', 'WORKER_CALENDAR', 'WORKER_CRM', 'WORKER_DOCUMENT',
  'WORKER_SPREADSHEET', 'WORKER_BROWSER', 'WORKER_RESEARCH',
  'WORKER_KNOWLEDGE', 'WORKER_SUPPORT', 'WORKER_OPS', 'WORKER_VOICE',
  'WORKER_CODER', 'WORKER_DESIGNER', 'WORKER_STRATEGIST',
  'WORKER_MARKETING', 'WORKER_TECHNICAL', 'WORKER_FINANCE', 'WORKER_HR',
  'WORKER_GROWTH',
];

function TraceStepRow({ step }: { step: TraceStep }) {
  const [expanded, setExpanded] = useState(false);
  const hasError = !!step.error;

  return (
    <div className={cn('border rounded-lg overflow-hidden', hasError && 'border-destructive/50')}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors', hasError && 'bg-destructive/5')}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold bg-background">{step.stepNumber}</span>
        <span className="text-xs font-medium flex-1 truncate">{step.agentRole}</span>
        {step.durationMs && <span className="text-xs text-muted-foreground">{step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}</span>}
        {step.costUsd && <span className="text-xs text-muted-foreground">${step.costUsd.toFixed(4)}</span>}
        {hasError ? <XCircle className="h-4 w-4 text-destructive" /> : step.completedAt ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2 text-xs">
          {step.input && <div><span className="text-muted-foreground font-medium">Input: </span><pre className="mt-1 rounded bg-muted p-2 overflow-auto max-h-32 text-[10px]">{typeof step.input === 'string' ? step.input : JSON.stringify(step.input, null, 2)}</pre></div>}
          {step.output && <div><span className="text-muted-foreground font-medium">Output: </span><pre className="mt-1 rounded bg-muted p-2 overflow-auto max-h-32 text-[10px]">{typeof step.output === 'string' ? step.output : JSON.stringify(step.output, null, 2)}</pre></div>}
          {step.error && <div className="text-destructive"><span className="font-medium">Error: </span>{step.error}</div>}
          {step.toolCalls?.map((tc, i) => (
            <div key={i} className="flex items-center gap-2"><Badge variant="outline" className="text-[10px]">{tc.toolName}</Badge><span className="text-muted-foreground">{tc.durationMs ? `${tc.durationMs}ms` : ''}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TerminalLogsModule({ moduleId, isActive }: ModuleProps) {
  const [roleFilter, setRoleFilter] = useState<AgentRole | 'ALL'>('ALL');
  const { data, isLoading } = useSWR<{ data: Trace[]; total: number }>('/traces?limit=50', fetcher, { refreshInterval: 5000 });

  const traces = data?.data ?? [];
  const filtered = roleFilter === 'ALL' ? traces : traces.filter(t => t.steps?.some(s => s.agentRole === roleFilter));

  if (isLoading) return <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>;

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><FileText className="h-5 w-5 text-primary" />Execution Traces</h2>
          <p className="text-xs text-muted-foreground">{traces.length} traces loaded</p>
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as AgentRole | 'ALL')} className="text-xs rounded-md border px-2 py-1.5 bg-background">
          <option value="ALL">All Agents</option>
          {AGENT_ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<FileText className="h-12 w-12" />} title="No traces" description="Execution traces will appear here as workflows run." />
      ) : (
        <div className="space-y-4">
          {filtered.map(trace => (
            <Card key={trace.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm truncate">{trace.workflowId}</CardTitle>
                  <span className="text-xs text-muted-foreground">{trace.createdAt && formatDistanceToNow(new Date(trace.createdAt), { addSuffix: true })}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {trace.steps?.map(step => <TraceStepRow key={step.id || step.stepNumber} step={step} />)}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
