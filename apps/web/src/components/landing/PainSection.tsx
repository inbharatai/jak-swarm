'use client';

/**
 * PainSection — three-card pain framing block.
 *
 * Sets up the company operating layer positioning: companies do not only need another
 * chatbot; they need a trustworthy loop between scattered context and
 * controlled execution.
 *
 * Visual language: dim slate cards with a colored glyph on the left.
 * No neon gradients here — this section's job is to land hard, not
 * dazzle.
 */

import { motion } from 'framer-motion';

const PAINS = [
  {
    accent: '#f87171',
    glyphPath: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2',
    title: 'Company context is scattered',
    pain: 'Meetings, tickets, GitHub, Slack, Notion, support, emails, and customer calls all hold different pieces of the truth. AI cannot reason well when the evidence is fragmented.',
    fix: 'JAK starts with source-labeled artifacts and graph entities, so agents work from cited company evidence instead of vibes.',
  },
  {
    accent: '#fbbf24',
    glyphPath: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
    title: 'Teams drift from customer intent',
    pain: 'Roadmaps often say one thing, customer pain says another, and code activity can quietly move in a third direction. That gap is where teams waste sprints.',
    fix: 'JAK compares signals, decisions, tasks, specs, and code-change evidence, then flags drift before it becomes expensive.',
  },
  {
    accent: '#34d399',
    glyphPath: 'M3 13l4-4 4 4 7-7M21 6h-5M21 6v5',
    title: 'Agents need a trust boundary',
    pain: 'A system that can create specs, touch code, send messages, or operate tools must show evidence, ask approval, and leave a record.',
    fix: 'JAK Shield puts risky tool calls behind permissions, approvals, sandboxing, risk scoring, defensive review, and tamper-evident audit trails.',
  },
];

export default function PainSection() {
  return (
    <section
      className="relative px-4 py-24 sm:px-6 lg:px-8"
      aria-label="Why closed-loop execution matters"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 mb-3 font-sans">
            Why this matters
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight text-white leading-[1.15]">
            Scattered context creates drift.{' '}
            <span
              className="landing-gradient-text"
              style={{
                background: 'linear-gradient(135deg, #34d399, #fbbf24)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              JAK closes the loop.
            </span>
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-300 font-sans leading-relaxed">
            The goal is not another dashboard or another chatbot. The goal is an evidence-backed execution layer that knows what the company meant, what the team is doing, and what needs approval before agents act.
          </p>
        </div>

        <div className="grid gap-5 grid-cols-1 md:grid-cols-3">
          {PAINS.map((p, i) => (
            <motion.article
              key={p.title}
              className="rounded-2xl p-7 flex flex-col min-w-0 backdrop-blur-sm"
              style={{
                background: 'linear-gradient(180deg, rgba(20,20,24,0.85), rgba(15,15,20,0.7))',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              <div
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl mb-5"
                style={{
                  background: `${p.accent}12`,
                  color: p.accent,
                  border: `1px solid ${p.accent}30`,
                }}
                aria-hidden="true"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d={p.glyphPath} />
                </svg>
              </div>

              <h3 className="font-display font-semibold text-white text-lg mb-3 leading-snug">
                {p.title}
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed font-sans mb-4">
                {p.pain}
              </p>

              <div
                className="mt-auto pt-4 border-t text-sm font-sans text-slate-200 leading-relaxed"
                style={{ borderColor: `${p.accent}25` }}
              >
                <span className="text-[10px] font-mono uppercase tracking-wider mr-2" style={{ color: p.accent }}>
                  How JAK fixes it
                </span>
                <p className="mt-1.5">{p.fix}</p>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
