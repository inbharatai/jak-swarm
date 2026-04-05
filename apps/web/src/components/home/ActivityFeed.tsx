'use client';

import React from 'react';
import useSWR from 'swr';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  PlayCircle,
  PauseCircle,
} from 'lucide-react';
import { fetcher } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent, Badge, EmptyState } from '@/components/ui';
import type { Workflow, WorkflowStatus, PaginatedResult } from '@/types';

const STATUS_CONFIG: Record<WorkflowStatus, { icon: React.ElementType; color: string; label: string }> = {
  COMPLETED: { icon: CheckCircle2, color: 'text-green-500', label: 'Completed' },
  FAILED: { icon: XCircle, color: 'text-red-500', label: 'Failed' },
  RUNNING: { icon: PlayCircle, color: 'text-blue-500', label: 'Running' },
  PENDING: { icon: Clock, color: 'text-yellow-500', label: 'Pending' },
  PAUSED: { icon: PauseCircle, color: 'text-orange-500', label: 'Paused' },
  CANCELLED: { icon: XCircle, color: 'text-muted-foreground', label: 'Cancelled' },
};

export function ActivityFeed() {
  const { data, isLoading } = useSWR<PaginatedResult<Workflow>>(
    '/workflows?limit=10',
    fetcher,
    { refreshInterval: 15000 },
  );

  const workflows = data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : workflows.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title="No activity yet"
            description="Submit a task to get started"
          />
        ) : (
          <div className="space-y-3">
            {workflows.map((wf) => {
              const cfg = STATUS_CONFIG[wf.status] ?? STATUS_CONFIG.PENDING;
              const Icon = cfg.icon;
              return (
                <div
                  key={wf.id}
                  className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50"
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.color}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug truncate">
                      {wf.goal}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {cfg.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(wf.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
