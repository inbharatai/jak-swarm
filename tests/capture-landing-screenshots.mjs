import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const screenshotDir = join(__dirname, '..', 'docs', 'screenshots');
mkdirSync(screenshotDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('Navigating to jakswarm.com...');
  await page.goto('https://www.jakswarm.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Screenshot 1: Full page
  console.log('Capturing full page...');
  await page.screenshot({ path: join(screenshotDir, '01-landing-full.png'), fullPage: true });

  // Screenshot 2: Hero section
  console.log('Capturing hero...');
  await page.screenshot({ path: join(screenshotDir, '02-landing-hero.png'), clip: { x: 0, y: 0, width: 1440, height: 900 } });

  // Scroll to live demo and capture
  console.log('Capturing live demo section...');
  const demoEl = await page.$('[aria-label="Live execution demo"]');
  if (demoEl) {
    await demoEl.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(screenshotDir, '03-landing-live-demo.png'), clip: { x: 0, y: await page.evaluate(() => window.scrollY), width: 1440, height: 900 } });
  }

  await browser.close();
  console.log('Screenshots saved to docs/screenshots/');
})();
