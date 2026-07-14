/**
 * mcp-reconnect-decrypt.test.ts — regression for the MCP auto-reconnect
 * credential bug (truth-doc A7).
 *
 * Bug: swarm.plugin.ts auto-reconnect did JSON.parse(integration.credentials.accessTokenEnc)
 * directly. accessTokenEnc is AES-GCM ciphertext (encryptCredentials(...) at write time),
 * so JSON.parse on ciphertext threw and every encrypted CONNECTED MCP connector was
 * marked NEEDS_REAUTH on boot — encrypted connectors could never reconnect.
 *
 * Fix: JSON.parse(decryptCredentials(accessTokenEnc)) — decrypt through crypto.ts first,
 * matching the slack-adapter and company-connector-sync paths.
 *
 * This test pins the invariant the fix relies on: an encrypted credential blob
 * round-trips through decrypt+JSON.parse, and JSON.parse WITHOUT decrypt fails
 * (so the old path is provably wrong).
 */
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../../apps/api/src/utils/crypto.js';

describe('MCP auto-reconnect credential decode (A7)', () => {
  it('round-trips an encrypted JSON credential blob via decrypt then JSON.parse', () => {
    const creds = {
      accessToken: 'tok_abc',
      refreshToken: 'refresh_xyz',
      instanceUrl: 'https://acme.my.salesforce.com',
    };
    const blob = encrypt(JSON.stringify(creds));
    // The fixed path: decrypt first, then parse.
    const decoded = JSON.parse(decrypt(blob)) as Record<string, string>;
    expect(decoded).toEqual(creds);
  });

  it('proves the old buggy path (JSON.parse on ciphertext) throws', () => {
    const blob = encrypt(JSON.stringify({ accessToken: 'x' }));
    expect(() => JSON.parse(blob)).toThrow();
  });

  it('decrypt is the inverse of encrypt for non-JSON payloads too', () => {
    const blob = encrypt('plain-token-value');
    expect(decrypt(blob)).toBe('plain-token-value');
  });
});
