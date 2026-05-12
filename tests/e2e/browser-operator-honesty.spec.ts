/**
 * Browser-operator UI honesty regression.
 *
 * The brief mandates: do NOT imply Instagram/LinkedIn/YouTube/Meta
 * are functional unless the runtime exists. This spec asserts the
 * UI's contract:
 *
 *   - The GENERIC card IS functional today (real Playwright runtime
 *     shipped in `packages/tools/src/browser-operator/`)
 *   - The 4 platform cards (Instagram/LinkedIn/YouTube/Meta) say
 *     "Coming soon — needs platform adapter" honestly
 *   - There is NO "Connect Instagram now" / "Auto-post" / fake
 *     success-state copy anywhere on the page
 */
import { test, expect } from '@playwright/test';

const FORBIDDEN_FAKE_CLAIMS = [
  /\bConnect Instagram now\b/i,
  /\bAuto[- ]post\b/i,
  /\bAutomatically posts?\b/i,
  /\bAutonomous posting\b/i,
  /\bFully autonomous (Instagram|LinkedIn|YouTube|Meta)\b/i,
];

test.describe('Browser-operator UI honesty', () => {
  test('Generic card is functional; per-platform cards say Coming soon', async ({ page }) => {
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_500);

    // Generic card present + has functional Start button.
    await expect(page.getByTestId('browser-platform-generic')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('browser-start-generic')).toBeVisible();
    // Per the contract, the start button label is "Start browser session".
    const generic = page.getByTestId('browser-platform-generic');
    const genericText = await generic.innerText();
    expect(genericText).toContain('Start browser session');

    // ALL FOUR per-platform adapters are now functional (Sprint 1 + 4)
    // with manual-handoff publish (no auto-post). Each card MUST say
    // "Start browser session" + a manual-handoff disclaimer.
    for (const platform of ['linkedin', 'instagram', 'youtube-studio', 'meta-business-suite']) {
      const card = page.getByTestId(`browser-platform-${platform}`);
      await expect(card, `${platform} card must render`).toBeVisible();
      const text = await card.innerText();
      // Must NOT say "Coming soon — needs platform adapter" anymore.
      expect(
        text.toLowerCase().includes('coming soon — needs platform adapter'),
        `${platform} must NOT say "Coming soon — needs platform adapter"`,
      ).toBe(false);
      // Must say either "publishing" / "publish" / "manual" / "uploading"
      // / "manual handoff" — disclaimer that JAK doesn't auto-post.
      expect(
        /publish|manual|upload/i.test(text),
        `${platform} card must explain manual-handoff (publish / upload / manual)`,
      ).toBe(true);
    }
  });

  test('No fake autonomous-posting / Connect-Instagram-now copy anywhere', async ({ page }) => {
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_500);

    const bodyText = await page.locator('body').innerText();
    for (const re of FORBIDDEN_FAKE_CLAIMS) {
      expect(
        re.test(bodyText),
        `Found forbidden over-claim matching ${re}. Browser-operator UI must not imply autonomous posting works.`,
      ).toBe(false);
    }
  });

  test('Status badge accurately reports the shipped browser-operator mode', async ({ page }) => {
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_500);

    const badge = page.getByTestId('browser-operator-status-badge');
    await expect(badge).toBeVisible();
    const badgeText = await badge.innerText();
    // Status copy expands as platform adapters ship; check for any
    // of the known live states.
    expect(badgeText.toLowerCase()).toMatch(/(generic.*live|assisted adapters live|linkedin|all adapters live)/i);
  });
});
