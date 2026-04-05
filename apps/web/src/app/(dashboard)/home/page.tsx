'use client';

import React from 'react';
import { useAuth } from '@/lib/auth';
import { ActivityFeed } from '@/components/home/ActivityFeed';
import { QuickActions } from '@/components/home/QuickActions';
import { IntegrationHealthWidget } from '@/components/home/IntegrationHealthWidget';
import { ApprovalsSummary } from '@/components/home/ApprovalsSummary';
import { RunningWorkflowsWidget } from '@/components/home/RunningWorkflowsWidget';

export default function HomePage() {
  const { user } = useAuth();

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          {greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
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
