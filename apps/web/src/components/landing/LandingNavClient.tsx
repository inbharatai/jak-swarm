'use client';

import { useState } from 'react';
import Link from 'next/link';
import { JakLogo, ArrowRightIcon } from './LandingSvg';

/**
 * A.4 — the marketing nav, isolated as a client island.
 *
 * The only piece of interactivity on the landing nav is the mobile hamburger
 * toggle. Pulling the whole nav into a client component keeps the rest of `/`
 * as a static Server Component while still server-rendering this nav's initial
 * HTML (Next renders client components on the server for the first paint), so
 * SEO and first-contentful paint are unchanged — only the toggle ships as JS.
 */
export default function LandingNavClient() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 backdrop-blur-xl"
      style={{ background: 'rgba(9,9,11,0.6)' }}
      role="navigation"
      aria-label="Main navigation"
    >
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
        <div className="hidden md:flex items-center gap-7 text-sm text-slate-400">
          <a
            href="#jak-shield"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-rose-400/30 bg-rose-400/[0.06] text-rose-200 hover:bg-rose-400/10 hover:text-white focus-visible:text-white transition-colors duration-200"
            aria-label="JAK Shield — security and trust layer"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6Z" />
            </svg>
            <span className="font-semibold">JAK Shield</span>
          </a>
          <a href="#company-os" className="hover:text-white focus-visible:text-white transition-colors duration-200">Company OS</a>
          <a href="#outcomes" className="hover:text-white focus-visible:text-white transition-colors duration-200">Proof</a>
          <a href="#trust" className="hover:text-white focus-visible:text-white transition-colors duration-200">Trust</a>
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
          <a
            href="#jak-shield"
            onClick={() => setMobileMenuOpen(false)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-300 hover:text-white transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6Z" />
            </svg>
            JAK Shield
          </a>
          <a href="#company-os" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Company OS</a>
          <a href="#outcomes" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Proof</a>
          <a href="#trust" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Trust</a>
          <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-400 hover:text-white transition-colors">Pricing</a>
          <Link href="/builder" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-emerald-400 hover:text-emerald-300 transition-colors">Builder</Link>
          {/* Sign In moved here from the top bar so the brand + Get Started
              have room to breathe without wrapping on 375px viewports. */}
          <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="block text-sm text-slate-300 hover:text-white transition-colors pt-2 border-t border-white/5">Sign In</Link>
        </div>
      )}
    </nav>
  );
}