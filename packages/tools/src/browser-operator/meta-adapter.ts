/**
 * Meta Business Suite browser adapter — Sprint 4.
 *
 * Read-only review of Facebook + Instagram pages + ad account health
 * checks. Drafts page posts. Publishing + ad-spend changes ALWAYS
 * require manual handoff.
 */

import type { Page } from 'playwright';
import type {
  PlatformAdapter,
  PlatformDraft,
  PlatformLoginState,
  PlatformPublishResult,
} from './platform-adapter.js';

const META_HOSTS = [
  'business.facebook.com',
  'facebook.com',
  'www.facebook.com',
  'business.meta.com',
];
const META_PAGE_POST_LIMIT = 63206; // FB page-post char limit

const SIGNALS = {
  loggedIn: ['[role="banner"][data-pagelet="MeIconHeader"]', 'a[aria-label="Profile"]', '[data-pagelet="LeftRail"]'],
  loggedOut: ['form[id="login_form"]', 'input[name="email"][id="email"]', 'input[name="pass"]'],
  twoFactor: ['input[name="approvals_code"]', '[data-testid="ScreenLayout"]'],
  captcha: ['iframe[src*="recaptcha"]', '[id*="captcha"]'],
};

export class MetaBusinessBrowserAdapter implements PlatformAdapter {
  readonly id = 'META_BUSINESS_SUITE' as const;
  readonly displayName = 'Meta Business Suite';
  readonly defaultUrl = 'https://business.facebook.com/';

  isUrlAllowed(url: string): boolean {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return false;
      const host = u.hostname.toLowerCase();
      return META_HOSTS.some((h) => host === h || host.endsWith('.' + h));
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
          status: 'Captcha detected on Meta — complete it in the browser. JAK will pause.',
        };
      }
    }
    for (const sel of SIGNALS.twoFactor) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: true,
          status: 'Meta is asking for a 2FA / approvals code — enter it in the browser.',
        };
      }
    }
    for (const sel of SIGNALS.loggedIn) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: true,
          challengeDetected: false,
          status: 'Logged in to Meta Business Suite. Ready to review pages / draft posts.',
        };
      }
    }
    for (const sel of SIGNALS.loggedOut) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: false,
          status: 'Not logged in to Meta — please sign in. JAK never sees your password.',
        };
      }
    }
    return {
      loggedIn: false,
      challengeDetected: false,
      status: 'Meta login state could not be confirmed.',
    };
  }

  buildDraft(input: { topic: string; tone?: 'professional' | 'casual' | 'enthusiastic' }): PlatformDraft {
    const tone = input.tone ?? 'professional';
    const opener =
      tone === 'enthusiastic'
        ? `🎉 Big news about ${input.topic}!`
        : tone === 'casual'
          ? `Quick update on ${input.topic}.`
          : `An update on ${input.topic}.`;
    const body = [
      opener,
      '',
      '(Replace this paragraph with the body of your update.)',
      '',
      'Want to learn more? Comment below or visit the link in our bio.',
    ].join('\n');
    const truncated = body.length > META_PAGE_POST_LIMIT;
    return {
      kind: 'page_post',
      body: truncated ? body.slice(0, META_PAGE_POST_LIMIT - 1) + '…' : body,
      charLimit: META_PAGE_POST_LIMIT,
      truncated,
      checklist: [
        { item: 'Pick which page (FB / Instagram) the post will go to', done: false },
        { item: 'Attach media (photo / video / carousel) if needed', done: false },
        { item: 'Choose audience targeting (public / followers / custom)', done: false },
        { item: 'Schedule or publish from Meta Business Suite', done: false },
        { item: 'Verify ad budget if boosting the post', done: false },
      ],
      hashtags: [],
    };
  }

  async recordApprovedPublish(input: {
    draft: PlatformDraft;
    approvalId: string;
  }): Promise<PlatformPublishResult> {
    if (!input.approvalId) {
      throw new Error('Meta recordApprovedPublish called without approvalId — refusing.');
    }
    return {
      published: false,
      manualHandoffRequired: true,
      manualHandoffMessage:
        'Page-post draft + checklist are approved. JAK does NOT auto-publish to Meta. ' +
        'Open Meta Business Suite, paste the body into the composer, attach media, and publish. ' +
        'Ad-spend changes always go through Meta\'s own approval flow. Approval is in the audit log.',
      approvalId: input.approvalId,
    };
  }
}

export const metaAdapter = new MetaBusinessBrowserAdapter();
