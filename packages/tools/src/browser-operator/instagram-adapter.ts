/**
 * Instagram browser adapter — Sprint 4 of full-fledged JAK.
 *
 * Same shape as LinkedIn (Sprint 1):
 *   - URL allowlist scoped to instagram.com
 *   - DOM-based logged-in / 2FA / captcha detection
 *   - Caption + hashtag draft generation (2200-char limit)
 *   - Asset checklist (Instagram requires media for feed posts)
 *   - Approval-gated publish that ALWAYS returns
 *     `manualHandoffRequired: true` — JAK never auto-posts
 *
 * Hard rules: same as LinkedIn — no auto-post, no 2FA bypass, no
 * captcha bypass, no DM scraping, no follower-data extraction.
 */

import type { Page } from 'playwright';
import type {
  PlatformAdapter,
  PlatformDraft,
  PlatformLoginState,
  PlatformPublishResult,
} from './platform-adapter.js';

const INSTAGRAM_HOSTS = ['instagram.com', 'www.instagram.com'];
const INSTAGRAM_CAPTION_LIMIT = 2200;
const INSTAGRAM_HASHTAG_LIMIT = 30;

const SIGNALS = {
  loggedIn: ['nav[aria-label="Primary navigation"]', 'a[href="/direct/inbox/"]', 'svg[aria-label="Home"]'],
  loggedOut: ['form[id="loginForm"]', 'input[name="username"][placeholder*="number, username, or email" i]'],
  twoFactor: ['input[name="verificationCode"]', 'form[action*="two_factor"]'],
  captcha: ['iframe[src*="recaptcha"]', '[id*="captcha"]'],
};

const HASHTAG_GROUPS: Record<string, string[]> = {
  food: ['#foodie', '#foodphotography', '#instafood'],
  travel: ['#travel', '#wanderlust', '#travelgram'],
  fitness: ['#fitness', '#workout', '#fitlife'],
  fashion: ['#fashion', '#style', '#ootd'],
  business: ['#smallbusiness', '#entrepreneur', '#businessowner'],
  art: ['#art', '#artist', '#illustration'],
  default: ['#instagood'],
};

function suggestHashtags(topic: string): string[] {
  const lower = topic.toLowerCase();
  const out = new Set<string>();
  for (const [key, tags] of Object.entries(HASHTAG_GROUPS)) {
    if (key === 'default') continue;
    if (lower.includes(key)) tags.forEach((t) => out.add(t));
  }
  if (out.size === 0) HASHTAG_GROUPS['default']!.forEach((t) => out.add(t));
  return [...out].slice(0, Math.min(INSTAGRAM_HASHTAG_LIMIT, 8));
}

export class InstagramBrowserAdapter implements PlatformAdapter {
  readonly id = 'INSTAGRAM' as const;
  readonly displayName = 'Instagram';
  readonly defaultUrl = 'https://www.instagram.com/';

  isUrlAllowed(url: string): boolean {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return false;
      const host = u.hostname.toLowerCase();
      return INSTAGRAM_HOSTS.some((h) => host === h || host.endsWith('.' + h));
    } catch {
      return false;
    }
  }

  async detectLoginState(page: Page): Promise<PlatformLoginState> {
    const url = page.url();
    for (const sel of SIGNALS.captcha) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: true,
          status: 'Captcha challenge detected on Instagram — please complete it in the browser. JAK will pause.',
        };
      }
    }
    for (const sel of SIGNALS.twoFactor) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: true,
          status: 'Instagram is asking for a 2FA code — enter it in the browser. JAK does not see or store the code.',
        };
      }
    }
    for (const sel of SIGNALS.loggedIn) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: true,
          challengeDetected: false,
          status: 'Logged in to Instagram. Ready to review profile / draft a caption.',
        };
      }
    }
    for (const sel of SIGNALS.loggedOut) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: false,
          status: 'Not logged in to Instagram — please sign in on the page. JAK never sees your password.',
        };
      }
    }
    return {
      loggedIn: false,
      challengeDetected: false,
      status: `Instagram login state could not be confirmed at ${url}.`,
    };
  }

  buildDraft(input: { topic: string; tone?: 'professional' | 'casual' | 'enthusiastic' }): PlatformDraft {
    const tone = input.tone ?? 'enthusiastic';
    const opener =
      tone === 'professional'
        ? `Sharing a perspective on ${input.topic}.`
        : tone === 'casual'
          ? `${input.topic} — here's the take.`
          : `Loving ${input.topic}! 🎉`;
    const body = [opener, '', '(Add 2–3 sentences about your experience.)', '', '⬇️ Tell me your favorite in the comments.'].join('\n');
    const truncated = body.length > INSTAGRAM_CAPTION_LIMIT;
    const finalBody = truncated ? body.slice(0, INSTAGRAM_CAPTION_LIMIT - 1) + '…' : body;
    return {
      kind: 'caption',
      body: finalBody,
      charLimit: INSTAGRAM_CAPTION_LIMIT,
      truncated,
      checklist: [
        { item: 'Attach a high-resolution photo or carousel (Instagram requires media)', done: false },
        { item: 'Add up to 30 hashtags (consider posting them in the first comment for cleaner caption)', done: false },
        { item: 'Tag relevant accounts (@mention)', done: false },
        { item: 'Add a location pin if relevant', done: false },
      ],
      hashtags: suggestHashtags(input.topic),
    };
  }

  async recordApprovedPublish(input: {
    draft: PlatformDraft;
    approvalId: string;
  }): Promise<PlatformPublishResult> {
    if (!input.approvalId) {
      throw new Error('Instagram recordApprovedPublish called without approvalId — refusing.');
    }
    return {
      published: false,
      manualHandoffRequired: true,
      manualHandoffMessage:
        'Caption + checklist are approved. JAK does NOT auto-publish to Instagram. ' +
        'Open the Instagram app or web composer, attach your media, paste the caption, and post yourself. ' +
        'Approval is in the audit log.',
      approvalId: input.approvalId,
    };
  }
}

export const instagramAdapter = new InstagramBrowserAdapter();
