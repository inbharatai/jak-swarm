/**
 * Per-platform browser adapter contract.
 *
 * Each adapter implements platform-specific:
 *   - URL allowlist (only that platform's domains)
 *   - login-state heuristic (DOM selectors)
 *   - 2FA / captcha challenge heuristic
 *   - draft generation (post / caption / message body)
 *   - published-action gating (always returns
 *     `manualHandoffRequired: true` until each platform's safe
 *     publish path is engineered)
 *
 * The platform adapters DO NOT auto-post. They produce a draft + a
 * checklist + an approval request. The user publishes manually OR
 * approves — at which point JAK records the approval but still does
 * NOT publish (the safest correct version per the user's mandate;
 * real auto-publish requires per-platform OAuth + content-policy
 * compliance + appeal-handling that's out of scope for this sprint).
 *
 * Adapters are intentionally STATELESS — they receive a Playwright
 * `Page` from the operator and return structured results. State
 * (sessionId, tenantId, screenshot paths) lives in the operator.
 */

import type { Page } from 'playwright';

export type PlatformId = 'LINKEDIN' | 'INSTAGRAM' | 'YOUTUBE_STUDIO' | 'META_BUSINESS_SUITE';

export interface PlatformLoginState {
  /** True when the page shows a logged-in dashboard. */
  loggedIn: boolean;
  /** True when the page shows a 2FA / captcha challenge. */
  challengeDetected: boolean;
  /** Plain-English status for the cockpit. */
  status: string;
}

export interface PlatformDraft {
  /** Type of draft: 'post', 'caption', 'video', 'campaign'. */
  kind: string;
  /** Platform-specific body. */
  body: string;
  /** Platform-specific length limit (LinkedIn: 3000, Instagram: 2200, etc.). */
  charLimit: number;
  /** Truncated to charLimit if over. */
  truncated: boolean;
  /** Optional checklist — assets / hashtags / call-to-action / etc. */
  checklist?: Array<{ item: string; done: boolean }>;
  /** Hashtag suggestions where applicable. */
  hashtags?: string[];
}

export interface PlatformPublishResult {
  /** ALWAYS false in this sprint — adapters never auto-publish today. */
  published: boolean;
  /** True — every approve flow ends here for the user to publish manually. */
  manualHandoffRequired: true;
  /** Plain-English summary of what to do next. */
  manualHandoffMessage: string;
  /** Audit trail: the approvalId that authorized this attempt. */
  approvalId: string;
}

export interface PlatformAdapter {
  readonly id: PlatformId;

  /** Platform name for cockpit copy. */
  readonly displayName: string;

  /** Default URL when starting a session. */
  readonly defaultUrl: string;

  /**
   * Validate the URL belongs to this platform's domain. Used by the
   * operator to enforce per-adapter scope (a LinkedIn session can't
   * navigate to instagram.com).
   */
  isUrlAllowed(url: string): boolean;

  /**
   * Heuristic detection of login state + 2FA / captcha challenge.
   * Reads the page's DOM via Playwright. NEVER reads form values for
   * password fields.
   */
  detectLoginState(page: Page): Promise<PlatformLoginState>;

  /**
   * Build a platform-specific draft from a free-form `topic`.
   * Stateless: the caller provides the topic; the adapter applies
   * platform conventions (length, hashtags, etc.).
   */
  buildDraft(input: { topic: string; tone?: 'professional' | 'casual' | 'enthusiastic' }): PlatformDraft;

  /**
   * Approve-but-don't-publish. Returns a structured result the
   * cockpit shows to the user: "your draft is approved; publish it
   * yourself in the open browser window." Records the approvalId.
   *
   * No auto-publishing in this sprint — even with an approvalId, the
   * adapter explicitly chooses NOT to drive the platform's publish
   * UI because that requires per-platform content-policy compliance
   * + appeal-handling that is out of scope. The honest result is:
   * draft is ready, user clicks publish.
   */
  recordApprovedPublish(input: {
    draft: PlatformDraft;
    approvalId: string;
  }): Promise<PlatformPublishResult>;
}

/**
 * Common helper: redact sensitive form field values (password,
 * verification code, etc.) from any DOM dump the adapter produces.
 * Used when rendering accessibility text to the user — JAK must
 * never echo a 2FA code or password back to its own UI.
 */
export function redactSensitiveValues(text: string): string {
  // Match common "code: 123456" / "password: …" patterns and
  // replace the value with a placeholder. Conservative: prefer
  // false-positive redaction to leaking a code.
  return text
    .replace(/(code|verification code|otp|2fa|password|passcode)[\s:]+[^\s\n]+/gi, '$1: [REDACTED]')
    .replace(/\b\d{6}\b/g, '[REDACTED-CODE]'); // bare 6-digit codes
}
