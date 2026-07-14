'use client';

/**
 * Hyperagent — the second of JAK's two flagship engines.
 *
 * Honest framing: a self-healing re-plan loop + a governed self-learning half.
 * Integration-proven, default-off, NOT production-proven. The live runtime seam
 * (spec-executor-runtime.ts) returns empty artifacts until it is wired; the
 * pure core (spec-executor.ts) does harvest. This section says that plainly.
 *
 * No overclaims: no "autonomous", no "production-ready", no "Nx cheaper". The
 * status table mirrors docs/hyperagent-current-state-audit.md.
 */

import Link from 'next/link';
import { LandingIcon, type LandingIconName } from './landing-icons';

const HALVES: Array<{
  key: 'heal' | 'learn';
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  evidencePath: string;
  evidenceLabel: string;
  color: string;
  iconName: LandingIconName;
}> = [
  {
    key: 'heal',
    eyebrow: 'Self-healing re-plan loop',
    title: 'Repair failed execution, not just retry it.',
    body: 'When the Verifier rejects output and the bounded-retry budget is exhausted, the Hyperagent classifies the failure with a deterministic 20-class classifier, runs a counterfactual fault isolation, hands a symbolic replanner a proposed new plan (an LLM may propose, only the symbolic layer may apply), and selectively re-executes under an autonomy gate. Destructive, permission, and approval-timeout failures are never auto-retried.',
    points: [
      'Deterministic 20-class failure classifier',
      'Symbolic replanner — LLM proposes, symbolic layer applies',
      'Autonomy-gated selective re-execution',
    ],
    evidencePath: 'packages/swarm/src/hyperagent/spec-executor.ts',
    evidenceLabel: 'spec-executor.ts (pure core)',
    color: '#c084fc',
    iconName: 'refresh',
  },
  {
    key: 'learn',
    eyebrow: 'Governed self-learning',
    title: 'Promote improvements only with evidence + a human.',
    body: 'A config-lifecycle gate (DRAFT → PROPOSED → SHADOW → CANARY ramp → PROMOTED, human-operated, no skip) wraps any autonomy-policy or repair-budget change. Promotion requires a measured mutual-information learning signal and a human TENANT_ADMIN approval. The agent may not self-promote; a safety-incident breach triggers automatic rollback.',
    points: [
      'SHADOW → CANARY → PROMOTED, no skip',
      'Measured MI signal required before promotion',
      'Human TENANT_ADMIN promotes; agent cannot',
    ],
    evidencePath: 'packages/swarm/src/hyperagent/spec-executor-runtime.ts',
    evidenceLabel: 'ConfigLifecycleService (live caller)',
    color: '#fbbf24',
    iconName: 'bolt',
  },
];

const STATUS: Array<{ component: string; status: string; honest: boolean; note: string }> = [
  { component: 'Pure-core spec executor', status: 'Shipped', honest: true, note: 'Harvests artifacts with provenance; classifies failures; replans. Integration-proven with a deterministic stub runPlan.' },
  { component: 'Live runtime seam', status: 'Open edge', honest: false, note: 'spec-executor-runtime.ts returns artifacts: [] and failureClassByTask is not yet wired into FinishedRun. Integration-graph-proven, not production-proven.' },
  { component: 'executeApprovedSpec closed loop', status: 'Env-blocked', honest: false, note: 'REVIEWER-gated API route + service exist; the live LangGraph + LLM round-trip is env-blocked.' },
  { component: 'ShieldMcpClient (Ed25519)', status: 'Observational canary', honest: false, note: 'Live behind SHIELD_MCP_CANARY=1 — records signed decisions to the audit chain, does NOT gate execution.' },
  { component: 'Self-learning in live graph', status: 'Default-off', honest: false, note: 'Wired behind hyperAgentEnabled (default false). Default workflows are byte-for-byte unchanged unless a tenant opts in.' },
];

export default function Hyperagent() {
  return (
    <section
      id="hyperagent"
      className="relative px-4 py-24 sm:px-6 lg:px-8"
      aria-label="Hyperagent — self-healing re-plan loop and governed self-learning"
      style={{ background: 'linear-gradient(180deg, transparent, rgba(192,132,252,0.04), rgba(251,191,36,0.025))' }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-16 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-300 mb-3 font-sans">
            Engine 02 · Hyperagent
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight text-white leading-[1.15]">
            The self-healing layer that repairs failed work and learns &mdash; carefully.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-300 font-sans leading-relaxed">
            JAK&rsquo;s second engine sits on top of the 38-agent runtime. It does two things: repair
            execution that the Verifier rejected (beyond a bounded retry), and promote only measured,
            human-approved improvements to autonomy policy. It is <span className="text-white font-semibold">integration-proven and default-off</span> &mdash; not production-proven. We say that plainly because burying it would be the opposite of why it exists.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/hyperagent"
              className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-transform duration-200 hover:scale-105 focus-visible:ring-2 focus-visible:ring-purple-400"
              style={{
                background: 'rgba(192,132,252,0.12)',
                border: '1px solid rgba(192,132,252,0.45)',
                touchAction: 'manipulation',
              }}
            >
              Open the Hyperagent Control Centre
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-mono text-slate-400">
              packages/swarm/src/hyperagent/
            </span>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {HALVES.map((half) => (
            <article
              key={half.key}
              className="rounded-2xl p-7 glass-card card-lift flex flex-col min-w-0"
              style={{ borderLeft: `3px solid ${half.color}` }}
              data-evidence-path={half.evidencePath}
            >
              <div
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg mb-4"
                style={{
                  background: `${half.color}15`,
                  color: half.color,
                  border: `1px solid ${half.color}30`,
                }}
                aria-hidden="true"
              >
                <LandingIcon name={half.iconName} className="h-5 w-5" />
              </div>

              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-2 font-sans" style={{ color: half.color }}>
                {half.eyebrow}
              </p>
              <h3 className="font-display font-semibold text-white text-lg mb-2 leading-snug">
                {half.title}
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed font-sans mb-4">
                {half.body}
              </p>

              <ul className="space-y-1.5">
                {half.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2 text-xs text-slate-400 font-sans">
                    <span
                      className="mt-1.5 h-1 w-1 rounded-full shrink-0"
                      style={{ background: half.color }}
                      aria-hidden="true"
                    />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>

              <div
                className="mt-auto pt-4 border-t text-[10px] font-mono text-slate-500"
                style={{ borderColor: `${half.color}25` }}
              >
                Evidence: <span className="text-slate-300">{half.evidenceLabel}</span>
              </div>
            </article>
          ))}
        </div>

        {/* Honest status table — every row mirrors docs/hyperagent-current-state-audit.md. */}
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-white/5 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400" aria-hidden="true" />
            <h3 className="text-sm font-display font-semibold text-white">
              Wired vs. pure-core &mdash; what is actually live today
            </h3>
          </div>
          <div className="divide-y divide-white/5">
            {STATUS.map((row) => (
              <div key={row.component} className="px-5 sm:px-6 py-4 grid gap-2 sm:grid-cols-[1.4fr_0.8fr_2fr] sm:gap-4 items-start">
                <div className="text-sm font-sans font-medium text-white">{row.component}</div>
                <div>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider font-sans"
                    style={{
                      background: row.honest ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)',
                      border: `1px solid ${row.honest ? 'rgba(52,211,153,0.35)' : 'rgba(251,191,36,0.35)'}`,
                      color: row.honest ? '#6ee7b7' : '#fcd34d',
                    }}
                  >
                    {row.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-sans leading-relaxed">{row.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-5 text-sm text-amber-100 font-sans leading-relaxed">
          Blunt beta truth: the Hyperagent self-healing <span className="font-semibold">core</span> is
          integration-proven, but the <span className="font-semibold">live runtime seam</span> still
          returns empty artifacts until it is wired, and the self-learning canary has not run against
          managed Postgres + a real LLM. Wiring that seam is the next code change that makes this
          engine honestly live. The full breakdown is in{' '}
          <a
            href="https://github.com/inbharatai/jak-swarm/blob/main/docs/hyperagent-current-state-audit.md"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-amber-300/50 hover:decoration-amber-200"
          >
            docs/hyperagent-current-state-audit.md
          </a>{' '}
          and the canary runbook in{' '}
          <a
            href="https://github.com/inbharatai/jak-swarm/blob/main/docs/production-canary-plan.md"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-amber-300/50 hover:decoration-amber-200"
          >
            docs/production-canary-plan.md
          </a>
          .
        </div>
      </div>
    </section>
  );
}