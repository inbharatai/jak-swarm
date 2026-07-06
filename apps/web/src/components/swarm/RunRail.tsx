'use client';

// ─── JARVIS Inspector — virtualized run rail ─────────────────────────────────
//
// The left rail: filter tabs + a virtualized (@tanstack/react-virtual) list
// of workflow runs + pagination. This is the Phase B home for the
// virtualization deferred from Phase A.12 — the rail is a fixed-height
// scroll surface, the right place for a virtualizer.
//
// SSE fan-out is capped: RunRail only calls onSelect(id); the parent
// SwarmInspector opens a SINGLE SSE stream for the selected run. Non-selected
// runs refresh via useWorkflows polling (5s) — never one SSE per row.

import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, XCircle, Clock, PauseCircle, Network } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner, EmptyState } from '@/components/ui';
import { useWorkflows } from '@/hooks/useWorkflow';
import { formatDistanceToNow, intervalToDuration } from 'date-fns';
import type { Workflow, WorkflowStatus } from '@/types';

const PAGE_SIZE = 50;

type FilterKey = 'all' | 'active' | 'completed' | 'failed';

const STATUS_MAP: Record<FilterKey, WorkflowStatus[] | undefined> = {
  all: undefined,
  active: ['RUNNING', 'PAUSED', 'PENDING'],
  completed: ['COMPLETED'],
  failed: ['FAILED', 'CANCELLED'],
};

function StatusIcon({ status }: { status: WorkflowStatus }) {
  switch (status) {
    case 'RUNNING':   return <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300" />;
    case 'PAUSED':    return <PauseCircle className="h-3.5 w-3.5 text-amber-300" />;
    case 'COMPLETED': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />;
    case 'FAILED':    return <XCircle className="h-3.5 w-3.5 text-rose-300" />;
    case 'CANCELLED': return <XCircle className="h-3.5 w-3.5 text-zinc-300" />;
    default:          return <Clock className="h-3.5 w-3.5 text-zinc-300" />;
  }
}

function durationStr(w: Workflow): string | null {
  if (!w.completedAt || !w.startedAt) return null;
  const d = intervalToDuration({ start: new Date(w.startedAt), end: new Date(w.completedAt) });
  return [d.hours && `${d.hours}h`, d.minutes && `${d.minutes}m`, `${d.seconds ?? 0}s`].filter(Boolean).join(' ');
}

function RunRow({
  workflow,
  selected,
  onSelect,
}: {
  workflow: Workflow;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(workflow.id)}
      className={cn(
        'flex w-full items-start gap-2 border-l-2 px-2 py-2 text-left transition-colors',
        selected
          ? 'border-emerald-400 bg-emerald-400/10'
          : 'border-transparent hover:bg-white/5',
      )}
    >
      <div className="mt-0.5 shrink-0">
        <StatusIcon status={workflow.status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="jarvis-readout shrink-0 text-[10px] text-muted-foreground">{workflow.id.slice(0, 8)}…</span>
          {workflow.status === 'RUNNING' && (
            <span className="jarvis-readout text-[9px] text-emerald-300 jarvis-pulse">LIVE</span>
          )}
          {durationStr(workflow) && (
            <span className="jarvis-readout ml-auto shrink-0 text-[10px] text-muted-foreground">{durationStr(workflow)}</span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-foreground/90">{workflow.goal}</p>
        <p className="jarvis-readout mt-0.5 text-[9px] text-muted-foreground">
          {workflow.startedAt
            ? formatDistanceToNow(new Date(workflow.startedAt), { addSuffix: true })
            : formatDistanceToNow(new Date(workflow.createdAt), { addSuffix: true })}
          {' · '}{workflow.traceCount ?? 0} traces
        </p>
      </div>
    </button>
  );
}

export function RunRail({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [page, setPage] = useState(1);
  const status = STATUS_MAP[filter];
  const { workflows, isLoading, totalPages } = useWorkflows(
    status ? { status, page, pageSize: PAGE_SIZE } : { page, pageSize: PAGE_SIZE },
    // 5s poll for the rail — non-selected active runs refresh here, not via SSE.
    { refreshInterval: 5_000 },
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: workflows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 76,
    overscan: 6,
  });

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const pageWindow = useMemo(() => {
    if (totalPages <= 1) return [] as number[];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [page, totalPages]);

  function changeFilter(f: FilterKey) {
    setFilter(f);
    setPage(1);
  }

  return (
    <div className="jarvis-panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-white/5 px-2 py-2">
        <Network className="h-3.5 w-3.5 text-emerald-300" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Runs</span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-white/5 p-1.5">
        {(['all', 'active', 'completed', 'failed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => changeFilter(f)}
            className={cn(
              'flex-1 rounded px-1.5 py-1 text-[10px] font-medium capitalize transition-colors',
              filter === f ? 'bg-emerald-400/15 text-emerald-200' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Virtualized list */}
      <div ref={scrollRef} className="scrollbar-none flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner size="default" />
          </div>
        ) : workflows.length === 0 ? (
          <EmptyState
            icon={<Network className="h-5 w-5" />}
            title="No runs"
            description={filter === 'active' ? 'No active workflows.' : 'No runs match this filter.'}
            className="py-10"
          />
        ) : (
          <div style={{ height: `${totalSize}px`, position: 'relative', width: '100%' }}>
            {items.map((vi) => {
              const w = workflows[vi.index]!;
              return (
                <div
                  key={w.id}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                >
                  <RunRow workflow={w} selected={w.id === selectedId} onSelect={onSelect} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 border-t border-white/5 p-1.5">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          {pageWindow.map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={cn(
                'jarvis-readout rounded px-2 py-0.5 text-[10px]',
                p === page ? 'bg-emerald-400/20 text-emerald-200' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p}
            </button>
          ))}
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}