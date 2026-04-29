'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Check, X, Clock, AlertTriangle, FileText, Wrench, Cloud, Beaker, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ROLES, getRoleColor } from '@/lib/role-config';
import type { Message } from '@/store/conversation-store';
import { useConversationStore } from '@/store/conversation-store';
import { workflowApi, approvalApi } from '@/lib/api-client';

interface MessageThreadProps {
  messages: Message[];
}

export function MessageThread({ messages }: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // Track how many messages existed before this render to only animate new ones
  const prevLength = prevLengthRef.current;
  useEffect(() => {
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  return (
    <div ref={scrollRef} className="message-scroll flex-1 overflow-y-auto px-4 py-6" data-testid="message-thread">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg, i) => {
          const isNew = i >= prevLength;
          return (
            <div
              key={msg.id}
              className={isNew ? 'animate-message-appear' : undefined}
              style={isNew ? { animationDelay: `${Math.min((i - prevLength) * 30, 200)}ms` } : undefined}
            >
              {msg.role === 'user' ? (
                <UserMessage content={msg.content} />
              ) : (
                <AssistantMessage
                  content={msg.content}
                  agentRole={msg.agentRole}
                  // P1-4: pass through approval metadata so the assistant
                  // bubble can render inline Approve/Reject buttons.
                  approvalAction={msg.approvalAction}
                  conversationId={msg.conversationId}
                  messageId={msg.id}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── User Message ────────────────────────────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end" data-testid="user-message">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-4 py-2.5 text-sm leading-relaxed text-foreground">
        {content}
      </div>
    </div>
  );
}

// ─── Assistant Message ───────────────────────────────────────────────────────

function AssistantMessage({
  content,
  agentRole,
  approvalAction,
  conversationId,
  messageId,
}: {
  content: string;
  agentRole: string | null;
  approvalAction?: Message['approvalAction'];
  conversationId?: string;
  messageId?: string;
}) {
  const role = agentRole && agentRole in ROLES ? ROLES[agentRole as keyof typeof ROLES] : null;
  const color = role ? getRoleColor(role.id) : null;
  const Icon = role?.icon;

  return (
    <div className="flex gap-3" data-testid="assistant-message" data-agent-role={agentRole ?? ''}>
      {/* Role avatar */}
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={color ? { backgroundColor: color.muted } : { backgroundColor: 'hsl(var(--muted))' }}
      >
        {Icon ? (
          <Icon className="h-3.5 w-3.5" style={{ color: color?.base }} />
        ) : (
          <span className="text-[10px] font-bold text-muted-foreground">AI</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {/* Role label */}
        {role && (
          <span
            className="role-chip mb-1"
            style={{ backgroundColor: color?.muted, color: color?.base }}
          >
            {role.label}
          </span>
        )}

        {/* Message body */}
        <div
          className={cn(
            'rounded-2xl rounded-tl-md bg-card border border-border px-4 py-2.5 text-sm leading-relaxed text-foreground',
            agentRole && `role-border-${agentRole}`,
          )}
        >
          <p className="whitespace-pre-wrap">{content}</p>

          {/* P1-4: inline approval UI. Only renders when the message
              carries `approvalAction`. Buttons hit the existing
              approvalApi.decide / workflowApi.resume endpoints
              directly so the user never has to leave chat. The buttons
              hide once the approval is decided. */}
          {approvalAction && conversationId && messageId ? (
            <InlineApprovalControls
              approvalAction={approvalAction}
              conversationId={conversationId}
              messageId={messageId}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Inline approval controls (P1-4) ─────────────────────────────────────────
//
// Renders Approve / Reject / Defer buttons inside the chat bubble. Tries
// `approvalApi.decide(approvalId, ...)` first when the SSE event carried an
// approvalId; falls back to `workflowApi.resume(workflowId, ...)` for
// workflows that emit `paused` before the approval row is persisted (the
// resume route does the right thing on either path).

function InlineApprovalControls({
  approvalAction,
  conversationId,
  messageId,
}: {
  approvalAction: NonNullable<Message['approvalAction']>;
  conversationId: string;
  messageId: string;
}) {
  const updateMessage = useConversationStore((s) => s.updateMessage);
  const [busy, setBusy] = useState<null | 'approved' | 'rejected' | 'deferred'>(null);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  // Sandbox-test result rendered inline below the action buttons.
  const [sandboxResult, setSandboxResult] = useState<null | {
    inputValid: boolean;
    inputIssues: string[];
    sandboxOutcome: 'ok' | 'not_configured' | 'failed';
    note?: string;
  }>(null);

  const runSandboxTest = async () => {
    if (sandboxBusy || !approvalAction.approvalId || approvalAction.status !== 'pending') return;
    setSandboxBusy(true);
    try {
      const result = await approvalApi.sandboxTest(approvalAction.approvalId);
      setSandboxResult({
        inputValid: Boolean(result.inputValid),
        inputIssues: Array.isArray(result.inputIssues) ? result.inputIssues : [],
        sandboxOutcome: (result.sandboxOutcome ?? 'failed') as 'ok' | 'not_configured' | 'failed',
        ...(typeof result.note === 'string' ? { note: result.note } : {}),
      });
    } catch (err) {
      setSandboxResult({
        inputValid: false,
        inputIssues: [err instanceof Error ? err.message : 'Sandbox test failed'],
        sandboxOutcome: 'failed',
      });
    } finally {
      setSandboxBusy(false);
    }
  };

  const dispatch = async (decision: 'APPROVED' | 'REJECTED' | 'DEFERRED') => {
    if (busy || approvalAction.status !== 'pending') return;
    const target: 'approved' | 'rejected' | 'deferred' =
      decision === 'APPROVED' ? 'approved' : decision === 'REJECTED' ? 'rejected' : 'deferred';
    setBusy(target);
    try {
      // Prefer the per-approval endpoint when the SSE event carried an id;
      // fall back to the workflow-resume endpoint otherwise.
      if (approvalAction.approvalId) {
        await approvalApi.decide(approvalAction.approvalId, decision);
      } else {
        await workflowApi.resume(approvalAction.workflowId, decision);
      }
      updateMessage(conversationId, messageId, {
        approvalAction: {
          ...approvalAction,
          status: target,
          decidedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Decision failed';
      updateMessage(conversationId, messageId, {
        approvalAction: {
          ...approvalAction,
          // Keep status as pending so the user can retry; surface the error.
          error: errorMessage,
        },
      });
    } finally {
      setBusy(null);
    }
  };

  if (approvalAction.status !== 'pending') {
    const label = approvalAction.status === 'approved'
      ? 'Approved'
      : approvalAction.status === 'rejected'
        ? 'Rejected'
        : 'Deferred';
    const colorCls = approvalAction.status === 'approved'
      ? 'text-emerald-600 dark:text-emerald-400'
      : approvalAction.status === 'rejected'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-amber-600 dark:text-amber-400';
    return (
      <div className="mt-3 flex items-center gap-2 text-xs font-sans">
        <Check className={cn('h-3.5 w-3.5', colorCls)} aria-hidden="true" />
        <span className={cn('font-medium', colorCls)}>{label}</span>
        {approvalAction.decidedAt && (
          <span className="text-muted-foreground">
            · {new Date(approvalAction.decidedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    );
  }

  // Item B (OpenClaw-inspired Phase 1) — reviewer-context fields. We
  // render only those that are populated so legacy approvals (pre-Item B)
  // show a clean card with just the rationale + buttons.
  const hasContext =
    Boolean(approvalAction.toolName) ||
    Boolean(approvalAction.externalService) ||
    (approvalAction.filesAffected?.length ?? 0) > 0 ||
    Boolean(approvalAction.expectedResult);

  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="inline-approval-controls">
      {hasContext && (
        <div
          className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-foreground/80 space-y-1"
          data-testid="approval-context-panel"
        >
          {approvalAction.toolName && (
            <div className="flex items-center gap-1.5">
              <Wrench className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium text-foreground">Tool:</span>
              <span className="font-mono">{approvalAction.toolName}</span>
            </div>
          )}
          {approvalAction.externalService && (
            <div className="flex items-center gap-1.5">
              <Cloud className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium text-foreground">Service:</span>
              <span>{approvalAction.externalService}</span>
            </div>
          )}
          {approvalAction.filesAffected && approvalAction.filesAffected.length > 0 && (
            <div className="flex items-start gap-1.5">
              <FileText className="h-3 w-3 mt-0.5 text-muted-foreground" aria-hidden="true" />
              <div>
                <span className="font-medium text-foreground">Files:</span>{' '}
                <span className="font-mono">
                  {approvalAction.filesAffected.slice(0, 5).join(', ')}
                  {approvalAction.filesAffected.length > 5
                    ? ` (+${approvalAction.filesAffected.length - 5} more)`
                    : ''}
                </span>
              </div>
            </div>
          )}
          {approvalAction.expectedResult && (
            <div className="flex items-start gap-1.5">
              <Sparkles className="h-3 w-3 mt-0.5 text-muted-foreground" aria-hidden="true" />
              <div>
                <span className="font-medium text-foreground">Expected:</span>{' '}
                <span>{approvalAction.expectedResult}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => dispatch('APPROVED')}
          disabled={busy !== null}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold',
            'bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors',
          )}
          aria-label="Approve workflow"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {busy === 'approved' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => dispatch('REJECTED')}
          disabled={busy !== null}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold',
            'bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 transition-colors',
          )}
          aria-label="Reject workflow"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {busy === 'rejected' ? 'Rejecting…' : 'Reject'}
        </button>
        <button
          type="button"
          onClick={() => dispatch('DEFERRED')}
          disabled={busy !== null}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium',
            'border border-border bg-background text-foreground hover:bg-muted disabled:opacity-50 transition-colors',
          )}
          aria-label="Defer decision"
        >
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {busy === 'deferred' ? 'Deferring…' : 'Defer'}
        </button>
        {/* Item B — Phase 1 deferral CLOSED.
            "Run sandbox first" calls POST /approvals/:id/sandbox-test which:
            (a) re-hashes proposedDataJson and surfaces any payload-binding
                drift,
            (b) lints common red flags (e.g. malformed recipient addresses),
            (c) exercises the existing E2B/Docker sandbox adapter when one
                is configured (returns `not_configured` honestly otherwise).
            The pending approval is NEVER mutated — pure dry-run preview. */}
        {hasContext && approvalAction.approvalId && (
          <button
            type="button"
            disabled={sandboxBusy}
            onClick={runSandboxTest}
            title="Dry-run preview — re-hashes the payload, lints inputs, runs in sandbox if available. Never executes the real action."
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium',
              'border border-border bg-background text-foreground hover:bg-muted disabled:opacity-50 transition-colors',
            )}
            aria-label="Run sandbox dry-run before approving"
            data-testid="run-sandbox-first-btn"
          >
            <Beaker className="h-3.5 w-3.5" aria-hidden="true" />
            {sandboxBusy ? 'Testing…' : 'Run sandbox first'}
          </button>
        )}
        {sandboxResult && (
          <div
            className={cn(
              'mt-2 w-full rounded-md border px-3 py-2 text-[11px] leading-relaxed',
              sandboxResult.inputValid
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
            )}
            data-testid="sandbox-test-result"
          >
            <div className="font-semibold">
              Sandbox dry-run: {sandboxResult.inputValid ? 'inputs look OK' : `${sandboxResult.inputIssues.length} issue(s)`}
              {' · '}
              <span className="font-mono">sandbox: {sandboxResult.sandboxOutcome}</span>
            </div>
            {sandboxResult.inputIssues.length > 0 && (
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {sandboxResult.inputIssues.map((iss, i) => (
                  <li key={i}>{iss}</li>
                ))}
              </ul>
            )}
            {sandboxResult.note && (
              <p className="mt-1 text-foreground/60">{sandboxResult.note}</p>
            )}
          </div>
        )}
        {approvalAction.error ? (
          <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {approvalAction.error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
