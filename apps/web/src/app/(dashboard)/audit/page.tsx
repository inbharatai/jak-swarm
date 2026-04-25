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
  FileCheck,
  FileSearch,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  auditApi,
  approvalApi,
  complianceApi,
  type AuditDashboard,
  type AuditLogPage,
  type ReviewerQueue,
  type WorkflowTrail,
  type ComplianceFramework,
  type ComplianceFrameworkSummary,
  type ControlEvidenceItem,
  type AttestationListItem,
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

type TabId = 'dashboard' | 'log' | 'queue' | 'trail' | 'compliance';

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
          {canSeeReviewerSurfaces && (
            <TabsTrigger value="compliance">
              <FileCheck className="h-4 w-4 mr-2" />
              Compliance
            </TabsTrigger>
          )}
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
        {canSeeReviewerSurfaces && (
          <TabsContent value="compliance">
            <ComplianceTab />
          </TabsContent>
        )}
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

// ─── Compliance tab ────────────────────────────────────────────────────

function ComplianceTab() {
  const { data: frameworks, error: fwError, isLoading: fwLoading } = useSWR<{ frameworks: ComplianceFramework[] }>(
    'compliance:frameworks',
    () => complianceApi.listFrameworks(),
  );
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  // Auto-select the first framework when the list loads.
  React.useEffect(() => {
    if (!selectedSlug && frameworks?.frameworks?.[0]) {
      setSelectedSlug(frameworks.frameworks[0].slug);
    }
  }, [frameworks, selectedSlug]);

  if (fwLoading) return <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>;
  if (fwError) {
    const msg = fwError instanceof Error ? fwError.message : 'Unknown error';
    if (/SCHEMA_UNAVAILABLE/i.test(msg)) {
      return (
        <EmptyState
          icon={<FileCheck className="h-8 w-8" />}
          title="Compliance schema not deployed"
          description="Run pnpm db:migrate:deploy then pnpm seed:compliance to populate the SOC 2 catalogue."
        />
      );
    }
    return <EmptyState icon={<FileCheck className="h-8 w-8" />} title="Couldn't load frameworks" description={msg} />;
  }
  if (!frameworks?.frameworks?.length) {
    return (
      <EmptyState
        icon={<FileCheck className="h-8 w-8" />}
        title="No frameworks seeded"
        description="Run pnpm seed:compliance to load the SOC 2 Type 2 catalogue."
      />
    );
  }

  const selected = frameworks.frameworks.find((f) => f.slug === selectedSlug);

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frameworks</CardTitle>
          <CardDescription>Pick a framework to view its controls + evidence coverage for your tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {frameworks.frameworks.map((fw) => (
              <Button
                key={fw.slug}
                variant={selectedSlug === fw.slug ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedSlug(fw.slug)}
              >
                {fw.shortName} <span className="text-xs ml-1 opacity-60">{fw.version}</span>
              </Button>
            ))}
          </div>
          {selected && (
            <p className="text-xs text-muted-foreground mt-2">{selected.description}</p>
          )}
        </CardContent>
      </Card>
      {selected && <FrameworkSummary slug={selected.slug} />}
      {selected && <AttestationsSection slug={selected.slug} />}
    </div>
  );
}

function FrameworkSummary({ slug }: { slug: string }) {
  const [period, setPeriod] = useState<{ from?: string; to?: string }>({});
  const { data, error, isLoading, mutate } = useSWR<ComplianceFrameworkSummary>(
    ['compliance:framework', slug, JSON.stringify(period)],
    () => complianceApi.framework(slug, period),
    { refreshInterval: 30_000 },
  );
  const [expandedControlId, setExpandedControlId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const toast = useToast();

  const runAutoMap = async () => {
    setRunning(true);
    try {
      const r = await complianceApi.autoMap(slug, {
        ...(period.from ? { periodStart: period.from } : {}),
        ...(period.to ? { periodEnd: period.to } : {}),
      });
      toast.success(`Auto-map complete: ${r.newMappingsCreated} new mappings.`);
      mutate();
    } catch (e) {
      toast.error('Auto-map failed', e instanceof Error ? e.message : 'Unknown');
    } finally {
      setRunning(false);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center py-12"><Spinner /></div>;
  if (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">Couldn't load framework: {msg}</p>
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  // Group controls by category.
  const byCategory = new Map<string, typeof data.controls>();
  for (const c of data.controls) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{data.framework.name}</CardTitle>
            <CardDescription>
              {data.framework.issuer} · {data.framework.version}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{data.coverageCounts.coveragePercent}%</div>
            <div className="text-[10px] text-muted-foreground">
              {data.coverageCounts.covered} / {data.coverageCounts.total} controls covered
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input
              type="date"
              value={period.from?.slice(0, 10) ?? ''}
              onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input
              type="date"
              value={period.to?.slice(0, 10) ?? ''}
              onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
            />
          </div>
          <Button size="sm" variant="ghost" onClick={() => mutate()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button size="sm" onClick={runAutoMap} disabled={running}>
            {running ? 'Running…' : 'Run auto-map'}
          </Button>
        </div>

        {Array.from(byCategory.entries()).map(([category, controls]) => (
          <div key={category} className="mb-4">
            <h3 className="text-xs uppercase tracking-wider font-medium text-muted-foreground mb-2">{category}</h3>
            <ul className="border rounded divide-y">
              {controls.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedControlId(expandedControlId === c.id ? null : c.id)}
                    className="w-full text-left px-3 py-2 hover:bg-muted/30 flex items-center justify-between text-sm"
                  >
                    <div>
                      <span className="font-mono text-xs mr-2">{c.code}</span>
                      <span>{c.title}</span>
                    </div>
                    <Badge variant={c.evidenceCount > 0 ? 'default' : 'secondary'}>
                      {c.evidenceCount > 0 ? `${c.evidenceCount} evidence` : 'uncovered'}
                    </Badge>
                  </button>
                  {expandedControlId === c.id && (
                    <ControlEvidenceDrillIn slug={slug} controlId={c.id} description={c.description} autoRuleKey={c.autoRuleKey} period={period} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ControlEvidenceDrillIn({ slug, controlId, description, autoRuleKey, period }: { slug: string; controlId: string; description: string; autoRuleKey: string | null; period: { from?: string; to?: string } }) {
  const { data, error, isLoading, mutate } = useSWR<{ items: ControlEvidenceItem[]; total: number }>(
    ['compliance:control-evidence', slug, controlId, JSON.stringify(period)],
    () => complianceApi.controlEvidence(slug, controlId, period),
  );
  const { data: manual, mutate: mutateManual } = useSWR<{ items: Array<{ id: string; title: string; description: string; attachedArtifactId: string | null; createdBy: string; evidenceAt: string; createdAt: string }>; total: number }>(
    ['compliance:manual-evidence', controlId],
    () => complianceApi.listManualEvidence(controlId),
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [meTitle, setMeTitle] = useState('');
  const [meDescription, setMeDescription] = useState('');
  const [meSubmitting, setMeSubmitting] = useState(false);
  const toast = useToast();

  const submitManualEvidence = async () => {
    if (!meTitle.trim() || !meDescription.trim()) return;
    setMeSubmitting(true);
    try {
      await complianceApi.createManualEvidence({ controlId, title: meTitle.trim(), description: meDescription.trim() });
      toast.success('Manual evidence added.');
      setMeTitle('');
      setMeDescription('');
      setShowAddForm(false);
      mutateManual();
      mutate();
    } catch (e) {
      toast.error('Failed to add', e instanceof Error ? e.message : 'Unknown');
    } finally {
      setMeSubmitting(false);
    }
  };

  const removeManualEvidence = async (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Remove this manual evidence? Coverage will drop.')) return;
    try {
      await complianceApi.deleteManualEvidence(id);
      toast.success('Manual evidence removed.');
      mutateManual();
      mutate();
    } catch (e) {
      toast.error('Failed to remove', e instanceof Error ? e.message : 'Unknown');
    }
  };

  return (
    <div className="px-3 py-2 bg-muted/30 border-t text-xs space-y-2">
      <p className="text-muted-foreground italic">{description}</p>
      <p className="text-[10px]">Auto-mapping rule: {autoRuleKey ? <code>{autoRuleKey}</code> : <span className="italic">none — human-mapped only</span>}</p>

      {/* Manual evidence section */}
      <div className="border-l-2 border-primary/40 pl-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider font-medium">Manual evidence ({manual?.total ?? 0})</span>
          <button
            type="button"
            onClick={() => setShowAddForm((s) => !s)}
            className="text-[10px] text-primary hover:underline"
          >
            {showAddForm ? 'Cancel' : '+ Add'}
          </button>
        </div>
        {showAddForm && (
          <div className="space-y-1 p-2 bg-background border rounded">
            <Input placeholder="Title (e.g. 'Annual security training records — Q1 2026')" value={meTitle} onChange={(e) => setMeTitle(e.target.value)} className="text-xs" />
            <textarea
              placeholder="Description / where the evidence is stored / who reviewed it"
              value={meDescription}
              onChange={(e) => setMeDescription(e.target.value)}
              rows={3}
              className="w-full text-xs border rounded p-1"
            />
            <Button size="sm" onClick={submitManualEvidence} disabled={meSubmitting || !meTitle.trim() || !meDescription.trim()}>
              {meSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
        {manual && manual.items.length > 0 && (
          <ul className="space-y-1">
            {manual.items.map((m) => (
              <li key={m.id} className="flex items-start justify-between p-1 hover:bg-background/50 rounded">
                <div className="flex-1">
                  <div className="font-medium text-[11px]">{m.title}</div>
                  <div className="text-[10px] text-muted-foreground line-clamp-2">{m.description}</div>
                  <div className="text-[9px] text-muted-foreground">by {m.createdBy} · {new Date(m.evidenceAt).toLocaleDateString()}</div>
                </div>
                <button onClick={() => removeManualEvidence(m.id)} className="text-[10px] text-destructive hover:underline ml-2">
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Auto-mapped evidence */}
      <div className="border-l-2 border-border pl-2 space-y-1">
        <span className="text-[10px] uppercase tracking-wider font-medium">Auto-mapped evidence ({data?.total ?? 0})</span>
        {isLoading && <Spinner size="sm" />}
        {error && <p className="text-destructive">Couldn't load evidence: {error instanceof Error ? error.message : 'Unknown'}</p>}
        {data && data.items.length === 0 && (
          <p className="italic text-muted-foreground">No auto-mapped rows. Run "Run auto-map" to refresh.</p>
        )}
        {data && data.items.length > 0 && (
          <ul className="font-mono text-[10px] space-y-0.5 max-h-48 overflow-y-auto">
            {data.items.map((m) => (
              <li key={m.id}>
                <span className="text-muted-foreground">[{new Date(m.evidenceAt).toLocaleString()}]</span>{' '}
                <span>{m.evidenceType}</span>:<span>{m.evidenceId}</span>{' '}
                <span className="text-muted-foreground">({m.mappingSource})</span>
              </li>
            ))}
            {data.total > data.items.length && (
              <li className="italic text-muted-foreground">+{data.total - data.items.length} more</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function AttestationsSection({ slug }: { slug: string }) {
  const { data, error, isLoading, mutate } = useSWR<{ items: AttestationListItem[]; total: number }>(
    ['compliance:attestations', slug],
    () => complianceApi.listAttestations({ framework: slug }),
  );
  const [start, setStart] = useState(() => new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [sign, setSign] = useState(false);
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await complianceApi.generateAttestation(slug, {
        periodStart: new Date(start).toISOString(),
        periodEnd: new Date(end + 'T23:59:59Z').toISOString(),
        sign,
      });
      toast.success(
        `Attestation ready (${r.coveragePercent}% coverage, ${r.totalEvidence} evidence rows). ` +
        (r.bundleArtifactId ? 'Signed bundle created.' : 'Awaiting reviewer approval to download.'),
      );
      mutate();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown';
      toast.error('Attestation failed', msg);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Period attestations</CardTitle>
        <CardDescription>Generate a signed PDF attestation for an audit period. Final attestations require reviewer approval before download.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Period start</label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Period end</label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={sign} onChange={(e) => setSign(e.target.checked)} />
            Also produce signed bundle
          </label>
          <Button size="sm" onClick={generate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate attestation'}
          </Button>
        </div>

        <div>
          {isLoading ? <Spinner size="sm" /> : null}
          {error && <p className="text-xs text-destructive">Couldn't load: {error instanceof Error ? error.message : 'Unknown'}</p>}
          {data && data.items.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No attestations yet for this framework.</p>
          ) : (
            <table className="min-w-full text-xs mt-2">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1 text-left">Generated</th>
                  <th className="px-2 py-1 text-left">Period</th>
                  <th className="px-2 py-1 text-right">Coverage</th>
                  <th className="px-2 py-1 text-right">Evidence</th>
                  <th className="px-2 py-1 text-left">Artifact</th>
                  <th className="px-2 py-1 text-left">Generated by</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((row) => (
                  <tr key={row.id} className="border-b hover:bg-muted/30">
                    <td className="px-2 py-1">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="px-2 py-1">{row.periodStart.slice(0, 10)} → {row.periodEnd.slice(0, 10)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{row.coveragePercent}%</td>
                    <td className="px-2 py-1 text-right tabular-nums">{row.totalEvidence.toLocaleString()}</td>
                    <td className="px-2 py-1 font-mono text-[10px]">{row.artifactId ? row.artifactId.slice(0, 12) + '…' : '—'}</td>
                    <td className="px-2 py-1 font-mono text-[10px]">{row.generatedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
