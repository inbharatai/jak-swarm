'use client';

/**
 * Social drafts page — Sprint 6 Part D.
 *
 * Calls POST /social-drafts which dispatches to the LinkedIn /
 * Instagram / YouTube Studio / Meta Business Suite adapter's
 * `buildDraft()`. NEVER publishes — every response carries
 * `manualHandoffRequired: true`.
 *
 * Layman-first: pick platform, type a topic, get a draft with
 * checklist + hashtag suggestions + manual-publish disclaimer.
 */

import React, { useEffect, useState } from 'react';
import { Megaphone, Sparkles, Loader2, Copy, ExternalLink } from 'lucide-react';
import { Button, Card, CardContent, Input, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { socialDraftsApi } from '@/lib/api-client';

type Platform = 'LINKEDIN' | 'INSTAGRAM' | 'YOUTUBE_STUDIO' | 'META_BUSINESS_SUITE';

const PLATFORMS: Array<{ id: Platform; label: string; emoji: string; href: string }> = [
  { id: 'LINKEDIN', label: 'LinkedIn', emoji: '\u{1F4BC}', href: 'https://www.linkedin.com/feed/' },
  { id: 'INSTAGRAM', label: 'Instagram', emoji: '\u{1F4F8}', href: 'https://www.instagram.com/' },
  { id: 'YOUTUBE_STUDIO', label: 'YouTube Studio', emoji: '\u{1F4FA}', href: 'https://studio.youtube.com/' },
  { id: 'META_BUSINESS_SUITE', label: 'Meta Business Suite', emoji: '\u{1F308}', href: 'https://business.facebook.com/' },
];

interface DraftResponse {
  data?: {
    adapter: string;
    displayName: string;
    draft: {
      kind: string;
      body: string;
      charLimit: number;
      truncated: boolean;
      hashtags?: string[];
      checklist?: Array<{ item: string; done: boolean }>;
    };
    manualHandoffRequired: boolean;
    manualHandoffMessage: string;
  };
}

export default function SocialDraftsPage() {
  const toast = useToast();
  const [platform, setPlatform] = useState<Platform>('LINKEDIN');
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState<'professional' | 'casual' | 'enthusiastic'>('professional');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DraftResponse['data'] | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  async function handleGenerate(): Promise<void> {
    if (!isHydrated || !topic.trim()) return;
    setLoading(true);
    try {
      const res = (await socialDraftsApi.generate({ platform, topic, tone })) as DraftResponse;
      setResult(res?.data ?? null);
    } catch (err) {
      toast.error('Could not generate draft', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string): void {
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Copied'),
      () => toast.error('Could not copy'),
    );
  }

  const platformMeta = PLATFORMS.find((p) => p.id === platform)!;

  return (
    <div className="flex flex-col gap-6 p-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Social drafts
          </h2>
          <p className="text-xs text-muted-foreground">
            Generate platform-tuned drafts with checklist + hashtag suggestions.{' '}
            <strong>JAK never auto-publishes</strong> — copy the draft into the platform&rsquo;s composer to publish.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4" aria-busy={loading}>
          <div>
            <label className="text-xs font-medium">Platform</label>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  disabled={!isHydrated || loading}
                  data-testid={`social-draft-platform-${p.id.toLowerCase()}`}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    platform === p.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  <span className="mr-1.5">{p.emoji}</span>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium">Topic</label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. our new product launch, AI agents at scale, hiring engineers"
              disabled={!isHydrated || loading}
              data-testid="social-draft-topic-input"
            />
          </div>

          <div>
            <label className="text-xs font-medium">Tone</label>
            <div className="mt-2 flex gap-2">
              {(['professional', 'casual', 'enthusiastic'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTone(t)}
                  disabled={!isHydrated || loading}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    tone === t ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={!isHydrated || !topic.trim() || loading}
            className="gap-1.5"
            data-testid="social-draft-generate-btn"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loading ? 'Generating draft...' : 'Generate draft'}
          </Button>

          {loading && (
            <p
              role="status"
              aria-live="polite"
              className="text-xs text-muted-foreground"
              data-testid="social-draft-loading-state"
            >
              Loading platform rules and preparing a manual-publish draft.
            </p>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card data-testid="social-draft-result-card">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{platformMeta.emoji}</span>
              <div>
                <h3 className="text-sm font-semibold">{result.displayName} draft ({result.draft.kind})</h3>
                <p className="text-[10px] text-muted-foreground">
                  {result.draft.body.length} / {result.draft.charLimit} chars
                  {result.draft.truncated && ' (truncated)'}
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium">Draft body</label>
              <Textarea
                value={result.draft.body}
                onChange={() => {}}
                rows={8}
                className="font-mono text-xs"
                readOnly
                data-testid="social-draft-body"
              />
              <Button size="sm" variant="ghost" className="mt-1.5 gap-1" onClick={() => copy(result.draft.body)}>
                <Copy className="h-3 w-3" />
                Copy
              </Button>
            </div>

            {result.draft.hashtags && result.draft.hashtags.length > 0 && (
              <div>
                <label className="text-xs font-medium">Hashtag suggestions</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {result.draft.hashtags.map((tag) => (
                    <span key={tag} className="rounded-full bg-primary/5 border border-primary/20 px-2 py-0.5 text-[11px] font-mono">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.draft.checklist && result.draft.checklist.length > 0 && (
              <div>
                <label className="text-xs font-medium">Author checklist</label>
                <ul className="mt-1 space-y-1 text-xs">
                  {result.draft.checklist.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <input type="checkbox" defaultChecked={c.done} className="mt-0.5" />
                      <span>{c.item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400" data-testid="social-draft-handoff">
              <strong>Manual publish required:</strong> {result.manualHandoffMessage}
              <a
                href={platformMeta.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 hover:underline"
              >
                Open {platformMeta.label} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
