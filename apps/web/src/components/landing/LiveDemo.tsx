'use client';

import { useRef, useState, useEffect } from 'react';
import { motion, useInView } from 'framer-motion';
import { useStillMode } from './useStillMode';

/* ─── Data ──────────────────────────────────────────────────────────────── */

// Each scenario walks through a realistic JAK orchestration: Commander parses
// intent → Planner decomposes → role-specific worker agents execute → Verifier
// gates the output → Approval Gate pauses on risky actions → Audit ribbon
// records every step. The role names map 1:1 to BaseAgent subclasses that
// ship in /packages/agents (CEO/CMO/CTO/Research/Verifier/Approval).
const DEMO_SCENARIOS = [
  {
    command: 'Map our top 3 competitors and draft a CMO-voice LinkedIn post',
    steps: [
      { agent: 'Commander', action: 'Parsed intent: competitor research + content draft', color: '#fbbf24', ms: 400 },
      { agent: 'Planner', action: 'Decomposed into 4 ordered subtasks · risk: medium', color: '#fbbf24', ms: 500 },
      { agent: 'Research Agent', action: 'Pulled 3 competitor pricing + positioning pages', color: '#38bdf8', ms: 1100 },
      { agent: 'CEO Agent', action: 'Synthesized 5-point strategic angle for the post', color: '#34d399', ms: 800 },
      { agent: 'CMO Agent', action: 'Drafted 248-word LinkedIn post in your brand voice', color: '#f472b6', ms: 1100 },
      { agent: 'Verifier', action: 'Citation density 0.82 · tone match · safety ✓', color: '#34d399', ms: 500 },
      { agent: 'Approval', action: 'Paused for your sign-off before publishing', color: '#fbbf24', ms: 600 },
      { agent: 'Audit', action: 'Trail signed (HMAC-SHA256) · run #847 logged', color: '#fb923c', ms: 300 },
    ],
    result: 'Draft ready in your voice. JAK never published — your approval gates the LinkedIn handoff.',
  },
  {
    command: 'Review my landing page and propose 5 copy + design fixes',
    steps: [
      { agent: 'Commander', action: 'Parsed intent: website audit · sandbox-only edits', color: '#fbbf24', ms: 350 },
      { agent: 'Planner', action: 'Crawl → screenshot → review → propose-fixes pipeline', color: '#fbbf24', ms: 450 },
      { agent: 'Browser Agent', action: 'Crawled 4 pages · captured 12 screenshots', color: '#38bdf8', ms: 1300 },
      { agent: 'Designer Agent', action: 'Found contrast, hierarchy, mobile-tap issues (3)', color: '#c084fc', ms: 900 },
      { agent: 'CTO Agent', action: 'Mapped each fix to a source file + diff (2)', color: '#38bdf8', ms: 800 },
      { agent: 'Verifier', action: 'Each fix points to a real file path · ✓ verified', color: '#34d399', ms: 500 },
      { agent: 'Approval', action: 'Sandbox edits queued · awaiting your review', color: '#fbbf24', ms: 500 },
      { agent: 'Audit', action: 'Trail signed · 5 fixes ready for one-click apply', color: '#fb923c', ms: 300 },
    ],
    result: '5 fixes proposed. Each one shows the file, the diff, and the screenshot. Nothing applied yet.',
  },
  {
    command: 'Help me draft a SOC 2 readiness summary from our last audit run',
    steps: [
      { agent: 'Commander', action: 'Parsed intent: audit summary · evidence-grounded', color: '#fbbf24', ms: 400 },
      { agent: 'Planner', action: 'Pull AuditRun → fetch ControlTests → render PDF', color: '#fbbf24', ms: 500 },
      { agent: 'Audit Commander', action: 'Loaded 63 SOC 2 controls · 47 passed · 16 noted', color: '#fb923c', ms: 1100 },
      { agent: 'Workpaper Writer', action: 'Composed reviewer-gated summary · 3 pages', color: '#c084fc', ms: 1000 },
      { agent: 'Verifier', action: 'Cross-checked findings against evidence ledger ✓', color: '#34d399', ms: 600 },
      { agent: 'Approval', action: 'Workpaper held until reviewer approves it', color: '#fbbf24', ms: 500 },
      { agent: 'Audit', action: 'Final pack refused: 2 workpapers still pending', color: '#fb923c', ms: 400 },
    ],
    result: 'Summary drafted. Final pack signing is gated until reviewers approve every workpaper.',
  },
];

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function LiveDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: false, amount: 0.3 });
  const isStillMode = useStillMode();
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [typing, setTyping] = useState(true);
  const [typedText, setTypedText] = useState('');

  const scenario = DEMO_SCENARIOS[scenarioIndex];

  // Run the demo animation
  useEffect(() => {
    if (!isInView || isStillMode) return;

    let timeouts: ReturnType<typeof setTimeout>[] = [];
    let charIndex = 0;

    // Reset
    setVisibleSteps(0);
    setShowResult(false);
    setTyping(true);
    setTypedText('');

    // Type command
    const typeInterval = setInterval(() => {
      if (charIndex <= scenario.command.length) {
        setTypedText(scenario.command.slice(0, charIndex));
        charIndex++;
      } else {
        clearInterval(typeInterval);
        setTyping(false);

        // Reveal steps one by one
        let delay = 600;
        scenario.steps.forEach((step, i) => {
          const t = setTimeout(() => {
            setVisibleSteps(i + 1);
          }, delay);
          timeouts.push(t);
          delay += step.ms;
        });

        // Show result
        const resultTimeout = setTimeout(() => {
          setShowResult(true);
        }, delay + 400);
        timeouts.push(resultTimeout);

        // Next scenario
        const nextTimeout = setTimeout(() => {
          setScenarioIndex((prev) => (prev + 1) % DEMO_SCENARIOS.length);
        }, delay + 3000);
        timeouts.push(nextTimeout);
      }
    }, 25);

    return () => {
      clearInterval(typeInterval);
      timeouts.forEach(clearTimeout);
    };
  }, [isInView, isStillMode, scenarioIndex]);

  useEffect(() => {
    if (!isStillMode) return;
    setTyping(false);
    setTypedText(scenario.command);
    setVisibleSteps(scenario.steps.length);
    setShowResult(true);
  }, [isStillMode, scenario.command, scenario.steps.length]);

  return (
    <section
      ref={ref}
      className="relative px-4 py-16 sm:py-32 sm:px-6 lg:px-8"
      aria-label="Live execution demo"
    >
      <div className="mx-auto max-w-4xl">
        {/* Section header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView || isStillMode ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: isStillMode ? 0 : 0.6 }}
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-3 font-sans">Live Execution</p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">
            Watch JAK work in real time
          </h2>
          <p className="mt-4 text-slate-300 max-w-2xl mx-auto font-sans">
            Real commands. Real agent routing. Real execution traces.
          </p>
        </motion.div>

        {/* Terminal window */}
        <motion.div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
          initial={{ opacity: 0, y: 30 }}
          animate={isInView || isStillMode ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: isStillMode ? 0 : 0.6, delay: isStillMode ? 0 : 0.2 }}
        >
          {/* Title bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/60" />
              <div className="w-3 h-3 rounded-full bg-amber-500/60" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
            </div>
            <span className="text-xs text-slate-400 font-mono">JAK Execution Trace</span>
            <div className="ml-auto flex items-center gap-2">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: showResult ? '#34d399' : '#fbbf24',
                  boxShadow: showResult ? '0 0 6px #34d39960' : '0 0 6px #fbbf2460',
                }}
              />
              <span className="text-[10px] font-mono text-slate-400">
                {showResult ? 'complete' : 'running'}
              </span>
            </div>
          </div>

          {/* Content */}
          <div className="p-3 sm:p-5 md:p-6 space-y-3 sm:space-y-4 min-h-[300px] sm:min-h-[400px]">
            {/* Command input */}
            <div className="flex items-start gap-2 sm:gap-3">
              <span className="text-emerald-400 font-mono text-xs sm:text-sm shrink-0 mt-0.5">{'>'}</span>
              <div className="font-mono text-xs sm:text-sm text-white/90 break-words min-w-0">
                {typedText}
                {typing && !isStillMode && (
                  <span
                    className="inline-block w-[2px] h-4 bg-emerald-400 ml-0.5 align-middle"
                    style={{ animation: 'blink 1s step-end infinite' }}
                  />
                )}
              </div>
            </div>

            {/* Execution steps */}
            {!typing && (
              <div className="space-y-2 pt-2">
                {scenario.steps.map((step, i) => (
                  <motion.div
                    key={`${scenarioIndex}-${i}`}
                    className="flex items-start gap-3"
                    initial={{ opacity: 0, x: -10 }}
                    animate={i < visibleSteps ? { opacity: 1, x: 0 } : {}}
                    transition={{ duration: isStillMode ? 0 : 0.3 }}
                  >
                    {/* Status indicator */}
                    <div className="shrink-0 mt-1">
                      {i < visibleSteps - 1 || (i === scenario.steps.length - 1 && showResult) ? (
                        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : i < visibleSteps ? (
                        <div
                          className="w-3 h-3 rounded-full border-2 border-t-transparent"
                          style={{
                            borderColor: `${step.color}80`,
                            borderTopColor: 'transparent',
                            animation: 'spin 0.8s linear infinite',
                          }}
                        />
                      ) : (
                        <div className="w-3 h-3 rounded-full border border-white/10" />
                      )}
                    </div>

                    {/* Step content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start sm:items-center gap-1.5 sm:gap-2 flex-wrap">
                        <span
                          className="text-[9px] sm:text-[10px] font-mono font-bold px-1 sm:px-1.5 py-0.5 rounded shrink-0"
                          style={{
                            color: step.color,
                            background: `${step.color}10`,
                            border: `1px solid ${step.color}20`,
                          }}
                        >
                          {step.agent}
                        </span>
                        <span className="text-[11px] sm:text-xs text-slate-300 font-sans break-words min-w-0">
                          {step.action}
                        </span>
                      </div>
                    </div>

                    {/* Timing */}
                    <span className="text-[10px] font-mono text-slate-500 shrink-0 mt-0.5">
                      {i < visibleSteps ? `${step.ms}ms` : ''}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Result */}
            {showResult && (
              <motion.div
                className="mt-4 pt-4 border-t border-white/5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: isStillMode ? 0 : 0.4 }}
              >
                <div className="flex items-start gap-3">
                  <span className="text-emerald-400 font-mono text-sm shrink-0">{'✓'}</span>
                  <p className="text-sm text-emerald-300/90 font-sans leading-relaxed">
                    {scenario.result}
                  </p>
                </div>
              </motion.div>
            )}
          </div>

          {/* Bottom status bar — clean cockpit chrome only. The previous
               "scenario 1/3 | 0/6 steps" labels were placeholder text that
               read as a slideshow indicator, not a live execution surface.
               Now: a thin progress fill + click-to-jump dots, nothing else. */}
          <div className="border-t border-white/5 px-3 sm:px-5 py-2 sm:py-2.5 flex items-center gap-3">
            <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-amber-400 rounded-full transition-all duration-500"
                style={{ width: `${(visibleSteps / scenario.steps.length) * 100}%` }}
              />
            </div>
            <div className="flex gap-2">
              {DEMO_SCENARIOS.map((_, i) => (
                <button
                  key={i}
                  className={`w-2 h-2 rounded-full transition-all hover:scale-110 ${
                    i === scenarioIndex ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-white/10 hover:bg-white/20'
                  }`}
                  onClick={() => setScenarioIndex(i)}
                  aria-label={`View scenario ${i + 1}`}
                />
              ))}
            </div>
          </div>
        </motion.div>

        {/* Subtle scenario caption below the cockpit so visitors know there
             are 3 different real flows demoed, without us shoving a
             "scenario 1/3" label into the cockpit chrome. */}
        <p className="mt-4 text-center text-[11px] text-slate-500 font-sans">
          Three real flows in rotation: <span className="text-slate-300">competitor research + LinkedIn draft</span> · <span className="text-slate-300">website review + fixes</span> · <span className="text-slate-300">SOC 2 readiness summary</span>
        </p>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </section>
  );
}
