'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { PanelRightOpen, PanelRightClose } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ChatInput, type ChatAttachment } from './ChatInput';
import { MessageThread } from './MessageThread';
import { EmptyState } from './EmptyState';
import { RolePicker } from './RolePicker';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  getWorkflowIdFromCreateResponse,
  getErrorMessage,
  isWorkflowFollowupResponse,
  workflowApi,
} from '@/lib/api-client';
import { getRawToken } from '@/lib/auth';
import { connectSSE } from '@/lib/sse-fetch';
import { createClient } from '@/lib/supabase';
import type { RoleId } from '@/lib/role-config';
import type { WorkflowPlan, WorkflowPlanStep, AgentRole, TaskStatus, RiskLevel, WorkflowStatus } from '@/types';
import { getAgentFriendlyLabel } from '@/lib/agent-friendly-names';
import { getToolFriendlyLabel, formatToolInputPreview } from '@/lib/tool-friendly-names';
import { renderAgentOutput } from '@/lib/render-agent-output';
import { DetailDrawer } from './DetailDrawer';
import { mapPlanStatus, updateCockpitTaskStatus, formatCockpitCost, formatCostFooter } from '@/lib/chat-helpers';
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
export interface CockpitState {
  plan: WorkflowPlan | null;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed';
  costUsd: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** Set of runtimes observed across cost_updated events (e.g. "openai-responses"). */
  runtimes?: Set<string>;
  /** Set of OpenAI models observed across cost_updated events. */
  models?: Set<string>;
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
  // Track terminal + final-message state per workflow to avoid duplicate
  // assistant answers when both failed/completed signals race in noisy networks.
  const terminalWorkflowsRef = useRef<Set<string>>(new Set());
  const finalMessageSentRef = useRef<Set<string>>(new Set());
  // Stage 2.4: per-workflow cockpit state. Plan + step statuses + cost
  // are aggregated from SSE events as the workflow runs; the
  // DetailDrawer reads from cockpitByWorkflow[activeWorkflowId] to
  // render the live TaskList + WorkflowDAG.
  const [cockpitByWorkflow, setCockpitByWorkflow] = useState<Record<string, CockpitState>>({});
  const conversation = useActiveConversation();
  const messages = useActiveMessages();
  const activeRoles = useConversationStore((s) => s.activeRoles);
  const createConversation = useConversationStore((s) => s.createConversation);
  const ensureActiveConversation = useConversationStore((s) => s.ensureActiveConversation);
  const addMessage = useConversationStore((s) => s.addMessage);
  const drawerOpen = useConversationStore((s) => s.drawerOpen);
  const setDrawerOpen = useConversationStore((s) => s.setDrawerOpen);
  // Hydration tracking — gates the Send button against the localStorage
  // race where a click lands before zustand-persist has restored
  // activeConversationId. See store comment for the contract.
  const hasHydrated = useConversationStore((s) => s._hasHydrated);
  const isMobile = useMediaQuery('(max-width: 767px)');
  // Narrow breakpoint: tablets and small desktops where the 480px drawer
  // squeezes the chat area below usable width. On these viewports we force
  // the mobile bottom-sheet pattern instead.
  const isNarrow = useMediaQuery('(max-width: 860px)');
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup SSE + polling on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
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

    // Defensive: every silent-return path was a real bug we hit during
    // local QA — store rehydration race + double-fire in flight + empty
    // input. Each one now logs to console (so the developer console
    // shows WHY the click did nothing) and the empty-input path runs
    // even with hydration in flight (we self-heal by creating a
    // conversation rather than bailing).
    if (!hasHydrated) {
      // Hydration race: persist hasn't restored yet. Disabling the
      // button is the primary defense (ChatInput's `disabled` prop);
      // this branch is the belt-and-suspenders log so a future bug
      // in the disabled-prop path doesn't reproduce as a silent
      // no-op.
      console.warn('[ChatWorkspace] Send blocked: store still hydrating from localStorage. Try again in a moment.');
      return;
    }
    if (!text && readyAttachments.length === 0) {
      console.warn('[ChatWorkspace] Send blocked: empty input + no ready attachments.');
      return;
    }
    if (isSending) {
      console.warn('[ChatWorkspace] Send blocked: a previous send is still in flight.');
      return;
    }

    // Auto-heal: ensureActiveConversation creates one when none exists,
    // so even after a localStorage clear the first send creates a
    // conversation rather than no-oping. Idempotent when already set.
    const convId = ensureActiveConversation(activeRoles);

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
      const createResult = await workflowApi.create(goalText, undefined, activeRoles, convId);
      const workflowId = getWorkflowIdFromCreateResponse(createResult);
      if (!workflowId) {
        throw new Error('Workflow API did not return a valid workflow ID.');
      }

      setActiveWorkflowId(workflowId);
      terminalWorkflowsRef.current.delete(workflowId);
      finalMessageSentRef.current.delete(workflowId);

      if (isWorkflowFollowupResponse(createResult)) {
        const followupSummary =
          (typeof createResult.hint === 'string' && createResult.hint.trim().length > 0
            ? createResult.hint
            : createResult.description) ??
          'Applied your follow-up command to the active workflow.';

        addMessage(convId, {
          role: 'assistant',
          agentRole: activeRoles[0] ?? null,
          content:
            `${followupSummary} ` +
            `View live status in [Run Inspector](/swarm?workflowId=${workflowId}).`,
          executionTrace: { workflowId },
        });
        return;
      }

      const workflow = createResult;

      const addFinalMessageOnce = (content: string, agentRole: RoleId | null): void => {
        if (finalMessageSentRef.current.has(workflow.id)) return;
        finalMessageSentRef.current.add(workflow.id);
        addMessage(convId, {
          role: 'assistant',
          agentRole,
          content,
          executionTrace: { workflowId: workflow.id },
        });
      };

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

      // P0-A: use the guarded URL builder so stream setup fails loudly when
      // production NEXT_PUBLIC_API_URL is missing or points at localhost.
      const { buildApiUrl } = await import('@/lib/api-client');
      // DEV-ONLY: when the auth bypass is on, skip Supabase entirely
      // and use the literal bypass token. The API's stream route
      // accepts it via the same `?token=` query path the legacy
      // EventSource clients use. Same three-layer safety contract as
      // every other bypass path (apps/web/src/lib/api-client.ts).
      const DEV_BYPASS_ACTIVE = process.env['NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS'] === '1';
      let token = '';
      if (DEV_BYPASS_ACTIVE) {
        token = 'jak-dev-bypass';
      } else {
        token = getRawToken() ?? '';
        if (!token) {
          const supabase = createClient();
          const { data } = await supabase.auth.getSession();
          token = data?.session?.access_token ?? '';
        }
      }

      await connectSSE({
        url: buildApiUrl(`/workflows/${workflow.id}/stream`),
        token,
        signal: controller.signal,
        maxRetries: 5,
        onMessage: (event: unknown) => {
          const ev = event as Record<string, unknown>;
          const evType = ev.type as string;

          // Agent started a task — show progress + flip cockpit status.
          // Layman friendly name surfaced ("CMO Agent" not "WORKER_MARKETING").
          if (evType === 'worker_started' || evType === 'node_enter') {
            const friendlyLabel = getAgentFriendlyLabel(ev.agentRole as string | undefined);
            addMessage(convId, {
              role: 'assistant',
              agentRole: (ev.agentRole as RoleId) ?? activeRoles[0] ?? null,
              content: `⏳ ${friendlyLabel} working on: ${(ev.taskName as string) ?? 'task'}…`,
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
            const friendlyLabel = getAgentFriendlyLabel(ev.agentRole as string | undefined);
            addMessage(convId, {
              role: 'assistant',
              agentRole: (ev.agentRole as RoleId) ?? activeRoles[0] ?? null,
              content: `${success ? '✓' : '✗'} ${friendlyLabel}: ${(ev.taskName as string) ?? 'task'} ${success ? 'completed' : 'failed'}${duration}`,
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
            const friendlyLabel = getToolFriendlyLabel(toolName);
            const displayInput = formatToolInputPreview(toolName, inputPreview);
            addMessage(convId, {
              role: 'assistant',
              agentRole: (ev.agentRole as RoleId) ?? null,
              content: `🔍 ${friendlyLabel}${displayInput ? ` — \`${displayInput}\`` : ''}`,
              executionTrace: { workflowId: workflow.id },
            });
          // Stage 2.2: tool call completed — honest success/failure + duration
          } else if (evType === 'tool_completed') {
            const toolName = (ev.toolName as string) ?? 'tool';
            const friendlyLabel = getToolFriendlyLabel(toolName);
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
                ? `${icon} **${friendlyLabel}** failed${duration} — ${err}`
                : `${icon} **${friendlyLabel}** done${duration}${honestyTag}`,
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
            // Capture runtime + model into the cockpit so the
            // DetailDrawer can show "openai-responses · gpt-5.4".
            const evRuntime = (ev.runtime as string | undefined) ?? null;
            const evModel = (ev.model as string | undefined) ?? null;
            // Mirror into cockpit state for live display in DetailDrawer.
            setCockpitByWorkflow((prev) => {
              const existing = prev[wfid] ?? { plan: null, status: 'running' as const, costUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 };
              const runtimes = new Set<string>(existing.runtimes ?? []);
              if (evRuntime) runtimes.add(evRuntime);
              const models = new Set<string>(existing.models ?? []);
              if (evModel) models.add(evModel);
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
            terminalWorkflowsRef.current.add(workflow.id);
            void workflowApi.get(workflow.id).then((w) => {
              const raw = typeof w.finalOutput === 'string' ? w.finalOutput : '';
              const display = renderAgentOutput(raw);

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
                addFinalMessageOnce(display + costFooter, activeRoles[0] ?? null);
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
            }).catch(() => {
              // GET /workflows/:id failed (network, auth, timeout) — show a
              // fallback so the user isn't left with a blank response.
              addFinalMessageOnce(
                'Workflow completed but the final response could not be loaded. You can view the detailed trace in [Run Inspector](/swarm).',
                activeRoles[0] ?? null,
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
            terminalWorkflowsRef.current.add(workflow.id);
            const fallbackError = (ev.error as string) ?? (ev.message as string) ?? (ev.code as string);
            setCockpitByWorkflow((prev) =>
              prev[workflow.id]
                ? { ...prev, [workflow.id]: { ...prev[workflow.id]!, status: 'failed' } }
                : prev,
            );
            void workflowApi.get(workflow.id).then((w) => {
              const raw = typeof w.finalOutput === 'string' ? w.finalOutput : '';
              const rendered = renderAgentOutput(raw);
              if (rendered.trim().length > 0 && !rendered.startsWith('JAK completed the run, but no final')) {
                addFinalMessageOnce(rendered, activeRoles[0] ?? null);
              } else {
                addFinalMessageOnce(
                  `Workflow failed: ${fallbackError ?? 'Unknown error'}. You can view the detailed trace in [Run Inspector](/swarm?workflowId=${workflow.id}).`,
                  null,
                );
              }
            }).catch(() => {
              addFinalMessageOnce(`Workflow failed: ${fallbackError ?? 'Unknown error'}`, null);
            });
            setIsSending(false);
            setIsStuck(false);
          // Workflow paused for approval — P1-4 fix: surface inline
          // Approve / Reject / Defer buttons in the chat bubble itself
          // (instead of a markdown link to /workspace?tab=approvals).
          // The buttons hit the existing approvalApi.decide /
          // workflowApi.resume endpoints from inside the message
          // component, so the user never has to leave chat. The SSE
          // event sometimes carries an `approvalId` (when the approval
          // row was already persisted server-side) and sometimes
          // doesn't — in the latter case the inline component falls
          // back to /workflows/:id/resume.
          } else if (evType === 'paused') {
            const reason = (ev.reason as string) ?? (ev.taskName as string) ?? 'a high-risk action';
            const approvalId = (ev.approvalId as string | undefined) ?? (ev.approvalRequestId as string | undefined);
            // Item B (OpenClaw-inspired Phase 1) — reviewer-context fields.
            // The `paused` SSE event carries the same fields stored on
            // ApprovalRequest so the inline approval card can render
            // tool / files / service / expected-result without a
            // round-trip. All optional — older payloads omit them and
            // the card falls back to just `reason`.
            const toolName = ev.toolName as string | undefined;
            const filesAffectedRaw = ev.filesAffected;
            const filesAffected = Array.isArray(filesAffectedRaw)
              ? (filesAffectedRaw.filter((s): s is string => typeof s === 'string'))
              : undefined;
            const externalService = ev.externalService as string | undefined;
            const expectedResult = ev.expectedResult as string | undefined;
            const proposedDataHash = ev.proposedDataHash as string | undefined;
            addMessage(convId, {
              role: 'assistant',
              agentRole: null,
              content: `🔏 Approval needed — workflow paused before \`${reason}\`.`,
              executionTrace: { workflowId: workflow.id },
              approvalAction: {
                workflowId: workflow.id,
                ...(approvalId ? { approvalId } : {}),
                reason,
                status: 'pending',
                ...(toolName ? { toolName } : {}),
                ...(filesAffected && filesAffected.length > 0 ? { filesAffected } : {}),
                ...(externalService ? { externalService } : {}),
                ...(expectedResult ? { expectedResult } : {}),
                ...(proposedDataHash ? { proposedDataHash } : {}),
              },
            });
            setCockpitByWorkflow((prev) =>
              prev[workflow.id]
                ? { ...prev, [workflow.id]: { ...prev[workflow.id]!, status: 'paused' } }
                : prev,
            );
            // The workflow is paused waiting for human input — clear the
            // "Thinking…" spinner so the user sees the approval card
            // instead of a stale loading state.
            setIsSending(false);
            setIsStuck(false);
          } else if (evType === 'cancelled') {
            // Workflow cancelled (e.g. approval rejected, manual cancel).
            // The backend emits this event when the workflow transitions to
            // CANCELLED status during an active SSE stream.
            terminalWorkflowsRef.current.add(workflow.id);
            const cancelReason = (ev.reason as string) ?? 'Workflow was cancelled';
            addMessage(convId, {
              role: 'assistant',
              agentRole: null,
              content: `⛔ ${cancelReason}. You can view the details in [Run Inspector](/swarm?workflowId=${workflow.id}).`,
              executionTrace: { workflowId: workflow.id },
            });
            setCockpitByWorkflow((prev) =>
              prev[workflow.id]
                ? { ...prev, [workflow.id]: { ...prev[workflow.id]!, status: 'failed' } }
                : prev,
            );
            setIsSending(false);
            setIsStuck(false);
          }
        },
        onError: () => {
          // Stream disconnect after all retries exhausted — only notify if the
          // workflow has not already reached a terminal event.
          if (controller.signal.aborted || terminalWorkflowsRef.current.has(workflow.id)) {
            setIsSending(false);
            setIsStuck(false);
            return;
          }
          addMessage(convId, {
            role: 'assistant',
            agentRole: null,
            content: `Live stream disconnected. Switching to polling fallback…`,
          });

          // Clear any previous poll for this workflow
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }

          let pollCount = 0;
          const MAX_POLLS = 60; // 5 minutes at 5s intervals

          const poll = async () => {
            if (terminalWorkflowsRef.current.has(workflow.id)) {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              setIsSending(false);
              setIsStuck(false);
              return;
            }

            pollCount += 1;
            if (pollCount > MAX_POLLS) {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              addMessage(convId, {
                role: 'assistant',
                agentRole: null,
                content: `Polling timed out after 5 minutes. Open [Run Inspector](/swarm?workflowId=${workflow.id}) for the latest status.`,
              });
              setIsSending(false);
              setIsStuck(false);
              return;
            }

            try {
              const w = await workflowApi.get(workflow.id);

              // Replay plan into cockpit if SSE missed plan_created
              const planJson = (w as unknown as { planJson?: unknown }).planJson;
              if (planJson) {
                const plan = typeof planJson === 'string' ? JSON.parse(planJson) : planJson;
                if (
                  plan &&
                  typeof plan === 'object' &&
                  Array.isArray((plan as { tasks?: unknown }).tasks) &&
                  ((plan as { tasks?: unknown[] }).tasks ?? []).length > 0
                ) {
                  setCockpitByWorkflow((prev) => {
                    if (prev[workflow.id]?.plan) return prev; // already have plan
                    const tasks = (plan as { tasks: Array<{ id: string; name?: string; description?: string; agentRole?: string; dependsOn?: string[]; status?: string; riskLevel?: string }> }).tasks;
                    const steps: WorkflowPlanStep[] = tasks.map((t, i) => ({
                      id: t.id,
                      stepNumber: i + 1,
                      taskName: t.name ?? t.description ?? `Task ${i + 1}`,
                      description: t.description ?? '',
                      agentRole: (t.agentRole ?? 'WORKER_OPS') as AgentRole,
                      riskLevel: ((t.riskLevel ?? 'LOW').toUpperCase()) as RiskLevel,
                      status: (mapPlanStatus(t.status ?? 'PENDING')) as TaskStatus,
                      dependsOn: t.dependsOn ?? [],
                    }));
                    const wfPlan: WorkflowPlan = {
                      id: `plan_${workflow.id}`,
                      workflowId: workflow.id,
                      steps,
                      createdAt: new Date().toISOString(),
                    };
                    return {
                      ...prev,
                      [workflow.id]: {
                        ...(prev[workflow.id] ?? { plan: null, status: 'running', costUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 }),
                        plan: wfPlan,
                        status: 'running',
                      },
                    };
                  });
                }
              }

              const terminalStatuses: WorkflowStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
              if (terminalStatuses.includes(w.status)) {
                terminalWorkflowsRef.current.add(workflow.id);
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                }

                const raw = typeof w.finalOutput === 'string' ? w.finalOutput : '';
                const display = renderAgentOutput(raw);
                addFinalMessageOnce(display, activeRoles[0] ?? null);
                setCockpitByWorkflow((prev) =>
                  prev[workflow.id]
                    ? { ...prev, [workflow.id]: { ...prev[workflow.id]!, status: w.status === 'COMPLETED' ? 'completed' : 'failed' } }
                    : prev,
                );
                setIsSending(false);
                setIsStuck(false);
              }
            } catch (err) {
              console.warn('[ChatWorkspace] Polling fallback error:', err);
            }
          };

          pollRef.current = setInterval(poll, 5000);
          void poll(); // immediate first poll
        },
      });
    } catch (err) {
      addMessage(convId, {
        role: 'assistant',
        agentRole: null,
        content: `Failed to start workflow: ${getErrorMessage(err)}. Please try again.`,
      });
    } finally {
      setIsSending(false);
    }
  }, [inputValue, attachments, isSending, hasHydrated, activeRoles, ensureActiveConversation, addMessage]);

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
                  View in Run Inspector →
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
          {/* P1-6: Live cost ticker. Renders only when there's an active
              workflow with non-zero call count, so it stays out of the way
              when the user is just typing. Shows "$0.0042 · 6 calls · 12k
              tokens" updated in real time from cost_updated SSE events.
              Source-of-truth is the same `cockpitByWorkflow[activeWorkflowId]`
              the completion message reads, so the live ticker and the
              final summary are guaranteed consistent. */}
          {activeWorkflowId && cockpitByWorkflow[activeWorkflowId]?.calls && cockpitByWorkflow[activeWorkflowId]!.calls > 0 ? (
            <div
              className="border-t border-border bg-muted/30 px-4 py-1.5 text-[11px] font-mono text-muted-foreground flex items-center gap-2"
              role="status"
              aria-live="polite"
              data-testid="live-cost-ticker"
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"
                aria-hidden="true"
              />
              <span className="uppercase tracking-widest text-[10px] text-muted-foreground/70">
                Cost so far
              </span>
              <span className="text-foreground tabular-nums">
                {formatCostFooter(cockpitByWorkflow[activeWorkflowId]!)}
              </span>
            </div>
          ) : null}

          <div className="border-t border-border px-4 pt-2" data-testid="role-picker-bar">
            <RolePicker compact />
          </div>

          <ChatInput
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            // Disable Send while the conversation store is rehydrating
            // from localStorage. Without this, a click that lands during
            // the hydration race silently no-oped — see
            // conversation-store._hasHydrated for the contract. ChatInput
            // adds an aria-busy="true" state internally so the disabled
            // reason is exposed to assistive tech, not just visually.
            disabled={!hasHydrated || isSending}
          />
        </div>

        {/* Detail drawer — desktop: side panel, narrow/mobile: bottom sheet overlay */}
        {drawerOpen && !isNarrow && (
          <aside
            className={cn(
              'w-[320px] md:w-[400px] lg:w-[480px] shrink-0 border-l border-border bg-card overflow-y-auto',
              'animate-fade-up',
            )}
          >
            <DetailDrawer
              onClose={() => setDrawerOpen(false)}
              cockpitByWorkflow={cockpitByWorkflow}
            />
          </aside>
        )}

        {drawerOpen && isNarrow && (
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

