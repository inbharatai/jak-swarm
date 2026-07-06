'use client';

// ─── JARVIS Inspector — tool call stream ─────────────────────────────────────
//
// Per-tool rows extracted from AgentTrace stepsJson/toolCallsJson. ALWAYS
// renders an honest outcome badge (real_success | draft | mock_provider |
// not_configured | blocked | disabled_by_policy | failed) — never hides
// whether a tool actually ran vs mocked/draft/blocked. Mirrors the
// packages/shared ToolOutcome contract; legacy rows without `outcome`
// default to real_success (or failed if an error is present).

import { cn } from '@/lib/cn';
import type { AgentTraceRecord, ToolCall } from '@/types';
import { resolveToolOutcome, toolOutcomeConfig } from './jarvis-event-taxonomy';

interface FlattenedToolCall extends ToolCall {
  traceId: string;
  agentRole: string;
}

function flattenToolCalls(traces: AgentTraceRecord[]): FlattenedToolCall[] {
  const out: FlattenedToolCall[] = [];
  for (const trace of traces) {
    // AgentTraceRecord.steps is unknown[] — the persisted shape carries
    // toolCalls per step. Be defensive: only read toolCalls off objects
    // that actually have them, never fabricate.
    const steps = Array.isArray(trace.steps) ? trace.steps : [];
    for (const step of steps) {
      if (step && typeof step === 'object' && Array.isArray((step as { toolCalls?: unknown }).toolCalls)) {
        for (const tc of (step as { toolCalls: ToolCall[] }).toolCalls) {
          if (tc && typeof tc.toolName === 'string') {
            out.push({ ...tc, traceId: trace.id, agentRole: trace.agentRole });
          }
        }
      }
    }
  }
  // Newest first by startedAt if present.
  return out.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
}

function formatDuration(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolCallStream({ traces }: { traces: AgentTraceRecord[] }) {
  const calls = flattenToolCalls(traces);

  return (
    <div className="jarvis-panel flex h-full flex-col overflow-hidden p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Tool Calls
        <span className="jarvis-readout ml-2 text-[10px] text-muted-foreground">{calls.length}</span>
      </h4>
      <div className="scrollbar-none flex-1 overflow-y-auto pr-1">
        {calls.length === 0 ? (
          <div className="flex h-full items-center justify-center py-8 text-center">
            <p className="jarvis-readout text-xs text-muted-foreground">
              No tool calls recorded<span className="jarvis-pulse">…</span>
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {calls.map((tc) => {
              const outcome = resolveToolOutcome(tc.outcome, tc.error);
              const cfg = toolOutcomeConfig(outcome);
              return (
                <li
                  key={tc.id}
                  className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="jarvis-readout shrink-0 text-[11px] text-muted-foreground">
                      {tc.agentRole}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                      {tc.toolName}
                    </span>
                    <span className="jarvis-readout shrink-0 text-[10px] text-muted-foreground">
                      {formatDuration(tc.durationMs)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium',
                        cfg.badgeClass,
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dotClass)} />
                      {cfg.label}
                    </span>
                    {tc.outcomeMessage && (
                      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title={tc.outcomeMessage}>
                        {tc.outcomeMessage}
                      </span>
                    )}
                    {tc.error && !tc.outcomeMessage && (
                      <span className="min-w-0 flex-1 truncate text-[10px] text-rose-300/80" title={tc.error}>
                        {tc.error}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}