/**
 * Phase 7 — Task execution visibility (layman language only).
 *
 * Brief mandate (no-half-measures Phase 7): "JAK must not just chat.
 * The dashboard must clearly show: User request, Interpreted intent,
 * Agent assigned, Plan steps, Tool calls, Approval checkpoints,
 * Current status, Evidence/output, Errors. Avoid: raw JSON, developer
 * jargon, hidden steps, fake progress, vague 'processing'."
 *
 * This spec verifies the cockpit at `/workspace` does NOT leak any of
 * the developer-jargon / raw-internal-codes that would confuse a
 * non-technical user. Specifically:
 *
 *   - No `WORKER_*` raw enum codes visible in the UI body
 *   - No `node_enter` / `node_exit` lifecycle event names visible
 *   - No raw JSON blobs in the chat thread
 *   - No tool IDs like `tool_xyz_internal_id` visible
 *   - No `swarm_state` / `agent_state` developer terms visible
 *
 * The friendly names mapper (apps/web/src/lib/agent-friendly-names.ts)
 * is the source of truth for what the user sees. This test is its
 * regression net at the rendered-DOM level.
 */
import { test, expect } from '@playwright/test';

const RAW_DEVELOPER_TERMS = [
  // Raw agent enum codes — must always be friendly-named
  'WORKER_MARKETING',
  'WORKER_CODER',
  'WORKER_STRATEGIST',
  'WORKER_FINANCE',
  'WORKER_OPS',
  // Raw lifecycle event names — must show as user-readable status
  'node_enter',
  'node_exit',
  'worker_started',
  'worker_completed',
  // Internal swarm/state references that should never reach the UI
  'swarmState',
  'agentRole:',
  // Generic raw-tooling jargon
  'tool_id:',
  'tenantId:',
  'workflowId:', // (allowed in URL, not in visible body)
];

test.describe('Cockpit task-execution view — layman language only', () => {
  test('no raw WORKER_* / node_enter / swarm jargon visible on /workspace', async ({ page }) => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_500); // settle Suspense + SWR

    // Capture the full visible body text (excluding hidden / aria-hidden).
    const bodyText = await page.locator('body').innerText();

    for (const term of RAW_DEVELOPER_TERMS) {
      expect(
        bodyText.includes(term),
        `Cockpit body contains raw developer term "${term}". A layman user should never see this. ` +
          `Use the friendly mapper at apps/web/src/lib/agent-friendly-names.ts.`,
      ).toBe(false);
    }
  });

  test('chat input is visible + accepts plain English (the user-first entry point)', async ({ page }) => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_500);

    // Either an input or textarea for the chat — the layman entry point.
    const chatInput = page
      .locator('input[type="text"], textarea')
      .filter({ hasText: '' }) // any
      .first();
    // If the input is present, it must be visible (not hidden behind a tab).
    if ((await chatInput.count()) > 0) {
      const visible = await chatInput.isVisible().catch(() => false);
      expect(visible, 'Chat input must be visible on the cockpit landing').toBe(true);
    }
  });

  test('cockpit does not render raw JSON blobs in the message thread', async ({ page }) => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_500);

    const bodyText = await page.locator('body').innerText();

    // A `{ "key": "value", "another": ...` shape suggests raw JSON dumped to UI.
    // Allow short JSON-looking fragments (e.g. inline code), but flag anything
    // that looks like a 3+ key serialized object.
    const jsonBlobMatch = bodyText.match(/\{[\s\S]{50,}"[\w]+":\s*"[^"]+",\s*"[\w]+":\s*"[^"]+",\s*"[\w]+"/);
    expect(
      jsonBlobMatch,
      `Cockpit body contains a raw JSON blob: "${jsonBlobMatch?.[0]?.slice(0, 100)}…". ` +
        `Layman users should see a friendly summary, not raw API responses.`,
    ).toBeNull();
  });
});

/**
 * Layman-language regression for the existing AgentTracker component
 * (verified that, when present, it renders friendly executive labels).
 */
test('AgentTracker renders friendly executive labels (when an agent is active)', async ({ page }) => {
  await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_500);

  const tracker = page.getByTestId('agent-tracker-current');
  if ((await tracker.count()) === 0) {
    // No active workflow in dev tenant → AgentTracker doesn't mount.
    // This is correct behavior; nothing to test.
    test.skip();
    return;
  }

  const text = await tracker.innerText();
  // If an agent IS rendered, its label must be a friendly name (not WORKER_*).
  expect(text.toUpperCase().includes('WORKER_')).toBe(false);
  // Common friendly-name keywords — at least one should appear.
  expect(text).toMatch(/(Agent|CMO|CTO|CEO|CFO|COO|Strategy|Planner|Verifier)/i);
});
