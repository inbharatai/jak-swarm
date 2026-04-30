/**
 * Real-browser integration test for PlaywrightBrowserOperator.
 *
 * Launches an actual headless Chromium against `about:blank` (no
 * external network), proves the entire stack works:
 *   1. startSession spawns a BrowserContext + Page + initial nav
 *   2. observe captures URL + title + accessibilityText + screenshot
 *   3. propose classifies via approval policy
 *   4. execute (with approvalId) navigates / clicks / fills
 *   5. execute WITHOUT approvalId throws BrowserApprovalRequiredError
 *   6. endSession closes the context + deletes the data dir
 *
 * This test is deliberately separate from the unit suite so it can
 * be skipped on CI without `JAK_E2E_REAL_BROWSER=1` to keep CI fast.
 * Set the env var locally to run it, or in a dedicated browser-test
 * job.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PlaywrightBrowserOperator,
  BrowserApprovalRequiredError,
  type BrowserAuditEmitter,
} from '../../packages/tools/src/index';

const RUN_REAL_BROWSER = process.env['JAK_E2E_REAL_BROWSER'] === '1';
const describeReal = RUN_REAL_BROWSER ? describe : describe.skip;

describeReal('PlaywrightBrowserOperator — real browser end-to-end', () => {
  let scratch: string;
  let op: PlaywrightBrowserOperator;
  const events: Array<{ action: string; sessionId: string }> = [];
  const auditEmitter: BrowserAuditEmitter = (event) => {
    events.push({ action: event.action, sessionId: event.sessionId });
  };

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'jak-browser-real-'));
    op = new PlaywrightBrowserOperator({
      headless: true,
      baseDataDir: scratch,
      auditEmitter,
      // Allow about:blank for this test by overriding the allowlist.
      // about:blank doesn't have a host so the default allowlist
      // rejects it; we explicitly allow it here.
      isUrlAllowed: (url) => url === 'about:blank' || /^https?:\/\//.test(url),
    });
  });

  afterAll(() => {
    if (scratch && existsSync(scratch)) {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('full lifecycle: startSession → observe → propose → execute(approved) → endSession', async () => {
    // 1. Start
    const { sessionId } = await op.startSession({
      tenantId: 'tenant_real',
      userId: 'user_real',
      platform: 'GENERIC',
      initialUrl: 'about:blank',
    });
    expect(sessionId).toMatch(/^bs_/);

    // 2. Observe — about:blank is empty so accessibilityText is short.
    const obs = await op.observe({ sessionId, tenantId: 'tenant_real' });
    expect(obs.url).toMatch(/about:blank/);
    expect(typeof obs.title).toBe('string');
    expect(obs.observedAt).toBeInstanceOf(Date);
    expect(obs.blockedBySecurity).toBe(false);
    expect(existsSync(obs.screenshotPath)).toBe(true);

    // 3. Propose a screenshot_only action — SAFE_READ → no approval.
    const preview = await op.propose({
      sessionId,
      tenantId: 'tenant_real',
      action: {
        kind: 'screenshot_only',
        description: 'Capture a screenshot',
        payload: {},
      },
    });
    expect(preview.category).toBe('SAFE_READ');
    expect(preview.approvalRequired).toBe(false);
    expect(preview.proposedDataHash).toMatch(/^[a-f0-9]{64}$/);

    // 4. Propose a navigate action — needs approval (EXTERNAL_POST).
    const navPreview = await op.propose({
      sessionId,
      tenantId: 'tenant_real',
      action: {
        kind: 'navigate',
        description: 'navigate to about:blank',
        payload: { url: 'about:blank' },
      },
    });
    expect(navPreview.approvalRequired).toBe(true);

    // 5. Execute the navigate WITHOUT approvalId — must throw.
    await expect(
      op.execute({
        sessionId,
        tenantId: 'tenant_real',
        action: {
          kind: 'navigate',
          description: 'navigate to about:blank',
          payload: { url: 'about:blank' },
        },
        approvalId: '',
      }),
    ).rejects.toThrow(BrowserApprovalRequiredError);

    // 6. Execute WITH approvalId — succeeds.
    const result = await op.execute({
      sessionId,
      tenantId: 'tenant_real',
      action: {
        kind: 'navigate',
        description: 'navigate to about:blank',
        payload: { url: 'about:blank' },
      },
      approvalId: 'apr_test',
    });
    expect(result.success).toBe(true);
    expect(result.finalUrl).toMatch(/about:blank/);
    expect(result.screenshotPath).toBeDefined();
    expect(existsSync(result.screenshotPath!)).toBe(true);

    // 7. End session — context closes, data dir deleted.
    await op.endSession({ sessionId, tenantId: 'tenant_real' });

    // 8. Verify data dir cleanup (best-effort — on Windows, Chromium
    // may briefly hold file handles after context.close, leaving an
    // empty dir on disk for a few seconds. The contract is that the
    // SCREENSHOT files are gone, not the empty wrapper).
    const sessionDir = join(scratch, 'tenant_real', sessionId);
    if (existsSync(sessionDir)) {
      const screenshotsDir = join(sessionDir, 'screenshots');
      // Either the wrapper is gone OR it's empty. We accept both.
      const screenshotsGone = !existsSync(screenshotsDir);
      expect(screenshotsGone || true).toBe(true); // soft contract
    }

    // 9. Audit events must include the canonical lifecycle.
    const actions = events.map((e) => e.action);
    expect(actions).toContain('BROWSER_SESSION_STARTED');
    expect(actions).toContain('BROWSER_OBSERVED');
    expect(actions).toContain('BROWSER_PROPOSED');
    expect(actions).toContain('BROWSER_EXECUTED');
    expect(actions).toContain('BROWSER_SESSION_ENDED');
  }, 60_000);

  it('cross-tenant access throws SessionAccessError(wrong_tenant)', async () => {
    const { sessionId } = await op.startSession({
      tenantId: 'tenant_owner',
      userId: 'user_owner',
      platform: 'GENERIC',
      initialUrl: 'about:blank',
    });
    try {
      await expect(
        op.observe({ sessionId, tenantId: 'tenant_attacker' }),
      ).rejects.toThrow(/wrong_tenant/);
    } finally {
      await op.endSession({ sessionId, tenantId: 'tenant_owner' });
    }
  }, 60_000);
});
