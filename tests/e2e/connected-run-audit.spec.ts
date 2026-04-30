/**
 * Phase 3 — Run-audit verification with realistic CONNECTED state.
 *
 * Closes the no-half-measures gap: the previous Phase 2 test only
 * verified the Run-audit button does NOT show on disconnected cards.
 * It never proved the button works on a CONNECTED integration because
 * the dev tenant has no real OAuth credentials.
 *
 * Strategy: Playwright route mocking. We intercept GET /integrations
 * and return a deterministic CONNECTED Gmail integration. Then we:
 *   1. Verify the Run-audit button appears on the Gmail card
 *   2. Verify clicking it triggers POST /workflows with the correct
 *      provider-specific layman goal
 *   3. Verify the user is navigated to /workspace?workflowId=...
 *
 * NO real credentials. NO real workflow execution. The test proves the
 * UI → API contract works end-to-end. The agent pipeline is covered
 * by separate integration tests.
 */
import { test, expect } from '@playwright/test';

test.describe('Run-audit on CONNECTED integration (route-mocked)', () => {
  test('Gmail CONNECTED → Run audit button visible → click creates workflow', async ({ page }) => {
    // Intercept GET /integrations to return a CONNECTED Gmail integration
    // — proves the Run-audit button renders on the connected card.
    // Match the API URL only (port 4000), not the front-end /integrations route.
    await page.route('**/localhost:4000/integrations', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && !url.includes('/integrations/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: 'integration_gmail_test_1',
                tenantId: 'dev-tenant-id',
                provider: 'GMAIL',
                status: 'CONNECTED',
                displayName: 'gmail-test@example.com',
                scopes: ['read', 'send'],
                metadata: { toolCount: 5 },
                lastUsedAt: new Date().toISOString(),
                connectedBy: 'dev-user-id',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        });
        return;
      }
      await route.continue();
    });

    // Capture the POST /workflows payload that the Run-audit button fires.
    let capturedWorkflowGoal: string | null = null;
    let capturedWorkflowMethod: string | null = null;
    await page.route('**/localhost:4000/workflows', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { goal?: string };
        capturedWorkflowGoal = body.goal ?? null;
        capturedWorkflowMethod = 'POST';
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: 'wf_mocked_audit_xyz',
              tenantId: 'dev-tenant-id',
              userId: 'dev-user-id',
              goal: body.goal,
              status: 'PENDING',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    // Visit /integrations.
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);

    // The Run-audit button must be visible for the connected Gmail card.
    const runAuditBtn = page.getByTestId('run-audit-gmail');
    await expect(runAuditBtn).toBeVisible({ timeout: 10_000 });

    // Click it.
    await runAuditBtn.click();

    // Wait for the POST to fire + the navigation.
    await page.waitForURL(/\/workspace\?workflowId=wf_mocked_audit_xyz/, { timeout: 10_000 });

    // Verify the captured goal is the provider-specific layman copy.
    expect(capturedWorkflowMethod).toBe('POST');
    expect(capturedWorkflowGoal).toBeTruthy();
    expect(capturedWorkflowGoal!.toLowerCase()).toContain('gmail');
    expect(capturedWorkflowGoal!.toLowerCase()).toContain('summarize');
    // Anti-execution guarantee — the goal explicitly tells the pipeline NOT to send/delete.
    expect(capturedWorkflowGoal!.toLowerCase()).toContain('do not send');
  });

  test('disconnected Gmail does NOT show Run audit button', async ({ page }) => {
    // Intercept with status='NOT_CONNECTED' instead.
    // Match the API URL only (port 4000), not the front-end /integrations route.
    await page.route('**/localhost:4000/integrations', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && !url.includes('/integrations/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: 'integration_gmail_disconnected',
                tenantId: 'dev-tenant-id',
                provider: 'GMAIL',
                status: 'NOT_CONNECTED',
                displayName: null,
                scopes: [],
                metadata: null,
                lastUsedAt: null,
                connectedBy: 'dev-user-id',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);

    // Run-audit must NOT appear on disconnected cards.
    await expect(page.getByTestId('run-audit-gmail')).toHaveCount(0);
  });
});
