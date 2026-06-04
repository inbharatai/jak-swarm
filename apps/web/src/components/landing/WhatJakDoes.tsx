'use client';

/**
 * Company operating layer section.
 *
 * This is the company operating layer wedge, but the copy is intentionally bounded by the
 * implementation that exists today:
 *   1. evidence artifacts are real tenant-scoped records
 *   2. graph entities are extracted from evidence, not invented
 *   3. drift detection is deterministic
 *   4. Agent-generated specs require approval before execution
 *
 * Connector auto-sync is not claimed as complete here. The page says
 * "connected or manually ingested evidence" because the current /company UI
 * already supports source-labeled artifact ingestion, while deeper connector
 * sync remains the next build phase.
 */

import { LandingIcon, type LandingIconName } from './landing-icons';

const PILLARS: Array<{
  key: 'memory' | 'drift' | 'specs';
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
    key: 'memory',
    eyebrow: 'Company memory',
    title: 'Evidence first, not chatbot memory.',
    body: 'JAK stores source-labeled artifacts from docs, tickets, code, meetings, customer calls, support, Slack, Notion, Linear/Jira, GitHub, Gmail, or manual notes. It then extracts decisions, tasks, risks, owners, deadlines, customer signals, and code changes with citations.',
    points: [
      'Artifacts are tenant-scoped and body-hashed',
      'Entities cite the artifacts they came from',
      'Connector sync is setup-dependent; manual evidence already works',
    ],
    evidencePath: 'apps/api/src/routes/company-operating-layer.routes.ts',
    evidenceLabel: '/company/artifacts + /company/entities',
    color: '#38bdf8',
    iconName: 'brain',
  },
  {
    key: 'drift',
    eyebrow: 'Execution drift',
    title: 'Compare what is happening with what should happen.',
    body: 'The alignment engine looks for customer pain without matching work, decisions that never became tasks, execution that has no supporting decision, and stale high-priority tasks. It is a deterministic comparator, not a vague LLM opinion.',
    points: [
      'Flags unaddressed customer signals',
      'Finds decisions that were not operationalized',
      'Marks ungrounded execution and stale work',
    ],
    evidencePath: 'apps/api/src/services/company-brain/company-operating-layer.service.ts',
    evidenceLabel: 'buildDriftCandidates()',
    color: '#fbbf24',
    iconName: 'target',
  },
  {
    key: 'specs',
    eyebrow: 'Agent-executable specs',
    title: 'Turn drift into approved work.',
    body: 'When drift is found, JAK generates an agent-executable spec with objective, scope, acceptance criteria, test plan, agent task plan, approval gates, and cited evidence. A reviewer approves or rejects it before the team treats it as executable.',
    points: [
      'No template fallback for spec generation',
      'Acceptance criteria and test plans are explicit',
      'Reviewer approval is a real backend decision route',
    ],
    evidencePath: 'apps/web/src/app/(dashboard)/company/page.tsx',
    evidenceLabel: '/company/specs/generate + decide',
    color: '#34d399',
    iconName: 'document',
  },
];

export default function WhatJakDoes() {
  return (
    <section
      id="company-os"
      className="relative px-4 py-24 sm:px-6 lg:px-8"
      aria-label="Closed-loop company operating layer"
      style={{ background: 'linear-gradient(180deg, rgba(52,211,153,0.025), rgba(56,189,248,0.035), transparent)' }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-16 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400 mb-3 font-sans">
            Company operating layer
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight text-white leading-[1.15]">
            Product and engineering alignment, closed loop.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-300 font-sans leading-relaxed">
            JAK is not claiming to be a finished all-company AI OS today. The honest beta wedge is sharper: make product and engineering context legible to AI, detect drift, generate executable specs, and gate action through JAK Shield.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {PILLARS.map((pillar) => (
            <article
              key={pillar.key}
              className="rounded-2xl p-7 glass-card card-lift flex flex-col min-w-0"
              style={{ borderLeft: `3px solid ${pillar.color}` }}
              data-evidence-path={pillar.evidencePath}
            >
              <div
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg mb-4"
                style={{
                  background: `${pillar.color}15`,
                  color: pillar.color,
                  border: `1px solid ${pillar.color}30`,
                }}
                aria-hidden="true"
              >
                <LandingIcon name={pillar.iconName} className="h-5 w-5" />
              </div>

              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-2 font-sans" style={{ color: pillar.color }}>
                {pillar.eyebrow}
              </p>
              <h3 className="font-display font-semibold text-white text-lg mb-2 leading-snug">
                {pillar.title}
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed font-sans mb-4">
                {pillar.body}
              </p>

              <ul className="space-y-1.5">
                {pillar.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2 text-xs text-slate-400 font-sans">
                    <span
                      className="mt-1.5 h-1 w-1 rounded-full shrink-0"
                      style={{ background: pillar.color }}
                      aria-hidden="true"
                    />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>

              <div
                className="mt-auto pt-4 border-t text-[10px] font-mono text-slate-500"
                style={{ borderColor: `${pillar.color}25` }}
              >
                Evidence: <span className="text-slate-300">{pillar.evidenceLabel}</span>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-5 text-sm text-amber-100 font-sans leading-relaxed">
          Blunt beta truth: JAK has the Company OS data model, API routes, dashboard surface, deterministic drift detector, agent spec generator, approval decision route, and audit foundation. It still needs deeper connector auto-sync before the landing page should claim full company-wide OS coverage.
        </div>
      </div>
    </section>
  );
}
