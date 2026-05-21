import { test, expect, type Page } from '@playwright/test';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { assertLocalOnlyOrThrow } from '../human-qa/assert-local-only.js';

const assetDir = path.resolve(__dirname, '../../qa/yc-demo-video/assets');
const publicAssetDir = path.resolve(__dirname, '../../qa/yc-demo-video/public/assets');

async function capture(page: Page, file: string) {
  const screenshotPath = path.join(assetDir, file);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  copyFileSync(screenshotPath, path.join(publicAssetDir, file));
}

test.describe.configure({ mode: 'serial' });

test.describe('Landing role claims and workspace role execution proof', () => {
  test.beforeAll(() => {
    assertLocalOnlyOrThrow();
    mkdirSync(assetDir, { recursive: true });
    mkdirSync(publicAssetDir, { recursive: true });
  });

  test('captures the landing page agent-access claims', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const pricingHeading = page.getByRole('heading', { name: /Transparent pricing\. Open-source core\./i });
    await pricingHeading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);

    await expect(pricingHeading).toBeVisible();
    await expect(page.getByText('5 core agents')).toBeVisible();
    await expect(page.getByText('All 38 specialist agents')).toBeVisible();
    await expect(page.getByText('All agents + custom skills')).toBeVisible();

    await capture(page, '07-landing-agent-claims.png');
  });

  test('captures CEO/CTO/CMO roles executing a local workflow command', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.removeItem('jak-conversations');
    });

    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('role-picker-bar')).toBeVisible();

    const roleBar = page.getByTestId('role-picker-bar');
    const cto = roleBar.getByRole('button', { name: 'CTO' });
    const ceo = roleBar.getByRole('button', { name: 'CEO' });
    const cmo = roleBar.getByRole('button', { name: 'CMO' });

    await expect(cto).toHaveAttribute('aria-pressed', 'true');
    await ceo.click();
    await cmo.click();
    await expect(ceo).toHaveAttribute('aria-pressed', 'true');
    await expect(cmo).toHaveAttribute('aria-pressed', 'true');

    await capture(page, '08-workspace-role-picker-proof.png');

    await page.getByTestId('chat-input-textarea').fill(
      'Leadership roundtable: review our YC positioning, technical architecture, and launch plan for design partners.',
    );
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText(/Workflow started/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/CEO Agent frames strategy/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/CTO Agent checks architecture/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/CMO Agent drafts positioning/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Local E2E proof complete/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Honest boundary:/i)).toBeVisible();

    await capture(page, '09-leadership-roundtable-proof.png');
  });

  test('captures the vibe-coding builder creating and generating a project locally', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/builder', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Builder' })).toBeVisible();
    await expect(page.getByText(/Build full-stack apps with AI/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();

    await capture(page, '10-vibe-builder-entry.png');

    await page.getByRole('button', { name: 'New Project' }).click();
    await expect(page.getByRole('heading', { name: 'New Project' })).toBeVisible();
    await page.getByPlaceholder('My Awesome App').fill('YC Alignment Builder');
    await page.getByPlaceholder(/task management app/i).fill('A local proof app for JAK Swarm vibe coding.');
    await page.getByRole('dialog').getByRole('button', { name: 'Create Project' }).click();

    await expect(page).toHaveURL(/\/builder\/project_local_demo_/);
    await expect(page.getByRole('heading', { name: 'YC Alignment Builder' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Describe what you want to build/i)).toBeVisible();

    const promptInput = page.getByPlaceholder('Describe your app...');
    await promptInput.fill('Build a polished YC landing page with a hero, proof cards, and an approval-safe call to action.');
    await capture(page, '11-vibe-builder-prompt-proof.png');
    await promptInput.press('Enter');

    await expect(page.getByText(/Local E2E builder proof complete/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Ready')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'page.tsx' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'package.json' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'README.md' })).toBeVisible();
    await page.waitForTimeout(2500);

    await capture(page, '12-vibe-builder-generated-proof.png');
  });
});
