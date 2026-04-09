'use client';

import React, { useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { Shield, Users, Key, Wrench, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, Tabs, TabsList, TabsTrigger, TabsContent, Input, Spinner, EmptyState } from '@/components/ui';
import { adminApi, fetcher, apiClient } from '@/lib/api-client';
import useSWR from 'swr';
import type { User, Skill, ApiKey, TenantSettings } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import type { ModuleProps } from '@/modules/registry';

type AdminTab = 'settings' | 'users' | 'skills' | 'api-keys';

function SettingsTab({ settings, onSave }: { settings?: TenantSettings; onSave: (s: Partial<TenantSettings>) => void }) {
  const [thresholds, setThresholds] = useState(settings?.approvalThresholds ?? { LOW: false, MEDIUM: true, HIGH: true, CRITICAL: true });
  const [maxAgents, setMaxAgents] = useState(settings?.maxConcurrentAgents ?? 5);
  const [maxTokens, setMaxTokens] = useState(settings?.maxTokensPerWorkflow ?? 100000);
  const [maxCost, setMaxCost] = useState(settings?.maxCostPerWorkflow ?? 5.0);

  const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
  const RISK_COLORS: Record<string, string> = { LOW: 'text-green-600', MEDIUM: 'text-yellow-600', HIGH: 'text-orange-600', CRITICAL: 'text-red-600' };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader><CardTitle className="text-sm">Approval Thresholds</CardTitle><CardDescription className="text-xs">Risk levels requiring human approval</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {RISK_LEVELS.map(level => (
            <div key={level} className="flex items-center justify-between">
              <div className="flex items-center gap-2"><AlertTriangle className={cn('h-4 w-4', RISK_COLORS[level])} /><span className="text-sm">{level}</span></div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" className="sr-only peer" checked={thresholds[level] ?? false} onChange={e => setThresholds(prev => ({ ...prev, [level]: e.target.checked }))} />
                <div className="peer h-5 w-9 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-4" />
              </label>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Resource Limits</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Input label="Max Agents" type="number" min={1} max={20} value={maxAgents} onChange={e => setMaxAgents(Number(e.target.value))} />
          <Input label="Max Tokens" type="number" min={1000} value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))} />
          <Input label="Max Cost ($)" type="number" step={0.5} min={0.1} value={maxCost} onChange={e => setMaxCost(Number(e.target.value))} />
        </CardContent>
      </Card>
      <Button onClick={() => onSave({ approvalThresholds: thresholds, maxConcurrentAgents: maxAgents, maxTokensPerWorkflow: maxTokens, maxCostPerWorkflow: maxCost })}>Save Settings</Button>
    </div>
  );
}

function UsersTab() {
  const { data, isLoading } = useSWR<{ data: User[] }>('/tenants/current/users', fetcher);
  const users = data?.data ?? [];
  if (isLoading) return <Spinner size="lg" />;
  if (!users.length) return <EmptyState icon={<Users className="h-10 w-10" />} title="No users" />;

  return (
    <div className="space-y-2 max-w-2xl">
      {users.map(user => (
        <Card key={user.id}>
          <CardContent className="p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{user.name ?? user.email}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Badge variant={user.role === 'TENANT_ADMIN' || user.role === 'SYSTEM_ADMIN' ? 'default' : 'secondary'} className="text-[10px]">{user.role}</Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ApiKeysTab() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ data: ApiKey[] }>('/tenants/current/api-keys', fetcher);
  const keys = data?.data ?? [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await adminApi.createApiKey(name, ['read']);
      toast.success('API key created');
      setName('');
      mutate();
    } catch {
      toast.error('Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    await adminApi.deleteApiKey(id);
    mutate();
  };

  if (isLoading) return <Spinner size="lg" />;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <Input placeholder="Key name" value={name} onChange={e => setName(e.target.value)} className="max-w-xs" />
        <Button size="sm" onClick={handleCreate} disabled={creating}><Plus className="h-3.5 w-3.5 mr-1" />{creating ? 'Creating...' : 'Create Key'}</Button>
      </div>
      {keys.map(key => (
        <Card key={key.id}>
          <CardContent className="p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{key.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{key.keyPreview ?? '••••••••'}</p>
              <p className="text-[10px] text-muted-foreground">Created {formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })}</p>
            </div>
            <button onClick={() => handleRevoke(key.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminModule({ moduleId, isActive }: ModuleProps) {
  const toast = useToast();
  const { data: settingsData, mutate: mutateSettings } = useSWR<{ data: TenantSettings }>('/tenants/current/settings', fetcher);

  const handleSaveSettings = async (updates: Partial<TenantSettings>) => {
    try {
      await adminApi.updateSettings(updates);
      toast.success('Settings saved');
      mutateSettings();
    } catch {
      toast.error('Failed to save settings');
    }
  };

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-auto">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Shield className="h-5 w-5 text-primary" />Admin</h2>
        <p className="text-xs text-muted-foreground">System administration and tenant configuration</p>
      </div>

      <Tabs defaultValue="settings" className="flex-1">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
        </TabsList>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab settings={settingsData?.data} onSave={handleSaveSettings} />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="api-keys" className="mt-4">
          <ApiKeysTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
