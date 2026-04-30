/**
 * Sprint 1 — LinkedInBrowserAdapter unit tests.
 *
 * Covers the stateless adapter surface:
 *   - URL allowlist (LinkedIn domains only; rejects everything else)
 *   - DOM-based login + 2FA + captcha detection (with stubbed Page)
 *   - Draft generation (3000-char LinkedIn limit, hashtag suggestions)
 *   - Approval-gated publish: NEVER auto-publishes; always returns
 *     manualHandoffRequired=true; refuses without approvalId
 *
 * Stateful Playwright behaviors (real browser launch) are covered by
 * `tests/integration/browser-operator-real-browser.test.ts` which
 * already exercises the operator end-to-end.
 */
import { describe, it, expect } from 'vitest';
import {
  LinkedInBrowserAdapter,
  linkedInAdapter,
  redactSensitiveValues,
} from '../../../packages/tools/src/index';

describe('LinkedInBrowserAdapter — URL allowlist', () => {
  const adapter = new LinkedInBrowserAdapter();

  it('accepts canonical linkedin.com URLs', () => {
    expect(adapter.isUrlAllowed('https://www.linkedin.com/feed/')).toBe(true);
    expect(adapter.isUrlAllowed('https://linkedin.com/in/example')).toBe(true);
    expect(adapter.isUrlAllowed('https://www.linkedin.com/company/jak-swarm/')).toBe(true);
  });

  it('rejects non-LinkedIn domains', () => {
    expect(adapter.isUrlAllowed('https://www.facebook.com/feed/')).toBe(false);
    expect(adapter.isUrlAllowed('https://example.com/')).toBe(false);
    expect(adapter.isUrlAllowed('https://www.linkedin.com.evil.com/')).toBe(false);
  });

  it('rejects http (only https allowed)', () => {
    expect(adapter.isUrlAllowed('http://www.linkedin.com/')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(adapter.isUrlAllowed('not-a-url')).toBe(false);
    expect(adapter.isUrlAllowed('javascript:alert(1)')).toBe(false);
    expect(adapter.isUrlAllowed('file:///etc/passwd')).toBe(false);
  });
});

// Helper: stub a minimal Playwright Page. We only need the surface
// the adapter touches (locator(...).count(), url()).
function stubPage(opts: { url?: string; selectorsPresent?: string[] } = {}) {
  const present = new Set(opts.selectorsPresent ?? []);
  return {
    url: () => opts.url ?? 'https://www.linkedin.com/feed/',
    locator: (sel: string) => ({
      count: async () => (present.has(sel) ? 1 : 0),
    }),
  } as unknown as import('playwright').Page;
}

describe('LinkedInBrowserAdapter — login state detection', () => {
  const adapter = new LinkedInBrowserAdapter();

  it('detects logged-in via primary nav', async () => {
    const page = stubPage({
      selectorsPresent: ['nav[aria-label="Primary Navigation"]'],
    });
    const state = await adapter.detectLoginState(page);
    expect(state.loggedIn).toBe(true);
    expect(state.challengeDetected).toBe(false);
    expect(state.status).toContain('Logged in');
  });

  it('detects logged-out via login form', async () => {
    const page = stubPage({
      selectorsPresent: ['form[action*="login"]'],
    });
    const state = await adapter.detectLoginState(page);
    expect(state.loggedIn).toBe(false);
    expect(state.challengeDetected).toBe(false);
    expect(state.status).toContain('Not logged in');
  });

  it('detects 2FA challenge BEFORE checking logged-in (precedence)', async () => {
    const page = stubPage({
      selectorsPresent: ['input[name="pin"]', 'nav[aria-label="Primary Navigation"]'],
    });
    const state = await adapter.detectLoginState(page);
    expect(state.challengeDetected).toBe(true);
    expect(state.loggedIn).toBe(false);
    expect(state.status.toLowerCase()).toContain('2fa');
  });

  it('detects captcha challenge', async () => {
    const page = stubPage({
      selectorsPresent: ['iframe[src*="recaptcha"]'],
    });
    const state = await adapter.detectLoginState(page);
    expect(state.challengeDetected).toBe(true);
    expect(state.status.toLowerCase()).toContain('captcha');
  });

  it('falls back conservatively when no signal matches', async () => {
    const page = stubPage({ url: 'https://www.linkedin.com/help/', selectorsPresent: [] });
    const state = await adapter.detectLoginState(page);
    expect(state.loggedIn).toBe(false);
    expect(state.challengeDetected).toBe(false);
    expect(state.status).toContain('could not be confirmed');
  });
});

describe('LinkedInBrowserAdapter — draft generation', () => {
  const adapter = new LinkedInBrowserAdapter();

  it('produces a post within the 3000-char limit', () => {
    const draft = adapter.buildDraft({ topic: 'AI agents at scale' });
    expect(draft.kind).toBe('post');
    expect(draft.charLimit).toBe(3000);
    expect(draft.body.length).toBeLessThanOrEqual(3000);
    expect(draft.truncated).toBe(false);
  });

  it('suggests AI hashtags when topic mentions AI', () => {
    const draft = adapter.buildDraft({ topic: 'AI and machine learning' });
    expect(draft.hashtags).toContain('#AI');
  });

  it('suggests startup hashtags for startup topics', () => {
    const draft = adapter.buildDraft({ topic: 'startup founders journey' });
    expect(draft.hashtags?.some((h) => h.toLowerCase().includes('startup') || h.toLowerCase().includes('founder'))).toBe(true);
  });

  it('falls back to generic hashtag when topic has no keyword match', () => {
    const draft = adapter.buildDraft({ topic: 'random topic with nothing matchable xyz' });
    expect(draft.hashtags).toContain('#LinkedIn');
  });

  it('respects tone parameter', () => {
    const enthusiastic = adapter.buildDraft({ topic: 'launch', tone: 'enthusiastic' });
    expect(enthusiastic.body.toLowerCase()).toContain('excited');

    const casual = adapter.buildDraft({ topic: 'launch', tone: 'casual' });
    expect(casual.body.toLowerCase()).toContain('quick thought');
  });

  it('produces a checklist with at least 3 items', () => {
    const draft = adapter.buildDraft({ topic: 'product launch' });
    expect(Array.isArray(draft.checklist)).toBe(true);
    expect(draft.checklist!.length).toBeGreaterThanOrEqual(3);
    for (const item of draft.checklist!) {
      expect(item.done).toBe(false);
      expect(item.item).toBeTruthy();
    }
  });
});

describe('LinkedInBrowserAdapter — approval-gated publish (NEVER auto-publishes)', () => {
  const adapter = new LinkedInBrowserAdapter();

  it('refuses recordApprovedPublish without approvalId', async () => {
    const draft = adapter.buildDraft({ topic: 'test' });
    await expect(
      adapter.recordApprovedPublish({ draft, approvalId: '' }),
    ).rejects.toThrow(/refusing/i);
  });

  it('returns manualHandoffRequired=true with valid approvalId (NO auto-publish)', async () => {
    const draft = adapter.buildDraft({ topic: 'test' });
    const result = await adapter.recordApprovedPublish({ draft, approvalId: 'apr_xyz' });
    expect(result.published).toBe(false);
    expect(result.manualHandoffRequired).toBe(true);
    expect(result.approvalId).toBe('apr_xyz');
    expect(result.manualHandoffMessage).toMatch(/does NOT auto-publish/i);
  });
});

describe('redactSensitiveValues helper', () => {
  it('redacts 6-digit codes', () => {
    expect(redactSensitiveValues('Your code is 123456 — enter it now')).toContain('[REDACTED-CODE]');
  });

  it('redacts password patterns', () => {
    expect(redactSensitiveValues('password: hunter2')).toMatch(/password:\s*\[REDACTED\]/i);
  });

  it('redacts OTP / 2FA labels', () => {
    expect(redactSensitiveValues('OTP: 987654')).toMatch(/OTP:\s*\[REDACTED\]/i);
  });

  it('passes through normal text unchanged', () => {
    const input = 'This is a normal LinkedIn post about engineering.';
    expect(redactSensitiveValues(input)).toBe(input);
  });
});

describe('linkedInAdapter singleton', () => {
  it('exports a stateless singleton matching the LinkedInBrowserAdapter type', () => {
    expect(linkedInAdapter.id).toBe('LINKEDIN');
    expect(linkedInAdapter.displayName).toBe('LinkedIn');
    expect(linkedInAdapter.defaultUrl).toMatch(/^https:\/\/www\.linkedin\.com/);
  });
});
