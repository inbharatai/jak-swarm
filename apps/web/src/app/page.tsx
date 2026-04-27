'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { OrchestrationEngine, CapabilityMap, LiveDemo, PremiumCTA, SupervisorSection, WhatJakDoes, LandingIcon, type LandingIconName } from '@/components/landing';

/* ─── Animated Counter Hook ──────────────────────────────────────────────── */

function useCountUp(end: number, duration = 2000) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setCount(end);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          const step = (now: number) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * end));
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration]);

  return { count, ref };
}

/* ─── Fade-in on scroll Hook ─────────────────────────────────────────────── */

function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

/* ─── SVG Logo Component ─────────────────────────────────────────────────── */

function JakLogo({ className = '', size = 40 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
      role="img"
    >
      {/* Network nodes background */}
      <circle cx="20" cy="20" r="3" fill="#34d399" opacity="0.4" />
      <circle cx="100" cy="25" r="2.5" fill="#fbbf24" opacity="0.3" />
      <circle cx="15" cy="100" r="2" fill="#34d399" opacity="0.3" />
      <circle cx="105" cy="95" r="3" fill="#f472b6" opacity="0.4" />
      <circle cx="60" cy="10" r="2" fill="#34d399" opacity="0.25" />
      <circle cx="60" cy="110" r="2.5" fill="#fbbf24" opacity="0.25" />
      {/* Connection lines */}
      <line x1="20" y1="20" x2="35" y2="42" stroke="#34d399" strokeWidth="0.8" opacity="0.2" />
      <line x1="100" y1="25" x2="82" y2="42" stroke="#fbbf24" strokeWidth="0.8" opacity="0.2" />
      <line x1="15" y1="100" x2="35" y2="78" stroke="#34d399" strokeWidth="0.8" opacity="0.2" />
      <line x1="105" y1="95" x2="82" y2="78" stroke="#f472b6" strokeWidth="0.8" opacity="0.2" />
      {/* Main letterforms */}
      <text
        x="60"
        y="74"
        textAnchor="middle"
        fontFamily="var(--font-display), Syne, system-ui, sans-serif"
        fontWeight="800"
        fontSize="52"
        letterSpacing="-2"
      >
        <tspan fill="url(#logoGradNew)">JAK</tspan>
      </text>
      <defs>
        <linearGradient id="logoGradNew" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ─── Icon Components ────────────────────────────────────────────────────── */

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

/* ─── Data ────────────────────────────────────────────────────────────────── */

const AGENTS = [
  { icon: 'CEO', label: 'CEO Agent', color: '#34d399', desc: 'Strategic planning, OKRs, cross-department coordination' },
  { icon: 'CTO', label: 'CTO Agent', color: '#fbbf24', desc: 'Architecture decisions, code reviews, tech stack evaluation' },
  { icon: 'CMO', label: 'CMO Agent', color: '#f472b6', desc: 'Campaign strategy, content creation, brand positioning' },
  { icon: 'ENG', label: 'Engineer', color: '#38bdf8', desc: 'Code generation, debugging, testing, CI/CD pipelines' },
  { icon: 'LAW', label: 'Legal Agent', color: '#c084fc', desc: 'Contract review, compliance checks, policy drafting' },
  { icon: 'MKT', label: 'Marketing', color: '#fb923c', desc: 'Content writing, email sequences, analytics reporting' },
];

const STATS = [
  { value: 38, label: 'Specialist Agents', suffix: '' },
  // 122 total tools. Every tool carries an honest maturity label — real,
  // heuristic, llm_passthrough, config_dependent, or experimental — CI-enforced
  // against the live registry. The old universal-grade label was retired because
  // only ~56 of 122 are `real` runtime integrations; the rest are honest
  // heuristics, LLM passthroughs, or config-gated.
  { value: 122, label: 'Classified Tools', suffix: '' },
  // 22 = 13 external SaaS connectors (incl. WhatsApp native bridge) + 9
  // infrastructure/MCP adapters surfaced in the UI. Only a subset are
  // production-ready runtime paths — see docs/integration-maturity-matrix.md.
  { value: 22, label: 'Connectors', suffix: '' },
  { value: 6, label: 'AI Providers', suffix: '' },
];

const WORKFLOW_STEPS = [
  { label: 'Command', desc: 'Natural language input', icon: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18', color: '#34d399' },
  { label: 'Commander', desc: 'Task decomposition', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75', color: '#fbbf24' },
  { label: 'Planner', desc: 'DAG assembly', icon: 'M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z', color: '#38bdf8' },
  { label: 'Workers', desc: 'Parallel execution', icon: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z', color: '#f472b6' },
  { label: 'Result', desc: 'Compiled output', icon: 'M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z', color: '#c084fc' },
];

const INTEGRATIONS_CORE = [
  { name: 'Slack', color: '#4A154B', bg: 'rgba(74,21,75,0.1)' },
  { name: 'GitHub', color: '#FFFFFF', bg: 'rgba(255,255,255,0.08)' },
  { name: 'Notion', color: '#FFFFFF', bg: 'rgba(255,255,255,0.08)' },
  { name: 'Google Drive', color: '#4285F4', bg: 'rgba(66,133,244,0.1)' },
  { name: 'Linear', color: '#5E6AD2', bg: 'rgba(94,106,210,0.1)' },
  { name: 'HubSpot', color: '#FF7A59', bg: 'rgba(255,122,89,0.1)' },
  { name: 'Stripe', color: '#635BFF', bg: 'rgba(99,91,255,0.1)' },
  { name: 'Salesforce', color: '#00A1E0', bg: 'rgba(0,161,224,0.1)' },
  { name: 'Airtable', color: '#18BFFF', bg: 'rgba(24,191,255,0.1)' },
  { name: 'ClickUp', color: '#7B68EE', bg: 'rgba(123,104,238,0.1)' },
  { name: 'SendGrid', color: '#0EA5E9', bg: 'rgba(14,165,233,0.1)' },
  { name: 'Discord', color: '#5865F2', bg: 'rgba(88,101,242,0.1)' },
  // WhatsApp: native bridge (not MCP) — apps/api/src/routes/whatsapp.routes.ts
  // Register number, verify, send command, receive via the bridge token.
  { name: 'WhatsApp', color: '#25D366', bg: 'rgba(37,211,102,0.1)' },
];

const INTEGRATIONS_INFRA = [
  { name: 'Supabase', color: '#3ECF8E', bg: 'rgba(62,207,142,0.1)' },
  // Sentry MCP: JAK agents can query your Sentry projects via the official
  // Sentry MCP server. NOT the Sentry SDK for error reporting from this API
  // — that would require wiring @sentry/node, which is deliberately not
  // installed (no runtime dependency added until you actually want it).
  { name: 'Sentry MCP', color: '#A855F7', bg: 'rgba(168,85,247,0.1)' },
  { name: 'Brave Search', color: '#FB6A25', bg: 'rgba(251,106,37,0.1)' },
  { name: 'PostgreSQL', color: '#336791', bg: 'rgba(51,103,145,0.1)' },
  { name: 'Puppeteer', color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
  { name: 'Filesystem', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  { name: 'Fetch', color: '#38bdf8', bg: 'rgba(56,189,248,0.1)' },
  { name: 'Memory', color: '#c084fc', bg: 'rgba(192,132,252,0.1)' },
  { name: 'Sequential Thinking', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
];

const PRICING = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Run JAK on your own infrastructure. Forever.',
    features: ['200 credits / month', '30 credits / day', '5 core agents', '1 vibe coding project', 'Standard AI models', 'Community support'],
    cta: 'Start Free',
    href: '/register',
    highlighted: false,
    accent: '',
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/mo',
    description: 'Hosted runtime with approvals built in.',
    features: ['3,000 credits / month', '200 credits / day', 'All 38 agents', '5 vibe coding projects', 'Premium AI models (Claude, GPT-4o)', '500 premium credits', 'Email support'],
    cta: 'Go Pro',
    href: '/register',
    highlighted: true,
    accent: 'emerald',
  },
  {
    name: 'Team',
    price: '$99',
    period: '/mo',
    description: 'Higher limits and priority model access for teams.',
    features: ['15,000 credits / month', '600 credits / day', 'All agents + custom skills', 'Unlimited projects', '3,000 premium credits', 'BYO API keys option', 'Priority support'],
    cta: 'Start Team',
    href: '/register',
    highlighted: false,
    accent: '',
  },
  {
    name: 'Enterprise',
    price: '$249',
    period: '/mo',
    description: 'SSO, audit exports, and dedicated deployment.',
    features: ['50,000 credits / month', '2,000 credits / day', '15,000 premium credits', 'SSO + RBAC', 'Audit logs', 'Custom integrations', 'Dedicated support'],
    cta: 'Contact Us',
    href: 'mailto:contact@inbharat.ai',
    highlighted: false,
    accent: 'amber',
  },
];

/* ─── Stat Card Component ────────────────────────────────────────────────── */

function StatCard({ value, label, suffix }: { value: number; label: string; suffix: string }) {
  const { count, ref } = useCountUp(value, 1800);
  return (
    <div ref={ref} className="glass-card rounded-xl p-6 text-center">
      {/* Stat numbers use a monospace font so every digit gets equal width —
          the previous Syne display font is proportional (no real `tnum`
          OpenType table), so "3" and "8" rendered visibly different widths
          at 48-60px. JetBrains Mono is already loaded for code blocks and
          guarantees visually balanced numerals. The `font-feature-settings`
          explicitly turns on tabular + lining figures for belt-and-braces
          consistency on future font swaps. */}
      <div
        className="landing-gradient-text text-5xl sm:text-6xl font-mono font-bold tracking-tight leading-[1.05]"
        style={{
          background: 'linear-gradient(135deg, #34d399, #fbbf24)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          fontFeatureSettings: '"tnum" 1, "lnum" 1',
        }}
      >
        {count}{suffix}
      </div>
      <div className="mt-2 text-sm font-medium text-slate-300 uppercase tracking-widest font-sans">{label}</div>
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function HomePage() {
  const router = useRouter();
  const [heroVisible, setHeroVisible] = useState(false);
  const [hoveredAgent, setHoveredAgent] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const agentGrid = useFadeIn();
  const workflowSection = useFadeIn();
  const integrationSection = useFadeIn();
  const testimonialSection = useFadeIn();

  // Redirect authenticated users to workspace
  // (Supabase middleware handles this at the edge, but this is a client-side safety net)
  useEffect(() => {
    const supabaseCookie = document.cookie.split(';').find(c => c.trim().startsWith('sb-'));
    if (supabaseCookie) router.replace('/workspace');
  }, [router]);

  // Hero entrance animation
  useEffect(() => {
    const t = setTimeout(() => setHeroVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <style>{`
        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes float-slow {
          0%, 100% { transform: translateY(0px) translateX(0px); }
          33% { transform: translateY(-15px) translateX(5px); }
          66% { transform: translateY(8px) translateX(-3px); }
        }
        @keyframes float-medium {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(52, 211, 153, 0.2), 0 0 60px rgba(52, 211, 153, 0.05); }
          50% { box-shadow: 0 0 30px rgba(52, 211, 153, 0.4), 0 0 80px rgba(52, 211, 153, 0.1); }
        }
        @keyframes dash-flow {
          to { stroke-dashoffset: -20; }
        }
        @keyframes flow-travel {
          0% { left: -5%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
        @keyframes flow-pulse {
          0% { opacity: 0.3; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1); }
          100% { opacity: 0.3; transform: scale(0.95); }
        }
        @keyframes hero-mesh {
          0% { transform: translate(0, 0) rotate(0deg); }
          33% { transform: translate(30px, -20px) rotate(120deg); }
          66% { transform: translate(-20px, 15px) rotate(240deg); }
          100% { transform: translate(0, 0) rotate(360deg); }
        }
        @keyframes border-rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .landing-root .landing-gradient-text {
          display: inline-block;
          padding-bottom: 0.12em;
          line-height: 1.1;
          overflow: visible;
        }
        .gradient-bg {
          background: linear-gradient(135deg, #09090b, #0a1a15, #09090b, #1a150a);
          background-size: 400% 400%;
          animation: gradient-shift 15s ease infinite;
        }
        .fade-section {
          opacity: 0;
          transform: translateY(40px);
          transition: opacity 0.8s ease, transform 0.8s ease;
        }
        .fade-section.visible {
          opacity: 1;
          transform: translateY(0);
        }
        .hero-mesh-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          pointer-events: none;
          animation: hero-mesh 20s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .gradient-bg { animation: none; }
          .hero-mesh-blob { animation: none; }
          .fade-section { opacity: 1; transform: none; transition: none; }
        }
      `}</style>

      {/* Skip to main content - Accessibility */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <main id="main-content" className="landing-root min-h-screen bg-[#09090b] text-white overflow-x-hidden font-sans">
        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 backdrop-blur-xl" style={{ background: 'rgba(9,9,11,0.6)' }} role="navigation" aria-label="Main navigation">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
            {/*
              Brand lockup: whitespace-nowrap on the "JAK Swarm" text so
              it never wraps to two lines on narrow viewports (375px was
              previously cramped — "JAK" on line 1, "Swarm" on line 2).
              shrink-0 on the wrapper protects the brand when the CTA
              group is under pressure.
            */}
            <div className="flex items-center gap-2 shrink-0">
              <JakLogo size={32} />
              <span className="text-base sm:text-lg font-display font-bold tracking-tight whitespace-nowrap">JAK Swarm</span>
            </div>
            <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
              <a href="#agents" className="hover:text-white focus-visible:text-white transition-colors duration-200">Agents</a>
              <a href="#workflow" className="hover:text-white focus-visible:text-white transition-colors duration-200">How It Works</a>
              <a href="#pricing" className="hover:text-white focus-visible:text-white transition-colors duration-200">Pricing</a>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {/* Mobile hamburger */}
              <button
                className="md:hidden p-2 text-slate-400 hover:text-white transition-colors"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle menu"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  {mobileMenuOpen
                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  }
                </svg>
              </button>
              {/* Sign In is hidden on mobile to free up horizontal space —
                  it lives inside the mobile menu dropdown instead. Also
                  whitespace-nowrap so "Sign In" never wraps on tablet. */}
              <Link href="/login" className="hidden sm:inline-flex text-sm font-medium text-slate-400 hover:text-white focus-visible:text-white transition-colors whitespace-nowrap">
                Sign In
              </Link>
              <Link href="/register" className="inline-flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-2 text-sm font-semibold text-[#09090b] transition-all duration-200 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-emerald-400 whitespace-nowrap" style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24)', touchAction: 'manipulation' }}>
                Get Started
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Mobile menu dropdown */}
          {mobileMenuOpen && (
            <div id="mobile-menu" className="md:hidden border-t border-white/5 px-4 py-4 space-y-3" style={{ background: 'rgba(9,9,11,0.95)' }}>
              <a href="#agents" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Agents</a>
              <a href="#workflow" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">How It Works</a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Pricing</a>
              <Link href="/builder" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-emerald-400 hover:text-emerald-300 transition-colors">Builder</Link>
              {/* Sign In moved here from the top bar so the brand + Get Started
                  have room to breathe without wrapping on 375px viewports. */}
              <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-300 hover:text-white transition-colors pt-2 border-t border-white/5">Sign In</Link>
            </div>
          )}
        </nav>

        {/* ── 1. Hero ──────────────────────────────────────────────────────── */}
        <section className="relative min-h-screen flex items-center gradient-bg px-4 pt-20 pb-16 sm:px-6 lg:px-8 grain-overlay">
          {/* Mesh gradient blobs - the hero moment */}
          <div className="hero-mesh-blob" style={{ width: 600, height: 600, top: '10%', left: '-10%', background: 'radial-gradient(circle, rgba(52,211,153,0.15) 0%, transparent 70%)' }} />
          <div className="hero-mesh-blob" style={{ width: 500, height: 500, top: '30%', right: '-5%', background: 'radial-gradient(circle, rgba(251,191,36,0.12) 0%, transparent 70%)', animationDelay: '-7s' }} />
          <div className="hero-mesh-blob" style={{ width: 400, height: 400, bottom: '5%', left: '30%', background: 'radial-gradient(circle, rgba(244,114,182,0.1) 0%, transparent 70%)', animationDelay: '-14s' }} />

          {/* Floating particles — cut from 8 → 4 per audit §17. At 8 with the
              mesh blobs + grid overlay the hero read as noise, not depth. */}
          {[
            { w: 4, h: 4, top: '15%', left: '10%', bg: '#34d399', opacity: 0.3, dur: '8s' },
            { w: 3, h: 3, top: '25%', left: '85%', bg: '#fbbf24', opacity: 0.25, dur: '10s' },
            { w: 5, h: 5, top: '70%', left: '15%', bg: '#f472b6', opacity: 0.2, dur: '12s' },
            { w: 6, h: 6, top: '40%', left: '90%', bg: '#fbbf24', opacity: 0.15, dur: '11s' },
          ].map((p, i) => (
            <div
              key={i}
              className="absolute rounded-full pointer-events-none"
              style={{
                width: p.w,
                height: p.h,
                top: p.top,
                left: p.left,
                background: p.bg,
                opacity: p.opacity,
                animation: `float-slow ${p.dur} ease-in-out infinite`,
                animationDelay: `${i * 0.7}s`,
              }}
            />
          ))}

          {/* (80px grid overlay removed per audit §17 — the mesh blobs +
               grain-overlay already carry the hero's background depth.) */}

          {/* Asymmetric hero layout */}
          <div className="relative mx-auto max-w-7xl w-full z-10 grid lg:grid-cols-12 gap-8 items-center" style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? 'translateY(0)' : 'translateY(40px)', transition: 'all 1s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            {/* Left: Text - offset to create asymmetry */}
            <div className="lg:col-span-7 lg:pr-8">
              {/* Eyebrow — category + posture.
                  Replaces the prior "38 Agents Live" count-led badge. Trust
                  & positioning lead; counts move lower as evidence. */}
              <div className="inline-flex items-center gap-2 mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[11px] font-semibold text-emerald-300/90 tracking-[0.18em] uppercase font-sans">
                  Operator-Grade &middot; Open-Source Core
                </span>
              </div>

              {/*
                Hero H1 — rewritten around the category, not a defensive
                workforce claim. One gradient span (the final line) carries
                the brand color.
                QA Fix: prior layout put "for" on its own middle line, which
                on 390px mobile read as a typo-fragment. Now "for" flows
                inline with "control plane" so the H1 reads as two lines
                on every viewport: "The trusted control plane for" /
                "autonomous work."
              */}
              <h1 className="mb-6 pb-2 text-4xl font-display font-bold tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl leading-[1.15] sm:leading-[1.1]">
                <span className="block text-white">The trusted control plane for</span>
                <span className="block mt-2 gradient-text landing-gradient-text">autonomous work.</span>
              </h1>

              <p className="mb-8 max-w-xl text-base text-slate-300 sm:text-lg leading-relaxed font-sans">
                One platform that plans, executes, verifies, and recovers &mdash; with human approvals on every high-risk action. Native <strong className="text-emerald-300">LangGraph</strong> orchestration, Postgres checkpoints, source-grounded verification, runtime PII redaction. Build, operate, and verify autonomous work on infrastructure you control.
              </p>

              <div className="flex flex-col sm:flex-row items-start gap-4 mb-8">
                <Link href="/register" className="group relative inline-flex items-center gap-2 rounded-xl px-8 py-4 text-base font-semibold text-[#09090b] transition-transform duration-200 hover:-translate-y-0.5 hover:scale-105 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]" style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24)', boxShadow: '0 0 30px rgba(52,211,153,0.3), 0 10px 40px rgba(52,211,153,0.15)', touchAction: 'manipulation' }}>
                  Start Free
                  <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-8 py-4 text-base font-semibold text-white transition-all duration-200 hover:bg-white/10 hover:border-white/20 focus-visible:ring-2 focus-visible:ring-white/50" aria-label="View JAK Swarm on GitHub">
                  <GitHubIcon className="h-5 w-5" />
                  View on GitHub
                </a>
              </div>
              {/*
                Trust strip — addresses the "no social proof, no credibility
                signal between hero and first content section" gap. Four
                lightweight badges: open-source license, tech stack signal,
                operator-grade posture, security posture. Text-only (no logos
                we don't have rights to), small and restrained so it reads
                as a signature row, not a billboard.
              */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400 font-sans">
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 1.5a.5.5 0 01.5.5v1.55a6.5 6.5 0 015.454 5.453h1.55a.5.5 0 010 1h-1.55a6.5 6.5 0 01-5.453 5.454v1.55a.5.5 0 01-1 0v-1.55a6.5 6.5 0 01-5.454-5.453H1.5a.5.5 0 010-1h1.55a6.5 6.5 0 015.453-5.454V2a.5.5 0 01.497-.5zM10 4.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zm0 2.5a3 3 0 110 6 3 3 0 010-6z" clipRule="evenodd" />
                  </svg>
                  <span>Open-source core</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 1a1 1 0 01.707.293l7 7A1 1 0 0117 10h-1v6a2 2 0 01-2 2h-2a1 1 0 01-1-1v-4H9v4a1 1 0 01-1 1H6a2 2 0 01-2-2v-6H3a1 1 0 01-.707-1.707l7-7A1 1 0 0110 1z" clipRule="evenodd" />
                  </svg>
                  <span>Self-hostable</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Approval gates on every high-risk action</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                  </svg>
                  <span>Durable execution &amp; recovery</span>
                </span>
              </div>
            </div>

            {/* Right: Visual - floating agent constellation */}
            <div className="lg:col-span-5 relative hidden lg:flex items-center justify-center min-h-[400px]">
              {/* Central node */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center z-10" style={{ animation: 'pulse-glow 3s ease-in-out infinite' }}>
                <JakLogo size={40} />
              </div>

              {/* Orbiting agent nodes. Coords rounded to 3 decimals so the
                  SSR + client string serialization match exactly — raw
                  Math.cos/sin floats drift at the 14th decimal in React's
                  attribute stringifier and fire hydration warnings. */}
              {AGENTS.map((agent, i) => {
                const angle = (i * 60 - 30) * (Math.PI / 180);
                const radius = 140;
                const x = Number((Math.cos(angle) * radius).toFixed(3));
                const y = Number((Math.sin(angle) * radius).toFixed(3));
                return (
                  <div
                    key={agent.label}
                    className="absolute w-12 h-12 rounded-xl flex items-center justify-center text-xs font-bold tracking-wider transition-transform duration-500 hover:scale-110"
                    style={{
                      top: `calc(50% + ${y}px - 24px)`,
                      left: `calc(50% + ${x}px - 24px)`,
                      background: `${agent.color}20`,
                      border: `1.5px solid ${agent.color}70`,
                      color: agent.color,
                      boxShadow: `0 0 24px ${agent.color}25`,
                      animation: `pulse-glow 3s ease-in-out infinite`,
                      animationDelay: `${i * 0.5}s`,
                    }}
                  >
                    {agent.icon}
                  </div>
                );
              })}

              {/* Connection lines SVG. Percentages rounded to 3 decimals
                  to keep SSR + client string output identical. */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                {AGENTS.map((agent, i) => {
                  const angle = (i * 60 - 30) * (Math.PI / 180);
                  const radius = 140;
                  const x = Number((50 + Math.cos(angle) * radius / 4).toFixed(3));
                  const y = Number((50 + Math.sin(angle) * radius / 4).toFixed(3));
                  return (
                    <line
                      key={i}
                      x1="50%" y1="50%"
                      x2={`${x}%`} y2={`${y}%`}
                      stroke={agent.color}
                      strokeWidth="1.2"
                      opacity="0.25"
                      strokeDasharray="4 4"
                      style={{ animation: 'dash-flow 2s linear infinite' }}
                    />
                  );
                })}
              </svg>
            </div>
          </div>
        </section>

        {/* ── 2. Trust Layer (promoted per audit §10 — was #10) ───────────── */}
        <SupervisorSection />

        {/* ── 2b. Orchestration Engine Visual ────────────────────────────── */}
        <OrchestrationEngine />

        {/* ── 3. Agent Grid ────────────────────────────────────────────────── */}
        <section id="agents" className="relative px-4 py-24 sm:px-6 lg:px-8">
          <div ref={agentGrid.ref} className={`fade-section ${agentGrid.visible ? 'visible' : ''} mx-auto max-w-6xl`}>
            {/* Asymmetric header - left aligned */}
            <div className="mb-16 max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400 mb-3 font-sans">The Specialists</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">Specialists, not a single generalist.</h2>
              <p className="mt-4 text-slate-300 font-sans">Each agent owns a domain, a scoped tool set, and a structured output schema. High-risk actions flow through a human approval gate &mdash; not straight to execution.</p>
            </div>

            {/* Agent cards - asymmetric grid with offset */}
            <div className="relative">
              {/* SVG connection lines */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }} aria-hidden="true">
                <line x1="25%" y1="30%" x2="50%" y2="30%" stroke="rgba(52,211,153,0.12)" strokeWidth="1" strokeDasharray="6 4" style={{ animation: 'dash-flow 1.5s linear infinite' }} />
                <line x1="50%" y1="30%" x2="75%" y2="30%" stroke="rgba(251,191,36,0.12)" strokeWidth="1" strokeDasharray="6 4" style={{ animation: 'dash-flow 1.5s linear infinite' }} />
                <line x1="25%" y1="35%" x2="50%" y2="65%" stroke="rgba(52,211,153,0.06)" strokeWidth="1" strokeDasharray="6 4" style={{ animation: 'dash-flow 1.5s linear infinite' }} />
                <line x1="75%" y1="35%" x2="50%" y2="65%" stroke="rgba(251,191,36,0.06)" strokeWidth="1" strokeDasharray="6 4" style={{ animation: 'dash-flow 1.5s linear infinite' }} />
              </svg>

              {/* Y-offset asymmetry (was: lg:translate-y-4, lg:-translate-y-2,
                  lg:translate-y-6, lg:-translate-y-4 per card) removed per
                  audit §16. The offsets created uneven tap targets on mobile
                  and added visual noise without design payoff. Clean 3-col
                  static grid reads tighter and scans in one viewport. */}
              <div className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-3 stagger-children" style={{ zIndex: 1 }}>
                {AGENTS.map((agent, i) => (
                  <div
                    key={agent.label}
                    className="group relative rounded-2xl p-7 min-h-[210px] flex flex-col transition-all duration-300 cursor-default glass-card card-lift animate-fade-up"
                    style={{
                      background: hoveredAgent === i
                        ? `linear-gradient(135deg, ${agent.color}12, ${agent.color}06)`
                        : 'rgba(255,255,255,0.03)',
                      borderLeft: `3px solid ${agent.color}`,
                      borderColor: hoveredAgent === i ? `${agent.color}55` : 'rgba(255,255,255,0.08)',
                      boxShadow: hoveredAgent === i ? `0 12px 40px ${agent.color}10` : undefined,
                    }}
                    onMouseEnter={() => setHoveredAgent(i)}
                    onMouseLeave={() => setHoveredAgent(null)}
                  >
                    {/* Node indicator */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg text-xs font-bold tracking-wider font-mono" style={{ background: `${agent.color}15`, color: agent.color, border: `1px solid ${agent.color}30` }}>
                        {agent.icon}
                      </div>
                      <h3 className="font-display font-semibold text-white leading-snug">{agent.label}</h3>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-slate-300 leading-relaxed transition-opacity duration-300 font-sans" style={{ opacity: hoveredAgent === i ? 1 : 0.85 }}>
                      {agent.desc}
                    </p>

                    {/* Glow dot */}
                    <div className="absolute top-4 right-4 w-2 h-2 rounded-full" style={{ background: agent.color, boxShadow: `0 0 8px ${agent.color}60` }} aria-hidden="true" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Flow indicator */}
        <div className="flex justify-center py-8" aria-hidden="true">
          <div className="flex items-center gap-2 text-slate-500">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <div className="w-8 h-px bg-gradient-to-r from-emerald-400 to-amber-400" />
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" style={{ animationDelay: '0.5s' }} />
            <div className="w-8 h-px bg-gradient-to-r from-amber-400 to-pink-400" />
            <div className="w-2 h-2 rounded-full bg-pink-400 animate-pulse" style={{ animationDelay: '1s' }} />
            <span className="text-xs text-slate-500 ml-2 font-sans">Agents collaborate via durable workflow coordination</span>
          </div>
        </div>

        {/* ── 4. Workflow Animation ────────────────────────────────────────── */}
        {/* (ExecutionFlow removed from homepage — duplicated OrchestrationEngine's
             architecture diagram. Component retained in `@/components/landing`
             for future use on /docs or marketing sub-pages.) */}
        <section id="workflow" className="relative px-4 py-24 sm:px-6 lg:px-8 diagonal-cut" style={{ background: 'linear-gradient(180deg, rgba(52,211,153,0.02), rgba(251,191,36,0.02), transparent)' }}>
          <div ref={workflowSection.ref} className={`fade-section ${workflowSection.visible ? 'visible' : ''} mx-auto max-w-5xl`}>
            <div className="text-center mb-16">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400 mb-3 font-sans">How It Works</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">From intent to verified result.</h2>
            </div>

            {/* Animated workflow pipeline */}
            <div className="relative max-w-5xl mx-auto">
              {/* Connection line */}
              <div className="absolute top-1/2 left-0 right-0 h-0.5 -translate-y-1/2 hidden lg:block" aria-hidden="true">
                <div className="h-full bg-gradient-to-r from-emerald-500/0 via-amber-400/50 to-pink-400/0" />
                <div className="absolute top-0 h-full w-20 bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
                  style={{ animation: 'flow-travel 3s ease-in-out infinite' }} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 lg:gap-0">
                {WORKFLOW_STEPS.map((step, i) => (
                  <div key={i} className="flex flex-col items-center text-center relative group">

                    {/* Step number badge */}
                    <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-[#09090b] z-10 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: step.color }}>
                      {i + 1}
                    </div>

                    {/* Icon circle */}
                    <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center mb-3 transition-all duration-500"
                      style={{
                        background: `${step.color}15`,
                        border: `1px solid ${step.color}30`,
                        animation: 'flow-pulse 3s ease-in-out infinite',
                        animationDelay: `${i * 0.6}s`,
                      }}
                    >
                      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ color: step.color }} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d={step.icon} />
                      </svg>
                    </div>

                    <span className="text-sm font-display font-semibold text-white mb-0.5">{step.label}</span>
                    <span className="text-xs text-slate-400 max-w-[120px] font-sans">{step.desc}</span>

                    {/* Arrow between steps */}
                    {i < 4 && (
                      <div className="hidden lg:block absolute top-1/2 -right-2 -translate-y-1/2 text-slate-600" aria-hidden="true">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 4a. Verify Before You Act (promoted per audit §10 — was #9) ──── */}
        <section className="px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-400 mb-3 font-sans">Verify Before You Act</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">Risk intelligence, built in.</h2>
              <p className="mt-4 text-slate-300 max-w-2xl mx-auto font-sans">Emails, invoices, documents, and identities pass through four layers of verification before your agents act. Free rules first. AI only when needed. Human review as last resort.</p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[
                { iconName: 'mail' as LandingIconName, title: 'Email Threat Detection', desc: 'Phishing, spoofing, BEC fraud, credential harvesting, social engineering. SPF/DKIM validation, sender reputation, content analysis.', color: '#ef4444' },
                { iconName: 'document' as LandingIconName, title: 'Document Verification', desc: 'Metadata tampering, forgery indicators, font anomalies, author mismatches. Catches fake certificates and altered contracts.', color: '#f59e0b' },
                { iconName: 'card' as LandingIconName, title: 'Transaction Risk Analysis', desc: 'Invoice fraud, duplicate detection, bank detail changes (BEC pattern), suspicious amounts, crypto payment flags.', color: '#8b5cf6' },
                { iconName: 'academic-cap' as LandingIconName, title: 'Identity Verification', desc: 'Resume timeline validation, impossible experience claims, credential anomalies, skill inflation detection.', color: '#06b6d4' },
                { iconName: 'link' as LandingIconName, title: 'Cross-Evidence Correlation', desc: 'Connects findings across emails + documents + transactions + identities to detect coordinated fraud that single-type analysis misses.', color: '#ec4899' },
                { iconName: 'shield' as LandingIconName, title: '4-Layer Escalation', desc: 'Free rules first ($0). Then AI Tier 1 ($0.01). Premium AI only on ambiguity ($0.50). Human review as last resort. 70% of checks stop at Layer 1.', color: '#34d399' },
              ].map((feature) => (
                <div key={feature.title} className="glass-card rounded-2xl p-6 card-lift" style={{ borderLeft: `3px solid ${feature.color}` }}>
                  <div
                    className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ background: `${feature.color}15`, color: feature.color }}
                  >
                    <LandingIcon name={feature.iconName} className="h-6 w-6" />
                  </div>
                  <h3 className="font-display font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-300 leading-relaxed font-sans">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 4aa. What JAK does — three-pillar summary (NEW, per audit §9) ─ */}
        <WhatJakDoes />

        {/* ── 4ab. Audit & Compliance Agent Pack (SOC 2 / HIPAA / ISO 27001) ─
             Surfaces the production audit-engagement product: 167 controls,
             LLM-driven control testing, reviewer-gated workpaper PDFs, and
             HMAC-signed final evidence packs. Sits between the cross-cutting
             "what JAK does" pillars and the Build section so visitors see
             the trust/compliance story before the app-builder content. */}
        <section className="relative px-4 py-24 sm:px-6 lg:px-8" style={{ background: 'linear-gradient(180deg, rgba(251,146,60,0.04), rgba(244,114,182,0.03), transparent)' }}>
          <div className="mx-auto max-w-6xl relative z-10">
            <div className="text-center mb-16 max-w-3xl mx-auto">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-400 mb-3 font-sans">
                Audit &amp; Compliance Agent Pack
              </p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">
                A SOC 2 audit you can actually finish.
              </h2>
              <p className="mt-4 text-slate-300 font-sans">
                Run a real SOC 2, HIPAA, or ISO 27001 engagement end-to-end. JAK plans the controls, auto-maps your evidence, runs LLM-driven control tests, generates per-control workpaper PDFs gated by reviewer approval, and produces a binding HMAC-signed final evidence pack &mdash; verifiable byte-for-byte.
              </p>
            </div>

            {/* Framework cards */}
            <div className="grid gap-4 md:grid-cols-3 mb-12">
              {[
                { code: 'SOC 2 Type 2', issuer: 'AICPA', year: '2017', controls: 48, color: '#fb923c' },
                { code: 'HIPAA Security Rule', issuer: 'HHS', year: '2013', controls: 37, color: '#f472b6' },
                { code: 'ISO/IEC 27001:2022', issuer: 'ISO/IEC', year: '2022', controls: 82, color: '#c084fc' },
              ].map((fw) => (
                <div
                  key={fw.code}
                  className="glass-card rounded-2xl p-6"
                  style={{ borderTop: `2px solid ${fw.color}` }}
                >
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="font-display font-semibold text-white text-base">{fw.code}</h3>
                    <span className="text-2xl font-display font-bold tabular-nums" style={{ color: fw.color }}>
                      {fw.controls}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-sans">{fw.issuer} &middot; {fw.year}</p>
                  <p className="text-[11px] text-slate-500 mt-3 font-sans uppercase tracking-widest">controls seeded</p>
                </div>
              ))}
            </div>

            {/* Engagement flow — 5 steps */}
            <div className="grid gap-6 md:grid-cols-5 mb-12">
              {[
                { step: '01', title: 'Plan', desc: 'Pick framework + period. JAK seeds one ControlTest row per control.', iconName: 'architecture' as LandingIconName, color: '#fb923c' },
                { step: '02', title: 'Auto-map', desc: 'Existing audit logs, approvals, artifacts, and signed bundles map onto controls automatically.', iconName: 'link' as LandingIconName, color: '#f59e0b' },
                { step: '03', title: 'Test', desc: 'LLM-driven test procedure + evidence evaluation. Confidence < 0.7 routes to reviewer override.', iconName: 'shield' as LandingIconName, color: '#f472b6' },
                { step: '04', title: 'Workpaper', desc: 'Per-control PDF persisted as REQUIRES_APPROVAL artifact. Reviewer approves before pack can sign.', iconName: 'document' as LandingIconName, color: '#c084fc' },
                { step: '05', title: 'Sign', desc: 'HMAC-SHA256 signed evidence pack. Verifies byte-for-byte. Refuses if any workpaper unapproved.', iconName: 'shield' as LandingIconName, color: '#a855f7' },
              ].map((s) => (
                <div key={s.step} className="text-center">
                  <div
                    className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                    style={{ background: `${s.color}15`, border: `1px solid ${s.color}30`, color: s.color }}
                  >
                    <LandingIcon name={s.iconName} className="h-6 w-6" />
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mb-1 uppercase tracking-widest">Step {s.step}</div>
                  <h3 className="font-display font-semibold text-white text-sm mb-1">{s.title}</h3>
                  <p className="text-xs text-slate-400 font-sans">{s.desc}</p>
                </div>
              ))}
            </div>

            {/* Honest gates band */}
            <div className="glass-card rounded-2xl p-8 max-w-4xl mx-auto mb-10" style={{ borderLeft: '3px solid #fb923c' }}>
              <h3 className="font-display font-semibold text-white mb-4 text-center">Reviewer gates &mdash; enforced at every layer</h3>
              <div className="grid gap-4 md:grid-cols-2 text-sm font-sans">
                <div className="flex items-start gap-3">
                  <span className="text-orange-400 font-mono text-xs mt-0.5">01</span>
                  <p className="text-slate-300"><strong className="text-white">Test confidence &lt; 0.7</strong> &mdash; status auto-flips to <code className="text-orange-300 font-mono text-xs">reviewer_required</code>. Never silent-passes.</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-orange-400 font-mono text-xs mt-0.5">02</span>
                  <p className="text-slate-300"><strong className="text-white">Every workpaper PDF</strong> persists with <code className="text-orange-300 font-mono text-xs">approvalState=REQUIRES_APPROVAL</code>. Download blocked until approved.</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-orange-400 font-mono text-xs mt-0.5">03</span>
                  <p className="text-slate-300"><strong className="text-white">Final-pack signing</strong> refuses if any workpaper is unapproved. <code className="text-orange-300 font-mono text-xs">FinalPackGateError</code> at the service layer.</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-orange-400 font-mono text-xs mt-0.5">04</span>
                  <p className="text-slate-300"><strong className="text-white">Exception lifecycle</strong> runs through its own state machine. Illegal transitions throw at the service layer, not just the UI.</p>
                </div>
              </div>
            </div>

            {/* External auditor portal — added Sprint 2.6 */}
            <div className="glass-card rounded-2xl p-8 max-w-4xl mx-auto mb-10" style={{ borderLeft: '3px solid #c084fc' }}>
              <h3 className="font-display font-semibold text-white mb-2">External Auditor Portal</h3>
              <p className="text-sm text-slate-300 font-sans mb-4">
                Invite a third-party auditor to review your engagement. They get scoped access to the audit run you assigned them &mdash; nothing else. SHA-256 hashed invite tokens, engagement-level isolation middleware, immutable audit trail of every action they take.
              </p>
              <div className="grid gap-3 md:grid-cols-2 text-xs font-sans">
                <div className="flex items-start gap-3">
                  <span className="text-purple-400 font-mono text-xs mt-0.5">●</span>
                  <p className="text-slate-300"><strong className="text-white">Invite-token-only auth.</strong> Cleartext token returned once on creation; only the SHA-256 hash is persisted. <code className="text-purple-300 font-mono">crypto.timingSafeEqual</code> on verification.</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-purple-400 font-mono text-xs mt-0.5">●</span>
                  <p className="text-slate-300"><strong className="text-white">Engagement isolation.</strong> Per-request middleware verifies role + active engagement for the requested audit run. Cross-tenant access returns 403.</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-purple-400 font-mono text-xs mt-0.5">●</span>
                  <p className="text-slate-300"><strong className="text-white">Audit trail.</strong> Every view, comment, approve/reject/request-changes writes an <code className="text-purple-300 font-mono text-[10px]">ExternalAuditorAction</code> row. Decide endpoint logs intent before mutation.</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-purple-400 font-mono text-xs mt-0.5">●</span>
                  <p className="text-slate-300"><strong className="text-white">Revocation.</strong> Single transaction flips invite to REVOKED + sets <code className="text-purple-300 font-mono text-[10px]">accessRevokedAt</code> on the engagement. Subsequent requests fail isolation check.</p>
                </div>
              </div>
            </div>

            <div className="text-center">
              <Link
                href="/audit/runs"
                className="inline-flex items-center gap-2 rounded-xl px-8 py-4 text-base font-semibold text-[#09090b] transition-transform duration-200 hover:scale-105 focus-visible:ring-2 focus-visible:ring-orange-400"
                style={{ background: 'linear-gradient(135deg, #fb923c, #f472b6)', touchAction: 'manipulation' }}
              >
                Open Audit Runs Workspace
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <p className="text-xs text-slate-500 mt-4 font-sans">
                Engagement workspace at <code className="text-orange-300 font-mono">/audit/runs</code>. Sign-in required (REVIEWER+ for writes). External auditors land at <code className="text-orange-300 font-mono">/auditor/accept/[token]</code>.
              </p>
            </div>
          </div>
        </section>

        {/* ── 4b. Build — consolidated (was two Vibe-Coding sections) ────────
             Audit §19/§20: merge the former 6-card grid + 5-step pipeline
             + cost band into ONE Build section. IDE mockup removed — the
             real builder lives at /builder. Keeps Vibe Coding as a strong
             supporting capability without dominating the homepage. */}
        <section className="relative px-4 py-24 sm:px-6 lg:px-8" style={{ background: 'linear-gradient(180deg, rgba(251,191,36,0.03), rgba(52,211,153,0.02), transparent)' }}>
          <div className="mx-auto max-w-6xl relative z-10">
            <div className="text-center mb-16">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400 mb-3 font-sans">Build With JAK</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">Code that ships &mdash; with snapshots, diffs, and reversible deploys.</h2>
              <p className="mt-4 text-slate-300 max-w-2xl mx-auto font-sans">Describe your app. JAK plans the architecture, generates every file (no stubs), runs a 3-layer build check, debugs, and deploys &mdash; with a snapshot at every stage and one-click revert.</p>
            </div>

            {/* 5-step Build pipeline */}
            <div className="grid gap-6 md:grid-cols-5 mb-12">
              {[
                { step: '01', title: 'Describe', desc: 'Type your app idea in plain English', iconName: 'chat' as LandingIconName, color: '#34d399' },
                { step: '02', title: 'Architect', desc: 'AI designs file tree, data models, API contracts', iconName: 'architecture' as LandingIconName, color: '#fbbf24' },
                { step: '03', title: 'Generate', desc: 'Code generator creates every file — complete, not stubs', iconName: 'bolt' as LandingIconName, color: '#38bdf8' },
                { step: '04', title: 'Debug', desc: 'Auto-debugger fixes build errors (3 retries)', iconName: 'wrench' as LandingIconName, color: '#f472b6' },
                { step: '05', title: 'Preview', desc: 'Live preview. Iterate via chat. Deploy.', iconName: 'rocket' as LandingIconName, color: '#c084fc' },
              ].map((s) => (
                <div key={s.step} className="text-center">
                  <div
                    className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                    style={{ background: `${s.color}15`, border: `1px solid ${s.color}30`, color: s.color }}
                  >
                    <LandingIcon name={s.iconName} className="h-6 w-6" />
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mb-1 uppercase tracking-widest">Step {s.step}</div>
                  <h3 className="font-display font-semibold text-white text-sm mb-1">{s.title}</h3>
                  <p className="text-xs text-slate-400 font-sans">{s.desc}</p>
                </div>
              ))}
            </div>

            {/* Cost band */}
            <div className="glass-card rounded-2xl p-8 max-w-3xl mx-auto mb-12">
              <h3 className="font-display font-semibold text-white text-center mb-6">Cost per generated app</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="landing-gradient-text text-2xl font-display font-bold gradient-text">$0.50</div>
                  <div className="text-xs text-slate-400 mt-1 font-sans">Simple app<br />Tier 1-2 models</div>
                </div>
                <div>
                  <div className="landing-gradient-text text-2xl font-display font-bold gradient-text">$1.50</div>
                  <div className="text-xs text-slate-400 mt-1 font-sans">Medium app<br />With debug loop</div>
                </div>
                <div>
                  <div className="landing-gradient-text text-2xl font-display font-bold gradient-text">$0.10</div>
                  <div className="text-xs text-slate-400 mt-1 font-sans">Per iteration<br />Only changed files</div>
                </div>
              </div>
              <p className="text-center text-[10px] text-slate-500 mt-4 font-sans">3-tier LLM routing: Tier 3 for architecture, Tier 2 for code gen, Tier 1 for debug.</p>
            </div>

            <div className="text-center">
              <Link href="/builder" className="inline-flex items-center gap-2 rounded-xl px-8 py-4 text-base font-semibold text-[#09090b] transition-transform duration-200 hover:scale-105 focus-visible:ring-2 focus-visible:ring-emerald-400" style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24)', touchAction: 'manipulation' }}>
                Try the Builder
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── 5. Tools & Capabilities ──────────────────────────────────────── */}
        <section className="px-4 py-24 sm:px-6 lg:px-8">
          <div ref={integrationSection.ref} className={`fade-section ${integrationSection.visible ? 'visible' : ''} mx-auto max-w-6xl`}>
            <div className="text-center mb-16">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pink-400 mb-3 font-sans">Integrations</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">Tools that do the job &mdash; and say when they don&apos;t.</h2>
              <p className="mt-4 text-slate-300 max-w-2xl mx-auto font-sans">122 classified tools and 22 integrations, each labeled by a CI-enforced maturity tier (real, heuristic, LLM passthrough, config-dependent, experimental). Gmail, Calendar, browser automation, sandboxed code, MCP, and direct APIs &mdash; so operators know exactly what they&apos;re getting.</p>
            </div>

            {/* Tool Categories Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-12">
              {[
                { iconName: 'mail' as LandingIconName, category: 'Email', count: 10, tools: 'Read, draft, send, search, labels, filters', color: '#EA4335' },
                { iconName: 'calendar' as LandingIconName, category: 'Calendar', count: 3, tools: 'List events, create events, find availability', color: '#4285F4' },
                { iconName: 'globe' as LandingIconName, category: 'Browser', count: 30, tools: 'Navigate, click, fill forms, screenshot, PDF, cookies, social posting', color: '#34d399' },
                { iconName: 'document' as LandingIconName, category: 'Document', count: 16, tools: 'Read, write, summarize, extract data, PDF analysis, image gen', color: '#8B5CF6' },
                { iconName: 'chart' as LandingIconName, category: 'Spreadsheet', count: 4, tools: 'Parse CSV, compute stats, generate reports, export', color: '#10B981' },
                { iconName: 'user' as LandingIconName, category: 'CRM', count: 14, tools: 'Contacts, deals, enrichment, lead scoring, dedup, signals', color: '#F59E0B' },
                { iconName: 'search' as LandingIconName, category: 'Research', count: 31, tools: 'Web search, fetch, SEO audit, keywords, SERP, platform discovery', color: '#06B6D4' },
                { iconName: 'brain' as LandingIconName, category: 'Knowledge', count: 9, tools: 'Memory store, retrieve, search, classify, Q&A', color: '#c084fc' },
                { iconName: 'bell' as LandingIconName, category: 'Webhooks', count: 2, tools: 'External webhook delivery, Vercel deploy', color: '#fb923c' },
              ].map((cat) => (
                <div key={cat.category} className="glass-card rounded-xl p-4 card-lift">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center" style={{ color: cat.color }}>
                      <LandingIcon name={cat.iconName} className="h-5 w-5" />
                    </span>
                    <h3 className="font-display font-semibold text-sm text-white">{cat.category}</h3>
                    <span className="ml-auto text-xs font-mono px-2 py-0.5 rounded-full bg-white/5 text-slate-400">{cat.count === 0 ? '∞' : cat.count}</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed font-sans">{cat.tools}</p>
                </div>
              ))}
            </div>

            {/* Connected Services */}
            <div className="text-center">
              <p className="text-xs text-slate-500 mb-4 font-sans uppercase tracking-widest">Verified Integrations (MCP)</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {INTEGRATIONS_CORE.map((int) => (
                  <div
                    key={int.name}
                    className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white border transition-all duration-200 hover:scale-105 font-sans"
                    style={{ backgroundColor: int.bg, borderColor: int.color + '40' }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: int.color, boxShadow: `0 0 6px ${int.color}40` }} aria-hidden="true" />
                    {int.name}
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-6 mb-4 font-sans uppercase tracking-widest">Infrastructure + Utilities</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {INTEGRATIONS_INFRA.map((svc) => (
                  <div key={svc.name} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white border transition-all duration-200 hover:scale-105 font-sans" style={{ backgroundColor: svc.bg, borderColor: svc.color + '40' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: svc.color, boxShadow: `0 0 6px ${svc.color}40` }} aria-hidden="true" />
                    {svc.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 5a. Capability Architecture Map ──────────────────────────────── */}
        <CapabilityMap />

        {/* (Former 5b "Vibe Coding Deep Dive" removed — pipeline + cost band
             merged into section 4b above. IDE mockup dropped; the real
             Builder lives at /builder.) */}

        {/* (Verification moved up to position #4 — right after How It Works —
             per audit §10. SupervisorSection moved to #2. This section used
             to sit at #9.) */}

        {/* ── 5e. Operate At Scale (was Enterprise Intelligence) ───────────── */}
        <section className="px-4 py-24 sm:px-6 lg:px-8" style={{ background: 'linear-gradient(180deg, rgba(52,211,153,0.02), rgba(56,189,248,0.02), transparent)' }}>
          <div className="mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400 mb-3 font-sans">Operate At Scale</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight leading-[1.25] pb-2 text-balance">Memory, recovery, and observability &mdash; without the glue code.</h2>
              <p className="mt-5 text-slate-300 max-w-2xl mx-auto font-sans text-base sm:text-lg leading-relaxed">Persistent memory across runs. Self-healing retries with loop detection. Slack and voice bridges. A typed SDK. <span className="text-slate-400">Production depth &mdash; not demo magic.</span></p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[
                { iconName: 'brain' as LandingIconName, title: 'Memory System', desc: 'LLM-powered fact extraction from completed workflows. Token-budgeted retrieval injected into agent prompts via <memory> tags. Every execution makes agents smarter.', color: '#8b5cf6' },
                { iconName: 'target' as LandingIconName, title: 'Context Engineering', desc: 'Automatic context summarization prevents token overflow on long DAGs. Protects current task + dependencies, compresses older results. Never lose context.', color: '#06b6d4' },
                { iconName: 'chat' as LandingIconName, title: 'Slack Channel Bridge', desc: 'Slack messages trigger authenticated workflows with thread-reply results. HMAC-SHA256 signature verification, idempotent event handling, team-scoped tenancy.', color: '#4A154B' },
                { iconName: 'microphone' as LandingIconName, title: 'Voice → Workflow', desc: 'Convert voice session transcripts into full workflow executions. Speak your intent, agents execute. 4 voice providers supported.', color: '#f472b6' },
                { iconName: 'package' as LandingIconName, title: '@jak-swarm/client SDK', desc: 'Typed TypeScript API client with SSE streaming, workflow management, memory CRUD, and health checks. npm install @jak-swarm/client.', color: '#34d399' },
                { iconName: 'refresh' as LandingIconName, title: 'Error Recovery & Loop Detection', desc: 'Tool crashes produce recoverable error messages. Fingerprint-based loop detection (3x threshold) prevents infinite retries. Workflows self-heal.', color: '#fbbf24' },
              ].map((feature) => (
                <div key={feature.title} className="glass-card rounded-2xl p-6 card-lift" style={{ borderLeft: `3px solid ${feature.color}` }}>
                  <div
                    className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ background: `${feature.color}15`, color: feature.color }}
                  >
                    <LandingIcon name={feature.iconName} className="h-6 w-6" />
                  </div>
                  <h3 className="font-display font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-300 leading-relaxed font-sans">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 5f. Live Execution Demo ─────────────────────────────────────── */}
        <LiveDemo />

        {/* ── 5g. Evidence band — stats as proof, not hero hook ──────────────
             Audit §7: counts (38 / 122 / 22) are proof, not the emotional
             opener. Moved from the prior #2 position (right below hero) to
             live here, alongside LiveDemo, where they're EARNED. */}
        <section className="relative border-t border-white/5 px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl grid grid-cols-2 md:grid-cols-4 gap-10">
            {STATS.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>
        </section>

        {/* ── 6. Pricing ───────────────────────────────────────────────────── */}
        <section id="pricing" className="relative px-4 py-24 sm:px-6 lg:px-8" style={{ background: 'linear-gradient(180deg, transparent, rgba(52,211,153,0.02), transparent)' }}>
          <div className="mx-auto max-w-6xl relative z-10">
            <div className="text-center mb-16">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400 mb-3 font-sans">Pricing</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">Transparent pricing. Open-source core.</h2>
              <p className="mt-4 text-slate-300 max-w-xl mx-auto font-sans">Run JAK free on your own infrastructure, forever. Upgrade when you want hosted ops, higher limits, and SLA.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto items-start">
              {PRICING.map((tier) => (
                <div
                  key={tier.name}
                  className={`relative rounded-2xl p-8 transition-all duration-300 hover:-translate-y-1 ${
                    tier.highlighted ? 'lg:scale-105' : ''
                  }`}
                  style={{
                    background: tier.highlighted
                      ? 'linear-gradient(135deg, rgba(52,211,153,0.12), rgba(251,191,36,0.06))'
                      : tier.accent === 'amber'
                      ? 'linear-gradient(135deg, rgba(251,191,36,0.06), rgba(251,191,36,0.02))'
                      : 'rgba(255,255,255,0.03)',
                    border: tier.highlighted
                      ? '1px solid rgba(52,211,153,0.4)'
                      : tier.accent === 'amber'
                      ? '1px solid rgba(251,191,36,0.2)'
                      : '1px solid rgba(255,255,255,0.08)',
                    boxShadow: tier.highlighted
                      ? '0 0 40px rgba(52,211,153,0.1), 0 20px 60px rgba(52,211,153,0.05)'
                      : 'none',
                  }}
                >
                  {tier.highlighted && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <span className="rounded-full px-4 py-1 text-xs font-bold uppercase tracking-wider text-[#09090b]" style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24)' }}>
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div className="mb-6">
                    <h3 className="text-lg font-display font-semibold mb-2 text-white">{tier.name}</h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-display font-bold text-white tabular-nums">{tier.price}</span>
                      {tier.period && <span className="text-slate-500 font-sans">{tier.period}</span>}
                    </div>
                    <p className="mt-2 text-sm text-slate-300 font-sans">{tier.description}</p>
                  </div>

                  <ul className="mb-8 space-y-3">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 text-sm font-sans">
                        <CheckIcon className="h-5 w-5 shrink-0 text-emerald-400" />
                        <span className="text-slate-300">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {tier.href.startsWith('mailto:') ? (
                    <a
                      href={tier.href}
                      className="block w-full rounded-xl py-3 text-center text-sm font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-amber-400"
                      style={{
                        background: 'rgba(251,191,36,0.1)',
                        border: '1px solid rgba(251,191,36,0.2)',
                        color: '#fbbf24',
                        touchAction: 'manipulation',
                      }}
                    >
                      {tier.cta}
                    </a>
                  ) : (
                    <Link
                      href={tier.href}
                      className="block w-full rounded-xl py-3 text-center text-sm font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-emerald-400"
                      style={{
                        background: tier.highlighted ? 'linear-gradient(135deg, #34d399, #fbbf24)' : 'rgba(255,255,255,0.05)',
                        border: tier.highlighted ? 'none' : '1px solid rgba(255,255,255,0.08)',
                        color: tier.highlighted ? '#09090b' : '#fff',
                        touchAction: 'manipulation',
                      }}
                    >
                      {tier.cta}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 7. Open Source — compressed per audit §19 from a standalone
             H2 section to a single trust band. The content (MIT license,
             GitHub link, tech stack) is retained; only the visual weight
             drops so it reads as a trust signal, not a headline section. */}
        <section className="px-4 py-10 sm:px-6 lg:px-8 border-t border-white/5">
          <div ref={testimonialSection.ref} className={`fade-section ${testimonialSection.visible ? 'visible' : ''} mx-auto max-w-5xl text-center`}>
            <p className="text-slate-400 text-sm font-sans mb-5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400">Open Source</span>
              <span className="mx-3 text-slate-600">&middot;</span>
              JAK Swarm is fully open-source under the MIT license. Audit every line, deploy on infrastructure you control.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
              <a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-white/10 hover:border-white/20 focus-visible:ring-2 focus-visible:ring-white/50" aria-label="Star JAK Swarm on GitHub">
                <GitHubIcon className="h-4 w-4" />
                Star on GitHub
              </a>
              <a href="https://github.com/inbharatai/jak-swarm/issues" target="_blank" rel="noopener noreferrer" className="text-sm text-slate-400 hover:text-white transition-colors font-sans">
                Report an issue &rarr;
              </a>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {['TypeScript', 'Next.js 15', 'Fastify', 'Prisma', 'PostgreSQL', 'Redis', 'Playwright', 'Realtime Voice', 'SSE Streaming'].map(tech => (
                <span key={tech} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-500 font-sans">{tech}</span>
              ))}
            </div>
          </div>
        </section>

        {/* ── 8. Premium CTA ─────────────────────────────────────────────── */}
        <PremiumCTA />

        {/* ── 9. Footer ────────────────────────────────────────────────────── */}
        <div className="h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" aria-hidden="true" />
        <footer className="border-t border-white/5 px-4 py-16 sm:px-6 lg:px-8" role="contentinfo">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-12 md:grid-cols-4">
              {/* Logo column */}
              <div className="md:col-span-1">
                <div className="flex items-center gap-2 mb-4">
                  <JakLogo size={28} />
                  <span className="text-base font-display font-bold tracking-tight">JAK Swarm</span>
                </div>
                <p className="text-sm text-slate-500 leading-relaxed font-sans">
                  The trusted control plane for autonomous work. One platform that plans, executes, verifies, and recovers &mdash; with human approvals on every high-risk action. Open-source core, self-hostable, MIT licensed.
                </p>
              </div>

              {/* Product */}
              <div>
                <h4 className="text-sm font-display font-semibold text-white mb-4">Product</h4>
                <ul className="space-y-2.5 text-sm text-slate-500 font-sans">
                  <li><a href="#agents" className="hover:text-white focus-visible:text-white transition-colors">Features</a></li>
                  <li><a href="#pricing" className="hover:text-white focus-visible:text-white transition-colors">Pricing</a></li>
                  <li><a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="hover:text-white focus-visible:text-white transition-colors">Documentation</a></li>
                  <li><a href="#workflow" className="hover:text-white focus-visible:text-white transition-colors">How It Works</a></li>
                </ul>
              </div>

              {/* Company */}
              <div>
                <h4 className="text-sm font-display font-semibold text-white mb-4">Company</h4>
                <ul className="space-y-2.5 text-sm text-slate-500 font-sans">
                  <li><a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="hover:text-white focus-visible:text-white transition-colors">About</a></li>
                  <li><a href="https://github.com/inbharatai/jak-swarm/blob/main/ARCHITECTURE.md" target="_blank" rel="noopener noreferrer" className="hover:text-white focus-visible:text-white transition-colors">Architecture</a></li>
                  <li><a href="https://github.com/inbharatai/jak-swarm/blob/main/AGENTS.md" target="_blank" rel="noopener noreferrer" className="hover:text-white focus-visible:text-white transition-colors">Agent Docs</a></li>
                  <li><a href="mailto:contact@inbharat.ai" className="hover:text-white focus-visible:text-white transition-colors">Contact</a></li>
                </ul>
              </div>

              {/* Social */}
              <div>
                <h4 className="text-sm font-display font-semibold text-white mb-4">Connect</h4>
                <ul className="space-y-2.5 text-sm text-slate-500 font-sans">
                  <li>
                    <a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="hover:text-white focus-visible:text-white transition-colors inline-flex items-center gap-2" aria-label="JAK Swarm on GitHub">
                      <GitHubIcon className="h-4 w-4" />
                      GitHub
                    </a>
                  </li>
                  <li>
                    <a href="https://twitter.com/inbharatai" target="_blank" rel="noopener noreferrer" className="hover:text-white focus-visible:text-white transition-colors inline-flex items-center gap-2" aria-label="JAK Swarm on X / Twitter">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                      X / Twitter
                    </a>
                  </li>
                  <li>
                    <a href="https://linkedin.com/company/inbharatai" target="_blank" rel="noopener noreferrer" className="hover:text-white focus-visible:text-white transition-colors inline-flex items-center gap-2" aria-label="JAK Swarm on LinkedIn">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                      LinkedIn
                    </a>
                  </li>
                </ul>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="mt-12 pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <span className="text-sm text-slate-600 font-sans">&copy; {new Date().getFullYear()} InBharat AI. All rights reserved.</span>
              <div className="flex items-center gap-4 text-sm text-slate-600 font-sans">
                <a href="/terms" className="hover:text-white transition-colors">Terms</a>
                <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
                <span>Built with purpose.</span>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
