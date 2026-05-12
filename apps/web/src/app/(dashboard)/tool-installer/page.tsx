'use client';

/**
 * Tool installer page — Sprint 6 Part E.
 *
 * Wires the SandboxedInstaller into a reachable user surface:
 *   1. Detect missing capability from a free-form task description
 *   2. Plan: dry-run for an allowlisted tool (any auth user)
 *   3. Execute: real subprocess (admin only, requires approvalId)
 *
 * NEVER auto-installs. Default registry has only capability-check
 * adapters (`pnpm ls X`); full installs require
 * `JAK_INSTALL_ALLOW_WRITE=1` admin opt-in on the server.
 */

import React, { useState } from 'react';
import { Wrench, Sparkles, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button, Card, CardContent, Textarea, Input } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { toolInstallerApi } from '@/lib/api-client';

interface DetectResp {
  data?: {
    requirements: Array<{
      capability: string;
      suggestedToolName: string | null;
      reason: string;
      alreadyRegistered: boolean;
      sandboxAdapterAvailable: boolean;
    }>;
  };
}

interface PlanResp {
  data?: {
    steps: Array<{ description: string; command?: string; safe: boolean }>;
    estimatedDurationSec: number;
    mode: string;
    summary: string;
    allSafe: boolean;
  };
}

interface ExecuteResp {
  data?: {
    success: boolean;
    mode: string;
    message: string;
  };
}

export default function ToolInstallerPage() {
  const toast = useToast();
  const [task, setTask] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [requirements, setRequirements] = useState<DetectResp['data']>(undefined);
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanResp['data']>(undefined);
  const [executing, setExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState<ExecuteResp['data']>(undefined);
  const [approvalId, setApprovalId] = useState('');

  async function handleDetect(): Promise<void> {
    if (!task.trim()) return;
    setDetecting(true);
    const startedAt = Date.now();
    try {
      const r = (await toolInstallerApi.detect(task)) as DetectResp;
      setRequirements(r?.data);
    } catch (err) {
      toast.error('Detect failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      const remainingMs = Math.max(0, 700 - (Date.now() - startedAt));
      if (remainingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingMs));
      }
      setDetecting(false);
    }
  }

  async function handlePlan(toolName: string, purpose: string): Promise<void> {
    setPlanFor(toolName);
    setPlanning(true);
    setPlan(undefined);
    try {
      const r = (await toolInstallerApi.plan(toolName, purpose)) as PlanResp;
      setPlan(r?.data);
    } catch (err) {
      toast.error('Plan failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setPlanning(false);
    }
  }

  async function handleExecute(): Promise<void> {
    if (!planFor || !approvalId.trim()) return;
    setExecuting(true);
    setExecuteResult(undefined);
    try {
      const r = (await toolInstallerApi.execute(planFor, task, approvalId)) as ExecuteResp;
      setExecuteResult(r?.data);
      if (r?.data?.success) toast.success('Install completed');
      else toast.error('Install failed', r?.data?.message?.slice(0, 200));
    } catch (err) {
      toast.error('Execute failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-0">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Wrench className="h-5 w-5" />
          Tool installer
        </h2>
        <p className="text-xs text-muted-foreground">
          Detect missing capabilities + plan + (admin-only) execute. Allowlisted only — default registry runs read-only capability checks.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium">What do you need?</label>
            <Textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. I need a PDF parser, install browser automation, need playwright"
              rows={3}
              data-testid="tool-installer-task-input"
            />
          </div>
          <Button
            onClick={handleDetect}
            disabled={!task.trim() || detecting}
            className="gap-1.5"
            data-testid="tool-installer-detect-btn"
            aria-busy={detecting}
          >
            {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Detect missing capability
          </Button>
        </CardContent>
      </Card>

      {requirements && (
        <Card data-testid="tool-installer-requirements-card">
          <CardContent className="p-5 space-y-3">
            <h3 className="text-sm font-semibold">Detected capabilities</h3>
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              data-testid="tool-installer-safety-disclosure"
            >
              Detection is read-only. Install plans run through the sandboxed installer, and any real
              execution is admin-only and requires reviewer approval before JAK changes the environment.
            </div>
            {requirements.requirements.length === 0 ? (
              <p className="text-xs text-muted-foreground">No specific capability detected.</p>
            ) : (
              <ul className="space-y-2">
                {requirements.requirements.map((req) => (
                  <li key={req.suggestedToolName ?? req.capability} className="rounded-lg border p-3 text-xs space-y-1">
                    <div className="font-medium">{req.capability}</div>
                    <div className="text-muted-foreground">{req.reason}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {req.alreadyRegistered && (
                        <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px]">already available</span>
                      )}
                      {!req.alreadyRegistered && req.sandboxAdapterAvailable && (
                        <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px]">install supported</span>
                      )}
                      {!req.alreadyRegistered && !req.sandboxAdapterAvailable && (
                        <span className="rounded-full bg-rose-100 text-rose-700 px-2 py-0.5 text-[10px]">install NOT supported</span>
                      )}
                    </div>
                    {req.suggestedToolName && req.sandboxAdapterAvailable && !req.alreadyRegistered && (
                      <Button size="sm" variant="outline" className="mt-1.5" onClick={() => handlePlan(req.suggestedToolName!, task)}>
                        Show install plan
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {plan && planFor && (
        <Card data-testid="tool-installer-plan-card">
          <CardContent className="p-5 space-y-3">
            <h3 className="text-sm font-semibold">Plan for {planFor}</h3>
            <p className="text-xs text-muted-foreground">{plan.summary}</p>
            <ul className="space-y-1 text-xs">
              {plan.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  {s.safe ? <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5" /> : <AlertCircle className="h-3 w-3 text-amber-600 mt-0.5" />}
                  <div>
                    <div>{s.description}</div>
                    {s.command && <code className="text-[10px] text-muted-foreground bg-muted px-1 rounded">{s.command}</code>}
                  </div>
                </li>
              ))}
            </ul>
            {plan.allSafe && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-medium">Approval required to execute (admin only)</p>
                <p className="text-[10px] text-muted-foreground">
                  Paste the approvalId from the Approvals inbox after you've decided. (For dev: use any non-empty string to test the gate.)
                </p>
                <div className="flex gap-2">
                  <Input
                    value={approvalId}
                    onChange={(e) => setApprovalId(e.target.value)}
                    placeholder="apr_xxx"
                    data-testid="tool-installer-approval-input"
                  />
                  <Button onClick={handleExecute} disabled={!approvalId.trim() || executing} data-testid="tool-installer-execute-btn">
                    {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Execute'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {executeResult && (
        <Card data-testid="tool-installer-execute-result-card">
          <CardContent className="p-5 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              {executeResult.success ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertCircle className="h-4 w-4 text-rose-500" />}
              {executeResult.success ? 'Install completed' : 'Install failed'}
            </h3>
            <pre className="text-[10px] bg-muted p-2 rounded font-mono overflow-x-auto whitespace-pre-wrap" data-testid="tool-installer-execute-output">
              {executeResult.message}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
