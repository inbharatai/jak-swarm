'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
  { value: 38, label: 'Agents', suffix: '' },
  { value: 112, label: 'Tools', suffix: '' },
  { value: 6, label: 'LLM Providers', suffix: '' },
  { value: 22, label: 'Browser Tools', suffix: '' },
];

const WORKFLOW_STEPS = [
  { label: 'Command', desc: 'Natural language input', icon: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18', color: '#34d399' },
  { label: 'Commander', desc: 'Task decomposition', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75', color: '#fbbf24' },
  { label: 'Planner', desc: 'DAG assembly', icon: 'M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z', color: '#38bdf8' },
  { label: 'Workers', desc: 'Parallel execution', icon: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z', color: '#f472b6' },
  { label: 'Result', desc: 'Compiled output', icon: 'M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z', color: '#c084fc' },
];

const INTEGRATIONS = [
  { name: 'Gmail', color: '#EA4335', bg: 'rgba(234,67,53,0.1)' },
  { name: 'Slack', color: '#4A154B', bg: 'rgba(74,21,75,0.1)' },
  { name: 'GitHub', color: '#FFFFFF', bg: 'rgba(255,255,255,0.08)' },
  { name: 'Notion', color: '#FFFFFF', bg: 'rgba(255,255,255,0.08)' },
  { name: 'Google Calendar', color: '#4285F4', bg: 'rgba(66,133,244,0.1)' },
  { name: 'Jira', color: '#0052CC', bg: 'rgba(0,82,204,0.1)' },
];

const PRICING = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For individuals exploring AI automation.',
    features: ['5 workflows / day', '1 user', 'Basic agents', 'Community support', 'Public templates'],
    cta: 'Start Free',
    href: '/register',
    highlighted: false,
    accent: '',
  },
  {
    name: 'Pro',
    price: '$49',
    period: '/mo',
    description: 'For teams shipping with AI at scale.',
    features: ['Unlimited workflows', '5 team members', 'All 38 agents', 'All integrations', 'Priority support', 'Custom templates', 'API access'],
    cta: 'Start Pro',
    href: '/register',
    highlighted: true,
    accent: 'emerald',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For organizations with advanced needs.',
    features: ['Everything in Pro', 'Unlimited team', 'SSO / SAML', 'Dedicated support', 'SLA guarantee', 'On-prem deployment', 'Custom agent training'],
    cta: 'Contact Us',
    href: 'mailto:contact@inbharat.ai',
    highlighted: false,
    accent: 'amber',
  },
];

/* ─── Stat Card Component ────────────────────────────────────────────────── */

function StatCard({ value, label }: { value: number; label: string; suffix: string }) {
  const { count, ref } = useCountUp(value, 1800);
  return (
    <div ref={ref} className="glass-card rounded-xl p-6 text-center">
      <div className="text-5xl sm:text-6xl font-display font-bold tracking-tight tabular-nums" style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        {count}
      </div>
      <div className="mt-2 text-sm font-medium text-slate-400 uppercase tracking-widest font-sans">{label}</div>
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

  // Check auth on client side
  useEffect(() => {
    const token = document.cookie.split(';').find(c => c.trim().startsWith('jak_token='));
    if (token) router.replace('/home');
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

      <main id="main-content" className="min-h-screen bg-[#09090b] text-white overflow-x-hidden font-sans">
        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 backdrop-blur-xl" style={{ background: 'rgba(9,9,11,0.6)' }} role="navigation" aria-label="Main navigation">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <JakLogo size={32} />
              <span className="text-lg font-display font-bold tracking-tight">JAK Swarm</span>
            </div>
            <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
              <a href="#agents" className="hover:text-white focus-visible:text-white transition-colors duration-200">Agents</a>
              <a href="#workflow" className="hover:text-white focus-visible:text-white transition-colors duration-200">How It Works</a>
              <a href="#pricing" className="hover:text-white focus-visible:text-white transition-colors duration-200">Pricing</a>
            </div>
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <button
                className="md:hidden p-2 text-slate-400 hover:text-white transition-colors"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle menu"
                aria-expanded={mobileMenuOpen}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  {mobileMenuOpen
                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  }
                </svg>
              </button>
              <Link href="/login" className="text-sm font-medium text-slate-400 hover:text-white focus-visible:text-white transition-colors">
                Sign In
              </Link>
              <Link href="/register" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#09090b] transition-all duration-200 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-emerald-400" style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24)', touchAction: 'manipulation' }}>
                Get Started
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Mobile menu dropdown */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-white/5 px-4 py-4 space-y-3" style={{ background: 'rgba(9,9,11,0.95)' }}>
              <a href="#agents" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Agents</a>
              <a href="#workflow" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">How It Works</a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Pricing</a>
              <Link href="/builder" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-emerald-400 hover:text-emerald-300 transition-colors">Builder</Link>
            </div>
          )}
        </nav>

        {/* ── 1. Hero ──────────────────────────────────────────────────────── */}
        <section className="relative min-h-screen flex items-center gradient-bg px-4 pt-20 pb-16 sm:px-6 lg:px-8 grain-overlay">
          {/* Mesh gradient blobs - the hero moment */}
          <div className="hero-mesh-blob" style={{ width: 600, height: 600, top: '10%', left: '-10%', background: 'radial-gradient(circle, rgba(52,211,153,0.15) 0%, transparent 70%)' }} />
          <div className="hero-mesh-blob" style={{ width: 500, height: 500, top: '30%', right: '-5%', background: 'radial-gradient(circle, rgba(251,191,36,0.12) 0%, transparent 70%)', animationDelay: '-7s' }} />
          <div className="hero-mesh-blob" style={{ width: 400, height: 400, bottom: '5%', left: '30%', background: 'radial-gradient(circle, rgba(244,114,182,0.1) 0%, transparent 70%)', animationDelay: '-14s' }} />

          {/* Floating particles */}
          {[
            { w: 4, h: 4, top: '15%', left: '10%', bg: '#34d399', opacity: 0.3, dur: '8s' },
            { w: 3, h: 3, top: '25%', left: '85%', bg: '#fbbf24', opacity: 0.25, dur: '10s' },
            { w: 5, h: 5, top: '70%', left: '15%', bg: '#f472b6', opacity: 0.2, dur: '12s' },
            { w: 3, h: 3, top: '80%', left: '75%', bg: '#34d399', opacity: 0.3, dur: '9s' },
            { w: 6, h: 6, top: '40%', left: '90%', bg: '#fbbf24', opacity: 0.15, dur: '11s' },
            { w: 4, h: 4, top: '55%', left: '5%', bg: '#34d399', opacity: 0.2, dur: '7s' },
            { w: 2, h: 2, top: '10%', left: '50%', bg: '#f472b6', opacity: 0.3, dur: '13s' },
            { w: 3, h: 3, top: '90%', left: '40%', bg: '#fbbf24', opacity: 0.2, dur: '10s' },
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

          {/* Grid overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(52,211,153,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(52,211,153,0.02) 1px, transparent 1px)', backgroundSize: '80px 80px' }} />

          {/* Asymmetric hero layout */}
          <div className="relative mx-auto max-w-7xl w-full z-10 grid lg:grid-cols-12 gap-8 items-center" style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? 'translateY(0)' : 'translateY(40px)', transition: 'all 1s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            {/* Left: Text - offset to create asymmetry */}
            <div className="lg:col-span-7 lg:pr-8">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 mb-8">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-medium text-emerald-300 tracking-wide uppercase">38 Agents + Vibe Coding</span>
              </div>

              <h1 className="mb-6 text-4xl font-display font-bold tracking-tight sm:text-6xl lg:text-7xl leading-[0.95]">
                <span className="block text-white/90">Your Entire Company,</span>
                <span className="block mt-2 gradient-text">Automated.</span>
              </h1>

              <p className="mb-10 max-w-xl text-base text-slate-400 sm:text-lg leading-relaxed font-sans">
                CEO, CTO, CMO, Engineer, Legal, Finance, HR&nbsp;&mdash; all autonomous. All working together. Deploy intelligent agent swarms that plan, execute, and deliver.
              </p>

              <div className="flex flex-col sm:flex-row items-start gap-4">
                <Link href="/register" className="group relative inline-flex items-center gap-2 rounded-xl px-8 py-4 text-base font-semibold text-[#09090b] transition-transform duration-200 hover:-translate-y-0.5 hover:scale-105 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]" style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24)', boxShadow: '0 0 30px rgba(52,211,153,0.3), 0 10px 40px rgba(52,211,153,0.15)', touchAction: 'manipulation' }}>
                  Start Free
                  <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-8 py-4 text-base font-semibold text-white transition-all duration-200 hover:bg-white/10 hover:border-white/20 focus-visible:ring-2 focus-visible:ring-white/50" aria-label="View JAK Swarm on GitHub">
                  <GitHubIcon className="h-5 w-5" />
                  View on GitHub
                </a>
              </div>
            </div>

            {/* Right: Visual - floating agent constellation */}
            <div className="lg:col-span-5 relative hidden lg:flex items-center justify-center min-h-[400px]">
              {/* Central node */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center z-10" style={{ animation: 'pulse-glow 3s ease-in-out infinite' }}>
                <JakLogo size={40} />
              </div>

              {/* Orbiting agent nodes */}
              {AGENTS.map((agent, i) => {
                const angle = (i * 60 - 30) * (Math.PI / 180);
                const radius = 140;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return (
                  <div
                    key={agent.label}
                    className="absolute w-12 h-12 rounded-xl flex items-center justify-center text-xs font-bold tracking-wider transition-transform duration-500 hover:scale-110"
                    style={{
                      top: `calc(50% + ${y}px - 24px)`,
                      left: `calc(50% + ${x}px - 24px)`,
                      background: `${agent.color}15`,
                      border: `1px solid ${agent.color}40`,
                      color: agent.color,
                      animation: `pulse-glow 3s ease-in-out infinite`,
                      animationDelay: `${i * 0.5}s`,
                    }}
                  >
                    {agent.icon}
                  </div>
                );
              })}

              {/* Connection lines SVG */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                {AGENTS.map((agent, i) => {
                  const angle = (i * 60 - 30) * (Math.PI / 180);
                  const radius = 140;
                  const x = 50 + (Math.cos(angle) * radius / 4);
                  const y = 50 + (Math.sin(angle) * radius / 4);
                  return (
                    <line
                      key={i}
                      x1="50%" y1="50%"
                      x2={`${x}%`} y2={`${y}%`}
                      stroke={agent.color}
                      strokeWidth="1"
                      opacity="0.15"
                      strokeDasharray="4 4"
                      style={{ animation: 'dash-flow 2s linear infinite' }}
                    />
                  );
                })}
              </svg>
            </div>
          </div>
        </section>

        {/* ── 2. Animated Stats ─────────────────────────────────────────────── */}
        <section className="relative border-t border-white/5 px-4 py-20 sm:px-6 lg:px-8" style={{ background: 'linear-gradient(180deg, rgba(52,211,153,0.03), transparent)' }}>
          <div className="mx-auto max-w-5xl grid grid-cols-2 md:grid-cols-4 gap-10">
            {STATS.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>
        </section>

        {/* ── 3. Agent Grid ────────────────────────────────────────────────── */}
        <section id="agents" className="relative px-4 py-24 sm:px-6 lg:px-8 grain-overlay">
          <div ref={agentGrid.ref} className={`fade-section ${agentGrid.visible ? 'visible' : ''} mx-auto max-w-6xl`}>
            {/* Asymmetric header - left aligned */}
            <div className="mb-16 max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-3 font-sans">Agent Network</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">Meet your autonomous workforce</h2>
              <p className="mt-4 text-slate-400 font-sans">Each agent is a specialist with domain knowledge, dedicated tools, and the ability to collaborate.</p>
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

              <div className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-3 stagger-children" style={{ zIndex: 1 }}>
                {AGENTS.map((agent, i) => (
                  <div
                    key={agent.label}
                    className={`group relative rounded-2xl p-6 transition-all duration-300 cursor-default glass-card card-lift animate-fade-up ${
                      i === 0 ? 'lg:translate-y-0' :
                      i === 1 ? 'lg:translate-y-4' :
                      i === 2 ? 'lg:-translate-y-2' :
                      i === 3 ? 'lg:translate-y-6' :
                      i === 4 ? 'lg:translate-y-0' :
                      'lg:-translate-y-4'
                    }`}
                    style={{
                      background: hoveredAgent === i
                        ? `linear-gradient(135deg, ${agent.color}10, ${agent.color}05)`
                        : 'rgba(255,255,255,0.02)',
                      borderLeft: `3px solid ${agent.color}`,
                      borderColor: hoveredAgent === i ? `${agent.color}40` : undefined,
                    }}
                    onMouseEnter={() => setHoveredAgent(i)}
                    onMouseLeave={() => setHoveredAgent(null)}
                  >
                    {/* Node indicator */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg text-xs font-bold tracking-wider font-mono" style={{ background: `${agent.color}15`, color: agent.color, border: `1px solid ${agent.color}30` }}>
                        {agent.icon}
                      </div>
                      <h3 className="font-display font-semibold text-white">{agent.label}</h3>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-slate-400 leading-relaxed transition-opacity duration-300 font-sans" style={{ opacity: hoveredAgent === i ? 1 : 0.6 }}>
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
            <span className="text-xs text-slate-500 ml-2 font-sans">Agents collaborate autonomously</span>
          </div>
        </div>

        {/* ── 4. Workflow Animation ────────────────────────────────────────── */}
        <section id="workflow" className="relative px-4 py-24 sm:px-6 lg:px-8 diagonal-cut" style={{ background: 'linear-gradient(180deg, rgba(52,211,153,0.02), rgba(251,191,36,0.02), transparent)' }}>
          <div ref={workflowSection.ref} className={`fade-section ${workflowSection.visible ? 'visible' : ''} mx-auto max-w-5xl`}>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-amber-400 mb-3 font-sans">How It Works</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">From command to result in seconds</h2>
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

        {/* ── 4b. Vibe Coding Feature Highlight ──────────────────────────── */}
        <section className="relative px-4 py-24 sm:px-6 lg:px-8 grain-overlay" style={{ background: 'linear-gradient(180deg, rgba(251,191,36,0.03), rgba(52,211,153,0.02), transparent)' }}>
          <div className="mx-auto max-w-6xl relative z-10">
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-3 font-sans">Vibe Coding</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">Build Full-Stack Apps with AI</h2>
              <p className="mt-4 text-slate-400 max-w-2xl mx-auto font-sans">Describe your app in plain English. Watch 5 specialized agents architect, generate, debug, and deploy it&nbsp;&mdash; in minutes, not months.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: '🏛️', title: 'App Architect', desc: 'Designs file tree, data models, API endpoints, and component hierarchy from your description', color: '#34d399' },
                { icon: '⚡', title: 'Code Generator', desc: 'Generates production-grade Next.js, React, Tailwind CSS, and Prisma code — complete files, not stubs', color: '#fbbf24' },
                { icon: '🔧', title: 'Auto-Debugger', desc: 'Detects build errors, diagnoses root cause, applies surgical fixes, rebuilds — up to 3 retries automatically', color: '#f472b6' },
                { icon: '📸', title: 'Screenshot-to-Code', desc: 'Upload a Figma screenshot or UI design — AI replicates it with pixel-accurate Tailwind components', color: '#38bdf8' },
                { icon: '🚀', title: 'One-Click Deploy', desc: 'Deploy to Vercel with environment variables, custom domains, and zero-downtime updates', color: '#c084fc' },
                { icon: '🔀', title: 'Version Control', desc: 'Every change creates a snapshot. Roll back to any version instantly. GitHub sync built-in.', color: '#fb923c' },
              ].map((feature) => (
                <div key={feature.title} className="glass-card rounded-2xl p-6 card-lift" style={{ borderLeft: `3px solid ${feature.color}` }}>
                  <div className="text-2xl mb-3">{feature.icon}</div>
                  <h3 className="font-display font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed font-sans">{feature.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 text-center">
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
              <p className="text-sm font-semibold uppercase tracking-widest text-pink-400 mb-3 font-sans">112 Tools</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">Everything Your Agents Need</h2>
              <p className="mt-4 text-slate-400 max-w-2xl mx-auto font-sans">Real integrations, not demos. Gmail via IMAP, Calendar via CalDAV, Browser via Playwright, Sandbox via E2B&nbsp;&mdash; agents do actual work.</p>
            </div>

            {/* Tool Categories Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-12">
              {[
                { icon: '📧', category: 'Email', count: 8, tools: 'Read, draft, send, search, archive, thread', color: '#EA4335' },
                { icon: '📅', category: 'Calendar', count: 5, tools: 'List events, create, update, delete, find availability', color: '#4285F4' },
                { icon: '🌐', category: 'Browser', count: 22, tools: 'Navigate, click, fill forms, screenshot, PDF, cookies, tabs', color: '#34d399' },
                { icon: '🏗️', category: 'Sandbox', count: 7, tools: 'Create VM, write files, exec commands, dev server, deploy', color: '#fbbf24' },
                { icon: '📄', category: 'Document', count: 8, tools: 'Read, write, summarize, extract data, export, PDF analysis', color: '#8B5CF6' },
                { icon: '📊', category: 'Spreadsheet', count: 6, tools: 'Parse CSV, compute stats, formulas, charts, export', color: '#10B981' },
                { icon: '👤', category: 'CRM', count: 10, tools: 'Contacts, deals, activities, enrichment, lead scoring', color: '#F59E0B' },
                { icon: '🔍', category: 'Research', count: 6, tools: 'Web search, news, academic, citations, deep research', color: '#06B6D4' },
                { icon: '🧠', category: 'Knowledge', count: 10, tools: 'Memory store, retrieve, search, Q&A, index, summarize', color: '#c084fc' },
                { icon: '⚙️', category: 'Ops', count: 8, tools: 'Webhooks, API calls, file I/O, code execute, health checks', color: '#fb923c' },
                { icon: '🎤', category: 'Voice', count: 4, tools: 'Transcribe, synthesize, detect intent, real-time sessions', color: '#f472b6' },
                { icon: '🔌', category: 'MCP', count: 18, tools: 'Slack, GitHub, Notion, HubSpot, Jira + any MCP server', color: '#38bdf8' },
              ].map((cat) => (
                <div key={cat.category} className="glass-card rounded-xl p-4 card-lift">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{cat.icon}</span>
                    <h3 className="font-display font-semibold text-sm text-white">{cat.category}</h3>
                    <span className="ml-auto text-xs font-mono px-2 py-0.5 rounded-full bg-white/5 text-slate-400">{cat.count}</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed font-sans">{cat.tools}</p>
                </div>
              ))}
            </div>

            {/* Connected Services */}
            <div className="text-center">
              <p className="text-xs text-slate-500 mb-4 font-sans uppercase tracking-widest">Connected Services</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {INTEGRATIONS.map((int) => (
                  <div
                    key={int.name}
                    className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white border transition-all duration-200 hover:scale-105 font-sans"
                    style={{ backgroundColor: int.bg, borderColor: int.color + '40' }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: int.color, boxShadow: `0 0 6px ${int.color}40` }} aria-hidden="true" />
                    {int.name}
                  </div>
                ))}
                {[
                  { name: 'HubSpot', color: '#FF7A59', bg: 'rgba(255,122,89,0.1)' },
                  { name: 'Jira', color: '#0052CC', bg: 'rgba(0,82,204,0.1)' },
                  { name: 'Notion', color: '#FFFFFF', bg: 'rgba(255,255,255,0.06)' },
                  { name: 'Salesforce', color: '#00A1E0', bg: 'rgba(0,161,224,0.1)' },
                  { name: 'Stripe', color: '#635BFF', bg: 'rgba(99,91,255,0.1)' },
                  { name: 'Supabase', color: '#3ECF8E', bg: 'rgba(62,207,142,0.1)' },
                ].map((svc) => (
                  <div key={svc.name} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white border transition-all duration-200 hover:scale-105 font-sans" style={{ backgroundColor: svc.bg, borderColor: svc.color + '40' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: svc.color, boxShadow: `0 0 6px ${svc.color}40` }} aria-hidden="true" />
                    {svc.name}
                  </div>
                ))}
                <div className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-slate-500 border border-dashed border-white/10 font-sans">
                  + any MCP server
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 5b. Vibe Coding Deep Dive ────────────────────────────────────── */}
        <section className="px-4 py-24 sm:px-6 lg:px-8 grain-overlay" style={{ background: 'linear-gradient(180deg, transparent, rgba(52,211,153,0.02), transparent)' }}>
          <div className="mx-auto max-w-6xl relative z-10">
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-amber-400 mb-3 font-sans">How Vibe Coding Works</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">From Idea to Live App in 5 Steps</h2>
            </div>

            {/* Pipeline Steps */}
            <div className="grid gap-6 md:grid-cols-5 mb-16">
              {[
                { step: '01', title: 'Describe', desc: 'Type your app idea or upload a screenshot', icon: '💬', color: '#34d399' },
                { step: '02', title: 'Architect', desc: 'AI designs file tree, data models, API contracts', icon: '🏛️', color: '#fbbf24' },
                { step: '03', title: 'Generate', desc: 'Code generator creates every file — complete, not stubs', icon: '⚡', color: '#38bdf8' },
                { step: '04', title: 'Debug', desc: 'Auto-debugger fixes build errors (3 retries)', icon: '🔧', color: '#f472b6' },
                { step: '05', title: 'Preview', desc: 'Live preview in browser. Iterate via chat. Deploy.', icon: '🚀', color: '#c084fc' },
              ].map((s, i) => (
                <div key={s.step} className="text-center">
                  <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center text-2xl" style={{ background: `${s.color}15`, border: `1px solid ${s.color}30` }}>
                    {s.icon}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mb-1 uppercase tracking-widest">Step {s.step}</div>
                  <h3 className="font-display font-semibold text-white text-sm mb-1">{s.title}</h3>
                  <p className="text-xs text-slate-400 font-sans">{s.desc}</p>
                  {i < 4 && <div className="hidden md:block absolute mt-2 text-slate-600" aria-hidden="true" />}
                </div>
              ))}
            </div>

            {/* Cost Comparison */}
            <div className="glass-card rounded-2xl p-8 max-w-3xl mx-auto mb-16">
              <h3 className="font-display font-semibold text-white text-center mb-6">Cost Per Generated App</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-display font-bold gradient-text">$0.50</div>
                  <div className="text-xs text-slate-500 mt-1 font-sans">Simple app<br />Tier 1-2 models</div>
                </div>
                <div>
                  <div className="text-2xl font-display font-bold gradient-text">$1.50</div>
                  <div className="text-xs text-slate-500 mt-1 font-sans">Medium app<br />With debug loop</div>
                </div>
                <div>
                  <div className="text-2xl font-display font-bold gradient-text">$0.10</div>
                  <div className="text-xs text-slate-500 mt-1 font-sans">Per iteration<br />Only changed files</div>
                </div>
              </div>
              <p className="text-center text-[10px] text-slate-600 mt-4 font-sans">3-tier LLM routing: Tier 3 for architecture, Tier 2 for code gen, Tier 1 for debug. 10x cheaper than single-model platforms.</p>
            </div>

            {/* Builder IDE Preview */}
            <div className="glass-card rounded-2xl overflow-hidden max-w-4xl mx-auto">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/60" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/60" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
                </div>
                <span className="text-xs text-slate-500 font-mono ml-2">JAK Builder — My Task Manager</span>
              </div>
              <div className="grid grid-cols-12 min-h-[300px]">
                {/* File tree */}
                <div className="col-span-3 border-r border-white/5 p-3 text-xs text-slate-400 font-mono space-y-1">
                  <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-2">Files</div>
                  <div className="text-emerald-400">{'>'} src/</div>
                  <div className="pl-3">{'>'} app/</div>
                  <div className="pl-6 text-white">page.tsx</div>
                  <div className="pl-6">layout.tsx</div>
                  <div className="pl-3">{'>'} components/</div>
                  <div className="pl-6">TaskBoard.tsx</div>
                  <div className="pl-6">TaskCard.tsx</div>
                  <div className="pl-3">{'>'} lib/</div>
                  <div>package.json</div>
                  <div>tailwind.config.ts</div>
                </div>
                {/* Editor */}
                <div className="col-span-5 border-r border-white/5 p-3">
                  <div className="flex gap-2 mb-3 text-xs">
                    <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">Code</span>
                    <span className="px-2 py-1 rounded text-slate-500">Preview</span>
                  </div>
                  <pre className="text-xs font-mono text-slate-400 leading-relaxed">
{`export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold">
        Task Manager
      </h1>
      <TaskBoard />
    </main>
  );
}`}
                  </pre>
                </div>
                {/* Chat */}
                <div className="col-span-4 p-3 text-xs space-y-3">
                  <div className="text-[10px] text-slate-600 uppercase tracking-widest">Chat</div>
                  <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-300">
                    Build a task manager with drag-and-drop boards and dark mode
                  </div>
                  <div className="rounded-lg bg-white/5 px-3 py-2 text-slate-300">
                    Generated 12 files: pages, components, API routes, Prisma schema, Tailwind config.
                  </div>
                  <div className="flex gap-2 mt-2">
                    <div className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-slate-500">Add user authentication...</div>
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">{'>'}</div>
                  </div>
                </div>
              </div>
              {/* Progress bar */}
              <div className="border-t border-white/5 px-4 py-2 flex items-center gap-3 text-xs">
                <span className="text-emerald-400">{'✓'} Architect</span>
                <span className="text-emerald-400">{'✓'} Generate</span>
                <span className="text-emerald-400">{'✓'} Build</span>
                <span className="text-amber-400 animate-pulse">{'◉'} Preview</span>
                <span className="text-slate-600">{'○'} Deploy</span>
                <div className="ml-auto flex-1 max-w-32 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full w-3/4 bg-gradient-to-r from-emerald-400 to-amber-400 rounded-full" />
                </div>
                <span className="text-slate-500 font-mono">75%</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── 6. Pricing ───────────────────────────────────────────────────── */}
        <section id="pricing" className="relative px-4 py-24 sm:px-6 lg:px-8 grain-overlay" style={{ background: 'linear-gradient(180deg, transparent, rgba(52,211,153,0.02), transparent)' }}>
          <div className="mx-auto max-w-6xl relative z-10">
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400 mb-3 font-sans">Pricing</p>
              <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight">Simple, transparent pricing</h2>
              <p className="mt-4 text-slate-400 max-w-xl mx-auto font-sans">Start free and scale as you grow. No hidden fees.</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-3 max-w-5xl mx-auto items-start">
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
                    <p className="mt-2 text-sm text-slate-400 font-sans">{tier.description}</p>
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

        {/* ── 7. Open Source ────────────────────────────────────────────────── */}
        <section className="px-4 py-24 sm:px-6 lg:px-8">
          <div ref={testimonialSection.ref} className={`fade-section ${testimonialSection.visible ? 'visible' : ''} mx-auto max-w-4xl text-center`}>
            <p className="text-sm font-semibold uppercase tracking-widest text-amber-400 mb-3 font-sans">Open Source</p>
            <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight mb-4">Built in the Open</h2>
            <p className="text-slate-400 max-w-xl mx-auto mb-8 font-sans">JAK Swarm is fully open source under the MIT license. Inspect every agent, customize every tool, deploy on your own infrastructure.</p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
              <a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:bg-white/10 hover:border-white/20 focus-visible:ring-2 focus-visible:ring-white/50" aria-label="Star JAK Swarm on GitHub">
                <GitHubIcon className="h-5 w-5" />
                Star on GitHub
              </a>
              <a href="https://github.com/inbharatai/jak-swarm/issues" target="_blank" rel="noopener noreferrer" className="text-sm text-slate-400 hover:text-white transition-colors font-sans">
                Report an issue &rarr;
              </a>
            </div>

            {/* Tech stack badges */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {['TypeScript', 'Next.js 14', 'Fastify', 'Prisma', 'PostgreSQL', 'Playwright', 'React Flow', 'Tailwind CSS', 'Monaco Editor'].map(tech => (
                <span key={tech} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400 font-sans">{tech}</span>
              ))}
            </div>
          </div>
        </section>

        {/* ── 8. CTA ───────────────────────────────────────────────────────── */}
        <section className="relative px-4 py-24 sm:px-6 lg:px-8 overflow-hidden grain-overlay">
          {/* Background glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] pointer-events-none" style={{ background: 'radial-gradient(ellipse, rgba(52,211,153,0.08) 0%, rgba(251,191,36,0.04) 40%, transparent 60%)' }} aria-hidden="true" />

          {/* Floating elements */}
          <div className="absolute top-10 left-[10%] w-2 h-2 rounded-full bg-emerald-500/30" style={{ animation: 'float-slow 8s ease-in-out infinite' }} aria-hidden="true" />
          <div className="absolute bottom-20 right-[15%] w-3 h-3 rounded-full bg-amber-500/20" style={{ animation: 'float-slow 10s ease-in-out infinite 2s' }} aria-hidden="true" />
          <div className="absolute top-1/2 left-[5%] w-1.5 h-1.5 rounded-full bg-pink-500/25" style={{ animation: 'float-slow 12s ease-in-out infinite 4s' }} aria-hidden="true" />

          <div className="relative mx-auto max-w-3xl text-center z-10">
            <h2 className="text-4xl font-display font-bold mb-4 sm:text-5xl tracking-tight gradient-text">
              Start Automating in 2&nbsp;Minutes
            </h2>
            <p className="text-lg text-slate-400 mb-10 max-w-xl mx-auto font-sans">
              Deploy your autonomous AI workforce today. Free to start, no credit card required.
            </p>

            {/* Animated gradient border button */}
            <div className="inline-block rounded-xl p-[2px]" style={{ background: 'linear-gradient(135deg, #34d399, #fbbf24, #f472b6, #34d399)', backgroundSize: '300% 300%', animation: 'gradient-shift 4s ease infinite' }}>
              <Link href="/register" className="group inline-flex items-center gap-2 rounded-[10px] bg-[#09090b] px-10 py-4 text-base font-semibold text-white transition-all duration-300 hover:bg-transparent hover:text-[#09090b] focus-visible:ring-2 focus-visible:ring-emerald-400" style={{ touchAction: 'manipulation' }}>
                Get Started Free
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </section>

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
                  The autonomous AI workforce platform. 38 agents, 112 tools, vibe coding built in.
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
