/**
 * GAP 5 — StandingOrder UI panel e2e.
 *
 * Exercises the new `/standing-orders` route end-to-end through the
 * dashboard cockpit. Requires `NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS=1` so
 * the page auto-authenticates with the dev user — no `/login`
 * round-trip needed. Pair with `JAK_DEV_AUTH_BYPASS=1` on the API.
 *
 * The test asserts:
 *   - Page renders (h2 "Standing Orders" + "New Standing Order" button visible)
 *   - Empty state surfaces honest copy when the tenant has no orders
 *   - The honest "How this works" banner is present (anti-fake-product gate)
 *
 * Create / edit / delete round-trip is exercised by `evidence-recording.spec.ts`
 * which records video proof. We deliberately keep this spec lean so a
 * regression here surfaces as a fast smoke signal.
 */
import { test, expect } from '@playwright/test';

test.describe('Standing Orders panel', () => {
  test('renders panel with header, banner, new-button, and empty state', async ({ page }) => {
    await page.goto('/standing-orders', { waitUntil: 'domcontentloaded' });

    // Header
    await expect(page.getByRole('heading', { name: /standing orders/i })).toBeVisible({
      timeout: 15_000,
    });

    // Honest expectation banner — protects against a future cosmetic
    // refactor accidentally removing the user-facing clarification that
    // standing orders pre-authorize *workflow runs*, not individual
    // tool calls.
    await expect(
      page.getByText(/pre-authorizes a/i),
    ).toBeVisible();

    // Primary CTA
    const newBtn = page.getByTestId('standing-orders-new-btn');
    await expect(newBtn).toBeVisible();

    // Empty state OR a list — both are valid; the test only fails if
    // neither shows up, which means the SWR fetch silently dropped or
    // the page never mounted.
    const emptyState = page.getByText(/no standing orders yet/i);
    const list = page.getByTestId('standing-orders-list');
    await expect(emptyState.or(list)).toBeVisible({ timeout: 15_000 });
  });

  test('opens the create dialog with a name input + save button', async ({ page }) => {
    await page.goto('/standing-orders', { waitUntil: 'domcontentloaded' });

    // Click "New Standing Order"; dialog should reveal name input + save button.
    await page.getByTestId('standing-orders-new-btn').click();

    await expect(page.getByTestId('standing-order-name-input')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId('standing-order-save-btn')).toBeVisible();
  });
});
