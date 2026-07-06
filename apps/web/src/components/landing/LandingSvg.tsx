// A.4 — shared SVG primitives for the marketing landing.
//
// No `'use client'` here: these are pure presentational components with no
// hooks, so they can be rendered by the Server Component page *and* imported
// by the client-side nav island without duplication. The JAK wordmark,
// arrows, check, and GitHub mark appear in both the nav and the footer.

export function JakLogo({ className = '', size = 40 }: { className?: string; size?: number }) {
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

export function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}