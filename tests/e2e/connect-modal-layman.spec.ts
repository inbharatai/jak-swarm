/**
 * Phase 1A — Layman ConnectModal e2e regression.
 *
 * Locks in the brief's mandate: "User-facing UI should never show API
 * keys, OAuth scopes, client secrets, redirect URIs, or developer
 * jargon to normal users."
 *
 * The dev-bypass user has role TENANT_ADMIN (per `apps/web/src/lib/auth.ts`),
 * so this spec exercises the admin path:
 *   - Plain-English permissions block IS visible
 *   - Token-paste form is COLLAPSED by default (admin must explicitly toggle)
 *   - "Show advanced setup (admin only)" toggle reveals the form
 *
 * For non-admin users, the token-paste form would never even render —
 * tested via unit assertions on the JSX gating, not here.
 */
import { test, expect } from '@playwright/test';

test.describe('Layman ConnectModal — admin path', () => {
  test('plain-English permissions block visible; token paste hidden by default', async ({ page }) => {
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });

    // Click the first available connector card to open the modal.
    // The page renders a grid of connect buttons — find any "Connect"-style button.
    const firstConnectBtn = page.getByRole('button', { name: /connect|set up|configure/i }).first();
    await expect(firstConnectBtn).toBeVisible({ timeout: 15_000 });
    await firstConnectBtn.click();

    // Modal opens. Permissions block must be visible.
    await expect(page.getByText(/^JAK can$/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/^Approval required before$/)).toBeVisible();

    // Admin-advanced toggle must be present BUT the form must be collapsed.
    await expect(page.getByTestId('admin-advanced-toggle')).toBeVisible();
    await expect(page.getByTestId('admin-token-paste-form')).toHaveCount(0);
  });

  test('clicking advanced toggle reveals the admin token-paste form', async ({ page }) => {
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });

    const firstConnectBtn = page.getByRole('button', { name: /connect|set up|configure/i }).first();
    await firstConnectBtn.click();

    const advancedToggle = page.getByTestId('admin-advanced-toggle');
    await expect(advancedToggle).toBeVisible({ timeout: 5_000 });
    await advancedToggle.click();

    // Token paste form now visible.
    await expect(page.getByTestId('admin-token-paste-form')).toBeVisible();
  });
});
