'use client';

// ─── JARVIS Inspector — live event feed ──────────────────────────────────────
//
// Renders the REAL SSE event taxonomy emitted by swarm-execution.service.ts
// (see jarvis-event-taxonomy.ts). Monospace timestamps (JetBrains_Mono via
// .jarvis-readout), auto-scroll to latest with a "Follow latest" toggle.
// No mock events — empty state is honest: "Waiting for events…"

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { WorkflowEvent } from '@/hooks/useWorkflowStream';
import { jarvisEventConfig } from './jarvis-event-taxonomy';

function formatTime(ts?: string): string {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function EventFeed({ events }: { events: WorkflowEvent[] }) {
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (follow && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events, follow]);

  // If the user scrolls up, stop following. If they scroll back to the
  // bottom, resume.
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== follow) setFollow(atBottom);
  }

  return (
    <div className="jarvis-panel flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Event Feed
          <span className="jarvis-readout ml-2 text-[10px] text-muted-foreground">{events.length}</span>
        </h4>
        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
            className="h-3 w-3 accent-emerald-400"
          />
          Follow latest
        </label>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-none flex-1 overflow-y-auto pr-1"
      >
        {events.length === 0 ? (
          <div className="flex h-full items-center justify-center py-8 text-center">
            <p className="jarvis-readout text-xs text-muted-foreground">
              Waiting for events<span className="jarvis-pulse">…</span>
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {events.map((ev, i) => {
              const cfg = jarvisEventConfig(ev.type);
              return (
                <li
                  key={`${i}-${ev.type}-${ev.timestamp ?? ''}`}
                  className="jarvis-readout flex items-start gap-2 rounded px-1.5 py-1 text-[11px] leading-relaxed hover:bg-white/5"
                >
                  <span className="shrink-0 text-muted-foreground">{formatTime(ev.timestamp)}</span>
                  <span className={cn('shrink-0', cfg.accent)}>{cfg.glyph}</span>
                  <span className={cn('shrink-0 font-medium', cfg.accent)}>{cfg.label}</span>
                  {ev.status && ev.status !== ev.type && (
                    <span className="shrink-0 text-muted-foreground">· {ev.status}</span>
                  )}
                  {ev.error && (
                    <span className="min-w-0 truncate text-rose-300/80" title={ev.error}>{ev.error}</span>
                  )}
                </li>
              );
            })}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>
    </div>
  );
}