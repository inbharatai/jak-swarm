'use client';

import { cn } from '@/lib/cn';

interface ProfileGateSkeletonProps {
  compact?: boolean;
  className?: string;
}

export function ProfileGateSkeleton({ compact = false, className }: ProfileGateSkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-lg border border-border/60 bg-muted/30',
        compact ? 'h-10 w-10' : 'h-24 w-full',
        className,
      )}
      aria-hidden="true"
    />
  );
}
