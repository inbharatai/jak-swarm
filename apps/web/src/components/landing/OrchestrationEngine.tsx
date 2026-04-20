'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useInView } from 'framer-motion';

/* ─── Data ──────────────────────────────────────────────────────────────── */

const MODULES = [
  { id: 'email', label: 'Email', icon: 'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75', color: '#EA4335', angle: -60 },
  { id: 'calendar', label: 'Calendar', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5', color: '#4285F4', angle: -20 },
  { id: 'browser', label: 'Browser', icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582', color: '#34d399', angle: 20 },
  { id: 'research', label: 'Research', icon: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z', color: '#06B6D4', angle: 60 },
  { id: 'code', label: 'Code', icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5', color: '#c084fc', angle: 100 },
  { id: 'docs', label: 'Documents', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z', color: '#8B5CF6', angle: 140 },
  { id: 'crm', label: 'CRM', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z', color: '#F59E0B', angle: 180 },
  { id: 'voice', label: 'Voice', icon: 'M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z', color: '#f472b6', angle: -100 },
  { id: 'ops', label: 'Ops', icon: 'M11.42 15.17l-5.1-3.03m0 0l-.45 1.41m.45-1.41l1.41-.45m-.32 3.94l5.1 3.03m0 0l.45-1.41m-.45 1.41l-1.41.45m6.09-9.26l-5.1-3.03m0 0l-.45 1.41m.45-1.41l1.41-.45m-1.09 5.35l5.1 3.03m0 0l.45-1.41m-.45 1.41l-1.41.45', color: '#fb923c', angle: -140 },
];

const ACTIVE_SEQUENCE = [
  { modules: ['email', 'calendar'], label: 'Schedule meeting from email', duration: 3000 },
  { modules: ['browser', 'research', 'docs'], label: 'Research competitor and write report', duration: 3500 },
  { modules: ['code', 'ops'], label: 'Deploy hotfix to production', duration: 2500 },
  { modules: ['crm', 'email', 'docs'], label: 'Send personalized outreach sequence', duration: 3000 },
];

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function OrchestrationEngine() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: false, amount: 0.3 });
  const [activeStep, setActiveStep] = useState(0);
  const [activeModules, setActiveModules] = useState<string[]>([]);
  const [commandText, setCommandText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'typing' | 'routing' | 'executing' | 'complete'>('idle');

  const currentCommand = ACTIVE_SEQUENCE[activeStep];

  // Animation cycle
  useEffect(() => {
    if (!isInView) return;

    let timeout: ReturnType<typeof setTimeout>;
    let charIndex = 0;

    const runCycle = () => {
      const cmd = ACTIVE_SEQUENCE[activeStep];

      // Phase 1: Type the command
      setPhase('typing');
      setActiveModules([]);
      setCommandText('');
      charIndex = 0;

      const typeChar = () => {
        if (charIndex <= cmd.label.length) {
          setCommandText(cmd.label.slice(0, charIndex));
          charIndex++;
          timeout = setTimeout(typeChar, 35);
        } else {
          // Phase 2: Route to modules
          timeout = setTimeout(() => {
            setPhase('routing');
            timeout = setTimeout(() => {
              // Phase 3: Execute
              setPhase('executing');
              setActiveModules(cmd.modules);
              timeout = setTimeout(() => {
                // Phase 4: Complete
                setPhase('complete');
                timeout = setTimeout(() => {
                  // Next cycle
                  setActiveStep((prev) => (prev + 1) % ACTIVE_SEQUENCE.length);
                }, 1500);
              }, cmd.duration);
            }, 800);
          }, 400);
        }
      };
      typeChar();
    };

    runCycle();
    return () => clearTimeout(timeout);
  }, [isInView, activeStep]);

  return (
    <section
      ref={ref}
      className="relative px-4 py-16 sm:py-32 sm:px-6 lg:px-8 overflow-hidden"
      aria-label="Orchestration Engine Visualization"
    >
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(52,211,153,0.03) 0%, transparent 60%), linear-gradient(rgba(52,211,153,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(52,211,153,0.015) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 60px 60px, 60px 60px',
        }}
        aria-hidden="true"
      />

      <div className="mx-auto max-w-6xl relative z-10">
        {/* Section header */}
        <motion.div
          className="text-center mb-10 sm:mb-20"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-3 font-sans">Orchestration Engine</p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">
            One command. Every module activated.
          </h2>
          <p className="mt-4 text-slate-400 max-w-2xl mx-auto font-sans">
            JAK doesn&apos;t just chat. It decomposes your intent, routes to the right capabilities, executes in parallel, and delivers results.
          </p>
        </motion.div>

        {/* Main orchestration visual */}
        <div className="relative mx-auto w-full" style={{ maxWidth: 720, aspectRatio: '1', maxHeight: '80vh' }}>
          {/* SVG connections layer */}
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 720 720"
            fill="none"
            aria-hidden="true"
          >
            {/* SVG <defs>: a soft green glow filter for active connection
                lines, plus a radar-sweep arc gradient. This adds depth
                and motion energy to what was previously a flat ring of
                identical elements. */}
            <defs>
              <filter id="orch-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="orch-sweep" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#34d399" stopOpacity="0" />
                <stop offset="60%" stopColor="#34d399" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Radial guide rings — opacity bumped from 0.02/0.03 to
                0.08/0.05 so the concentric structure actually reads. The
                outer ring gets a subtle dashed stroke to suggest orbit. */}
            <circle cx="360" cy="360" r="240" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="2 6" />
            <circle cx="360" cy="360" r="180" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            <circle cx="360" cy="360" r="120" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />

            {/* Radar sweep — a rotating arc over the outer ring. Slow,
                low-opacity, respects prefers-reduced-motion through the
                global CSS reset that short-circuits animations. */}
            <g style={{ transformOrigin: '360px 360px', animation: 'orch-radar 12s linear infinite' }}>
              <path
                d="M 360 360 L 600 360 A 240 240 0 0 0 480 152.9 Z"
                fill="url(#orch-sweep)"
                opacity="0.6"
              />
            </g>

            {/* Connection lines from center to modules.
                Coords rounded to 3 decimals so SSR + client serialize
                identically — raw Math.cos/sin floats drift at the 14th
                decimal in React's attribute stringifier, triggering
                hydration warnings. */}
            {MODULES.map((mod) => {
              const rad = (mod.angle * Math.PI) / 180;
              const endX = Number((360 + Math.cos(rad) * 240).toFixed(3));
              const endY = Number((360 + Math.sin(rad) * 240).toFixed(3));
              const isActive = activeModules.includes(mod.id);
              const isRouting = phase === 'routing';

              return (
                <g key={mod.id} filter={isActive ? 'url(#orch-glow)' : undefined}>
                  {/* Base line — active gets a thicker stroke + glow filter
                      (see <defs>), dormant gets a softer dashed line with
                      higher base opacity (0.04 → 0.08) so the graph is
                      legible without activity. */}
                  <line
                    x1="360" y1="360"
                    x2={endX} y2={endY}
                    stroke={isActive ? mod.color : 'rgba(255,255,255,0.08)'}
                    strokeWidth={isActive ? 2.5 : 1}
                    strokeDasharray={isActive ? 'none' : '4 8'}
                    style={{
                      transition: 'stroke 0.5s ease, stroke-width 0.3s ease',
                    }}
                  />

                  {/* Animated data packet traveling along line */}
                  {(isActive || isRouting) && (
                    <circle r="4" fill={mod.color} opacity="0.9">
                      <animateMotion
                        dur={isActive ? '1.2s' : '0.8s'}
                        repeatCount={isActive ? 'indefinite' : '1'}
                        path={`M360,360 L${endX},${endY}`}
                      />
                    </circle>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Central core node */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20"
          >
            <motion.div
              className="relative w-20 h-20 sm:w-28 sm:h-28 rounded-2xl sm:rounded-3xl flex items-center justify-center"
              style={{
                background: phase === 'executing'
                  ? 'linear-gradient(135deg, rgba(52,211,153,0.2), rgba(251,191,36,0.15))'
                  : 'rgba(52,211,153,0.08)',
                border: phase === 'executing'
                  ? '2px solid rgba(52,211,153,0.5)'
                  : '1px solid rgba(52,211,153,0.2)',
                boxShadow: phase === 'executing'
                  ? '0 0 60px rgba(52,211,153,0.15), 0 0 120px rgba(52,211,153,0.05)'
                  : '0 0 30px rgba(52,211,153,0.05)',
                transition: 'all 0.5s ease',
              }}
              animate={phase === 'executing' ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
            >
              {/* Inner glow ring */}
              <div
                className="absolute inset-2 rounded-2xl"
                style={{
                  border: '1px solid rgba(52,211,153,0.15)',
                  background: 'rgba(9,9,11,0.8)',
                }}
              />
              <div className="relative z-10 text-center">
                <div className="text-2xl font-display font-bold tracking-tight" style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  JAK
                </div>
                <div className="text-[9px] font-mono text-slate-500 uppercase tracking-widest mt-0.5">
                  {phase === 'typing' ? 'listening' :
                   phase === 'routing' ? 'routing' :
                   phase === 'executing' ? 'executing' :
                   phase === 'complete' ? 'done' : 'ready'}
                </div>
              </div>
            </motion.div>
          </div>

          {/* Module nodes around the perimeter. Rounded to 3 decimals so
              SSR percentage strings match client exactly. */}
          {MODULES.map((mod) => {
            const rad = (mod.angle * Math.PI) / 180;
            const x = Number((50 + Math.cos(rad) * 33.3).toFixed(3));
            const y = Number((50 + Math.sin(rad) * 33.3).toFixed(3));
            const isActive = activeModules.includes(mod.id);

            return (
              <motion.div
                key={mod.id}
                className="absolute z-10"
                style={{
                  top: `${y}%`,
                  left: `${x}%`,
                  transform: 'translate(-50%, -50%)',
                }}
                animate={isActive ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                transition={{ duration: 1.5, repeat: isActive ? Infinity : 0 }}
              >
                <div
                  className="w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-xl sm:rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all duration-500"
                  style={{
                    background: isActive ? `${mod.color}20` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isActive ? `${mod.color}60` : 'rgba(255,255,255,0.06)'}`,
                    boxShadow: isActive ? `0 0 30px ${mod.color}25, 0 0 60px ${mod.color}10` : 'none',
                  }}
                >
                  <svg
                    className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    style={{
                      color: isActive ? mod.color : 'rgba(255,255,255,0.25)',
                      transition: 'color 0.5s ease',
                    }}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={mod.icon} />
                  </svg>
                  <span
                    className="text-[6px] sm:text-[8px] md:text-[9px] font-mono uppercase tracking-wider hidden sm:block"
                    style={{
                      color: isActive ? mod.color : 'rgba(255,255,255,0.2)',
                      transition: 'color 0.5s ease',
                    }}
                  >
                    {mod.label}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Command display strip */}
        <motion.div
          className="mt-12 mx-auto max-w-xl"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <div
            className="rounded-2xl p-4 sm:p-5"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {/* Command input */}
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  background: phase === 'complete' ? '#34d399' : phase === 'executing' ? '#fbbf24' : '#34d399',
                  boxShadow: `0 0 8px ${phase === 'complete' ? '#34d39960' : phase === 'executing' ? '#fbbf2460' : '#34d39940'}`,
                  animation: phase !== 'idle' && phase !== 'complete' ? 'pulse 1.5s ease-in-out infinite' : 'none',
                }}
                aria-hidden="true"
              />
              <div className="font-mono text-sm text-white/90 min-h-[20px]">
                {commandText}
                {phase === 'typing' && (
                  <span className="inline-block w-[2px] h-4 bg-emerald-400 ml-0.5 align-middle" style={{ animation: 'blink 1s step-end infinite' }} />
                )}
              </div>
            </div>

            {/* Status bar */}
            <div className="flex items-center gap-4 text-[10px] font-mono text-slate-500">
              <span style={{ color: phase !== 'idle' ? '#34d399' : undefined, transition: 'color 0.3s' }}>
                {phase === 'typing' ? '● parsing' : phase === 'routing' ? '● routing' : phase === 'executing' ? '● executing' : phase === 'complete' ? '✓ complete' : '○ waiting'}
              </span>
              <span className="text-slate-700">|</span>
              <span>
                {activeModules.length > 0 ? `${activeModules.length} modules active` : 'modules standby'}
              </span>
              <span className="text-slate-700">|</span>
              <span>step {activeStep + 1}/{ACTIVE_SEQUENCE.length}</span>
            </div>
          </div>
        </motion.div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </section>
  );
}
