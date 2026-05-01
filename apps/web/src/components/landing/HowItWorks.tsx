'use client';

/**
 * HowItWorks — the 7-step JAK pipeline:
 *   Command → Plan → Route → Execute → Approve → Verify → Deliver
 *
 * Each step is an icon + short copy + a status microcopy line. The
 * connecting line carries an animated traveling glow so the eye reads
 * the flow left-to-right (top-to-bottom on mobile).
 *
 * No fake numbers, no fake metrics — every step maps to a real piece
 * of the SwarmGraph orchestration (commander → planner → router →
 * worker → approval → verifier → output).
 */

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

interface Step {
  n: number;
  label: string;
  body: string;
  status: string; // small italic line that hints at what's happening live
  color: string;
  iconPath: string;
}

const STEPS: Step[] = [
  {
    n: 1,
    label: 'Command',
    body: 'You type a task in plain English. No syntax, no flags, no special prompt format.',
    status: 'commander.parses(intent)',
    color: '#34d399',
    iconPath: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z',
  },
  {
    n: 2,
    label: 'Plan',
    body: 'JAK breaks the task into ordered steps you can review before anything runs.',
    status: 'planner.decompose() → 4 steps',
    color: '#fbbf24',
    iconPath: 'M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z',
  },
  {
    n: 3,
    label: 'Route',
    body: 'Each step goes to the right specialist agent — research, content, code, ops, design.',
    status: 'router.assign(task → CMO / CTO / Research)',
    color: '#38bdf8',
    iconPath: 'M4 7h12M4 12h16M4 17h8M19 17l3 3-3 3M22 7l-3-3 3-3M16 7l3-3M19 17l-3 3',
  },
  {
    n: 4,
    label: 'Execute',
    body: 'Specialists run with your connected tools — Gmail, Slack, GitHub, Notion, the browser.',
    status: 'worker.run() · live in cockpit',
    color: '#c084fc',
    iconPath: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  },
  {
    n: 5,
    label: 'Approve',
    body: 'Anything risky pauses for you. Inline card shows tool, payload, files, expected result.',
    status: 'approval.gate(payload-bound)',
    color: '#f472b6',
    iconPath: 'M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12z',
  },
  {
    n: 6,
    label: 'Verify',
    body: 'JAK checks the work — citations, tone, safety, hallucination, payload integrity.',
    status: 'verifier.check() · 4-layer',
    color: '#34d399',
    iconPath: 'M12 3 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6Z',
  },
  {
    n: 7,
    label: 'Deliver',
    body: 'Final output, signed audit trail, replayable run. Ready to ship — or reuse next time.',
    status: 'output.deliver() · audit.signed',
    color: '#fb923c',
    iconPath: 'M5 12l5 5L20 7',
  },
];

export default function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, amount: 0.2 });

  return (
    <section
      ref={ref}
      id="how-it-works"
      className="relative px-4 py-24 sm:px-6 lg:px-8"
      aria-label="How JAK works"
      style={{
        background: 'linear-gradient(180deg, transparent, rgba(52,211,153,0.025), transparent)',
      }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400 mb-3 font-sans">
            How It Works
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight text-white leading-[1.15]">
            Seven steps from intent to delivered work.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-300 font-sans leading-relaxed">
            Every JAK workflow runs the same pipeline. You see every step. You gate every risky one. You can replay every run.
          </p>
        </div>

        {/* The pipeline */}
        <div className="relative">
          {/* Connecting line on desktop only — sits behind the cards. */}
          <div
            className="absolute left-0 right-0 top-7 h-px hidden lg:block pointer-events-none"
            aria-hidden="true"
          >
            <div className="h-full bg-gradient-to-r from-emerald-500/0 via-amber-400/30 to-orange-400/0" />
            {inView && (
              <div
                className="absolute top-[-1px] h-[3px] w-32 rounded-full"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(52,211,153,0.85), transparent)',
                  filter: 'blur(1px)',
                  animation: 'how-flow 6s ease-in-out infinite',
                }}
              />
            )}
          </div>

          <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4 lg:gap-3 relative">
            {STEPS.map((step, i) => (
              <motion.li
                key={step.n}
                className="flex flex-col items-center text-center min-w-0"
                initial={{ opacity: 0, y: 16 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.4, delay: i * 0.08 }}
              >
                {/* Numbered icon disc */}
                <div className="relative">
                  <div
                    className="relative z-10 w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{
                      background: `linear-gradient(180deg, ${step.color}1a, ${step.color}05)`,
                      border: `1px solid ${step.color}40`,
                      boxShadow: `0 0 24px ${step.color}15, inset 0 1px 0 rgba(255,255,255,0.05)`,
                    }}
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke={step.color} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d={step.iconPath} />
                    </svg>
                  </div>
                  <span
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums z-20 text-[#09090b]"
                    style={{ background: step.color }}
                    aria-label={`Step ${step.n}`}
                  >
                    {step.n}
                  </span>
                </div>

                <div className="mt-3 font-display font-semibold text-white text-sm">
                  {step.label}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400 font-sans leading-relaxed line-clamp-3 max-w-[160px]">
                  {step.body}
                </p>
                <code className="mt-2 text-[9px] font-mono text-slate-500 truncate max-w-full" style={{ color: `${step.color}cc` }}>
                  {step.status}
                </code>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>

      <style>{`
        @keyframes how-flow {
          0% { left: -10%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [class*="how-flow"] { animation: none !important; }
        }
      `}</style>
    </section>
  );
}
