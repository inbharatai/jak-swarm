import { describe, expect, it } from 'vitest';
import {
  classifyProviderError,
  shouldFailover,
} from '../../../packages/agents/src/base/provider-router.js';

function errWithStatus(message: string, status?: number): Error {
  const e = new Error(message) as Error & { status?: number };
  if (typeof status === 'number') e.status = status;
  return e;
}

describe('classifyProviderError', () => {
  it('recognises rate limit (429)', () => {
    expect(classifyProviderError(errWithStatus('rate limit', 429))).toBe('rate_limit');
    expect(classifyProviderError(errWithStatus('too many requests'))).toBe('rate_limit');
  });

  it('recognises server errors (5xx)', () => {
    expect(classifyProviderError(errWithStatus('bad gateway', 502))).toBe('server_error');
    expect(classifyProviderError(errWithStatus('service unavailable', 503))).toBe('server_error');
    expect(classifyProviderError(errWithStatus('provider overloaded'))).toBe('server_error');
  });

  it('recognises timeouts', () => {
    expect(classifyProviderError(errWithStatus('Request timed out'))).toBe('timeout');
    expect(classifyProviderError(errWithStatus('ETIMEDOUT'))).toBe('timeout');
  });

  it('recognises auth errors (401/403)', () => {
    expect(classifyProviderError(errWithStatus('unauthorized', 401))).toBe('auth_error');
    expect(classifyProviderError(errWithStatus('forbidden', 403))).toBe('auth_error');
    expect(classifyProviderError(errWithStatus('invalid_api_key'))).toBe('auth_error');
  });

  it('recognises model-not-found as distinct from generic 404', () => {
    expect(classifyProviderError(errWithStatus('model not found: foo', 404))).toBe('model_not_found');
    expect(classifyProviderError(errWithStatus('the model does not exist'))).toBe('model_not_found');
    expect(classifyProviderError(errWithStatus('deployment not found', 404))).toBe('model_not_found');
    // Generic 404 without model context → config_error
    expect(classifyProviderError(errWithStatus('not found', 404))).toBe('config_error');
  });

  it('recognises bad requests (400)', () => {
    expect(classifyProviderError(errWithStatus('bad request', 400))).toBe('bad_request');
    expect(classifyProviderError(errWithStatus('invalid request body'))).toBe('bad_request');
  });

  it('falls back to unknown for unrecognised errors', () => {
    expect(classifyProviderError(errWithStatus('some unusual network glitch'))).toBe('unknown');
    expect(classifyProviderError('not an error instance')).toBe('unknown');
  });
});

describe('shouldFailover policy', () => {
  it('fails over on transient/provider-scoped kinds', () => {
    expect(shouldFailover('rate_limit')).toBe(true);
    expect(shouldFailover('server_error')).toBe(true);
    expect(shouldFailover('timeout')).toBe(true);
  });

  it('does NOT fail over on kinds that indicate misconfiguration', () => {
    expect(shouldFailover('auth_error')).toBe(false);
    expect(shouldFailover('config_error')).toBe(false);
    expect(shouldFailover('model_not_found')).toBe(false);
    expect(shouldFailover('bad_request')).toBe(false);
  });

  it('does NOT fail over on unknown (safer default)', () => {
    expect(shouldFailover('unknown')).toBe(false);
  });
});
