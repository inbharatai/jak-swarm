'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { PanelRightOpen, PanelRightClose, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ChatInput } from './ChatInput';
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
    if (!text || isSending) return;

    // Capture or create conversation ID before any async work
    const convId = conversation?.id ?? createConversation(activeRoles);

    // Add user message
    addMessage(convId, {
      role: 'user',
      agentRole: null,
      content: text,
    });

    setInputValue('');
    setIsSending(true);

    try {
      // Create a real workflow via the API
      const workflow = await workflowApi.create(text);

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
          // Workflow completed — fetch and display final output
          } else if (evType === 'completed') {
            void workflowApi.get(workflow.id).then((w) => {
              if (w.finalOutput) {
                addMessage(convId, {
                  role: 'assistant',
                  agentRole: activeRoles[0] ?? null,
                  content: w.finalOutput as string,
                  executionTrace: { workflowId: workflow.id },
                });
              }
            });
          // Workflow failed
          } else if (evType === 'failed') {
            addMessage(convId, {
              role: 'assistant',
              agentRole: null,
              content: `Workflow failed: ${(ev.error as string) ?? 'Unknown error'}`,
            });
          // Workflow paused for approval
          } else if (evType === 'paused') {
            addMessage(convId, {
              role: 'assistant',
              agentRole: null,
              content: `Workflow paused — awaiting approval. Check the Runs page to approve or reject.`,
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
  }, [inputValue, isSending, conversation, activeRoles, createConversation, addMessage]);

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
            <div className="flex-1 overflow-y-auto">
              <EmptyState onStartChat={handleStartChat} />
            </div>
          )}

          {/* Thinking indicator */}
          {isSending && (
            <div className="flex items-center gap-2 px-6 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
              </div>
              <span className="text-xs text-muted-foreground">Thinking…</span>
            </div>
          )}

          {/* Role picker above input when messages exist */}
          {hasMessages && (
            <div className="border-t border-border px-4 pt-2">
              <RolePicker compact />
            </div>
          )}

          <ChatInput
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
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
