/**
 * Shared LLM API key encryption/decryption utilities.
 *
 * AES-256-GCM using AUTH_SECRET as key material. Used by both
 * llm-settings.routes.ts (for storing keys) and swarm-execution.service.ts
 * (for decrypting keys at workflow start time).
 *
 * Extracted from llm-settings.routes.ts so the execution pipeline can
 * decrypt per-tenant keys without importing the route module.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

function deriveKey(): Buffer {
  if (!cachedKey) {
    cachedKey = scryptSync(config.jwtSecret, 'jak-swarm-llm-keys', 32);
  }
  return cachedKey;
}

/**
 * Encrypt a plaintext API key. Returns a string in the format
 * `iv:tag:ciphertext` (all base64).
 */
export function encryptLLMKey(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt an API key previously encrypted with encryptLLMKey().
 * Throws on invalid format or tampered ciphertext.
 */
export function decryptLLMKey(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(parts[0]!, 'base64');
  const tag = Buffer.from(parts[1]!, 'base64');
  const encrypted = Buffer.from(parts[2]!, 'base64');
  const key = deriveKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}