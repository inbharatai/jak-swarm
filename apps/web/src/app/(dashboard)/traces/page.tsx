'use client';

import React, { useState } from 'react';
import {
  FileText,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
  Image,
  Filter,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input, Spinner, EmptyState } from '@/components/ui';
import useSWR from 'swr';
import { apiClient, fetcher } from '@/lib/api-client';
import type { Trace, TraceStep, AgentRole } from '@/types';
import { format, formatDistanceToNow } from 'date-fns';

const AGENT_ROLE_OPTIONS: AgentRole[] = [
  'COMMANDER', 'PLANNER', 'ROUTER', 'VERIFIER', 'GUARDRAIL', 'APPROVAL',
  'WORKER_EMAIL', 'WORKER_CALENDAR', 'WORKER_CRM', 'WORKER_DOCUMENT',
  'WORKER_SPREADSHEET', 'WORKER_BROWSER', 'WORKER_RESEARCH',
  'WORKER_KNOWLEDGE', 'WORKER_SUPPORT', 'WORKER_OPS', 'WORKER_VOICE',
  'WORKER_CODER', 'WORKER_DESIGNER', 'WORKER_STRATEGIST',
  'WORKER_MARKETING', 'WORKER_TECHNICAL', 'WORKER_FINANCE', 'WORKER_HR',
  'WORKER_GROWTH',
];

async function fetchTraces(url: string) {
  return apiClient.get<{ data: Trace[]; total: number }>(url);
}

function CostBadge({ cost }: { cost?: number }) {
  if (!cost) return null;
  return (
    <span className="text-xs text-muted-foreground">
      ${cost.toFixed(4)}
    </span>
  );
}

function DurationBadge({ durationMs }: { durationMs?: number }) {
  if (!durationMs) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
    </span>
  );
}

interface TraceStepRowProps {
  step: TraceStep;
}

function TraceStepRow({ step }: TraceStepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasError = !!step.error;
  const hasScreenshot = !!step.screenshotUrl;
  const hasTools = step.toolCalls && step.toolCalls.length > 0;

  return (
    <div className={cn('border rounded-lg overflow-hidden', hasError && 'border-destructive/50')}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors',
          hasError && 'bg-destructive/5',
        )}
      >
        {/* Step number */}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold bg-background">
          {step.stepNumber}
        </span>

        {/* Status icon */}
        {hasError ? (
          <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        ) : step.completedAt ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
        ) : (
          <Loader2 className="h-4 w-4 shrink-0 text-primary animate-spin" />
        )}

        {/* Agent role */}
        <Badge variant="secondary" className="text-xs shrink-0">{step.agentRole}</Badge>

        {/* Action */}
        <span className="flex-1 text-sm truncate">{step.action}</span>

        {/* Stats */}
        <div className="flex items-center gap-3 shrink-0">
          {hasTools && (
            <span className="text-xs text-muted-foreground">{step.toolCalls!.length} tools</span>
          )}
          <DurationBadge durationMs={step.durationMs} />
          <CostBadge cost={step.costUsd} />
          {step.tokenUsage && (
            <span className="text-xs text-muted-foreground">{step.tokenUsage}t</span>
          )}
          {hasScreenshot && <Image className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>

        <div className="text-muted-foreground shrink-0">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t divide-y">
          {/* Input */}
          {step.input && Object.keys(step.input).length > 0 && (
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Input</p>
              <pre className="text-xs bg-muted/30 rounded p-2 overflow-x-auto max-h-40">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {step.output && Object.keys(step.output).length > 0 && (
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Output</p>
              <pre className="text-xs bg-muted/30 rounded p-2 overflow-x-auto max-h-40">
                {JSON.stringify(step.output, null, 2)}
              </pre>
            </div>
          )}

          {/* Tool calls */}
          {hasTools && (
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Tool Calls ({step.toolCalls!.length})
              </p>
              <div className="space-y-2">
                {step.toolCalls!.map(tc => (
                  <div key={tc.id} className="rounded border bg-muted/20 p-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <code className="text-xs font-semibold">{tc.toolName}</code>
                      <DurationBadge durationMs={tc.durationMs} />
                      {tc.error ? (
                        <XCircle className="h-3 w-3 text-destructive ml-auto" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto" />
                      )}
                    </div>
                    {tc.error && (
                      <p className="text-xs text-destructive font-mono">{tc.error}</p>
                    )}
                    {tc.input && Object.keys(tc.input).length > 0 && (
                      <pre className="text-xs bg-muted/50 rounded p-1.5 mt-1 overflow-x-auto max-h-24">
                        {JSON.stringify(tc.input, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {step.error && (
            <div className="px-4 py-3 bg-destructive/5">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                <p className="text-xs font-semibold text-destructive">Error</p>
              </div>
              <pre className="text-xs text-destructive font-mono bg-destructive/10 rounded p-2 overflow-x-auto max-h-32">
                {step.error}
              </pre>
            </div>
          )}

          {/* Screenshot */}
          {hasScreenshot && (
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Browser Screenshot</p>
              <img
                src={step.screenshotUrl}
                alt="Browser automation screenshot"
                className="rounded border max-h-48 object-contain"
              />
            </div>
          )}

          {/* Timestamps */}
          <div className="flex items-center gap-4 px-4 py-2 text-xs text-muted-foreground">
            <span>Started: {format(new Date(step.startedAt), 'HH:mm:ss.SSS')}</span>
            {step.completedAt && (
              <span>Finished: {format(new Date(step.completedAt), 'HH:mm:ss.SSS')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TraceDetailPanel({ trace }: { trace: Trace }) {
  const totalSteps = trace.steps.length;
  const errorSteps = trace.steps.filter(s => !!s.error).length;
  const browserSteps = trace.steps.filter(s => s.agentRole === 'WORKER_BROWSER').length;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Steps', value: totalSteps },
          { label: 'Duration', value: trace.totalDurationMs ? `${(trace.totalDurationMs / 1000).toFixed(1)}s` : 'N/A' },
          { label: 'Tokens', value: trace.totalTokens?.toLocaleString() ?? 'N/A' },
          { label: 'Cost', value: trace.totalCostUsd ? `$${trace.totalCostUsd.toFixed(4)}` : 'N/A' },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg border bg-muted/30 p-3 text-center">
            <p className="text-lg font-bold">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {errorSteps > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {errorSteps} step{errorSteps !== 1 ? 's' : ''} encountered errors
        </div>
      )}

      {/* Steps */}
      <div className="space-y-2">
        {trace.steps.map(step => (
          <TraceStepRow key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}

export default function TracesPage() {
  const [filters, setFilters] = useState({
    workflowId: '',
    agentRole: '',
    dateFrom: '',
    dateTo: '',
    hasErrors: false,
  });
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Build query string
  const params = new URLSearchParams();
  if (filters.workflowId) params.set('workflowId', filters.workflowId);
  if (filters.agentRole) params.set('agentRole', filters.agentRole);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.hasErrors) params.set('hasErrors', 'true');

  const qs = params.toString();
  // BASE_URL already includes the API host; no /api/ prefix needed
  const key = `/traces${qs ? `?${qs}` : ''}`;

  const { data, isLoading } = useSWR<{ data: Trace[]; total: number }>(key, fetchTraces, {
    refreshInterval: 30_000,
  });

  const { data: selectedTraceData, isLoading: traceLoading } = useSWR<Trace>(
    selectedTraceId ? `/traces/${selectedTraceId}` : null,
    (url: string) => apiClient.get<Trace>(url),
  );

  const traces = data?.data ?? [];
  const hasActiveFilters = filters.workflowId || filters.agentRole || filters.dateFrom || filters.dateTo || filters.hasErrors;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Trace Viewer
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Full step-by-step execution logs with cost and latency breakdown
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="gap-1.5"
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {hasActiveFilters && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">!</span>
          )}
        </Button>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Workflow ID</label>
                <Input
                  placeholder="wf-xxxxxx"
                  value={filters.workflowId}
                  onChange={e => setFilters(prev => ({ ...prev, workflowId: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Agent Role</label>
                <select
                  value={filters.agentRole}
                  onChange={e => setFilters(prev => ({ ...prev, agentRole: e.target.value }))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">All roles</option>
                  {AGENT_ROLE_OPTIONS.map(role => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">From Date</label>
                <Input
                  type="date"
                  value={filters.dateFrom}
                  onChange={e => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">To Date</label>
                <Input
                  type="date"
                  value={filters.dateTo}
                  onChange={e => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-4 mt-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.hasErrors}
                  onChange={e => setFilters(prev => ({ ...prev, hasErrors: e.target.checked }))}
                  className="rounded border-input"
                />
                Show only traces with errors
              </label>
              {hasActiveFilters && (
                <button
                  onClick={() => setFilters({ workflowId: '', agentRole: '', dateFrom: '', dateTo: '', hasErrors: false })}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main content */}
      <div className={cn('gap-6', selectedTraceId ? 'grid lg:grid-cols-2' : '')}>
        {/* Trace list */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : traces.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-6 w-6" />}
              title="No traces found"
              description="Traces are generated automatically when workflows run."
            />
          ) : (
            traces.map(trace => (
              <Card
                key={trace.id}
                className={cn(
                  'cursor-pointer transition-all hover:shadow-md',
                  selectedTraceId === trace.id && 'ring-2 ring-primary',
                )}
                onClick={() => setSelectedTraceId(trace.id === selectedTraceId ? null : trace.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">{trace.id.slice(0, 12)}…</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(trace.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Workflow: <code className="font-mono text-foreground">{trace.workflowId.slice(0, 12)}…</code>
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground shrink-0">
                      <span>{trace.steps.length} steps</span>
                      {trace.totalDurationMs && (
                        <span>{(trace.totalDurationMs / 1000).toFixed(1)}s</span>
                      )}
                      {trace.totalCostUsd && (
                        <span>${trace.totalCostUsd.toFixed(4)}</span>
                      )}
                    </div>
                  </div>

                  {/* Agent role pills */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {Array.from(new Set(trace.steps.map(s => s.agentRole))).map(role => (
                      <Badge key={role} variant="secondary" className="text-[10px]">{role}</Badge>
                    ))}
                    {trace.steps.some(s => s.error) && (
                      <Badge variant="destructive" className="text-[10px]">
                        {trace.steps.filter(s => s.error).length} errors
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Trace detail */}
        {selectedTraceId && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Trace Detail</h3>
              <Button variant="ghost" size="sm" onClick={() => setSelectedTraceId(null)} className="h-7 gap-1">
                <X className="h-3.5 w-3.5" /> Close
              </Button>
            </div>
            {traceLoading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : selectedTraceData ? (
              <TraceDetailPanel trace={selectedTraceData} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
