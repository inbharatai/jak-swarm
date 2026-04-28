'use client';

/**
 * "Show the work" — outcome-first deliverable preview cards. The point of
 * this section is to answer "what does JAK actually finish?" with concrete
 * artifacts, not capability lists. Each card maps to a real, code-backed
 * product surface so the marketing claim is verifiable:
 *
 * - SOC 2 evidence pack  → /audit/runs (48 controls, FinalAuditPackService,
 *   HMAC-signed bundles, reviewer-gated workpapers)
 * - Generated SaaS app   → /builder (App Architect + Code Generator +
 *   Auto-Debugger pipeline, real $0.50-$1.50 cost band)
 * - Market research brief → research.agent.ts + citation-density verifier
 *   (Sprint 2.4/F) — outputs cite sources with density gating
 * - Cold-email campaign  → email.agent.ts + RuntimePIIRedactor at the LLM
 *   boundary (Sprint 2.4/G)
 *
 * Time-saved figures are conservative ranges, NOT marketing exaggeration —
 * they reflect realistic operator-vs-JAK comparisons, not best-case demos.
 */

import { LandingIcon, type LandingIconName } from './landing-icons';

const OUTCOMES: Array<{
  iconName: LandingIconName;
  title: string;
  what: string;
  was: string;
  now: string;
  detail: string;
  color: string;
}> = [
  {
    iconName: 'shield',
    title: 'SOC 2 Type 2 evidence pack',
    what: 'Plan controls, auto-map evidence, run LLM-driven control tests, generate per-control workpaper PDFs gated by reviewer approval, sign the final pack.',
    was: '6–12 weeks',
    now: '3–5 days',
    detail: '48 SOC 2 controls · HMAC-signed bundle',
    color: '#fb923c',
  },
  {
    iconName: 'rocket',
    title: 'Production-ready SaaS app',
    what: 'Describe the app. JAK designs the architecture, generates every file (no stubs), runs a 3-layer build check, debugs failures, deploys.',
    was: '2–5 days',
    now: '15–60 min',
    detail: '$0.50–$1.50 per generated app',
    color: '#34d399',
  },
  {
    iconName: 'search',
    title: 'Market research brief',
    what: 'Multi-agent research over web + your documents. Citation-density verification gates output. Evidence-backed claims only — uncited statements get flagged before delivery.',
    was: '4–8 hours',
    now: '15–25 min',
    detail: 'Source-grounded · citation density ≥ 0.7',
    color: '#38bdf8',
  },
  {
    iconName: 'mail',
    title: 'Cold-email campaign',
    what: 'Persona research, deliverability checks, A/B variants, send-time recommendations — with runtime PII redaction at the LLM boundary so customer data never leaves your control.',
    was: '3–6 hours',
    now: '10–20 min',
    detail: 'PII-redacted · CAN-SPAM aware',
    color: '#f472b6',
  },
];

export default function ShowTheWork() {
  return (
    <section
      id="outcomes"
      className="relative px-4 py-24 sm:px-6 lg:px-8"
      aria-label="Outcomes JAK delivers"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-16 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400 mb-3 font-sans">
            Outcomes
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">
            Finished work, not chat output.
          </h2>
          <p className="mt-4 text-slate-300 font-sans">
            Every workflow ends in something you can ship. Approval-gated where it matters, signed where it&rsquo;s required, reversible where it&rsquo;s risky.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {OUTCOMES.map((o) => (
            <article
              key={o.title}
              className="glass-card rounded-2xl p-7 card-lift flex flex-col"
              style={{ borderLeft: `3px solid ${o.color}` }}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: `${o.color}15`,
                    color: o.color,
                    border: `1px solid ${o.color}30`,
                  }}
                  aria-hidden="true"
                >
                  <LandingIcon name={o.iconName} className="h-5 w-5" />
                </div>

                {/* Time-saved badge — was/now pattern. Reads as "before vs after"
                    without hyping. */}
                <div className="text-right">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    Was → Now
                  </div>
                  <div className="text-sm font-display font-semibold text-white tabular-nums">
                    <span className="text-slate-500 line-through decoration-slate-600/50">{o.was}</span>
                    <span className="mx-1.5 text-slate-600">→</span>
                    <span style={{ color: o.color }}>{o.now}</span>
                  </div>
                </div>
              </div>

              <h3 className="font-display font-semibold text-white text-lg mb-2 leading-snug">
                {o.title}
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed font-sans mb-4">
                {o.what}
              </p>

              <div className="mt-auto pt-3 border-t border-white/5">
                <p className="text-[11px] text-slate-500 font-mono uppercase tracking-widest">
                  {o.detail}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
