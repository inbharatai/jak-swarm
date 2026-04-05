'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowRight } from 'lucide-react';
import { QUICK_ACTIONS } from '@/lib/templates';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import type { JobFunction } from '@/types';

interface QuickActionsProps {
  jobFunction?: JobFunction;
}

export function QuickActions({ jobFunction }: QuickActionsProps) {
  const router = useRouter();
  const role = jobFunction ?? 'OTHER';
  const actions = QUICK_ACTIONS[role] ?? QUICK_ACTIONS.OTHER;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          Quick Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {actions.map((action) => (
          <button
            key={action.template}
            onClick={() => router.push(`/workspace?template=${action.template}`)}
            className="group flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{action.label}</p>
              <p className="text-xs text-muted-foreground">{action.description}</p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
