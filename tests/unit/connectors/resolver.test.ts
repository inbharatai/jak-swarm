/**
 * ConnectorResolver tests — pin the heuristic behavior so a future
 * LLM-driven upgrade doesn't silently regress on common phrasings.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  connectorRegistry,
  bootstrapConnectorRegistry,
  resolveConnectorsForTask,
} from '@jak-swarm/tools';

describe('resolveConnectorsForTask', () => {
  beforeEach(() => {
    (connectorRegistry as unknown as { __resetForTest: () => void }).__resetForTest();
    bootstrapConnectorRegistry();
  });

  it('returns Remotion as primary when the task explicitly names it', () => {
    const result = resolveConnectorsForTask('Render this comp with Remotion at 1080p');
    expect(result.primary?.connectorId).toBe('remotion');
    expect(result.primary?.confidence).toBe(1.0);
  });

  it('returns Remotion (high confidence) for "create a video"', () => {
    const result = resolveConnectorsForTask('Create a 30-second product demo video for our landing page');
    expect(result.primary?.connectorId).toBe('remotion');
    // 0.8 hits the "product demo video" pattern (an explainer/demo
    // pattern). The "create a video" generic pattern requires the
    // verb + noun adjacent (with optional "a"); this prompt has
    // adjectives between them so it falls through to the demo pattern.
    expect(result.primary!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('returns Remotion (high confidence) for "landing page to reel"', () => {
    const result = resolveConnectorsForTask('Convert our blog post to an Instagram reel');
    expect(result.primary?.connectorId).toBe('remotion');
  });

  it('returns Blender for 3D / .blend tasks', () => {
    const result = resolveConnectorsForTask('Inspect this Blender 3D scene and fix the materials');
    expect(result.primary?.connectorId).toBe('blender');
    expect(result.primary!.confidence).toBe(1.0);
  });

  it('returns Slack MCP for explicit Slack mentions', () => {
    const result = resolveConnectorsForTask('Post a message in our Slack #engineering channel');
    expect(result.primary?.connectorId).toBe('mcp-slack');
  });

  it('returns no primary for tasks with no connector signal', () => {
    const result = resolveConnectorsForTask('think about the meaning of life');
    expect(result.primary).toBeUndefined();
    expect(result.alternatives).toHaveLength(0);
  });

  it('sets isReady=false when primary is the registered Remotion (still in available status)', () => {
    // The bootstrap leaves Remotion in `available` status until install
    // + validation actually run. The resolver flags it accordingly so
    // the cockpit knows to surface "install on first use" guidance.
    const result = resolveConnectorsForTask('Render a Remotion video');
    expect(result.primary).toBeDefined();
    expect(result.primary!.isReady).toBe(false);
    expect(result.primary!.nextStep).toContain('Install');
  });

  it('sets isReady=false for Blender (needs_user_setup)', () => {
    const result = resolveConnectorsForTask('Open Blender and inspect the scene');
    expect(result.primary?.connectorId).toBe('blender');
    expect(result.primary!.isReady).toBe(false);
    // Next-step text should describe a manual setup step.
    expect(result.primary!.nextStep).toMatch(/Blender|MCP|install|download/i);
  });

  it('moves disabled connectors to unavailable[]', () => {
    // Disable Remotion explicitly; the resolver should not pick it as
    // primary even though the prompt is a perfect match.
    connectorRegistry.setStatus('remotion', 'disabled', 'tenant admin disabled');
    const result = resolveConnectorsForTask('Render with Remotion');
    expect(result.primary?.connectorId).not.toBe('remotion');
    expect(result.unavailable.some((c) => c.connectorId === 'remotion')).toBe(true);
  });

  it('moves blocked_by_policy connectors to unavailable[]', () => {
    connectorRegistry.setStatus('mcp-stripe', 'blocked_by_policy', 'industry pack blocks Stripe');
    const result = resolveConnectorsForTask('Charge a Stripe customer for the new invoice');
    expect(result.primary?.connectorId).not.toBe('mcp-stripe');
    expect(result.unavailable.some((c) => c.connectorId === 'mcp-stripe')).toBe(true);
  });

  it('caps alternatives by maxAlternatives', () => {
    // Use a task that hits multiple low-confidence patterns by being
    // generic + naming Slack explicitly.
    const result = resolveConnectorsForTask('Post a message in Slack and create a GitHub issue', {
      maxAlternatives: 1,
    });
    expect(result.alternatives.length).toBeLessThanOrEqual(1);
  });

  it('every candidate carries a non-empty reason for the dashboard', () => {
    const result = resolveConnectorsForTask('Create a YouTube short from our pitch deck');
    expect(result.primary).toBeDefined();
    expect(result.primary!.reason.length).toBeGreaterThan(10);
    for (const alt of result.alternatives) {
      expect(alt.reason.length).toBeGreaterThan(10);
    }
  });
});
