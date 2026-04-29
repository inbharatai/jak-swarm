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
    iconName: 'search',
    title: 'Competitor + market research brief',
    what: 'Multi-agent research over the web and your own documents. Every claim cites a source — uncited statements get flagged before delivery, not after a customer notices.',
    badges: ['Citation density ≥ 0.7', 'pgvector RAG'],
    color: '#38bdf8',
  },
  {
    iconName: 'mail',
    title: 'LinkedIn posts + outreach drafts',
    what: 'Researches your company + audience, drafts a LinkedIn post, cold email, and follow-up sequence in your brand voice. Drafts only — nothing publishes or sends without your explicit approval.',
    badges: ['Brand-voice grounded', 'Send-only-after-approval'],
    color: '#f472b6',
  },
  {
    iconName: 'rocket',
    title: 'Website / landing-page review + fixes',
    what: 'Crawls your site, screenshots key pages, reviews design + copy + SEO, and proposes concrete fixes mapped to the source files in your repo. You approve each change before it lands.',
    badges: ['Source-file pointers', 'Sandbox-only edits'],
    color: '#34d399',
  },
  {
    iconName: 'shield',
    title: 'Audit-grade evidence pack (when you need it)',
    what: 'Every workflow run leaves a tamper-evident audit trail. When you sell to enterprise, the same trail powers SOC 2 / HIPAA / ISO 27001 evidence packs — reviewer-gated, HMAC-signed, ready for an external auditor.',
    badges: ['Reviewer-gated workpapers', 'HMAC-signed bundles'],
    color: '#fb923c',
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
