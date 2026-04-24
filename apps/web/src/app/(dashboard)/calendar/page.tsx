'use client';

/**
 * Calendar — list upcoming events + create new events. Mirrors the RHCF-Seva
 * pattern of "a small, focused calendar surface" rather than a full
 * calendar-grid UI. Events are written via the existing Google Calendar
 * integration (the GCAL provider); create + list go through the workflow
 * engine so audit + approval apply.
 *
 * Gate logic: if GCAL is not CONNECTED, show a config prompt instead of
 * the feature.
 */

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import {
  CalendarDays,
  Plus,
  RefreshCw,
  Loader2,
  Plug,
  Clock,
} from 'lucide-react';
import {
  Card,
  CardContent,
  Button,
  Input,
  Textarea,
  EmptyState,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogCloseButton,
} from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dataFetcher, workflowApi } from '@/lib/api-client';
import type { Integration } from '@/types';

interface CalEvent {
  id: string;
  title: string;
  start: string; // ISO
  end: string;   // ISO
  description?: string;
  location?: string;
}

const DAY_WINDOWS = [7, 30, 90] as const;
type DayWindow = (typeof DAY_WINDOWS)[number];

function formatRange(start: string, end: string): string {
  try {
    const s = new Date(start);
    const e = new Date(end);
    const sameDay = s.toDateString() === e.toDateString();
    const dayFmt: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    const timeFmt: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    if (sameDay) {
      return `${s.toLocaleDateString(undefined, dayFmt)} · ${s.toLocaleTimeString(undefined, timeFmt)}–${e.toLocaleTimeString(undefined, timeFmt)}`;
    }
    return `${s.toLocaleDateString(undefined, dayFmt)} ${s.toLocaleTimeString(undefined, timeFmt)} → ${e.toLocaleDateString(undefined, dayFmt)} ${e.toLocaleTimeString(undefined, timeFmt)}`;
  } catch {
    return `${start} → ${end}`;
  }
}

function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}
function defaultEnd(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 2);
  return toLocalInput(d);
}
function toLocalInput(d: Date): string {
  // yyyy-MM-ddTHH:mm for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CalendarPage() {
  const toast = useToast();
  const [days, setDays] = useState<DayWindow>(30);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    start: defaultStart(),
    end: defaultEnd(),
    description: '',
    location: '',
  });

  const { data: integrationsData } = useSWR<Integration[]>(
    '/integrations',
    dataFetcher,
    { refreshInterval: 60_000 },
  );
  const gcal = (integrationsData ?? []).find((i) => i.provider === 'GCAL');
  const isConfigured = gcal?.status === 'CONNECTED';

  const { data: eventsResp, isLoading, mutate } = useSWR<{ success: boolean; data: CalEvent[] }>(
    isConfigured ? `/integrations/gcal/events?days=${days}` : null,
    dataFetcher,
  );
  const events: CalEvent[] = eventsResp?.data ?? [];

  const resetForm = useCallback(() => {
    setNewEvent({
      title: '',
      start: defaultStart(),
      end: defaultEnd(),
      description: '',
      location: '',
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newEvent.title.trim() || !newEvent.start || !newEvent.end) {
      toast.warning('Missing fields', 'Title, start, and end are required.');
      return;
    }
    setCreating(true);
    try {
      // Route through the workflow engine so the calendar write surfaces
      // in /swarm + picks up any approval policy. Calendar/automation worker
      // owns the `create_event` tool call.
      const startIso = new Date(newEvent.start).toISOString();
      const endIso = new Date(newEvent.end).toISOString();
      const goal =
        `Create a Google Calendar event using the connected GCal integration. ` +
        `Confirm with the event ID on success.\n\n` +
        `Title: ${newEvent.title}\n` +
        `Start: ${startIso}\n` +
        `End: ${endIso}\n` +
        (newEvent.location ? `Location: ${newEvent.location}\n` : '') +
        (newEvent.description ? `Description: ${newEvent.description}\n` : '');
      await workflowApi.create(goal, undefined, ['automation']);
      toast.success('Event queued', 'Track the run in the Swarm Inspector. It will appear below on refresh.');
      setCreateOpen(false);
      resetForm();
      // Optimistic refresh — the swarm may take a few seconds.
      setTimeout(() => void mutate(), 4_000);
    } catch (e) {
      toast.error('Create failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setCreating(false);
    }
  }, [newEvent, mutate, resetForm, toast]);

  if (!isConfigured) {
    return (
      <div className="flex-1 overflow-auto p-6" data-testid="calendar-gate">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold flex items-center gap-2 mb-4">
            <CalendarDays className="h-6 w-6 text-primary" />
            Calendar
          </h1>
          <Card>
            <CardContent className="p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Plug className="h-6 w-6 text-primary" />
              </div>
              <h2 className="mt-4 text-base font-semibold">Connect Google Calendar to use Calendar</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Events are read and written through your connected Google Calendar account.
                All writes run through the workflow engine with audit + approval where required.
              </p>
              <Button className="mt-6" onClick={() => (window.location.href = '/integrations')}>
                Open Integrations
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6" data-testid="calendar-page">
      <div className="max-w-4xl mx-auto space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarDays className="h-6 w-6 text-primary" />
              Calendar
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connected as <span className="font-medium">{gcal?.displayName ?? 'Google Calendar'}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {DAY_WINDOWS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={
                    'px-2.5 py-1 text-xs rounded-md border transition-colors ' +
                    (days === d
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-transparent text-muted-foreground border-border hover:bg-muted')
                  }
                  data-testid={`calendar-day-${d}`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => void mutate()} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5" data-testid="calendar-new-btn">
              <Plus className="h-3.5 w-3.5" /> New event
            </Button>
          </div>
        </header>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-8 w-8" />}
            title={`Nothing on the calendar in the next ${days} days`}
            description="Create an event to add it to your connected calendar."
            action={<Button onClick={() => setCreateOpen(true)}>New event</Button>}
          />
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => (
              <li key={ev.id}>
                <Card>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                      <Clock className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{ev.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatRange(ev.start, ev.end)}</p>
                      {ev.location && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">📍 {ev.location}</p>
                      )}
                      {ev.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ev.description}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogHeader>
          <DialogTitle>New calendar event</DialogTitle>
          <DialogCloseButton onClick={() => setCreateOpen(false)} />
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block">Title</label>
              <Input
                value={newEvent.title}
                onChange={(e) => setNewEvent((p) => ({ ...p, title: e.target.value }))}
                placeholder="Design review"
                data-testid="calendar-new-title"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1.5 block">Start</label>
                <Input
                  type="datetime-local"
                  value={newEvent.start}
                  onChange={(e) => setNewEvent((p) => ({ ...p, start: e.target.value }))}
                  data-testid="calendar-new-start"
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block">End</label>
                <Input
                  type="datetime-local"
                  value={newEvent.end}
                  onChange={(e) => setNewEvent((p) => ({ ...p, end: e.target.value }))}
                  data-testid="calendar-new-end"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Location <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                value={newEvent.location}
                onChange={(e) => setNewEvent((p) => ({ ...p, location: e.target.value }))}
                placeholder="Zoom, office, address…"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Textarea
                value={newEvent.description}
                onChange={(e) => setNewEvent((p) => ({ ...p, description: e.target.value }))}
                className="min-h-[80px]"
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !newEvent.title.trim()}
            className="gap-1.5"
            data-testid="calendar-new-submit"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create event
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
