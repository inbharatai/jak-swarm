/**
 * AES-256-GCM Encryption Utilities
 *
 * Used for encrypting sensitive data at rest (integration credentials,
 * API keys, tokens). Key is derived from AUTH_SECRET via scrypt.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  return scryptSync(config.jwtSecret, 'jak-swarm-credentials', 32);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns: iv:authTag:ciphertext (all base64 encoded)
 */
export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Expects: iv:authTag:ciphertext (all base64 encoded)
 */
export function decrypt(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(parts[0]!, 'base64');
  const tag = Buffer.from(parts[1]!, 'base64');
  const encrypted = Buffer.from(parts[2]!, 'base64');
  const key = deriveKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}
