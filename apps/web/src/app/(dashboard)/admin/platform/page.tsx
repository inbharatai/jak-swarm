'use client';

/**
 * SYSTEM_ADMIN platform-level aggregate dashboard.
 *
 * Cross-tenant rollups for platform operators. NEVER for TENANT_ADMINs —
 * they see only their own tenant's data via /audit/dashboard. This page
 * is reachable from the existing /admin sidebar entry but gated to
 * SYSTEM_ADMIN role only at both UI + server (server is the boundary).
 *
 * Three sections:
 *   1. Platform overview — tenant count, user count, workflow count, cost
 *   2. Tenants — table of all tenants with their compliance posture
 *   3. Compliance frameworks — adoption + average coverage across tenants
 */

import React, { useState } from 'react';
import useSWR from 'swr';
import { BarChart3, Building2, Globe2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  adminAggregateApi,
  type AdminOverview,
  type AdminTenantRow,
  type AdminFrameworkRollup,
} from '@/lib/api-client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';

type TabId = 'overview' | 'tenants' | 'compliance';

export default function PlatformAdminPage() {
  const { user, isLoading } = useAuth();
  const [tab, setTab] = useState<TabId>('overview');

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>;
  }

  const role = String(user?.role ?? '').toUpperCase();
  const isSystemAdmin = role === 'SYSTEM_ADMIN';

  if (!isSystemAdmin) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-3xl">
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="SYSTEM_ADMIN access required"
          description="The platform-level dashboard is restricted to SYSTEM_ADMIN users. Tenant-level metrics live at /audit."
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Globe2 className="h-6 w-6" /> Platform admin
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cross-tenant aggregate views. Strictly SYSTEM_ADMIN scope — tenant-level metrics live at <code>/audit</code>.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList>
          <TabsTrigger value="overview"><BarChart3 className="h-4 w-4 mr-2" /> Overview</TabsTrigger>
          <TabsTrigger value="tenants"><Building2 className="h-4 w-4 mr-2" /> Tenants</TabsTrigger>
          <TabsTrigger value="compliance"><ShieldCheck className="h-4 w-4 mr-2" /> Compliance adoption</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="tenants"><TenantsTab /></TabsContent>
        <TabsContent value="compliance"><ComplianceAdoptionTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Overview tab ──────────────────────────────────────────────────────

function OverviewTab() {
  const { data, error, isLoading, mutate } = useSWR<AdminOverview>(
    'admin:overview',
    () => adminAggregateApi.overview(),
    { refreshInterval: 60_000 },
  );
  if (isLoading) return <div className="py-12 flex items-center justify-center"><Spinner size="lg" /></div>;
  if (error || !data) {
    return <EmptyState icon={<BarChart3 className="h-8 w-8" />} title="Couldn't load" description={error instanceof Error ? error.message : 'Unknown'} />;
  }
  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Generated {new Date(data.generatedAt).toLocaleString()}</p>
        <Button size="sm" variant="ghost" onClick={() => mutate()}><RefreshCw className="h-4 w-4 mr-2" /> Refresh</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Tenants" value={data.tenants.total} />
        <Metric label="Users" value={data.users.total} />
        <Metric label="Workflows total" value={data.workflows.total} />
        <Metric label="Total cost (USD)" value={`$${data.workflows.totalCostUsd.toFixed(2)}`} />
        <Metric label="Workflows · 24h" value={data.workflows.last24h} />
        <Metric label="Workflows · 7d" value={data.workflows.last7d} />
        <Metric label="Workflows · 30d" value={data.workflows.last30d} />
        <Metric label="Audit events · 24h" value={data.auditLog.last24h} />
        <Metric label="Audit events · total" value={data.auditLog.total} />
        <Metric label="Attestations" value={data.compliance.attestationsTotal} />
        <Metric label="Active schedules" value={data.compliance.activeSchedules} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Breakdown title="Tenants by status" rows={data.tenants.byStatus.map((t) => ({ label: t.status, count: t.count }))} />
        <Breakdown title="Workflows by status" rows={data.workflows.byStatus.map((w) => ({ label: w.status, count: w.count }))} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold tabular-nums mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      </CardContent>
    </Card>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">No data</p>
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

// ─── Tenants tab ───────────────────────────────────────────────────────

function TenantsTab() {
  const [offset, setOffset] = useState(0);
  const PAGE = 50;
  const { data, error, isLoading, mutate } = useSWR<{ items: AdminTenantRow[]; total: number }>(
    ['admin:tenants', offset],
    () => adminAggregateApi.tenants({ limit: PAGE, offset }),
  );
  if (isLoading) return <div className="py-12 flex items-center justify-center"><Spinner size="lg" /></div>;
  if (error || !data) return <EmptyState icon={<Building2 className="h-8 w-8" />} title="Couldn't load" description={error instanceof Error ? error.message : 'Unknown'} />;
  if (data.items.length === 0) return <EmptyState icon={<Building2 className="h-8 w-8" />} title="No tenants" description="No tenants have been provisioned." />;
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{data.total.toLocaleString()} tenants</p>
        <Button size="sm" variant="ghost" onClick={() => mutate()}><RefreshCw className="h-4 w-4 mr-2" /> Refresh</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left">Tenant</th>
                  <th className="px-3 py-2 text-left">Industry</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Workflows</th>
                  <th className="px-3 py-2 text-right">Approvals</th>
                  <th className="px-3 py-2 text-right">Attestations</th>
                  <th className="px-3 py-2 text-right">Mappings</th>
                  <th className="px-3 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium">{t.name}</div>
                      <code className="text-[10px] text-muted-foreground">{t.slug}</code>
                    </td>
                    <td className="px-3 py-2">{t.industry ?? '—'}</td>
                    <td className="px-3 py-2"><Badge variant="secondary">{t.status}</Badge></td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.workflowCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.approvalCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.attestationCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.evidenceMappingCount}</td>
                    <td className="px-3 py-2 text-[10px]">{new Date(t.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between p-3 border-t">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Prev</Button>
            <span className="text-xs text-muted-foreground">{offset + 1}–{Math.min(offset + data.items.length, data.total)} of {data.total.toLocaleString()}</span>
            <Button size="sm" variant="ghost" disabled={offset + data.items.length >= data.total} onClick={() => setOffset(offset + PAGE)}>Next →</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Compliance adoption tab ───────────────────────────────────────────

function ComplianceAdoptionTab() {
  const { data, error, isLoading, mutate } = useSWR<{ frameworks: AdminFrameworkRollup[] }>(
    'admin:compliance',
    () => adminAggregateApi.compliance(),
    { refreshInterval: 120_000 },
  );
  if (isLoading) return <div className="py-12 flex items-center justify-center"><Spinner size="lg" /></div>;
  if (error || !data) return <EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="Couldn't load" description={error instanceof Error ? error.message : 'Unknown'} />;
  if (data.frameworks.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-8 w-8" />}
        title="No frameworks seeded"
        description="Run pnpm seed:compliance to load the SOC 2 / HIPAA / ISO 27001 catalogues."
      />
    );
  }
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{data.frameworks.length} active framework(s)</p>
        <Button size="sm" variant="ghost" onClick={() => mutate()}><RefreshCw className="h-4 w-4 mr-2" /> Refresh</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left">Framework</th>
                <th className="px-3 py-2 text-right">Total controls</th>
                <th className="px-3 py-2 text-right">Tenants with evidence</th>
                <th className="px-3 py-2 text-right">Total mappings</th>
                <th className="px-3 py-2 text-right">Attestations</th>
              </tr>
            </thead>
            <tbody>
              {data.frameworks.map((f) => (
                <tr key={f.slug} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="font-medium">{f.name}</div>
                    <code className="text-[10px] text-muted-foreground">{f.slug} · {f.version}</code>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.totalControls}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.tenantsWithEvidence}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.totalEvidenceMappings.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.attestationsGenerated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
