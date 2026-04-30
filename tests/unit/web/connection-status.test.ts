/**
 * Phase 1A — connection status normalizer.
 *
 * Maps the back-end's free-form `Integration.status` string into the
 * brief's layman taxonomy: Connected / Not connected / Expired /
 * Permission needed / Coming soon. The taxonomy is what users see
 * on the dashboard cards.
 */
import { describe, it, expect } from 'vitest';
import { normalizeConnectionStatus } from '../../../apps/web/src/lib/connection-status';

describe('normalizeConnectionStatus', () => {
  it('CONNECTED variants map to Connected', () => {
    expect(normalizeConnectionStatus('CONNECTED').status).toBe('CONNECTED');
    expect(normalizeConnectionStatus('connected').status).toBe('CONNECTED');
    expect(normalizeConnectionStatus('ACTIVE').status).toBe('CONNECTED');
    expect(normalizeConnectionStatus('AUTHORIZED').status).toBe('CONNECTED');
  });

  it('expired-token variants map to Reconnect needed (warning tone)', () => {
    expect(normalizeConnectionStatus('EXPIRED').status).toBe('EXPIRED');
    expect(normalizeConnectionStatus('TOKEN_EXPIRED').status).toBe('EXPIRED');
    expect(normalizeConnectionStatus('REFRESH_FAILED').status).toBe('EXPIRED');
    expect(normalizeConnectionStatus('EXPIRED').label).toBe('Reconnect needed');
    expect(normalizeConnectionStatus('EXPIRED').tone).toBe('warning');
  });

  it('permission variants map to Permission needed', () => {
    expect(normalizeConnectionStatus('PERMISSION_NEEDED').status).toBe('PERMISSION_NEEDED');
    expect(normalizeConnectionStatus('INSUFFICIENT_SCOPE').status).toBe('PERMISSION_NEEDED');
    expect(normalizeConnectionStatus('PERMISSION_DENIED').status).toBe('PERMISSION_NEEDED');
    expect(normalizeConnectionStatus('SCOPE_MISSING').status).toBe('PERMISSION_NEEDED');
  });

  it('error/failed variants surface as connection error', () => {
    expect(normalizeConnectionStatus('ERROR').label).toBe('Connection error');
    expect(normalizeConnectionStatus('ERROR').tone).toBe('error');
    expect(normalizeConnectionStatus('FAILED').label).toBe('Connection error');
  });

  it('null / undefined / empty / unknown → Not connected', () => {
    expect(normalizeConnectionStatus(null).status).toBe('NOT_CONNECTED');
    expect(normalizeConnectionStatus(undefined).status).toBe('NOT_CONNECTED');
    expect(normalizeConnectionStatus('').status).toBe('NOT_CONNECTED');
    expect(normalizeConnectionStatus('DISCONNECTED').status).toBe('NOT_CONNECTED');
    expect(normalizeConnectionStatus('SOMETHING_NEW').status).toBe('NOT_CONNECTED');
  });

  it('knownButUnconfigured option overrides everything to Coming soon', () => {
    const display = normalizeConnectionStatus('CONNECTED', { knownButUnconfigured: true });
    expect(display.status).toBe('COMING_SOON');
    expect(display.label).toBe('Coming soon');
    expect(display.tone).toBe('neutral');
  });
});
