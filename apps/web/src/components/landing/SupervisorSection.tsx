'use client';

import { useRef, useState, useEffect } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';

/* ─── Data ──────────────────────────────────────────────────────────────── */

const EVENT_TYPES = [
  { type: 'workflow:started', color: '#34d399', agent: 'SwarmRunner' },
  { type: 'node:entered', color: '#fbbf24', agent: 'Commander' },
  { type: 'node:completed', color: '#34d399', agent: 'Commander' },
  { type: 'node:entered', color: '#fbbf24', agent: 'Planner' },
  { type: 'node:completed', color: '#34d399', agent: 'Planner' },
  { type: 'node:entered', color: '#fbbf24', agent: 'Router' },
  { type: 'node:entered', color: '#38bdf8', agent: 'Email Worker' },
  { type: 'node:entered', color: '#38bdf8', agent: 'CRM Worker' },
  { type: 'node:completed', color: '#34d399', agent: 'Email Worker' },
  { type: 'circuit:open', color: '#ef4444', agent: 'CRM Worker' },
  { type: 'node:entered', color: '#fbbf24', agent: 'CRM Worker (retry)' },
  { type: 'node:completed', color: '#34d399', agent: 'CRM Worker' },
  { type: 'node:entered', color: '#c084fc', agent: 'Verifier' },
  { type: 'approval:required', color: '#f59e0b', agent: 'Approval Gate' },
  { type: 'workflow:completed', color: '#34d399', agent: 'SwarmRunner' },
];

const CIRCUIT_STATES = [
  { name: 'Closed', desc: 'Normal operation — calls pass through', color: '#34d399', icon: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { name: 'Open', desc: 'Threshold exceeded — calls fail instantly', color: '#ef4444', icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' },
  { name: 'Half-Open', desc: 'Recovery probe — one test call allowed', color: '#fbbf24', icon: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z' },
];

const FEATURES = [
  {
    title: 'SupervisorBus',
    subtitle: 'Real-time event backbone',
    desc: 'Every workflow lifecycle event flows through a typed pub-sub bus. Track active workflows, monitor node execution, stream events to the frontend via SSE.',
    color: '#34d399',
    icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
    stats: ['Multi-tenant isolation', '8 event types', 'Type-safe handlers'],
  },
  {
    title: 'Circuit Breaker',
    subtitle: 'Cascading failure prevention',
    desc: 'Every agent execution is wrapped in a circuit breaker. After 5 consecutive failures, calls fail fast instead of cascading. Auto-recovers after 30s.',
    color: '#ef4444',
    icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75',
    stats: ['5-failure threshold', '30s auto-recovery', 'Per-agent isolation'],
  },
  {
    title: 'Workflow Telemetry',
    subtitle: 'Full execution observability',
    desc: 'Every node entry, exit, duration, and failure is recorded. View the full execution DAG in real time with timing data and cost per step.',
    color: '#38bdf8',
    icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
    stats: ['Node-level timing', 'Cost tracking', 'DAG visualization'],
  },
  {
    title: 'Approval Gates',
    subtitle: 'Human-in-the-loop controls',
    desc: 'High-risk actions pause for human approval. The supervisor publishes approval:required events and waits for confirmation before proceeding.',
    color: '#fbbf24',
    icon: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
    stats: ['Risk-based triggers', 'Budget enforcement', 'Audit logging'],
  },
];

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function SupervisorSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: false, amount: 0.15 });
  const [visibleEvents, setVisibleEvents] = useState(0);
  const [circuitState, setCircuitState] = useState(0);

  // Animate the event log
  useEffect(() => {
    if (!isInView) return;
    setVisibleEvents(0);
    setCircuitState(0);

    const interval = setInterval(() => {
      setVisibleEvents((prev) => {
        if (prev >= EVENT_TYPES.length) {
          clearInterval(interval);
          return prev;
        }
        // When circuit:open event appears, switch circuit state
        const nextEvent = EVENT_TYPES[prev];
        if (nextEvent?.type === 'circuit:open') {
          setCircuitState(1); // Open
          setTimeout(() => setCircuitState(2), 2000); // Half-Open after 2s
          setTimeout(() => setCircuitState(0), 3500); // Closed after 3.5s
        }
        return prev + 1;
      });
    }, 600);

    return () => clearInterval(interval);
  }, [isInView]);

  return (
    <section
      ref={ref}
      className="relative px-4 py-16 sm:py-32 sm:px-6 lg:px-8 overflow-hidden"
      aria-label="Supervisor system intelligence"
    >
      {/* Background pattern */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 30% 50%, rgba(239,68,68,0.03) 0%, transparent 50%), radial-gradient(ellipse at 70% 50%, rgba(52,211,153,0.03) 0%, transparent 50%)',
        }}
        aria-hidden="true"
      />

      <div className="mx-auto max-w-6xl relative z-10">
        {/* Header */}
        <motion.div
          className="text-center mb-12 sm:mb-20"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-red-400 mb-3 font-sans">System Intelligence</p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">
            Self-healing. Observable. Resilient.
          </h2>
          <p className="mt-4 text-slate-400 max-w-2xl mx-auto font-sans">
            The Supervisor module is JAK&apos;s central nervous system. It monitors every workflow, prevents cascading failures, and gives you full observability into what your agents are doing.
          </p>
        </motion.div>

        {/* Two-column: Event stream + Circuit breaker */}
        <div className="grid lg:grid-cols-2 gap-6 mb-16 sm:mb-24">

          {/* Left: Live event stream */}
          <motion.div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
            initial={{ opacity: 0, x: -20 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            {/* Title bar */}
            <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-white/5">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-amber-500/60" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
              </div>
              <span className="text-xs text-slate-500 font-mono">SupervisorBus — Event Stream</span>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ animation: 'pulse 2s ease-in-out infinite' }} />
                <span className="text-[10px] font-mono text-slate-600">live</span>
              </div>
            </div>

            {/* Event log */}
            <div className="p-3 sm:p-4 space-y-1.5 min-h-[320px] sm:min-h-[380px] lg:max-h-none overflow-y-auto lg:overflow-visible">
              {EVENT_TYPES.map((event, i) => (
                <motion.div
                  key={`${event.type}-${i}`}
                  className="flex items-center gap-2 sm:gap-3 py-1"
                  initial={{ opacity: 0, x: -10 }}
                  animate={i < visibleEvents ? { opacity: 1, x: 0 } : { opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  {/* Timestamp */}
                  <span className="text-[9px] sm:text-[10px] font-mono text-slate-700 shrink-0 tabular-nums w-16 sm:w-20">
                    {i < visibleEvents ? `00:${String(Math.floor(i * 0.6)).padStart(2, '0')}.${String((i * 600) % 1000).padStart(3, '0')}` : ''}
                  </span>

                  {/* Event type badge */}
                  <span
                    className="text-[8px] sm:text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      color: event.color,
                      background: `${event.color}12`,
                      border: `1px solid ${event.color}20`,
                    }}
                  >
                    {event.type}
                  </span>

                  {/* Agent */}
                  <span className="text-[10px] sm:text-xs text-slate-400 font-sans break-words min-w-0">
                    {event.agent}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Right: Circuit breaker visualization */}
          <motion.div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
            initial={{ opacity: 0, x: 20 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {/* Title bar */}
            <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-white/5">
              <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75" />
              </svg>
              <span className="text-xs text-slate-500 font-mono">Circuit Breaker — State Machine</span>
            </div>

            <div className="p-4 sm:p-6">
              {/* State machine diagram */}
              <div className="flex items-center justify-center gap-3 sm:gap-6 mb-8">
                {CIRCUIT_STATES.map((state, i) => (
                  <div key={state.name} className="flex items-center gap-2 sm:gap-4">
                    <div className="text-center">
                      <motion.div
                        className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mx-auto mb-2 transition-all duration-500"
                        style={{
                          background: circuitState === i ? `${state.color}18` : 'rgba(255,255,255,0.02)',
                          border: `1.5px solid ${circuitState === i ? `${state.color}50` : 'rgba(255,255,255,0.06)'}`,
                          boxShadow: circuitState === i ? `0 0 24px ${state.color}15` : 'none',
                        }}
                        animate={circuitState === i ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                        transition={{ duration: 1.5, repeat: circuitState === i ? Infinity : 0 }}
                      >
                        <svg
                          className="w-6 h-6 sm:w-7 sm:h-7"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke={circuitState === i ? state.color : 'rgba(255,255,255,0.15)'}
                          style={{ transition: 'stroke 0.5s ease' }}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d={state.icon} />
                        </svg>
                      </motion.div>
                      <div
                        className="text-xs font-display font-semibold mb-0.5"
                        style={{ color: circuitState === i ? state.color : 'rgba(255,255,255,0.3)', transition: 'color 0.5s' }}
                      >
                        {state.name}
                      </div>
                      <div className="text-[9px] sm:text-[10px] text-slate-500 font-sans max-w-[100px] sm:max-w-[120px] mx-auto">
                        {state.desc}
                      </div>
                    </div>

                    {/* Arrow between states */}
                    {i < CIRCUIT_STATES.length - 1 && (
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-slate-700 shrink-0 -mt-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>

              {/* How it works explanation */}
              <div
                className="rounded-xl p-3 sm:p-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-2">How it protects your workflows</div>
                <div className="space-y-2 text-xs text-slate-400 font-sans">
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 shrink-0 mt-0.5">1.</span>
                    <span>Every agent call passes through a named circuit breaker</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-amber-400 shrink-0 mt-0.5">2.</span>
                    <span>After 5 consecutive failures, the circuit <strong className="text-red-400">opens</strong> — calls fail instantly</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-blue-400 shrink-0 mt-0.5">3.</span>
                    <span>After 30s cooldown, one probe call is allowed to test recovery</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 shrink-0 mt-0.5">4.</span>
                    <span>If the probe succeeds, the circuit <strong className="text-emerald-400">closes</strong> — normal operation resumes</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Feature cards */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              className="rounded-2xl p-5 sm:p-6 card-lift"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderTop: `2px solid ${feature.color}40`,
              }}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.1 }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: `${feature.color}12`, border: `1px solid ${feature.color}20` }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={feature.color}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={feature.icon} />
                </svg>
              </div>
              <h3 className="font-display font-semibold text-white text-sm mb-0.5">{feature.title}</h3>
              <p className="text-[10px] font-mono text-slate-500 mb-2">{feature.subtitle}</p>
              <p className="text-xs text-slate-400 font-sans leading-relaxed mb-3">{feature.desc}</p>
              <div className="flex flex-wrap gap-1.5">
                {feature.stats.map((stat) => (
                  <span
                    key={stat}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                    style={{ color: feature.color, background: `${feature.color}08`, border: `1px solid ${feature.color}15` }}
                  >
                    {stat}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
