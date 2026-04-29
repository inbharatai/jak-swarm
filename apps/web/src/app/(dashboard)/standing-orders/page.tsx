'use client';

/**
 * Standing Orders panel.
 *
 * Backend already ships at apps/api/src/routes/standing-orders.routes.ts
 * (GET / POST / PATCH / DELETE / POST :id/disable). This page is the
 * UI surface — list, create, edit, enable/disable, delete — for the
 * autonomy-boundary contract that bounds what a WorkflowSchedule (or
 * the tenant globally) is allowed to do at fire time.
 *
 * Design notes:
 *   - Mirrors `apps/web/src/app/(dashboard)/schedules/page.tsx` shape
 *     intentionally — same SWR + Dialog + form scaffold, same toast
 *     ergonomics. A user who knows Schedules knows StandingOrders.
 *   - Array fields (allowedTools / blockedActions / approvalRequiredFor /
 *     allowedSources) are entered as comma-separated strings; we don't
 *     ship a tag-input component this session.
 *   - Risk badges surface explicitly which boundary fields are set —
 *     so an operator can scan the list and see "this order has an
 *     allow-list AND a deny-list AND a budget cap" at a glance.
 *   - `expiresAt` accepts a date-time string; an empty value persists
 *     as null = "no expiry".
 */

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import { Shield, Plus, Trash2, Edit2, Power, Calendar, DollarSign } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  EmptyState,
  Spinner,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  Input,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { fetcher, standingOrdersApi } from '@/lib/api-client';
import type { StandingOrder } from '@/types';
import { formatDistanceToNow } from 'date-fns';

interface StandingOrderFormData {
  name: string;
  description: string;
  workflowScheduleId: string;
  /** Comma-separated tool names. Empty = no whitelist. */
  allowedTools: string;
  /** Comma-separated tool/action names. Empty = no extra blocklist. */
  blockedActions: string;
  /** Comma-separated risk levels. Empty = use tenant default. */
  approvalRequiredFor: string;
  /** Comma-separated source URLs/domains. Empty = no source restriction. */
  allowedSources: string;
  /** USD per fire. Empty = no budget cap. */
  budgetUsd: string;
  /** ISO datetime. Empty = no expiry. */
  expiresAt: string;
}

const emptyForm: StandingOrderFormData = {
  name: '',
  description: '',
  workflowScheduleId: '',
  allowedTools: '',
  blockedActions: '',
  approvalRequiredFor: '',
  allowedSources: '',
  budgetUsd: '',
  expiresAt: '',
};

function commaToArr(s: string): string[] {
  return s.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
}

function arrToComma(a: string[] | undefined | null): string {
  return Array.isArray(a) ? a.join(', ') : '';
}

export default function StandingOrdersPage() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ data: { items: StandingOrder[]; count: number } }>(
    '/standing-orders',
    fetcher,
  );
  const orders = data?.data?.items ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StandingOrderFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((order: StandingOrder) => {
    setEditingId(order.id);
    setForm({
      name: order.name,
      description: order.description ?? '',
      workflowScheduleId: order.workflowScheduleId ?? '',
      allowedTools: arrToComma(order.allowedTools),
      blockedActions: arrToComma(order.blockedActions),
      approvalRequiredFor: arrToComma(order.approvalRequiredFor),
      allowedSources: arrToComma(order.allowedSources),
      budgetUsd: order.budgetUsd != null ? order.budgetUsd.toString() : '',
      expiresAt: order.expiresAt ? order.expiresAt.slice(0, 16) : '',
    });
    setError(null);
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        workflowScheduleId: form.workflowScheduleId.trim() || null,
        allowedTools: commaToArr(form.allowedTools),
        blockedActions: commaToArr(form.blockedActions),
        approvalRequiredFor: commaToArr(form.approvalRequiredFor),
        allowedSources: commaToArr(form.allowedSources),
        budgetUsd: form.budgetUsd ? parseFloat(form.budgetUsd) : null,
        // Convert datetime-local input back to ISO string (UTC), or null.
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      };

      if (editingId) {
        await standingOrdersApi.update(editingId, body);
      } else {
        await standingOrdersApi.create(body);
      }

      setDialogOpen(false);
      mutate();
      toast.success(editingId ? 'Standing order updated' : 'Standing order created');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save standing order');
    } finally {
      setSaving(false);
    }
  }, [form, editingId, mutate, toast]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('Delete this standing order? This cannot be undone.')) return;
      try {
        await standingOrdersApi.delete(id);
        mutate();
        toast.success('Standing order deleted');
      } catch (err) {
        toast.error('Operation failed', err instanceof Error ? err.message : 'Please try again.');
      }
    },
    [mutate, toast],
  );

  const handleToggle = useCallback(
    async (order: StandingOrder) => {
      try {
        if (order.enabled) {
          await standingOrdersApi.disable(order.id);
        } else {
          await standingOrdersApi.update(order.id, { enabled: true });
        }
        mutate();
      } catch (err) {
        toast.error('Operation failed', err instanceof Error ? err.message : 'Please try again.');
      }
    },
    [mutate, toast],
  );

  const updateField = (field: keyof StandingOrderFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="flex flex-col gap-6 p-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Standing Orders
          </h2>
          <p className="text-xs text-muted-foreground">
            Autonomy boundaries — bound what scheduled or autonomous workflows are allowed
            to do (allowlist tools, block actions, force approval, cap budget, set expiry).
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate} data-testid="standing-orders-new-btn">
          <Plus className="h-3.5 w-3.5" />
          New Standing Order
        </Button>
      </div>

      {/* Honest expectation banner */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-3 text-xs text-amber-700 dark:text-amber-400">
          <strong>How this works:</strong> A standing order pre-authorizes a{' '}
          <em>workflow run</em>, NOT the individual tool calls inside it. Tools listed in{' '}
          <code>approvalRequiredFor</code> still pause for human approval. Tools listed in{' '}
          <code>blockedActions</code> are rejected outright. Empty arrays mean
          &ldquo;no boundary on that dimension&rdquo; — tenant defaults apply.
        </CardContent>
      </Card>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<Shield className="h-6 w-6" />}
              title="No standing orders yet"
              description="Create a standing order to bound what your autonomous workflows can do."
              action={
                <Button size="sm" onClick={openCreate} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Create Standing Order
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" data-testid="standing-orders-list">
          {orders.map((order: StandingOrder) => {
            const isExpired = order.expiresAt && new Date(order.expiresAt) <= new Date();
            return (
              <Card
                key={order.id}
                className={cn(!order.enabled && 'opacity-60', isExpired && 'border-rose-500/40')}
                data-testid={`standing-order-card-${order.id}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-sm truncate">{order.name}</CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {order.workflowScheduleId
                          ? `Scoped to schedule ${order.workflowScheduleId.slice(-8)}`
                          : 'Tenant-wide order'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {order.enabled ? (
                        <Badge variant="default" className="text-[10px]">Enabled</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Disabled</Badge>
                      )}
                      {isExpired && <Badge variant="destructive" className="text-[10px]">Expired</Badge>}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-2 text-[11px]">
                  {order.description && (
                    <p className="text-muted-foreground line-clamp-2">{order.description}</p>
                  )}

                  {order.allowedTools.length > 0 && (
                    <div>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">Allowlist:</span>{' '}
                      <span className="font-mono">{order.allowedTools.slice(0, 3).join(', ')}{order.allowedTools.length > 3 ? '…' : ''}</span>
                    </div>
                  )}
                  {order.blockedActions.length > 0 && (
                    <div>
                      <span className="font-semibold text-rose-600 dark:text-rose-400">Blocked:</span>{' '}
                      <span className="font-mono">{order.blockedActions.slice(0, 3).join(', ')}{order.blockedActions.length > 3 ? '…' : ''}</span>
                    </div>
                  )}
                  {order.approvalRequiredFor.length > 0 && (
                    <div>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">Approval req'd for:</span>{' '}
                      <span className="font-mono">{order.approvalRequiredFor.slice(0, 3).join(', ')}{order.approvalRequiredFor.length > 3 ? '…' : ''}</span>
                    </div>
                  )}
                  {order.budgetUsd != null && (
                    <div className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      Budget: ${order.budgetUsd.toFixed(2)} per fire
                    </div>
                  )}
                  {order.expiresAt && (
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Expires {formatDistanceToNow(new Date(order.expiresAt), { addSuffix: true })}
                    </div>
                  )}

                  <div className="flex gap-1 pt-2 border-t">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleToggle(order)}
                      className="gap-1 text-[11px]"
                      aria-label={order.enabled ? 'Disable' : 'Enable'}
                    >
                      <Power className="h-3 w-3" />
                      {order.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(order)}
                      className="gap-1 text-[11px]"
                      aria-label="Edit"
                    >
                      <Edit2 className="h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(order.id)}
                      className="gap-1 text-[11px] text-rose-600 hover:text-rose-700 ml-auto"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>{editingId ? 'Edit standing order' : 'New standing order'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div>
            <label className="text-xs font-medium">Name *</label>
            <Input
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="e.g. Block external publish on weekends"
              data-testid="standing-order-name-input"
            />
          </div>

          <div>
            <label className="text-xs font-medium">Description</label>
            <Textarea
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="What this order enforces and why."
              rows={2}
            />
          </div>

          <div>
            <label className="text-xs font-medium">Scoped to schedule (optional)</label>
            <Input
              value={form.workflowScheduleId}
              onChange={(e) => updateField('workflowScheduleId', e.target.value)}
              placeholder="WorkflowSchedule id, or leave empty for tenant-wide"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              When empty, this order applies to every schedule + ad-hoc workflow in the tenant.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Allowed tools (comma-separated, empty = no allowlist)
            </label>
            <Input
              value={form.allowedTools}
              onChange={(e) => updateField('allowedTools', e.target.value)}
              placeholder="web_search, draft_email"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-rose-600 dark:text-rose-400">
              Blocked actions (comma-separated)
            </label>
            <Input
              value={form.blockedActions}
              onChange={(e) => updateField('blockedActions', e.target.value)}
              placeholder="gmail_send_email, slack_post_message"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Approval required for (comma-separated risk levels or tool names)
            </label>
            <Input
              value={form.approvalRequiredFor}
              onChange={(e) => updateField('approvalRequiredFor', e.target.value)}
              placeholder="EXTERNAL_ACTION_APPROVAL, CRITICAL_MANUAL_ONLY"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Tools in this list always pause for human approval, even with auto-approve on.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium">Allowed sources (comma-separated URLs/domains)</label>
            <Input
              value={form.allowedSources}
              onChange={(e) => updateField('allowedSources', e.target.value)}
              placeholder="https://example.com, partner.example.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Budget per fire (USD)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.budgetUsd}
                onChange={(e) => updateField('budgetUsd', e.target.value)}
                placeholder="5.00"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Expires at</label>
              <Input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => updateField('expiresAt', e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="text-xs text-rose-600 dark:text-rose-400" role="alert">{error}</div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} data-testid="standing-order-save-btn">
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
