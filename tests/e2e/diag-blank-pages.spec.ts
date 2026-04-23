/**
 * Diagnostic: Builder, Knowledge, Settings all render blank <main>.
 * Capture console errors + unhandled network errors to find why.
 */
import { test } from '@playwright/test';

const EMAIL = process.env['E2E_AUTH_EMAIL']!;
const PASSWORD = process.env['E2E_AUTH_PASSWORD']!;

test('diag: blank pages on /builder /knowledge /settings', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`[pageerror] ${err.message}\n${err.stack?.slice(0, 300)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) {
      networkErrors.push(`[${r.status()}] ${r.url().slice(0, 200)}`);
    }
  });

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/(login|register)/.test(u.pathname), { timeout: 20_000 });
  await page.waitForTimeout(2500);

  // Clear prior state
  consoleErrors.length = 0;
  networkErrors.length = 0;

  const targets = ['/builder', '/knowledge', '/settings'];
  for (const path of targets) {
    consoleErrors.length = 0;
    networkErrors.length = 0;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const mainHtml = await page.locator('main').first().innerHTML().catch(() => '<main-not-found>');
    const mainText = await page.locator('main').first().innerText().catch(() => '');

    console.log(`\n=== ${path} ===`);
    console.log(`MAIN_LENGTH: ${mainHtml.length} chars (text: ${mainText.length})`);
    console.log(`MAIN_HTML_START: ${mainHtml.slice(0, 400)}`);
    console.log(`CONSOLE_ERRORS (${consoleErrors.length}):`);
    for (const e of consoleErrors.slice(0, 5)) console.log(`  ${e.slice(0, 400)}`);
    console.log(`NETWORK_ERRORS (${networkErrors.length}):`);
    for (const e of networkErrors.slice(0, 10)) console.log(`  ${e}`);
  }

  await ctx.close();
});
