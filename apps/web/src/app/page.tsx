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
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
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
        if (entry.isIntersecting) setVisible(true);
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
    >
      {/* Network nodes background */}
      <circle cx="20" cy="20" r="3" fill="#3B82F6" opacity="0.4" />
      <circle cx="100" cy="25" r="2.5" fill="#8B5CF6" opacity="0.3" />
      <circle cx="15" cy="100" r="2" fill="#3B82F6" opacity="0.3" />
      <circle cx="105" cy="95" r="3" fill="#8B5CF6" opacity="0.4" />
      <circle cx="60" cy="10" r="2" fill="#3B82F6" opacity="0.25" />
      <circle cx="60" cy="110" r="2.5" fill="#8B5CF6" opacity="0.25" />
      {/* Connection lines */}
      <line x1="20" y1="20" x2="35" y2="42" stroke="#3B82F6" strokeWidth="0.8" opacity="0.2" />
      <line x1="100" y1="25" x2="82" y2="42" stroke="#8B5CF6" strokeWidth="0.8" opacity="0.2" />
      <line x1="15" y1="100" x2="35" y2="78" stroke="#3B82F6" strokeWidth="0.8" opacity="0.2" />
      <line x1="105" y1="95" x2="82" y2="78" stroke="#8B5CF6" strokeWidth="0.8" opacity="0.2" />
      {/* Main letterforms */}
      <text
        x="60"
        y="74"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontWeight="800"
        fontSize="52"
        letterSpacing="-2"
      >
        <tspan fill="url(#logoGrad)">JAK</tspan>
      </text>
      <defs>
        <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ─── Icon Components ────────────────────────────────────────────────────── */

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

/* ─── Data ────────────────────────────────────────────────────────────────── */

const AGENTS = [
  { icon: 'CEO', label: 'CEO Agent', color: '#3B82F6', desc: 'Strategic planning, OKRs, cross-department coordination' },
  { icon: 'CTO', label: 'CTO Agent', color: '#8B5CF6', desc: 'Architecture decisions, code reviews, tech stack evaluation' },
  { icon: 'CMO', label: 'CMO Agent', color: '#EC4899', desc: 'Campaign strategy, content creation, brand positioning' },
  { icon: 'ENG', label: 'Engineer', color: '#10B981', desc: 'Code generation, debugging, testing, CI/CD pipelines' },
  { icon: 'LAW', label: 'Legal Agent', color: '#F59E0B', desc: 'Contract review, compliance checks, policy drafting' },
  { icon: 'MKT', label: 'Marketing', color: '#06B6D4', desc: 'Content writing, email sequences, analytics reporting' },
];

const STATS = [
  { value: 33, label: 'Agents', suffix: '' },
  { value: 105, label: 'Tools', suffix: '' },
  { value: 6, label: 'LLM Providers', suffix: '' },
  { value: 22, label: 'Browser Tools', suffix: '' },
];

const WORKFLOW_STEPS = [
  { label: 'Command', desc: 'Natural language input', icon: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18' },
  { label: 'Commander', desc: 'Task decomposition', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75' },
  { label: 'Planner', desc: 'DAG assembly', icon: 'M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z' },
  { label: 'Workers', desc: 'Parallel execution', icon: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z' },
  { label: 'Result', desc: 'Compiled output', icon: 'M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z' },
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
    features: ['Unlimited workflows', '5 team members', 'All 33 agents', 'All integrations', 'Priority support', 'Custom templates', 'API access'],
    cta: 'Start Pro',
    href: '/register',
    highlighted: true,
    accent: 'blue',
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
    accent: 'gold',
  },
];

/* ─── Stat Card Component ────────────────────────────────────────────────── */

function StatCard({ value, label }: { value: number; label: string; suffix: string }) {
  const { count, ref } = useCountUp(value, 1800);
  return (
    <div ref={ref} className="glass-card rounded-xl p-6 text-center">
      <div className="text-5xl sm:text-6xl font-bold tracking-tight" style={{ background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        {count}
      </div>
      <div className="mt-2 text-sm font-medium text-slate-400 uppercase tracking-widest">{label}</div>
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function HomePage() {
  const router = useRouter();
  const [heroVisible, setHeroVisible] = useState(false);
  const [hoveredAgent, setHoveredAgent] = useState<number | null>(null);

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
          0%, 100% { box-shadow: 0 0 20px rgba(59, 130, 246, 0.2), 0 0 60px rgba(59, 130, 246, 0.05); }
          50% { box-shadow: 0 0 30px rgba(59, 130, 246, 0.4), 0 0 80px rgba(59, 130, 246, 0.1); }
        }
        @keyframes dash-flow {
          to { stroke-dashoffset: -20; }
        }
        @keyframes flow-pulse {
          0% { opacity: 0.3; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1); }
          100% { opacity: 0.3; transform: scale(0.95); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes border-spin {
          0% { --angle: 0deg; }
          100% { --angle: 360deg; }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes typewriter {
          from { max-width: 0; }
          to { max-width: 100%; }
        }
        .gradient-bg {
          background: linear-gradient(135deg, #0a0a1a, #0d1333, #0a0a1a, #1a0d2e);
          background-size: 400% 400%;
          animation: gradient-shift 15s ease infinite;
        }
        .gradient-text {
          background: linear-gradient(135deg, #3B82F6, #8B5CF6, #EC4899);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .particle {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
        }
        .agent-node {
          animation: pulse-glow 3s ease-in-out infinite;
        }
        .agent-node:nth-child(2) { animation-delay: 0.5s; }
        .agent-node:nth-child(3) { animation-delay: 1s; }
        .agent-node:nth-child(4) { animation-delay: 1.5s; }
        .agent-node:nth-child(5) { animation-delay: 2s; }
        .agent-node:nth-child(6) { animation-delay: 2.5s; }
        .connection-line {
          stroke-dasharray: 6 4;
          animation: dash-flow 1.5s linear infinite;
        }
        .flow-step:nth-child(1) { animation: flow-pulse 3s ease-in-out infinite 0s; }
        .flow-step:nth-child(2) { animation: flow-pulse 3s ease-in-out infinite 0.6s; }
        .flow-step:nth-child(3) { animation: flow-pulse 3s ease-in-out infinite 1.2s; }
        .flow-step:nth-child(4) { animation: flow-pulse 3s ease-in-out infinite 1.8s; }
        .flow-step:nth-child(5) { animation: flow-pulse 3s ease-in-out infinite 2.4s; }
        .shimmer-border {
          background: linear-gradient(90deg, transparent, rgba(59,130,246,0.3), transparent);
          background-size: 200% 100%;
          animation: shimmer 3s linear infinite;
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
      `}</style>

      <main className="min-h-screen bg-[#09090b] text-white overflow-x-hidden">
        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 backdrop-blur-xl" style={{ background: 'rgba(9,9,11,0.6)' }}>
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <JakLogo size={32} />
              <span className="text-lg font-bold tracking-tight">JAK Swarm</span>
            </div>
            <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
              <a href="#agents" className="hover:text-white transition-colors duration-200">Agents</a>
              <a href="#workflow" className="hover:text-white transition-colors duration-200">How It Works</a>
              <a href="#pricing" className="hover:text-white transition-colors duration-200">Pricing</a>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/login" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">
                Sign In
              </Link>
              <Link href="/register" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:opacity-90" style={{ background: 'linear-gradient(135deg, #3B82F6, #7C3AED)' }}>
                Get Started
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </nav>

        {/* ── 1. Hero ──────────────────────────────────────────────────────── */}
        <section className="relative min-h-screen flex items-center justify-center gradient-bg px-4 pt-20 pb-16 sm:px-6 lg:px-8">
          {/* Floating particles */}
          {[
            { w: 4, h: 4, top: '15%', left: '10%', bg: '#3B82F6', opacity: 0.3, dur: '8s' },
            { w: 3, h: 3, top: '25%', left: '85%', bg: '#8B5CF6', opacity: 0.25, dur: '10s' },
            { w: 5, h: 5, top: '70%', left: '15%', bg: '#EC4899', opacity: 0.2, dur: '12s' },
            { w: 3, h: 3, top: '80%', left: '75%', bg: '#3B82F6', opacity: 0.3, dur: '9s' },
            { w: 6, h: 6, top: '40%', left: '90%', bg: '#8B5CF6', opacity: 0.15, dur: '11s' },
            { w: 4, h: 4, top: '55%', left: '5%', bg: '#3B82F6', opacity: 0.2, dur: '7s' },
            { w: 2, h: 2, top: '10%', left: '50%', bg: '#EC4899', opacity: 0.3, dur: '13s' },
            { w: 3, h: 3, top: '90%', left: '40%', bg: '#8B5CF6', opacity: 0.2, dur: '10s' },
            { w: 2, h: 2, top: '35%', left: '30%', bg: '#3B82F6', opacity: 0.15, dur: '14s' },
            { w: 4, h: 4, top: '60%', left: '60%', bg: '#EC4899', opacity: 0.18, dur: '9s' },
          ].map((p, i) => (
            <div
              key={i}
              className="particle"
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

          {/* Radial glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(ellipse, rgba(59,130,246,0.12) 0%, rgba(139,92,246,0.06) 40%, transparent 70%)' }} />

          {/* Grid overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)', backgroundSize: '80px 80px' }} />

          <div className="relative mx-auto max-w-5xl text-center" style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? 'translateY(0)' : 'translateY(40px)', transition: 'all 1s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            {/* Logo */}
            <div className="mb-8 flex justify-center" style={{ animation: heroVisible ? 'float-medium 6s ease-in-out infinite' : 'none' }}>
              <JakLogo size={80} />
            </div>

            <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              <span className="block text-white/90" style={{ transitionDelay: '0.2s' }}>33 AI Agents. One Platform.</span>
              <span className="block mt-2 gradient-text" style={{ transitionDelay: '0.4s' }}>
                Your Entire Company, Automated.
              </span>
            </h1>

            <p className="mx-auto mb-12 max-w-2xl text-base text-slate-400 sm:text-lg leading-relaxed" style={{ transitionDelay: '0.6s' }}>
              CEO, CTO, CMO, Engineer, Legal, Finance, HR -- all autonomous. All working together. Deploy intelligent agent swarms that plan, execute, and deliver results.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4" style={{ transitionDelay: '0.8s' }}>
              {/* Gradient border CTA */}
              <Link href="/register" className="group relative inline-flex items-center gap-2 rounded-xl px-8 py-4 text-base font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 btn-glow hover:scale-105 transition-transform" style={{ background: 'linear-gradient(135deg, #3B82F6, #7C3AED)', boxShadow: '0 0 30px rgba(59,130,246,0.3), 0 10px 40px rgba(59,130,246,0.15)' }}>
                Start Free
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-8 py-4 text-base font-semibold text-white transition-all duration-200 hover:bg-white/10 hover:border-white/20">
                <GitHubIcon className="h-5 w-5" />
                View on GitHub
              </a>
            </div>
          </div>
        </section>

        {/* ── 2. Animated Stats ─────────────────────────────────────────────── */}
        <section className="relative border-t border-white/5 px-4 py-20 sm:px-6 lg:px-8" style={{ background: 'linear-gradient(180deg, rgba(59,130,246,0.03), transparent)' }}>
          <div className="mx-auto max-w-5xl grid grid-cols-2 md:grid-cols-4 gap-10">
            {STATS.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>
        </section>

        {/* ── 3. Agent Grid ────────────────────────────────────────────────── */}
        <section id="agents" className="relative px-4 py-24 sm:px-6 lg:px-8">
          <div ref={agentGrid.ref} className={`fade-section ${agentGrid.visible ? 'visible' : ''} mx-auto max-w-5xl`}>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-3">Agent Network</p>
              <h2 className="text-3xl font-bold sm:text-4xl tracking-tight">Meet your autonomous workforce</h2>
              <p className="mt-4 text-slate-400 max-w-xl mx-auto">Each agent is a specialist with domain knowledge, dedicated tools, and the ability to collaborate.</p>
            </div>

            {/* Agent network visualization */}
            <div className="relative">
              {/* SVG connection lines */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
                {/* Row 1 connections */}
                <line x1="25%" y1="30%" x2="50%" y2="30%" className="connection-line" stroke="rgba(59,130,246,0.15)" strokeWidth="1" />
                <line x1="50%" y1="30%" x2="75%" y2="30%" className="connection-line" stroke="rgba(139,92,246,0.15)" strokeWidth="1" />
                {/* Cross connections */}
                <line x1="25%" y1="35%" x2="50%" y2="65%" className="connection-line" stroke="rgba(59,130,246,0.08)" strokeWidth="1" />
                <line x1="75%" y1="35%" x2="50%" y2="65%" className="connection-line" stroke="rgba(139,92,246,0.08)" strokeWidth="1" />
                {/* Row 2 connections */}
                <line x1="25%" y1="70%" x2="50%" y2="70%" className="connection-line" stroke="rgba(236,72,153,0.12)" strokeWidth="1" />
                <line x1="50%" y1="70%" x2="75%" y2="70%" className="connection-line" stroke="rgba(16,185,129,0.12)" strokeWidth="1" />
              </svg>

              <div className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-3 stagger-children" style={{ zIndex: 1 }}>
                {AGENTS.map((agent, i) => (
                  <div
                    key={agent.label}
                    className={`agent-node group relative rounded-2xl border border-white/5 p-6 transition-all duration-300 cursor-default glass-card card-lift animate-fade-up ${
                      ['border-l-4 border-l-purple-500', 'border-l-4 border-l-blue-500', 'border-l-4 border-l-pink-500', 'border-l-4 border-l-emerald-500', 'border-l-4 border-l-amber-500', 'border-l-4 border-l-cyan-500'][i]
                    }`}
                    style={{
                      background: hoveredAgent === i
                        ? `linear-gradient(135deg, ${agent.color}10, ${agent.color}05)`
                        : 'rgba(255,255,255,0.02)',
                      borderColor: hoveredAgent === i ? `${agent.color}40` : 'rgba(255,255,255,0.05)',
                    }}
                    onMouseEnter={() => setHoveredAgent(i)}
                    onMouseLeave={() => setHoveredAgent(null)}
                  >
                    {/* Node indicator */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg text-xs font-bold tracking-wider" style={{ background: `${agent.color}15`, color: agent.color, border: `1px solid ${agent.color}30` }}>
                        {agent.icon}
                      </div>
                      <h3 className="font-semibold text-white">{agent.label}</h3>
                    </div>

                    {/* Description - visible on hover */}
                    <p className="text-sm text-slate-400 leading-relaxed transition-all duration-300" style={{ opacity: hoveredAgent === i ? 1 : 0.6 }}>
                      {agent.desc}
                    </p>

                    {/* Glow dot */}
                    <div className="absolute top-4 right-4 w-2 h-2 rounded-full" style={{ background: agent.color, boxShadow: `0 0 8px ${agent.color}60` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. Workflow Animation ────────────────────────────────────────── */}
        <section id="workflow" className="relative px-4 py-24 sm:px-6 lg:px-8 dot-pattern" style={{ background: 'linear-gradient(180deg, transparent, rgba(59,130,246,0.02), transparent)' }}>
          <div ref={workflowSection.ref} className={`fade-section ${workflowSection.visible ? 'visible' : ''} mx-auto max-w-5xl`}>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-3">How It Works</p>
              <h2 className="text-3xl font-bold sm:text-4xl tracking-tight">From command to result in seconds</h2>
            </div>

            <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-2">
              {WORKFLOW_STEPS.map((step, i) => (
                <div key={step.label} className="flex items-center gap-2 md:gap-0 w-full md:w-auto">
                  <div className="flow-step flex flex-col items-center text-center flex-shrink-0" style={{ minWidth: 120 }}>
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3 border border-white/10" style={{ background: 'rgba(59,130,246,0.08)' }}>
                      <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d={step.icon} />
                      </svg>
                    </div>
                    <span className="text-sm font-semibold text-white">{step.label}</span>
                    <span className="text-xs text-slate-500 mt-1">{step.desc}</span>
                  </div>

                  {/* Arrow between steps */}
                  {i < WORKFLOW_STEPS.length - 1 && (
                    <div className="hidden md:block flex-1 mx-2">
                      <svg className="w-full h-4" viewBox="0 0 100 16">
                        <line x1="0" y1="8" x2="85" y2="8" className="connection-line" stroke="rgba(59,130,246,0.3)" strokeWidth="1.5" />
                        <polygon points="90,8 82,4 82,12" fill="rgba(59,130,246,0.3)" />
                      </svg>
                    </div>
                  )}
                  {i < WORKFLOW_STEPS.length - 1 && (
                    <div className="md:hidden w-px h-8 mx-auto" style={{ background: 'linear-gradient(180deg, rgba(59,130,246,0.3), transparent)' }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 5. Integrations ──────────────────────────────────────────────── */}
        <section className="px-4 py-24 sm:px-6 lg:px-8">
          <div ref={integrationSection.ref} className={`fade-section ${integrationSection.visible ? 'visible' : ''} mx-auto max-w-5xl`}>
            <div className="text-center mb-12">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-3">Integrations</p>
              <h2 className="text-3xl font-bold sm:text-4xl tracking-tight">Connects to your entire stack</h2>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              {INTEGRATIONS.map((int) => (
                <div
                  key={int.name}
                  className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium border border-white/5 transition-all duration-200 hover:border-white/15 hover:scale-105"
                  style={{ background: int.bg, color: int.color }}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: int.color, boxShadow: `0 0 6px ${int.color}40` }} />
                  {int.name}
                </div>
              ))}
              <div className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-slate-500 border border-dashed border-white/10">
                + 68 more tools
              </div>
            </div>
          </div>
        </section>

        {/* ── 6. Pricing ───────────────────────────────────────────────────── */}
        <section id="pricing" className="relative px-4 py-24 sm:px-6 lg:px-8" style={{ background: 'linear-gradient(180deg, transparent, rgba(59,130,246,0.02), transparent)' }}>
          <div className="mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-3">Pricing</p>
              <h2 className="text-3xl font-bold sm:text-4xl tracking-tight">Simple, transparent pricing</h2>
              <p className="mt-4 text-slate-400 max-w-xl mx-auto">Start free and scale as you grow. No hidden fees.</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-3 max-w-5xl mx-auto items-start">
              {PRICING.map((tier) => (
                <div
                  key={tier.name}
                  className={`relative rounded-2xl p-8 transition-all duration-300 hover:-translate-y-1 ${
                    tier.highlighted
                      ? 'lg:scale-105 gradient-border-wrap glow-blue'
                      : ''
                  }`}
                  style={{
                    background: tier.highlighted
                      ? 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.05))'
                      : tier.accent === 'gold'
                      ? 'linear-gradient(135deg, rgba(245,158,11,0.05), rgba(217,119,6,0.02))'
                      : 'rgba(255,255,255,0.02)',
                    border: tier.highlighted
                      ? '1px solid rgba(59,130,246,0.3)'
                      : tier.accent === 'gold'
                      ? '1px solid rgba(245,158,11,0.15)'
                      : '1px solid rgba(255,255,255,0.05)',
                    boxShadow: tier.highlighted
                      ? '0 0 40px rgba(59,130,246,0.1), 0 20px 60px rgba(59,130,246,0.05)'
                      : 'none',
                  }}
                >
                  {tier.highlighted && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <span className="rounded-full px-4 py-1 text-xs font-bold uppercase tracking-wider text-white" style={{ background: 'linear-gradient(135deg, #3B82F6, #7C3AED)' }}>
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div className="mb-6">
                    <h3 className="text-lg font-semibold mb-2 text-white">{tier.name}</h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold text-white">{tier.price}</span>
                      {tier.period && <span className="text-slate-500">{tier.period}</span>}
                    </div>
                    <p className="mt-2 text-sm text-slate-400">{tier.description}</p>
                  </div>

                  <ul className="mb-8 space-y-3">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 text-sm">
                        <CheckIcon className="h-5 w-5 shrink-0 text-blue-400" />
                        <span className="text-slate-300">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {tier.href.startsWith('mailto:') ? (
                    <a
                      href={tier.href}
                      className="block w-full rounded-xl py-3 text-center text-sm font-semibold transition-all duration-200"
                      style={{
                        background: tier.accent === 'gold' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.05)',
                        border: tier.accent === 'gold' ? '1px solid rgba(245,158,11,0.2)' : '1px solid rgba(255,255,255,0.1)',
                        color: tier.accent === 'gold' ? '#F59E0B' : '#fff',
                      }}
                    >
                      {tier.cta}
                    </a>
                  ) : (
                    <Link
                      href={tier.href}
                      className="block w-full rounded-xl py-3 text-center text-sm font-semibold transition-all duration-200"
                      style={{
                        background: tier.highlighted ? 'linear-gradient(135deg, #3B82F6, #7C3AED)' : 'rgba(255,255,255,0.05)',
                        border: tier.highlighted ? 'none' : '1px solid rgba(255,255,255,0.1)',
                        color: '#fff',
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

        {/* ── 7. Testimonial Placeholder ────────────────────────────────────── */}
        <section className="px-4 py-24 sm:px-6 lg:px-8">
          <div ref={testimonialSection.ref} className={`fade-section ${testimonialSection.visible ? 'visible' : ''} mx-auto max-w-4xl text-center`}>
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-3">Community</p>
            <h2 className="text-3xl font-bold sm:text-4xl tracking-tight mb-8">Join companies automating with JAK Swarm</h2>

            {/* Placeholder avatars */}
            <div className="flex items-center justify-center -space-x-3 mb-6">
              {[...Array(7)].map((_, i) => (
                <div
                  key={i}
                  className="w-10 h-10 rounded-full border-2 border-[#09090b]"
                  style={{
                    background: `linear-gradient(135deg, ${
                      ['#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#06B6D4', '#EF4444'][i]
                    }40, ${
                      ['#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#06B6D4', '#EF4444'][i]
                    }15)`,
                  }}
                />
              ))}
              <div className="w-10 h-10 rounded-full border-2 border-[#09090b] bg-white/5 flex items-center justify-center text-xs font-bold text-slate-400">
                +
              </div>
            </div>
            <p className="text-slate-500 text-sm">Be among the first to transform your operations with AI</p>
          </div>
        </section>

        {/* ── 8. CTA ───────────────────────────────────────────────────────── */}
        <section className="relative px-4 py-24 sm:px-6 lg:px-8 overflow-hidden dot-pattern">
          {/* Background glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] pointer-events-none" style={{ background: 'radial-gradient(ellipse, rgba(59,130,246,0.1) 0%, transparent 60%)' }} />

          {/* Floating elements */}
          <div className="absolute top-10 left-[10%] w-2 h-2 rounded-full bg-blue-500/30" style={{ animation: 'float-slow 8s ease-in-out infinite' }} />
          <div className="absolute bottom-20 right-[15%] w-3 h-3 rounded-full bg-purple-500/20" style={{ animation: 'float-slow 10s ease-in-out infinite 2s' }} />
          <div className="absolute top-1/2 left-[5%] w-1.5 h-1.5 rounded-full bg-pink-500/25" style={{ animation: 'float-slow 12s ease-in-out infinite 4s' }} />

          <div className="relative mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-bold mb-4 sm:text-5xl tracking-tight gradient-text">
              Start Automating in 2 Minutes
            </h2>
            <p className="text-lg text-slate-400 mb-10 max-w-xl mx-auto">
              Deploy your autonomous AI workforce today. Free to start, no credit card required.
            </p>

            {/* Animated gradient border button */}
            <div className="inline-block rounded-xl p-[2px] gradient-border-wrap" style={{ background: 'linear-gradient(135deg, #3B82F6, #8B5CF6, #EC4899, #3B82F6)', backgroundSize: '300% 300%', animation: 'gradient-shift 4s ease infinite' }}>
              <Link href="/register" className="group inline-flex items-center gap-2 rounded-[10px] bg-[#09090b] px-10 py-4 text-base font-semibold text-white transition-all duration-300 hover:bg-transparent btn-glow">
                Get Started Free
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── 9. Footer ────────────────────────────────────────────────────── */}
        <div className="h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
        <footer className="border-t border-white/5 px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-12 md:grid-cols-4">
              {/* Logo column */}
              <div className="md:col-span-1">
                <div className="flex items-center gap-2 mb-4">
                  <JakLogo size={28} />
                  <span className="text-base font-bold tracking-tight">JAK Swarm</span>
                </div>
                <p className="text-sm text-slate-500 leading-relaxed">
                  The autonomous AI workforce platform. 33 agents, 74 tools, infinite possibilities.
                </p>
              </div>

              {/* Product */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-4">Product</h4>
                <ul className="space-y-2.5 text-sm text-slate-500">
                  <li><a href="#agents" className="hover:text-white transition-colors">Features</a></li>
                  <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                  <li><a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Documentation</a></li>
                  <li><a href="#workflow" className="hover:text-white transition-colors">How It Works</a></li>
                </ul>
              </div>

              {/* Company */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-4">Company</h4>
                <ul className="space-y-2.5 text-sm text-slate-500">
                  <li><span className="text-slate-600 cursor-default">About</span></li>
                  <li><span className="text-slate-600 cursor-default">Blog</span></li>
                  <li><span className="text-slate-600 cursor-default">Careers</span></li>
                  <li><a href="mailto:contact@inbharat.ai" className="hover:text-white transition-colors">Contact</a></li>
                </ul>
              </div>

              {/* Social */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-4">Connect</h4>
                <ul className="space-y-2.5 text-sm text-slate-500">
                  <li>
                    <a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors inline-flex items-center gap-2">
                      <GitHubIcon className="h-4 w-4" />
                      GitHub
                    </a>
                  </li>
                  <li>
                    <a href="https://twitter.com/inbharatai" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors inline-flex items-center gap-2">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                      X / Twitter
                    </a>
                  </li>
                  <li>
                    <a href="https://linkedin.com/company/inbharatai" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors inline-flex items-center gap-2">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                      LinkedIn
                    </a>
                  </li>
                </ul>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="mt-12 pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <span className="text-sm text-slate-600">&copy; {new Date().getFullYear()} InBharat AI. All rights reserved.</span>
              <span className="text-sm text-slate-600">Built with purpose. Designed for scale.</span>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
