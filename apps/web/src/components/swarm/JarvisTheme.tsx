'use client';

// ─── JARVIS Inspector — scoped dark surface wrapper ──────────────────────────
//
// Wraps the inspector in `.jarvis-surface`, which forces `color-scheme: dark`
// and overrides the theme CSS vars LOCALLY (see globals.css) so the rest of
// the app keeps its light/dark toggle. Independent of next-themes. No flash:
// this is a client component that renders the dark surface class on its root
// before its children mount, so the inspector never paints light-first.

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function JarvisTheme({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('jarvis-surface dark w-full p-3 sm:p-4', className)}>
      {children}
    </div>
  );
}