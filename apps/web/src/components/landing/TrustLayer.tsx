'use client';

/**
 * TrustLayer — six trust points, presented as a calm dense grid.
 *
 *   "Built for controlled autonomy."
 *
 * Each point names a real, code-backed JAK guarantee — no marketing
 * adjectives, no "world-class". Reviewers can grep every claim.
 *
 * The grid uses a 2x3 layout on desktop, 1-col on mobile. No big
 * cards — small calm tiles to convey "these are non-negotiables, not
 * features".
 */

import { motion } from 'framer-motion';

interface TrustPoint {
  title: string;
  body: string;
  proof: string; // greppable subsystem reference
  color: string;
  iconPath: string;
}

const POINTS: TrustPoint[] = [
  {
    title: 'Human approval gates',
    body: 'Every external action — send, post, deploy, charge — pauses for an inline approval card. Replays with a different payload are rejected.',
    proof: 'approval-node.ts · payload-bound',
    color: '#fbbf24',
    iconPath: 'M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12z',
  },
  {
    title: 'Source-grounded outputs',
    body: 'Research-class agents must cite. The verifier flags any claim under the citation-density threshold before delivery.',
    proof: 'verifier.agent.ts · density ≥ 0.7',
    color: '#38bdf8',
    iconPath: 'M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z',
  },
  {
    title: 'Tool maturity labels',
    body: 'Every tool carries an honest CI-enforced label: real, heuristic, llm_passthrough, config_dependent, or experimental. No tool ships unlabeled.',
    proof: 'check:truth · 122 / 0 unclassified',
    color: '#34d399',
    iconPath: 'M11.25 4.533A9.71 9.71 0 0 0 6 3a9.735 9.735 0 0 0-3.25.555.75.75 0 0 0-.5.707v14.25a.75.75 0 0 0 1 .707A8.236 8.236 0 0 1 6 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0 1 18 18.75c.966 0 1.89.166 2.75.47a.75.75 0 0 0 1-.708V4.262a.75.75 0 0 0-.5-.707A9.735 9.735 0 0 0 18 3a9.71 9.71 0 0 0-5.25 1.533v16.103z',
  },
  {
    title: 'Tamper-evident audit trail',
    body: 'Every workflow run, every approval decision, every external action emits an audit log row. Final evidence packs are HMAC-SHA256 signed.',
    proof: 'audit-log plugin · bundle.service.ts',
    color: '#fb923c',
    iconPath: 'M12 3 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6Z',
  },
  {
    title: 'Self-hostable open-source core',
    body: 'JAK is MIT-licensed. Run it on your laptop, your VPS, or your cluster. Hosted ops are a convenience, not a lock-in.',
    proof: 'github.com/inbharatai/jak-swarm · MIT',
    color: '#c084fc',
    iconPath: 'M12 3l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V7l8-4Z',
  },
  {
    title: 'Agent-first runtime',
    body: 'JAK routes all work through specialist agents with structured orchestration, tier-based model routing, and strict output validation. No template fallbacks — every spec is generated from evidence.',
    proof: 'agent-runtime.ts · provider-router.ts',
    color: '#f472b6',
    iconPath: 'M12 6V3m0 18v-3m6-9h3M3 12h3m11.66-6.66l2.12-2.12M3.22 20.78l2.12-2.12M17.66 20.78l2.12-2.12M3.22 3.22l2.12 2.12',
  },
];

export default function TrustLayer() {
  return (
    <section
      id="trust"
      className="relative px-4 py-24 sm:px-6 lg:px-8"
      aria-label="Trust layer"
    >
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400 mb-3 font-sans">
            Trust Layer
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight text-white leading-[1.15]">
            Built for controlled autonomy.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-300 font-sans leading-relaxed">
            Six guarantees, every one wired into the runtime. Not policies. Not promises. Code paths reviewers can grep.
          </p>
        </div>

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {POINTS.map((p, i) => (
            <motion.div
              key={p.title}
              className="rounded-xl p-5 min-w-0 flex gap-4"
              style={{
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            >
              <div
                className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg"
                style={{
                  background: `${p.color}12`,
                  color: p.color,
                  border: `1px solid ${p.color}30`,
                }}
                aria-hidden="true"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d={p.iconPath} />
                </svg>
              </div>

              <div className="min-w-0">
                <h3 className="font-display font-semibold text-white text-[15px] mb-1 leading-snug">
                  {p.title}
                </h3>
                <p className="text-[12.5px] text-slate-400 leading-relaxed font-sans">
                  {p.body}
                </p>
                <p className="mt-2 text-[10px] font-mono truncate" style={{ color: `${p.color}cc` }}>
                  {p.proof}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
