'use client';

/**
 * Inbox — single-page state machine ('inbox' | 'read' | 'compose') backed
 * by the existing Gmail integration. Pattern adapted from RHCF-Seva
 * (github.com/inbharatai/RHCF-Seva), which uses one page with three render
 * branches rather than three routes. Mobile-friendly because there are no
 * URL transitions to fight when tapping back.
 *
 * The AI Assist panel in the compose view uses the standard workflow API:
 *   - Compose: draft a new email from a one-line angle
 *   - Reply:   draft a reply to the currently-open message
 *   - Edit:    rewrite the user's current draft
 *
 * Voice → AI prompt pattern (from RHCF-Seva) is deferred to the existing
 * ChatInput voice hook; the Inbox page doesn't reimplement speech capture
 * — it lets the user type their angle or use the Workspace chat for
 * voice-driven email drafting and then copy the result in here.
 *
 * Gate logic: if the Gmail integration is not CONNECTED, show a config
 * prompt instead of the feature. No half-state.
 */

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import {
  Mail,
  PenSquare,
  ArrowLeft,
  Sparkles,
  Send,
  Loader2,
  RefreshCw,
  Plug,
} from 'lucide-react';
import { Card, CardContent, Button, Input, Textarea, EmptyState } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dataFetcher, workflowApi } from '@/lib/api-client';
import type { Integration } from '@/types';

type View = 'inbox' | 'read' | 'compose';
type ComposeAction = 'compose' | 'reply' | 'edit';

interface InboxMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  body?: string;
}

const DAY_WINDOWS = [1, 3, 7, 14, 30] as const;
type DayWindow = (typeof DAY_WINDOWS)[number];

export default function InboxPage() {
  const toast = useToast();
  const [view, setView] = useState<View>('inbox');
  const [days, setDays] = useState<DayWindow>(7);
  const [openMessage, setOpenMessage] = useState<InboxMessage | null>(null);

  // Compose state
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState<null | ComposeAction>(null);
  const [sending, setSending] = useState(false);

  // Integration status
  const { data: integrationsData } = useSWR<Integration[]>(
    '/integrations',
    dataFetcher,
    { refreshInterval: 60_000 },
  );
  const gmail = (integrationsData ?? []).find((i) => i.provider === 'GMAIL');
  const isConfigured = gmail?.status === 'CONNECTED';

  // Inbox list
  const { data: inboxResp, isLoading, mutate } = useSWR<{ success: boolean; data: InboxMessage[] }>(
    isConfigured ? `/integrations/gmail/inbox?days=${days}` : null,
    dataFetcher,
  );
  const messages: InboxMessage[] = inboxResp?.data ?? [];

  const openRead = useCallback(async (msg: InboxMessage) => {
    setOpenMessage(msg);
    setView('read');
    // Pre-fetch full body if we only have the snippet
    if (!msg.body) {
      try {
        const full = await dataFetcher<{ success: boolean; data: InboxMessage }>(
          `/integrations/gmail/message/${encodeURIComponent(msg.id)}`,
        );
        if (full?.data) setOpenMessage(full.data);
      } catch {
        // keep the snippet view if the backend can't resolve
      }
    }
  }, []);

  const startReply = useCallback(() => {
    if (!openMessage) return;
    const emailMatch = openMessage.from.match(/<(.+?)>/);
    setComposeTo(emailMatch?.[1] ?? openMessage.from);
    setComposeSubject(
      openMessage.subject.startsWith('Re: ') ? openMessage.subject : `Re: ${openMessage.subject}`,
    );
    setComposeBody('');
    setAiPrompt('');
    setView('compose');
  }, [openMessage]);

  const startCompose = useCallback(() => {
    setComposeTo('');
    setComposeSubject('');
    setComposeBody('');
    setAiPrompt('');
    setOpenMessage(null);
    setView('compose');
  }, []);

  const runAi = useCallback(
    async (action: ComposeAction) => {
      if (!aiPrompt.trim() && action !== 'edit') {
        toast.warning('Describe what to write', 'Type a one-line angle in the AI prompt field first.');
        return;
      }
      setAiBusy(action);
      try {
        const context =
          action === 'reply' && openMessage
            ? `Reply to this message (quote tastefully, do not paste the whole thread):\nFrom: ${openMessage.from}\nSubject: ${openMessage.subject}\n\n${openMessage.body ?? openMessage.snippet}`
            : action === 'edit'
              ? `Rewrite this draft. Keep the voice; improve clarity and structure.\nSubject: ${composeSubject}\n\n${composeBody}`
              : '';
        const goal =
          `Draft a concise, natural email for sending via Gmail. Output a JSON object with fields "subject" and "body" only. ` +
          `Angle: ${aiPrompt || '(use the context)'}\n\nContext:\n${context || '(none)'}`;
        const wf = await workflowApi.create(goal, undefined, ['cmo']);

        // Poll
        const deadline = Date.now() + 90_000;
        let finalOut = '';
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2_000));
          const updated = await workflowApi.get(wf.id);
          if (updated.status === 'COMPLETED' && typeof updated.finalOutput === 'string') {
            finalOut = updated.finalOutput;
            break;
          }
          if (updated.status === 'FAILED') throw new Error('AI draft failed');
        }
        if (!finalOut) throw new Error('Timed out');

        // Try to parse JSON subject/body; fall back to treating the whole
        // thing as body.
        let subject = composeSubject;
        let body = finalOut;
        try {
          const m = finalOut.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]) as { subject?: string; body?: string };
            if (parsed.subject) subject = parsed.subject;
            if (parsed.body) body = parsed.body;
          }
        } catch {
          // leave raw body
        }
        if (subject) setComposeSubject(subject);
        if (body) setComposeBody(body);
        toast.success('Draft ready', 'Review and edit before sending.');
      } catch (e) {
        toast.error('AI draft failed', e instanceof Error ? e.message : 'Please try again.');
      } finally {
        setAiBusy(null);
      }
    },
    [aiPrompt, openMessage, composeSubject, composeBody, toast],
  );

  const handleSend = useCallback(async () => {
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) {
      toast.warning('Missing fields', 'Fill in To, Subject, and Body before sending.');
      return;
    }
    setSending(true);
    try {
      // Send via a workflow that routes through the Gmail adapter. Keeps
      // audit + approval gates consistent with every other user-initiated
      // outbound action.
      const replyId = openMessage?.id;
      const goal =
        `Send this email via the connected Gmail integration. Do not alter the content.` +
        (replyId ? ` Thread as a reply to message id "${replyId}".` : '') +
        `\n\nTo: ${composeTo}\nSubject: ${composeSubject}\n\n${composeBody}`;
      await workflowApi.create(goal, undefined, ['automation']);
      toast.success('Send queued', 'Track the run in the Swarm Inspector. Required approvals will surface there.');
      setView('inbox');
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      setAiPrompt('');
    } catch (e) {
      toast.error('Send failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }, [composeTo, composeSubject, composeBody, openMessage, toast]);

  // ─── Gate: not connected ────────────────────────────────────────────────

  if (!isConfigured) {
    return (
      <div className="flex-1 overflow-auto p-6" data-testid="inbox-gate">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold flex items-center gap-2 mb-4">
            <Mail className="h-6 w-6 text-primary" />
            Inbox
          </h1>
          <Card>
            <CardContent className="p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Plug className="h-6 w-6 text-primary" />
              </div>
              <h2 className="mt-4 text-base font-semibold">Connect Gmail to use Inbox</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Inbox reads and writes live email through your connected Gmail account.
                All send actions run through the workflow engine with audit + approval where required.
              </p>
              <Button className="mt-6" onClick={() => (window.location.href = '/integrations')}>
                Open Integrations
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ─── View: inbox list ──────────────────────────────────────────────────

  if (view === 'inbox') {
    return (
      <div className="flex-1 overflow-auto p-4 sm:p-6" data-testid="inbox-list">
        <div className="max-w-4xl mx-auto space-y-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Mail className="h-6 w-6 text-primary" />
                Inbox
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Connected as <span className="font-medium">{gmail?.displayName ?? 'Gmail'}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {DAY_WINDOWS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={
                      'px-2.5 py-1 text-xs rounded-md border transition-colors ' +
                      (days === d
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-transparent text-muted-foreground border-border hover:bg-muted')
                    }
                    data-testid={`inbox-day-${d}`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => void mutate()} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
              <Button onClick={startCompose} className="gap-1.5" data-testid="inbox-compose-btn">
                <PenSquare className="h-3.5 w-3.5" /> Compose
              </Button>
            </div>
          </header>

          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <EmptyState
              icon={<Mail className="h-8 w-8" />}
              title={`No messages in the last ${days} day${days > 1 ? 's' : ''}`}
              description="Try a wider window or compose a new email."
              action={<Button onClick={startCompose}>Compose</Button>}
            />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {messages.map((msg) => (
                <li key={msg.id}>
                  <button
                    type="button"
                    onClick={() => void openRead(msg)}
                    className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                    data-testid={`inbox-row-${msg.id}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{msg.from}</p>
                        <p className="text-xs text-foreground truncate mt-0.5">{msg.subject}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.snippet}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(msg.receivedAt).toLocaleString()}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ─── View: read ────────────────────────────────────────────────────────

  if (view === 'read' && openMessage) {
    return (
      <div className="flex-1 overflow-auto p-4 sm:p-6" data-testid="inbox-read">
        <div className="max-w-3xl mx-auto space-y-4">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setView('inbox')}>
            <ArrowLeft className="h-4 w-4" /> Back to inbox
          </Button>
          <Card>
            <CardContent className="p-6 space-y-3">
              <h1 className="text-lg font-semibold">{openMessage.subject}</h1>
              <p className="text-xs text-muted-foreground">
                From <span className="text-foreground">{openMessage.from}</span> ·
                <span className="ml-1">{new Date(openMessage.receivedAt).toLocaleString()}</span>
              </p>
              <pre className="text-sm whitespace-pre-wrap break-words font-sans text-foreground leading-relaxed pt-2">
                {openMessage.body ?? openMessage.snippet}
              </pre>
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button onClick={startReply} className="gap-1.5" data-testid="inbox-reply-btn">
              <PenSquare className="h-3.5 w-3.5" /> Reply
            </Button>
            <Button variant="outline" onClick={() => setView('inbox')}>Dismiss</Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── View: compose ─────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6" data-testid="inbox-compose">
      <div className="max-w-3xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setView(openMessage ? 'read' : 'inbox')}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Card>
          <CardContent className="p-6 space-y-4">
            <h1 className="text-lg font-semibold">{openMessage ? 'Reply' : 'Compose email'}</h1>
            <div>
              <label className="text-xs font-medium mb-1.5 block">To</label>
              <Input
                type="email"
                placeholder="recipient@example.com"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                data-testid="inbox-compose-to"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Subject</label>
              <Input
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                data-testid="inbox-compose-subject"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Body</label>
              <Textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                className="min-h-[200px] text-sm"
                data-testid="inbox-compose-body"
              />
            </div>

            {/* AI Assist panel */}
            <details className="rounded-lg border border-border bg-muted/20 px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> AI Assist
              </summary>
              <div className="mt-3 space-y-2">
                <Textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder='Describe what you want to write — e.g. "friendly reply confirming the meeting tomorrow at 3pm"'
                  className="min-h-[60px] text-sm"
                  data-testid="inbox-ai-prompt"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => void runAi('compose')}
                    disabled={aiBusy !== null}
                    data-testid="inbox-ai-compose"
                  >
                    {aiBusy === 'compose' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Compose
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => void runAi('reply')}
                    disabled={aiBusy !== null || !openMessage}
                    data-testid="inbox-ai-reply"
                  >
                    {aiBusy === 'reply' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Reply
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => void runAi('edit')}
                    disabled={aiBusy !== null || !composeBody.trim()}
                    data-testid="inbox-ai-edit"
                  >
                    {aiBusy === 'edit' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Edit draft
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  AI assist runs through the workflow engine — audit + approval gates still apply.
                </p>
              </div>
            </details>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setView('inbox')}>Cancel</Button>
              <Button onClick={handleSend} disabled={sending} className="gap-1.5" data-testid="inbox-send">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
