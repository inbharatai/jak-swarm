'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRightIcon, JakLogo } from './LandingSvg';

const links = [
  { href: '#engines', label: 'Engines' },
  { href: '#company-os', label: 'Company Brain' },
  { href: '#hyperagent', label: 'Hyperagent' },
  { href: '#multiplayer', label: 'Multiplayer' },
  { href: '#trust', label: 'Trust' },
  { href: '#pricing', label: 'Pricing' },
] as const;

export default function LandingNavClient() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav
      className="fixed inset-x-0 top-0 z-50 border-b border-white/5 backdrop-blur-xl"
      style={{ background: 'rgba(9,9,11,0.76)' }}
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <a href="#main-content" className="flex shrink-0 items-center gap-2" aria-label="JAK Swarm home">
          <JakLogo size={32} />
          <span className="whitespace-nowrap text-base font-display font-bold tracking-tight sm:text-lg">JAK Swarm</span>
        </a>

        <div className="hidden items-center gap-7 text-sm text-zinc-400 md:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-white focus-visible:text-white">
              {link.label}
            </a>
          ))}
          <a href="#jak-shield" className="rounded-full border border-rose-300/25 bg-rose-300/[0.07] px-2.5 py-1 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-300/12 hover:text-white">
            JAK Shield
          </a>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            className="p-2 text-zinc-400 transition-colors hover:text-white md:hidden"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              {mobileMenuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
          <Link href="/login" className="hidden whitespace-nowrap text-sm font-medium text-zinc-400 transition-colors hover:text-white sm:inline-flex">
            Sign in
          </Link>
          <Link href="/trial" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-r from-emerald-300 to-amber-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition-opacity hover:opacity-90 sm:px-4">
            Start beta
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div id="mobile-menu" className="space-y-3 border-t border-white/5 px-4 py-4 md:hidden" style={{ background: 'rgba(9,9,11,0.97)' }}>
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)} className="block text-sm text-zinc-400 transition-colors hover:text-white">
              {link.label}
            </a>
          ))}
          <a href="#jak-shield" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-rose-200 transition-colors hover:text-white">
            JAK Shield
          </a>
          <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="block border-t border-white/5 pt-3 text-sm text-zinc-300 transition-colors hover:text-white">
            Sign in
          </Link>
        </div>
      ) : null}
    </nav>
  );
}
