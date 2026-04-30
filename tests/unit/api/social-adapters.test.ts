/**
 * Sprint 4 — Instagram + YouTube + Meta browser adapters.
 *
 * All three follow the LinkedIn pattern (Sprint 1):
 *   - URL allowlist scoped to the platform's own domain
 *   - DOM heuristic for logged-in / 2FA / captcha (with stubbed Page)
 *   - Platform-specific draft generation (caption / video / page-post)
 *   - Approval-gated publish that ALWAYS returns
 *     manualHandoffRequired=true
 *   - Refusal without approvalId
 */
import { describe, it, expect } from 'vitest';
import {
  InstagramBrowserAdapter,
  instagramAdapter,
  YouTubeStudioBrowserAdapter,
  youtubeAdapter,
  MetaBusinessBrowserAdapter,
  metaAdapter,
} from '../../../packages/tools/src/index';

function stubPage(opts: { url?: string; selectorsPresent?: string[] } = {}) {
  const present = new Set(opts.selectorsPresent ?? []);
  return {
    url: () => opts.url ?? '',
    locator: (sel: string) => ({
      count: async () => (present.has(sel) ? 1 : 0),
    }),
  } as unknown as import('playwright').Page;
}

describe('InstagramBrowserAdapter', () => {
  const adapter = new InstagramBrowserAdapter();

  describe('URL allowlist', () => {
    it('accepts instagram.com URLs', () => {
      expect(adapter.isUrlAllowed('https://www.instagram.com/')).toBe(true);
      expect(adapter.isUrlAllowed('https://instagram.com/example/')).toBe(true);
    });
    it('rejects non-Instagram', () => {
      expect(adapter.isUrlAllowed('https://www.facebook.com/')).toBe(false);
      expect(adapter.isUrlAllowed('http://www.instagram.com/')).toBe(false);
      expect(adapter.isUrlAllowed('https://instagram.com.evil.com/')).toBe(false);
    });
  });

  describe('login state', () => {
    it('detects logged-in via primary nav', async () => {
      const page = stubPage({ selectorsPresent: ['svg[aria-label="Home"]'] });
      const state = await adapter.detectLoginState(page);
      expect(state.loggedIn).toBe(true);
    });
    it('detects 2FA challenge', async () => {
      const page = stubPage({ selectorsPresent: ['input[name="verificationCode"]'] });
      const state = await adapter.detectLoginState(page);
      expect(state.challengeDetected).toBe(true);
      expect(state.status.toLowerCase()).toContain('2fa');
    });
    it('detects captcha', async () => {
      const page = stubPage({ selectorsPresent: ['iframe[src*="recaptcha"]'] });
      const state = await adapter.detectLoginState(page);
      expect(state.challengeDetected).toBe(true);
    });
  });

  describe('draft generation', () => {
    it('caption respects 2200-char limit', () => {
      const draft = adapter.buildDraft({ topic: 'food photography' });
      expect(draft.kind).toBe('caption');
      expect(draft.body.length).toBeLessThanOrEqual(2200);
    });
    it('suggests food-themed hashtags for food topics', () => {
      const draft = adapter.buildDraft({ topic: 'food photography' });
      expect(draft.hashtags?.some((h) => h.toLowerCase().includes('food'))).toBe(true);
    });
    it('emits a media checklist (Instagram requires media)', () => {
      const draft = adapter.buildDraft({ topic: 'launch' });
      expect(draft.checklist?.some((c) => c.item.toLowerCase().includes('photo') || c.item.toLowerCase().includes('media'))).toBe(true);
    });
  });

  describe('approval-gated publish', () => {
    it('refuses without approvalId', async () => {
      const draft = adapter.buildDraft({ topic: 'x' });
      await expect(adapter.recordApprovedPublish({ draft, approvalId: '' })).rejects.toThrow(/refusing/i);
    });
    it('returns manualHandoffRequired=true with valid approvalId', async () => {
      const draft = adapter.buildDraft({ topic: 'x' });
      const r = await adapter.recordApprovedPublish({ draft, approvalId: 'apr_x' });
      expect(r.published).toBe(false);
      expect(r.manualHandoffRequired).toBe(true);
      expect(r.manualHandoffMessage).toMatch(/JAK does NOT auto-publish/);
    });
  });
});

describe('YouTubeStudioBrowserAdapter', () => {
  const adapter = new YouTubeStudioBrowserAdapter();

  it('URL allowlist accepts youtube.com + studio.youtube.com', () => {
    expect(adapter.isUrlAllowed('https://studio.youtube.com/')).toBe(true);
    expect(adapter.isUrlAllowed('https://www.youtube.com/')).toBe(true);
    expect(adapter.isUrlAllowed('https://youtube.example.com/')).toBe(false);
  });

  it('detects logged-in via Studio app', async () => {
    const page = stubPage({ selectorsPresent: ['ytcp-app'] });
    const state = await adapter.detectLoginState(page);
    expect(state.loggedIn).toBe(true);
  });

  it('detects logged-out via gaia login form', async () => {
    const page = stubPage({ selectorsPresent: ['form[id="gaia_loginform"]'] });
    const state = await adapter.detectLoginState(page);
    expect(state.loggedIn).toBe(false);
    expect(state.status).toContain('Not logged in');
  });

  it('builds title + description draft within YouTube limits', () => {
    const draft = adapter.buildDraft({ topic: 'how to deploy a web app' });
    expect(draft.kind).toBe('video');
    // Title is the first line — must be <= 100 chars after the prefix.
    const titleLine = draft.body.split('\n')[0]!;
    expect(titleLine.replace(/^Title:\s*/, '').length).toBeLessThanOrEqual(100);
    expect(draft.body).toContain('Chapters:');
  });

  it('checklist mentions thumbnail + made-for-kids legal flag', () => {
    const draft = adapter.buildDraft({ topic: 'tutorial' });
    const items = draft.checklist!.map((c) => c.item.toLowerCase()).join(' ');
    expect(items).toContain('thumbnail');
    expect(items).toContain('made for kids');
  });

  it('refuses publish without approvalId', async () => {
    const draft = adapter.buildDraft({ topic: 'x' });
    await expect(adapter.recordApprovedPublish({ draft, approvalId: '' })).rejects.toThrow(/refusing/i);
  });

  it('manual handoff explains "JAK does NOT upload videos"', async () => {
    const draft = adapter.buildDraft({ topic: 'x' });
    const r = await adapter.recordApprovedPublish({ draft, approvalId: 'apr_x' });
    expect(r.manualHandoffMessage).toMatch(/does NOT upload/i);
  });
});

describe('MetaBusinessBrowserAdapter', () => {
  const adapter = new MetaBusinessBrowserAdapter();

  it('URL allowlist accepts business.facebook.com + facebook.com', () => {
    expect(adapter.isUrlAllowed('https://business.facebook.com/')).toBe(true);
    expect(adapter.isUrlAllowed('https://www.facebook.com/')).toBe(true);
    expect(adapter.isUrlAllowed('https://x.com/')).toBe(false);
  });

  it('detects logged-in', async () => {
    const page = stubPage({ selectorsPresent: ['a[aria-label="Profile"]'] });
    const state = await adapter.detectLoginState(page);
    expect(state.loggedIn).toBe(true);
  });

  it('detects 2FA via approvals_code input', async () => {
    const page = stubPage({ selectorsPresent: ['input[name="approvals_code"]'] });
    const state = await adapter.detectLoginState(page);
    expect(state.challengeDetected).toBe(true);
  });

  it('builds page-post draft + checklist that includes audience targeting', () => {
    const draft = adapter.buildDraft({ topic: 'product launch' });
    expect(draft.kind).toBe('page_post');
    const items = draft.checklist!.map((c) => c.item.toLowerCase()).join(' ');
    expect(items).toContain('audience');
    expect(items).toContain('media');
  });

  it('manual handoff explains ad-spend goes through Meta\'s own approval', async () => {
    const draft = adapter.buildDraft({ topic: 'x' });
    const r = await adapter.recordApprovedPublish({ draft, approvalId: 'apr_x' });
    expect(r.manualHandoffMessage).toMatch(/ad-spend|approval flow/i);
  });
});

describe('All four adapters share the same approval-gated contract', () => {
  it('every adapter REFUSES recordApprovedPublish without approvalId', async () => {
    for (const adapter of [instagramAdapter, youtubeAdapter, metaAdapter]) {
      const draft = adapter.buildDraft({ topic: 't' });
      await expect(adapter.recordApprovedPublish({ draft, approvalId: '' })).rejects.toThrow();
    }
  });

  it('every adapter returns manualHandoffRequired=true with valid approvalId (no auto-publish)', async () => {
    for (const adapter of [instagramAdapter, youtubeAdapter, metaAdapter]) {
      const draft = adapter.buildDraft({ topic: 't' });
      const r = await adapter.recordApprovedPublish({ draft, approvalId: 'apr_x' });
      expect(r.published).toBe(false);
      expect(r.manualHandoffRequired).toBe(true);
    }
  });
});
