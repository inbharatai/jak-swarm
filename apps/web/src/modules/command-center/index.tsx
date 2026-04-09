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
import { eventBus, SHELL_EVENTS } from '@/lib/event-bus';
import type { Industry } from '@/types';
import type { ModuleProps } from '@/modules/registry';
import { formatDistanceToNow } from 'date-fns';

export default function CommandCenterModule({ moduleId, isActive }: ModuleProps) {
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
      eventBus.emit(SHELL_EVENTS.WORKFLOW_STARTED, { workflowId: result.id, goal: command }, moduleId);
    } catch (err) {
      toast.error('Failed to create workflow', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [refreshWorkflow, moduleId]);

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
  const isWorkflowRunning = workflow?.status === 'RUNNING' || workflow?.status === 'PENDING';

  return (
    <div className="flex flex-col h-full gap-4 p-4 overflow-auto">
      {/* Top action bar */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Command Center</h2>
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

      {/* Main grid */}
      <div className="grid flex-1 gap-4 lg:grid-cols-3 min-h-0">
        {/* LEFT: Input + Recent */}
        <div className="flex flex-col gap-4 min-h-0">
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

          {inputMode === 'text' ? (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Command</CardTitle></CardHeader>
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
              <CardHeader className="pb-3"><CardTitle className="text-sm">Voice Command</CardTitle></CardHeader>
              <CardContent>
                <VoiceInput onTranscript={handleVoiceTranscript} />
              </CardContent>
            </Card>
          )}

          <TranscriptPanel
            segments={voice.transcript}
            partialTranscript={voice.partialTranscript}
            isListening={voice.isListening}
            className="flex-1 min-h-48"
          />

          {/* Recent workflows */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Workflows</CardTitle></CardHeader>
            <CardContent className="p-0">
              {activeWorkflows.length === 0 ? (
                <div className="px-4 pb-4">
                  <EmptyState title="No active workflows" description="Submit a command above to start" />
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
                        {wf.status === 'RUNNING' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          : wf.status === 'COMPLETED' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          : <StopCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{wf.goal}</p>
                        <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(wf.createdAt), { addSuffix: true })}</p>
                      </div>
                      <Badge variant={wf.status === 'COMPLETED' ? 'success' : wf.status === 'FAILED' ? 'destructive' : 'default'} className="text-[10px] shrink-0 capitalize">
                        {wf.status.toLowerCase()}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* CENTER: Plan View */}
        <div className="flex flex-col gap-4 min-h-0">
          <Card className="flex-1 overflow-hidden">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Execution Plan</CardTitle>
                <div className="flex rounded-md border p-0.5 bg-muted/30">
                  <button onClick={() => setPlanViewMode('graph')} className={cn('rounded px-2 py-0.5 text-[10px] font-medium transition-colors', planViewMode === 'graph' ? 'bg-background shadow text-foreground' : 'text-muted-foreground')}>Graph</button>
                  <button onClick={() => setPlanViewMode('list')} className={cn('rounded px-2 py-0.5 text-[10px] font-medium transition-colors', planViewMode === 'list' ? 'bg-background shadow text-foreground' : 'text-muted-foreground')}>List</button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 min-h-0">
              {planViewMode === 'graph' && workflow ? (
                <WorkflowDAG plan={workflow.plan} workflowStatus={workflow.status} className="h-full" />
              ) : (
                <PlanView plan={workflow?.plan} />
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Tasks + Approvals */}
        <div className="flex flex-col gap-4 min-h-0">
          <TaskList tasks={tasks} className="flex-1" />
          <ApprovalsInbox approvals={approvals} onRefresh={refreshApprovals} />
          {workflow && <AgentTracker workflowId={workflow.id} />}
        </div>
      </div>
    </div>
  );
}
