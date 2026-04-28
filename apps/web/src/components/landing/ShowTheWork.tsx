'use client';

/**
 * "Show the work" — outcome-first deliverable preview cards. The point of
 * this section is to answer "what does JAK actually finish?" with concrete
 * artifacts, not capability lists. Each card maps to a real, code-backed
 * product surface so every marketing claim is verifiable:
 *
 * - SOC 2 evidence pack  → /audit/runs (FinalAuditPackService gate, HMAC-
 *   signed bundles, reviewer-gated workpapers, FinalPackGateError)
 * - Generated SaaS app   → /builder (App Architect + Code Generator +
 *   Auto-Debugger pipeline; per-tier model resolver controls cost)
 * - Market research brief → research.agent.ts + Verifier citation-density
 *   gate (Sprint 2.4/F) — outputs cite sources with density ≥ 0.7
 * - Cold-email campaign  → email.agent.ts + RuntimePIIRedactor at the LLM
 *   boundary (Sprint 2.4/G)
 *
 * 2026-04-28 honesty pass: removed the unverifiable "was N hours / weeks
 * → now N minutes / days" badges from each card. Those numbers had no
 * benchmarking, no telemetry, and no code reference — they were marketing
 * fiction. They have been replaced with two short capability badges per
 * card, each citing a specific real subsystem (FinalPackGateError,
 * PII redaction at LLM boundary, citation density gate, build-check loop).
 * Reviewers can grep the codebase and confirm each claim.
 */

import { LandingIcon, type LandingIconName } from './landing-icons';

const OUTCOMES: Array<{
  iconName: LandingIconName;
  title: string;
  what: string;
  /** Two short capability badges, each backed by a concrete code subsystem. */
  badges: [string, string];
  color: string;
}> = [
  {
    iconName: 'shield',
    title: 'SOC 2 Type 2 evidence pack',
    what: 'Plan controls, auto-map evidence, run LLM-driven control tests, generate per-control workpaper PDFs gated by reviewer approval, sign the final pack.',
    badges: ['Reviewer-gated workpapers', 'HMAC-signed final pack'],
    color: '#fb923c',
  },
  {
    iconName: 'rocket',
    title: 'Production-ready SaaS app',
    what: 'Describe the app. JAK designs the architecture, generates every file (no stubs), runs a 3-layer build check, debugs failures, deploys.',
    badges: ['3-layer build check', 'Per-tier model routing'],
    color: '#34d399',
  },
  {
    iconName: 'search',
    title: 'Market research brief',
    what: 'Multi-agent research over web + your documents. Citation-density verification gates output. Evidence-backed claims only — uncited statements get flagged before delivery.',
    badges: ['Citation density ≥ 0.7', 'pgvector RAG'],
    color: '#38bdf8',
  },
  {
    iconName: 'mail',
    title: 'Cold-email campaign',
    what: 'Persona research, deliverability checks, A/B variants, send-time recommendations — with runtime PII redaction at the LLM boundary so customer data never leaves your control.',
    badges: ['PII redacted at LLM boundary', 'CAN-SPAM aware'],
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
              <div className="mb-4">
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
              </div>

              <h3 className="font-display font-semibold text-white text-lg mb-2 leading-snug">
                {o.title}
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed font-sans mb-4">
                {o.what}
              </p>

              {/* Capability badges — each names a concrete subsystem you can
                  grep for in the codebase. No time-saved figures, no cost
                  claims, no aspirational ranges. */}
              <div className="mt-auto pt-3 border-t border-white/5 flex flex-wrap gap-2">
                {o.badges.map((badge) => (
                  <span
                    key={badge}
                    className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium font-sans"
                    style={{
                      background: `${o.color}15`,
                      border: `1px solid ${o.color}30`,
                      color: '#fafafa',
                    }}
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
