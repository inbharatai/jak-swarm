'use client';

// ─── JARVIS Inspector — live Gantt ───────────────────────────────────────────
//
// Extracted from the original swarm/page.tsx AgentTimeline logic, made live:
// bars are derived from AgentTraceRecord startedAt/completedAt. Running
// traces (no completedAt) extend to `now` and pulse. Neon role colors on the
// dark surface. Honest: 0 traces → "No agent traces yet — waiting for planner".

import { cn } from '@/lib/cn';
import type { AgentTraceRecord } from '@/types';

const ROLE_COLORS: Record<string, string> = {
  COMMANDER:      'bg-violet-400',
  PLANNER:        'bg-sky-400',
  ROUTER:         'bg-cyan-400',
  GUARDRAIL:      'bg-amber-400',
  WORKER_EMAIL:   'bg-emerald-400',
  WORKER_BROWSER: 'bg-indigo-400',
  WORKER_RESEARCH:'bg-teal-400',
  WORKER_DOCUMENT:'bg-orange-400',
  WORKER_SUPPORT: 'bg-pink-400',
  VERIFIER:       'bg-rose-400',
  APPROVAL:       'bg-yellow-400',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function LiveGantt({ traces, now = Date.now() }: { traces: AgentTraceRecord[]; now?: number }) {
  const withTimes = traces.filter((t) => t.startedAt);
  if (withTimes.length === 0) {
    return (
      <div className="jarvis-panel flex h-full flex-col p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Agent Gantt
        </h4>
        <div className="flex flex-1 items-center justify-center py-8 text-center">
          <p className="jarvis-readout text-xs text-muted-foreground">
            No agent traces yet — waiting for planner<span className="jarvis-pulse">…</span>
          </p>
        </div>
      </div>
    );
  }

  const minTime = Math.min(...withTimes.map((t) => new Date(t.startedAt).getTime()));
  const maxTime = Math.max(...withTimes.map((t) =>
    t.completedAt ? new Date(t.completedAt).getTime() : now,
  ));
  const totalDuration = Math.max(1, maxTime - minTime);

  return (
    <div className="jarvis-panel flex h-full flex-col p-3">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Agent Gantt
        <span className="jarvis-readout ml-2 text-[10px] text-muted-foreground">{withTimes.length}</span>
      </h4>
      <div className="scrollbar-none flex-1 space-y-1.5 overflow-y-auto pr-1">
        {withTimes.map((trace) => {
          const start = new Date(trace.startedAt).getTime();
          const end = trace.completedAt ? new Date(trace.completedAt).getTime() : now;
          const startOffset = ((start - minTime) / totalDuration) * 100;
          const widthPct = Math.max(1, ((end - start) / totalDuration) * 100);
          const running = !trace.completedAt;
          return (
            <div key={trace.id} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-right text-[10px] text-muted-foreground">
                {trace.agentRole}
              </span>
              <div className="relative h-4 flex-1 overflow-hidden rounded bg-white/5">
                <div
                  className={cn(
                    'absolute top-0 h-full rounded',
                    ROLE_COLORS[trace.agentRole] ?? 'bg-primary',
                    running && 'jarvis-pulse',
                  )}
                  style={{
                    left: `${startOffset}%`,
                    width: `${widthPct}%`,
                    boxShadow: running ? '0 0 8px hsl(158 64% 52% / 0.5)' : undefined,
                  }}
                  title={`${trace.agentRole} · ${formatDuration(end - start)}`}
                />
              </div>
              <span className="jarvis-readout w-12 shrink-0 text-right text-[10px] text-muted-foreground">
                {formatDuration(end - start)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}