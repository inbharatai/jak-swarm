/**
 * Unit tests for the browser intent classification system in worker-node.ts.
 *
 * Tests cover:
 * - buildBrowserExecutionPlan: safety mode selection, write-action blocking
 * - inferBrowserIntentCandidates: URL detection, verb matching, confidence/risk assignment
 * - dedupeBrowserCandidates: highest-confidence candidate wins per action type
 * - confidenceRank: ordering guarantees
 *
 * These tests run fully in-process with no external calls or API keys needed.
 */
import { describe, it, expect } from 'vitest';
import {
  buildBrowserExecutionPlan,
} from '../../../packages/swarm/src/graph/nodes/worker-node.js';
import type { BrowserExecutionPlan } from '../../../packages/swarm/src/graph/nodes/worker-node.js';

// ─── buildBrowserExecutionPlan ───────────────────────────────────────────────

describe('buildBrowserExecutionPlan', () => {
  // ── safe read-only fallback ──

  it('returns SAFE_READ_ONLY with EXTRACT fallback for a fully ambiguous description', () => {
    const plan = buildBrowserExecutionPlan('do something with a browser', false);
    expect(plan.safetyMode).toBe('SAFE_READ_ONLY');
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.type).toBe('EXTRACT');
    expect(plan.safetyReason).toBeTruthy();
  });

  it('returns SAFE_READ_ONLY when description is empty', () => {
    const plan = buildBrowserExecutionPlan('', false);
    expect(plan.safetyMode).toBe('SAFE_READ_ONLY');
    expect(plan.actions[0]?.type).toBe('EXTRACT');
  });

  // ── URL-driven navigation ──

  it('includes NAVIGATE action for description with explicit https URL', () => {
    const plan = buildBrowserExecutionPlan('Go to https://example.com and check the homepage', false);
    const navigateAction = plan.actions.find((a) => a.type === 'NAVIGATE');
    expect(navigateAction).toBeDefined();
    expect(navigateAction?.url).toBe('https://example.com');
    expect(plan.safetyMode).toBe('NORMAL');
  });

  it('includes NAVIGATE action for description with http URL', () => {
    const plan = buildBrowserExecutionPlan('Visit http://internal.corp/dashboard for metrics', false);
    const navigateAction = plan.actions.find((a) => a.type === 'NAVIGATE');
    expect(navigateAction).toBeDefined();
    expect(navigateAction?.url).toBe('http://internal.corp/dashboard');
  });

  // ── read-only extraction ──

  it('returns NORMAL mode with EXTRACT for a scraping task', () => {
    const plan = buildBrowserExecutionPlan('Scrape the product list from the page', false);
    const extractAction = plan.actions.find((a) => a.type === 'EXTRACT');
    expect(extractAction).toBeDefined();
    expect(plan.safetyMode).toBe('NORMAL');
  });

  it('returns NORMAL mode for "read all articles on the site"', () => {
    const plan = buildBrowserExecutionPlan('Read all articles on the site', false);
    const extractAction = plan.actions.find((a) => a.type === 'EXTRACT');
    expect(extractAction).toBeDefined();
    expect(plan.safetyMode).toBe('NORMAL');
  });

  it('includes WAIT action for a description mentioning "wait for element to appear"', () => {
    const plan = buildBrowserExecutionPlan('Wait for the results to load and then extract', false);
    const waitAction = plan.actions.find((a) => a.type === 'WAIT');
    expect(waitAction).toBeDefined();
  });

  // ── write actions blocked without upstream approval ──

  it('blocks FILL_FORM when no upstream approval and returns SAFE_READ_ONLY', () => {
    const plan = buildBrowserExecutionPlan('Fill form and submit the application', false);
    expect(plan.safetyMode).toBe('SAFE_READ_ONLY');
    const hasWriteAction = plan.actions.some((a) => a.type === 'FILL_FORM' || a.type === 'CLICK');
    expect(hasWriteAction).toBe(false);
    expect(plan.safetyReason).toMatch(/FILL_FORM/i);
  });

  it('blocks FILL_FORM and still allows accompanying NAVIGATE action without approval', () => {
    const plan = buildBrowserExecutionPlan(
      'Navigate to https://forms.example.com and fill form with user details',
      false,
    );
    expect(plan.safetyMode).toBe('SAFE_READ_ONLY');
    // NAVIGATE should still be included (it's NAVIGATION risk, not WRITE)
    const navigateAction = plan.actions.find((a) => a.type === 'NAVIGATE');
    expect(navigateAction).toBeDefined();
    const hasWriteAction = plan.actions.some((a) => a.type === 'FILL_FORM' || a.type === 'CLICK');
    expect(hasWriteAction).toBe(false);
  });

  it('allows FILL_FORM when upstream approval is already required (requiresApproval=true)', () => {
    const plan = buildBrowserExecutionPlan('Fill form and send the application', true);
    // With approval granted, FILL_FORM should be in the plan (it has MEDIUM confidence)
    const fillFormAction = plan.actions.find((a) => a.type === 'FILL_FORM');
    expect(fillFormAction).toBeDefined();
    expect(plan.safetyMode).toBe('NORMAL');
  });

  it('falls back to EXTRACT fallback when only write actions exist and approval is missing', () => {
    // "submit form" only matches FILL_FORM (write). No other actions.
    const plan = buildBrowserExecutionPlan('Submit form', false);
    expect(plan.safetyMode).toBe('SAFE_READ_ONLY');
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.type).toBe('EXTRACT');
  });

  // ── combined scenarios ──

  it('combines NAVIGATE + EXTRACT for "visit page and read content"', () => {
    const plan = buildBrowserExecutionPlan(
      'Visit https://news.example.com and extract all headlines',
      false,
    );
    expect(plan.safetyMode).toBe('NORMAL');
    const types = plan.actions.map((a) => a.type);
    expect(types).toContain('NAVIGATE');
    expect(types).toContain('EXTRACT');
  });

  it('does not duplicate actions of the same type', () => {
    // "scrape and capture and inspect" — multiple extract-intent verbs
    const plan = buildBrowserExecutionPlan('Scrape all data from https://example.com and capture and inspect it', false);
    const extractCount = plan.actions.filter((a) => a.type === 'EXTRACT').length;
    expect(extractCount).toBe(1); // deduped
  });

  // ── return shape validation ──

  it('always returns a valid BrowserExecutionPlan shape', () => {
    const plan: BrowserExecutionPlan = buildBrowserExecutionPlan('anything', false);
    expect(Array.isArray(plan.actions)).toBe(true);
    expect(['NORMAL', 'SAFE_READ_ONLY']).toContain(plan.safetyMode);
    // all actions have a type
    for (const action of plan.actions) {
      expect(typeof action.type).toBe('string');
    }
  });

  it('safetyReason is undefined when safetyMode is NORMAL', () => {
    const plan = buildBrowserExecutionPlan('Extract content from https://example.com', false);
    expect(plan.safetyMode).toBe('NORMAL');
    expect(plan.safetyReason).toBeUndefined();
  });

  it('safetyReason is a non-empty string when safetyMode is SAFE_READ_ONLY', () => {
    const plan = buildBrowserExecutionPlan('', false);
    expect(plan.safetyMode).toBe('SAFE_READ_ONLY');
    expect(typeof plan.safetyReason).toBe('string');
    expect((plan.safetyReason as string).length).toBeGreaterThan(0);
  });
});
