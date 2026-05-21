import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(__dirname, '../../qa/yc-demo-video/assets');

const shots = [
  { file: '01-landing-hero.png', route: '/', expected: /Turn company context|JAK Shield/i },
  { file: '02-company-os.png', route: '/', section: '#company-os', expected: /company OS|evidence|drift|spec/i },
  { file: '03-workspace.png', route: '/workspace', expected: /workspace|cockpit|JAK/i },
  { file: '04-approvals-inbox.png', route: '/inbox', expected: /inbox|approval/i },
  { file: '05-audit.png', route: '/audit', expected: /audit/i },
  { file: '06-integrations.png', route: '/integrations', expected: /integration|connector/i },
];

test.describe('YC demo screenshot capture', () => {
  test.beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
  });

  for (const shot of shots) {
    test(`capture ${shot.file}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(shot.route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      if ('section' in shot && shot.section) {
        await page.locator(shot.section).scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
      }

      const visibleText = await page.locator('body').innerText({ timeout: 10_000 });
      expect(visibleText).toMatch(shot.expected);

      await page.screenshot({
        path: path.join(outDir, shot.file),
        fullPage: false,
      });
    });
  }
});
