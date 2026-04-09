'use client';

import React, { useState } from 'react';
import { BookOpen, Search, Plus, Trash2, Edit3, Save, Filter } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Input, Spinner, EmptyState, Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogCloseButton, Textarea, Select } from '@/components/ui';
import useSWR from 'swr';
import { memoryApi, fetcher } from '@/lib/api-client';
import type { MemoryEntry, MemoryType } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import type { ModuleProps } from '@/modules/registry';

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

function EditDialog({ entry, open, onClose, onSave }: { entry: MemoryEntry | null; open: boolean; onClose: () => void; onSave: () => void }) {
  const [value, setValue] = useState(entry?.value ?? '');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => { setValue(entry?.value ?? ''); }, [entry]);

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
            <Textarea label="Value" value={value} onChange={e => setValue(e.target.value)} rows={6} className="font-mono text-sm" />
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}><Save className="h-3.5 w-3.5 mr-1" />{saving ? 'Saving...' : 'Save'}</Button>
      </DialogFooter>
    </Dialog>
  );
}

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [type, setType] = useState<MemoryType>('KNOWLEDGE');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!key.trim() || !value.trim()) return;
    setSaving(true);
    try {
      await memoryApi.create({ key, value, type });
      onCreated();
      onClose();
      setKey(''); setValue(''); setType('KNOWLEDGE');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Add Memory Entry</DialogTitle>
        <DialogCloseButton onClick={onClose} />
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Select label="Type" value={type} onChange={e => setType(e.target.value as MemoryType)} options={MEMORY_TYPES.map(t => ({ value: t, label: t }))} />
        <Input label="Key" value={key} onChange={e => setKey(e.target.value)} placeholder="e.g. brand-voice" />
        <Textarea label="Value" value={value} onChange={e => setValue(e.target.value)} rows={4} placeholder="Enter memory content..." />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Create'}</Button>
      </DialogFooter>
    </Dialog>
  );
}

export default function KnowledgeModule({ moduleId, isActive }: ModuleProps) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<MemoryType | ''>('');
  const [editEntry, setEditEntry] = useState<MemoryEntry | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, mutate } = useSWR<{ data: MemoryEntry[] }>(
    '/memory',
    fetcher,
  );
  const entries = data?.data ?? [];

  const filtered = entries.filter(e => {
    if (filterType && e.type !== filterType) return false;
    if (search && !e.key.toLowerCase().includes(search.toLowerCase()) && !e.value.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleDelete = async (id: string) => {
    await memoryApi.delete(id);
    mutate();
  };

  if (isLoading) return <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>;

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" />Knowledge Base</h2>
          <p className="text-xs text-muted-foreground">{entries.length} entries stored</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="pl-8 h-8 w-40 text-xs" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="h-8 rounded-md border bg-background px-2 text-xs" value={filterType} onChange={e => setFilterType(e.target.value as MemoryType | '')}>
            <option value="">All types</option>
            {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-10 w-10" />} title="No memory entries" description="Add knowledge entries that agents can reference during workflows" />
      ) : (
        <div className="space-y-2">
          {filtered.map(entry => (
            <Card key={entry.id} className="group">
              <CardContent className="p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <MemoryTypeBadge type={entry.type} />
                    <code className="text-xs font-mono font-medium truncate">{entry.key}</code>
                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 font-mono">{entry.value}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => setEditEntry(entry)} className="p-1 rounded hover:bg-muted"><Edit3 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => handleDelete(entry.id)} className="p-1 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditDialog entry={editEntry} open={!!editEntry} onClose={() => setEditEntry(null)} onSave={() => mutate()} />
      <CreateDialog open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => mutate()} />
    </div>
  );
}
