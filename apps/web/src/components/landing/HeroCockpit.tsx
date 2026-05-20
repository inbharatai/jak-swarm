'use client';

/**
 * HeroCockpit — premium animated mockup that shows the complete JAK loop
 * inside the hero fold:
 *
 *   user command  →  plan  →  agents execute  →  approval gate  →  output  →  audit trail
 *
 * Visual language matches the real cockpit (chat input + plan card + agent
 * chips + approval card + output card + audit ribbon) so a visitor sees what
 * the product actually looks like, not a generic abstract diagram.
 *
 * Animation: a single 12-second loop. Respects prefers-reduced-motion via
 * useStillMode (renders the final frame statically).
 */

import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { useStillMode } from './useStillMode';

const COMMAND = 'Turn customer feedback and GitHub issues into an execution spec';

// Each plan step maps to the Company OS foundation that ships today.
const PLAN = [
  { n: 1, role: 'Company Brain', task: 'Load cited customer + code evidence', color: '#38bdf8' },
  { n: 2, role: 'Drift Detector', task: 'Find customer pain without matching work', color: '#fbbf24' },
  { n: 3, role: 'Spec Generator', task: 'Create acceptance criteria + test plan', color: '#34d399' },
  { n: 4, role: 'Approval', task: 'Reviewer approves before agents execute', color: '#f472b6' },
];

// Output snippet shown after approval — short enough to render at hero scale.
const OUTPUT_SNIPPET =
  'Spec: reduce onboarding drop-off. Evidence: 6 customer calls + 4 GitHub issues. Acceptance criteria: guided import, empty-state copy, Playwright regression, rollout approval.';

type Phase = 'typing' | 'plan' | 'executing' | 'approval' | 'output' | 'audit';

function classNamesFor(phase: Phase, current: Phase): string {
  const order: Phase[] = ['typing', 'plan', 'executing', 'approval', 'output', 'audit'];
  return order.indexOf(current) >= order.indexOf(phase) ? 'opacity-100' : 'opacity-0';
}

export default function HeroCockpit() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: false, amount: 0.2 });
  const isStillMode = useStillMode();
  const [typedText, setTypedText] = useState('');
  const [phase, setPhase] = useState<Phase>('typing');
  const [agentStep, setAgentStep] = useState(0); // 0..3 for the 3 active execution agents

  // Drive the animation loop.
  useEffect(() => {
    if (!isInView || isStillMode) return;
    let timers: ReturnType<typeof setTimeout>[] = [];

    const run = () => {
      // Reset.
      setTypedText('');
      setAgentStep(0);
      setPhase('typing');

      // 1. Type the command character-by-character (~1.2s)
      let i = 0;
      const type = setInterval(() => {
        if (i <= COMMAND.length) {
          setTypedText(COMMAND.slice(0, i));
          i += 1;
        } else {
          clearInterval(type);
        }
      }, 22);
      timers.push(type as unknown as ReturnType<typeof setTimeout>);

      // 2. Plan card.
      timers.push(setTimeout(() => setPhase('plan'), 1500));
      // 3. Execution chips light up one by one (3 agents × 700ms).
      timers.push(setTimeout(() => setPhase('executing'), 2400));
      timers.push(setTimeout(() => setAgentStep(1), 2700));
      timers.push(setTimeout(() => setAgentStep(2), 3500));
      timers.push(setTimeout(() => setAgentStep(3), 4300));
      // 4. Approval card.
      timers.push(setTimeout(() => setPhase('approval'), 5200));
      // 5. Output preview.
      timers.push(setTimeout(() => setPhase('output'), 7200));
      // 6. Audit ribbon.
      timers.push(setTimeout(() => setPhase('audit'), 8400));
      // Loop.
      timers.push(setTimeout(run, 13000));
    };

    run();
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [isInView, isStillMode]);

  // Still mode: render the final frame statically.
  useEffect(() => {
    if (!isStillMode) return;
    setTypedText(COMMAND);
    setAgentStep(3);
    setPhase('audit');
  }, [isStillMode]);

  const statusLabel =
    phase === 'audit' ? 'complete'
    : phase === 'approval' ? 'awaiting approval'
    : 'running';
  const statusColor =
    phase === 'audit' ? '#34d399'
    : phase === 'approval' ? '#fbbf24'
    : '#38bdf8';

  return (
    <div ref={ref} className="relative mx-auto max-w-4xl w-full">
      {/* Soft glow halo behind the cockpit window for depth */}
      <div
        className="absolute -inset-4 rounded-[2rem] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 30% 20%, rgba(52,211,153,0.18), transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(244,114,182,0.12), transparent 60%)',
          filter: 'blur(40px)',
        }}
        aria-hidden="true"
      />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={isInView || isStillMode ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: isStillMode ? 0 : 0.7, delay: 0.2 }}
        className="relative rounded-2xl overflow-hidden backdrop-blur-xl"
        style={{
          background: 'linear-gradient(180deg, rgba(20,20,24,0.92), rgba(15,15,20,0.92))',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow:
            '0 30px 80px -20px rgba(0,0,0,0.6), 0 0 60px rgba(52,211,153,0.06), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
        aria-label="JAK cockpit demo: command, plan, execution, approval, output, audit"
      >
        {/* Window chrome */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-white/5">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
          </div>
          <span className="text-[11px] sm:text-xs font-mono text-slate-400 truncate">
            JAK Cockpit · Workflow #847
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full transition-colors"
              style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}80` }}
              aria-hidden="true"
            />
            <span className="text-[10px] sm:text-[11px] font-mono text-slate-400 tabular-nums">
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="p-3 sm:p-5 space-y-3 sm:space-y-4 text-left">
          {/* Stage 1 — User command */}
          <div className="flex items-start gap-2 sm:gap-3">
            <span className="text-emerald-400 font-mono text-xs sm:text-sm shrink-0 mt-0.5">{'>'}</span>
            <div className="font-mono text-xs sm:text-sm text-white/90 break-words min-w-0 flex-1">
              {typedText}
              {phase === 'typing' && !isStillMode && (
                <span
                  className="inline-block w-[2px] h-3.5 bg-emerald-400 ml-0.5 align-middle"
                  style={{ animation: 'cockpit-blink 1s step-end infinite' }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>

          {/* Stage 2 — Plan card */}
          <motion.div
            className={`rounded-xl border border-white/10 overflow-hidden transition-opacity duration-500 ${classNamesFor('plan', phase)}`}
            style={{ background: 'rgba(255,255,255,0.02)' }}
            aria-hidden={phase === 'typing'}
          >
            <div className="px-3 sm:px-4 py-2 border-b border-white/5 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
              <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-wider text-amber-300/90">
                JAK · Plan (4 steps)
              </span>
            </div>
            <ul className="p-2 sm:p-3 space-y-1.5">
              {PLAN.map((p) => (
                <li
                  key={p.n}
                  className="flex items-center gap-2 sm:gap-3 px-2 py-1.5 rounded-md"
                  style={{ background: 'rgba(255,255,255,0.015)' }}
                >
                  <span
                    className="shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-md flex items-center justify-center text-[10px] sm:text-[11px] font-mono font-bold tabular-nums"
                    style={{
                      background: `${p.color}15`,
                      border: `1px solid ${p.color}40`,
                      color: p.color,
                    }}
                  >
                    {p.n}
                  </span>
                  <span
                    className="text-[10px] sm:text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: p.color, background: `${p.color}10`, border: `1px solid ${p.color}25` }}
                  >
                    {p.role}
                  </span>
                  <span className="text-[11px] sm:text-xs text-slate-300 font-sans truncate">{p.task}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Stage 3 — Agent execution row */}
          <div
            className={`flex flex-wrap gap-2 transition-opacity duration-500 ${classNamesFor('executing', phase)}`}
            aria-label="Agents executing"
          >
            {PLAN.slice(0, 3).map((p, i) => {
              const done = agentStep > i;
              const running = agentStep === i;
              return (
                <div
                  key={p.role}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                  style={{
                    background: done ? `${p.color}10` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${done ? `${p.color}40` : 'rgba(255,255,255,0.08)'}`,
                    transition: 'all 300ms ease',
                  }}
                >
                  {done ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke={p.color} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : running ? (
                    <span
                      className="w-3 h-3 rounded-full border-2 border-t-transparent"
                      style={{
                        borderColor: `${p.color}80`,
                        borderTopColor: 'transparent',
                        animation: 'cockpit-spin 0.8s linear infinite',
                      }}
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="w-3 h-3 rounded-full border border-white/15" aria-hidden="true" />
                  )}
                  <span
                    className="text-[10px] sm:text-[11px] font-mono font-semibold"
                    style={{ color: done || running ? p.color : '#94a3b8' }}
                  >
                    {p.role}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Stage 4 — Approval card */}
          <motion.div
            className={`rounded-xl overflow-hidden transition-opacity duration-500 ${classNamesFor('approval', phase)}`}
            style={{
              background: 'linear-gradient(180deg, rgba(251,191,36,0.08), rgba(251,191,36,0.02))',
              border: '1px solid rgba(251,191,36,0.35)',
              boxShadow: '0 0 24px rgba(251,191,36,0.08)',
            }}
            aria-hidden={['typing', 'plan', 'executing'].includes(phase)}
          >
            <div className="px-3 sm:px-4 py-2 border-b border-amber-400/20 flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-amber-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-wider text-amber-300">
                Approval required · before risky action
              </span>
            </div>
            <div className="p-3 sm:p-4 space-y-2">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] sm:text-xs font-sans">
                <span className="text-slate-500">Tool</span>
                <span className="text-white font-mono">agent_spec_approval</span>
                <span className="text-slate-500">Reviewer</span>
                <span className="text-white">Product owner required</span>
                <span className="text-slate-500">Spec scope</span>
                <span className="text-slate-200 line-clamp-1">
                  &ldquo;Reduce onboarding drop-off with cited evidence&hellip;&rdquo;
                </span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-[11px] sm:text-xs font-semibold text-[#09090b]"
                  style={{
                    background: 'linear-gradient(135deg, #34d399, #fbbf24)',
                    cursor: 'default',
                  }}
                  aria-label="Approve (demo)"
                  tabIndex={-1}
                >
                  Approve spec
                </button>
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-[11px] sm:text-xs font-semibold text-slate-300 border border-white/10 hover:bg-white/5"
                  style={{ cursor: 'default' }}
                  aria-label="Reject (demo)"
                  tabIndex={-1}
                >
                  Reject
                </button>
                <span className="text-[10px] font-mono text-slate-500 self-center ml-auto">
                  Replays with a different payload are rejected
                </span>
              </div>
            </div>
          </motion.div>

          {/* Stage 5 — Output card */}
          <div
            className={`rounded-xl overflow-hidden transition-opacity duration-500 ${classNamesFor('output', phase)}`}
            style={{
              background: 'linear-gradient(180deg, rgba(52,211,153,0.06), rgba(52,211,153,0.01))',
              border: '1px solid rgba(52,211,153,0.30)',
            }}
            aria-hidden={['typing', 'plan', 'executing', 'approval'].includes(phase)}
          >
            <div className="px-3 sm:px-4 py-2 border-b border-emerald-400/15 flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-emerald-300" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-wider text-emerald-300">
                Output ready · spec + test plan
              </span>
            </div>
            <p className="p-3 sm:p-4 text-[11px] sm:text-xs text-slate-200 font-sans leading-relaxed">
              {OUTPUT_SNIPPET}
            </p>
          </div>

          {/* Stage 6 — Audit ribbon */}
          <div
            className={`flex flex-wrap items-center gap-2 sm:gap-3 rounded-xl px-3 py-2 transition-opacity duration-500 ${classNamesFor('audit', phase)}`}
            style={{
              background: 'rgba(251,146,60,0.06)',
              border: '1px solid rgba(251,146,60,0.30)',
            }}
            aria-hidden={phase !== 'audit'}
          >
            <svg className="w-3.5 h-3.5 text-orange-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
            </svg>
            <span className="text-[10px] sm:text-[11px] font-mono text-orange-200/90">
              Audit trail saved
            </span>
            <span className="text-[10px] font-mono text-slate-500">·</span>
            <span className="text-[10px] sm:text-[11px] font-mono text-slate-300">
              HMAC-SHA256 verified
            </span>
            <span className="text-[10px] font-mono text-slate-500">·</span>
            <span className="text-[10px] sm:text-[11px] font-mono text-slate-400 tabular-nums">
              run #847
            </span>
            <span className="text-[10px] font-mono text-slate-500 ml-auto hidden sm:inline">
              every step replayable
            </span>
          </div>
        </div>
      </motion.div>

      <style>{`
        @keyframes cockpit-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes cockpit-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
