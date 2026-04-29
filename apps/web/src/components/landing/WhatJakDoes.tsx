'use client';

/**
 * "What JAK does" — the three-column scope summary required by the landing
 * audit (§5 and §20). Stands between the Verify section and the consolidated
 * Build section. Gives the visitor a single scannable moment that says
 * "JAK builds, operates, and verifies — one platform" without forcing them
 * to read six card grids to figure out the category.
 *
 * Design constraints:
 * - Matches the existing glass-card + colored left-border DNA used by the
 *   other landing card grids, so the section doesn't read as an alien
 *   insert.
 * - Three accents only: emerald (build), sky (operate), rose (verify).
 *   Audit §17 standardizes these as meaning-carrying colors.
 * - No new icons library — uses existing LandingIcon names already imported
 *   on the homepage. No new animation; visual calm is the point.
 * - Anchors to the existing in-page `#agents`, `#workflow`, `#pricing`
 *   routes are preserved by NOT giving this section its own anchor (it's
 *   a summary, not a linkable destination).
 */

import { LandingIcon, type LandingIconName } from './landing-icons';

const PILLARS: Array<{
  key: 'plan' | 'execute' | 'approve';
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  color: string;
  iconName: LandingIconName;
}> = [
  {
    key: 'plan',
    eyebrow: 'Plan',
    title: 'Plain English in. Workflow out.',
    body: 'Type a task like "research my top 3 competitors and draft a LinkedIn post." JAK turns it into a multi-step plan you can review before anything runs.',
    points: [
      'Natural language &rarr; structured plan',
      'Pre-built templates for research, content, outreach, code review',
      'Edit the plan before you approve it',
    ],
    color: '#34d399',
    iconName: 'bolt',
  },
  {
    key: 'execute',
    eyebrow: 'Execute',
    title: 'Specialist agents do the work.',
    body: 'Research, content, code, design, ops — each task runs on the right specialist, using your connected tools. You watch every step in the cockpit, not a black box.',
    points: [
      'Live cockpit shows every agent step',
      'Connects to Gmail, Slack, GitHub, Notion, HubSpot, and 20+ MCP servers',
      'Self-healing retries when a tool fails',
    ],
    color: '#38bdf8',
    iconName: 'bolt',
  },
  {
    key: 'approve',
    eyebrow: 'Approve & Audit',
    title: 'Nothing risky ships without you.',
    body: 'Every external action (send email, post to Slack, deploy code, charge a card) pauses for your approval. The exact tool, files, and expected result are bound to your decision &mdash; replays with a different payload are rejected.',
    points: [
      'Inline approval card shows tool + files + expected result',
      'Tamper-evident audit trail on every workflow run',
      'Optional SOC 2 / HIPAA / ISO 27001 evidence packs when you need them',
    ],
    color: '#f472b6',
    iconName: 'shield',
  },
];

export default function WhatJakDoes() {
  return (
    <section className="relative px-4 py-24 sm:px-6 lg:px-8" aria-label="What JAK does">
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400 mb-3 font-sans">
            How JAK Works
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">
            Plan. Execute. Approve.
          </h2>
          <p className="mt-4 text-slate-300 font-sans">
            Three steps from a task to a result you trust. Built so a solo founder can ship work that used to need an agency or a team of five.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div
              key={pillar.key}
              className="rounded-2xl p-7 glass-card card-lift flex flex-col"
              style={{
                borderLeft: `3px solid ${pillar.color}`,
              }}
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

              <ul className="mt-auto space-y-1.5">
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
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
