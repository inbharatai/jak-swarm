'use client';

/**
 * EngineDuo — the hero's primary visual.
 *
 * Replaces the old HeroCockpit typing demo. Instead of a generic "watch a
 * workflow run" mockup, the hero now leads with JAK's two flagship engines
 * side by side, so a visitor sees the actual IP in the first viewport:
 *
 *   Engine 01 · Company Brain   — evidence → drift → spec
 *   Engine 02 · Hyperagent      — repair → learn
 *
 * Honest framing is non-negotiable here (this is the first thing people see):
 *   - Company Brain: cited evidence graph, multi-signal lexical + graph
 *     retrieval, NO vector/embedding component.
 *   - Hyperagent: integration-proven and default-off — not production-proven.
 *
 * Each card carries a `data-evidence-path` pointing at a real source file,
 * and an anchor CTA that scrolls to the engine's full section below
 * (#company-os / #hyperagent). Plain `<a href="#...">` anchors, not `<Link>`
 * (same-page scroll). No framer-motion — CSS keyframe animations keep this
 * SSR-friendly for above-fold LCP, and the stagger halts for
 * `prefers-reduced-motion`.
 *
 * Honesty: no autonomy overclaim, no production-readiness overclaim, no
 * compliance-attestation overclaim, no cost-comparison overclaim. The
 * banned-phrase scan in tests/unit/landing/landing-claim-vs-code.test.ts
 * enforces this on the file.
 */

import { LandingIcon, type LandingIconName } from './landing-icons';

type EngineKey = 'brain' | 'hyper';

interface Step {
  label: string;
  detail: string;
}

interface Engine {
  key: EngineKey;
  eyebrow: string;
  title: string;
  steps: Step[];
  honest: string;
  cta: string;
  href: string;
  evidencePath: string;
  evidenceLabel: string;
  color: string;
  iconName: LandingIconName;
}

const ENGINES: Engine[] = [
  {
    key: 'brain',
    eyebrow: 'Engine 01',
    title: 'Company Brain',
    steps: [
      { label: 'evidence', detail: 'source-labeled artifacts + graph entities' },
      { label: 'drift', detail: 'deterministic comparator flags the gap' },
      { label: 'spec', detail: 'agent-executable, reviewer-approved' },
    ],
    honest:
      'Cited evidence graph. Multi-signal lexical + graph retrieval — no vector/embedding component.',
    cta: 'Explore Company Brain',
    href: '#company-os',
    evidencePath: 'apps/api/src/services/company-brain/company-operating-layer.service.ts',
    evidenceLabel: 'company-operating-layer.service.ts',
    color: '#34d399',
    iconName: 'brain',
  },
  {
    key: 'hyper',
    eyebrow: 'Engine 02',
    title: 'Hyperagent',
    steps: [
      { label: 'repair', detail: 'classify failure → counterfactual → symbolic re-plan' },
      { label: 'learn', detail: 'SHADOW → CANARY → PROMOTED, human-gated' },
    ],
    honest:
      'Self-healing re-plan loop + governed self-learning. Integration-proven and default-off — not production-proven.',
    cta: 'Explore Hyperagent',
    href: '#hyperagent',
    evidencePath: 'packages/swarm/src/hyperagent/spec-executor.ts',
    evidenceLabel: 'spec-executor.ts (pure core)',
    color: '#c084fc',
    iconName: 'refresh',
  },
];

export default function EngineDuo() {
  return (
    <div
      className="grid gap-4 sm:gap-5 md:grid-cols-2 text-left"
      aria-label="JAK's two flagship engines: Company Brain and Hyperagent"
    >
      {ENGINES.map((engine, idx) => (
        <a
          key={engine.key}
          href={engine.href}
          data-evidence-path={engine.evidencePath}
          className="group rounded-2xl glass-card card-lift p-6 sm:p-7 flex flex-col min-w-0 engine-duo-card focus-visible:ring-2 focus-visible:ring-white/30 outline-none"
          style={{
            borderLeft: `3px solid ${engine.color}`,
            animationDelay: `${idx * 120}ms`,
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
              style={{
                background: `${engine.color}15`,
                color: engine.color,
                border: `1px solid ${engine.color}30`,
              }}
              aria-hidden="true"
            >
              <LandingIcon name={engine.iconName} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p
                className="text-[10px] font-semibold uppercase tracking-[0.18em] font-sans"
                style={{ color: engine.color }}
              >
                {engine.eyebrow}
              </p>
              <h3 className="font-display font-bold text-white text-lg leading-tight truncate">
                {engine.title}
              </h3>
            </div>
          </div>

          {/* Compact loop — steps stagger in via CSS keyframes. */}
          <ol className="space-y-2 mb-4">
            {engine.steps.map((step, sIdx) => (
              <li
                key={step.label}
                className="flex items-start gap-2.5 engine-duo-step"
                style={{ animationDelay: `${idx * 120 + 200 + sIdx * 140}ms` }}
              >
                <span
                  className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-mono font-bold"
                  style={{
                    background: `${engine.color}18`,
                    color: engine.color,
                    border: `1px solid ${engine.color}40`,
                  }}
                  aria-hidden="true"
                >
                  {sIdx + 1}
                </span>
                <div className="min-w-0">
                  <span className="font-mono text-sm font-semibold text-white">{step.label}</span>
                  <span className="text-slate-400 font-sans text-xs leading-relaxed block">
                    {step.detail}
                  </span>
                </div>
              </li>
            ))}
          </ol>

          <p className="text-xs text-slate-300 font-sans leading-relaxed mb-4">
            {engine.honest}
          </p>

          <div
            className="mt-auto pt-3 border-t flex items-center justify-between gap-2"
            style={{ borderColor: `${engine.color}25` }}
          >
            <span
              className="inline-flex items-center gap-1.5 text-sm font-semibold font-sans transition-transform group-hover:translate-x-0.5"
              style={{ color: engine.color }}
            >
              {engine.cta}
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </span>
            <span className="text-[10px] font-mono text-slate-500 truncate hidden sm:inline">
              {engine.evidenceLabel}
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}