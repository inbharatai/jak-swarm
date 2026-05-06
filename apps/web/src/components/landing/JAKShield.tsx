'use client';

/**
 * JAK Shield landing section.
 *
 * Positioning: "JAK Swarm does the work. JAK Shield makes the work safe."
 *
 * Each of the 6 feature cards points at a real shipped capability.
 * The truth-lock test in `scripts/check-docs-truth.ts` asserts every
 * card's claim is backed by a file path that actually exists.
 */

import { LandingIcon, type LandingIconName } from './landing-icons';

interface ShieldFeature {
  iconName: LandingIconName;
  title: string;
  body: string;
  /** Anchor file the truth-lock test will assert exists. */
  evidencePath: string;
  color: string;
}

const FEATURES: ShieldFeature[] = [
  {
    iconName: 'shield',
    title: 'Agent Firewall',
    body: 'Detects prompt-injection attacks and offensive-cyber requests (malware, exploits, credential theft, unauthorized scanning, phishing) BEFORE the LLM sees them. Defensive security work — audit my repo, harden auth, find CVEs — passes through.',
    evidencePath: 'packages/security/src/guardrails/offensive-cyber-detector.ts',
    color: '#ef4444',
  },
  {
    iconName: 'bolt',
    title: 'Risk-Based Approvals',
    body: 'Every tool call is classified across 6 risk tiers — READ_ONLY through CRITICAL_MANUAL_ONLY. Risky calls pause the workflow. Approval is bound to the exact payload via a SHA-256 hash; replays with modified payloads are rejected with HTTP 409.',
    evidencePath: 'packages/tools/src/registry/approval-policy.ts',
    color: '#fbbf24',
  },
  {
    iconName: 'wrench',
    title: 'Secure Tool Permissions',
    body: 'Per-tenant tool registry + industry-pack restrictions + Standing Orders (allowed-tools whitelist + blocked-actions list + budget cap + expiry). REVIEWER+ role required to install or run anything destructive.',
    evidencePath: 'packages/tools/src/registry/tenant-tool-registry.ts',
    color: '#34d399',
  },
  {
    iconName: 'rocket',
    title: 'Sandboxed Execution',
    body: 'Browser sessions in per-tenant data dirs (500 MB quota), URL allowlist with cloud-metadata + RFC1918 + IPv6 link-local blocked, DNS-rebinding defense on every navigation, downloads disabled. Installer runs in a sandboxed subprocess with literal argv (never shell:true), 60s timeout, stripped env.',
    evidencePath: 'packages/tools/src/browser-operator/playwright-browser-operator.ts',
    color: '#38bdf8',
  },
  {
    iconName: 'search',
    title: 'Defensive Vulnerability Triage',
    body: 'JAK Shield supports defensive security work — repo audits, dependency scans, secret-leak detection, patch recommendations. Offensive work (writing exploits, generating malware, phishing kits) is blocked at the boundary.',
    evidencePath: 'docs/jak-shield-manifest.md',
    color: '#c084fc',
  },
  {
    iconName: 'shield',
    title: 'Audit Evidence Layer',
    body: 'Every workflow lifecycle event lands in AuditLog. AgentTrace fields are PII-redacted at write time. workflows.{goal,error,finalOutput,planJson,stateJson} are AES-256-GCM encrypted at rest. Final evidence bundles are HMAC-SHA256 signed and verify byte-for-byte.',
    evidencePath: 'apps/api/src/services/bundle.service.ts',
    color: '#fb923c',
  },
];

export default function JAKShield() {
  return (
    <section
      id="jak-shield"
      className="relative px-4 py-24 sm:px-6 lg:px-8"
      aria-label="JAK Shield — security and trust layer"
      style={{
        background:
          'radial-gradient(ellipse at top, rgba(239,68,68,0.05), transparent 60%), radial-gradient(ellipse at bottom, rgba(56,189,248,0.04), transparent 60%)',
      }}
    >
      <div className="mx-auto max-w-6xl relative z-10">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-400 mb-3 font-sans">
            JAK Shield
          </p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">
            AI agents are powerful. JAK Shield makes them safe.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-300 font-sans leading-relaxed">
            Before an agent touches your code, browser, files, email, GitHub, or business tools, JAK Shield checks permissions, scores risk, blocks unsafe actions, asks for approval where needed, and records every step in a tamper-evident evidence bundle.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="glass-card rounded-2xl p-6 card-lift flex flex-col min-w-0"
              style={{ borderLeft: `3px solid ${f.color}` }}
              data-evidence-path={f.evidencePath}
            >
              <div
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg mb-4"
                style={{
                  background: `${f.color}15`,
                  color: f.color,
                  border: `1px solid ${f.color}30`,
                }}
                aria-hidden="true"
              >
                <LandingIcon name={f.iconName} className="h-5 w-5" />
              </div>

              <h3 className="font-display font-semibold text-white text-base mb-2 leading-snug">
                {f.title}
              </h3>
              <p className="text-[13px] text-slate-300 leading-relaxed font-sans">
                {f.body}
              </p>

              <p className="mt-4 pt-3 border-t border-white/5 text-[10px] font-mono text-slate-500 truncate" title={f.evidencePath}>
                {f.evidencePath}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-12 max-w-3xl mx-auto rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 mb-2 font-sans">
            Safety boundary
          </p>
          <p className="text-sm text-slate-300 leading-relaxed font-sans">
            JAK Shield is built for <strong className="text-white">defensive security, safe automation, permissioned workflows, and audit-ready agent execution</strong>. It does <strong className="text-white">not</strong> support offensive hacking, malware generation, credential theft, phishing, unauthorized scanning, or exploit generation. Defensive work is allowed. Offensive work is refused.
          </p>
        </div>
      </div>
    </section>
  );
}
