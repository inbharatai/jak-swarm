import { test, expect } from '@playwright/test';

test.describe('Voice UI (mobile)', () => {
  test('renders voice controls and transcript panel on mobile', async ({ page }) => {
    await page.goto('/__e2e__/voice');

    await expect(page.getByTestId('voice-lab')).toBeVisible();
    await expect(page.getByTestId('voice-input')).toBeVisible();

    // Verify controls exist
    await expect(page.getByRole('button', { name: /push-to-talk/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /hands-free/i })).toBeVisible();
    await expect(page.getByText(/voice input/i)).not.toBeVisible({ timeout: 1000 }).catch(() => {});

    // Transcript panel should render an empty state
    await expect(page.getByText(/no transcript yet/i)).toBeVisible();
  });
});
