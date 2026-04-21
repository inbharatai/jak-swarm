'use client';

import { useRef } from 'react';
import { motion, useInView, useScroll, useTransform } from 'framer-motion';
import { useStillMode } from './useStillMode';

/* ─── Data ──────────────────────────────────────────────────────────────── */

const FLOW_STEPS = [
  {
    number: '01',
    title: 'You speak naturally',
    description: 'Type a command in plain language. No syntax, no menus, no config files.',
    detail: '"Research our top 3 competitors, draft a summary, and email it to the team by 5pm."',
    color: '#34d399',
    icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  },
  {
    number: '02',
    title: 'JAK decomposes intent',
    description: 'The Commander agent breaks your request into a directed acyclic graph of subtasks.',
    detail: 'Task 1: Research (parallel) → Task 2: Synthesize (depends on 1) → Task 3: Draft email (depends on 2) → Task 4: Send (depends on 3)',
    color: '#fbbf24',
    icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75',
  },
  {
    number: '03',
    title: 'Agents are assigned',
    description: 'Each subtask routes to the best-fit agent with the right tools and LLM tier.',
    detail: 'Research Agent (Tier 2) + Browser Tool → CEO Agent (Tier 3) for synthesis → Email Agent (Tier 1) for draft + send',
    color: '#38bdf8',
    icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
  {
    number: '04',
    title: 'Parallel execution',
    description: 'Independent tasks run simultaneously. Dependent tasks wait for upstream completion.',
    detail: '3 research threads running in parallel → results merge → synthesis begins → email drafted in 12 seconds',
    color: '#f472b6',
    icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  },
  {
    number: '05',
    title: 'Verified result',
    description: 'Outputs pass through the verification layer before delivery. Fraud, errors, and hallucinations caught.',
    detail: '✓ Email verified (no phishing risk) · ✓ Competitor data cross-referenced · ✓ Summary fact-checked · Sent.',
    color: '#c084fc',
    icon: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  },
];

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function ExecutionFlow() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: false, amount: 0.1 });
  const isStillMode = useStillMode();

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start end', 'end start'],
  });

  // Progress line grows as user scrolls through the section
  const lineHeight = useTransform(scrollYProgress, [0.1, 0.8], ['0%', '100%']);

  return (
    <section
      ref={containerRef}
      className="relative px-4 py-16 sm:py-32 sm:px-6 lg:px-8"
      id="execution-flow"
      aria-label="How JAK executes commands"
    >
      <div className="mx-auto max-w-5xl">
        {/* Section header */}
        <motion.div
          className="text-center mb-12 sm:mb-24"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-amber-400 mb-3 font-sans">Execution Architecture</p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">
            From intent to outcome
          </h2>
          <p className="mt-4 text-slate-300 max-w-2xl mx-auto font-sans">
            Every command follows a precise execution path. No guessing. No hallucination loops. Real work, verified results.
          </p>
        </motion.div>

        {/* Steps with scroll-linked progress */}
        <div className="relative">
          {/* Vertical progress line (desktop) */}
          <div className="absolute left-8 lg:left-1/2 top-0 bottom-0 w-px lg:-translate-x-px hidden sm:block" aria-hidden="true">
            <div className="h-full w-full bg-white/[0.04]" />
            <motion.div
              className="absolute top-0 left-0 w-full bg-gradient-to-b from-emerald-400 via-amber-400 to-purple-400"
              style={{ height: lineHeight }}
            />
          </div>

          {/* Steps */}
          <div className="space-y-12 sm:space-y-16 lg:space-y-24">
            {FLOW_STEPS.map((step, i) => {
              const isEven = i % 2 === 0;
              return (
                <FlowStep key={step.number} step={step} index={i} isEven={isEven} isStillMode={isStillMode} />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Individual Step ───────────────────────────────────────────────────── */

function FlowStep({
  step,
  index,
  isEven,
  isStillMode,
}: {
  step: (typeof FLOW_STEPS)[number];
  index: number;
  isEven: boolean;
  isStillMode: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });

  return (
    <motion.div
      ref={ref}
      className={`relative grid lg:grid-cols-2 gap-6 lg:gap-16 items-center ${
        isEven ? '' : 'lg:direction-rtl'
      }`}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView || isStillMode ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: isStillMode ? 0 : 0.7, delay: isStillMode ? 0 : 0.1 }}
    >
      {/* Node dot on the timeline */}
      <div
        className="absolute left-8 lg:left-1/2 -translate-x-1/2 w-4 h-4 rounded-full z-10 hidden sm:block"
        style={{
          background: step.color,
          boxShadow: `0 0 20px ${step.color}40`,
          border: '3px solid #09090b',
        }}
        aria-hidden="true"
      />

      {/* Content side */}
      <div className={`pl-6 sm:pl-20 lg:pl-0 ${isEven ? 'lg:pr-16 lg:text-right' : 'lg:col-start-2 lg:pl-16'}`}>
        <div className={`flex items-center gap-3 mb-4 ${isEven ? 'lg:justify-end' : ''}`}>
          <span
            className="text-xs font-mono font-bold px-2.5 py-1 rounded-md"
            style={{
              color: step.color,
              background: `${step.color}10`,
              border: `1px solid ${step.color}25`,
            }}
          >
            {step.number}
          </span>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: `${step.color}12`,
              border: `1px solid ${step.color}20`,
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={step.color} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={step.icon} />
            </svg>
          </div>
        </div>

        <h3 className="text-xl sm:text-2xl font-display font-bold text-white mb-2">
          {step.title}
        </h3>
        <p className="text-slate-300 font-sans mb-4 leading-relaxed">
          {step.description}
        </p>

        {/* Detail card */}
        <div
          className="rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 text-left max-w-full sm:max-w-md sm:inline-block"
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <p className="text-xs font-mono text-slate-500 leading-relaxed">
            {step.detail}
          </p>
        </div>
      </div>

      {/* Visual side - mini execution graphic */}
      <div className={`hidden lg:flex items-center justify-center ${isEven ? 'lg:col-start-2' : 'lg:col-start-1 lg:row-start-1'}`}>
        <StepGraphic step={step} index={index} isActive={isInView} isStillMode={isStillMode} />
      </div>
    </motion.div>
  );
}

/* ─── Step Graphics ─────────────────────────────────────────────────────── */

function StepGraphic({
  step,
  index,
  isActive,
  isStillMode,
}: {
  step: (typeof FLOW_STEPS)[number];
  index: number;
  isActive: boolean;
  isStillMode: boolean;
}) {
  return (
    <div className="relative w-48 h-48">
      <svg viewBox="0 0 200 200" className="w-full h-full" aria-hidden="true">
        {/* Outer ring */}
        <circle
          cx="100" cy="100" r="80"
          fill="none"
          stroke={isActive ? `${step.color}20` : 'rgba(255,255,255,0.03)'}
          strokeWidth="1"
          style={{ transition: 'stroke 0.8s ease' }}
        />

        {/* Animated arc */}
        {isActive && !isStillMode && (
          <circle
            cx="100" cy="100" r="80"
            fill="none"
            stroke={step.color}
            strokeWidth="2"
            strokeDasharray="120 383"
            strokeLinecap="round"
            opacity="0.6"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 100 100"
              to="360 100 100"
              dur="4s"
              repeatCount="indefinite"
            />
          </circle>
        )}

        {/* Inner ring */}
        <circle
          cx="100" cy="100" r="50"
          fill={isActive ? `${step.color}08` : 'rgba(255,255,255,0.01)'}
          stroke={isActive ? `${step.color}25` : 'rgba(255,255,255,0.03)'}
          strokeWidth="1"
          style={{ transition: 'all 0.8s ease' }}
        />

        {/* Center icon background */}
        <circle
          cx="100" cy="100" r="28"
          fill={isActive ? `${step.color}15` : 'rgba(255,255,255,0.02)'}
          stroke={isActive ? `${step.color}35` : 'rgba(255,255,255,0.05)'}
          strokeWidth="1"
          style={{ transition: 'all 0.6s ease' }}
        />

        {/* Step number */}
        <text
          x="100" y="96"
          textAnchor="middle"
          fontSize="18"
          fontWeight="700"
          fontFamily="var(--font-display)"
          fill={isActive ? step.color : 'rgba(255,255,255,0.15)'}
          style={{ transition: 'fill 0.6s ease' }}
        >
          {step.number}
        </text>
        <text
          x="100" y="112"
          textAnchor="middle"
          fontSize="7"
          fontFamily="var(--font-mono)"
          letterSpacing="2"
          fill={isActive ? `${step.color}` : 'rgba(255,255,255,0.1)'}
          opacity="0.6"
          style={{ transition: 'fill 0.6s ease' }}
        >
          {step.title.toUpperCase().slice(0, 12)}
        </text>

        {/* Orbital dots — coords rounded to 3 decimals to keep SSR + client
            string serialization identical. Raw Math.cos/sin floats render
            slightly differently in React's attribute stringifier between
            Node and the browser (14th-decimal drift), triggering hydration
            warnings and the dev overlay on every page load. */}
        {[0, 72, 144, 216, 288].map((angle, j) => {
          const rad = (angle * Math.PI) / 180;
          const cx = Number((100 + Math.cos(rad) * 65).toFixed(3));
          const cy = Number((100 + Math.sin(rad) * 65).toFixed(3));
          return (
            <circle
              key={j}
              cx={cx} cy={cy} r="2"
              fill={isActive ? step.color : 'rgba(255,255,255,0.05)'}
              opacity={isActive ? 0.5 : 0.2}
              style={{ transition: 'all 0.6s ease' }}
            >
              {isActive && !isStillMode && (
                <animate
                  attributeName="opacity"
                  values="0.3;0.8;0.3"
                  dur={`${1.5 + j * 0.3}s`}
                  repeatCount="indefinite"
                />
              )}
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
