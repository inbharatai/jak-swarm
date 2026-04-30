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

    // LinkedIn is now FUNCTIONAL (Sprint 1) — must NOT say "Coming soon".
    const linkedin = page.getByTestId('browser-platform-linkedin');
    await expect(linkedin).toBeVisible();
    const linkedinText = await linkedin.innerText();
    expect(linkedinText.toLowerCase()).toContain('publishing requires your approval');
    expect(linkedinText.toLowerCase()).not.toContain('coming soon — needs platform adapter');

    // Per-platform "Coming soon" cards still honest for the unshipped ones.
    for (const platform of ['instagram', 'youtube-studio', 'meta-business-suite']) {
      const card = page.getByTestId(`browser-platform-${platform}`);
      await expect(card, `${platform} card must render`).toBeVisible();
      const text = await card.innerText();
      expect(
        text.toLowerCase(),
        `${platform} card must explicitly say "Coming soon"`,
      ).toContain('coming soon');
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

  test('Status badge accurately says "Generic mode live"', async ({ page }) => {
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_500);

    const badge = page.getByTestId('browser-operator-status-badge');
    await expect(badge).toBeVisible();
    const badgeText = await badge.innerText();
    // Status copy expands as platform adapters ship; check for one of
    // the known live states ("Generic mode live" or "Generic + LinkedIn live").
    expect(badgeText.toLowerCase()).toMatch(/generic.*(?:live|linkedin)/i);
  });
});
