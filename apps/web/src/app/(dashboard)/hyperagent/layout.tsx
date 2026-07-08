/**
 * HyperAgent Control Centre layout (Phase 13).
 *
 * Sub-nav across the 9 control-centre routes. The control centre is an
 * OPERATIONAL dashboard over real backend data only — every page renders
 * real rows or an honest empty state, never a fabricated "all healthy".
 */
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const NAV: Array<{ href: string; label: string }> = [
  { href: '/hyperagent', label: 'Overview' },
  { href: '/hyperagent/runs', label: 'Runs' },
  { href: '/hyperagent/learnings', label: 'Learnings' },
  { href: '/hyperagent/optimizations', label: 'Optimizations' },
  { href: '/hyperagent/experiments', label: 'Experiments' },
  { href: '/hyperagent/governance', label: 'Governance' },
  { href: '/hyperagent/agent-fleet', label: 'Agent Fleet' },
  { href: '/hyperagent/autonomy', label: 'Autonomy' },
  { href: '/hyperagent/shield', label: 'Shield' },
];

export default function HyperAgentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">HyperAgent Control Centre</h2>
        <p className="text-sm text-muted-foreground">
          Operational dashboard over real backend data. Empty states mean no rows yet — never &quot;all healthy&quot;.
        </p>
      </div>
      <nav className="flex flex-wrap gap-1 border-b">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}