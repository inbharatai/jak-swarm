'use client';

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import { Clock, Plus, Play, Trash2, Edit2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  EmptyState,
  Spinner,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  Input,
  Textarea,
  Select,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { fetcher, scheduleApi } from '@/lib/api-client';
import type { WorkflowSchedule } from '@/types';
import { formatDistanceToNow } from 'date-fns';

// Cron presets for easy selection
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
  { value: 'LOGISTICS', label: 'Logistics' },
  { value: 'MANUFACTURING', label: 'Manufacturing' },
  { value: 'TECHNOLOGY', label: 'Technology' },
  { value: 'REAL_ESTATE', label: 'Real Estate' },
  { value: 'EDUCATION', label: 'Education' },
  { value: 'HOSPITALITY', label: 'Hospitality' },
];

interface ScheduleFormData {
  name: string;
  goal: string;
  cronExpression: string;
  description: string;
  industry: string;
  maxCostUsd: string;
}

const emptyForm: ScheduleFormData = {
  name: '',
  goal: '',
  cronExpression: '',
  description: '',
  industry: '',
  maxCostUsd: '',
};

function cronToHuman(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  if (dom === '*' && mon === '*') {
    if (dow === '*') {
      if (min === '0' && hour === '*') return 'Every hour';
      if (hour !== '*' && min !== undefined) return `Daily at ${hour}:${min!.padStart(2, '0')}`;
    }
    if (dow === '1-5' && hour !== '*') return `Weekdays at ${hour}:${min!.padStart(2, '0')}`;
    if (dow === '1' && hour !== '*') return `Every Monday at ${hour}:${min!.padStart(2, '0')}`;
    if (dow === '5' && hour !== '*') return `Every Friday at ${hour}:${min!.padStart(2, '0')}`;
  }
  if (dom === '1' && mon === '*' && dow === '*' && hour !== '*') {
    return `1st of month at ${hour}:${min!.padStart(2, '0')}`;
  }
  return cron;
}

export default function SchedulesPage() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ data: WorkflowSchedule[] }>('/schedules', fetcher);
  const schedules = (data as any)?.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((schedule: WorkflowSchedule) => {
    setEditingId(schedule.id);
    setForm({
      name: schedule.name,
      goal: schedule.goal,
      cronExpression: schedule.cronExpression,
      description: schedule.description ?? '',
      industry: schedule.industry ?? '',
      maxCostUsd: schedule.maxCostUsd?.toString() ?? '',
    });
    setError(null);
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || !form.goal.trim() || !form.cronExpression.trim()) {
      setError('Name, goal, and cron expression are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        goal: form.goal.trim(),
        cronExpression: form.cronExpression.trim(),
        description: form.description.trim() || undefined,
        industry: form.industry || undefined,
        maxCostUsd: form.maxCostUsd ? parseFloat(form.maxCostUsd) : undefined,
      };

      if (editingId) {
        await scheduleApi.update(editingId, body);
      } else {
        await scheduleApi.create(body as any);
      }

      setDialogOpen(false);
      mutate();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save schedule');
    } finally {
      setSaving(false);
    }
  }, [form, editingId, mutate]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    try {
      await scheduleApi.delete(id);
      mutate();
    } catch (err) { toast.error('Operation failed', err instanceof Error ? err.message : 'Please try again.'); }
  }, [mutate]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await scheduleApi.update(id, { enabled: !enabled });
      mutate();
    } catch (err) { toast.error('Operation failed', err instanceof Error ? err.message : 'Please try again.'); }
  }, [mutate]);

  const handleRunNow = useCallback(async (id: string) => {
    try {
      await scheduleApi.runNow(id);
      mutate();
    } catch (err) { toast.error('Operation failed', err instanceof Error ? err.message : 'Please try again.'); }
  }, [mutate]);

  const updateField = (field: keyof ScheduleFormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="flex flex-col gap-6 p-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Schedules
          </h2>
          <p className="text-xs text-muted-foreground">
            Automate workflows on a recurring schedule
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          New Schedule
        </Button>
      </div>

      {/* Schedule list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : schedules.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<Clock className="h-6 w-6" />}
              title="No schedules yet"
              description="Create a schedule to run workflows automatically"
              action={
                <Button size="sm" onClick={openCreate} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Create Schedule
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {schedules.map((schedule: WorkflowSchedule) => (
            <Card key={schedule.id} className={cn(!schedule.enabled && 'opacity-60')}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-sm truncate">{schedule.name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {cronToHuman(schedule.cronExpression)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <Badge
                      variant={schedule.enabled ? 'default' : 'secondary'}
                      className="text-[10px] cursor-pointer"
                      onClick={() => handleToggle(schedule.id, schedule.enabled)}
                    >
                      {schedule.enabled ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground line-clamp-2">{schedule.goal}</p>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Next run:</span>
                    <p className="font-medium">
                      {schedule.nextRunAt
                        ? formatDistanceToNow(new Date(schedule.nextRunAt), { addSuffix: true })
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last run:</span>
                    <p className="font-medium">
                      {schedule.lastRunAt
                        ? formatDistanceToNow(new Date(schedule.lastRunAt), { addSuffix: true })
                        : 'Never'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total runs:</span>
                    <p className="font-medium">{schedule.runCount}</p>
                  </div>
                  {schedule.lastRunStatus && (
                    <div>
                      <span className="text-muted-foreground">Last status:</span>
                      <p className="font-medium capitalize">{schedule.lastRunStatus.toLowerCase()}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 pt-1 border-t">
                  <Button variant="outline" size="sm" className="h-7 text-xs flex-1 gap-1" onClick={() => handleRunNow(schedule.id)}>
                    <Play className="h-3 w-3" />
                    Run Now
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(schedule)}>
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(schedule.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>{editingId ? 'Edit Schedule' : 'New Schedule'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <Input
              label="Name"
              placeholder="e.g. Daily market report"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
            />

            <Textarea
              label="Goal"
              placeholder="Describe what the workflow should accomplish..."
              rows={3}
              value={form.goal}
              onChange={(e) => updateField('goal', e.target.value)}
            />

            <div className="space-y-2">
              <Input
                label="Cron Expression"
                placeholder="0 9 * * *"
                value={form.cronExpression}
                onChange={(e) => updateField('cronExpression', e.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[10px] transition-colors',
                      form.cronExpression === preset.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50',
                    )}
                    onClick={() => updateField('cronExpression', preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <Select
              label="Industry"
              options={INDUSTRY_OPTIONS}
              value={form.industry}
              onChange={(e) => updateField('industry', e.target.value)}
            />

            <Input
              label="Budget (USD)"
              placeholder="Optional max cost per run"
              type="number"
              step="0.01"
              value={form.maxCostUsd}
              onChange={(e) => updateField('maxCostUsd', e.target.value)}
            />

            <Textarea
              label="Description"
              placeholder="Optional description..."
              rows={2}
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
            />

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
