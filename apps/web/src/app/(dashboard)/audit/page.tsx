'use client';

/**
 * Audit & Compliance — v0
 *
 * Four read-only tabs over the foundation:
 *   - Dashboard: high-level metrics (workflow counts, approvals, artifacts)
 *   - Audit Log: paginated AuditLog with filters (action / resource / dates / search)
 *   - Reviewer Queue: pending workflow approvals + pending artifact downloads
 *   - Workflow Trail: drill into one workflow's chronological event stream
 *
 * Honest UI rules:
 *   - Empty states are clear ("No audit log entries match this filter")
 *   - When the artifact migration isn't deployed, the Dashboard shows
 *     "Artifact storage not provisioned" instead of a silent zero card.
 *   - All filters are real (server-applied), not client-side mocks.
 *   - "Approve / reject" actions on the reviewer queue use the real
 *     approval and artifact endpoints — no stubs.
 *
 * What this page is NOT (Phase 2 roadmap):
 *   - Custom control framework mappings (SOC2, HIPAA)
 *   - Auto-generated control attestations
 *   - Scheduled S3/GCS exports
 *   - Multi-tenant aggregate reporting
 */

import React, { useState, useMemo } from 'react';
import useSWR from 'swr';
import {
  BarChart3,
  Clock,
  FileSearch,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  auditApi,
  approvalApi,
  type AuditDashboard,
  type AuditLogPage,
  type ReviewerQueue,
  type WorkflowTrail,
} from '@/lib/api-client';
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
} from '@/components/ui';
import { useToast } from '@/components/ui/toast';

const PAGE_SIZE = 50;

type TabId = 'dashboard' | 'log' | 'queue' | 'trail';

export default function AuditPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [tab, setTab] = useState<TabId>('dashboard');

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const role = String(user?.role ?? '').toUpperCase();
  const canSeeReviewerSurfaces =
    role === 'TENANT_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'ADMIN' || role === 'REVIEWER' || role === 'OPERATOR';

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" />
            Audit & Compliance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Workflow lifecycle, approvals, and artifact evidence — read-only views over the audit log.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList>
          <TabsTrigger value="dashboard">
            <BarChart3 className="h-4 w-4 mr-2" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="log">
            <FileSearch className="h-4 w-4 mr-2" />
            Audit Log
          </TabsTrigger>
          {canSeeReviewerSurfaces && (
            <TabsTrigger value="queue">
              <ListChecks className="h-4 w-4 mr-2" />
              Reviewer Queue
            </TabsTrigger>
          )}
          <TabsTrigger value="trail">
            <Clock className="h-4 w-4 mr-2" />
            Workflow Trail
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab canSee={canSeeReviewerSurfaces} />
        </TabsContent>
        <TabsContent value="log">
          <AuditLogTab />
        </TabsContent>
        {canSeeReviewerSurfaces && (
          <TabsContent value="queue">
            <ReviewerQueueTab />
          </TabsContent>
        )}
        <TabsContent value="trail">
          <WorkflowTrailTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Dashboard tab ─────────────────────────────────────────────────────

function DashboardTab({ canSee }: { canSee: boolean }) {
  const { data, error, isLoading, mutate } = useSWR<AuditDashboard>(
    canSee ? 'audit:dashboard' : null,
    () => auditApi.dashboard(),
    { refreshInterval: 30_000 },
  );

  if (!canSee) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <EmptyState
            icon={<ShieldCheck className="h-8 w-8" />}
            title="Reviewer access required"
            description="The dashboard is gated to REVIEWER or ADMIN roles. Ask your tenant admin for access."
          />
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>;
  }
  if (error || !data) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-8 w-8" />}
        title="Couldn't load dashboard"
        description={error instanceof Error ? error.message : 'Unknown error'}
      />
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Generated {new Date(data.generatedAt).toLocaleString()}
        </p>
        <Button size="sm" variant="ghost" onClick={() => mutate()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Total workflows" value={data.workflows.total} />
        <MetricCard label="Last 24h" value={data.workflows.last24h} />
        <MetricCard label="Last 7d" value={data.workflows.last7d} />
        <MetricCard
          label="Signed evidence bundles"
          value={data.artifacts.signedBundles}
          muted={!data.artifacts.available}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownCard
          title="Workflows by status"
          rows={data.workflows.byStatus.map((g) => ({ label: g.status, count: g.count }))}
          emptyHint="No workflows yet"
        />
        <BreakdownCard
          title="Approvals by status"
          rows={data.approvals.byStatus.map((g) => ({ label: g.status, count: g.count }))}
          emptyHint="No approval requests yet"
        />
        <BreakdownCard
          title="Artifacts by type"
          rows={
            data.artifacts.available
              ? data.artifacts.byType.map((g) => ({ label: g.artifactType, count: g.count }))
              : []
          }
          emptyHint={
            data.artifacts.available
              ? 'No artifacts yet'
              : 'Artifact storage not provisioned (run pnpm db:migrate:deploy)'
          }
        />
        <BreakdownCard
          title="Most active actions (last 7d)"
          rows={data.actionsLast7d.map((g) => ({ label: g.action, count: g.count }))}
          emptyHint="No audit activity in the last 7 days"
        />
      </div>
    </div>
  );
}

function MetricCard({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <Card className={muted ? 'opacity-60' : ''}>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold tabular-nums mt-1">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ title, rows, emptyHint }: { title: string; rows: Array<{ label: string; count: number }>; emptyHint: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">{emptyHint}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center justify-between text-sm">
                <code className="text-xs">{r.label}</code>
                <span className="tabular-nums font-medium">{r.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Audit Log tab ─────────────────────────────────────────────────────

function AuditLogTab() {
  const [filters, setFilters] = useState<{ action?: string; resource?: string; q?: string; from?: string; to?: string }>({});
  const [offset, setOffset] = useState(0);
  const params = useMemo(() => {
    const p: Record<string, unknown> = { limit: PAGE_SIZE, offset };
    if (filters.action) p['action'] = filters.action;
    if (filters.resource) p['resource'] = filters.resource;
    if (filters.q) p['q'] = filters.q;
    if (filters.from) p['from'] = filters.from;
    if (filters.to) p['to'] = filters.to;
    return p;
  }, [filters, offset]);

  const { data, error, isLoading, mutate } = useSWR<AuditLogPage>(
    ['audit:log', JSON.stringify(params)],
    () => auditApi.log(params),
  );

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>All filters applied server-side and respect tenant isolation.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="action, resource, id…"
                  value={filters.q ?? ''}
                  onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setOffset(0); }}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Action</label>
              <Input
                placeholder="WORKFLOW_COMPLETED"
                value={filters.action ?? ''}
                onChange={(e) => { setFilters((f) => ({ ...f, action: e.target.value })); setOffset(0); }}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Resource</label>
              <Input
                placeholder="workflow"
                value={filters.resource ?? ''}
                onChange={(e) => { setFilters((f) => ({ ...f, resource: e.target.value })); setOffset(0); }}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <Input
                type="datetime-local"
                value={filters.from ?? ''}
                onChange={(e) => { setFilters((f) => ({ ...f, from: e.target.value ? new Date(e.target.value).toISOString() : '' })); setOffset(0); }}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input
                type="datetime-local"
                value={filters.to ?? ''}
                onChange={(e) => { setFilters((f) => ({ ...f, to: e.target.value ? new Date(e.target.value).toISOString() : '' })); setOffset(0); }}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {data ? `${data.total.toLocaleString()} entries match` : 'Loading…'}
            </p>
            <div className="space-x-2">
              <Button size="sm" variant="ghost" onClick={() => { setFilters({}); setOffset(0); }}>
                Clear
              </Button>
              <Button size="sm" variant="ghost" onClick={() => mutate()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>
      ) : error ? (
        <EmptyState
          icon={<FileSearch className="h-8 w-8" />}
          title="Couldn't load audit log"
          description={error instanceof Error ? error.message : 'Unknown error'}
        />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<FileSearch className="h-8 w-8" />}
          title="No audit log entries"
          description="No entries match the current filters."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">When</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Action</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Resource</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Resource ID</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">User</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono">{r.action}</td>
                      <td className="px-3 py-2">{r.resource}</td>
                      <td className="px-3 py-2 font-mono text-[10px] truncate max-w-[160px]">{r.resourceId ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-[10px] truncate max-w-[140px]">{r.userId ?? '—'}</td>
                      <td className="px-3 py-2"><Badge variant={r.severity === 'ERROR' || r.severity === 'CRITICAL' ? 'destructive' : 'secondary'}>{r.severity}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between p-3 border-t">
              <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                ← Prev
              </Button>
              <span className="text-xs text-muted-foreground">
                {offset + 1}–{Math.min(offset + data.items.length, data.total)} of {data.total.toLocaleString()}
              </span>
              <Button size="sm" variant="ghost" disabled={offset + data.items.length >= data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Next →
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Reviewer Queue tab ────────────────────────────────────────────────

function ReviewerQueueTab() {
  const { data, error, isLoading, mutate } = useSWR<ReviewerQueue>(
    'audit:reviewer-queue',
    () => auditApi.reviewerQueue({ limit: PAGE_SIZE }),
    { refreshInterval: 15_000 },
  );
  const toast = useToast();

  const decideApproval = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      await approvalApi.decide(id, decision);
      toast.success(`Approval ${decision.toLowerCase()}.`);
      mutate();
    } catch (e) {
      toast.error(`Failed`, e instanceof Error ? e.message : 'unknown');
    }
  };

  if (isLoading) return <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>;
  if (error) return <EmptyState icon={<ListChecks className="h-8 w-8" />} title="Couldn't load reviewer queue" description={error instanceof Error ? error.message : 'Unknown error'} />;
  if (!data) return null;

  const empty = data.workflowApprovals.total === 0 && data.artifactApprovals.total === 0;
  if (empty) {
    return <EmptyState icon={<ListChecks className="h-8 w-8" />} title="Inbox zero" description="No pending workflow approvals or artifact downloads. Nothing for a reviewer to do right now." />;
  }

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workflow approvals ({data.workflowApprovals.total})</CardTitle>
          <CardDescription>Pending high-risk actions waiting for a human decision.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.workflowApprovals.items.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No pending approvals.</p>
          ) : (
            <ul className="divide-y">
              {data.workflowApprovals.items.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium">{a.action ?? a.agentRole ?? a.id}</div>
                    <div className="text-xs text-muted-foreground">
                      Workflow <code className="text-[10px]">{a.workflowId.slice(0, 12)}…</code> · risk{' '}
                      <Badge variant={a.riskLevel === 'CRITICAL' ? 'destructive' : a.riskLevel === 'HIGH' ? 'default' : 'secondary'}>{a.riskLevel}</Badge>
                    </div>
                  </div>
                  <div className="space-x-2">
                    <Button size="sm" variant="default" onClick={() => decideApproval(a.id, 'APPROVED')}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => decideApproval(a.id, 'REJECTED')}>Reject</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Artifact downloads awaiting approval ({data.artifactApprovals.total})</CardTitle>
          <CardDescription>Final-marked exports + signed bundles. Decide via the artifact endpoints (linked).</CardDescription>
        </CardHeader>
        <CardContent>
          {data.artifactApprovals.items.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No artifacts awaiting approval.</p>
          ) : (
            <ul className="divide-y">
              {data.artifactApprovals.items.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium">{a.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      <code className="text-[10px]">{a.artifactType}</code> · {a.sizeBytes ? `${a.sizeBytes.toLocaleString()} bytes` : '—'} · workflow{' '}
                      <code className="text-[10px]">{a.workflowId.slice(0, 12)}…</code>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground italic">
                    Use POST /artifacts/{a.id}/approve (admin)
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Workflow Trail tab ────────────────────────────────────────────────

function WorkflowTrailTab() {
  const [workflowId, setWorkflowId] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, error, isLoading } = useSWR<WorkflowTrail>(
    submitted ? `audit:trail:${submitted}` : null,
    () => auditApi.workflowTrail(submitted),
  );

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Look up a workflow trail</CardTitle>
          <CardDescription>Paste a workflow id (e.g. from /swarm) to see its full chronological event stream.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); setSubmitted(workflowId.trim()); }} className="flex gap-2">
            <Input
              placeholder="wf_xxxxxxxxx"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="font-mono"
            />
            <Button type="submit" disabled={!workflowId.trim()}>Load</Button>
          </form>
        </CardContent>
      </Card>

      {isLoading && <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>}
      {error && (
        <EmptyState
          icon={<Clock className="h-8 w-8" />}
          title="Couldn't load workflow trail"
          description={error instanceof Error ? error.message : 'Workflow not found or not visible to this tenant.'}
        />
      )}
      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{data.workflow.goal}</CardTitle>
            <CardDescription>
              <code className="text-[10px]">{data.workflow.id}</code> · status <Badge>{data.workflow.status}</Badge> ·{' '}
              {data.workflow.completedAt
                ? `${Math.round((new Date(data.workflow.completedAt).getTime() - new Date(data.workflow.startedAt).getTime()) / 1000)}s elapsed`
                : 'in progress'}{' '}
              · ${data.workflow.totalCostUsd.toFixed(4)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">{data.eventCount.toLocaleString()} events</p>
            {data.events.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No events recorded for this workflow.</p>
            ) : (
              <ol className="relative border-l border-border pl-4 space-y-3">
                {data.events.map((ev, i) => (
                  <li key={i} className="text-xs">
                    <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-primary" />
                    <div className="flex items-baseline gap-2">
                      <code className="text-[10px] text-muted-foreground">{new Date(ev.at).toLocaleTimeString()}</code>
                      <Badge variant="secondary" className="text-[10px]">{ev.source}</Badge>
                      <code className="text-xs">{ev.type}</code>
                    </div>
                    {Object.keys(ev.details).length > 0 && (
                      <pre className="mt-1 text-[10px] text-muted-foreground bg-muted/30 rounded p-1.5 overflow-x-auto">{JSON.stringify(ev.details, null, 0).slice(0, 240)}</pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
