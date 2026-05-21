/**
 * Step 6 — Video evidence surrogate.
 *
 * Honest framing: this spec records a Playwright `video: 'on'` +
 * `trace: 'on'` capture of a real user walking through the
 * StandingOrders panel + the existing Schedules surface.
 *
 * The separate Remotion YC demo lives under qa/yc-demo-video and is built
 * from captured product screenshots. Keep this Playwright recording as the
 * raw test-evidence companion; it should not be mistaken for the polished
 * narrative demo.
 *
 * Output:
 *   - test-results/evidence-recording-XXX/video.webm
 *   - test-results/evidence-recording-XXX/trace.zip
 *
 * Convert to MP4 for sharing:
 *   ffmpeg -i video.webm -c:v libx264 -crf 22 video.mp4
 *
 * View the trace interactively:
 *   npx playwright show-trace trace.zip
 */
import { test, expect } from '@playwright/test';

// Force per-test recording. Other specs leave video/trace defaults
// alone so this spec is the ONLY one that writes the artifacts the
// final report will reference.
test.use({ video: 'on', trace: 'on' });

test('evidence: standing-orders + schedules user walk-through', async ({ page }) => {
  // Sign-in: dev auth bypass is active when NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS=1
  // is set. The page auto-resolves to the dev user; no /login
  // round-trip needed.

  // 1. Visit the Standing Orders panel.
  await page.goto('/standing-orders', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Standing Orders', exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // 3. Open the create dialog so the recording shows the form fields.
  const createButton = page.getByRole('button', { name: /new standing order|create standing order/i }).last();
  await expect(createButton).toBeVisible({ timeout: 10_000 });
  await createButton.click();
  await expect(page.getByTestId('standing-order-name-input')).toBeVisible({
    timeout: 5_000,
  });

  // Fill a representative form (don't submit — backend integration is
  // covered by `standing-orders.spec.ts`; this spec is about visible
  // user proof of the surface).
  await page.getByTestId('standing-order-name-input').fill('Block external publish on weekends');

  // 4. Close the dialog (cancel).
  await page.getByRole('button', { name: /cancel/i }).click();

  // 5. Navigate to Schedules to demonstrate the related surface.
  await page.goto('/schedules', { waitUntil: 'domcontentloaded' });
  // Allow a generous timeout — the dev server sometimes streams the
  // dashboard layout incrementally.
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });

  // 6. Navigate back to the cockpit to round-trip.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});
