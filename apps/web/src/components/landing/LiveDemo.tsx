'use client';

import { useRef, useState, useEffect } from 'react';
import { motion, useInView } from 'framer-motion';

/* ─── Data ──────────────────────────────────────────────────────────────── */

const DEMO_SCENARIOS = [
  {
    command: 'Send a follow-up email to all leads from last week who didn\'t reply',
    steps: [
      { agent: 'Commander', action: 'Decomposing task into 3 subtasks', color: '#fbbf24', ms: 400 },
      { agent: 'CRM Agent', action: 'Querying leads from last 7 days → 23 leads found', color: '#F59E0B', ms: 800 },
      { agent: 'CRM Agent', action: 'Filtering no-reply leads → 14 leads matched', color: '#F59E0B', ms: 600 },
      { agent: 'Email Agent', action: 'Generating personalized follow-ups (14 drafts)', color: '#EA4335', ms: 1200 },
      { agent: 'Verification', action: 'Checking for phishing risk, tone, compliance → ✓ Clear', color: '#34d399', ms: 500 },
      { agent: 'Email Agent', action: 'Sent 14 emails via IMAP · 0 bounced', color: '#EA4335', ms: 400 },
    ],
    result: '14 personalized follow-ups sent. 0 flagged. Avg send time: 1.2s per email.',
  },
  {
    command: 'Research top 5 AI code generation tools and create a comparison doc',
    steps: [
      { agent: 'Commander', action: 'Creating research → synthesis → document pipeline', color: '#fbbf24', ms: 400 },
      { agent: 'Research Agent', action: 'Searching 5 targets: Cursor, Copilot, Bolt, v0, Windsurf', color: '#06B6D4', ms: 1000 },
      { agent: 'Browser Agent', action: 'Fetching pricing, features, reviews (15 pages)', color: '#34d399', ms: 1500 },
      { agent: 'CEO Agent', action: 'Synthesizing findings into structured comparison', color: '#34d399', ms: 800 },
      { agent: 'Document Agent', action: 'Writing comparison doc (2,400 words)', color: '#8B5CF6', ms: 1000 },
      { agent: 'Verification', action: 'Cross-referencing pricing data → ✓ Accurate', color: '#34d399', ms: 400 },
    ],
    result: 'Comparison document ready. 5 tools analyzed. 12 criteria scored. Exported as PDF.',
  },
  {
    command: 'Fix the login bug on staging, test it, and deploy to production',
    steps: [
      { agent: 'Commander', action: 'Debug → Test → Deploy pipeline created', color: '#fbbf24', ms: 300 },
      { agent: 'Engineer Agent', action: 'Analyzing error logs → auth token expiry not handled', color: '#38bdf8', ms: 700 },
      { agent: 'Engineer Agent', action: 'Generating fix: token refresh middleware (47 lines)', color: '#38bdf8', ms: 900 },
      { agent: 'Browser Agent', action: 'Running E2E tests on staging → 23/23 passed', color: '#34d399', ms: 1200 },
      { agent: 'Ops Agent', action: 'Deploying to production via CI/CD pipeline', color: '#fb923c', ms: 800 },
      { agent: 'Verification', action: 'Post-deploy health check → ✓ All systems nominal', color: '#34d399', ms: 400 },
    ],
    result: 'Bug fixed, tested, deployed. Zero downtime. Total time: 4m 12s.',
  },
];

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function LiveDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: false, amount: 0.3 });
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [typing, setTyping] = useState(true);
  const [typedText, setTypedText] = useState('');

  const scenario = DEMO_SCENARIOS[scenarioIndex];

  // Run the demo animation
  useEffect(() => {
    if (!isInView) return;

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
  }, [isInView, scenarioIndex]);

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
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-3 font-sans">Live Execution</p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">
            Watch JAK work in real time
          </h2>
          <p className="mt-4 text-slate-400 max-w-2xl mx-auto font-sans">
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
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          {/* Title bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/60" />
              <div className="w-3 h-3 rounded-full bg-amber-500/60" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
            </div>
            <span className="text-xs text-slate-500 font-mono">JAK Execution Trace</span>
            <div className="ml-auto flex items-center gap-2">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: showResult ? '#34d399' : '#fbbf24',
                  boxShadow: showResult ? '0 0 6px #34d39960' : '0 0 6px #fbbf2460',
                }}
              />
              <span className="text-[10px] font-mono text-slate-600">
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
                {typing && (
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
                    transition={{ duration: 0.3 }}
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
                        <span className="text-[11px] sm:text-xs text-slate-400 font-sans break-words min-w-0">
                          {step.action}
                        </span>
                      </div>
                    </div>

                    {/* Timing */}
                    <span className="text-[10px] font-mono text-slate-600 shrink-0 mt-0.5">
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
                transition={{ duration: 0.4 }}
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

          {/* Bottom status bar */}
          <div className="border-t border-white/5 px-3 sm:px-5 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-4 text-[9px] sm:text-[10px] font-mono text-slate-600 overflow-x-auto">
            <span>scenario {scenarioIndex + 1}/{DEMO_SCENARIOS.length}</span>
            <span className="text-slate-700">|</span>
            <span>{visibleSteps}/{scenario.steps.length} steps</span>
            <span className="text-slate-700">|</span>
            <div className="flex-1 max-w-24 h-1 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-amber-400 rounded-full transition-all duration-500"
                style={{ width: `${(visibleSteps / scenario.steps.length) * 100}%` }}
              />
            </div>
            <div className="ml-auto flex gap-4">
              {DEMO_SCENARIOS.map((_, i) => (
                <button
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i === scenarioIndex ? 'bg-emerald-400' : 'bg-white/10'
                  }`}
                  onClick={() => setScenarioIndex(i)}
                  aria-label={`View scenario ${i + 1}`}
                />
              ))}
            </div>
          </div>
        </motion.div>
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
