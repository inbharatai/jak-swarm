'use client';

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import { Clock, Plus, Play, Trash2, Edit2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { Button, Card, CardContent, Badge, EmptyState, Spinner, Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, Input, Textarea, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fetcher, scheduleApi } from '@/lib/api-client';
import type { WorkflowSchedule } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import type { ModuleProps } from '@/modules/registry';

const CRON_PRESETS = [
  { label: 'Every day at 9am', value: '0 9 * * *' },
  { label: 'Weekdays at 9am', value: '0 9 * * 1-5' },
  { label: 'Every Monday at 9am', value: '0 9 * * 1' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every Friday at 5pm', value: '0 17 * * 5' },
  { label: 'First of month at 9am', value: '0 9 1 * *' },
];

const INDUSTRY_OPTIONS = [
  { value: '', label: 'Any industry' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'HEALTHCARE', label: 'Healthcare' },
  { value: 'LEGAL', label: 'Legal' },
  { value: 'RETAIL', label: 'Retail' },
  { value: 'TECHNOLOGY', label: 'Technology' },
];

interface ScheduleFormData {
  name: string;
  goal: string;
  cronExpression: string;
  description: string;
  industry: string;
  maxCostUsd: string;
}

const emptyForm: ScheduleFormData = { name: '', goal: '', cronExpression: '', description: '', industry: '', maxCostUsd: '' };

function cronToHuman(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  if (dom === '*' && mon === '*') {
    if (dow === '*') {
      if (min === '0' && hour === '*') return 'Every hour';
      if (hour !== '*') return `Daily at ${hour}:${min!.padStart(2, '0')}`;
    }
    if (dow === '1-5' && hour !== '*') return `Weekdays at ${hour}:${min!.padStart(2, '0')}`;
    if (dow === '1' && hour !== '*') return `Every Monday at ${hour}:${min!.padStart(2, '0')}`;
  }
  return cron;
}

export default function SchedulesModule({ moduleId, isActive }: ModuleProps) {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ data: WorkflowSchedule[] }>('/schedules', fetcher);
  const schedules = data?.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setDialogOpen(true); };

  const openEdit = (schedule: WorkflowSchedule) => {
    setEditingId(schedule.id);
    setForm({
      name: schedule.name,
      goal: schedule.goal ?? '',
      cronExpression: schedule.cronExpression,
      description: schedule.description ?? '',
      industry: schedule.industry ?? '',
      maxCostUsd: schedule.maxCostUsd?.toString() ?? '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.cronExpression.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, maxCostUsd: form.maxCostUsd ? parseFloat(form.maxCostUsd) : undefined };
      if (editingId) {
        await scheduleApi.update(editingId, payload);
        toast.success('Schedule updated');
      } else {
        await scheduleApi.create(payload);
        toast.success('Schedule created');
      }
      setDialogOpen(false);
      mutate();
    } catch {
      toast.error('Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await scheduleApi.delete(id);
      toast.success('Schedule deleted');
      mutate();
    } catch {
      toast.error('Failed to delete schedule');
    }
  };

  const handleTrigger = async (id: string) => {
    try {
      await scheduleApi.runNow(id);
      toast.success('Schedule triggered');
    } catch {
      toast.error('Failed to trigger schedule');
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>;

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />Schedules</h2>
          <p className="text-xs text-muted-foreground">Automated workflow schedules</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-3.5 w-3.5 mr-1" />New Schedule</Button>
      </div>

      {schedules.length === 0 ? (
        <EmptyState icon={<Clock className="h-10 w-10" />} title="No schedules" description="Create automated schedules to run workflows on a recurring basis" />
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule: WorkflowSchedule) => (
            <Card key={schedule.id} className="group">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{schedule.name}</span>
                      <Badge variant={schedule.enabled ? 'success' : 'secondary'} className="text-[10px]">{schedule.enabled ? 'Active' : 'Paused'}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{cronToHuman(schedule.cronExpression)}</p>
                    {schedule.description && <p className="text-xs text-muted-foreground line-clamp-1">{schedule.description}</p>}
                    {schedule.lastRunAt && <p className="text-[10px] text-muted-foreground">Last run {formatDistanceToNow(new Date(schedule.lastRunAt), { addSuffix: true })}</p>}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleTrigger(schedule.id)} className="p-1.5 rounded hover:bg-muted" title="Run now"><Play className="h-3.5 w-3.5" /></button>
                    <button onClick={() => openEdit(schedule)} className="p-1.5 rounded hover:bg-muted" title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => handleDelete(schedule.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>{editingId ? 'Edit Schedule' : 'New Schedule'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Input label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Weekly report" />
          <Input label="Goal" value={form.goal} onChange={e => setForm(f => ({ ...f, goal: e.target.value }))} placeholder="Generate weekly marketing report" />
          <div>
            <label className="block text-sm font-medium mb-1">Schedule</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {CRON_PRESETS.map(p => (
                <button key={p.value} onClick={() => setForm(f => ({ ...f, cronExpression: p.value }))} className={cn('rounded-full px-2.5 py-1 text-xs border transition-colors', form.cronExpression === p.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50')}>
                  {p.label}
                </button>
              ))}
            </div>
            <Input value={form.cronExpression} onChange={e => setForm(f => ({ ...f, cronExpression: e.target.value }))} placeholder="0 9 * * *" className="font-mono text-sm" />
          </div>
          <Textarea label="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update' : 'Create'}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
