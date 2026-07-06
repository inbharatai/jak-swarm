'use client';

// ─── JARVIS Inspector — cost & token gauges ──────────────────────────────────
//
// SVG circular gauges driven by GET /traces/workflow/:id/timeline
// (totalCostUsd, totalInputTokens, totalOutputTokens). Honest: when the
// timeline is unavailable or the run has no persisted traces yet, the
// gauges read 0 with a "No data yet" footnote — never fabricated numbers.

import type { WorkflowTimeline } from '@/lib/api-client';

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

interface GaugeProps {
  label: string;
  value: string;
  /** 0..1 fill fraction */
  fraction: number;
  accent: string; // stroke color
  sub?: string;
}

function Gauge({ label, value, fraction, accent, sub }: GaugeProps) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, fraction));
  const dash = c * clamped;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={accent}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            style={{ filter: `drop-shadow(0 0 6px ${accent}aa)`, transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="jarvis-readout text-sm font-semibold text-foreground">{value}</span>
          {sub && <span className="jarvis-readout text-[9px] text-muted-foreground">{sub}</span>}
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

// Normalize a value against a soft ceiling so the gauge arc is meaningful
// without implying a hard cap. Returns 0..1.
function softFraction(value: number, ceiling: number): number {
  if (value <= 0 || ceiling <= 0) return 0;
  return value / ceiling;
}

export function CostTokenGauges({ timeline }: { timeline: WorkflowTimeline | null }) {
  const cost = timeline?.totalCostUsd ?? 0;
  const inputT = timeline?.totalInputTokens ?? 0;
  const outputT = timeline?.totalOutputTokens ?? 0;
  const hasData = !!timeline && timeline.nodeCount > 0;

  return (
    <div className="jarvis-panel flex h-full flex-col p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Cost &amp; Tokens
      </h4>
      <div className="flex flex-1 items-center justify-around gap-2">
        <Gauge
          label="Cost"
          value={formatUsd(cost)}
          fraction={softFraction(cost, 1)}
          accent="hsl(158 64% 52%)"
        />
        <Gauge
          label="Input"
          value={formatTokens(inputT)}
          fraction={softFraction(inputT, 50_000)}
          accent="hsl(190 90% 55%)"
          sub={hasData ? `${timeline?.nodeCount ?? 0} nodes` : undefined}
        />
        <Gauge
          label="Output"
          value={formatTokens(outputT)}
          fraction={softFraction(outputT, 20_000)}
          accent="hsl(280 80% 65%)"
        />
      </div>
      {hasData && timeline?.criticalPath && timeline.criticalPath.length > 0 && (
        <div className="mt-3 border-t border-white/5 pt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Critical path</p>
          <p className="jarvis-readout mt-1 text-[11px] text-foreground">
            {timeline.criticalPath.join(' → ')}
          </p>
        </div>
      )}
      {!hasData && (
        <p className="mt-3 border-t border-white/5 pt-2 text-center jarvis-readout text-[10px] text-muted-foreground">
          No data yet — timeline populates from persisted traces
        </p>
      )}
    </div>
  );
}