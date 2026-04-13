'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  Mic,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  Radio,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Workflow,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/cn';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { CommandInput } from '@/components/workspace/CommandInput';
import { PlanView } from '@/components/workspace/PlanView';
import { WorkflowDAG } from '@/components/graph/WorkflowDAG';
import { TaskList } from '@/components/workspace/TaskList';
import { ApprovalsInbox } from '@/components/workspace/ApprovalsInbox';
import { AgentTracker } from '@/components/workspace/AgentTracker';
import { TranscriptPanel } from '@/components/voice/TranscriptPanel';
import { VoiceInput } from '@/components/voice/VoiceInput';
import { useWorkflow, useActiveWorkflows, useApprovals } from '@/hooks/useWorkflow';
import { useWorkflowStream } from '@/hooks/useWorkflowStream';
import { useVoice } from '@/hooks/useVoice';
import { workflowApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { eventBus, SHELL_EVENTS } from '@/lib/event-bus';
import type { Industry } from '@/types';

interface WorkspaceDashboardProps {
  title: string;
  moduleId?: string;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: 'default' | 'primary' | 'warning';
}) {
  return (
    <div className={cn(
      'rounded-2xl border px-4 py-3',
      tone === 'primary' && 'border-primary/30 bg-primary/5',
      tone === 'warning' && 'border-amber-500/30 bg-amber-500/5',
    )}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  meta,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="border-b pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icon className="h-4 w-4" />
              <span>{title}</span>
            </CardTitle>
            {meta && <div className="mt-1 text-xs text-muted-foreground">{meta}</div>}
          </div>
          {actions}
        </div>
      </CardHeader>
      <CardContent className={cn('min-h-0 p-4', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function WorkspaceDashboard({ title, moduleId }: WorkspaceDashboardProps) {
  const { user } = useAuth();
  const toast = useToast();
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [planViewMode, setPlanViewMode] = useState<'graph' | 'list'>('graph');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { latestEvent, isConnected } = useWorkflowStream(activeWorkflowId);
  const { workflow, isLoading: workflowLoading, refresh: refreshWorkflow } = useWorkflow(activeWorkflowId, { disablePolling: isConnected });
  const { workflows: activeWorkflows } = useActiveWorkflows();
  const { approvals, pendingCount, isLoading: approvalsLoading, refresh: refreshApprovals } = useApprovals();
  const voice = useVoice();

  useEffect(() => {
    if (latestEvent && isConnected) {
      refreshWorkflow();
    }
  }, [latestEvent, isConnected, refreshWorkflow]);

  const handleSubmit = useCallback(async (command: string, industry: Industry) => {
    setIsSubmitting(true);
    try {
      const result = await workflowApi.create(command, industry) as { id: string };
      setActiveWorkflowId(result.id);
      refreshWorkflow();
      if (moduleId) {
        eventBus.emit(SHELL_EVENTS.WORKFLOW_STARTED, { workflowId: result.id, goal: command }, moduleId);
      }
    } catch (err) {
      toast.error('Failed to create workflow', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [moduleId, refreshWorkflow, toast]);

  const handleVoiceTranscript = useCallback((text: string) => {
    handleSubmit(text, user?.industry ?? 'TECHNOLOGY');
    setInputMode('text');
  }, [handleSubmit, user?.industry]);

  const handleStopAll = async () => {
    if (!confirm('Stop all running workflows?')) return;
    try {
      await workflowApi.stopAll();
      refreshWorkflow();
    } catch (err) {
      toast.error('Failed to stop workflows', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  const tasks = workflow?.plan?.steps ?? [];
  const activeTaskCount = tasks.filter(task => task.status === 'IN_PROGRESS' || task.status === 'AWAITING_APPROVAL').length;
  const isWorkflowRunning = workflow?.status === 'RUNNING' || workflow?.status === 'PENDING';
  const subtitle = workflow?.goal
    ? `Focused on “${workflow.goal}”`
    : 'Plan, run, approve, and monitor work from one place.';

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4 lg:p-5">
      <section className="rounded-[28px] border border-border/60 bg-gradient-to-br from-background via-background to-muted/30 px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Control Surface
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-balance">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {activeWorkflows.length > 0 && (
              <Button variant="destructive" size="sm" onClick={handleStopAll} className="gap-1.5">
                <StopCircle className="h-3.5 w-3.5" />
                Stop All ({activeWorkflows.length})
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setActiveWorkflowId(null)} className="gap-1.5">
              <PlusCircle className="h-3.5 w-3.5" />
              New Command
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Workflow} label="Active Workflows" value={String(activeWorkflows.length)} tone={activeWorkflows.length > 0 ? 'primary' : 'default'} />
          <MetricCard icon={ShieldCheck} label="Pending Approvals" value={String(pendingCount)} tone={pendingCount > 0 ? 'warning' : 'default'} />
          <MetricCard icon={Activity} label="Selected Workflow" value={workflow?.status ? workflow.status.toLowerCase() : 'idle'} />
          <MetricCard icon={Radio} label="Live Stream" value={isConnected ? 'connected' : 'standby'} tone={isConnected ? 'primary' : 'default'} />
        </div>
      </section>

      <div className="grid flex-1 min-h-0 gap-4 xl:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.25fr)_minmax(300px,0.9fr)]">
        <div className="flex min-h-0 flex-col gap-4">
          <SectionCard
            title="Command Composer"
            icon={inputMode === 'text' ? FileText : Mic}
            meta="Start with a clear goal, then switch to voice when you want hands-free capture."
            actions={
              <div className="flex rounded-lg border bg-muted/30 p-1">
                <button
                  type="button"
                  aria-pressed={inputMode === 'text'}
                  aria-label="Use text command input"
                  onClick={() => setInputMode('text')}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    inputMode === 'text' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Text
                </button>
                <button
                  type="button"
                  aria-pressed={inputMode === 'voice'}
                  aria-label="Use voice command input"
                  onClick={() => setInputMode('voice')}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    inputMode === 'voice' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Voice
                </button>
              </div>
            }
          >
            {inputMode === 'text' ? (
              <CommandInput
                onSubmit={handleSubmit}
                defaultIndustry={user?.industry ?? 'TECHNOLOGY'}
                isLoading={isSubmitting || isWorkflowRunning}
                onVoiceMode={() => setInputMode('voice')}
              />
            ) : (
              <VoiceInput onTranscript={handleVoiceTranscript} />
            )}
          </SectionCard>

          <SectionCard title="Recent Workflows" icon={PlayCircle} meta="Jump back into active or recently finished runs." className="flex-1 min-h-0" contentClassName="min-h-0 overflow-y-auto p-0">
            {activeWorkflows.length === 0 ? (
              <div className="px-4 py-6">
                <EmptyState title="No active workflows" description="Submit a command above to start." />
              </div>
            ) : (
              <div className="divide-y">
                {activeWorkflows.slice(0, 6).map(wf => (
                  <button
                    key={wf.id}
                    type="button"
                    onClick={() => setActiveWorkflowId(wf.id)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      activeWorkflowId === wf.id && 'bg-primary/5',
                    )}
                  >
                    <div className="mt-0.5 shrink-0">
                      {wf.status === 'RUNNING' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      ) : wf.status === 'COMPLETED' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <StopCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{wf.goal}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(wf.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <Badge
                      variant={wf.status === 'COMPLETED' ? 'success' : wf.status === 'FAILED' ? 'destructive' : 'default'}
                      className="shrink-0 text-[10px] capitalize"
                    >
                      {wf.status.toLowerCase()}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Transcript" icon={Mic} meta="Voice capture stays here while you work." className="min-h-[260px]" contentClassName="p-0">
            <TranscriptPanel
              segments={voice.transcript}
              partialTranscript={voice.partialTranscript}
              isListening={voice.isListening}
              className="min-h-[260px] border-0 rounded-none"
            />
          </SectionCard>
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <SectionCard
            title="Execution Plan"
            icon={Workflow}
            meta={
              isConnected && latestEvent ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  Live updates streaming
                </span>
              ) : workflow?.goal ? workflow.goal : 'Generate a plan from the command composer.'
            }
            className="flex-1 min-h-0"
            contentClassName="min-h-0 overflow-y-auto"
            actions={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="flex rounded-md border bg-muted/30 p-0.5">
                  <button
                    type="button"
                    aria-label="Show execution plan as graph"
                    onClick={() => setPlanViewMode('graph')}
                    className={cn(
                      'rounded px-2.5 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      planViewMode === 'graph' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Graph
                  </button>
                  <button
                    type="button"
                    aria-label="Show execution plan as list"
                    onClick={() => setPlanViewMode('list')}
                    className={cn(
                      'rounded px-2.5 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      planViewMode === 'list' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    List
                  </button>
                </div>

                {workflow?.status && (
                  <Badge
                    variant={
                      workflow.status === 'COMPLETED' ? 'success' :
                      workflow.status === 'FAILED' ? 'destructive' :
                      workflow.status === 'PAUSED' ? 'warning' :
                      'default'
                    }
                    className="text-[10px] capitalize"
                  >
                    {workflow.status === 'PAUSED' ? 'Awaiting Approval' : workflow.status.toLowerCase()}
                  </Badge>
                )}

                {workflow?.status === 'RUNNING' && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={async () => {
                        try {
                          await workflowApi.pause(workflow.id);
                          refreshWorkflow();
                        } catch (err) {
                          toast.error('Failed to pause workflow', err instanceof Error ? err.message : 'Please try again.');
                        }
                      }}
                    >
                      <PauseCircle className="h-3.5 w-3.5" />
                      Pause
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={async () => {
                        try {
                          await workflowApi.stop(workflow.id);
                          refreshWorkflow();
                        } catch (err) {
                          toast.error('Failed to stop workflow', err instanceof Error ? err.message : 'Please try again.');
                        }
                      }}
                    >
                      <StopCircle className="h-3.5 w-3.5" />
                      Stop
                    </Button>
                  </>
                )}

                {workflow?.status === 'PAUSED' && (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={async () => {
                      try {
                        await workflowApi.unpause(workflow.id);
                        refreshWorkflow();
                      } catch (err) {
                        toast.error('Failed to resume workflow', err instanceof Error ? err.message : 'Please try again.');
                      }
                    }}
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    Resume
                  </Button>
                )}
              </div>
            }
          >
            {planViewMode === 'graph' ? (
              <WorkflowDAG plan={workflow?.plan} workflowStatus={workflow?.status} className="h-full" />
            ) : (
              <PlanView plan={workflow?.plan} isLoading={workflowLoading && !!activeWorkflowId} />
            )}
          </SectionCard>

          <SectionCard
            title="Task Queue"
            icon={Activity}
            meta={activeTaskCount > 0 ? `${activeTaskCount} tasks are actively running.` : 'Tasks appear here as soon as the plan starts executing.'}
            contentClassName="max-h-[320px] overflow-y-auto"
          >
            <TaskList
              tasks={tasks}
              workflowId={activeWorkflowId ?? undefined}
              isLoading={workflowLoading && !!activeWorkflowId}
            />
          </SectionCard>
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <SectionCard
            title="Approvals Inbox"
            icon={ShieldCheck}
            meta={pendingCount > 0 ? `${pendingCount} approvals are waiting on you.` : 'No approvals are blocking execution right now.'}
            className="flex-1 min-h-0"
            contentClassName="min-h-0 overflow-y-auto"
            actions={pendingCount > 0 ? <Badge variant="warning" className="text-[10px]">{pendingCount} pending</Badge> : undefined}
          >
            <ApprovalsInbox approvals={approvals} isLoading={approvalsLoading} onRefresh={refreshApprovals} />
          </SectionCard>

          <SectionCard
            title="Agent Activity"
            icon={Bot}
            meta={workflow ? 'Track which agent is currently executing the selected workflow.' : 'Select a workflow to inspect the assigned agents.'}
          >
            {workflow ? (
              <AgentTracker workflowId={workflow.id} />
            ) : (
              <EmptyState title="No workflow selected" description="Choose a recent workflow to inspect agent activity." />
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}