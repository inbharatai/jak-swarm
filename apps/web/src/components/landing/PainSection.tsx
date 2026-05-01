'use client';

/**
 * PainSection — three-card pain framing block.
 *
 *   Title: "AI chat gives answers. JAK gets work done."
 *
 * Sets up the rest of the page by naming exactly why a chatbot isn't
 * enough. Three cards, each with a clear "what's broken" line + a one-
 * sentence "what JAK does instead" line so the framing reads as a real
 * differentiator, not a strawman attack on chat.
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
    title: 'Chatbots don’t manage workflows',
    pain: 'You ask a chatbot for help. It writes a great paragraph. Then you copy, paste, switch tabs, follow up, retry. The work doesn’t finish itself.',
    fix: 'JAK turns one command into a multi-step plan, hands each step to the right agent, and pushes the result through to the finish.',
  },
  {
    accent: '#fbbf24',
    glyphPath: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
    title: 'Agents are dangerous without approval gates',
    pain: 'An autonomous agent that can send email, post publicly, run code, or move money is a liability the moment it misreads context.',
    fix: 'JAK pauses every external action behind an inline approval card that names the tool, the payload, and the file. No surprises, no replays.',
  },
  {
    accent: '#34d399',
    glyphPath: 'M3 13l4-4 4 4 7-7M21 6h-5M21 6v5',
    title: 'Real work needs visibility, traceability, and control',
    pain: 'You can’t hand business work to an opaque black box. You need to see who did what, when, and prove it later if a customer asks.',
    fix: 'Every agent step lands in the cockpit timeline. Every workflow leaves a tamper-evident audit trail. Every output is replayable.',
  },
];

export default function PainSection() {
  return (
    <section
      className="relative px-4 py-24 sm:px-6 lg:px-8"
      aria-label="Why chat isn't enough"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 mb-3 font-sans">
            Why chat isn&rsquo;t enough
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight text-white leading-[1.15]">
            AI chat gives answers.{' '}
            <span
              className="landing-gradient-text"
              style={{
                background: 'linear-gradient(135deg, #34d399, #fbbf24)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              JAK gets work done.
            </span>
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-300 font-sans leading-relaxed">
            A chatbot is a generator. JAK is an operator. Three things change the moment you stop chatting and start running workflows.
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
