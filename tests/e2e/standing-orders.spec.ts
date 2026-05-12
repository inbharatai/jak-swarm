/**
 * GAP 5 — StandingOrder UI panel e2e.
 *
 * Exercises the new `/standing-orders` route end-to-end through the
 * dashboard cockpit. Requires `NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS=1` so
 * the page auto-authenticates with the dev user — no `/login`
 * round-trip needed. Pair with `JAK_DEV_AUTH_BYPASS=1` on the API.
 *
 * The tests assert:
 *   - Page renders (h2 "Standing Orders" + "New Standing Order" button visible)
 *   - Empty state surfaces honest copy when the tenant has no orders
 *   - The honest "How this works" banner is present (anti-fake-product gate)
 *   - Create / edit / disable / delete round-trip works through real UI + API
 */
import { test, expect } from '@playwright/test';

test.describe('Standing Orders panel', () => {
  test.describe.configure({ mode: 'serial' });

  test('renders panel with header, banner, new-button, and empty state', async ({ page }) => {
    await page.goto('/standing-orders', { waitUntil: 'domcontentloaded' });

    // Header
    await expect(page.getByRole('heading', { name: 'Standing Orders', level: 2 })).toBeVisible({
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

  test('creates, edits, disables, and deletes a standing order through the UI', async ({ page }) => {
    const name = `E2E standing order ${Date.now()}`;
    const updatedName = `${name} updated`;

    await page.goto('/standing-orders', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('standing-orders-new-btn').click();

    await page.getByTestId('standing-order-name-input').fill(name);
    await page.getByPlaceholder('What this order enforces and why.').fill('E2E policy boundary proof.');
    await page.getByPlaceholder('web_search, draft_email').fill('web_search');
    await page.getByPlaceholder('gmail_send_email, slack_post_message').fill('slack_post_message');
    await page
      .getByPlaceholder('EXTERNAL_ACTION_APPROVAL, CRITICAL_MANUAL_ONLY')
      .fill('EXTERNAL_ACTION_APPROVAL');
    await page.getByPlaceholder('5.00').fill('1.25');
    await page.getByTestId('standing-order-save-btn').click();

    await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
    let card = page.locator('[data-testid^="standing-order-card-"]').filter({ hasText: name }).first();
    await expect(card).toContainText('web_search');
    await expect(card).toContainText('slack_post_message');
    await expect(card).toContainText('Approval req');
    await expect(card).toContainText('$1.25');

    await card.getByRole('button', { name: 'Edit' }).click();
    const nameInput = page.getByTestId('standing-order-name-input');
    await nameInput.fill(updatedName);
    await page.getByTestId('standing-order-save-btn').click();

    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 15_000 });
    card = page.locator('[data-testid^="standing-order-card-"]').filter({ hasText: updatedName }).first();

    await card.getByRole('button', { name: 'Disable' }).click();
    await expect(card).toContainText('Disabled', { timeout: 15_000 });

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await card.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(updatedName)).toHaveCount(0, { timeout: 15_000 });
  });
});
