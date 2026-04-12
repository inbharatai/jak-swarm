'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import Link from 'next/link';

/* ─── Network Background ───────────────────────────────────────────────── */

function NetworkBackground({ isActive }: { isActive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<{ x: number; y: number; vx: number; vy: number; r: number; color: string }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize);

    // Initialize nodes
    const colors = ['#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#c084fc'];
    const rect = canvas.getBoundingClientRect();
    const isMobile = rect.width < 640;
    const nodeCount = isMobile ? 15 : 30;
    if (nodesRef.current.length === 0) {
      nodesRef.current = Array.from({ length: nodeCount }, () => ({
        x: Math.random() * rect.width,
        y: Math.random() * rect.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 2 + 1,
        color: colors[Math.floor(Math.random() * colors.length)],
      }));
    }

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      const nodes = nodesRef.current;

      // Update positions
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;

        if (node.x < 0 || node.x > rect.width) node.vx *= -1;
        if (node.y < 0 || node.y > rect.height) node.vy *= -1;
      }

      // Draw connections
      const maxDist = 120;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.08;
            ctx.strokeStyle = `rgba(52, 211, 153, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      for (const node of nodes) {
        ctx.fillStyle = node.color;
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      animRef.current = requestAnimationFrame(draw);
    };

    if (isActive) {
      draw();
    }

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [isActive]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.6 }}
      aria-hidden="true"
    />
  );
}

/* ─── Stats Counter ─────────────────────────────────────────────────────── */

const CTA_STATS = [
  { value: '38', label: 'Agents' },
  { value: '113', label: 'Tools' },
  { value: '21', label: 'Integrations' },
  { value: '<2min', label: 'To Deploy' },
];

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function PremiumCTA() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: false, amount: 0.3 });

  return (
    <section
      ref={ref}
      className="relative px-4 py-16 sm:py-32 sm:px-6 lg:px-8 overflow-hidden"
      aria-label="Get started with JAK"
    >
      {/* Network background */}
      <NetworkBackground isActive={isInView} />

      {/* Radial gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, rgba(52,211,153,0.08) 0%, rgba(251,191,36,0.04) 30%, transparent 60%)',
        }}
        aria-hidden="true"
      />

      {/* Grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(52,211,153,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(52,211,153,0.02) 1px, transparent 1px)',
          backgroundSize: '80px 80px',
          maskImage: 'radial-gradient(ellipse at 50% 50%, black 30%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 50%, black 30%, transparent 70%)',
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-4xl z-10">
        {/* Scale indicator */}
        <motion.div
          className="grid grid-cols-2 sm:flex sm:items-center sm:justify-center gap-6 sm:gap-12 mb-10 sm:mb-16"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          {CTA_STATS.map((stat, i) => (
            <div key={stat.label} className="text-center">
              <motion.div
                className="text-2xl sm:text-3xl font-display font-bold tabular-nums"
                style={{
                  background: 'linear-gradient(135deg, #34d399, #fbbf24)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={isInView ? { opacity: 1, scale: 1 } : {}}
                transition={{ duration: 0.4, delay: i * 0.1 }}
              >
                {stat.value}
              </motion.div>
              <div className="text-[10px] sm:text-xs font-mono text-slate-500 uppercase tracking-widest mt-1">
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Main CTA content */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.2 }}
        >
          <h2 className="text-4xl sm:text-6xl font-display font-bold tracking-tight mb-6 leading-[1.1]">
            <span className="text-white/90">The AI workforce</span>
            <br />
            <span
              style={{
                background: 'linear-gradient(135deg, #34d399 0%, #fbbf24 50%, #f472b6 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              your company deserves
            </span>
          </h2>

          <p className="text-base sm:text-lg text-slate-400 max-w-xl mx-auto mb-12 font-sans leading-relaxed">
            Stop hiring for tasks AI can handle. Deploy autonomous agents that execute real work&nbsp;&mdash; from email to code to contracts.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {/* Primary: Animated border */}
            <div
              className="rounded-xl p-[2px]"
              style={{
                background: 'linear-gradient(135deg, #34d399, #fbbf24, #f472b6, #34d399)',
                backgroundSize: '300% 300%',
                animation: 'gradient-shift 4s ease infinite',
              }}
            >
              <Link
                href="/register"
                className="group inline-flex items-center gap-2 rounded-[10px] bg-[#09090b] px-10 py-4 text-base font-semibold text-white transition-all duration-300 hover:bg-transparent hover:text-[#09090b]"
                style={{ touchAction: 'manipulation' }}
              >
                Start Free
                <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>

            {/* Secondary */}
            <a
              href="https://github.com/inbharatai/jak-swarm"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-8 py-4 text-base font-semibold text-white transition-all duration-200 hover:bg-white/10 hover:border-white/20"
              aria-label="View JAK Swarm on GitHub"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              View on GitHub
            </a>
          </div>

          {/* Trust line */}
          <p className="mt-8 text-xs text-slate-600 font-sans">
            Free to start &middot; No credit card &middot; MIT licensed &middot; Self-host or cloud
          </p>
        </motion.div>
      </div>

      <style>{`
        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
    </section>
  );
}
