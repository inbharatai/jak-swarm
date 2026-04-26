'use client';

/**
 * /audit/runs — Audit run workspace index
 *
 * Lists all audit engagements for the tenant. Real backend wiring via
 * auditRunsApi.list / .create. No mock data — empty state when there are
 * no runs.
 *
 * RBAC:
 *   - Read access: any authenticated tenant member
 *   - Create / cancel: REVIEWER+ (the API enforces; UI shows the button only
 *     when the role allows)
 */

import React, { useState } from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import {
  ClipboardCheck, Plus, RefreshCw, AlertCircle, ShieldCheck, ChevronRight,
} from 'lucide-react';
import {
  auditRunsApi,
  complianceApi,
  type AuditRunSummary,
  type AuditRunStatusClient,
  type ComplianceFramework,
} from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogCloseButton,
  EmptyState, Input, Select, Spinner, Textarea,
} from '@/components/ui';
import { useToast } from '@/components/ui/toast';

const STATUS_BADGE: Record<AuditRunStatusClient, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  PLANNING: { variant: 'outline', label: 'Planning' },
  PLANNED: { variant: 'secondary', label: 'Planned' },
  MAPPING: { variant: 'secondary', label: 'Mapping' },
  TESTING: { variant: 'secondary', label: 'Testing' },
  REVIEWING: { variant: 'secondary', label: 'Reviewing' },
  READY_TO_PACK: { variant: 'default', label: 'Ready to pack' },
  FINAL_PACK: { variant: 'default', label: 'Final pack' },
  COMPLETED: { variant: 'default', label: 'Completed' },
  FAILED: { variant: 'destructive', label: 'Failed' },
  CANCELLED: { variant: 'outline', label: 'Cancelled' },
};

const RISK_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  low: { variant: 'outline', label: 'Low risk' },
  medium: { variant: 'secondary', label: 'Medium risk' },
  high: { variant: 'destructive', label: 'High risk' },
  critical: { variant: 'destructive', label: 'Critical risk' },
};

export default function AuditRunsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, error, isLoading, mutate: refresh } = useSWR(
    'audit:runs:list',
    () => auditRunsApi.list({ limit: 100 }),
    { refreshInterval: 30_000 },
  );

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const role = String(user?.role ?? '').toUpperCase();
  const canEdit = role === 'TENANT_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'ADMIN' || role === 'REVIEWER';

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" />
            Audit Runs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Engagement workspace — control tests, exceptions, workpapers, signed final pack.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New audit run
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3 text-destructive">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Could not load audit runs</p>
                <p className="text-sm mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
                <p className="text-xs mt-2 text-muted-foreground">
                  If the audit_runs table is missing, deploy migration 15_audit_runs.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : data && data.items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<ShieldCheck className="h-8 w-8" />}
              title="No audit runs yet"
              description="Start your first compliance engagement — pick a framework, set the period, and JAK will plan, test, and pack the audit."
              {...(canEdit ? {
                action: (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create first run
                  </Button>
                ),
              } : {})}
            />
          </CardContent>
        </Card>
      ) : data ? (
        <div className="grid gap-3">
          {data.items.map((r) => <RunCard key={r.id} run={r} />)}
        </div>
      ) : null}

      {createOpen && (
        <CreateRunDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void mutate('audit:runs:list');
            toast.success('Audit run created');
          }}
          onError={(msg) => toast.error('Could not create run', msg)}
        />
      )}
    </div>
  );
}

function RunCard({ run }: { run: AuditRunSummary }) {
  const status = STATUS_BADGE[run.status] ?? { variant: 'outline' as const, label: run.status };
  const risk = run.riskSummary ? RISK_BADGE[run.riskSummary] : null;

  return (
    <Link href={`/audit/runs/${run.id}`} className="block">
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold truncate">{run.title}</h3>
                <Badge variant={status.variant}>{status.label}</Badge>
                {risk && <Badge variant={risk.variant}>{risk.label}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {run.frameworkSlug} · {new Date(run.periodStart).toISOString().slice(0, 10)} → {new Date(run.periodEnd).toISOString().slice(0, 10)}
              </p>
              {run.scope && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{run.scope}</p>}
            </div>
            <div className="flex items-center gap-4">
              {run.coveragePercent !== null && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Coverage</p>
                  <p className="text-lg font-bold">{run.coveragePercent.toFixed(1)}%</p>
                </div>
              )}
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function CreateRunDialog({
  onClose, onCreated, onError,
}: { onClose: () => void; onCreated: () => void; onError: (msg: string) => void }) {
  const [frameworkSlug, setFrameworkSlug] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [periodStart, setPeriodStart] = useState(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const { data: frameworksData } = useSWR<{ frameworks: ComplianceFramework[] }>(
    'compliance:frameworks',
    () => complianceApi.listFrameworks(),
  );
  const frameworks = frameworksData?.frameworks ?? [];

  React.useEffect(() => {
    if (!frameworkSlug && frameworks.length > 0) setFrameworkSlug(frameworks[0]!.slug);
  }, [frameworks, frameworkSlug]);

  async function handleSubmit() {
    if (!frameworkSlug || !title || !periodStart || !periodEnd) {
      onError('All fields are required');
      return;
    }
    if (new Date(periodEnd) <= new Date(periodStart)) {
      onError('Period end must be after period start');
      return;
    }
    setBusy(true);
    try {
      await auditRunsApi.create({
        frameworkSlug,
        title,
        ...(scope ? { scope } : {}),
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
      });
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Create new audit run</DialogTitle>
        <DialogCloseButton onClick={onClose} />
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <Select
            label="Framework"
            value={frameworkSlug}
            onChange={(e) => setFrameworkSlug(e.target.value)}
            options={frameworks.length === 0
              ? [{ value: '', label: 'Loading frameworks...' }]
              : frameworks.map((f) => ({ value: f.slug, label: f.name }))}
          />
          <Input label="Title" placeholder="Q1 2026 SOC 2 readiness" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea
            label="Scope (optional)"
            placeholder="Production cluster + customer support workflows"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            rows={2}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Period start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            <Input label="Period end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={busy || !title || !frameworkSlug}>
          {busy ? <><Spinner size="sm" className="mr-2" /> Creating...</> : 'Create run'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
