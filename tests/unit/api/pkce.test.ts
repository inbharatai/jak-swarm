import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  generateCodeVerifier,
  deriveCodeChallenge,
  generateStateToken,
} from '../../../apps/api/src/utils/pkce.js';

// ─── PKCE & CSRF helpers (RFC 7636) ────────────────────────────────────
// These pin the three primitives that the OAuth authorize route relies on.
// If any of them drifts (wrong char set, wrong hash algo, too-short length)
// Google silently rejects the token exchange and the user lands on an
// error-redirect. Drift here is catastrophic but very easy to miss, so
// we nail down the properties with deterministic assertions.

describe('generateCodeVerifier', () => {
  it('produces a base64url-safe string of the RFC-required length', () => {
    const v = generateCodeVerifier();
    // 32 random bytes → 43-char base64url (no padding)
    expect(v).toHaveLength(43);
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });

  it('generates a new value on every call (high entropy)', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 100; i++) samples.add(generateCodeVerifier());
    expect(samples.size).toBe(100);
  });
});

describe('deriveCodeChallenge', () => {
  it('returns BASE64URL(SHA256(verifier)) per RFC 7636 §4.2', () => {
    const verifier = 'test-verifier-value-that-is-long-enough-to-be-valid';
    const expected = createHash('sha256')
      .update(verifier, 'utf8')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(deriveCodeChallenge(verifier)).toBe(expected);
  });

  it('is deterministic for the same input', () => {
    const v = 'deterministic-verifier';
    expect(deriveCodeChallenge(v)).toBe(deriveCodeChallenge(v));
  });

  it('produces base64url output with no padding and no non-url chars', () => {
    const out = deriveCodeChallenge(generateCodeVerifier());
    expect(out).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(out).not.toMatch(/=/);
    expect(out).not.toMatch(/[+/]/);
  });

  it('produces a 43-char challenge for SHA256 output', () => {
    // SHA256 = 32 bytes = 43 base64url chars (no padding)
    expect(deriveCodeChallenge('anything')).toHaveLength(43);
  });
});

describe('generateStateToken', () => {
  it('returns a sufficiently long unguessable token', () => {
    const s = generateStateToken();
    // 24 random bytes → 32-char base64url
    expect(s).toHaveLength(32);
    expect(s).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('is unique across many calls', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 500; i++) samples.add(generateStateToken());
    expect(samples.size).toBe(500);
  });
});
