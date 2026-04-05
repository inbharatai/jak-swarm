'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Bell,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Badge, EmptyState, Spinner, Textarea } from '@/components/ui';
import type { ApprovalRequest, RiskLevel } from '@/types';
import { approvalApi } from '@/lib/api-client';
import { formatDistanceToNow } from 'date-fns';

const RISK_CONFIG: Record<RiskLevel, { label: string; className: string; variant: 'success' | 'warning' | 'destructive' | 'default' }> = {
  LOW: { label: 'Low Risk', className: 'border-green-200 bg-green-50 dark:bg-green-900/10', variant: 'success' },
  MEDIUM: { label: 'Medium Risk', className: 'border-yellow-200 bg-yellow-50 dark:bg-yellow-900/10', variant: 'warning' },
  HIGH: { label: 'High Risk', className: 'border-orange-200 bg-orange-50 dark:bg-orange-900/10', variant: 'destructive' },
  CRITICAL: { label: 'Critical Risk', className: 'border-red-300 bg-red-50 dark:bg-red-900/20', variant: 'destructive' },
};

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('Expired');
        return;
      }
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      setRemaining(minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const isUrgent = new Date(expiresAt).getTime() - Date.now() < 60_000;

  return (
    <div className={cn('flex items-center gap-1 text-xs', isUrgent ? 'text-destructive' : 'text-muted-foreground')}>
      <Clock className="h-3 w-3" />
      <span>{remaining}</span>
    </div>
  );
}

function DiffView({ current, proposed }: { current?: Record<string, unknown>; proposed: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <ChevronRight className="h-3 w-3" />
        View proposed changes
      </button>
    );
  }

  const keys = Array.from(new Set([
    ...Object.keys(current ?? {}),
    ...Object.keys(proposed),
  ]));

  return (
    <div>
      <button
        onClick={() => setExpanded(false)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
      >
        <ChevronDown className="h-3 w-3" />
        Hide changes
      </button>
      <div className="rounded border bg-muted/30 p-3 font-mono text-xs space-y-1 max-h-40 overflow-y-auto">
        {keys.map(key => {
          const oldVal = current?.[key];
          const newVal = proposed[key];
          const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);

          return (
            <div key={key} className={cn('flex gap-2', changed && 'rounded bg-yellow-500/10')}>
              <span className="text-muted-foreground">{key}:</span>
              {changed && oldVal !== undefined && (
                <span className="text-destructive line-through">{JSON.stringify(oldVal)}</span>
              )}
              <span className={changed ? 'text-green-600 dark:text-green-400' : ''}>
                {JSON.stringify(newVal)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ApprovalCardProps {
  approval: ApprovalRequest;
  onRefresh: () => void;
}

function ApprovalCard({ approval, onRefresh }: ApprovalCardProps) {
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState<'approve' | 'reject' | 'defer' | null>(null);
  const riskConfig = RISK_CONFIG[approval.riskLevel];

  const handleAction = useCallback(async (action: 'approve' | 'reject' | 'defer') => {
    setIsSubmitting(action);
    try {
      if (action === 'approve') {
        await approvalApi.approve(approval.id, comment || undefined);
      } else if (action === 'reject') {
        await approvalApi.reject(approval.id, comment || undefined);
      } else {
        await approvalApi.defer(approval.id);
      }
      onRefresh();
    } catch {
      // ignore
    } finally {
      setIsSubmitting(null);
    }
  }, [approval.id, comment, onRefresh]);

  return (
    <div className={cn('rounded-xl border p-4 space-y-3', riskConfig.className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className={cn(
            'h-4 w-4 shrink-0',
            approval.riskLevel === 'CRITICAL' ? 'text-red-500' :
            approval.riskLevel === 'HIGH' ? 'text-orange-500' :
            approval.riskLevel === 'MEDIUM' ? 'text-yellow-500' : 'text-green-500',
          )} />
          <Badge variant={riskConfig.variant} className="text-xs">
            {riskConfig.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {approval.expiresAt && (
            <CountdownTimer expiresAt={approval.expiresAt} />
          )}
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(approval.requestedAt ?? approval.createdAt), { addSuffix: true })}
          </span>
        </div>
      </div>

      {/* Agent + action */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary" className="text-xs font-mono">{approval.agentRole}</Badge>
          <span className="text-xs text-muted-foreground">is requesting approval</span>
        </div>
        <p className="text-sm font-medium">{approval.action}</p>
      </div>

      {/* Rationale */}
      <div className="rounded bg-background/60 px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground mb-1">Rationale</p>
        <p className="text-sm">{approval.rationale}</p>
      </div>

      {/* Diff view — only shown when the API returns proposed changes */}
      {approval.proposedData && (
        <DiffView current={approval.currentData} proposed={approval.proposedData} />
      )}

      {/* Comment section */}
      {showComment && (
        <Textarea
          placeholder="Add a comment (optional)…"
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={2}
          className="text-sm"
        />
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => handleAction('approve')}
          disabled={!!isSubmitting}
          className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
        >
          {isSubmitting === 'approve' ? (
            <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Approve
        </Button>

        <Button
          size="sm"
          variant="destructive"
          onClick={() => handleAction('reject')}
          disabled={!!isSubmitting}
          className="gap-1.5"
        >
          {isSubmitting === 'reject' ? (
            <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          Reject
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => handleAction('defer')}
          disabled={!!isSubmitting}
          className="gap-1.5"
        >
          <Clock className="h-3.5 w-3.5" />
          Defer
        </Button>

        <button
          onClick={() => setShowComment(!showComment)}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {showComment ? 'Hide comment' : 'Add comment'}
        </button>
      </div>
    </div>
  );
}

interface ApprovalsInboxProps {
  approvals: ApprovalRequest[];
  isLoading?: boolean;
  onRefresh: () => void;
  className?: string;
}

export function ApprovalsInbox({
  approvals,
  isLoading,
  onRefresh,
  className,
}: ApprovalsInboxProps) {
  const pendingApprovals = approvals.filter(a => a.status === 'PENDING');

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Approvals Inbox</span>
        {pendingApprovals.length > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {pendingApprovals.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : pendingApprovals.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="No pending approvals"
          description="Actions requiring your review will appear here"
        />
      ) : (
        <div className="space-y-3">
          {pendingApprovals.map(approval => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
