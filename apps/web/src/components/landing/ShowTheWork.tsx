'use client';

/**
 * "Show the work" — four product-proof cards. Each card is grounded in
 * a real shipped JAK surface and shows a concrete preview snippet — the
 * kind of artifact JAK actually produces — instead of a generic
 * capability description.
 *
 * Card → real product surface mapping:
 * - Competitor research brief → research.agent.ts + Verifier citation density gate
 * - LinkedIn + outreach drafts → /social-drafts route + LinkedIn adapter buildDraft()
 * - Website review + fixes    → BrowserOperator + WORKER_DESIGNER + sandbox edits
 * - Audit-ready evidence pack → AuditLog + bundle.service.ts (HMAC-SHA256)
 *
 * (The previously-shipped 6-card variant included a Tool installer
 * card and a Multi-platform social drafts card. Both surfaces still
 * ship in the product; they just don't need their own homepage tile —
 * the social-draft card already implies multi-platform via the
 * "/social-drafts" reference, and the installer is documented inside
 * the cockpit, not on the marketing page.)
 */

import { LandingIcon, type LandingIconName } from './landing-icons';

interface ProofCard {
  iconName: LandingIconName;
  title: string;
  what: string;
  /** Concrete preview snippet — looks like a real artifact JAK ships. */
  preview: React.ReactNode;
  /** Two short capability badges, each backed by a concrete code subsystem. */
  badges: [string, string];
  color: string;
}

const OUTCOMES: ProofCard[] = [
  {
    iconName: 'search',
    title: 'Competitor + market research brief',
    what: 'Multi-agent research across the web and your own documents. Every claim cites a source — uncited statements get flagged before delivery.',
    preview: (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {['Competitor A', 'Competitor B', 'Competitor C'].map((c) => (
            <span key={c} className="inline-flex items-center rounded-md bg-sky-500/10 border border-sky-500/25 px-2 py-0.5 text-[10px] font-mono text-sky-300">
              {c}
            </span>
          ))}
        </div>
        <ul className="space-y-1 text-[11px] text-slate-300 font-sans">
          <li className="flex items-start gap-1.5"><span className="text-sky-400 mt-0.5">·</span><span>Pricing gap on the entry tier <span className="text-slate-500">[evidence: doc_3]</span></span></li>
          <li className="flex items-start gap-1.5"><span className="text-sky-400 mt-0.5">·</span><span>Positioning angle missed by all 3 <span className="text-slate-500">[evidence: web_7]</span></span></li>
          <li className="flex items-start gap-1.5"><span className="text-sky-400 mt-0.5">·</span><span>2 LinkedIn posts to copy + adapt <span className="text-slate-500">[evidence: web_4]</span></span></li>
        </ul>
      </div>
    ),
    badges: ['Citation density ≥ 0.7', 'pgvector RAG'],
    color: '#38bdf8',
  },
  {
    iconName: 'mail',
    title: 'LinkedIn + outreach drafts',
    what: 'Researches your company and audience, then drafts a LinkedIn post + cold-email + follow-up sequence in your brand voice. JAK drafts; you approve. Nothing publishes or sends without your sign-off.',
    preview: (
      <div className="rounded-md border border-pink-500/20 bg-pink-500/5 p-2.5 space-y-1.5">
        <p className="text-[11px] text-slate-200 font-sans leading-relaxed">
          &ldquo;Three things every founder should know about positioning against {'{Competitor A}'}, {'{B}'}, {'{C}'}&hellip;&rdquo;
        </p>
        <div className="flex flex-wrap gap-1">
          {['#Founders', '#GoToMarket', '#Positioning'].map((tag) => (
            <span key={tag} className="rounded-full bg-pink-500/10 border border-pink-500/20 px-1.5 py-0.5 text-[9px] font-mono text-pink-300">
              {tag}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-pink-300/80 font-mono">
          □ Replace {'{placeholders}'} · □ Add link · □ Approve before publishing
        </p>
      </div>
    ),
    badges: ['Manual handoff required', 'Brand-voice grounded'],
    color: '#f472b6',
  },
  {
    iconName: 'rocket',
    title: 'Website review + 5 fixes mapped to source',
    what: 'Crawls your site, screenshots key pages, reviews design + copy + SEO, and proposes concrete fixes that point at the exact source files in your repo.',
    preview: (
      <ul className="space-y-1.5 text-[11px] font-mono">
        <li className="flex items-start gap-2 text-slate-300">
          <span className="text-emerald-400 shrink-0">[1]</span>
          <span className="truncate">apps/web/.../page.tsx <span className="text-slate-500">· hero CTA contrast</span></span>
        </li>
        <li className="flex items-start gap-2 text-slate-300">
          <span className="text-emerald-400 shrink-0">[2]</span>
          <span className="truncate">components/Pricing.tsx <span className="text-slate-500">· mobile tap target</span></span>
        </li>
        <li className="flex items-start gap-2 text-slate-300">
          <span className="text-emerald-400 shrink-0">[3]</span>
          <span className="truncate">app/layout.tsx <span className="text-slate-500">· meta description &lt; 50 chars</span></span>
        </li>
        <li className="text-[10px] text-emerald-300/80">+ 2 more · all sandbox-only until you approve</li>
      </ul>
    ),
    badges: ['Source-file pointers', 'Sandbox-only edits'],
    color: '#34d399',
  },
  {
    iconName: 'shield',
    title: 'Audit-ready evidence pack',
    what: 'Every workflow step lands in a tamper-evident audit log. When an enterprise asks, JAK exports a HMAC-SHA256-signed evidence bundle that verifies byte-for-byte — across SOC 2, HIPAA, and ISO 27001 controls.',
    preview: (
      <div className="rounded-md border border-orange-500/25 bg-orange-500/5 p-2.5 space-y-1">
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-orange-300" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span className="text-[10px] font-mono text-orange-200 uppercase tracking-wider">Bundle verified</span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] font-mono">
          <span className="text-slate-500">runs</span>
          <span className="text-white">847, 846, 845</span>
          <span className="text-slate-500">controls</span>
          <span className="text-white">63 SOC 2 · all evidenced</span>
          <span className="text-slate-500">signature</span>
          <span className="text-orange-300 truncate">hmac:7a4c…f0d2 ✓</span>
        </div>
      </div>
    ),
    badges: ['HMAC-SHA256 signed', 'Replay-safe approval'],
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
            What JAK actually ships
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">
            Finished work, not chat output.
          </h2>
          <p className="mt-4 text-slate-300 font-sans">
            Every workflow ends in something concrete &mdash; a brief, a draft, a diff, an audit pack. Approval-gated where it matters, signed where it&rsquo;s required, reversible where it&rsquo;s risky.
          </p>
        </div>

        {/* 4-card grid: 1 col mobile · 2 col on tablet+ (a 4-card grid
             reads cleaner as 2x2 than as 4x1 or as a leftover-row 3+1).
             grid-cols-1 explicit so the implicit-grid track doesn't size
             to max-content of the longest-line card on narrow viewports
             (a 370px column inside a 343px container clipped under the
             hero's overflow-x-hidden on 375px mobile). min-w-0 on each
             article allows truncation/wrapping inside its column. */}
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2">
          {OUTCOMES.map((o) => (
            <article
              key={o.title}
              className="glass-card rounded-2xl p-6 card-lift flex flex-col min-w-0"
              style={{ borderLeft: `3px solid ${o.color}` }}
            >
              <div className="mb-3">
                <div
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: `${o.color}15`,
                    color: o.color,
                    border: `1px solid ${o.color}30`,
                  }}
                  aria-hidden="true"
                >
                  <LandingIcon name={o.iconName} className="h-4.5 w-4.5" />
                </div>
              </div>

              <h3 className="font-display font-semibold text-white text-base mb-2 leading-snug">
                {o.title}
              </h3>
              <p className="text-[13px] text-slate-300 leading-relaxed font-sans mb-4">
                {o.what}
              </p>

              {/* Concrete preview snippet — looks like a real artifact JAK ships. */}
              <div className="mb-4">{o.preview}</div>

              {/* Capability badges — each names a concrete subsystem you can
                  grep for in the codebase. */}
              <div className="mt-auto pt-3 border-t border-white/5 flex flex-wrap gap-2">
                {o.badges.map((badge) => (
                  <span
                    key={badge}
                    className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium font-sans"
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
