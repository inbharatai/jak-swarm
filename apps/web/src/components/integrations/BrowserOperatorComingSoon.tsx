'use client';

/**
 * Browser-operator section on /integrations.
 *
 * Now backed by a REAL Playwright runtime
 * (`PlaywrightBrowserOperator` in `packages/tools/src/browser-operator/`).
 * The UI exposes the GENERIC platform — user picks any URL, JAK opens
 * a real browser session, captures observations, and gates external
 * actions through the approval policy.
 *
 * Per-platform adapters (LinkedIn / Instagram / YouTube Studio /
 * Meta Business Suite) are browser-assisted adapters: they can open
 * the right surface, observe the page, and prepare drafts. They do not
 * auto-publish or bypass login / 2FA.
 *
 * Honest framing kept: the GENERIC card is "Functional — try it now";
 * platform-specific cards explicitly say what's not live yet.
 */

import React, { useState } from 'react';
import { Card, CardContent, Button } from '@/components/ui';
import { Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { browserSessionsApi } from '@/lib/api-client';

interface BrowserPlatform {
  /** Identifier for the backend `BrowserPlatform` enum. */
  id: 'GENERIC' | 'INSTAGRAM' | 'LINKEDIN' | 'YOUTUBE_STUDIO' | 'META_BUSINESS_SUITE';
  name: string;
  emoji: string;
  description: string;
  agents: string[];
  /** True when the runtime supports this platform NOW (vs. coming soon). */
  functional: boolean;
  /** Default URL the session opens to when functional. */
  defaultUrl?: string;
}

const BROWSER_PLATFORMS: BrowserPlatform[] = [
  {
    id: 'GENERIC',
    name: 'Generic browser session',
    emoji: '\u{1F310}',
    description:
      'Pick any URL. JAK opens a real browser, captures screenshots, and gates external actions through your approval.',
    agents: ['Web Review Agent'],
    functional: true,
    defaultUrl: 'https://www.example.com/',
  },
  {
    id: 'INSTAGRAM',
    name: 'Instagram',
    emoji: '\u{1F4F8}',
    description:
      'Active for browser-assisted review and caption draft prep. Publishing is manual handoff — JAK never auto-posts. Login / 2FA must be completed by you.',
    agents: ['CMO Agent'],
    functional: true,
    defaultUrl: 'https://www.instagram.com/',
  },
  {
    id: 'LINKEDIN',
    name: 'LinkedIn',
    emoji: '\u{1F4BC}',
    description:
      'Active for browser-assisted review and draft preparation. Publishing requires your approval AND a manual click — JAK never auto-posts. Login / 2FA must be completed by you.',
    agents: ['CMO Agent'],
    functional: true,
    defaultUrl: 'https://www.linkedin.com/feed/',
  },
  {
    id: 'YOUTUBE_STUDIO',
    name: 'YouTube Studio',
    emoji: '\u{1F4FA}',
    description:
      'Active for browser-assisted channel review + title/description/tag drafts. Uploading videos is always manual — JAK never auto-uploads.',
    agents: ['CMO Agent'],
    functional: true,
    defaultUrl: 'https://studio.youtube.com/',
  },
  {
    id: 'META_BUSINESS_SUITE',
    name: 'Meta Business Suite',
    emoji: '\u{1F308}',
    description:
      'Active for browser-assisted page review + post-draft prep. Publishing + ad-spend changes are manual handoff — JAK never auto-publishes.',
    agents: ['CMO Agent'],
    functional: true,
    defaultUrl: 'https://business.facebook.com/',
  },
];

export function BrowserOperatorComingSoon() {
  const toast = useToast();
  const [startingId, setStartingId] = useState<string | null>(null);

  async function handleStart(platform: BrowserPlatform): Promise<void> {
    if (!platform.functional || !platform.defaultUrl) return;
    setStartingId(platform.id);
    try {
      const result = await browserSessionsApi.start({
        platform: platform.id,
        initialUrl: platform.defaultUrl,
      });
      const data = (result as { data?: { sessionId?: string } } | undefined)?.data;
      const sessionId = data?.sessionId;
      if (sessionId) {
        toast.success(
          'Browser session started',
          `Session ${sessionId.slice(0, 12)}… running. Approval required for any external action.`,
        );
      } else {
        toast.success('Browser session started', 'Session running.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start session.';
      toast.error('Could not start browser session', msg);
    } finally {
      setStartingId(null);
    }
  }

  return (
    <section data-testid="browser-operator-section">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Browser-operator platforms</h2>
        <span
          className="rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
          data-testid="browser-operator-status-badge"
        >
          Assisted adapters live
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        For platforms that don't expose a safe API, JAK can open a real browser session,
        capture observations, and ask your approval before any external action. The
        <strong> generic browser session</strong> is functional today — pick any URL and
        JAK will open it, screenshot it, and gate clicks/fills/navigations behind
        approvals. LinkedIn / Instagram / YouTube Studio / Meta Business Suite are
        browser-assisted draft and review flows, not autonomous publishing flows:
        login, 2FA, and the final publish/upload click remain with you. <strong>JAK never
        stores your password or auto-posts to these platforms.</strong>
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {BROWSER_PLATFORMS.map((platform) => {
          const isFunctional = platform.functional;
          const isStarting = startingId === platform.id;
          return (
            <Card
              key={platform.id}
              className={`relative overflow-hidden ${isFunctional ? '' : 'opacity-80'}`}
              data-testid={`browser-platform-${platform.id.toLowerCase().replace(/_/g, '-')}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>
                    {platform.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">{platform.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {platform.description}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {platform.agents.map((agent) => (
                        <span
                          key={agent}
                          className="inline-flex rounded-full bg-primary/5 border border-primary/20 px-2 py-0.5 text-[10px] text-primary"
                        >
                          {agent}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                {isFunctional ? (
                  <Button
                    size="sm"
                    className="mt-3 w-full gap-1.5"
                    onClick={() => handleStart(platform)}
                    disabled={isStarting}
                    data-testid={`browser-start-${platform.id.toLowerCase()}`}
                  >
                    {isStarting ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Starting…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3" />
                        Start browser session
                      </>
                    )}
                  </Button>
                ) : (
                  <div
                    className="mt-3 flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-400"
                    data-testid={`browser-coming-soon-${platform.id.toLowerCase()}`}
                  >
                    <Sparkles className="h-3 w-3" aria-hidden />
                    <span>Coming soon — needs platform adapter</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
