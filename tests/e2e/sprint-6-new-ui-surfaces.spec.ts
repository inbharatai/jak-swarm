/**
 * Sprint 6 — e2e for the new UI surfaces.
 *
 * Verifies the previously-island code now reaches the user via real
 * UI buttons that call real backend routes.
 */
import { test, expect } from '@playwright/test';

test.describe('Sprint 6 Part D — /social-drafts UI', () => {
  test('page renders with platform picker, topic input, generate button', async ({ page }) => {
    await page.goto('/social-drafts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);

    await expect(page.getByRole('heading', { name: /social drafts/i })).toBeVisible({ timeout: 10_000 });

    // 4 platform pickers
    for (const p of ['linkedin', 'instagram', 'youtube_studio', 'meta_business_suite']) {
      await expect(page.getByTestId(`social-draft-platform-${p}`)).toBeVisible();
    }
    await expect(page.getByTestId('social-draft-topic-input')).toBeVisible();
    await expect(page.getByTestId('social-draft-generate-btn')).toBeVisible();
  });

  test('end-to-end: generate LinkedIn draft via /social-drafts → result card with manual-handoff disclaimer', async ({ page }) => {
    // Route-mock the new backend endpoint so the test is CI-stable
    // even when the dev API process is older than the route file. The
    // wiring test in tests/unit/api/sprint-6-wiring.test.ts proves
    // the backend route exists; this test proves the UI calls it +
    // renders the result correctly.
    await page.route('**/social-drafts', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              adapter: 'LINKEDIN',
              displayName: 'LinkedIn',
              draft: {
                kind: 'post',
                body: 'A perspective on AI agents at scale.\n\nThree things stand out:\n1. (point one)\n2. (point two)\n3. (point three)',
                charLimit: 3000,
                truncated: false,
                hashtags: ['#AI', '#ArtificialIntelligence'],
                checklist: [{ item: 'Replace placeholders', done: false }],
              },
              manualHandoffRequired: true,
              manualHandoffMessage: 'Draft ready for LinkedIn. JAK never auto-publishes — copy the body into the platform\'s own composer.',
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/social-drafts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);

    await page.getByTestId('social-draft-platform-linkedin').click();
    await page.getByTestId('social-draft-topic-input').fill('AI agents at scale');
    await page.getByTestId('social-draft-generate-btn').click();

    await expect(page.getByTestId('social-draft-result-card')).toBeVisible({ timeout: 10_000 });
    const body = await page.getByTestId('social-draft-body').inputValue();
    expect(body.length).toBeGreaterThan(20);

    const handoff = page.getByTestId('social-draft-handoff');
    await expect(handoff).toBeVisible();
    const handoffText = await handoff.innerText();
    expect(handoffText.toLowerCase()).toMatch(/never auto[- ]publish/);
  });
});

test.describe('Sprint 6 Part E — /tool-installer UI', () => {
  test('page renders with task input + detect button', async ({ page }) => {
    await page.goto('/tool-installer', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);

    await expect(page.getByRole('heading', { name: /tool installer/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tool-installer-task-input')).toBeVisible();
    await expect(page.getByTestId('tool-installer-detect-btn')).toBeVisible();
  });

  test('detects PDF parser requirement (route-mocked)', async ({ page }) => {
    // Route-mock /tool-installer/detect for CI stability (same
    // pattern as social-drafts above). The wiring test proves the
    // backend route exists.
    await page.route('**/tool-installer/detect', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              requirements: [
                {
                  capability: 'parse PDF documents',
                  suggestedToolName: 'check_pdf_parser',
                  reason: 'Your task mentions parsing PDFs. JAK needs the check_pdf_parser tool installed.',
                  alreadyRegistered: false,
                  sandboxAdapterAvailable: true,
                },
              ],
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/tool-installer', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);

    await page.getByTestId('tool-installer-task-input').fill('I need a PDF parser to extract text from documents');
    await page.getByTestId('tool-installer-detect-btn').click();

    await expect(page.getByTestId('tool-installer-requirements-card')).toBeVisible({ timeout: 10_000 });
    const text = await page.getByTestId('tool-installer-requirements-card').innerText();
    expect(text.toLowerCase()).toContain('detected');
    expect(text.toLowerCase()).toContain('pdf');
  });
});
