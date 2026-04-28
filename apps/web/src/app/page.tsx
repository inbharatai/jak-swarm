'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LiveDemo, PremiumCTA, ShowTheWork, WhatJakDoes, LandingIcon, type LandingIconName } from '@/components/landing';

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

const WORKFLOW_STEPS = [
  { label: 'Command', desc: 'Natural language input', icon: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18', color: '#34d399' },
  { label: 'Commander', desc: 'Task decomposition', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75', color: '#fbbf24' },
  { label: 'Planner', desc: 'DAG assembly', icon: 'M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z', color: '#38bdf8' },
  { label: 'Workers', desc: 'Parallel execution', icon: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z', color: '#f472b6' },
  { label: 'Result', desc: 'Compiled output', icon: 'M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z', color: '#c084fc' },
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

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function HomePage() {
  const router = useRouter();
  const [heroVisible, setHeroVisible] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const workflowSection = useFadeIn();

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
          /* Descender protection for gradient-clipped text (g, j, p, q, y).
             0.22em > 0.12em because the hero H1 + final CTA hit text-6xl/7xl
             where 0.12em was insufficient — "operating" + "control plane for"
             both showed visible shear at the baseline. */
          display: inline-block;
          padding-bottom: 0.22em;
          line-height: 1.2;
          overflow: visible;
        }
        /* Display-font safety net: every H1/H2/H3 that uses Syne (font-display)
           gets a bottom pad and a 1.18 minimum line-height so descenders
           (g, j, p, q, y) never shear on the tightly-set landing headlines.
           Tailwind's default text-3xl/text-5xl line-height is ~1.0-1.1, which
           historically clipped letters like "g" in "operating" and "p" in
           "snapshots". Override only inside .landing-root so app-shell
           headings are not affected. */
        .landing-root h1.font-display,
        .landing-root h2.font-display,
        .landing-root h3.font-display {
          line-height: 1.18;
          padding-bottom: 0.08em;
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
              <a href="#outcomes" className="hover:text-white focus-visible:text-white transition-colors duration-200">Outcomes</a>
              <a href="#workflow" className="hover:text-white focus-visible:text-white transition-colors duration-200">How It Works</a>
              <a href="#audit" className="hover:text-white focus-visible:text-white transition-colors duration-200">Audit</a>
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
              <a href="#outcomes" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Outcomes</a>
              <a href="#workflow" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">How It Works</a>
              <a href="#audit" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Audit</a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Pricing</a>
              <Link href="/builder" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-emerald-400 hover:text-emerald-300 transition-colors">Builder</Link>
              {/* Sign In moved here from the top bar so the brand + Get Started
                  have room to breathe without wrapping on 375px viewports. */}
              <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-300 hover:text-white transition-colors pt-2 border-t border-white/5">Sign In</Link>
            </div>
          )}
        </nav>

        {/* ── 1. Hero ─────────────────────────────────────────────────────────
             Simplified per the pokee.ai-comparison pass: dropped the floating
             particles, the orbiting agent constellation, and the four-icon
             trust strip. Two ambient mesh blobs remain for depth. Headline
             leads with what JAK *does* (verb-first), not the category. */}
        <section className="relative min-h-[88vh] flex items-center gradient-bg px-4 pt-24 pb-20 sm:px-6 lg:px-8 grain-overlay">
          <div className="hero-mesh-blob" style={{ width: 600, height: 600, top: '10%', left: '-10%', background: 'radial-gradient(circle, rgba(52,211,153,0.13) 0%, transparent 70%)' }} />
          <div className="hero-mesh-blob" style={{ width: 480, height: 480, top: '35%', right: '-5%', background: 'radial-gradient(circle, rgba(251,191,36,0.10) 0%, transparent 70%)', animationDelay: '-7s' }} />

          <div
            className="relative mx-auto max-w-4xl w-full z-10 text-center"
            style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0)' : 'translateY(40px)',
              transition: 'all 1s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div className="inline-flex items-center gap-2 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[11px] font-semibold text-emerald-300/90 tracking-[0.18em] uppercase font-sans">
                Operator-Grade &middot; Open-Source Core
              </span>
            </div>

            <h1 className="mb-6 pb-3 mx-auto text-4xl font-display font-bold tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl leading-[1.15]">
              <span className="block text-white">AI agents that plan, execute,</span>
              <span className="block mt-2 gradient-text landing-gradient-text">verify &mdash; and ship.</span>
            </h1>

            <p className="mb-10 max-w-2xl mx-auto text-base text-slate-300 sm:text-lg leading-relaxed font-sans">
              JAK Swarm runs your work end-to-end &mdash; with native LangGraph orchestration, Postgres-backed checkpoints, source-grounded verification, and human approvals on every high-risk action. Open-source core, self-hostable, MIT licensed.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/register"
                className="group relative inline-flex items-center gap-2 rounded-xl px-8 py-4 text-base font-semibold text-[#09090b] transition-transform duration-200 hover:-translate-y-0.5 hover:scale-105 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
                style={{
                  background: 'linear-gradient(135deg, #34d399, #fbbf24)',
                  boxShadow: '0 0 30px rgba(52,211,153,0.3), 0 10px 40px rgba(52,211,153,0.15)',
                  touchAction: 'manipulation',
                }}
              >
                Start Free
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href="https://github.com/inbharatai/jak-swarm"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-8 py-4 text-base font-semibold text-white transition-all duration-200 hover:bg-white/10 hover:border-white/20 focus-visible:ring-2 focus-visible:ring-white/50"
                aria-label="View JAK Swarm on GitHub"
              >
                <GitHubIcon className="h-5 w-5" />
                View on GitHub
              </a>
            </div>
          </div>
        </section>

        {/* ── 2. What JAK does (Build / Operate / Verify pillars) ──────────── */}
        <WhatJakDoes />

        {/* ── 3. Show the work (outcome cards) ─────────────────────────────── */}
        <ShowTheWork />

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

        {/* ── 5. Audit & Compliance Agent Pack — compressed to a single tile.
             Full engagement workspace lives at /audit/runs. Three framework
             counts + the gate-list + auditor-portal bullet are all that
             belong on the homepage; the rest belongs on a dedicated page. */}
        <section
          id="audit"
          className="relative px-4 py-24 sm:px-6 lg:px-8"
          style={{ background: 'linear-gradient(180deg, rgba(251,146,60,0.04), rgba(244,114,182,0.03), transparent)' }}
        >
          <div className="mx-auto max-w-5xl relative z-10">
            <div
              className="rounded-3xl p-8 sm:p-12 glass-card"
              style={{ borderTop: '3px solid #fb923c' }}
            >
              <div className="grid gap-8 md:grid-cols-2 md:items-center">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-400 mb-3 font-sans">
                    Audit &amp; Compliance Pack
                  </p>
                  <h2 className="text-3xl font-display font-bold sm:text-4xl tracking-tight mb-4">
                    A SOC 2 audit you can actually finish.
                  </h2>
                  <p className="text-slate-300 font-sans mb-6">
                    167 controls seeded across SOC 2, HIPAA, and ISO 27001. LLM-driven control testing, reviewer-gated workpaper PDFs, HMAC-signed final evidence packs that verify byte-for-byte. Invite an external auditor through a SHA-256-hashed token portal.
                  </p>

                  <div className="flex flex-wrap gap-2 mb-8">
                    {[
                      { label: 'SOC 2 Type 2', count: 48, color: '#fb923c' },
                      { label: 'HIPAA Security Rule', count: 37, color: '#f472b6' },
                      { label: 'ISO/IEC 27001:2022', count: 82, color: '#c084fc' },
                    ].map((fw) => (
                      <span
                        key={fw.label}
                        className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium font-sans"
                        style={{
                          background: `${fw.color}12`,
                          border: `1px solid ${fw.color}30`,
                          color: '#fafafa',
                        }}
                      >
                        <span className="font-mono tabular-nums" style={{ color: fw.color }}>
                          {fw.count}
                        </span>
                        <span>{fw.label}</span>
                      </span>
                    ))}
                  </div>

                  <Link
                    href="/audit/runs"
                    className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-[#09090b] transition-transform duration-200 hover:scale-105 focus-visible:ring-2 focus-visible:ring-orange-400"
                    style={{
                      background: 'linear-gradient(135deg, #fb923c, #f472b6)',
                      touchAction: 'manipulation',
                    }}
                  >
                    Open Audit Workspace
                    <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                </div>

                <ul className="space-y-3 text-sm font-sans">
                  {[
                    'Reviewer-gated workpaper PDFs — download blocked until approved',
                    'Final-pack signing refuses if any workpaper is unapproved (FinalPackGateError)',
                    'External Auditor Portal — invite-token-only, engagement-scoped, fully audited',
                    'HMAC-SHA256 evidence bundles verify byte-for-byte',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-slate-300">
                      <CheckIcon className="h-5 w-5 shrink-0 text-orange-400 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── 6. Live Execution Demo ─────────────────────────────────────── */}
        <LiveDemo />

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
                  <li><a href="#outcomes" className="hover:text-white focus-visible:text-white transition-colors">Outcomes</a></li>
                  <li><a href="#workflow" className="hover:text-white focus-visible:text-white transition-colors">How It Works</a></li>
                  <li><a href="#audit" className="hover:text-white focus-visible:text-white transition-colors">Audit &amp; Compliance</a></li>
                  <li><a href="#pricing" className="hover:text-white focus-visible:text-white transition-colors">Pricing</a></li>
                  <li><a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="hover:text-white focus-visible:text-white transition-colors">Documentation</a></li>
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
