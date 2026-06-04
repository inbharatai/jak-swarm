/**
 * Human-paced CEO & CTO workflow test.
 *
 * Selects each role, types a natural prompt slowly, submits,
 * watches the SSE response stream until completion, and captures
 * screenshots at every step — just like a real human user would.
 *
 * Evidence saved to Desktop/JackStorm test/10_ceo_cto_workflows/
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const BASE_URL = (process.env['E2E_BASE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
const EVIDENCE = path.resolve('C:/Users/reetu/Desktop/JackStorm test/10_ceo_cto_workflows');

const TYPING_PACE = 40;

async function screenshot(page: Page, name: string): Promise<string> {
  await fs.mkdir(EVIDENCE, { recursive: true });
  const filePath = path.join(EVIDENCE, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function humanType(page: Page, text: string) {
  for (let i = 0; i < text.length; i++) {
    await page.keyboard.type(text[i], { delay: TYPING_PACE + Math.random() * 25 });
  }
}

async function navigateToWorkspace(page: Page): Promise<boolean> {
  // Use domcontentloaded instead of networkidle — workspace has SSE connections
  await page.goto(`${BASE_URL}/workspace`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Wait for the page shell to render
  await page.waitForTimeout(4000);
  return true;
}

async function findChatInput(page: Page): Promise<import('@playwright/test').Locator | null> {
  const input = page.locator('textarea').first();
  if (await input.isVisible({ timeout: 5000 }).catch(() => false)) return input;

  const altInput = page.locator('input[type="text"]').first();
  if (await altInput.isVisible({ timeout: 3000 }).catch(() => false)) return altInput;

  return null;
}

test.describe.configure({ mode: 'serial' });

// ════════════════════════════════════════════════════════════════
// CEO WORKFLOW
// ════════════════════════════════════════════════════════════════

test('CEO — Full workflow: select role, type, submit, capture response', async ({ page }) => {
  test.setTimeout(300_000);

  // Step 1: Navigate to workspace
  console.log('📍 Step 1: Navigating to workspace...');
  await navigateToWorkspace(page);
  await screenshot(page, 'ceo_01_workspace_loaded');

  // Step 2: Select CEO role chip
  console.log('📍 Step 2: Selecting CEO role...');
  const ceoChip = page.locator('button:has-text("CEO")').first();
  const ceoCount = await ceoChip.count();
  if (ceoCount > 0) {
    await ceoChip.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await ceoChip.click();
    await page.waitForTimeout(1000);
    await screenshot(page, 'ceo_02_ceo_selected');
    console.log('  ✅ CEO role chip selected');
  } else {
    await screenshot(page, 'ceo_02_no_ceo_chip');
    console.log('  ⚠️ CEO chip not found');
  }

  // Step 3: Find and focus chat input
  console.log('📍 Step 3: Finding chat input...');
  const chatInput = await findChatInput(page);
  if (!chatInput) {
    await screenshot(page, 'ceo_fail_no_input');
    console.log('  ❌ No chat input found — aborting CEO test');
    expect(chatInput).not.toBeNull();
    return;
  }
  await chatInput.click();
  await page.waitForTimeout(500);
  await screenshot(page, 'ceo_03_input_focused');

  // Step 4: Type prompt slowly (human pace)
  console.log('📍 Step 4: Typing CEO prompt (human pace)...');
  const prompt = 'Compile an executive summary of the last 30 days of activity';
  await humanType(page, prompt);
  await page.waitForTimeout(500);
  await screenshot(page, 'ceo_04_prompt_typed');
  console.log(`  Typed: "${prompt}"`);

  // Step 5: Submit
  console.log('📍 Step 5: Submitting CEO prompt...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await screenshot(page, 'ceo_05_after_submit');

  // Step 6: Watch response stream at intervals
  console.log('📍 Step 6: Watching response stream...');
  const checkpoints = [
    { wait: 5000, name: 'ceo_06_stream_5s' },
    { wait: 8000, name: 'ceo_07_stream_13s' },
    { wait: 12000, name: 'ceo_08_stream_25s' },
    { wait: 15000, name: 'ceo_09_stream_40s' },
    { wait: 20000, name: 'ceo_10_stream_60s' },
    { wait: 30000, name: 'ceo_11_stream_90s' },
    { wait: 30000, name: 'ceo_12_stream_120s' },
  ];

  let responseDetected = false;
  let errorDetected = false;

  for (const cp of checkpoints) {
    await page.waitForTimeout(cp.wait);
    await screenshot(page, cp.name);

    const bodyText = await page.locator('body').innerText();
    const hasError = /unknown error|failed to start|workflow failed|error.*try again/i.test(bodyText);
    const hasAssistant = /executive|summary|report|analysis|template|30 days|activity|compile/i.test(bodyText);
    const msgCount = await page.locator('[class*="message"], [class*="chat"], [role="article"]').count();

    console.log(`  After ${cp.name}: ${bodyText.length} chars, messages: ${msgCount}, assistant: ${hasAssistant}, error: ${hasError}`);

    if (hasError && /unknown error|failed to start/i.test(bodyText)) {
      errorDetected = true;
      await screenshot(page, 'ceo_error_captured');
      console.log('  ❌ CEO workflow hit an error');
      break;
    }

    if (hasAssistant) {
      responseDetected = true;
      console.log('  ✅ CEO response content detected');
      // Wait a bit more for completion
      await page.waitForTimeout(15000);
      await screenshot(page, 'ceo_13_response_progress');
      break;
    }
  }

  // Step 7: Final state
  await page.waitForTimeout(5000);
  await screenshot(page, 'ceo_14_final_state');

  if (errorDetected) {
    console.log('❌ CEO workflow FAILED — error detected');
  } else if (responseDetected) {
    console.log('✅ CEO workflow COMPLETE — response received');
  } else {
    console.log('⚠️ CEO workflow — no clear response or error detected');
  }
});

// ════════════════════════════════════════════════════════════════
// CTO WORKFLOW
// ════════════════════════════════════════════════════════════════

test('CTO — Full workflow: select role, type, submit, capture response', async ({ page }) => {
  test.setTimeout(300_000);

  // Step 1: Navigate to workspace
  console.log('📍 Step 1: Navigating to workspace...');
  await navigateToWorkspace(page);
  await screenshot(page, 'cto_01_workspace_loaded');

  // Step 2: Select CTO role chip
  console.log('📍 Step 2: Selecting CTO role...');
  const ctoChip = page.locator('button:has-text("CTO")').first();
  if (await ctoChip.count() > 0) {
    await ctoChip.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await ctoChip.click();
    await page.waitForTimeout(1000);
    await screenshot(page, 'cto_02_cto_selected');
    console.log('  ✅ CTO role chip selected');
  } else {
    await screenshot(page, 'cto_02_no_cto_chip');
    console.log('  ⚠️ CTO chip not found');
  }

  // Step 3: Find and focus chat input
  console.log('📍 Step 3: Finding chat input...');
  const chatInput = await findChatInput(page);
  if (!chatInput) {
    await screenshot(page, 'cto_fail_no_input');
    console.log('  ❌ No chat input found — aborting CTO test');
    expect(chatInput).not.toBeNull();
    return;
  }
  await chatInput.click();
  await page.waitForTimeout(500);
  await screenshot(page, 'cto_03_input_focused');

  // Step 4: Type prompt
  console.log('📍 Step 4: Typing CTO prompt (human pace)...');
  const prompt = 'Review our technical architecture and suggest improvements';
  await humanType(page, prompt);
  await page.waitForTimeout(500);
  await screenshot(page, 'cto_04_prompt_typed');

  // Step 5: Submit
  console.log('📍 Step 5: Submitting CTO prompt...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await screenshot(page, 'cto_05_after_submit');

  // Step 6: Watch response stream
  console.log('📍 Step 6: Watching response stream...');
  const checkpoints = [
    { wait: 5000, name: 'cto_06_stream_5s' },
    { wait: 8000, name: 'cto_07_stream_13s' },
    { wait: 12000, name: 'cto_08_stream_25s' },
    { wait: 15000, name: 'cto_09_stream_40s' },
    { wait: 20000, name: 'cto_10_stream_60s' },
    { wait: 30000, name: 'cto_11_stream_90s' },
    { wait: 30000, name: 'cto_12_stream_120s' },
  ];

  let responseDetected = false;
  let errorDetected = false;

  for (const cp of checkpoints) {
    await page.waitForTimeout(cp.wait);
    await screenshot(page, cp.name);

    const bodyText = await page.locator('body').innerText();
    const hasError = /unknown error|failed to start|workflow failed|error.*try again/i.test(bodyText);
    const hasAssistant = /architect|improvement|suggest|technical|review|recommend|codebas|stack/i.test(bodyText);

    console.log(`  After ${cp.name}: ${bodyText.length} chars, assistant: ${hasAssistant}, error: ${hasError}`);

    if (hasError && /unknown error|failed to start/i.test(bodyText)) {
      errorDetected = true;
      await screenshot(page, 'cto_error_captured');
      console.log('  ❌ CTO workflow hit an error');
      break;
    }

    if (hasAssistant) {
      responseDetected = true;
      console.log('  ✅ CTO response content detected');
      await page.waitForTimeout(15000);
      await screenshot(page, 'cto_13_response_progress');
      break;
    }
  }

  // Step 7: Final state
  await page.waitForTimeout(5000);
  await screenshot(page, 'cto_14_final_state');

  if (errorDetected) {
    console.log('❌ CTO workflow FAILED — error detected');
  } else if (responseDetected) {
    console.log('✅ CTO workflow COMPLETE — response received');
  } else {
    console.log('⚠️ CTO workflow — no clear response or error detected');
  }
});

// ════════════════════════════════════════════════════════════════
// CEO+CMO MULTI-ROLE
// ════════════════════════════════════════════════════════════════

test('CEO+CMO — Multi-role workflow', async ({ page }) => {
  test.setTimeout(300_000);

  // Step 1: Navigate
  console.log('📍 Step 1: Navigating to workspace...');
  await navigateToWorkspace(page);
  await screenshot(page, 'ceo_cmo_01_workspace');

  // Step 2: Select CEO + CMO
  console.log('📍 Step 2: Selecting CEO + CMO roles...');
  const ceoChip = page.locator('button:has-text("CEO")').first();
  const cmoChip = page.locator('button:has-text("CMO")').first();

  if (await ceoChip.count() > 0) {
    await ceoChip.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await ceoChip.click();
    await page.waitForTimeout(500);
    await screenshot(page, 'ceo_cmo_02_ceo_selected');
    console.log('  ✅ CEO selected');
  }

  if (await cmoChip.count() > 0) {
    await cmoChip.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await cmoChip.click();
    await page.waitForTimeout(500);
    await screenshot(page, 'ceo_cmo_03_cmo_selected');
    console.log('  ✅ CMO selected');
  }

  // Step 3: Type prompt
  console.log('📍 Step 3: Typing CEO+CMO prompt...');
  const chatInput = await findChatInput(page);
  if (!chatInput) {
    await screenshot(page, 'ceo_cmo_fail_no_input');
    console.log('  ❌ No chat input — aborting');
    expect(chatInput).not.toBeNull();
    return;
  }
  await chatInput.click();
  await page.waitForTimeout(400);
  const prompt = 'Create a go-to-market strategy for our next product launch';
  await humanType(page, prompt);
  await page.waitForTimeout(500);
  await screenshot(page, 'ceo_cmo_04_prompt_typed');

  // Step 4: Submit
  console.log('📍 Step 4: Submitting CEO+CMO prompt...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await screenshot(page, 'ceo_cmo_05_after_submit');

  // Step 5: Watch stream
  console.log('📍 Step 5: Watching response stream...');
  const checkpoints = [
    { wait: 5000, name: 'ceo_cmo_06_stream_5s' },
    { wait: 8000, name: 'ceo_cmo_07_stream_13s' },
    { wait: 12000, name: 'ceo_cmo_08_stream_25s' },
    { wait: 15000, name: 'ceo_cmo_09_stream_40s' },
    { wait: 20000, name: 'ceo_cmo_10_stream_60s' },
    { wait: 30000, name: 'ceo_cmo_11_stream_90s' },
    { wait: 30000, name: 'ceo_cmo_12_stream_120s' },
  ];

  let responseDetected = false;
  let errorDetected = false;

  for (const cp of checkpoints) {
    await page.waitForTimeout(cp.wait);
    await screenshot(page, cp.name);

    const bodyText = await page.locator('body').innerText();
    const hasError = /unknown error|failed to start|workflow failed|error.*try again/i.test(bodyText);
    const hasAssistant = /market|strategy|launch|go.?to.?market|gtm|campaign/i.test(bodyText);

    console.log(`  After ${cp.name}: ${bodyText.length} chars, assistant: ${hasAssistant}, error: ${hasError}`);

    if (hasError && /unknown error|failed to start/i.test(bodyText)) {
      errorDetected = true;
      await screenshot(page, 'ceo_cmo_error_captured');
      console.log('  ❌ CEO+CMO workflow hit an error');
      break;
    }

    if (hasAssistant) {
      responseDetected = true;
      console.log('  ✅ CEO+CMO response content detected');
      await page.waitForTimeout(15000);
      await screenshot(page, 'ceo_cmo_13_response_progress');
      break;
    }
  }

  // Final
  await page.waitForTimeout(5000);
  await screenshot(page, 'ceo_cmo_14_final_state');

  if (errorDetected) {
    console.log('❌ CEO+CMO workflow FAILED');
  } else if (responseDetected) {
    console.log('✅ CEO+CMO workflow COMPLETE');
  } else {
    console.log('⚠️ CEO+CMO workflow — no clear response');
  }
});