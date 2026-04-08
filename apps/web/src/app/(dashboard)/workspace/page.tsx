'use client';

import React, { useState, useCallback } from 'react';
import { PlusCircle, StopCircle, CheckCircle2, Loader2, FileText } from 'lucide-react';
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
import type { Industry } from '@/types';
import { formatDistanceToNow } from 'date-fns';

export default function WorkspacePage() {
  const { user } = useAuth();
  const toast = useToast();
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [planViewMode, setPlanViewMode] = useState<'graph' | 'list'>('graph');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { workflow, isLoading: workflowLoading, refresh: refreshWorkflow } = useWorkflow(activeWorkflowId);
  const { workflows: activeWorkflows } = useActiveWorkflows();
  const { approvals, pendingCount, isLoading: approvalsLoading, refresh: refreshApprovals } = useApprovals();

  const { latestEvent, isConnected } = useWorkflowStream(activeWorkflowId);
  const voice = useVoice();

  const handleSubmit = useCallback(async (command: string, industry: Industry) => {
    setIsSubmitting(true);
    try {
      const result = await workflowApi.create(command, industry) as { id: string };
      setActiveWorkflowId(result.id);
      refreshWorkflow();
    } catch (err) {
      toast.error('Failed to create workflow', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [refreshWorkflow]);

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
  const hasActiveWorkflow = !!activeWorkflowId && !!workflow;
  const isWorkflowRunning = workflow?.status === 'RUNNING' || workflow?.status === 'PENDING';

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Top action bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Workspace</h2>
          <p className="text-xs text-muted-foreground">
            {isWorkflowRunning ? (
              <span className="flex items-center gap-1 text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                Workflow running…
              </span>
            ) : (
              'Issue commands to your agent swarm'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeWorkflows.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStopAll}
              className="gap-1.5"
            >
              <StopCircle className="h-3.5 w-3.5" />
              Stop All ({activeWorkflows.length})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveWorkflowId(null)}
            className="gap-1.5"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            New Command
          </Button>
        </div>
      </div>

      {/* Main 3-column grid */}
      <div className="grid flex-1 gap-4 lg:grid-cols-3 min-h-0">
        {/* ─── LEFT: Transcript + Command Input ────────────────────────── */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Input mode toggle */}
          <div className="flex rounded-lg border p-1 bg-muted/30 w-fit">
            <button
              onClick={() => setInputMode('text')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                inputMode === 'text' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              Text
            </button>
            <button
              onClick={() => setInputMode('voice')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                inputMode === 'voice' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              🎤 Voice
            </button>
          </div>

          {/* Command input */}
          {inputMode === 'text' ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Command</CardTitle>
              </CardHeader>
              <CardContent>
                <CommandInput
                  onSubmit={handleSubmit}
                  defaultIndustry={user?.industry ?? 'TECHNOLOGY'}
                  isLoading={isSubmitting || isWorkflowRunning}
                  onVoiceMode={() => setInputMode('voice')}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Voice Command</CardTitle>
              </CardHeader>
              <CardContent>
                <VoiceInput onTranscript={handleVoiceTranscript} />
              </CardContent>
            </Card>
          )}

          {/* Transcript panel */}
          <TranscriptPanel
            segments={voice.transcript}
            partialTranscript={voice.partialTranscript}
            isListening={voice.isListening}
            className="flex-1 min-h-48"
          />

          {/* Recent workflows */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent Workflows</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {activeWorkflows.length === 0 ? (
                <div className="px-4 pb-4">
                  <EmptyState
                    title="No active workflows"
                    description="Submit a command above to start"
                  />
                </div>
              ) : (
                <div className="divide-y">
                  {activeWorkflows.slice(0, 5).map(wf => (
                    <button
                      key={wf.id}
                      onClick={() => setActiveWorkflowId(wf.id)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors',
                        activeWorkflowId === wf.id && 'bg-muted/50',
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
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{wf.goal}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(wf.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      <Badge
                        variant={wf.status === 'COMPLETED' ? 'success' : wf.status === 'FAILED' ? 'destructive' : 'default'}
                        className="text-[10px] shrink-0 capitalize"
                      >
                        {wf.status.toLowerCase()}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ─── CENTER: Plan + Tasks ─────────────────────────────────────── */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Plan view */}
          <Card className="flex-1 overflow-hidden">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-sm">Execution Plan</CardTitle>
                  {/* Graph / List toggle */}
                  <div className="flex rounded-md border p-0.5 bg-muted/30">
                    <button
                      onClick={() => setPlanViewMode('graph')}
                      className={cn(
                        'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                        planViewMode === 'graph'
                          ? 'bg-background shadow text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      Graph
                    </button>
                    <button
                      onClick={() => setPlanViewMode('list')}
                      className={cn(
                        'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                        planViewMode === 'list'
                          ? 'bg-background shadow text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      List
                    </button>
                  </div>
                </div>
                {workflow?.status && (
                  <Badge
                    variant={
                      workflow.status === 'COMPLETED' ? 'success' :
                      workflow.status === 'FAILED'    ? 'destructive' :
                      workflow.status === 'RUNNING'   ? 'default' :
                      workflow.status === 'PAUSED'    ? 'warning' :
                      'secondary'
                    }
                    className="text-xs capitalize"
                  >
                    {workflow.status === 'PAUSED' ? 'Awaiting Approval' : workflow.status.toLowerCase()}
                  </Badge>
                )}
                {/* Workflow controls */}
                {workflow?.status === 'RUNNING' && (
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={async () => { await workflowApi.pause(workflow.id); refreshWorkflow(); }}>
                      Pause
                    </Button>
                    <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={async () => { await workflowApi.stop(workflow.id); refreshWorkflow(); }}>
                      Stop
                    </Button>
                  </div>
                )}
                {workflow?.status === 'PAUSED' && (
                  <Button size="sm" className="h-7 text-xs" onClick={async () => { await workflowApi.unpause(workflow.id); refreshWorkflow(); }}>
                    Resume
                  </Button>
                )}
              </div>
              {workflow?.goal && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  &ldquo;{workflow.goal}&rdquo;
                </p>
              )}
              {isConnected && latestEvent && (
                <div className="flex items-center gap-2 px-3 py-2 mt-2 text-xs bg-primary/5 rounded-lg border border-primary/20">
                  <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-muted-foreground">
                    Live: {latestEvent.type === 'started' ? 'Workflow started...' : latestEvent.status ?? latestEvent.type}
                  </span>
                </div>
              )}
            </CardHeader>
            <CardContent className="overflow-y-auto p-4 max-h-[600px]">
              {planViewMode === 'graph' ? (
                <WorkflowDAG
                  plan={workflow?.plan}
                  workflowStatus={workflow?.status}
                  onNodeClick={(stepId) => {
                    // Node click handler — could open trace detail
                  }}
                />
              ) : (
                <PlanView
                  plan={workflow?.plan}
                  isLoading={workflowLoading && !!activeWorkflowId}
                />
              )}
            </CardContent>
          </Card>

          {/* Task list */}
          <Card>
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Running Tasks</CardTitle>
                {tasks.filter(t => t.status === 'IN_PROGRESS' || t.status === 'AWAITING_APPROVAL').length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span className="text-xs text-primary font-medium">
                      {tasks.filter(t => t.status === 'IN_PROGRESS' || t.status === 'AWAITING_APPROVAL').length} active
                    </span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4 overflow-y-auto max-h-72">
              <TaskList
                tasks={tasks}
                workflowId={activeWorkflowId ?? undefined}
                isLoading={workflowLoading && !!activeWorkflowId}
              />
            </CardContent>
          </Card>
        </div>

        {/* ─── RIGHT: Approvals + Results ──────────────────────────────── */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Approvals inbox */}
          <Card className="flex-1">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Approvals Inbox</CardTitle>
                {pendingCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1">
                    {pendingCount}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4 overflow-y-auto max-h-72">
              <ApprovalsInbox
                approvals={approvals}
                isLoading={approvalsLoading}
                onRefresh={refreshApprovals}
              />
            </CardContent>
          </Card>

          {/* Agent activity tracker */}
          <AgentTracker workflowId={activeWorkflowId ?? null} />

          {/* Results panel */}
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm">Results</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {!workflow?.result && !workflow?.finalOutput && !(workflow?.error ?? workflow?.errorMessage) ? (
                <EmptyState
                  title="No results yet"
                  description={
                    hasActiveWorkflow
                      ? 'Results will appear when the workflow completes'
                      : 'Start a workflow to see results'
                  }
                />
              ) : (workflow?.error ?? workflow?.errorMessage) ? (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
                  <p className="text-xs font-medium text-destructive mb-1">Workflow Error</p>
                  <p className="text-sm text-destructive">{workflow.error ?? workflow.errorMessage}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-600 dark:text-green-400">Workflow completed</span>
                    {workflow?.tokenUsage != null && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {workflow.tokenUsage.toLocaleString()} tokens
                      </span>
                    )}
                  </div>
                  {workflow?.finalOutput ? (
                    <div className="rounded-lg border bg-card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-sm flex items-center gap-2">
                          Results
                        </h3>
                        <a
                          href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/workflows/${workflow.id}/output`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          Download
                        </a>
                      </div>
                      <div className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed max-h-96 overflow-y-auto">
                        {workflow.finalOutput}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border bg-muted/30 p-3 max-h-48 overflow-y-auto">
                      <pre className="text-sm whitespace-pre-wrap font-sans">
                        {typeof workflow?.result === 'string'
                          ? workflow.result
                          : JSON.stringify(workflow?.result, null, 2)}
                      </pre>
                    </div>
                  )}
                  {workflow?.costUsd != null && (
                    <p className="text-xs text-muted-foreground text-right">
                      Cost: ${workflow.costUsd.toFixed(4)}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
