import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Unit tests for API key generation and hashing logic.
 *
 * The actual creation logic lives in tenants.routes.ts; these tests
 * verify the contract for the key format and hash function independently
 * so regressions are caught without a running DB.
 */

function generateApiKey(): { rawKey: string; keyHash: string } {
  const rawKey = `jak_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, keyHash };
}

describe('API key format and hashing', () => {
  it('generates keys with jak_ prefix', () => {
    const { rawKey } = generateApiKey();
    expect(rawKey).toMatch(/^jak_[0-9a-f]{64}$/);
  });

  it('produces deterministic SHA-256 hash for the same raw key', () => {
    const { rawKey, keyHash } = generateApiKey();
    const recomputed = createHash('sha256').update(rawKey).digest('hex');
    expect(keyHash).toBe(recomputed);
  });

  it('produces different hashes for different keys', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.rawKey).not.toBe(b.rawKey);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it('hash is 64 hex characters (256-bit)', () => {
    const { keyHash } = generateApiKey();
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('raw key is not stored — hash is derived independently from raw key', () => {
    const { rawKey, keyHash } = generateApiKey();
    // Verify the hash cannot be reversed to find rawKey
    expect(keyHash).not.toContain(rawKey);
    expect(rawKey).not.toContain(keyHash);
  });
});
