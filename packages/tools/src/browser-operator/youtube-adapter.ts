/**
 * YouTube Studio browser adapter — Sprint 4.
 *
 * Read-only review + title/description/tag draft preparation. Upload
 * is ALWAYS manual handoff — JAK does not upload videos.
 */

import type { Page } from 'playwright';
import type {
  PlatformAdapter,
  PlatformDraft,
  PlatformLoginState,
  PlatformPublishResult,
} from './platform-adapter.js';

const YT_HOSTS = ['youtube.com', 'studio.youtube.com', 'www.youtube.com'];
const YT_TITLE_LIMIT = 100;
const YT_DESCRIPTION_LIMIT = 5000;
const YT_TAGS_LIMIT = 500; // total chars across all tags

const SIGNALS = {
  loggedIn: ['ytcp-app', '[id="primary-button"]', 'tp-yt-paper-icon-button[aria-label*="Account" i]'],
  loggedOut: ['form[id="gaia_loginform"]', 'input[type="email"][autocomplete="username"]'],
  twoFactor: ['input[type="tel"][autocomplete="one-time-code"]', '[data-form-action-uri*="signin/v2/challenge"]'],
  captcha: ['iframe[src*="recaptcha"]', '[id*="captcha"]'],
};

export class YouTubeStudioBrowserAdapter implements PlatformAdapter {
  readonly id = 'YOUTUBE_STUDIO' as const;
  readonly displayName = 'YouTube Studio';
  readonly defaultUrl = 'https://studio.youtube.com/';

  isUrlAllowed(url: string): boolean {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return false;
      const host = u.hostname.toLowerCase();
      return YT_HOSTS.some((h) => host === h || host.endsWith('.' + h));
    } catch {
      return false;
    }
  }

  async detectLoginState(page: Page): Promise<PlatformLoginState> {
    for (const sel of SIGNALS.captcha) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: true,
          status: 'Captcha detected on YouTube — complete it in the browser. JAK will pause.',
        };
      }
    }
    for (const sel of SIGNALS.twoFactor) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: true,
          status: 'YouTube is asking for a 2FA code — enter it in the browser.',
        };
      }
    }
    for (const sel of SIGNALS.loggedIn) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: true,
          challengeDetected: false,
          status: 'Logged in to YouTube Studio. Ready to review channel / draft titles.',
        };
      }
    }
    for (const sel of SIGNALS.loggedOut) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: false,
          status: 'Not logged in to YouTube — please sign in. JAK never sees your password.',
        };
      }
    }
    return {
      loggedIn: false,
      challengeDetected: false,
      status: 'YouTube login state could not be confirmed.',
    };
  }

  buildDraft(input: { topic: string; tone?: 'professional' | 'casual' | 'enthusiastic' }): PlatformDraft {
    const tone = input.tone ?? 'enthusiastic';
    const titlePrefix = tone === 'enthusiastic' ? 'Watch:' : tone === 'casual' ? 'Quick:' : 'Tutorial:';
    const title = `${titlePrefix} ${input.topic}`.slice(0, YT_TITLE_LIMIT);
    const description = [
      `In this video we cover ${input.topic}.`,
      '',
      'Chapters:',
      '0:00 Intro',
      '0:30 (Topic 1)',
      '2:00 (Topic 2)',
      '4:00 Wrap-up',
      '',
      'Subscribe + ring the bell for more.',
      '',
      'Tags: ' + input.topic,
    ].join('\n');
    const finalDescription =
      description.length > YT_DESCRIPTION_LIMIT
        ? description.slice(0, YT_DESCRIPTION_LIMIT - 1) + '…'
        : description;
    const tags = input.topic.split(/[\s,]+/).filter((t) => t.length > 1).slice(0, 10);
    return {
      kind: 'video',
      body: `Title: ${title}\n\n${finalDescription}`,
      charLimit: YT_TITLE_LIMIT + YT_DESCRIPTION_LIMIT,
      truncated: false,
      checklist: [
        { item: `Replace placeholder chapters with real timestamps from your video`, done: false },
        { item: `Choose a custom thumbnail (3 options recommended)`, done: false },
        { item: `Pick a category (Education, Tech, Howto, etc.)`, done: false },
        { item: `Set audience: "Made for kids" Y/N (legal requirement)`, done: false },
        { item: `Schedule or publish from YouTube Studio`, done: false },
      ],
      hashtags: tags.map((t) => `#${t}`),
    };
  }

  async recordApprovedPublish(input: {
    draft: PlatformDraft;
    approvalId: string;
  }): Promise<PlatformPublishResult> {
    if (!input.approvalId) {
      throw new Error('YouTube recordApprovedPublish called without approvalId — refusing.');
    }
    return {
      published: false,
      manualHandoffRequired: true,
      manualHandoffMessage:
        'Title + description + tag draft are approved. JAK does NOT upload videos. ' +
        'Open YouTube Studio, upload your video file, paste the title/description/tags from the draft, and publish. ' +
        'Approval is in the audit log.',
      approvalId: input.approvalId,
    };
  }
}

export const youtubeAdapter = new YouTubeStudioBrowserAdapter();

// Tag-allocation helper exposed for tests.
export const _internals = { YT_TAGS_LIMIT };
