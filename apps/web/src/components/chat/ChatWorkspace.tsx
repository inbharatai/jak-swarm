'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { PanelRightOpen, PanelRightClose, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ChatInput, type ChatAttachment } from './ChatInput';
import { MessageThread } from './MessageThread';
import { EmptyState } from './EmptyState';
import { RolePicker } from './RolePicker';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { workflowApi } from '@/lib/api-client';
import { connectSSE } from '@/lib/sse-fetch';
import { createClient } from '@/lib/supabase';
import type { RoleId } from '@/lib/role-config';
import {
  useConversationStore,
  useActiveConversation,
  useActiveMessages,
} from '@/store/conversation-store';

export function ChatWorkspace() {
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  // Attachments are held here (not inside ChatInput) so handleSend can
  // inject them into the workflow goal atomically and clear them after
  // send — avoiding any race with ChatInput-owned state. Docs are uploaded
  // on file pick (chip shows "uploading" → "ready"); only `ready` rows
  // get referenced in the outgoing goal text.
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  // Current live-workflow id, used by the "still working" fallback banner
  // below so the user can jump to /swarm if the SSE stream stalls past the
  // STUCK_THRESHOLD. QA finding: "Thinking..." used to hang indefinitely
  // when the workflow emitted intermediate events but never a terminal
  // `completed`/`failed` — leaving the user with no way out.
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [isStuck, setIsStuck] = useState(false);
  const STUCK_THRESHOLD_MS = 30_000;
  // Stage 2.6: per-workflow cost accumulator. Updated on every
  // cost_updated SSE event (one per LLM call) and surfaced on the
  // completion message so the user sees a single honest "$0.0123 · 4 calls"
  // footer instead of 20 mid-run cost noise bubbles. Keyed by workflowId
  // so concurrent workflows don't mix numbers.
  const costRef = useRef<Map<string, { costUsd: number; calls: number; promptTokens: number; completionTokens: number }>>(new Map());
  const conversation = useActiveConversation();
  const messages = useActiveMessages();
  const activeRoles = useConversationStore((s) => s.activeRoles);
  const createConversation = useConversationStore((s) => s.createConversation);
  const addMessage = useConversationStore((s) => s.addMessage);
  const drawerOpen = useConversationStore((s) => s.drawerOpen);
  const setDrawerOpen = useConversationStore((s) => s.setDrawerOpen);
  const isMobile = useMediaQuery('(max-width: 767px)');
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // "Stuck workflow" detector — QA finding from live demo: user sent "hi",
  // Commander + Agent reported `completed`, but the final synthesis event
  // never fired and the chat sat on "Thinking…" forever. This effect flips
  // `isStuck` true if isSending is still true after STUCK_THRESHOLD_MS, so
  // the UI can render a "still working" banner with a link to /swarm.
  useEffect(() => {
    if (!isSending) { setIsStuck(false); return; }
    const t = setTimeout(() => setIsStuck(true), STUCK_THRESHOLD_MS);
    return () => clearTimeout(t);
  }, [isSending]);

  // Close drawer on Escape
  useEffect(() => {
    if (!drawerOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [drawerOpen, setDrawerOpen]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    const readyAttachments = attachments.filter((a) => a.status === 'ready');
    // Accept an empty text body if the user is sending attachments only
    // ("look at this file") — but if BOTH text and attachments are empty,
    // or if we're already sending, no-op.
    if ((!text && readyAttachments.length === 0) || isSending) return;

    // Capture or create conversation ID before any async work
    const convId = conversation?.id ?? createConversation(activeRoles);

    // Build the user-facing message content (shows filenames in the chat
    // thread) and the workflow goal (adds an explicit hint so the Commander
    // knows to route to an agent with the find_document tool).
    const displayContent = readyAttachments.length > 0
      ? `${text}${text ? '\n\n' : ''}📎 ${readyAttachments.map((a) => a.fileName).join(', ')}`
      : text;

    const goalText = readyAttachments.length > 0
      ? `${text || 'Analyze the attached file(s).'}\n\n` +
        `[Attached files — resolve via the find_document tool by name or ID]\n` +
        readyAttachments.map((a) => `  - ${a.fileName} (documentId: ${a.id})`).join('\n')
      : text;

    // Add user message
    addMessage(convId, {
      role: 'user',
      agentRole: null,
      content: displayContent,
    });

    setInputValue('');
    setAttachments([]);
    setIsSending(true);
    setIsStuck(false);
    setActiveWorkflowId(null);

    try {
      // Create a real workflow via the API
      const workflow = await workflowApi.create(goalText, undefined, activeRoles);
      setActiveWorkflowId(workflow.id);

      // Add initial acknowledgement
      addMessage(convId, {
        role: 'assistant',
        agentRole: activeRoles[0] ?? null,
        content: `Workflow started — processing your request...`,
        executionTrace: { workflowId: workflow.id },
      });

      // Stream real-time updates via SSE
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const BASE_URL = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000').trim();
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token ?? '';

      await connectSSE({
        url: `${BASE_URL}/workflows/${workflow.id}/stream`,
        token,
        signal: controller.signal,
        onMessage: (event: unknown) => {
          const ev = event as Record<string, unknown>;
          const evType = ev.type as string;

          // Agent started a task — show progress
          if (evType === 'worker_started' || evType === 'node_enter') {
            addMessage(convId, {
              role: 'assistant',
              agentRole: (ev.agentRole as RoleId) ?? activeRoles[0] ?? null,
              content: `⏳ ${(ev.agentRole as string) ?? 'Agent'} working on: ${(ev.taskName as string) ?? 'task'}…`,
              executionTrace: { workflowId: workflow.id },
            });
          // Agent completed a task — show result
          } else if (evType === 'worker_completed' || evType === 'node_exit') {
            const success = ev.success !== false;
            const duration = ev.durationMs ? ` (${((ev.durationMs as number) / 1000).toFixed(1)}s)` : '';
            addMessage(convId, {
              role: 'assistant',
              agentRole: (ev.agentRole as RoleId) ?? activeRoles[0] ?? null,
              content: `${success ? '✓' : '✗'} ${(ev.agentRole as string) ?? 'Agent'}: ${(ev.taskName as string) ?? 'task'} ${success ? 'completed' : 'failed'}${duration}`,
              executionTrace: { workflowId: workflow.id },
            });
          // Stage 2.1: planner emitted a structured plan — render as a
          // compact task-list in chat so the user sees what JAK will do.
          } else if (evType === 'plan_created') {
            const plan = ev.plan as { goal?: string; tasks?: Array<{ id: string; name?: string; description?: string; agentRole?: string; requiresApproval?: boolean }> } | undefined;
            if (plan?.tasks?.length) {
              const lines = plan.tasks.map((t, i) => {
                const role = (t.agentRole ?? '').replace(/^WORKER_/, '');
                const approvalTag = t.requiresApproval ? ' 🔏 approval required' : '';
                return `${i + 1}. **${t.name ?? t.description ?? `Task ${i + 1}`}** — ${role || 'agent'}${approvalTag}`;
              }).join('\n');
              addMessage(convId, {
                role: 'assistant',
                agentRole: 'planner' as RoleId,
                content: `📋 **Plan**\n\n${lines}`,
                executionTrace: { workflowId: workflow.id },
              });
            }
          // Stage 2.2: tool call starting — compact live status row
          } else if (evType === 'tool_called') {
            const toolName = (ev.toolName as string) ?? 'tool';
            const inputPreview = (ev.inputSummary as string) ?? '';
            const shortInput = inputPreview.length > 80 ? inputPreview.slice(0, 77) + '…' : inputPreview;
            addMessage(convId, {
              role: 'assistant',
              agentRole: (ev.agentRole as RoleId) ?? null,
              content: `🔧 Calling **${toolName}**${shortInput ? ` — \`${shortInput}\`` : ''}`,
              executionTrace: { workflowId: workflow.id },
            });
          // Stage 2.2: tool call completed — honest success/failure + duration
          } else if (evType === 'tool_completed') {
            const toolName = (ev.toolName as string) ?? 'tool';
            const success = ev.success !== false;
            const duration = ev.durationMs ? ` (${((ev.durationMs as number) / 1000).toFixed(1)}s)` : '';
            const err = ev.error as string | undefined;
            const icon = success ? '✓' : '✗';
            // Surface the outputSummary when it contains honest flags
            // (_mock, _notice, _warning) or an error — so the user sees
            // "draft only" / "mock data" / "email NOT sent" instead of
            // a generic "completed".
            const output = (ev.outputSummary as string) ?? '';
            const honesty =
              /_mock|_notice|_warning|NOT sent|NOT created|NOT updated|draft only|not connected/i.exec(output);
            const honestyTag = honesty ? ` — ⚠ ${honesty[0].replace(/^_/, '')}` : '';
            addMessage(convId, {
              role: 'assistant',
              agentRole: (ev.agentRole as RoleId) ?? null,
              content: err
                ? `${icon} **${toolName}** failed${duration} — ${err}`
                : `${icon} **${toolName}** done${duration}${honestyTag}`,
              executionTrace: { workflowId: workflow.id },
            });
          // Stage 2.3 + 2.6: accumulate cost_updated events locally so
          // we can append a single truthful "$X.XXXX · N calls · Mk tokens"
          // footer to the final completion message. Keeps the mid-run
          // chat clean while still showing the user exactly what the
          // workflow cost them.
          } else if (evType === 'cost_updated') {
            const wfid = (ev.workflowId as string) ?? workflow.id;
            const cur = costRef.current.get(wfid) ?? { costUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 };
            cur.costUsd += (ev.costUsd as number) ?? 0;
            cur.calls += 1;
            cur.promptTokens += (ev.promptTokens as number) ?? 0;
            cur.completionTokens += (ev.completionTokens as number) ?? 0;
            costRef.current.set(wfid, cur);
          // Workflow completed — fetch and display final output.
          // QA H2 defence-in-depth: if the server's recovery layer missed
          // and `finalOutput` still matches the internal stub string, we
          // swap in a human-readable fallback here before rendering. The
          // literal "did not produce a user-facing response" must never
          // be shown to the user per the QA brief.
          } else if (evType === 'completed') {
            void workflowApi.get(workflow.id).then((w) => {
              const raw = typeof w.finalOutput === 'string' ? w.finalOutput : '';
              const STUB_RE = /Agents completed their work but did not produce a user-facing response|No output produced/i;
              const display = raw.trim().length === 0 || STUB_RE.test(raw)
                ? 'JAK completed the run, but no final response was generated. You can view the detailed trace in [Run Inspector](/swarm).'
                : raw;

              // Stage 2.6: append a single honest cost footer to the
              // final message — accumulated from all cost_updated SSE
              // events during the run. Formatted as "$0.0042 · 6 calls ·
              // 12k tokens" so the user sees exactly what the workflow
              // cost.
              const cost = costRef.current.get(workflow.id);
              const costFooter = cost && cost.calls > 0
                ? `\n\n---\n_${formatCostFooter(cost)}_`
                : '';

              if (display.length > 0) {
                addMessage(convId, {
                  role: 'assistant',
                  agentRole: activeRoles[0] ?? null,
                  content: display + costFooter,
                  executionTrace: { workflowId: workflow.id },
                });
              }
              // Free the per-workflow cost slot so a second workflow on
              // the same page starts fresh.
              costRef.current.delete(workflow.id);
            });
            // QA fix: stuck-workflow banner persisted after the terminal
            // event because isSending only cleared on SSE onError. Clear
            // the sending flag + stuck flag on terminal events so the
            // UI doesn't keep showing "Still running…" after the final
            // message has arrived.
            setIsSending(false);
            setIsStuck(false);
          // Workflow failed — but the API's GET /workflows/:id may still
          // surface a recovered finalOutput (e.g. Commander directAnswer
          // recovered from the trace when the graph routing failed). Fetch
          // it before showing the user a "failed" message.
          } else if (evType === 'failed') {
            const fallbackError = (ev.error as string) ?? (ev.message as string) ?? (ev.code as string);
            const STUB_RE = /Agents completed their work but did not produce a user-facing response|No output produced/i;
            void workflowApi.get(workflow.id).then((w) => {
              const raw = typeof w.finalOutput === 'string' ? w.finalOutput : '';
              if (raw.trim().length > 0 && !STUB_RE.test(raw)) {
                addMessage(convId, {
                  role: 'assistant',
                  agentRole: activeRoles[0] ?? null,
                  content: raw,
                  executionTrace: { workflowId: workflow.id },
                });
              } else {
                addMessage(convId, {
                  role: 'assistant',
                  agentRole: null,
                  content: `Workflow failed: ${fallbackError ?? 'Unknown error'}. You can view the detailed trace in [Run Inspector](/swarm).`,
                });
              }
            }).catch(() => {
              addMessage(convId, {
                role: 'assistant',
                agentRole: null,
                content: `Workflow failed: ${fallbackError ?? 'Unknown error'}`,
              });
            });
            setIsSending(false);
            setIsStuck(false);
          // Workflow paused for approval — Stage 2.5 fix: surface a
          // direct link inline so the user doesn't have to hunt for the
          // Runs page. The full approve/reject UX lives at /workspace
          // (ApprovalsInbox); we link straight there with the workflow
          // pre-selected. Previously the message just said "Check the
          // Runs page" which was a dead-end on a busy chat thread.
          } else if (evType === 'paused') {
            const reason = (ev.reason as string) ?? (ev.taskName as string) ?? 'a high-risk action';
            addMessage(convId, {
              role: 'assistant',
              agentRole: null,
              content:
                `🔏 **Approval needed** — workflow paused before \`${reason}\`. ` +
                `[Review and approve in the Approvals inbox →](/workspace?tab=approvals&workflow=${workflow.id})`,
              executionTrace: { workflowId: workflow.id },
            });
          }
        },
        onError: () => {
          // SSE disconnected — notify the user
          addMessage(convId, {
            role: 'assistant',
            agentRole: null,
            content: 'Live stream disconnected. Check the Runs page for the latest status.',
          });
          setIsSending(false);
        },
      });
    } catch (err) {
      addMessage(convId, {
        role: 'assistant',
        agentRole: null,
        content: `Failed to start workflow: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`,
      });
    } finally {
      setIsSending(false);
    }
  }, [inputValue, attachments, isSending, conversation, activeRoles, createConversation, addMessage]);

  const handleStartChat = useCallback(
    (prompt: string) => {
      setInputValue(prompt);
    },
    [],
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header bar: drawer toggle only (RolePicker moved above input) */}
      {hasMessages && (
        <div className="flex items-center justify-end border-b border-border px-4 py-2">
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="hidden md:flex rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={drawerOpen ? 'Close details' : 'Open details'}
          >
            {drawerOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {hasMessages ? (
            <MessageThread messages={messages} />
          ) : (
            // QA H1 fix: render the EmptyState above the input (not as a
            // gate). The input is always visible at the bottom of the
            // workspace; EmptyState is now a discoverability hint, not a
            // conditional that hides the textarea.
            <div className="flex-1 overflow-y-auto" data-testid="workspace-empty-state">
              <EmptyState onStartChat={handleStartChat} />
            </div>
          )}

          {/* Thinking indicator — with stuck-state fallback.
              The basic spinner shows while the workflow runs. If it hasn't
              produced a terminal event in STUCK_THRESHOLD_MS, we replace it
              with a clear "still working" message + a link to /swarm so
              the user can check the actual workflow status instead of
              staring at an infinite spinner. */}
          {isSending && !isStuck && (
            <div className="flex items-center gap-2 px-6 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
              </div>
              <span className="text-xs text-muted-foreground">Thinking…</span>
            </div>
          )}
          {isSending && isStuck && (
            <div className="flex items-center gap-3 px-6 py-3 border-t border-border bg-muted/30">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse [animation-delay:200ms]" />
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse [animation-delay:400ms]" />
              </div>
              <div className="flex-1 text-xs">
                <span className="text-foreground font-medium">Still running…</span>
                <span className="text-muted-foreground ml-1">
                  The workflow is taking longer than expected.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={activeWorkflowId ? `/swarm?workflowId=${activeWorkflowId}` : '/swarm'}
                  className="text-xs text-primary hover:underline whitespace-nowrap"
                >
                  View in Runs →
                </a>
                <button
                  type="button"
                  onClick={() => {
                    abortRef.current?.abort();
                    setIsSending(false);
                    setIsStuck(false);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss stuck indicator"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Role picker above input — ALWAYS visible (QA H1 fix).
              Previously this was gated on `hasMessages`, which meant a
              first-time user landed on the function-picker tile screen
              with no chat input visible. Now the picker rides above the
              input on every load so the user can both type and switch
              roles without an extra click. */}
          <div className="border-t border-border px-4 pt-2" data-testid="role-picker-bar">
            <RolePicker compact />
          </div>

          <ChatInput
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
          />
        </div>

        {/* Detail drawer — desktop: side panel, mobile: bottom sheet overlay */}
        {drawerOpen && !isMobile && (
          <aside
            className={cn(
              'w-[400px] shrink-0 border-l border-border bg-card overflow-y-auto',
              'animate-fade-up',
            )}
          >
            <DetailDrawer onClose={() => setDrawerOpen(false)} />
          </aside>
        )}

        {drawerOpen && isMobile && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <div className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] rounded-t-2xl border-t border-border bg-card overflow-y-auto animate-fade-up">
              <DetailDrawer onClose={() => setDrawerOpen(false)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Detail Drawer ───────────────────────────────────────────────────────────

function DetailDrawer({ onClose }: { onClose: () => void }) {
  const messages = useActiveMessages();
  // Find the most recent workflow ID from messages
  const workflowId = [...messages].reverse().find(m => m.executionTrace?.workflowId)?.executionTrace?.workflowId;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Execution Details</h3>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:hidden"
          aria-label="Close drawer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {workflowId ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-border bg-background px-3 py-2.5 text-xs">
            <span className="text-muted-foreground">Workflow:</span>{' '}
            <code className="text-foreground">{workflowId.slice(0, 12)}...</code>
          </div>
          <a
            href="/swarm"
            className="block rounded-lg border border-border bg-background px-3 py-2.5 text-xs text-primary hover:bg-muted transition-colors"
          >
            View in Runs Inspector →
          </a>
          <a
            href={`/traces?workflowId=${workflowId}`}
            className="block rounded-lg border border-border bg-background px-3 py-2.5 text-xs text-primary hover:bg-muted transition-colors"
          >
            View Agent Traces →
          </a>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Send a message to start a workflow. Execution details will appear here.
        </p>
      )}
    </div>
  );
}

// Stage 2.6 helper — format an honest per-workflow cost footer.
// Shape: "$0.0042 · 6 calls · 12k tokens". Keep values human-readable;
// $0 falls through to "Tracked: 6 calls · 12k tokens" so the user knows
// cost tracking happened even when all calls were on free-tier models.
function formatCostFooter(cost: {
  costUsd: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}): string {
  const totalTokens = cost.promptTokens + cost.completionTokens;
  const tokenLabel =
    totalTokens >= 1_000_000
      ? `${(totalTokens / 1_000_000).toFixed(1)}M tokens`
      : totalTokens >= 1_000
        ? `${(totalTokens / 1_000).toFixed(1)}k tokens`
        : `${totalTokens} tokens`;
  const callsLabel = `${cost.calls} call${cost.calls === 1 ? '' : 's'}`;
  if (cost.costUsd > 0) {
    const costLabel =
      cost.costUsd >= 0.01
        ? `$${cost.costUsd.toFixed(4)}`
        : `$${cost.costUsd.toFixed(6)}`;
    return `${costLabel} · ${callsLabel} · ${tokenLabel}`;
  }
  return `Tracked: ${callsLabel} · ${tokenLabel}`;
}
