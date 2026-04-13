'use client';

import React from 'react';
import { ArrowRight, LayoutDashboard, Plug, Zap } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button, Badge } from '@/components/ui';
import { ActivityFeed } from '@/components/home/ActivityFeed';
import { QuickActions } from '@/components/home/QuickActions';
import { IntegrationHealthWidget } from '@/components/home/IntegrationHealthWidget';
import { ApprovalsSummary } from '@/components/home/ApprovalsSummary';
import { RunningWorkflowsWidget } from '@/components/home/RunningWorkflowsWidget';
import type { ModuleProps } from '@/modules/registry';
import { useShellStore } from '@/store/shell-store';

export default function DashboardHomeModule({ moduleId, isActive }: ModuleProps) {
  const { user } = useAuth();
  const openModule = useShellStore(s => s.openModule);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="relative flex-1 overflow-auto p-5 space-y-6 lg:p-6">
      <section className="grid gap-6 rounded-[28px] border border-border/60 bg-gradient-to-br from-background via-background to-muted/30 p-6 shadow-sm lg:grid-cols-[minmax(0,1.35fr)_360px]">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Zap className="h-3.5 w-3.5" />
            Overview
          </div>
          <h1 className="mt-2 text-3xl font-display font-bold tracking-tight text-balance">
            {greeting()}{user?.name ? <><span className="text-muted-foreground">,</span> <span className="gradient-text"> {user.name.split(' ')[0]}</span></> : ''}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Start in the command center, keep approvals visible, and jump straight into the integrations or knowledge tools that need attention.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button className="gap-1.5" onClick={() => openModule('command-center')}>
              <LayoutDashboard className="h-4 w-4" />
              Open Command Center
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => openModule('integrations')}>
              <Plug className="h-4 w-4" />
              Review Integrations
            </Button>
            <Button variant="ghost" className="gap-1.5" onClick={() => openModule('knowledge')}>
              Knowledge Base
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary/80">Today&apos;s Focus</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">Keep work moving without switching contexts.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Use the activity feed for what changed, and keep the right rail reserved for approvals, quick starts, and workflow health.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {user?.industry && <Badge variant="secondary">{user.industry.replace(/_/g, ' ')}</Badge>}
            {user?.jobFunction && <Badge variant="outline">{user.jobFunction}</Badge>}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Live Activity</p>
          <div className="mt-3">
            <ActivityFeed />
          </div>
        </div>

        <aside className="space-y-4">
          <QuickActions jobFunction={user?.jobFunction} />
          <ApprovalsSummary />
          <RunningWorkflowsWidget />
          <IntegrationHealthWidget />
        </aside>
      </div>
    </div>
  );
}
