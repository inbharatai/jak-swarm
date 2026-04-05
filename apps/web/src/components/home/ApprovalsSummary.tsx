'use client';

import React from 'react';
import useSWR from 'swr';
import { formatDistanceToNow } from 'date-fns';
import { ShieldCheck, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { fetcher, approvalApi } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, EmptyState } from '@/components/ui';
import type { ApprovalRequest } from '@/types';

export function ApprovalsSummary() {
  const { data, isLoading, mutate } = useSWR<ApprovalRequest[]>(
    '/approvals?status=PENDING',
    fetcher,
    { refreshInterval: 10000 },
  );

  const approvals = Array.isArray(data) ? data : [];
  const topThree = approvals.slice(0, 3);

  const handleDecision = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      await approvalApi.decide(id, decision);
      mutate();
    } catch {
      // silently fail — user will see state hasn't changed
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Pending Approvals
          {approvals.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {approvals.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : approvals.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title="No pending approvals"
            description="You're all caught up"
          />
        ) : (
          <div className="space-y-3">
            {topThree.map((approval) => (
              <div key={approval.id} className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium leading-snug">{approval.action}</p>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      approval.riskLevel === 'CRITICAL' || approval.riskLevel === 'HIGH'
                        ? 'destructive'
                        : 'secondary'
                    }
                    className="text-xs"
                  >
                    {approval.riskLevel}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(approval.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs gap-1"
                    onClick={() => handleDecision(approval.id, 'APPROVED')}
                  >
                    <CheckCircle className="h-3 w-3" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => handleDecision(approval.id, 'REJECTED')}
                  >
                    <XCircle className="h-3 w-3" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
            {approvals.length > 3 && (
              <p className="text-center text-xs text-muted-foreground">
                +{approvals.length - 3} more pending
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
