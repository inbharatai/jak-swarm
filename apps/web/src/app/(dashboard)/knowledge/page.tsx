'use client';

import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  Plus,
  Trash2,
  Edit3,
  X,
  Save,
  Filter,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Badge, Input, Spinner, EmptyState,
  Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogCloseButton,
  Textarea,
  Select,
} from '@/components/ui';
import useSWR from 'swr';
import { memoryApi, apiClient } from '@/lib/api-client';
import type { MemoryEntry, MemoryType } from '@/types';
import { format, formatDistanceToNow } from 'date-fns';

const MEMORY_TYPES: MemoryType[] = ['WORKFLOW', 'USER_PREF', 'KNOWLEDGE', 'POLICY', 'SKILL_REGISTRY'];

const MEMORY_TYPE_COLORS: Record<MemoryType, string> = {
  WORKFLOW: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400',
  USER_PREF: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400',
  KNOWLEDGE: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400',
  POLICY: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400',
  SKILL_REGISTRY: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400',
};

function MemoryTypeBadge({ type }: { type: MemoryType }) {
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium', MEMORY_TYPE_COLORS[type])}>
      {type}
    </span>
  );
}

function truncateValue(value: string, maxLen = 80): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + '…';
}

// ─── Edit Dialog ──────────────────────────────────────────────────────────────

interface EditDialogProps {
  entry: MemoryEntry | null;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

function EditDialog({ entry, open, onClose, onSave }: EditDialogProps) {
  const [value, setValue] = useState(entry?.value ?? '');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    setValue(entry?.value ?? '');
  }, [entry]);

  const handleSave = async () => {
    if (!entry) return;
    setSaving(true);
    try {
      await memoryApi.update(entry.id, value);
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
        {entry && (
          <>
            <div className="flex items-center gap-2">
              <MemoryTypeBadge type={entry.type} />
              <code className="text-xs font-mono text-muted-foreground">{entry.key}</code>
            </div>
            <Textarea
              label="Value"
              value={value}
              onChange={e => setValue(e.target.value)}
              rows={6}
              className="font-mono text-sm"
            />
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ─── Add Memory Dialog ────────────────────────────────────────────────────────

interface AddDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

function AddMemoryDialog({ open, onClose, onSave }: AddDialogProps) {
  const [form, setForm] = useState({
    type: 'KNOWLEDGE' as MemoryType,
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
        value: form.value.trim(),
        expiresAt: form.expiresAt || undefined,
      });
      onSave();
      onClose();
      setForm({ type: 'KNOWLEDGE', key: '', value: '', expiresAt: '' });
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
        <Select
          label="Type"
          value={form.type}
          onChange={e => setForm(prev => ({ ...prev, type: e.target.value as MemoryType }))}
          options={MEMORY_TYPES.map(t => ({ value: t, label: t }))}
        />
        <Input
          label="Key"
          placeholder="e.g. customer_greeting_template"
          value={form.key}
          onChange={e => setForm(prev => ({ ...prev, key: e.target.value }))}
        />
        <Textarea
          label="Value"
          placeholder="Enter the memory value…"
          value={form.value}
          onChange={e => setForm(prev => ({ ...prev, value: e.target.value }))}
          rows={4}
          className="font-mono text-sm"
        />
        <Input
          label="Expires At (optional)"
          type="datetime-local"
          value={form.expiresAt}
          onChange={e => setForm(prev => ({ ...prev, expiresAt: e.target.value }))}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" /> : <Plus className="h-3.5 w-3.5" />}
          Add Entry
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MemoryType | 'ALL'>('ALL');
  const [editEntry, setEditEntry] = useState<MemoryEntry | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (typeFilter !== 'ALL') params.set('type', typeFilter);
  if (search) params.set('search', search);
  const qs = params.toString();

  const { data, isLoading, mutate } = useSWR<{ data: MemoryEntry[]; total: number }>(
    `/api/memory${qs ? `?${qs}` : ''}`,
    url => apiClient.get(url),
    { refreshInterval: 30_000 },
  );

  const entries = data?.data ?? [];

  // Group by type
  const grouped = MEMORY_TYPES.reduce<Record<MemoryType, MemoryEntry[]>>((acc, type) => {
    acc[type] = entries.filter(e => e.type === type);
    return acc;
  }, {} as Record<MemoryType, MemoryEntry[]>);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory entry?')) return;
    setDeletingId(id);
    try {
      await memoryApi.delete(id);
      mutate();
    } finally {
      setDeletingId(null);
    }
  };

  const visibleTypes = typeFilter === 'ALL'
    ? MEMORY_TYPES.filter(t => grouped[t].length > 0)
    : [typeFilter];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Knowledge Console
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tenant memory, preferences, policies, and knowledge entries
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAddDialog(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Memory
        </Button>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by key or value…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
          <button
            onClick={() => setTypeFilter('ALL')}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              typeFilter === 'ALL' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            All
          </button>
          {MEMORY_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                typeFilter === t ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.replace('_', ' ')}
              {grouped[t].length > 0 && (
                <span className="ml-1 text-muted-foreground">({grouped[t].length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title="No memory entries found"
          description={search || typeFilter !== 'ALL' ? 'Try clearing filters' : 'Add your first memory entry to get started'}
          action={
            <Button onClick={() => setShowAddDialog(true)} size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add Memory
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {visibleTypes.map(type => {
            const typeEntries = typeFilter === 'ALL' ? grouped[type] : entries;
            if (typeEntries.length === 0) return null;

            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-3">
                  <MemoryTypeBadge type={type} />
                  <span className="text-xs text-muted-foreground">{typeEntries.length} entries</span>
                </div>

                <Card>
                  <div className="divide-y">
                    {typeEntries.map(entry => (
                      <div key={entry.id} className="group flex items-start gap-4 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <code className="text-xs font-mono font-semibold">{entry.key}</code>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">{entry.source}</span>
                            {entry.expiresAt && (
                              <>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span className={cn('text-xs', new Date(entry.expiresAt) < new Date() ? 'text-destructive' : 'text-muted-foreground')}>
                                  {new Date(entry.expiresAt) < new Date()
                                    ? 'Expired'
                                    : `Expires ${formatDistanceToNow(new Date(entry.expiresAt), { addSuffix: true })}`}
                                </span>
                              </>
                            )}
                          </div>
                          <p className="text-sm font-mono text-muted-foreground break-words">
                            {truncateValue(entry.value)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Updated {formatDistanceToNow(new Date(entry.updatedAt), { addSuffix: true })}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setEditEntry(entry)}
                            title="Edit"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(entry.id)}
                            disabled={deletingId === entry.id}
                            title="Delete"
                          >
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

      {/* Edit dialog */}
      <EditDialog
        entry={editEntry}
        open={!!editEntry}
        onClose={() => setEditEntry(null)}
        onSave={() => mutate()}
      />

      {/* Add dialog */}
      <AddMemoryDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onSave={() => mutate()}
      />
    </div>
  );
}
