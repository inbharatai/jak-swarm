'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { BookOpen, CheckCircle2, Key, Shield, Trash2, Users, Wrench, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui/toast';
import { adminApi, apiKeyApi, dataFetcher, toolToggleApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui';

type ApprovalThreshold = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface TenantSettings {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  requireApprovals: boolean;
  approvalThreshold: ApprovalThreshold;
  maxConcurrentWorkflows: number;
  enableVoice: boolean;
  enableBrowserAutomation: boolean;
  allowedDomains: string[];
  logRetentionDays: number;
}

interface TenantUser {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  role: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PendingSkill {
  id: string;
  name: string;
  description: string;
  status: string;
  riskLevel: string;
  implementation?: string | null;
  sandboxResult?: { success?: boolean; output?: string; error?: string; durationMs?: number } | null;
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface PaginatedSkills {
  items: PendingSkill[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

function SettingsTab({ settings, onSave }: { settings?: TenantSettings; onSave: (updates: Partial<TenantSettings>) => Promise<void> }) {
  const [form, setForm] = useState({
    name: settings?.name ?? '',
    industry: settings?.industry ?? '',
    requireApprovals: settings?.requireApprovals ?? true,
    approvalThreshold: settings?.approvalThreshold ?? 'HIGH',
    maxConcurrentWorkflows: settings?.maxConcurrentWorkflows ?? 5,
    enableVoice: settings?.enableVoice ?? true,
    enableBrowserAutomation: settings?.enableBrowserAutomation ?? false,
    allowedDomains: settings?.allowedDomains.join(', ') ?? '',
    logRetentionDays: settings?.logRetentionDays ?? 90,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      name: settings.name,
      industry: settings.industry ?? '',
      requireApprovals: settings.requireApprovals,
      approvalThreshold: settings.approvalThreshold,
      maxConcurrentWorkflows: settings.maxConcurrentWorkflows,
      enableVoice: settings.enableVoice,
      enableBrowserAutomation: settings.enableBrowserAutomation,
      allowedDomains: settings.allowedDomains.join(', '),
      logRetentionDays: settings.logRetentionDays,
    });
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        name: form.name.trim(),
        industry: form.industry.trim() || null,
        requireApprovals: form.requireApprovals,
        approvalThreshold: form.approvalThreshold as ApprovalThreshold,
        maxConcurrentWorkflows: Number(form.maxConcurrentWorkflows),
        enableVoice: form.enableVoice,
        enableBrowserAutomation: form.enableBrowserAutomation,
        allowedDomains: form.allowedDomains.split(',').map((item) => item.trim()).filter(Boolean),
        logRetentionDays: Number(form.logRetentionDays),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tenant Settings</CardTitle>
          <CardDescription>These controls map to live tenant fields in the backend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Tenant Name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
            <Input label="Industry" value={form.industry} onChange={(e) => setForm((prev) => ({ ...prev, industry: e.target.value }))} placeholder="TECHNOLOGY" />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Approval Threshold</label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.approvalThreshold} onChange={(e) => setForm((prev) => ({ ...prev, approvalThreshold: e.target.value as ApprovalThreshold }))}>
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
            <Input label="Max Concurrent Workflows" type="number" min={1} max={50} value={form.maxConcurrentWorkflows} onChange={(e) => setForm((prev) => ({ ...prev, maxConcurrentWorkflows: Number(e.target.value) }))} />
            <Input label="Log Retention Days" type="number" min={1} value={form.logRetentionDays} onChange={(e) => setForm((prev) => ({ ...prev, logRetentionDays: Number(e.target.value) }))} />
          </div>
          <Textarea label="Allowed Domains" value={form.allowedDomains} onChange={(e) => setForm((prev) => ({ ...prev, allowedDomains: e.target.value }))} rows={3} placeholder="example.com, app.example.com" />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><input type="checkbox" checked={form.requireApprovals} onChange={(e) => setForm((prev) => ({ ...prev, requireApprovals: e.target.checked }))} />Require Approvals</label>
            <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><input type="checkbox" checked={form.enableVoice} onChange={(e) => setForm((prev) => ({ ...prev, enableVoice: e.target.checked }))} />Enable Voice</label>
            <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><input type="checkbox" checked={form.enableBrowserAutomation} onChange={(e) => setForm((prev) => ({ ...prev, enableBrowserAutomation: e.target.checked }))} />Enable Browser Automation</label>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</Button>
    </div>
  );
}

function ApiKeysTab() {
    const { data: keys, isLoading, mutate } = useSWR<ApiKey[]>('/tenants/current/api-keys', dataFetcher);
    const toast = useToast();
    const [creating, setCreating] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [newKeyScopes, setNewKeyScopes] = useState('read');
    const [revealedKey, setRevealedKey] = useState<string | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);

    const handleCreate = async () => {
      if (!newKeyName.trim()) return;
      setCreating(true);
      try {
        const res = await apiKeyApi.create({ name: newKeyName.trim(), scopes: newKeyScopes.split(',').map((s) => s.trim()).filter(Boolean) });
        setRevealedKey(res.key);
        setNewKeyName('');
        setNewKeyScopes('read');
        mutate();
        toast.success('API key created', 'Copy it now — it will not be shown again.');
      } catch (err) {
        toast.error('Failed to create API key', err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setCreating(false);
      }
    };

    const handleRevoke = async (id: string) => {
      setRevoking(id);
      try {
        await apiKeyApi.revoke(id);
        mutate();
        toast.success('API key revoked');
      } catch (err) {
        toast.error('Failed to revoke key', err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setRevoking(null);
      }
    };

    if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create API Key</CardTitle>
            <CardDescription>Keys are shown once at creation time. Treat them like passwords.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Key Name" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="ci-deploy-token" />
              <Input label="Scopes (comma-separated)" value={newKeyScopes} onChange={(e) => setNewKeyScopes(e.target.value)} placeholder="read, write" />
            </div>
            <Button onClick={handleCreate} disabled={creating || !newKeyName.trim()}>{creating ? 'Creating...' : 'Create Key'}</Button>
            {revealedKey ? (
              <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 dark:bg-yellow-900/10">
                <p className="mb-2 text-xs font-semibold text-yellow-800 dark:text-yellow-300">Copy this key now — it will not be shown again.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto rounded bg-muted/30 px-3 py-1.5 text-xs font-mono">{revealedKey}</code>
                  <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(revealedKey); toast.success('Copied'); }}>Copy</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRevealedKey(null)}>Dismiss</Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {!keys?.length ? (
          <EmptyState icon={<Key className="h-6 w-6" />} title="No API keys" description="Create an API key above to authenticate external integrations." />
        ) : (
          <Card>
            <div className="divide-y">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{k.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{k.keyPrefix}…</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {k.scopes.map((s) => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}
                    {k.expiresAt ? <span className="text-xs text-muted-foreground">exp {new Date(k.expiresAt).toLocaleDateString()}</span> : null}
                    {k.lastUsedAt ? <span className="text-xs text-muted-foreground">last used {new Date(k.lastUsedAt).toLocaleDateString()}</span> : null}
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={revoking === k.id} onClick={() => handleRevoke(k.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
}

interface ToolEntry {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  maturity?: string;
  riskClass?: string;
}

interface ToolMetadataResponse {
  name: string;
  description: string;
  category: string;
  riskClass: string;
  maturity?: string;
}

function ToolTogglesTab({ disabledToolNames }: { disabledToolNames: string[] }) {
    const toast = useToast();
    const [toggling, setToggling] = useState<string | null>(null);
    const [localOverrides, setLocalOverrides] = useState<Record<string, boolean>>({});

    // Pulls the real tool registry (119 classified tools with maturity + category).
    // Previously this panel rendered a hardcoded 9-tool demo list — now it reflects
    // exactly what toolRegistry.list() returns on the API.
    const { data: registryTools, isLoading, error } = useSWR<ToolMetadataResponse[]>(
      '/tools',
      dataFetcher,
      { revalidateOnFocus: false },
    );

    const tools: ToolEntry[] = (registryTools ?? []).map((t) => {
      const serverEnabled = !disabledToolNames.includes(t.name);
      const override = localOverrides[t.name];
      return {
        name: t.name,
        description: t.description,
        category: t.category,
        enabled: override ?? serverEnabled,
        maturity: t.maturity,
        riskClass: t.riskClass,
      };
    });

    const handleToggle = async (name: string, currentEnabled: boolean) => {
      setToggling(name);
      // Optimistic local override so the switch flips immediately while the
      // PATCH round-trips. Cleared once SWR refreshes tenant settings.
      setLocalOverrides((prev) => ({ ...prev, [name]: !currentEnabled }));
      try {
        await toolToggleApi.toggle(name, !currentEnabled);
        toast.success(`Tool ${!currentEnabled ? 'enabled' : 'disabled'}`);
      } catch (err) {
        // Roll back the optimistic override on failure.
        setLocalOverrides((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
        toast.error('Failed to update tool', err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setToggling(null);
      }
    };

    if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;
    if (error) {
      return (
        <EmptyState
          icon={<Wrench className="h-6 w-6" />}
          title="Couldn't load tools"
          description="The tool registry endpoint returned an error. Refresh to retry."
        />
      );
    }
    if (!tools.length) {
      return (
        <EmptyState
          icon={<Wrench className="h-6 w-6" />}
          title="No tools registered"
          description="Your tenant has no tools assigned. Contact an administrator."
        />
      );
    }

    const categories = [...new Set(tools.map((t) => t.category))].sort();
    const enabledCount = tools.filter((t) => t.enabled).length;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {enabledCount} of {tools.length} tools enabled &middot; {categories.length} categories
          </span>
          <span className="font-mono text-xs">live registry</span>
        </div>
        {categories.map((cat) => (
          <Card key={cat}>
            <CardHeader>
              <CardTitle className="text-sm capitalize">{cat.toLowerCase().replace(/_/g, ' ')}</CardTitle>
            </CardHeader>
            <div className="divide-y">
              {tools.filter((t) => t.category === cat).map((tool) => (
                <div key={tool.name} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn('truncate text-sm font-mono font-medium', !tool.enabled && 'text-muted-foreground line-through')}>{tool.name}</p>
                      {tool.maturity && tool.maturity !== 'real' && (
                        <Badge className="text-[10px] font-mono uppercase">{tool.maturity}</Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
                  </div>
                  <button
                    disabled={toggling === tool.name}
                    onClick={() => handleToggle(tool.name, tool.enabled)}
                    className={cn('relative h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring', tool.enabled ? 'bg-primary' : 'bg-input')}
                    role="switch"
                    aria-checked={tool.enabled}
                  >
                    <span className={cn('block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition-transform', tool.enabled ? 'translate-x-4' : 'translate-x-0.5')} />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    );
}

function UsersTab() {
  const { data: users, isLoading } = useSWR<TenantUser[]>('/tenants/current/users', dataFetcher);

  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (!users?.length) {
    return <EmptyState icon={<Users className="h-6 w-6" />} title="No users found" description="Users provisioned into this tenant will appear here." />;
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">{users.length} users</div>
      <Card>
        <div className="divide-y">
          {users.map((user) => (
            <div key={user.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name ?? user.email}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {!user.active ? <Badge variant="destructive" className="text-xs">Inactive</Badge> : null}
                <span className="text-xs text-muted-foreground">{user.role}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SkillsTab() {
  const { data, isLoading, mutate } = useSWR<PaginatedSkills>('/skills?status=PROPOSED', dataFetcher);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const skills = data?.items ?? [];

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
  if (!skills.length) {
    return <EmptyState icon={<BookOpen className="h-6 w-6" />} title="No pending skills" description="Proposed skills awaiting review will appear here." />;
  }

  return (
    <div className="space-y-4">
      {skills.map((skill) => (
        <Card key={skill.id}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-sm">{skill.name}</CardTitle>
                <CardDescription>{skill.description}</CardDescription>
              </div>
              <Badge variant="warning" className="text-xs">{skill.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {skill.implementation ? <pre className="max-h-40 overflow-x-auto rounded bg-muted/30 p-3 text-xs font-mono">{skill.implementation}</pre> : null}
            {skill.sandboxResult ? (
              <div className={cn('rounded-lg border p-3 text-sm', skill.sandboxResult.success ? 'border-green-300 bg-green-50 dark:bg-green-900/10' : 'border-destructive/30 bg-destructive/5')}>
                <div className="mb-1 flex items-center gap-2">
                  {skill.sandboxResult.success ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  <span className="text-xs font-semibold">Sandbox {skill.sandboxResult.success ? 'Passed' : 'Failed'}{skill.sandboxResult.durationMs ? ` · ${skill.sandboxResult.durationMs}ms` : ''}</span>
                </div>
                {skill.sandboxResult.output ? <pre className="text-xs font-mono">{skill.sandboxResult.output}</pre> : null}
                {skill.sandboxResult.error ? <pre className="text-xs font-mono text-destructive">{skill.sandboxResult.error}</pre> : null}
              </div>
            ) : null}
            <Input placeholder="Rejection reason..." value={rejectReason[skill.id] ?? ''} onChange={(e) => setRejectReason((prev) => ({ ...prev, [skill.id]: e.target.value }))} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => handleApprove(skill.id)} disabled={processingId === skill.id} className="gap-1.5 bg-green-600 text-white hover:bg-green-700"><CheckCircle2 className="h-3.5 w-3.5" />Approve</Button>
              <Button size="sm" variant="destructive" onClick={() => handleReject(skill.id)} disabled={processingId === skill.id || !rejectReason[skill.id]} className="gap-1.5"><XCircle className="h-3.5 w-3.5" />Reject</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { data: settings, mutate: refreshSettings } = useSWR<TenantSettings>('/tenants/current/settings', dataFetcher);

  if (user && user.role !== 'TENANT_ADMIN' && user.role !== 'SYSTEM_ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Shield className="mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="mb-2 text-lg font-semibold">Access Restricted</h2>
        <p className="mb-4 text-sm text-muted-foreground">The Admin Console requires the TENANT_ADMIN role.</p>
        <Button onClick={() => router.push('/workspace')}>Back to Workspace</Button>
      </div>
    );
  }

  const handleSaveSettings = async (updates: Partial<TenantSettings>) => {
    try {
      await adminApi.updateSettings(updates);
      refreshSettings();
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Failed to save settings', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Shield className="h-5 w-5 text-primary" />
          Admin Console
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Manage the admin flows that are wired to the live backend.</p>
      </div>

      <Tabs defaultValue="settings">
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="users"><Users className="mr-1.5 h-3.5 w-3.5" />Users</TabsTrigger>
            <TabsTrigger value="skills"><BookOpen className="mr-1.5 h-3.5 w-3.5" />Skills</TabsTrigger>
            <TabsTrigger value="api-keys"><Key className="mr-1.5 h-3.5 w-3.5" />API Keys</TabsTrigger>
            <TabsTrigger value="tools"><Wrench className="mr-1.5 h-3.5 w-3.5" />Tools</TabsTrigger>
          </TabsList>

          <TabsContent value="settings"><SettingsTab settings={settings} onSave={handleSaveSettings} /></TabsContent>
          <TabsContent value="users"><UsersTab /></TabsContent>
          <TabsContent value="skills"><SkillsTab /></TabsContent>
          <TabsContent value="api-keys"><ApiKeysTab /></TabsContent>
          <TabsContent value="tools"><ToolTogglesTab disabledToolNames={(settings as any)?.disabledToolNames ?? []} /></TabsContent>
      </Tabs>
    </div>
  );
}