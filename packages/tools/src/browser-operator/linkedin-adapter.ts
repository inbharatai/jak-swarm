/**
 * LinkedIn browser adapter — Sprint 1 of "full-fledged JAK."
 *
 * What this ships:
 *   - URL allowlist scoped to LinkedIn domains
 *   - Login-state heuristic (logged-in / logged-out / 2FA / captcha)
 *     via DOM selectors that work without bypassing security
 *   - Draft generation with LinkedIn-specific conventions
 *     (3000-char limit, hashtag suggestions, professional tone default)
 *   - Approval-gated publish path that produces a structured
 *     `manualHandoffRequired: true` result — the user publishes from
 *     the open browser window (JAK never bypasses platform security)
 *
 * Hard rules enforced:
 *   - No password storage
 *   - No 2FA bypass
 *   - No captcha bypass
 *   - No mass messaging
 *   - No private-profile scraping
 *   - All publishing requires explicit approvalId AND defers to user
 *
 * NEVER auto-publishes in this sprint. The brief explicitly accepts
 * "if publish is still not implemented, approval should produce a
 * safe 'manual publish required' result, not fake success" — that's
 * what we ship.
 */

import type { Page } from 'playwright';
import type {
  PlatformAdapter,
  PlatformDraft,
  PlatformLoginState,
  PlatformPublishResult,
} from './platform-adapter.js';
import { redactSensitiveValues } from './platform-adapter.js';

const LINKEDIN_HOSTS = ['linkedin.com', 'www.linkedin.com'];
const LINKEDIN_POST_CHAR_LIMIT = 3000;

/**
 * DOM selectors used to detect login + challenge states. These are
 * READ-ONLY — the adapter inspects the page but never bypasses any
 * security flow. Selectors are conservative: false-negative
 * (missing a logged-in detection) is preferred over false-positive
 * (claiming logged-in when not).
 */
const LINKEDIN_LOGIN_SIGNALS = {
  /** Strong logged-in signal: top-bar nav with feed icon. */
  loggedIn: ['nav[aria-label="Primary Navigation"]', '[data-test-global-nav]', 'a[data-test-app-aware-link][href*="/feed/"]'],
  /** Strong logged-out signal: sign-in form on /login. */
  loggedOut: ['form[action*="login"]', 'input[name="session_password"]', 'button[type="submit"][data-litms-control-urn]'],
  /** 2FA / verification challenge. */
  twoFactor: ['input[name="pin"]', '[data-test-id="otp-form"]', 'form[action*="checkpoint"]'],
  /** Captcha challenge. */
  captcha: ['iframe[src*="recaptcha"]', '[id*="captcha"]', 'iframe[title*="captcha" i]'],
};

const LINKEDIN_HASHTAG_SUGGESTIONS_BY_TOPIC: Record<string, string[]> = {
  ai: ['#AI', '#ArtificialIntelligence', '#MachineLearning'],
  startup: ['#Startups', '#Founders', '#Entrepreneurship'],
  hiring: ['#Hiring', '#WeAreHiring', '#JobSearch'],
  product: ['#Product', '#ProductManagement', '#Build'],
  engineering: ['#Engineering', '#SoftwareDev', '#OpenSource'],
  marketing: ['#Marketing', '#GrowthHacking', '#B2B'],
  leadership: ['#Leadership', '#Management', '#CareerGrowth'],
  default: ['#LinkedIn'],
};

function suggestHashtags(topic: string): string[] {
  const lower = topic.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [keyword, tags] of Object.entries(LINKEDIN_HASHTAG_SUGGESTIONS_BY_TOPIC)) {
    if (keyword === 'default') continue;
    if (lower.includes(keyword) || tags.some((t) => lower.includes(t.slice(1).toLowerCase()))) {
      for (const tag of tags) {
        if (!seen.has(tag)) {
          seen.add(tag);
          out.push(tag);
        }
      }
    }
  }
  if (out.length === 0) {
    return [...LINKEDIN_HASHTAG_SUGGESTIONS_BY_TOPIC['default']!];
  }
  return out.slice(0, 5);
}

function buildLinkedInDraftBody(topic: string, tone: 'professional' | 'casual' | 'enthusiastic'): string {
  // The adapter is STATELESS; this builder is a deterministic
  // template, not an LLM call. Real CMO Agent flows can layer LLM
  // generation on top of this scaffold.
  const opener =
    tone === 'enthusiastic'
      ? `Excited to share something about ${topic}.`
      : tone === 'casual'
        ? `Quick thought on ${topic}.`
        : `A perspective on ${topic}.`;
  const body = [
    opener,
    '',
    'Three things stand out:',
    '1. (point one — replace with your insight)',
    '2. (point two — replace with your insight)',
    '3. (point three — replace with your insight)',
    '',
    'What do you think? Reply below with your take.',
  ].join('\n');
  return body;
}

export class LinkedInBrowserAdapter implements PlatformAdapter {
  readonly id = 'LINKEDIN' as const;
  readonly displayName = 'LinkedIn';
  readonly defaultUrl = 'https://www.linkedin.com/feed/';

  isUrlAllowed(url: string): boolean {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return false;
      const host = u.hostname.toLowerCase();
      return LINKEDIN_HOSTS.some((h) => host === h || host.endsWith('.' + h));
    } catch {
      return false;
    }
  }

  async detectLoginState(page: Page): Promise<PlatformLoginState> {
    const url = page.url();

    // Check captcha + 2FA FIRST — they take precedence over the
    // logged-in / logged-out signal because the user's job is to
    // resolve them before anything else can happen.
    for (const sel of LINKEDIN_LOGIN_SIGNALS.captcha) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: true,
          status: 'Captcha challenge detected — please complete it in the browser window. JAK will pause until you signal ready.',
        };
      }
    }
    for (const sel of LINKEDIN_LOGIN_SIGNALS.twoFactor) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: true,
          status: 'LinkedIn is asking for a 2FA code — please enter it in the browser window. JAK will not see or store the code.',
        };
      }
    }

    // Logged-in signal — at least one selector must match. We use
    // .count() rather than .isVisible() because LinkedIn's feed nav
    // is sometimes hidden behind off-screen breakpoints.
    for (const sel of LINKEDIN_LOGIN_SIGNALS.loggedIn) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: true,
          challengeDetected: false,
          status: 'Logged in to LinkedIn. Ready to review profile / draft a post.',
        };
      }
    }

    // Logged-out signal.
    for (const sel of LINKEDIN_LOGIN_SIGNALS.loggedOut) {
      if ((await page.locator(sel).count().catch(() => 0)) > 0) {
        return {
          loggedIn: false,
          challengeDetected: false,
          status: 'Not logged in — please sign in on the LinkedIn page. JAK never sees your password.',
        };
      }
    }

    // Conservative fallback: if we couldn't classify, surface URL +
    // ask the user to sign in. Better than guessing wrong.
    return {
      loggedIn: false,
      challengeDetected: false,
      status: `LinkedIn login state could not be confirmed at ${url}. Please sign in on the page if needed.`,
    };
  }

  buildDraft(input: { topic: string; tone?: 'professional' | 'casual' | 'enthusiastic' }): PlatformDraft {
    const tone = input.tone ?? 'professional';
    const body = buildLinkedInDraftBody(input.topic, tone);
    const truncated = body.length > LINKEDIN_POST_CHAR_LIMIT;
    const finalBody = truncated ? body.slice(0, LINKEDIN_POST_CHAR_LIMIT - 1) + '…' : body;

    const checklist = [
      { item: 'Replace the placeholder bullet points with your real insights', done: false },
      { item: 'Add a personal hook in the first sentence', done: false },
      { item: 'Pick 1–2 hashtags from the suggestions', done: false },
      { item: 'Tag relevant people if you mention them', done: false },
    ];

    return {
      kind: 'post',
      body: finalBody,
      charLimit: LINKEDIN_POST_CHAR_LIMIT,
      truncated,
      checklist,
      hashtags: suggestHashtags(input.topic),
    };
  }

  async recordApprovedPublish(input: {
    draft: PlatformDraft;
    approvalId: string;
  }): Promise<PlatformPublishResult> {
    if (!input.approvalId) {
      throw new Error(
        'recordApprovedPublish called without approvalId — refusing. The approval gate is the only path that supplies an approvalId.',
      );
    }
    return {
      published: false,
      manualHandoffRequired: true,
      manualHandoffMessage:
        'Draft is approved. JAK does NOT auto-publish to LinkedIn in this sprint. Open the browser window, review the draft one more time, and click "Post" yourself. ' +
        'JAK has recorded your approval in the audit log; the published URL (if you choose to publish) can be linked back to this approval manually.',
      approvalId: input.approvalId,
    };
  }
}

/** Singleton instance — adapters are stateless, one per process is fine. */
export const linkedInAdapter = new LinkedInBrowserAdapter();

// Re-export the redaction helper so route handlers can scrub DOM
// dumps before logging / displaying.
export { redactSensitiveValues };
