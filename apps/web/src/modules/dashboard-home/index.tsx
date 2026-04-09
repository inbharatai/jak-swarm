'use client';

import React from 'react';
import { useAuth } from '@/lib/auth';
import { ActivityFeed } from '@/components/home/ActivityFeed';
import { QuickActions } from '@/components/home/QuickActions';
import { IntegrationHealthWidget } from '@/components/home/IntegrationHealthWidget';
import { ApprovalsSummary } from '@/components/home/ApprovalsSummary';
import { RunningWorkflowsWidget } from '@/components/home/RunningWorkflowsWidget';
import type { ModuleProps } from '@/modules/registry';

export default function DashboardHomeModule({ moduleId, isActive }: ModuleProps) {
  const { user } = useAuth();

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="relative flex-1 overflow-auto p-6 space-y-6">
      {/* Header */}
      <div className="relative z-10">
        <h1 className="text-2xl font-display font-bold">
          {greeting()}{user?.name ? <><span className="text-muted-foreground">,</span> <span className="gradient-text">{user.name.split(' ')[0]}</span></> : ''}
        </h1>
        <p className="text-muted-foreground text-sm mt-1 font-sans">
          Here&apos;s what&apos;s happening with your workspace
        </p>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Queue */}
        <div className="lg:col-span-3 space-y-4">
          <ApprovalsSummary />
          <RunningWorkflowsWidget />
        </div>

        {/* Center: Activity Feed */}
        <div className="lg:col-span-5">
          <ActivityFeed />
        </div>

        {/* Right: Actions + Health */}
        <div className="lg:col-span-4 space-y-4">
          <QuickActions jobFunction={user?.jobFunction} />
          <IntegrationHealthWidget />
        </div>
      </div>
    </div>
  );
}
