'use client';

/**
 * ProductCockpit — premium dashboard mockup for the Product Cockpit
 * section of the landing page.
 *
 * Layout (desktop):
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ window chrome: dots · workspace · status                         │
 *   ├──────────────┬──────────────────────────────┬───────────────────┤
 *   │ LEFT panel   │ CENTER panel                 │ RIGHT panel       │
 *   │ user command │ live agent graph             │ approval card     │
 *   │ history      │ + execution trace            │ + output preview  │
 *   ├──────────────┴──────────────────────────────┴───────────────────┤
 *   │ BOTTOM panel: audit timeline                                    │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Layout (mobile): stacks left → center → right → bottom.
 *
 * Difference from HeroCockpit: HeroCockpit is a single-pane animated
 * loop in the hero. ProductCockpit is a wider, multi-panel dashboard
 * that mirrors the actual cockpit at /workspace — left rail with the
 * conversation, center with the live agent graph, right with the
 * approval card, audit ribbon at the bottom.
 *
 * No fake numbers. Every label maps to a real cockpit or Company OS
 * surface that ships in /apps/web.
 */

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { useStillMode } from './useStillMode';

/* Dummy data — labeled so the panels feel like a real workspace, not a
   placeholder grid. */

const COMMAND = {
  text: 'Compare customer feedback with this sprint and generate the execution spec',
  meta: 'sent 12s ago · workflow #847',
};

const HISTORY = [
  { label: 'Customer signal drift · 3 findings', tone: 'orange' },
  { label: 'Onboarding spec · approved', tone: 'emerald' },
  { label: 'Evidence pack · exported', tone: 'sky' },
] as const;

interface GraphNode {
  id: string;
  role: string;
  state: 'done' | 'running' | 'queued';
  color: string;
  // grid coords (1-based) within the SVG so we can draw connectors.
  col: number;
  row: number;
}

const NODES: GraphNode[] = [
  { id: 'cmd', role: 'Commander', state: 'done', color: '#fbbf24', col: 1, row: 2 },
  { id: 'brain', role: 'Company Brain', state: 'done', color: '#38bdf8', col: 2, row: 2 },
  { id: 'signals', role: 'Signals', state: 'done', color: '#38bdf8', col: 3, row: 1 },
  { id: 'sprint', role: 'Sprint', state: 'done', color: '#34d399', col: 3, row: 3 },
  { id: 'drift', role: 'Drift', state: 'running', color: '#fbbf24', col: 4, row: 2 },
  { id: 'verify', role: 'Verifier', state: 'queued', color: '#34d399', col: 5, row: 2 },
];

const EDGES: Array<[string, string]> = [
  ['cmd', 'brain'],
  ['brain', 'signals'],
  ['brain', 'sprint'],
  ['signals', 'drift'],
  ['sprint', 'drift'],
  ['drift', 'verify'],
];

const TIMELINE = [
  { t: '00:00', label: 'Workflow #847 started', color: '#fbbf24' },
  { t: '00:02', label: 'Evidence artifacts loaded', color: '#38bdf8' },
  { t: '00:05', label: 'Customer signals extracted', color: '#38bdf8' },
  { t: '00:08', label: 'Sprint work compared', color: '#34d399' },
  { t: '00:12', label: 'Drift finding · high', color: '#fbbf24' },
  { t: '—', label: 'Spec approval · awaiting', color: '#f472b6' },
];

/* Node positioning helpers — translate (col, row) → SVG coordinates. */
const VIEW_W = 520;
const VIEW_H = 220;
const COL_GAP = VIEW_W / 6;
const ROW_GAP = VIEW_H / 4;
const xOf = (col: number) => COL_GAP * col;
const yOf = (row: number) => ROW_GAP * row;

function NodeStateDot({ state, color }: { state: GraphNode['state']; color: string }) {
  if (state === 'done') {
    return (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke={color} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    );
  }
  if (state === 'running') {
    return (
      <span
        className="w-2.5 h-2.5 rounded-full border-2 border-t-transparent"
        style={{
          borderColor: `${color}aa`,
          borderTopColor: 'transparent',
          animation: 'pc-spin 0.9s linear infinite',
        }}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="w-2.5 h-2.5 rounded-full border"
      style={{ borderColor: 'rgba(255,255,255,0.18)' }}
      aria-hidden="true"
    />
  );
}

export default function ProductCockpit() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, amount: 0.15 });
  const isStillMode = useStillMode();
  const animateLines = inView && !isStillMode;

  return (
    <section
      ref={ref}
      id="cockpit"
      className="relative px-4 py-24 sm:px-6 lg:px-8"
      aria-label="Product cockpit"
      style={{ background: 'linear-gradient(180deg, transparent, rgba(56,189,248,0.03), transparent)' }}
    >
      <div className="mx-auto max-w-6xl">
        {/* Section header */}
        <div className="text-center mb-12 max-w-3xl mx-auto">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400 mb-3 font-sans">
            The Cockpit
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight text-white leading-[1.15]">
            Every workflow, one operating surface.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-300 font-sans leading-relaxed">
            Your command on the left. The agent graph in the middle. The approval card and the result on the right. The audit on the bottom. One place to run, gate, and prove the work.
          </p>
        </div>

        {/* Cockpit window */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="relative rounded-2xl overflow-hidden backdrop-blur-xl"
          style={{
            background: 'linear-gradient(180deg, rgba(20,20,24,0.95), rgba(15,15,20,0.95))',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6), 0 0 60px rgba(56,189,248,0.05)',
          }}
        >
          {/* Window chrome */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5">
            <div className="flex gap-1.5" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
            </div>
            <span className="text-xs font-mono text-slate-400 truncate">
              JAK Cockpit · /workspace
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: '#fbbf24', boxShadow: '0 0 8px #fbbf2480' }}
                aria-hidden="true"
              />
              <span className="text-[11px] font-mono text-slate-400">awaiting approval</span>
            </div>
          </div>

          {/* Body — three columns on desktop, stacked on mobile */}
          <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr_270px] divide-y lg:divide-y-0 lg:divide-x divide-white/5">
            {/* ── LEFT: command + history ───────────────────────────── */}
            <div className="p-4 sm:p-5 space-y-4 min-w-0">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">
                  Your command
                </p>
                <div
                  className="rounded-lg p-3"
                  style={{
                    background: 'rgba(52,211,153,0.06)',
                    border: '1px solid rgba(52,211,153,0.2)',
                  }}
                >
                  <p className="text-xs sm:text-[13px] text-slate-100 font-sans leading-relaxed">
                    {COMMAND.text}
                  </p>
                  <p className="mt-2 text-[10px] font-mono text-emerald-300/70">
                    {COMMAND.meta}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">
                  Recent runs
                </p>
                <ul className="space-y-1.5">
                  {HISTORY.map((h) => (
                    <li
                      key={h.label}
                      className="flex items-start gap-2 px-2 py-1.5 rounded-md text-[11px] text-slate-300 font-sans hover:bg-white/[0.02] transition-colors"
                    >
                      <span
                        className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                          h.tone === 'emerald' ? 'bg-emerald-400'
                          : h.tone === 'orange' ? 'bg-orange-400'
                          : 'bg-sky-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="line-clamp-2">{h.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* ── CENTER: live agent graph ─────────────────────────── */}
            <div className="p-4 sm:p-5 min-w-0">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  Agent graph · live
                </p>
                <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                  4/5 done · 1 running
                </span>
              </div>

              <div className="relative w-full" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
                <svg
                  viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                  className="absolute inset-0 w-full h-full"
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  {/* Edges */}
                  <g>
                    {EDGES.map(([from, to], i) => {
                      const a = NODES.find((n) => n.id === from)!;
                      const b = NODES.find((n) => n.id === to)!;
                      // edge "completeness": done if both nodes done, running if reaches a running node
                      const bothDone = a.state === 'done' && b.state === 'done';
                      const reachingRunning = a.state === 'done' && b.state === 'running';
                      const stroke = bothDone ? 'rgba(52,211,153,0.35)' : reachingRunning ? 'rgba(244,114,182,0.45)' : 'rgba(255,255,255,0.08)';
                      return (
                        <path
                          key={i}
                          d={`M ${xOf(a.col)} ${yOf(a.row)} C ${xOf(a.col) + 30} ${yOf(a.row)}, ${xOf(b.col) - 30} ${yOf(b.row)}, ${xOf(b.col)} ${yOf(b.row)}`}
                          stroke={stroke}
                          strokeWidth={1.4}
                          fill="none"
                          strokeDasharray={reachingRunning && animateLines ? '6 6' : undefined}
                          style={reachingRunning && animateLines ? { animation: 'pc-dash 1.4s linear infinite' } : undefined}
                        />
                      );
                    })}
                  </g>
                </svg>

                {/* Nodes positioned absolutely over the SVG. */}
                {NODES.map((n) => (
                  <div
                    key={n.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 text-[10px] font-mono whitespace-nowrap"
                    style={{
                      left: `${(xOf(n.col) / VIEW_W) * 100}%`,
                      top: `${(yOf(n.row) / VIEW_H) * 100}%`,
                      background: n.state === 'queued' ? 'rgba(255,255,255,0.03)' : `${n.color}10`,
                      border: `1px solid ${n.state === 'queued' ? 'rgba(255,255,255,0.08)' : n.color + '40'}`,
                      color: n.state === 'queued' ? '#94a3b8' : n.color,
                      boxShadow: n.state === 'running' ? `0 0 16px ${n.color}33` : 'none',
                    }}
                  >
                    <NodeStateDot state={n.state} color={n.color} />
                    <span className="font-semibold">{n.role}</span>
                  </div>
                ))}
              </div>

              {/* Tiny live legend */}
              <div className="mt-3 flex items-center gap-3 text-[10px] font-mono text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> done
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" /> running
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full border border-white/20" /> queued
                </span>
              </div>
            </div>

            {/* ── RIGHT: approval + output preview ─────────────────── */}
            <div className="p-4 sm:p-5 space-y-4 min-w-0">
              {/* Approval card */}
              <div
                className="rounded-lg overflow-hidden"
                style={{
                  background: 'linear-gradient(180deg, rgba(251,191,36,0.08), rgba(251,191,36,0.02))',
                  border: '1px solid rgba(251,191,36,0.4)',
                  boxShadow: '0 0 24px rgba(251,191,36,0.08)',
                }}
              >
                <div className="px-3 py-2 border-b border-amber-400/20 flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-amber-300" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75M2.697 16.126c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-amber-300">
                    Approval required
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] font-mono">
                    <span className="text-slate-500">tool</span>
                    <span className="text-white">agent_spec_approval</span>
                    <span className="text-slate-500">payload</span>
                    <span className="text-slate-200 truncate">spec + test plan</span>
                    <span className="text-slate-500">replay-safe</span>
                    <span className="text-emerald-300">payload-bound ✓</span>
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    <button
                      type="button"
                      tabIndex={-1}
                      className="rounded-md px-2.5 py-1 text-[10px] font-semibold text-[#09090b]"
                      style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24)', cursor: 'default' }}
                      aria-label="Approve (demo)"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="rounded-md px-2.5 py-1 text-[10px] font-semibold text-slate-300 border border-white/10"
                      style={{ cursor: 'default' }}
                      aria-label="Reject (demo)"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>

              {/* Output preview */}
              <div
                className="rounded-lg overflow-hidden"
                style={{
                  background: 'linear-gradient(180deg, rgba(52,211,153,0.06), rgba(52,211,153,0.01))',
                  border: '1px solid rgba(52,211,153,0.30)',
                }}
              >
                <div className="px-3 py-2 border-b border-emerald-400/15 flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-emerald-300" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                    Spec preview · acceptance criteria
                  </span>
                </div>
                <p className="p-3 text-[11px] text-slate-200 font-sans leading-relaxed">
                  &ldquo;Objective: reduce onboarding drop-off. Evidence: customer calls and GitHub issues. Acceptance criteria: guided import, empty-state copy, Playwright regression, rollout approval&hellip;&rdquo;
                </p>
              </div>
            </div>
          </div>

          {/* ── BOTTOM: audit timeline ─────────────────────────────── */}
          <div className="border-t border-white/5 px-4 sm:px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-orange-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
                </svg>
                <span className="text-[10px] font-mono uppercase tracking-wider text-orange-300">
                  Audit timeline · run #847
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">
                HMAC-SHA256 · every step replayable
              </span>
            </div>

            {/* Horizontally scrollable on mobile, evenly distributed on desktop. */}
            <div className="relative">
              <div className="absolute left-0 right-0 top-[18px] h-px bg-white/5" aria-hidden="true" />
              <ol className="relative grid grid-cols-3 sm:grid-cols-6 gap-3">
                {TIMELINE.map((t, i) => (
                  <li key={i} className="flex flex-col items-start min-w-0">
                    <span
                      className="w-3.5 h-3.5 rounded-full border-2 z-10"
                      style={{
                        background: '#0f0f14',
                        borderColor: t.color,
                        boxShadow: `0 0 10px ${t.color}55`,
                      }}
                      aria-hidden="true"
                    />
                    <span className="mt-2 text-[9px] font-mono text-slate-500 tabular-nums">{t.t}</span>
                    <span className="mt-0.5 text-[10px] sm:text-[11px] text-slate-300 font-sans line-clamp-2">{t.label}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </motion.div>
      </div>

      <style>{`
        @keyframes pc-spin { to { transform: rotate(360deg); } }
        @keyframes pc-dash { to { stroke-dashoffset: -24; } }
      `}</style>
    </section>
  );
}
