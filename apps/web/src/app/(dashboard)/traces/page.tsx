'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
  GitCompare,
  Radio,
  Pause,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input, Spinner, EmptyState } from '@/components/ui';
import useSWR from 'swr';
import { dataFetcher } from '@/lib/api-client';
import type { Trace, TraceStep, AgentRole } from '@/types';
import { format, formatDistanceToNow } from 'date-fns';
import type { PaginatedResult } from '@/types';
import { useWorkflowStream } from '@/hooks/useWorkflowStream';

const AGENT_ROLE_OPTIONS: AgentRole[] = [
  'COMMANDER', 'PLANNER', 'ROUTER', 'VERIFIER', 'GUARDRAIL', 'APPROVAL',
  'WORKER_EMAIL', 'WORKER_CALENDAR', 'WORKER_CRM', 'WORKER_DOCUMENT',
  'WORKER_SPREADSHEET', 'WORKER_BROWSER', 'WORKER_RESEARCH',
  'WORKER_KNOWLEDGE', 'WORKER_SUPPORT', 'WORKER_OPS', 'WORKER_VOICE',
  'WORKER_CODER', 'WORKER_DESIGNER', 'WORKER_STRATEGIST',
  'WORKER_MARKETING', 'WORKER_TECHNICAL', 'WORKER_FINANCE', 'WORKER_HR',
  'WORKER_GROWTH',
];

type TraceListItem = {
  id: string;
  workflowId: string;
  agentRole?: string;
  startedAt?: string;
  createdAt?: string;
  durationMs?: number;
  error?: string | null;
};

async function fetchTraces(url: string) {
  return dataFetcher<PaginatedResult<TraceListItem>>(url);
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

function formatJson(value: unknown): string {
  if (value === undefined) return '(none)';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function arraysEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}

function SectionDiff({
  title,
  previous,
  current,
}: {
  title: string;
  previous: unknown;
  current: unknown;
}) {
  const prevText = formatJson(previous);
  const currText = formatJson(current);
  const changed = prevText !== currText;

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b">
        <p className="text-xs font-semibold">{title}</p>
        <Badge variant={changed ? 'secondary' : 'outline'} className="text-[10px]">
          {changed ? 'changed' : 'no change'}
        </Badge>
      </div>
      <div className="grid gap-0 sm:grid-cols-2">
        <div className="p-3 border-b sm:border-b-0 sm:border-r">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Previous</p>
          <pre className="text-xs bg-muted/20 rounded p-2 overflow-x-auto max-h-40">{prevText}</pre>
        </div>
        <div className="p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Current</p>
          <pre className="text-xs bg-muted/20 rounded p-2 overflow-x-auto max-h-40">{currText}</pre>
        </div>
      </div>
    </div>
  );
}

interface TraceStepRowProps {
  step: TraceStep;
  selected?: boolean;
  onSelect?: (step: TraceStep) => void;
}

function TraceStepRow({ step, selected = false, onSelect }: TraceStepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasError = !!step.error;
  const hasScreenshot = !!step.screenshotUrl;
  const hasTools = step.toolCalls && step.toolCalls.length > 0;

  return (
    <div className={cn('border rounded-lg overflow-hidden', hasError && 'border-destructive/50', selected && 'ring-2 ring-primary/60')}>
      <button
        onClick={() => {
          setExpanded(!expanded);
          onSelect?.(step);
        }}
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

function StepDiffPanel({
  selectedStep,
  previousStep,
}: {
  selectedStep: TraceStep | null;
  previousStep: TraceStep | null;
}) {
  if (!selectedStep) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Select a step to inspect input/output/tools/errors diff.
        </CardContent>
      </Card>
    );
  }

  const prevTools = previousStep?.toolCalls?.map((t) => ({ toolName: t.toolName, error: t.error ?? null })) ?? [];
  const currTools = selectedStep.toolCalls?.map((t) => ({ toolName: t.toolName, error: t.error ?? null })) ?? [];
  const toolChanged = !arraysEqual(prevTools, currTools);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-primary" />
          Step Diff Panel
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Comparing step {selectedStep.stepNumber} with previous step.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <SectionDiff title="Input" previous={previousStep?.input} current={selectedStep.input} />
        <SectionDiff title="Output" previous={previousStep?.output} current={selectedStep.output} />
        <div className="rounded-lg border overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b">
            <p className="text-xs font-semibold">Tools</p>
            <Badge variant={toolChanged ? 'secondary' : 'outline'} className="text-[10px]">
              {toolChanged ? 'changed' : 'no change'}
            </Badge>
          </div>
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="p-3 border-b sm:border-b-0 sm:border-r">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Previous</p>
              <pre className="text-xs bg-muted/20 rounded p-2 overflow-x-auto max-h-40">{formatJson(prevTools)}</pre>
            </div>
            <div className="p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Current</p>
              <pre className="text-xs bg-muted/20 rounded p-2 overflow-x-auto max-h-40">{formatJson(currTools)}</pre>
            </div>
          </div>
        </div>
        <SectionDiff title="Error" previous={previousStep?.error ?? null} current={selectedStep.error ?? null} />
      </CardContent>
    </Card>
  );
}

function TraceDetailPanel({ trace }: { trace: Trace }) {
  const steps = useMemo(
    () => (Array.isArray(trace.steps) ? [...trace.steps].sort((a, b) => a.stepNumber - b.stepNumber) : []),
    [trace.steps],
  );
  const totalSteps = steps.length;
  const errorSteps = steps.filter(s => !!s.error).length;
  const [selectedStepIndex, setSelectedStepIndex] = useState(steps.length > 0 ? steps.length - 1 : 0);
  const [followLive, setFollowLive] = useState(true);
  const selectedStep = steps[selectedStepIndex] ?? null;
  const previousStep = selectedStepIndex > 0 ? (steps[selectedStepIndex - 1] ?? null) : null;
  const visibleSteps = selectedStep ? steps.filter((s) => s.stepNumber <= selectedStep.stepNumber) : steps;
  const { events, isConnected } = useWorkflowStream(trace.workflowId);

  useEffect(() => {
    setSelectedStepIndex(steps.length > 0 ? steps.length - 1 : 0);
    setFollowLive(true);
  }, [trace.id, steps.length]);

  useEffect(() => {
    if (!followLive || steps.length === 0) return;
    setSelectedStepIndex(steps.length - 1);
  }, [steps.length, followLive]);

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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Timeline Scrubber
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isConnected ? <Radio className="h-3.5 w-3.5 text-green-500" /> : <Pause className="h-3.5 w-3.5" />}
            {isConnected ? 'Live stream connected' : 'Not streaming'}
            <span>•</span>
            <span>{events.length} stream event{events.length === 1 ? '' : 's'}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Step {selectedStep?.stepNumber ?? 0} / {steps.length}</span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={followLive}
                onChange={(e) => setFollowLive(e.target.checked)}
                className="rounded border-input"
              />
              Follow latest
            </label>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(steps.length - 1, 0)}
            value={Math.min(selectedStepIndex, Math.max(steps.length - 1, 0))}
            onChange={(e) => {
              setSelectedStepIndex(Number(e.target.value));
              setFollowLive(false);
            }}
            className="w-full"
            disabled={steps.length === 0}
          />
          {selectedStep && (
            <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">{selectedStep.agentRole}</Badge>
              <span className="truncate">{selectedStep.action}</span>
              <span className="ml-auto text-muted-foreground">{format(new Date(selectedStep.startedAt), 'HH:mm:ss')}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <StepDiffPanel selectedStep={selectedStep} previousStep={previousStep} />

      {/* Steps */}
      <div className="space-y-2">
        {visibleSteps.map((step, index) => (
          <TraceStepRow
            key={step.id}
            step={step}
            selected={selectedStep?.id === step.id}
            onSelect={() => {
              const idx = steps.findIndex((s) => s.id === step.id);
              if (idx >= 0) {
                setSelectedStepIndex(idx);
                setFollowLive(false);
              }
            }}
          />
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

  const { data, isLoading } = useSWR<PaginatedResult<TraceListItem>>(key, fetchTraces, {
    refreshInterval: 30_000,
  });

  const { data: selectedTraceData, isLoading: traceLoading } = useSWR<Trace>(
    selectedTraceId ? `/traces/${selectedTraceId}` : null,
    (url: string) => dataFetcher<Trace>(url),
  );

  const traces = Array.isArray(data?.items) ? data.items : [];
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
                          {formatDistanceToNow(new Date(trace.startedAt ?? trace.createdAt ?? Date.now()), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Workflow: <code className="font-mono text-foreground">{trace.workflowId.slice(0, 12)}…</code>
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground shrink-0">
                      {trace.durationMs && (
                        <span>{(trace.durationMs / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                  </div>

                  {/* Agent role pills */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {trace.agentRole && (
                      <Badge variant="secondary" className="text-[10px]">{trace.agentRole}</Badge>
                    )}
                    {trace.error && (
                      <Badge variant="destructive" className="text-[10px]">
                        Error
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
            ) : selectedTraceData && Array.isArray(selectedTraceData.steps) ? (
              <TraceDetailPanel trace={selectedTraceData} />
            ) : selectedTraceData ? (
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Raw Trace Payload</p>
                  <pre className="text-xs bg-muted/30 rounded p-2 overflow-x-auto max-h-[480px]">
                    {JSON.stringify(selectedTraceData, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
