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
import type { WorkflowPlan, WorkflowPlanStep, AgentRole, TaskStatus, RiskLevel } from '@/types';
import { TaskList } from '@/components/workspace/TaskList';
import { WorkflowDAG } from '@/components/graph/WorkflowDAG';
import {
  useConversationStore,
  useActiveConversation,
  useActiveMessages,
} from '@/store/conversation-store';

/**
 * Stage 2.4 — Cockpit state. Per-workflow plan + live status updates so
 * the DetailDrawer can render the existing TaskList + WorkflowDAG
 * components against real backend data. The plan is built from the
 * `plan_created` SSE event; status updates come from `worker_started`,
 * `worker_completed` (success → COMPLETED, !success → FAILED), and
 * `paused` (→ AWAITING_APPROVAL). Cost mirror lives in the same shape
 * for the cockpit footer.
 */
interface CockpitState {
  plan: WorkflowPlan | null;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed';
  costUsd: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** Set of runtimes observed across cost_updated events (e.g. "openai-responses"). */
  runtimes?: Set<string>;
  /** Set of models actually used (covers both first-choice + fallbacks). */
  models?: Set<string>;
  /** Whether any LLM call fell back to a non-preferred model mid-run. */
  fallbackUsed?: boolean;
}

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
  // Stage 2.4: per-workflow cockpit state. Plan + step statuses + cost
  // are aggregated from SSE events as the workflow runs; the
  // DetailDrawer reads from cockpitByWorkflow[activeWorkflowId] to
  // render the live TaskList + WorkflowDAG.
  const [cockpitByWorkflow, setCockpitByWorkflow] = useState<Record<string, CockpitState>>({});
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

          // Agent started a task — show progress + flip cockpit status
          if (evType === 'worker_started' || evType === 'node_enter') {
            addMessage(convId, {
              role: 'assistant',
              agentRole: (ev.agentRole as RoleId) ?? activeRoles[0] ?? null,
              content: `⏳ ${(ev.agentRole as string) ?? 'Agent'} working on: ${(ev.taskName as string) ?? 'task'}…`,
              executionTrace: { workflowId: workflow.id },
            });
            const role = ev.agentRole as string | undefined;
            if (role) {
              updateCockpitTaskStatus(setCockpitByWorkflow, workflow.id, role, 'IN_PROGRESS');
            }
          // Agent completed a task — show result + flip cockpit status
          } else if (evType === 'worker_completed' || evType === 'node_exit') {
            const success = ev.success !== false;
            const duration = ev.durationMs ? ` (${((ev.durationMs as number) / 1000).toFixed(1)}s)` : '';
            addMessage(convId, {
              role: 'assistant',
              agentRole: (ev.agentRole as RoleId) ?? activeRoles[0] ?? null,
              content: `${success ? '✓' : '✗'} ${(ev.agentRole as string) ?? 'Agent'}: ${(ev.taskName as string) ?? 'task'} ${success ? 'completed' : 'failed'}${duration}`,
              executionTrace: { workflowId: workflow.id },
            });
            const role = ev.agentRole as string | undefined;
            if (role) {
              updateCockpitTaskStatus(setCockpitByWorkflow, workflow.id, role, success ? 'COMPLETED' : 'FAILED');
            }
          // Stage 2.1 + 2.4: planner emitted a structured plan. Render
          // as a compact task-list bubble in chat AND populate the
          // cockpit state so the DetailDrawer's TaskList + WorkflowDAG
          // can show the same plan with live status updates.
          } else if (evType === 'plan_created') {
            const plan = ev.plan as { goal?: string; tasks?: Array<{ id: string; name?: string; description?: string; agentRole?: string; dependsOn?: string[]; status?: string; riskLevel?: string; requiresApproval?: boolean }> } | undefined;
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

              // Populate cockpit state — same data, structured for the
              // existing TaskList + WorkflowDAG components.
              const steps: WorkflowPlanStep[] = plan.tasks.map((t, i) => ({
                id: t.id,
                stepNumber: i + 1,
                taskName: t.name ?? t.description ?? `Task ${i + 1}`,
                description: t.description ?? '',
                agentRole: (t.agentRole ?? 'WORKER_OPS') as AgentRole,
                riskLevel: ((t.riskLevel ?? 'LOW').toUpperCase()) as RiskLevel,
                status: (mapPlanStatus(t.status ?? 'pending')) as TaskStatus,
                dependsOn: t.dependsOn ?? [],
              }));
              const wfPlan: WorkflowPlan = {
                id: `plan_${workflow.id}`,
                workflowId: workflow.id,
                steps,
                createdAt: new Date().toISOString(),
              };
              setCockpitByWorkflow((prev) => ({
                ...prev,
                [workflow.id]: {
                  ...(prev[workflow.id] ?? { plan: null, status: 'running', costUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 }),
                  plan: wfPlan,
                  status: 'running',
                },
              }));
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
            // Hardening pass: read the honest outcome from the tool registry
            // instead of guessing from substrings. real_success → ✓, draft →
            // ✎, mock → ⓘ mock, not_configured → ⚙ not connected, blocked → ⛔,
            // failed → ✗. Falls back to the legacy substring detection only
            // when the outcome field is absent (older event emitters).
            const outcome = (ev.outcome as string | undefined) ?? null;
            let icon = success ? '✓' : '✗';
            let honestyTag = '';
            if (outcome) {
              switch (outcome) {
                case 'real_success': icon = '✓'; break;
                case 'draft_created': icon = '✎'; honestyTag = ' — draft (not sent)'; break;
                case 'mock_provider': icon = 'ⓘ'; honestyTag = ' — mock data'; break;
                case 'not_configured': icon = '⚙'; honestyTag = ' — not connected'; break;
                case 'blocked_requires_config': icon = '⛔'; honestyTag = ' — blocked (requires config)'; break;
                case 'failed': icon = '✗'; break;
              }
            } else {
              // Legacy fallback: substring heuristic on outputSummary
              const output = (ev.outputSummary as string) ?? '';
              const honesty =
                /_mock|_notice|_warning|NOT sent|NOT created|NOT updated|draft only|not connected/i.exec(output);
              honestyTag = honesty ? ` — ⚠ ${honesty[0].replace(/^_/, '')}` : '';
            }
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
            // Capture runtime + model + fallback into the cockpit so the
            // DetailDrawer can show "openai-responses · gpt-5.4 · 1 fallback".
            const evRuntime = (ev.runtime as string | undefined) ?? null;
            const evModel = (ev.model as string | undefined) ?? null;
            const evFallback = (ev.fallbackModelUsed as string | undefined) ?? null;
            // Mirror into cockpit state for live display in DetailDrawer.
            setCockpitByWorkflow((prev) => {
              const existing = prev[wfid] ?? { plan: null, status: 'running' as const, costUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 };
              const runtimes = new Set<string>(existing.runtimes ?? []);
              if (evRuntime) runtimes.add(evRuntime);
              const models = new Set<string>(existing.models ?? []);
              if (evModel) models.add(evModel);
              if (evFallback) models.add(evFallback);
              return {
                ...prev,
                [wfid]: {
                  ...existing,
                  costUsd: cur.costUsd,
                  calls: cur.calls,
                  promptTokens: cur.promptTokens,
                  completionTokens: cur.completionTokens,
                  runtimes,
                  models,
                  fallbackUsed: existing.fallbackUsed || Boolean(evFallback),
                },
              };
            });
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
              // Cockpit: mark workflow completed (keep state so DetailDrawer
              // can still show the final plan + cost after run ends).
              setCockpitByWorkflow((prev) =>
                prev[workflow.id]
                  ? { ...prev, [workflow.id]: { ...prev[workflow.id]!, status: 'completed' } }
                  : prev,
              );
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
            setCockpitByWorkflow((prev) =>
              prev[workflow.id]
                ? { ...prev, [workflow.id]: { ...prev[workflow.id]!, status: 'failed' } }
                : prev,
            );
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
            setCockpitByWorkflow((prev) =>
              prev[workflow.id]
                ? { ...prev, [workflow.id]: { ...prev[workflow.id]!, status: 'paused' } }
                : prev,
            );
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
              'w-[480px] shrink-0 border-l border-border bg-card overflow-y-auto',
              'animate-fade-up',
            )}
          >
            <DetailDrawer
              onClose={() => setDrawerOpen(false)}
              cockpitByWorkflow={cockpitByWorkflow}
            />
          </aside>
        )}

        {drawerOpen && isMobile && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <div className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] rounded-t-2xl border-t border-border bg-card overflow-y-auto animate-fade-up">
              <DetailDrawer
                onClose={() => setDrawerOpen(false)}
                cockpitByWorkflow={cockpitByWorkflow}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Detail Drawer (Stage 2.4 cockpit) ──────────────────────────────────────
// The cockpit panel mounts the existing TaskList + WorkflowDAG components
// (already shipped in WorkspaceDashboard, here finally surfaced in chat)
// against per-workflow state aggregated from the SSE stream. Plan steps
// flip in real time as worker_started / worker_completed fire; cost is
// live; status badge follows the workflow state machine.

function DetailDrawer({
  onClose,
  cockpitByWorkflow,
}: {
  onClose: () => void;
  cockpitByWorkflow: Record<string, CockpitState>;
}) {
  const messages = useActiveMessages();
  // Find the most recent workflow ID from messages
  const workflowId = [...messages].reverse().find(m => m.executionTrace?.workflowId)?.executionTrace?.workflowId;
  const cockpit = workflowId ? cockpitByWorkflow[workflowId] : undefined;
  const [showGraph, setShowGraph] = useState(false);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Agent Run Cockpit</h3>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:hidden"
          aria-label="Close drawer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {!workflowId ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Send a message to start a workflow. The plan, agents, tool calls and cost will appear here in real time.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Status + workflow ID + links */}
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <code className="text-[10px] text-muted-foreground">{workflowId.slice(0, 18)}...</code>
              <CockpitStatusBadge status={cockpit?.status ?? 'queued'} />
            </div>
            {cockpit && cockpit.calls > 0 && (
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {formatCockpitCost(cockpit)}
              </div>
            )}
          </div>

          {/* Live task list — only renders once plan_created has fired */}
          {cockpit?.plan?.steps?.length ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                  Plan ({cockpit.plan.steps.length} step{cockpit.plan.steps.length === 1 ? '' : 's'})
                </span>
                <button
                  onClick={() => setShowGraph((g) => !g)}
                  className="text-[10px] text-primary hover:underline"
                >
                  {showGraph ? 'Hide DAG' : 'Show DAG'}
                </button>
              </div>
              <TaskList
                tasks={cockpit.plan.steps}
                workflowId={workflowId}
                showCompleted={cockpit.status === 'completed'}
              />
              {showGraph && (
                <div className="h-[280px] rounded-lg border border-border overflow-hidden">
                  <WorkflowDAG plan={cockpit.plan} workflowStatus={cockpit.status} />
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              Waiting for the planner to publish a plan…
            </p>
          )}

          {/* Inspector + traces links */}
          <div className="space-y-1.5 pt-1">
            <a
              href={`/swarm?workflowId=${workflowId}`}
              className="block rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] text-primary hover:bg-muted transition-colors"
            >
              Open in Runs Inspector →
            </a>
            <a
              href={`/traces?workflowId=${workflowId}`}
              className="block rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] text-primary hover:bg-muted transition-colors"
            >
              View full agent traces →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cockpit helpers ────────────────────────────────────────────────────────

/** Map the planner's task-status string (lowercase) to UI TaskStatus. */
function mapPlanStatus(s: string): TaskStatus {
  const u = s.toUpperCase();
  if (u === 'IN_PROGRESS' || u === 'COMPLETED' || u === 'FAILED' || u === 'AWAITING_APPROVAL' || u === 'SKIPPED' || u === 'PENDING') {
    return u as TaskStatus;
  }
  return 'PENDING';
}

/** Update the first task matching `agentRole` to a new status. Tasks are
 *  named with WORKER_* role keys; we match by suffix-insensitive substring
 *  to handle "PLANNER" / "WORKER_RESEARCH" / "Research" variants the
 *  swarm graph uses across nodes. */
function updateCockpitTaskStatus(
  setCockpit: React.Dispatch<React.SetStateAction<Record<string, CockpitState>>>,
  workflowId: string,
  agentRole: string,
  newStatus: TaskStatus,
): void {
  setCockpit((prev) => {
    const cur = prev[workflowId];
    if (!cur?.plan?.steps?.length) return prev;
    const upper = agentRole.toUpperCase();
    let touched = false;
    const steps = cur.plan.steps.map((s) => {
      if (touched) return s;
      const sRole = s.agentRole.toUpperCase();
      // Match exact OR strip WORKER_ prefix and substring match either way
      if (
        sRole === upper ||
        sRole === `WORKER_${upper}` ||
        upper === `WORKER_${sRole.replace(/^WORKER_/, '')}` ||
        sRole.endsWith(upper) ||
        upper.endsWith(sRole.replace(/^WORKER_/, ''))
      ) {
        touched = true;
        return { ...s, status: newStatus };
      }
      return s;
    });
    if (!touched) return prev;
    return {
      ...prev,
      [workflowId]: {
        ...cur,
        plan: { ...cur.plan, steps },
      },
    };
  });
}

/** Compact status badge for the cockpit header. */
function CockpitStatusBadge({ status }: { status: CockpitState['status'] }) {
  const config = {
    queued: { label: 'Queued', cls: 'bg-muted text-muted-foreground' },
    running: { label: 'Running', cls: 'bg-blue-500/10 text-blue-600' },
    paused: { label: 'Awaiting approval', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
    completed: { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-600' },
    failed: { label: 'Failed', cls: 'bg-destructive/10 text-destructive' },
  }[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${config.cls}`}>
      {config.label}
    </span>
  );
}

/** Cockpit cost line. Reuses the chat footer formatting logic. */
function formatCockpitCost(cockpit: CockpitState): string {
  const totalTokens = cockpit.promptTokens + cockpit.completionTokens;
  const tokenLabel =
    totalTokens >= 1_000_000
      ? `${(totalTokens / 1_000_000).toFixed(1)}M tokens`
      : totalTokens >= 1_000
        ? `${(totalTokens / 1_000).toFixed(1)}k tokens`
        : `${totalTokens} tokens`;
  const callsLabel = `${cockpit.calls} call${cockpit.calls === 1 ? '' : 's'}`;
  // Hardening pass: surface runtime + model honestly. The cockpit now
  // shows "openai-responses · gpt-5.4" when the runtime stamp is on the
  // event. If multiple models were used (fallback or multi-tier), they're
  // shown comma-joined. fallbackUsed adds " · fallback" suffix.
  const runtimeLabel = cockpit.runtimes && cockpit.runtimes.size > 0
    ? Array.from(cockpit.runtimes).join('+')
    : null;
  const modelLabel = cockpit.models && cockpit.models.size > 0
    ? Array.from(cockpit.models).join(',')
    : null;
  const stack = [runtimeLabel, modelLabel].filter(Boolean).join(' · ');
  const fallbackTag = cockpit.fallbackUsed ? ' · fallback' : '';

  if (cockpit.costUsd > 0) {
    const costLabel =
      cockpit.costUsd >= 0.01
        ? `$${cockpit.costUsd.toFixed(4)}`
        : `$${cockpit.costUsd.toFixed(6)}`;
    const base = `${costLabel} · ${callsLabel} · ${tokenLabel}`;
    return stack ? `${base} · ${stack}${fallbackTag}` : `${base}${fallbackTag}`;
  }
  const base = `${callsLabel} · ${tokenLabel}`;
  return stack ? `${base} · ${stack}${fallbackTag}` : `${base}${fallbackTag}`;
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
