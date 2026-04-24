'use client';

/**
 * Social Hub — per-network agent cards with draft-and-review.
 *
 * Pattern borrowed from okara.ai: the page is NOT a single cross-poster.
 * Each network gets its own specialist agent card because the audience,
 * length limits, tone, and mechanics of each platform are different:
 *   - LinkedIn    → long-form professional posts
 *   - X / Twitter → short posts + threads
 *   - Reddit      → find relevant threads first, then draft a reply
 *   - Hacker News → identify the right moment to share, then draft
 *
 * Flow for every card: user types an angle → JAK drafts content (via the
 * standard workflow API, role=CMO + network hint) → user reviews the
 * draft and either publishes (if the integration is connected) or copies
 * the text for manual posting. Nothing auto-publishes.
 *
 * This page is mobile-first — the card grid collapses to a single column
 * on narrow viewports, inputs are full-width, and primary actions are
 * thumb-reachable at the bottom of each card.
 */

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import {
  Megaphone,
  Linkedin,
  Twitter,
  MessageCircle,
  Loader2,
  Copy,
  Send,
  Sparkles,
  Check,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui';
import { Textarea } from '@/components/ui';
import { Button } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dataFetcher, workflowApi } from '@/lib/api-client';
import type { Integration, IntegrationProvider } from '@/types';

// ─── Network definitions ────────────────────────────────────────────────────

type NetworkId = 'linkedin' | 'x' | 'reddit' | 'hn';
interface NetworkCardDef {
  id: NetworkId;
  label: string;
  tagline: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;                 // Tailwind bg/text tint pair for the header strip
  charLimit: number;            // Platform-enforced soft cap (0 = none)
  prompt: string;               // Instructional placeholder
  /** Which agent role drives the workflow for this card. */
  agentRole: string;
  /** Which Integration.provider must be CONNECTED for the Publish button. */
  requiredProvider?: IntegrationProvider;
  /** Prompt prefix the workflow sees — primes the worker to produce the right length/tone. */
  workflowGoalPrefix: string;
}

const NETWORKS: NetworkCardDef[] = [
  {
    id: 'linkedin',
    label: 'LinkedIn',
    tagline: 'Long-form professional posts — up to 3,000 chars',
    icon: Linkedin,
    tint: 'bg-[#0A66C2]/10 text-[#0A66C2]',
    charLimit: 3000,
    prompt: 'What angle should the post take? e.g. "our Q3 launch narrative, thought-leader tone"',
    agentRole: 'cmo',
    requiredProvider: 'LINKEDIN',
    workflowGoalPrefix:
      'Draft a LinkedIn post (300-800 words, professional tone, first-person founder voice, 2-3 hashtags). ' +
      'Topic/angle: ',
  },
  {
    id: 'x',
    label: 'X / Twitter',
    tagline: 'Short posts or threads — 280 chars per tweet',
    icon: Twitter,
    tint: 'bg-foreground/5 text-foreground',
    charLimit: 2800, // 10-tweet thread max
    prompt: 'What should the tweet or thread be about?',
    agentRole: 'cmo',
    workflowGoalPrefix:
      'Draft an X/Twitter thread (3-7 tweets, each under 280 chars, punchy hook on tweet 1, ' +
      'no more than one emoji per tweet). Topic: ',
  },
  {
    id: 'reddit',
    label: 'Reddit',
    tagline: 'Find the right subreddit thread, then draft a reply',
    icon: MessageCircle,
    tint: 'bg-[#FF4500]/10 text-[#FF4500]',
    charLimit: 10000,
    prompt: 'What are you responding to? Paste a subreddit link or describe the thread.',
    agentRole: 'research',
    workflowGoalPrefix:
      'Draft a Reddit reply that is helpful, not promotional, cites our experience without name-dropping ' +
      'the company more than once. Thread/context: ',
  },
  {
    id: 'hn',
    label: 'Hacker News',
    tagline: 'Identify the right moment to share + draft a comment',
    icon: MessageCircle,
    tint: 'bg-[#FF6600]/10 text-[#FF6600]',
    charLimit: 8000,
    prompt: 'Paste an HN URL or describe what you want to comment on.',
    agentRole: 'research',
    workflowGoalPrefix:
      'Draft a Hacker News comment that adds technical substance, avoids marketing speak, stays under 1500 chars, ' +
      'and ends with a concrete question or claim. Context: ',
  },
];

// ─── Per-card state ─────────────────────────────────────────────────────────

interface CardState {
  input: string;
  draft: string;
  status: 'idle' | 'generating' | 'ready' | 'publishing' | 'done' | 'error';
  error?: string;
  workflowId?: string;
}

function initialCardState(): CardState {
  return { input: '', draft: '', status: 'idle' };
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function SocialHubPage() {
  const toast = useToast();
  const { data: integrationsData } = useSWR<Integration[]>(
    '/integrations',
    dataFetcher,
    { refreshInterval: 60_000 },
  );
  const integrations = integrationsData ?? [];

  const [cards, setCards] = useState<Record<NetworkId, CardState>>({
    linkedin: initialCardState(),
    x: initialCardState(),
    reddit: initialCardState(),
    hn: initialCardState(),
  });

  const isProviderConnected = useCallback(
    (provider?: IntegrationProvider): boolean => {
      if (!provider) return false;
      return integrations.some(
        (i) => i.provider === provider && i.status === 'CONNECTED',
      );
    },
    [integrations],
  );

  const handleGenerate = useCallback(
    async (def: NetworkCardDef) => {
      const state = cards[def.id];
      if (!state.input.trim() || state.status === 'generating') return;

      setCards((prev) => ({
        ...prev,
        [def.id]: { ...prev[def.id], status: 'generating', error: undefined, draft: '' },
      }));

      try {
        const goal = `${def.workflowGoalPrefix}${state.input.trim()}`;
        const wf = await workflowApi.create(goal, undefined, [def.agentRole]);
        // Poll for completion — SSE would be nicer, matching existing pattern
        // in ChatWorkspace would require sharing the connectSSE helper. Short
        // polling is fine for a single-turn draft flow.
        const deadline = Date.now() + 180_000;
        let draft = '';
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2_500));
          const updated = await workflowApi.get(wf.id);
          if (updated.status === 'COMPLETED' && typeof updated.finalOutput === 'string') {
            draft = updated.finalOutput;
            break;
          }
          if (updated.status === 'FAILED') {
            throw new Error((updated.error as string | null) ?? 'Draft generation failed');
          }
        }
        if (!draft) throw new Error('Timed out waiting for draft');

        setCards((prev) => ({
          ...prev,
          [def.id]: {
            ...prev[def.id],
            draft,
            status: 'ready',
            workflowId: wf.id,
          },
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Draft generation failed';
        setCards((prev) => ({
          ...prev,
          [def.id]: { ...prev[def.id], status: 'error', error: msg },
        }));
        toast.error('Draft failed', msg);
      }
    },
    [cards, toast],
  );

  const handleCopy = useCallback(async (def: NetworkCardDef) => {
    const text = cards[def.id].draft;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard', `Paste into ${def.label} when ready.`);
    } catch {
      toast.error('Copy failed', 'Clipboard access was denied.');
    }
  }, [cards, toast]);

  const handlePublish = useCallback(
    async (def: NetworkCardDef) => {
      const state = cards[def.id];
      if (!state.draft || state.status === 'publishing') return;
      if (!def.requiredProvider) {
        toast.info('Publishing not yet wired for this network', 'Copy the draft and paste it on the platform.');
        return;
      }
      if (!isProviderConnected(def.requiredProvider)) {
        toast.warning(`Connect ${def.label} first`, 'Open Integrations to connect your account.');
        return;
      }

      setCards((prev) => ({
        ...prev,
        [def.id]: { ...prev[def.id], status: 'publishing' },
      }));
      try {
        // Kick off a second workflow that actually calls the connected
        // adapter's post(). Keeps the publishing path through the swarm's
        // approval + audit machinery rather than calling the adapter
        // directly from the web app.
        const goal =
          `Post the following ${def.label} content using the connected ${def.label} integration. ` +
          `Do not edit the content. Confirm the post ID on success.\n\n---\n${state.draft}\n---`;
        await workflowApi.create(goal, undefined, [def.agentRole]);
        setCards((prev) => ({
          ...prev,
          [def.id]: { ...prev[def.id], status: 'done' },
        }));
        toast.success(`${def.label} post queued`, 'Track the run in the Swarm Inspector.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Publish failed';
        setCards((prev) => ({
          ...prev,
          [def.id]: { ...prev[def.id], status: 'error', error: msg },
        }));
        toast.error('Publish failed', msg);
      }
    },
    [cards, isProviderConnected, toast],
  );

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6" data-testid="social-hub-page">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <header>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            Social hub
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Pick a network. Type an angle. Review the draft. Publish or copy.
            Each network gets a specialist agent that understands its rules of engagement.
          </p>
        </header>

        {/* Network cards — mobile = 1 column, tablet+ = 2 columns */}
        <div className="grid gap-4 sm:grid-cols-2">
          {NETWORKS.map((def) => {
            const state = cards[def.id];
            const connected = isProviderConnected(def.requiredProvider);
            const Icon = def.icon;
            return (
              <Card
                key={def.id}
                className="flex flex-col overflow-hidden"
                data-testid={`social-card-${def.id}`}
              >
                <CardContent className="p-5 flex flex-col gap-4 flex-1">
                  {/* Network header */}
                  <div className="flex items-start gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${def.tint}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-sm font-semibold">{def.label}</h2>
                      <p className="text-xs text-muted-foreground">{def.tagline}</p>
                    </div>
                    {def.requiredProvider && (
                      <span
                        className={
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                          (connected
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-muted text-muted-foreground')
                        }
                      >
                        <span
                          className={'h-1.5 w-1.5 rounded-full ' + (connected ? 'bg-emerald-500' : 'bg-muted-foreground/60')}
                        />
                        {connected ? 'Connected' : 'Not connected'}
                      </span>
                    )}
                  </div>

                  {/* Input */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Angle or topic</label>
                    <Textarea
                      className="mt-1 min-h-[80px] text-sm"
                      placeholder={def.prompt}
                      value={state.input}
                      onChange={(e) =>
                        setCards((prev) => ({
                          ...prev,
                          [def.id]: { ...prev[def.id], input: e.target.value },
                        }))
                      }
                      data-testid={`social-input-${def.id}`}
                    />
                  </div>

                  {/* Draft surface — only rendered after generation runs */}
                  {state.draft && (
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                          Draft ({state.draft.length} chars
                          {def.charLimit > 0 && ` / ${def.charLimit} limit`})
                        </span>
                        {def.charLimit > 0 && state.draft.length > def.charLimit && (
                          <span className="text-[10px] font-medium text-amber-600">Over limit</span>
                        )}
                      </div>
                      <Textarea
                        className="text-sm min-h-[120px] bg-transparent border-0 p-0 focus-visible:ring-0 resize-none"
                        value={state.draft}
                        onChange={(e) =>
                          setCards((prev) => ({
                            ...prev,
                            [def.id]: { ...prev[def.id], draft: e.target.value },
                          }))
                        }
                        data-testid={`social-draft-${def.id}`}
                      />
                    </div>
                  )}

                  {state.status === 'error' && state.error && (
                    <p className="text-xs text-destructive">{state.error}</p>
                  )}

                  {/* Actions */}
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button
                      onClick={() => handleGenerate(def)}
                      disabled={!state.input.trim() || state.status === 'generating'}
                      className="gap-1.5 flex-1 min-w-[140px]"
                      data-testid={`social-generate-${def.id}`}
                    >
                      {state.status === 'generating' ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Drafting…</>
                      ) : (
                        <><Sparkles className="h-3.5 w-3.5" /> {state.draft ? 'Regenerate' : 'Draft'}</>
                      )}
                    </Button>
                    {state.draft && (
                      <Button
                        variant="outline"
                        onClick={() => handleCopy(def)}
                        className="gap-1.5"
                        data-testid={`social-copy-${def.id}`}
                      >
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </Button>
                    )}
                    {state.draft && def.requiredProvider && (
                      <Button
                        variant={connected ? 'default' : 'outline'}
                        onClick={() => handlePublish(def)}
                        disabled={!connected || state.status === 'publishing' || state.status === 'done'}
                        className="gap-1.5"
                        data-testid={`social-publish-${def.id}`}
                      >
                        {state.status === 'publishing' ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Publishing…</>
                        ) : state.status === 'done' ? (
                          <><Check className="h-3.5 w-3.5" /> Queued</>
                        ) : (
                          <><Send className="h-3.5 w-3.5" /> Publish</>
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Footer hint — what to do if not-connected */}
        <p className="text-xs text-muted-foreground text-center pt-2">
          Not seeing a network you need? Open
          {' '}<a href="/integrations" className="text-primary hover:underline">Integrations</a>{' '}
          to connect your account first.
        </p>
      </div>
    </div>
  );
}
