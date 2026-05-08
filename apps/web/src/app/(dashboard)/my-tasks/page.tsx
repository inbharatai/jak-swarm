'use client';

/**
 * /my-tasks — the human-side of the JAK wedge.
 *
 * Renders three sections, all addressed to the calling user:
 *   1. Tasks assigned to me  (TaskAssignment with status PENDING / ACKNOWLEDGED)
 *   2. Approvals waiting on me (existing /approvals?status=PENDING — REVIEWER+ only)
 *   3. Notifications          (unread, sorted desc)
 *
 * One round-trip via /inbox (the aggregated inbox endpoint).
 */

import React, { useState } from 'react';
import useSWR from 'swr';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Bell,
  Loader2,
  Inbox as InboxIcon,
  Shield,
} from 'lucide-react';
import { Card, CardContent, Button, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dataFetcher, taskAssignmentApi, inboxApi } from '@/lib/api-client';

interface TaskAssignment {
  id: string;
  workflowId: string;
  taskId: string;
  title: string;
  instructions: string | null;
  status: string;
  riskLevel: string;
  dueAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

interface Approval {
  id: string;
  workflowId: string;
  taskId: string;
  agentRole: string;
  action: string;
  rationale: string;
  riskLevel: string;
  createdAt: string;
}

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  createdAt: string;
}

interface InboxPayload {
  ok: true;
  data: {
    tasks: TaskAssignment[];
    approvals: Approval[];
    notifications: Notification[];
    counts: { tasks: number; approvals: number; notifications: number; total: number };
  };
}

const RISK_BADGE: Record<string, string> = {
  READ_ONLY: 'bg-green-50 text-green-700 border-green-200',
  DRAFT_ONLY: 'bg-blue-50 text-blue-700 border-blue-200',
  SANDBOX_EDIT: 'bg-amber-50 text-amber-700 border-amber-200',
  LOCAL_EXEC_ALLOWLIST: 'bg-orange-50 text-orange-700 border-orange-200',
  EXTERNAL_ACTION_APPROVAL: 'bg-rose-50 text-rose-700 border-rose-200',
  CRITICAL_MANUAL_ONLY: 'bg-red-100 text-red-800 border-red-300',
  LOW: 'bg-green-50 text-green-700 border-green-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  HIGH: 'bg-rose-50 text-rose-700 border-rose-200',
  CRITICAL: 'bg-red-100 text-red-800 border-red-300',
};

export default function MyTasksPage() {
  const { data, error, mutate, isLoading } = useSWR<InboxPayload>(
    '/inbox',
    dataFetcher,
    { refreshInterval: 10_000 },
  );
  const toast = useToast();
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8 text-center text-rose-700">
        Failed to load inbox. Try refreshing.
      </div>
    );
  }

  const inbox = data?.data;
  const tasks = inbox?.tasks ?? [];
  const approvals = inbox?.approvals ?? [];
  const notifications = inbox?.notifications ?? [];

  async function handleComplete(taskId: string) {
    try {
      await taskAssignmentApi.complete(taskId, { note: noteDraft || undefined });
      toast.success('Task completed');
      setCompletingId(null);
      setNoteDraft('');
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to complete task');
    }
  }

  async function handleDecline(taskId: string) {
    const reason = window.prompt('Reason for declining? (required)');
    if (!reason || !reason.trim()) return;
    try {
      await taskAssignmentApi.decline(taskId, reason.trim());
      toast.success('Task declined');
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to decline task');
    }
  }

  async function handleAcknowledge(taskId: string) {
    try {
      await taskAssignmentApi.acknowledge(taskId);
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to acknowledge');
    }
  }

  async function markAllRead() {
    try {
      await inboxApi.markAllRead();
      mutate();
    } catch {
      // silent
    }
  }

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <InboxIcon className="h-6 w-6" /> My Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tasks, approvals, and notifications waiting on you.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <span className="px-2 py-1 rounded bg-muted">{inbox?.counts.tasks ?? 0} tasks</span>
          <span className="px-2 py-1 rounded bg-muted">{inbox?.counts.approvals ?? 0} approvals</span>
          <span className="px-2 py-1 rounded bg-muted">{inbox?.counts.notifications ?? 0} unread</span>
        </div>
      </header>

      {/* Section 1 — Tasks assigned to me */}
      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Tasks assigned to you
        </h2>
        {tasks.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No tasks assigned to you right now.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <Card key={task.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium truncate">{task.title}</h3>
                        <span
                          className={`text-xs px-2 py-0.5 rounded border ${
                            RISK_BADGE[task.riskLevel] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                          }`}
                        >
                          {task.riskLevel}
                        </span>
                        {task.status === 'ACKNOWLEDGED' && (
                          <span className="text-xs text-blue-700">acknowledged</span>
                        )}
                      </div>
                      {task.instructions && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {task.instructions}
                        </p>
                      )}
                      <div className="text-xs text-muted-foreground mt-2 flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(task.createdAt).toLocaleString()}
                        </span>
                        {task.dueAt && (
                          <span className="text-amber-700">
                            due {new Date(task.dueAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>

                      {completingId === task.id && (
                        <div className="mt-3 space-y-2">
                          <Textarea
                            placeholder="Optional note (what did you do?)"
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                            className="text-sm"
                            rows={2}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleComplete(task.id)}>
                              Confirm complete
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setCompletingId(null);
                                setNoteDraft('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    {completingId !== task.id && (
                      <div className="flex flex-col gap-2 shrink-0">
                        {task.status === 'PENDING' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAcknowledge(task.id)}
                          >
                            Acknowledge
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => setCompletingId(task.id)}
                          className="gap-1"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Complete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDecline(task.id)}
                          className="text-rose-700 hover:text-rose-800 gap-1"
                        >
                          <XCircle className="h-3 w-3" /> Decline
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Section 2 — Approvals (only rendered when REVIEWER+ has them) */}
      {approvals.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
            <Shield className="h-4 w-4" /> Approvals waiting on you
          </h2>
          <div className="space-y-2">
            {approvals.map((a) => (
              <Card key={a.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium">
                        {a.agentRole}: {a.action}
                      </h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {a.rationale}
                      </p>
                      <span
                        className={`text-xs px-2 py-0.5 rounded border mt-2 inline-block ${
                          RISK_BADGE[a.riskLevel] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                        }`}
                      >
                        {a.riskLevel}
                      </span>
                    </div>
                    <a
                      href={`/audit/runs?approvalId=${a.id}`}
                      className="text-sm text-primary hover:underline shrink-0"
                    >
                      Review →
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Section 3 — Notifications */}
      {notifications.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Bell className="h-4 w-4" /> Notifications
            </h2>
            <Button size="sm" variant="ghost" onClick={markAllRead}>
              Mark all read
            </Button>
          </div>
          <div className="space-y-1">
            {notifications.map((n) => (
              <a
                key={n.id}
                href={n.linkPath ?? '#'}
                className="block p-3 rounded border hover:bg-muted/50 transition-colors"
                onClick={() => inboxApi.markRead(n.id).catch(() => undefined)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{n.title}</div>
                    {n.body && (
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {n.body}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {new Date(n.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
