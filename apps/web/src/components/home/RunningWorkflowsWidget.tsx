'use client';

import React from 'react';
import useSWR from 'swr';
import { formatDistanceToNow } from 'date-fns';
import { PlayCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { dataFetcher } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent, Badge, Spinner, EmptyState } from '@/components/ui';
import type { Workflow, PaginatedResult } from '@/types';

export function RunningWorkflowsWidget() {
  const { data, isLoading } = useSWR<PaginatedResult<Workflow>>(
    '/workflows?status=RUNNING&limit=5',
    dataFetcher,
    { refreshInterval: 5000 },
  );

  const workflows = data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlayCircle className="h-4 w-4" />
          Running Workflows
          {workflows.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {workflows.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : workflows.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="All clear"
            description="No running workflows"
          />
        ) : (
          <div className="space-y-3">
            {workflows.map((wf) => (
              <div key={wf.id} className="flex items-start gap-3 rounded-lg border p-3">
                <Spinner className="mt-0.5 h-4 w-4" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug truncate">
                    {wf.goal}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    Started{' '}
                    {wf.startedAt
                      ? formatDistanceToNow(new Date(wf.startedAt), { addSuffix: true })
                      : formatDistanceToNow(new Date(wf.createdAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
