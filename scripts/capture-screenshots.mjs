/**
 * Capture landing page screenshots for README using Playwright.
 * Run from project root: node scripts/capture-screenshots.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, '..', 'docs');
const BASE_URL = process.argv[2] || 'http://localhost:6007';

mkdirSync(DOCS_DIR, { recursive: true });

async function capture() {
  const browser = await chromium.launch({ headless: true });

  // Desktop viewport
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });

  // Mobile viewport
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true,
  });

  // ── Desktop screenshots ──────────────────────────────────────────────
  const page = await desktopContext.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for hero animation to settle
  await page.waitForTimeout(2000);

  // 1. Full page screenshot
  console.log('Capturing full page (desktop)...');
  await page.screenshot({
    path: join(DOCS_DIR, 'jak-swarm-full-page.png'),
    fullPage: true,
  });

  // 2. Hero section (above the fold)
  console.log('Capturing hero...');
  await page.screenshot({
    path: join(DOCS_DIR, 'screenshot-hero.png'),
    clip: { x: 0, y: 0, width: 1440, height: 900 },
  });

  // 3. Scroll to orchestration engine and capture
  console.log('Capturing orchestration engine...');
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Orchestration Engine Visualization"]');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(2500); // Let animation cycle
  await page.screenshot({
    path: join(DOCS_DIR, 'screenshot-orchestration.png'),
    clip: { x: 0, y: await page.evaluate(() => window.scrollY), width: 1440, height: 900 },
  });

  // 4. Scroll to execution flow
  console.log('Capturing execution flow...');
  await page.evaluate(() => {
    const el = document.querySelector('#execution-flow');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: join(DOCS_DIR, 'screenshot-execution-flow.png'),
    clip: { x: 0, y: await page.evaluate(() => window.scrollY), width: 1440, height: 900 },
  });

  // 5. Scroll to capability map
  console.log('Capturing capability map...');
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Capability Architecture Map"]');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: join(DOCS_DIR, 'screenshot-capability-map.png'),
    clip: { x: 0, y: await page.evaluate(() => window.scrollY), width: 1440, height: 900 },
  });

  // 6. Scroll to live demo
  console.log('Capturing live demo...');
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Live execution demo"]');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(3000); // Let demo steps play
  await page.screenshot({
    path: join(DOCS_DIR, 'screenshot-live-demo.png'),
    clip: { x: 0, y: await page.evaluate(() => window.scrollY), width: 1440, height: 900 },
  });

  // 7. Pricing section
  console.log('Capturing pricing...');
  await page.evaluate(() => {
    const el = document.querySelector('#pricing');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: join(DOCS_DIR, 'screenshot-pricing.png'),
    clip: { x: 0, y: await page.evaluate(() => window.scrollY), width: 1440, height: 900 },
  });

  // ── Mobile screenshots ───────────────────────────────────────────────
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await mobilePage.waitForTimeout(2000);

  // 8. Mobile hero
  console.log('Capturing mobile hero...');
  await mobilePage.screenshot({
    path: join(DOCS_DIR, 'screenshot-mobile-hero.png'),
    clip: { x: 0, y: 0, width: 390, height: 844 },
  });

  // 9. Mobile full page
  console.log('Capturing mobile full page...');
  await mobilePage.screenshot({
    path: join(DOCS_DIR, 'screenshot-mobile-full.png'),
    fullPage: true,
  });

  await browser.close();
  console.log('\nAll screenshots saved to docs/');
}

capture().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
