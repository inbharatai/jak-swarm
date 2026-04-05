import * as React from 'react';
import { cn } from '@/lib/cn';

interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'default' | 'lg';
}

const sizeMap = {
  sm: 'h-4 w-4 border-2',
  default: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-3',
};

export function Spinner({ size = 'default', className, ...props }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        'animate-spin rounded-full border-muted border-t-primary',
        sizeMap[size],
        className,
      )}
      {...props}
    />
  );
}
