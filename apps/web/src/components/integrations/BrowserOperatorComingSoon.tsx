'use client';

/**
 * Browser-operator "Coming soon" cards.
 *
 * Brief mandate: surface Instagram / LinkedIn / YouTube Studio / Meta
 * Business Suite as connectable platforms — but be HONEST about what
 * works today. The browser-operator runtime (secure user-logged-in
 * browser session, captcha/2FA handling, full audit trail) is
 * multi-week engineering. Until it ships, these cards say "Coming
 * soon" — not faked, not pretending to work.
 *
 * When the runtime lands, the same card shells get wired to the real
 * `BrowserOperatorService` — no rewrite needed.
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui';
import { Sparkles } from 'lucide-react';

interface BrowserPlatform {
  name: string;
  emoji: string;
  description: string;
  agents: string[];
}

const BROWSER_PLATFORMS: BrowserPlatform[] = [
  {
    name: 'Instagram',
    emoji: '\u{1F4F8}',
    description: 'Review your profile, posts, and engagement. Draft growth plans.',
    agents: ['CMO Agent'],
  },
  {
    name: 'LinkedIn',
    emoji: '\u{1F4BC}',
    description: 'Review profile, draft posts, and prepare a content calendar.',
    agents: ['CMO Agent'],
  },
  {
    name: 'YouTube Studio',
    emoji: '\u{1F4FA}',
    description: 'Review channel performance, top videos, and content gaps.',
    agents: ['CMO Agent'],
  },
  {
    name: 'Meta Business Suite',
    emoji: '\u{1F308}',
    description: 'Cross-platform Meta page review and ad-account health check.',
    agents: ['CMO Agent'],
  },
];

export function BrowserOperatorComingSoon() {
  return (
    <section data-testid="browser-operator-section">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Browser-operator platforms</h2>
        <span className="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
          Coming soon
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        For platforms that don't expose a safe API for what we need, JAK is building a
        secure browser-operator mode — you log in normally on the platform's site, JAK
        watches the page, drafts changes, and asks for your approval before anything is
        published. <strong>This is not live yet.</strong> No fake activity is run.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {BROWSER_PLATFORMS.map((platform) => (
          <Card
            key={platform.name}
            className="relative overflow-hidden opacity-80"
            data-testid={`browser-platform-${platform.name.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden>{platform.emoji}</span>
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
              <div className="mt-3 flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                <Sparkles className="h-3 w-3" aria-hidden />
                <span>Coming soon — needs browser-operator mode</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
