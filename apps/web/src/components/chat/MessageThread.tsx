'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Check, X, Clock, AlertTriangle } from 'lucide-react';
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

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="inline-approval-controls">
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
      {approvalAction.error ? (
        <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {approvalAction.error}
        </span>
      ) : null}
    </div>
  );
}
