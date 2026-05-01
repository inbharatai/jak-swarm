/**
 * field-cipher — AES-256-GCM at-rest encryption for individual DB
 * fields (workflow goal / error / finalOutput / planJson / stateJson).
 *
 * Designed in Local Sprint 3 after the SQL-runtime finding that those
 * columns persisted raw user PII. Full design rationale in
 * docs/workflow-pii-storage-policy.md.
 *
 * Format:
 *   enc:v1:<base64( IV(12B) || ciphertext || authTag(16B) )>
 *
 * Properties:
 *   - Authenticated (GCM detects tampering on decrypt → throws)
 *   - Non-deterministic (random 96-bit IV per write)
 *   - Idempotent on encrypt: passing an already `enc:v1:`-prefixed
 *     string returns it unchanged (no double-wrapping)
 *   - Idempotent on decrypt: passing a string without the prefix
 *     returns it unchanged (passthrough — useful for legacy rows
 *     and for the "no key configured" dev path)
 *
 * Key management:
 *   - Reads `JAK_FIELD_ENCRYPTION_KEY` (32 bytes hex / 64 hex chars)
 *     from env at module load. If unset:
 *       - dev / test: passthrough (returns plaintext)
 *       - production: a separate boot diagnostic should fail-loud
 *         (the cipher itself doesn't know NODE_ENV at load time)
 *   - Key never logged, never returned, never thrown into errors.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null | undefined; // undefined = uninitialised, null = explicitly absent

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const hex = process.env['JAK_FIELD_ENCRYPTION_KEY'];
  if (!hex || hex.length !== 64 || !/^[0-9a-f]{64}$/i.test(hex)) {
    cachedKey = null;
    return null;
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

/**
 * Test-only — clears the cached key so a test can flip the env var
 * mid-suite. Production code never needs this.
 */
export function __resetFieldCipherKeyCache(): void {
  cachedKey = undefined;
}

/** True iff the value is in our `enc:v1:` envelope shape. */
export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** True iff a key is configured + this cipher will actually encrypt. */
export function isFieldEncryptionEnabled(): boolean {
  return loadKey() !== null;
}

/**
 * Encrypt a string. If no key is configured OR the input is already
 * encrypted OR the input is empty / null / undefined, returns the
 * input unchanged. Throws only on internal crypto failure.
 */
export function encryptString(plaintext: string | null | undefined): string | null | undefined {
  if (plaintext == null) return plaintext;
  if (typeof plaintext !== 'string') return plaintext;
  if (plaintext.length === 0) return plaintext;
  if (isEncrypted(plaintext)) return plaintext;

  const key = loadKey();
  if (!key) return plaintext; // passthrough mode

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, ct, tag]).toString('base64');
  return `${PREFIX}${blob}`;
}

/**
 * Decrypt a string. If the input is not in the `enc:v1:` envelope,
 * returns it unchanged (legacy / passthrough rows). Throws if the
 * envelope is recognised but the ciphertext is corrupt / tampered /
 * encrypted with a different key — this is the desired loud failure.
 */
export function decryptString(stored: string | null | undefined): string | null | undefined {
  if (stored == null) return stored;
  if (typeof stored !== 'string') return stored;
  if (!isEncrypted(stored)) return stored;

  const key = loadKey();
  if (!key) {
    // Decrypt request with no key — return the envelope as-is rather
    // than corrupt-pretend. Caller code that needs the plaintext
    // will surface the encryption envelope to the user, which is a
    // less-bad failure mode than silently emitting wrong content.
    return stored;
  }

  const blob = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (blob.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('field-cipher: decrypt failed (envelope too short)');
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Encrypt a JSON value by stringifying + encrypting + wrapping in a
 * single-key object so the result is still valid JSON for Postgres
 * JSONB columns.
 *
 * Output shape: `{ enc: "enc:v1:..." }` for any non-null value, OR
 * the original value unchanged if encryption is disabled / passthrough.
 */
export function encryptJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  // If already in our wrapper, return unchanged (idempotent).
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'enc' in (value as Record<string, unknown>) &&
    typeof (value as { enc: unknown }).enc === 'string' &&
    isEncrypted((value as { enc: string }).enc)
  ) {
    return value;
  }
  if (!isFieldEncryptionEnabled()) return value;
  const ct = encryptString(JSON.stringify(value));
  return { enc: ct };
}

/**
 * Decrypt a JSON wrapper produced by `encryptJson`. If the input
 * doesn't look like a wrapper, return it unchanged (legacy /
 * passthrough rows).
 */
export function decryptJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== 1 || typeof obj['enc'] !== 'string' || !isEncrypted(obj['enc'])) {
    return value;
  }
  const plain = decryptString(obj['enc']);
  if (typeof plain !== 'string') return value;
  try {
    return JSON.parse(plain);
  } catch {
    // Decryption succeeded but the plaintext isn't JSON — return as
    // a string. This shouldn't happen if encryptJson was the writer,
    // but defends against corrupt envelopes.
    return plain;
  }
}
