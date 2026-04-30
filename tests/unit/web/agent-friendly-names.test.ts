/**
 * Phase 1B — agent friendly-name mapper.
 *
 * Maps internal AgentRole enum codes (WORKER_MARKETING, WORKER_CODER,
 * etc.) to layman-friendly executive-team labels (CMO Agent, CTO
 * Agent) for the cockpit. Brief: users see "CMO Agent is reviewing
 * Instagram", NOT "WORKER_MARKETING".
 */
import { describe, it, expect } from 'vitest';
import {
  getAgentFriendlyName,
  getAgentFriendlyLabel,
} from '../../../apps/web/src/lib/agent-friendly-names';

describe('getAgentFriendlyName', () => {
  it('maps marketing-flavored workers to CMO Agent labels', () => {
    expect(getAgentFriendlyName('WORKER_MARKETING').label).toBe('CMO Agent');
    expect(getAgentFriendlyName('WORKER_GROWTH').label).toContain('CMO Agent');
    expect(getAgentFriendlyName('WORKER_PR').label).toContain('CMO Agent');
    expect(getAgentFriendlyName('WORKER_SEO').label).toContain('CMO Agent');
    expect(getAgentFriendlyName('WORKER_CONTENT').label).toContain('CMO Agent');
  });

  it('maps engineering workers to CTO Agent labels', () => {
    expect(getAgentFriendlyName('WORKER_CODER').label).toBe('CTO Agent');
    expect(getAgentFriendlyName('WORKER_TECHNICAL').label).toContain('CTO Agent');
    expect(getAgentFriendlyName('WORKER_APP_DEPLOYER').label).toContain('CTO Agent');
  });

  it('maps strategist to CEO Agent', () => {
    expect(getAgentFriendlyName('WORKER_STRATEGIST').label).toBe('CEO Agent');
  });

  it('maps finance to CFO Agent', () => {
    expect(getAgentFriendlyName('WORKER_FINANCE').label).toBe('CFO Agent');
  });

  it('maps ops to COO Agent', () => {
    expect(getAgentFriendlyName('WORKER_OPS').label).toBe('COO Agent');
  });

  it('case-insensitive on input', () => {
    expect(getAgentFriendlyName('worker_marketing').label).toBe('CMO Agent');
  });

  it('falls back gracefully on unknown roles (never returns the raw enum code)', () => {
    const unknown = getAgentFriendlyName('WORKER_BRAND_NEW_THING');
    // Must NOT echo the raw enum code with WORKER_ prefix in the visible label.
    expect(unknown.label.startsWith('WORKER_')).toBe(false);
    expect(unknown.label).toContain('Agent');
  });

  it('null / undefined → safe fallback', () => {
    expect(getAgentFriendlyName(null).label).toBe('JAK Agent');
    expect(getAgentFriendlyName(undefined).label).toBe('JAK Agent');
  });

  it('every friendly label has a non-empty description', () => {
    const samples = [
      'COMMANDER',
      'PLANNER',
      'WORKER_MARKETING',
      'WORKER_CODER',
      'WORKER_STRATEGIST',
      'WORKER_FINANCE',
    ];
    for (const role of samples) {
      const fn = getAgentFriendlyName(role);
      expect(fn.description, `${role}.description`).toBeTruthy();
      expect(fn.label, `${role}.label`).toBeTruthy();
    }
  });

  it('getAgentFriendlyLabel is the bare-label shorthand', () => {
    expect(getAgentFriendlyLabel('WORKER_MARKETING')).toBe('CMO Agent');
  });
});
