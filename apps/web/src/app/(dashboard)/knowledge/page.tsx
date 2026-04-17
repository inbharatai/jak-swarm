'use client';

import React, { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { BookOpen, Edit3, Plus, Save, Search, Trash2 } from 'lucide-react';
import useSWR from 'swr';
import { cn } from '@/lib/cn';
import { dataFetcher, memoryApi } from '@/lib/api-client';
import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Spinner,
  Textarea,
} from '@/components/ui';

type MemoryType = 'FACT' | 'PREFERENCE' | 'CONTEXT' | 'SKILL_RESULT';

interface MemoryEntry {
  id: string;
  key: string;
  value: unknown;
  source: string;
  memoryType: MemoryType;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedMemory {
  items: MemoryEntry[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

const MEMORY_TYPES: MemoryType[] = ['FACT', 'PREFERENCE', 'CONTEXT', 'SKILL_RESULT'];

const MEMORY_TYPE_COLORS: Record<MemoryType, string> = {
  FACT: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400',
  PREFERENCE: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400',
  CONTEXT: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400',
  SKILL_RESULT: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400',
};

function stringifyMemoryValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseMemoryValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function MemoryTypeBadge({ type }: { type: MemoryType }) {
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium', MEMORY_TYPE_COLORS[type])}>
      {type}
    </span>
  );
}

interface EditDialogProps {
  entry: MemoryEntry | null;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

function EditDialog({ entry, open, onClose, onSave }: EditDialogProps) {
  const [value, setValue] = useState(entry ? stringifyMemoryValue(entry.value) : '');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    setValue(entry ? stringifyMemoryValue(entry.value) : '');
  }, [entry]);

  const handleSave = async () => {
    if (!entry) return;
    setSaving(true);
    try {
      await memoryApi.update(entry.key, parseMemoryValue(value), entry.memoryType, entry.expiresAt ?? undefined);
      onSave();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Edit Memory Entry</DialogTitle>
        <DialogCloseButton onClick={onClose} />
      </DialogHeader>
      <DialogBody className="space-y-3">
        {entry ? (
          <>
            <div className="flex items-center gap-2">
              <MemoryTypeBadge type={entry.memoryType} />
              <code className="text-xs font-mono text-muted-foreground">{entry.key}</code>
            </div>
            <Textarea label="Value" value={value} onChange={(e) => setValue(e.target.value)} rows={8} className="font-mono text-sm" />
          </>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

interface AddDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

function AddMemoryDialog({ open, onClose, onSave }: AddDialogProps) {
  const [form, setForm] = useState({
    type: 'FACT' as MemoryType,
    key: '',
    value: '',
    expiresAt: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!form.key.trim() || !form.value.trim()) {
      setError('Key and value are required.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await memoryApi.create({
        type: form.type,
        key: form.key.trim(),
        value: parseMemoryValue(form.value),
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      });
      onSave();
      onClose();
      setForm({ type: 'FACT', key: '', value: '', expiresAt: '' });
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? 'Failed to create entry');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Add Memory Entry</DialogTitle>
        <DialogCloseButton onClick={onClose} />
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Type</label>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as MemoryType }))}
          >
            {MEMORY_TYPES.map((type) => (
              <option key={type} value={type}>{type.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <Input label="Key" placeholder="e.g. customer_greeting_template" value={form.key} onChange={(e) => setForm((prev) => ({ ...prev, key: e.target.value }))} />
        <Textarea label="Value" placeholder="Enter the memory value..." value={form.value} onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))} rows={6} className="font-mono text-sm" />
        <Input label="Expires At (optional)" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((prev) => ({ ...prev, expiresAt: e.target.value }))} />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" /> : <Plus className="h-3.5 w-3.5" />}
          {saving ? 'Saving...' : 'Add Entry'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export default function KnowledgePage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MemoryType | 'ALL'>('ALL');
  const [editEntry, setEditEntry] = useState<MemoryEntry | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (typeFilter !== 'ALL') params.set('type', typeFilter);
  if (search) params.set('search', search);

  const { data, isLoading, mutate } = useSWR<PaginatedMemory>(`/memory${params.toString() ? `?${params.toString()}` : ''}`, dataFetcher, {
    refreshInterval: 30_000,
  });

  const entries = data?.items ?? [];

  const grouped = useMemo(
    () => MEMORY_TYPES.reduce<Record<MemoryType, MemoryEntry[]>>((acc, type) => {
      acc[type] = entries.filter((entry) => entry.memoryType === type);
      return acc;
    }, {} as Record<MemoryType, MemoryEntry[]>),
    [entries],
  );

  const visibleTypes = typeFilter === 'ALL' ? MEMORY_TYPES.filter((type) => grouped[type].length > 0) : [typeFilter];

  const handleDelete = async (key: string) => {
    if (!confirm('Delete this memory entry?')) return;
    setDeletingKey(key);
    try {
      await memoryApi.delete(key);
      mutate();
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <BookOpen className="h-5 w-5 text-primary" />
            Knowledge Console
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Tenant memory backed by the live API memory store.</p>
        </div>
        <Button size="sm" onClick={() => setShowAddDialog(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Memory
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by key..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
          <button type="button" onClick={() => setTypeFilter('ALL')} className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors', typeFilter === 'ALL' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground')}>
            All
          </button>
          {MEMORY_TYPES.map((type) => (
            <button key={type} type="button" onClick={() => setTypeFilter(type)} className={cn('rounded-md px-2 py-1 text-xs font-medium transition-colors', typeFilter === type ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground')}>
              {type.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : entries.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-6 w-6" />} title="No memory entries found" description={search || typeFilter !== 'ALL' ? 'Try clearing filters.' : 'Add your first memory entry to get started.'} action={<Button size="sm" onClick={() => setShowAddDialog(true)}>Add Memory</Button>} />
      ) : (
        <div className="space-y-6">
          {visibleTypes.map((type) => {
            const items = grouped[type];
            if (items.length === 0) return null;

            return (
              <div key={type}>
                <div className="mb-3 flex items-center gap-2">
                  <MemoryTypeBadge type={type} />
                  <span className="text-xs text-muted-foreground">{items.length} entries</span>
                </div>
                <Card>
                  <div className="divide-y">
                    {items.map((entry) => (
                      <div key={entry.id} className="group flex items-start gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <code className="truncate text-xs font-mono font-semibold">{entry.key}</code>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">{entry.source}</span>
                          </div>
                          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs font-mono text-muted-foreground">{stringifyMemoryValue(entry.value)}</pre>
                          <p className="mt-1 text-xs text-muted-foreground">Updated {formatDistanceToNow(new Date(entry.updatedAt), { addSuffix: true })}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditEntry(entry)} aria-label={`Edit memory ${entry.key}`}>
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(entry.key)} disabled={deletingKey === entry.key} aria-label={`Delete memory ${entry.key}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      <EditDialog entry={editEntry} open={!!editEntry} onClose={() => setEditEntry(null)} onSave={() => mutate()} />
      <AddMemoryDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} onSave={() => mutate()} />
    </div>
  );
}