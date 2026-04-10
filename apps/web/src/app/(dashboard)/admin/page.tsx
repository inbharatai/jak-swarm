'use client';

import React, { useState } from 'react';
import { useToast } from '@/components/ui/toast';
import {
  Shield,
  Users,
  Key,
  Wrench,
  BookOpen,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Button, Badge, Tabs, TabsList, TabsTrigger, TabsContent,
  Input, Spinner, EmptyState, Avatar,
} from '@/components/ui';
import { adminApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { apiClient, fetcher } from '@/lib/api-client';
import type { User, Skill, ApiKey, TenantSettings } from '@/types';
import { format, formatDistanceToNow } from 'date-fns';

type AdminTab = 'settings' | 'users' | 'skills' | 'tools' | 'api-keys';

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab({ settings, onSave }: { settings?: TenantSettings; onSave: (s: Partial<TenantSettings>) => void }) {
  const [thresholds, setThresholds] = useState(settings?.approvalThresholds ?? {
    LOW: false, MEDIUM: true, HIGH: true, CRITICAL: true,
  });
  const [maxAgents, setMaxAgents] = useState(settings?.maxConcurrentAgents ?? 5);
  const [maxTokens, setMaxTokens] = useState(settings?.maxTokensPerWorkflow ?? 100000);
  const [maxCost, setMaxCost] = useState(settings?.maxCostPerWorkflow ?? 5.0);

  const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
  const RISK_COLORS: Record<string, string> = {
    LOW: 'text-green-600', MEDIUM: 'text-yellow-600', HIGH: 'text-orange-600', CRITICAL: 'text-red-600',
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Approval thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approval Thresholds</CardTitle>
          <CardDescription>
            Configure which risk levels require human approval before execution
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {RISK_LEVELS.map(level => (
              <div key={level} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle className={cn('h-4 w-4', RISK_COLORS[level])} />
                  <span className="text-sm font-medium">{level} Risk</span>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={thresholds[level] ?? false}
                    onChange={e => setThresholds(prev => ({ ...prev, [level]: e.target.checked }))}
                  />
                  <div className="peer h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-5" />
                </label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Resource limits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resource Limits</CardTitle>
          <CardDescription>Control compute and cost boundaries per workflow</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Max Concurrent Agents"
              type="number"
              min={1} max={20}
              value={maxAgents}
              onChange={e => setMaxAgents(Number(e.target.value))}
            />
            <Input
              label="Max Tokens / Workflow"
              type="number"
              min={1000}
              value={maxTokens}
              onChange={e => setMaxTokens(Number(e.target.value))}
            />
            <Input
              label="Max Cost / Workflow ($)"
              type="number"
              min={0.01} step={0.01}
              value={maxCost}
              onChange={e => setMaxCost(Number(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => onSave({ approvalThresholds: thresholds, maxConcurrentAgents: maxAgents, maxTokensPerWorkflow: maxTokens, maxCostPerWorkflow: maxCost })}>
        Save Settings
      </Button>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const { data: users, isLoading, mutate } = useSWR<User[]>('/admin/users', fetcher);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const ROLES = ['VIEWER', 'OPERATOR', 'MANAGER', 'TENANT_ADMIN'] as const;

  const handleRoleChange = async (userId: string, role: string) => {
    setUpdatingId(userId);
    try {
      await adminApi.updateUserRole(userId, role);
      mutate();
    } finally {
      setUpdatingId(null);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{users?.length ?? 0} users</p>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Invite User
        </Button>
      </div>

      <Card>
        <div className="divide-y">
          {users?.map(user => (
            <div key={user.id} className="flex items-center gap-4 px-4 py-3">
              <Avatar name={user.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {!user.isActive && (
                  <Badge variant="destructive" className="text-xs">Inactive</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {user.lastLoginAt ? formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true }) : 'Never'}
                </span>
                <select
                  value={user.role}
                  onChange={e => handleRoleChange(user.id, e.target.value)}
                  disabled={updatingId === user.id}
                  className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {ROLES.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Skills Tab ───────────────────────────────────────────────────────────────

function SkillsTab() {
  const { data: skills, isLoading, mutate } = useSWR<Skill[]>('/admin/skills?status=pending', fetcher);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    try {
      await adminApi.approveSkill(id);
      mutate();
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    setProcessingId(id);
    try {
      await adminApi.rejectSkill(id, rejectReason[id] ?? 'Rejected by admin');
      mutate();
    } finally {
      setProcessingId(null);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (!skills?.length) {
    return (
      <EmptyState
        icon={<BookOpen className="h-6 w-6" />}
        title="No pending skills"
        description="Proposed skills awaiting review will appear here"
      />
    );
  }

  return (
    <div className="space-y-4">
      {skills.map(skill => (
        <Card key={skill.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-sm">{skill.name}</CardTitle>
                <CardDescription>{skill.description}</CardDescription>
              </div>
              <Badge variant="warning" className="text-xs">Pending Review</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Code preview */}
            <pre className="text-xs bg-muted/30 rounded p-3 overflow-x-auto max-h-32 font-mono">
              {skill.code}
            </pre>

            {/* Sandbox result */}
            {skill.sandboxResult && (
              <div className={cn(
                'rounded-lg border p-3 text-sm',
                skill.sandboxResult.success ? 'border-green-300 bg-green-50 dark:bg-green-900/10' : 'border-destructive/30 bg-destructive/5',
              )}>
                <div className="flex items-center gap-2 mb-1">
                  {skill.sandboxResult.success ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-xs font-semibold">
                    Sandbox {skill.sandboxResult.success ? 'Passed' : 'Failed'} · {skill.sandboxResult.durationMs}ms
                  </span>
                </div>
                {skill.sandboxResult.output && (
                  <pre className="text-xs font-mono">{skill.sandboxResult.output}</pre>
                )}
                {skill.sandboxResult.error && (
                  <pre className="text-xs font-mono text-destructive">{skill.sandboxResult.error}</pre>
                )}
              </div>
            )}

            {/* Reject reason */}
            <Input
              placeholder="Rejection reason (required to reject)…"
              value={rejectReason[skill.id] ?? ''}
              onChange={e => setRejectReason(prev => ({ ...prev, [skill.id]: e.target.value }))}
            />

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleApprove(skill.id)}
                disabled={processingId === skill.id}
                className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleReject(skill.id)}
                disabled={processingId === skill.id || !rejectReason[skill.id]}
                className="gap-1.5"
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Tools Tab ────────────────────────────────────────────────────────────────

function ToolsTab() {
  const { data: tools, isLoading, mutate } = useSWR<{ id: string; name: string; description: string; enabled: boolean }[]>(
    '/admin/tools',
    fetcher,
  );
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleToggle = async (toolId: string, enabled: boolean) => {
    setTogglingId(toolId);
    try {
      await adminApi.toggleTool(toolId, enabled);
      mutate();
    } finally {
      setTogglingId(null);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <Card>
      <div className="divide-y">
        {tools?.map(tool => (
          <div key={tool.id} className="flex items-center gap-4 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
              <Wrench className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{tool.name}</p>
              <p className="text-xs text-muted-foreground">{tool.description}</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={tool.enabled}
                disabled={togglingId === tool.id}
                onChange={e => handleToggle(tool.id, e.target.checked)}
              />
              <div className="peer h-5 w-9 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-4" />
            </label>
          </div>
        ))}
        {!tools?.length && (
          <div className="px-4 py-8">
            <EmptyState
              icon={<Wrench className="h-5 w-5" />}
              title="No tools configured"
              description="Tools will appear here once connected"
            />
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── API Keys Tab ─────────────────────────────────────────────────────────────

function ApiKeysTab() {
  const { data: apiKeys, isLoading, mutate } = useSWR<ApiKey[]>('/admin/api-keys', fetcher);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const result = await adminApi.createApiKey(newKeyName, ['read', 'write']) as { key: string };
      setNewKey(result.key);
      mutate();
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this API key? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await adminApi.deleteApiKey(id);
      mutate();
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <div className="space-y-4">
      {/* Create new key */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Create New API Key</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="Key name (e.g. Production Backend)"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleCreate} disabled={creating || !newKeyName.trim()} className="gap-1.5 shrink-0">
              <Plus className="h-3.5 w-3.5" />
              Create
            </Button>
          </div>

          {newKey && (
            <div className="mt-3 rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/10 p-3">
              <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">
                Save this key — it won&apos;t be shown again!
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono flex-1 break-all">{newKey}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(newKey); }}
                  className="text-xs text-green-600 hover:underline shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Keys list */}
      <Card>
        <div className="divide-y">
          {apiKeys?.map(key => (
            <div key={key.id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
                <Key className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{key.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <code className="text-xs text-muted-foreground font-mono">{key.keyPreview}…</code>
                  <span className="text-xs text-muted-foreground">
                    Created {format(new Date(key.createdAt), 'MMM d, yyyy')}
                  </span>
                  {key.lastUsedAt && (
                    <span className="text-xs text-muted-foreground">
                      · Used {formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {key.expiresAt && new Date(key.expiresAt) < new Date() && (
                  <Badge variant="destructive" className="text-xs">Expired</Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(key.id)}
                  disabled={deletingId === key.id}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {!apiKeys?.length && (
            <div className="px-4 py-8">
              <EmptyState
                icon={<Key className="h-5 w-5" />}
                title="No API keys"
                description="Create a key to authenticate API requests"
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  if (user && user.role !== 'TENANT_ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Shield className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-2">Access Restricted</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The Admin Console requires the TENANT_ADMIN role.
        </p>
        <Button onClick={() => router.push('/workspace')}>Back to Workspace</Button>
      </div>
    );
  }

  const { data: settings, mutate: refreshSettings } = useSWR<TenantSettings>(
    '/admin/settings',
    fetcher,
  );

  const handleSaveSettings = async (data: Partial<TenantSettings>) => {
    try {
      await adminApi.updateSettings(data);
      refreshSettings();
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Failed to save settings', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Admin Console
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your tenant settings, users, tools, and API keys
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="settings">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="users">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Users
          </TabsTrigger>
          <TabsTrigger value="skills">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            Skills
          </TabsTrigger>
          <TabsTrigger value="tools">
            <Wrench className="h-3.5 w-3.5 mr-1.5" />
            Tools
          </TabsTrigger>
          <TabsTrigger value="api-keys">
            <Key className="h-3.5 w-3.5 mr-1.5" />
            API Keys
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings">
          <SettingsTab settings={settings} onSave={handleSaveSettings} />
        </TabsContent>

        <TabsContent value="users">
          <UsersTab />
        </TabsContent>

        <TabsContent value="skills">
          <SkillsTab />
        </TabsContent>

        <TabsContent value="tools">
          <ToolsTab />
        </TabsContent>

        <TabsContent value="api-keys">
          <ApiKeysTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
