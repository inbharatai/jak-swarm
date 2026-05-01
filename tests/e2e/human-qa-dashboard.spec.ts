/**
 * Human QA — dashboard sweep.
 *
 * Walks every dashboard surface a logged-in user encounters, slowly,
 * with screenshots before/after each major action and explicit
 * checks for:
 *   - layout overflow at mobile
 *   - empty-state copy quality
 *   - broken buttons / silent failures
 *   - dashboard claims vs landing claims (product-truth gap)
 *   - console + network errors
 *
 * Uses the dev auth bypass (NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS=1) so the
 * test can reach the protected pages without a real Supabase session.
 */

import { test, expect } from '@playwright/test';
import { HumanQATester } from '../human-qa/HumanQATester.js';
import * as path from 'node:path';

const REPORT_ROOT = path.resolve(__dirname, '../../qa/human-qa-reports');

const PAGES = [
  { name: 'workspace',      path: '/workspace',      heading: /workspace|cockpit|chat|JAK/i },
  { name: 'social-drafts',  path: '/social-drafts',  heading: /social drafts/i },
  { name: 'tool-installer', path: '/tool-installer', heading: /tool installer/i },
  { name: 'standing-orders',path: '/standing-orders',heading: /standing orders/i },
  { name: 'audit',          path: '/audit',          heading: /audit/i },
  { name: 'integrations',   path: '/integrations',   heading: /integration/i },
  { name: 'knowledge',      path: '/knowledge',      heading: /knowledge|documents/i },
  { name: 'skills',         path: '/skills',         heading: /skill/i },
  { name: 'inbox',          path: '/inbox',          heading: /inbox|approval/i },
  { name: 'schedules',      path: '/schedules',      heading: /schedule/i },
];

test.describe.configure({ mode: 'serial' });

test.describe('HumanQA — dashboard sweep', () => {
  for (const p of PAGES) {
    test(`${p.name} renders + responsive + healthy`, async ({ page }) => {
      const qa = new HumanQATester(page, {
        name: `dashboard-${p.name}`,
        screenshotsDir: path.join(REPORT_ROOT, `dashboard-${p.name}`, 'shots'),
        paceMs: 250,
      });
      await qa.start();

      await page.goto(p.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);

      // 1. Page renders SOMETHING — at minimum an h1/h2.
      const heading = page.locator('h1, h2').first();
      const headingText = (await heading.innerText().catch(() => '')) ?? '';
      qa.compareClaim({
        claim: `${p.path} renders heading matching ${p.heading}`,
        observed: headingText.slice(0, 80) || '(no heading found)',
        matches: p.heading.test(headingText),
        section: p.name,
      });

      // 2. Confirm we didn't get redirected to login (i.e. dev bypass worked).
      const finalUrl = page.url();
      qa.compareClaim({
        claim: `${p.path} reachable without bouncing to /login`,
        observed: finalUrl,
        matches: !finalUrl.includes('/login'),
        section: `${p.name}-auth`,
      });

      // 3. Screenshot the page in its initial state.
      await qa.observeSection(p.name, { selector: 'main, body' });

      // 4. Health: any console errors / failed network requests.
      await qa.checkHealth();

      // 5. Responsive sweep — mobile / tablet / desktop overflow.
      await qa.checkResponsive();

      // 6. Produce evidence package.
      const { mdPath } = await qa.finalize();
      console.log(`[human-qa] ${p.name}: ${mdPath}`);

      // The Playwright test only fails if the page fundamentally crashed.
      expect(headingText.length, `${p.name} must render at least one heading`).toBeGreaterThan(0);
    });
  }
});
