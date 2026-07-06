'use client';

// ─── JARVIS Inspector — approval gate state ──────────────────────────────────
//
// Renders pending approval requests for the selected run (GET /workflows/:id/
// approvals) + the live `paused` SSE state. Risk level is shown honestly;
// when the run is paused but no persisted approval row is visible yet, we
// say so instead of inventing one.

import { cn } from '@/lib/cn';
import type { ApprovalRequest } from '@/types';

const RISK_BADGE: Record<string, string> = {
  LOW: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  MEDIUM: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  HIGH: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  CRITICAL: 'bg-rose-500/25 text-rose-200 border-rose-500/40',
};

export function ApprovalGateState({
  approvals,
  paused,
}: {
  approvals: ApprovalRequest[];
  paused: boolean;
}) {
  const pending = approvals.filter((a) => a.status === 'PENDING');

  return (
    <div className="jarvis-panel flex h-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Approval Gate
        </h4>
        {paused ? (
          <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 jarvis-pulse" />
            Paused
          </span>
        ) : (
          <span className="jarvis-readout text-[10px] text-muted-foreground">Running</span>
        )}
      </div>
      <div className="scrollbar-none flex-1 overflow-y-auto pr-1">
        {pending.length === 0 ? (
          <div className="flex h-full items-center justify-center py-6 text-center">
            <p className="jarvis-readout text-xs text-muted-foreground">
              {paused
                ? 'Paused — awaiting decision…'
                : 'No pending approvals'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {pending.map((a) => (
              <li
                key={a.id}
                className="rounded border border-amber-500/20 bg-amber-500/[0.04] p-2"
              >
                <div className="flex items-center gap-2">
                  <span className="jarvis-readout shrink-0 text-[10px] text-muted-foreground">
                    {a.agentRole}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                    {a.action}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold',
                      RISK_BADGE[a.riskLevel] ?? 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
                    )}
                  >
                    {a.riskLevel}
                  </span>
                </div>
                {a.rationale && (
                  <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{a.rationale}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}