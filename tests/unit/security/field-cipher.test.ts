/**
 * field-cipher — Local Sprint 3 test suite.
 *
 * Asserts the AES-256-GCM at-rest cipher behaves correctly across:
 *   - the no-key passthrough mode (dev default)
 *   - the round-trip with a real key (encrypt → SQL-shaped envelope
 *     → decrypt → original plaintext)
 *   - the idempotent-on-encrypt + idempotent-on-decrypt contracts
 *   - tamper detection (GCM auth tag)
 *   - JSON-wrapper (`{ enc: "..." }`) round-trip for JSONB columns
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptString,
  decryptString,
  encryptJson,
  decryptJson,
  isEncrypted,
  isFieldEncryptionEnabled,
  __resetFieldCipherKeyCache,
} from '@jak-swarm/security';

const KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ENV = 'JAK_FIELD_ENCRYPTION_KEY';

describe('field-cipher — passthrough mode (no key)', () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[ENV];
    delete process.env[ENV];
    __resetFieldCipherKeyCache();
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
    __resetFieldCipherKeyCache();
  });

  it('isFieldEncryptionEnabled() is false', () => {
    expect(isFieldEncryptionEnabled()).toBe(false);
  });

  it('encryptString returns input unchanged', () => {
    expect(encryptString('alice@acme.com')).toBe('alice@acme.com');
  });

  it('encryptJson returns input unchanged', () => {
    const v = { goal: 'send to alice@acme.com' };
    expect(encryptJson(v)).toBe(v);
  });

  it('decryptString returns input unchanged for plaintext', () => {
    expect(decryptString('plaintext')).toBe('plaintext');
  });

  it('decryptString returns the envelope as-is when no key (loud failure)', () => {
    // Without a key we cannot decrypt — returning the envelope verbatim
    // means UI displays the envelope visibly rather than corrupting silently.
    const env = 'enc:v1:abc123';
    expect(decryptString(env)).toBe(env);
  });
});

describe('field-cipher — encryption mode (key set)', () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[ENV];
    process.env[ENV] = KEY_HEX;
    __resetFieldCipherKeyCache();
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
    __resetFieldCipherKeyCache();
  });

  it('isFieldEncryptionEnabled() is true', () => {
    expect(isFieldEncryptionEnabled()).toBe(true);
  });

  it('round-trips an email', () => {
    const ct = encryptString('alice@acme.com')!;
    expect(ct).toMatch(/^enc:v1:/);
    expect(ct).not.toContain('alice@acme.com');
    expect(decryptString(ct)).toBe('alice@acme.com');
  });

  it('round-trips an SSN-shaped value', () => {
    const ct = encryptString('123-45-6789')!;
    expect(ct).not.toContain('123-45-6789');
    expect(decryptString(ct)).toBe('123-45-6789');
  });

  it('round-trips a phone-shaped value', () => {
    const ct = encryptString('(555) 123-4567')!;
    expect(ct).not.toContain('555');
    expect(ct).not.toContain('123-4567');
    expect(decryptString(ct)).toBe('(555) 123-4567');
  });

  it('round-trips a credit-card-shaped value', () => {
    const ct = encryptString('4111 1111 1111 1111')!;
    expect(ct).not.toContain('4111');
    expect(decryptString(ct)).toBe('4111 1111 1111 1111');
  });

  it('produces a different ciphertext for the same input each call (random IV)', () => {
    const a = encryptString('hello')!;
    const b = encryptString('hello')!;
    expect(a).not.toBe(b); // different IVs → different ciphertext
    expect(decryptString(a)).toBe('hello');
    expect(decryptString(b)).toBe('hello');
  });

  it('encrypt is idempotent (does not double-wrap)', () => {
    const a = encryptString('hello')!;
    const b = encryptString(a)!;
    expect(b).toBe(a); // no re-encryption
  });

  it('decrypt is idempotent on plaintext (passthrough)', () => {
    expect(decryptString('hello')).toBe('hello');
  });

  it('passes through null / undefined / empty', () => {
    expect(encryptString(null)).toBeNull();
    expect(encryptString(undefined)).toBeUndefined();
    expect(encryptString('')).toBe('');
  });

  it('isEncrypted() detects the envelope', () => {
    const ct = encryptString('hello')!;
    expect(isEncrypted(ct)).toBe(true);
    expect(isEncrypted('hello')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it('decrypt throws on tampered ciphertext (GCM auth tag)', () => {
    const ct = encryptString('hello')!;
    // Flip a byte in the middle of the base64 envelope.
    const blob = ct.slice('enc:v1:'.length);
    const tampered =
      'enc:v1:' + (blob[0] === 'A' ? 'B' : 'A') + blob.slice(1);
    expect(() => decryptString(tampered)).toThrow();
  });

  it('JSON wrapper round-trip preserves structure', () => {
    const v = {
      goal: 'send to alice@acme.com',
      steps: [{ name: 'find', toolCalls: [{ phone: '(555) 123-4567' }] }],
    };
    const wrapped = encryptJson(v) as { enc: string };
    expect(wrapped).toHaveProperty('enc');
    expect(wrapped.enc).toMatch(/^enc:v1:/);
    expect(JSON.stringify(wrapped)).not.toContain('alice@acme.com');
    expect(JSON.stringify(wrapped)).not.toContain('(555) 123-4567');
    expect(decryptJson(wrapped)).toEqual(v);
  });

  it('encryptJson is idempotent on already-wrapped value', () => {
    const v = { x: 1 };
    const w1 = encryptJson(v);
    const w2 = encryptJson(w1);
    expect(w2).toBe(w1);
  });

  it('decryptJson passes through unwrapped values', () => {
    const v = { foo: 'bar' };
    expect(decryptJson(v)).toBe(v);
  });

  it('decryptJson passes through null / undefined', () => {
    expect(decryptJson(null)).toBeNull();
    expect(decryptJson(undefined)).toBeUndefined();
  });
});

describe('field-cipher — key change detection', () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[ENV];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
    __resetFieldCipherKeyCache();
  });

  it('decrypt with a different key throws (loud failure on key rotation)', () => {
    process.env[ENV] = KEY_HEX;
    __resetFieldCipherKeyCache();
    const ct = encryptString('hello')!;

    // Rotate to a different key — decrypt should throw.
    process.env[ENV] = 'f'.repeat(64);
    __resetFieldCipherKeyCache();
    expect(() => decryptString(ct)).toThrow();
  });
});
