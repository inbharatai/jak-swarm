'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { apiDataFetch, dataFetcher, getErrorMessage, workflowApi } from '@/lib/api-client';

interface Participant {
  id: string;
  userId: string;
  role: 'OWNER' | 'EDITOR' | 'REVIEWER' | 'VIEWER';
  name: string | null;
  email: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  online: boolean;
  activeTaskId: string | null;
  controlLeaseUntil: string | null;
  lastSeenAt: string;
}

interface SessionEvent {
  id: string;
  actorType: 'HUMAN' | 'AGENT' | 'SYSTEM';
  actorId: string | null;
  eventType: string;
  taskId: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  sequence: number;
  createdAt: string;
}

interface WorkflowView {
  id: string;
  goal: string;
  status: string;
  planJson?: unknown;
  stateJson?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function planTasks(workflow: WorkflowView | undefined): Array<Record<string, unknown>> {
  if (!workflow || !isRecord(workflow.planJson) || !Array.isArray(workflow.planJson.tasks)) return [];
  return workflow.planJson.tasks.filter(isRecord);
}

function eventLabel(eventType: string): string {
  return eventType
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function actorLabel(event: SessionEvent, participants: Participant[]): string {
  if (event.actorType === 'AGENT') return String(event.metadata?.['agentRole'] ?? 'Agent');
  if (event.actorType === 'SYSTEM') return 'JAK';
  const person = participants.find((participant) => participant.userId === event.actorId);
  return person?.name || person?.email || 'Teammate';
}

async function waitForPaused(workflowId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const workflow = await workflowApi.get(workflowId) as unknown as WorkflowView;
    if (workflow.status === 'PAUSED') return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Workflow did not reach PAUSED state in time');
}

export default function WorkflowSessionPage() {
  const params = useParams<{ workflowId: string }>();
  const workflowId = params.workflowId;
  const [comment, setComment] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [controlledTaskId, setControlledTaskId] = useState('');
  const [redirectInstruction, setRedirectInstruction] = useState('');
  const [redirectReason, setRedirectReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workflowQuery = useSWR<WorkflowView>(
    workflowId ? `/workflows/${workflowId}` : null,
    (path: string) => dataFetcher<WorkflowView>(path),
    { refreshInterval: 3000 },
  );
  const participantsQuery = useSWR<{ participants: Participant[] }>(
    workflowId ? `/workflows/${workflowId}/participants` : null,
    (path: string) => dataFetcher<{ participants: Participant[] }>(path),
    { refreshInterval: 4000 },
  );
  const eventsQuery = useSWR<{ events: SessionEvent[]; nextSequence: number }>(
    workflowId ? `/workflows/${workflowId}/session-events?limit=300` : null,
    (path: string) => dataFetcher<{ events: SessionEvent[]; nextSequence: number }>(path),
    { refreshInterval: 2500 },
  );

  const participants = participantsQuery.data?.participants ?? [];
  const events = eventsQuery.data?.events ?? [];
  const tasks = useMemo(() => planTasks(workflowQuery.data), [workflowQuery.data]);

  // Join once for the lifetime of this page. Task selection must not make the
  // user leave and rejoin the session (that used to create noisy timeline rows).
  useEffect(() => {
    if (!workflowId) return;
    let active = true;
    const join = async () => {
      try {
        await apiDataFetch(`/workflows/${workflowId}/participants/join`, { method: 'POST' });
        if (active) await participantsQuery.mutate();
      } catch (joinError) {
        if (active) setError(getErrorMessage(joinError));
      }
    };
    void join();

    return () => {
      active = false;
      void apiDataFetch(`/workflows/${workflowId}/participants/me`, { method: 'DELETE' }).catch(() => undefined);
    };
  }, [workflowId]);

  // Presence heartbeat is independent from joining. If this user owns a task
  // control lease, renew it every 15 seconds; otherwise only publish the task
  // they are looking at for presence UI.
  useEffect(() => {
    if (!workflowId) return;
    const heartbeat = async () => {
      try {
        await apiDataFetch(`/workflows/${workflowId}/participants/heartbeat`, {
          method: 'POST',
          body: {
            activeTaskId: controlledTaskId || selectedTaskId || null,
            claimControl: Boolean(controlledTaskId),
            leaseSeconds: 60,
          },
        });
      } catch {
        if (controlledTaskId) setControlledTaskId('');
      }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 15_000);
    return () => window.clearInterval(timer);
  }, [workflowId, selectedTaskId, controlledTaskId]);

  const submitComment = async () => {
    if (!comment.trim()) return;
    setBusy('comment');
    setError(null);
    try {
      await apiDataFetch(`/workflows/${workflowId}/comments`, {
        method: 'POST',
        body: { content: comment.trim(), taskId: selectedTaskId || null },
      });
      setComment('');
      await eventsQuery.mutate();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setBusy(null);
    }
  };

  const redirectTask = async () => {
    if (!selectedTaskId || !redirectReason.trim()) return;
    setBusy('redirect');
    setError(null);
    setNotice(null);
    try {
      if (workflowQuery.data?.status !== 'PAUSED') {
        await workflowApi.pause(workflowId);
        await waitForPaused(workflowId);
      }
      await apiDataFetch(`/workflows/${workflowId}/tasks/${selectedTaskId}/redirect`, {
        method: 'POST',
        body: {
          action: 'REDIRECT',
          reason: redirectReason.trim(),
          instruction: redirectInstruction.trim() || undefined,
        },
      });
      await workflowApi.unpause(workflowId);
      setRedirectInstruction('');
      setRedirectReason('');
      setNotice('Task redirected and workflow resumed from the revised plan.');
      await Promise.all([workflowQuery.mutate(), eventsQuery.mutate()]);
    } catch (redirectError) {
      setError(getErrorMessage(redirectError));
    } finally {
      setBusy(null);
    }
  };

  const claimControl = async () => {
    if (!selectedTaskId) return;
    setBusy('control');
    setError(null);
    try {
      await apiDataFetch(`/workflows/${workflowId}/participants/heartbeat`, {
        method: 'POST',
        body: { activeTaskId: selectedTaskId, claimControl: true, leaseSeconds: 60 },
      });
      setControlledTaskId(selectedTaskId);
      setNotice('You control this task. The lease renews while this session stays open.');
      await participantsQuery.mutate();
    } catch (claimError) {
      setControlledTaskId('');
      setError(getErrorMessage(claimError));
    } finally {
      setBusy(null);
    }
  };

  const setTaskSelection = (taskId: string) => {
    setSelectedTaskId(taskId);
    if (controlledTaskId && controlledTaskId !== taskId) setControlledTaskId('');
  };

  const setWorkflowPaused = async (paused: boolean) => {
    setBusy(paused ? 'pause' : 'resume');
    setError(null);
    try {
      if (paused) await workflowApi.pause(workflowId);
      else await workflowApi.unpause(workflowId);
      await workflowQuery.mutate();
    } catch (controlError) {
      setError(getErrorMessage(controlError));
    } finally {
      setBusy(null);
    }
  };

  const downloadReplay = async () => {
    setBusy('replay');
    setError(null);
    try {
      const replay = await apiDataFetch<Record<string, unknown>>(`/workflows/${workflowId}/replay`);
      const blob = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `jak-workflow-${workflowId}-replay.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (replayError) {
      setError(getErrorMessage(replayError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Multiplayer session</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">{workflowQuery.data?.goal ?? 'Loading workflow…'}</h1>
          <p className="mt-2 text-sm text-zinc-400">Workflow {workflowId} · {workflowQuery.data?.status ?? '—'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void setWorkflowPaused(true)}
            disabled={busy === 'pause' || workflowQuery.data?.status === 'PAUSED'}
            className="rounded-lg border border-amber-400/30 px-3 py-2 text-sm text-amber-200 hover:bg-amber-400/10 disabled:opacity-40"
          >
            Pause
          </button>
          <button
            type="button"
            onClick={() => void setWorkflowPaused(false)}
            disabled={busy === 'resume' || workflowQuery.data?.status !== 'PAUSED'}
            className="rounded-lg border border-emerald-400/30 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-40"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={() => void downloadReplay()}
            disabled={busy === 'replay'}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
          >
            Export replay
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}
      {notice ? <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-white">People in session</h2>
            <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-zinc-400">{participants.length}</span>
          </div>
          <div className="space-y-3">
            {participants.map((participant) => (
              <div key={participant.id} className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-white">
                    {(participant.name || participant.email).slice(0, 1).toUpperCase()}
                    <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-zinc-950 ${participant.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{participant.name || participant.email}</p>
                    <p className="truncate text-xs text-zinc-500">{participant.jobTitle || participant.role}</p>
                  </div>
                </div>
                {participant.activeTaskId ? <p className="mt-2 truncate text-xs text-amber-300">On {participant.activeTaskId}</p> : null}
              </div>
            ))}
            {!participants.length ? <p className="text-sm text-zinc-500">No participants loaded.</p> : null}
          </div>
        </aside>

        <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-white">Shared activity</h2>
            <span className="text-xs text-zinc-500">Refreshes every 2.5 seconds</span>
          </div>
          <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
            {events.map((event) => (
              <article key={event.id} className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-emerald-300">{actorLabel(event, participants)}</span>
                  <span className="text-zinc-500">{eventLabel(event.eventType)}</span>
                  {event.taskId ? <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-200">{event.taskId}</span> : null}
                  <time className="ml-auto text-zinc-600">{new Date(event.createdAt).toLocaleTimeString()}</time>
                </div>
                {event.content ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{event.content}</p> : null}
              </article>
            ))}
            {!events.length ? <p className="py-16 text-center text-sm text-zinc-500">The shared timeline is empty. Add a comment or assign a human task.</p> : null}
          </div>

          <div className="mt-4 border-t border-white/10 pt-4">
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={selectedTaskId ? `Comment on ${selectedTaskId}` : 'Comment for the whole session'}
              rows={3}
              className="w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-emerald-400/40"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => void submitComment()}
                disabled={!comment.trim() || busy === 'comment'}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40"
              >
                Add to session
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <h2 className="font-semibold text-white">Task control</h2>
            <select
              value={selectedTaskId}
              onChange={(event) => setTaskSelection(event.target.value)}
              className="mt-3 w-full rounded-lg border border-white/10 bg-black/50 p-2.5 text-sm text-white"
            >
              <option value="">Select a task</option>
              {tasks.map((task) => {
                const id = String(task['id'] ?? '');
                return <option key={id} value={id}>{id} — {String(task['description'] ?? task['title'] ?? 'Task')}</option>;
              })}
            </select>
            <button
              type="button"
              onClick={() => void claimControl()}
              disabled={!selectedTaskId || busy === 'control' || controlledTaskId === selectedTaskId}
              className="mt-3 w-full rounded-lg border border-sky-400/30 px-3 py-2 text-sm text-sky-200 disabled:opacity-40"
            >
              {controlledTaskId === selectedTaskId ? 'You control this task' : 'Claim task control'}
            </button>
          </section>

          <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <h2 className="font-semibold text-white">Redirect agent work</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">JAK pauses, versions the plan, applies your direction, and resumes from the revised checkpoint.</p>
            <textarea
              value={redirectInstruction}
              onChange={(event) => setRedirectInstruction(event.target.value)}
              placeholder="New instruction for this task"
              rows={4}
              className="mt-3 w-full rounded-lg border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600"
            />
            <input
              value={redirectReason}
              onChange={(event) => setRedirectReason(event.target.value)}
              placeholder="Why are you redirecting it?"
              className="mt-3 w-full rounded-lg border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600"
            />
            <button
              type="button"
              onClick={() => void redirectTask()}
              disabled={!selectedTaskId || !redirectReason.trim() || busy === 'redirect'}
              className="mt-3 w-full rounded-lg bg-amber-300 px-3 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40"
            >
              Pause, redirect, resume
            </button>
          </section>
        </aside>
      </div>
    </main>
  );
}
