/**
 * connector-health.test.ts — pins E2/A8: a unified, honest connector runtime-
 * health contract derivable from existing fields across all 22 connectors.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyConnectorHealth,
  buildConnectorHealth,
  type ConnectorHealthInput,
} from '../../../apps/api/src/services/company-brain/connector-health.js';

function inp(over: Partial<ConnectorHealthInput>): ConnectorHealthInput {
  return { provider: 'X', integrationStatus: 'CONNECTED', ...over };
}

describe('classifyConnectorHealth (E2/A8 unified contract)', () => {
  it('healthy: CONNECTED, no failures', () => {
    expect(classifyConnectorHealth(inp({}))).toBe('healthy');
  });
  it('degraded: 1-2 consecutive failures OR a recent error', () => {
    expect(classifyConnectorHealth(inp({ syncConsecutiveFailures: 1 }))).toBe('degraded');
    expect(classifyConnectorHealth(inp({ syncConsecutiveFailures: 2 }))).toBe('degraded');
    expect(classifyConnectorHealth(inp({ syncLastError: 'rate limited' }))).toBe('degraded');
  });
  it('down: >=3 consecutive failures', () => {
    expect(classifyConnectorHealth(inp({ syncConsecutiveFailures: 3 }))).toBe('down');
    expect(classifyConnectorHealth(inp({ syncConsecutiveFailures: 5 }))).toBe('down');
  });
  it('reauth_required: NEEDS_REAUTH', () => {
    expect(classifyConnectorHealth(inp({ integrationStatus: 'NEEDS_REAUTH' }))).toBe('reauth_required');
  });
  it('unconfigured: never connected / DISCONNECTED / missing', () => {
    expect(classifyConnectorHealth(inp({ integrationStatus: 'DISCONNECTED' }))).toBe('unconfigured');
    expect(classifyConnectorHealth(inp({ integrationStatus: null }))).toBe('unconfigured');
    expect(classifyConnectorHealth(inp({ integrationStatus: '' }))).toBe('unconfigured');
  });
  it('ERROR integration status -> down', () => {
    expect(classifyConnectorHealth(inp({ integrationStatus: 'ERROR' }))).toBe('down');
  });
});

describe('buildConnectorHealth snapshot', () => {
  it('builds a connected+healthy snapshot', () => {
    const h = buildConnectorHealth(inp({ syncLastSuccessAt: new Date('2026-07-14') }));
    expect(h.connected).toBe(true);
    expect(h.status).toBe('healthy');
    expect(h.consecutiveFailures).toBe(0);
  });
  it('builds an unconfigured snapshot for a never-connected connector', () => {
    const h = buildConnectorHealth({ provider: 'linear', integrationStatus: null });
    expect(h.connected).toBe(false);
    expect(h.status).toBe('unconfigured');
  });
});
