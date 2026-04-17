'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { BookOpen, CheckCircle2, Shield, Users, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui/toast';
import { adminApi, dataFetcher } from '@/lib/api-client';
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

      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          API keys and per-tool toggles are intentionally hidden until backend authentication and enforcement are fully implemented. This console only exposes settings, users, and skill review paths that work end to end today.
        </CardContent>
      </Card>

      <Tabs defaultValue="settings">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="users"><Users className="mr-1.5 h-3.5 w-3.5" />Users</TabsTrigger>
          <TabsTrigger value="skills"><BookOpen className="mr-1.5 h-3.5 w-3.5" />Skills</TabsTrigger>
        </TabsList>

        <TabsContent value="settings"><SettingsTab settings={settings} onSave={handleSaveSettings} /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="skills"><SkillsTab /></TabsContent>
      </Tabs>
    </div>
  );
}