/**
 * OAuth 2.0 PKCE (Proof Key for Code Exchange) helpers — RFC 7636.
 *
 * Flow:
 *   1. Before redirecting the user to the provider's auth URL, generate a
 *      random `codeVerifier` (43–128 chars, base64url alphabet) and derive
 *      `codeChallenge = BASE64URL(SHA256(codeVerifier))`.
 *   2. Send `codeChallenge` + `code_challenge_method=S256` on the auth URL.
 *      Stash the verifier server-side keyed by a CSRF `state` token.
 *   3. When the provider redirects back with `?code=…&state=…`, look up the
 *      stored verifier by state, POST `code + codeVerifier` to the provider's
 *      token endpoint, and the provider verifies the SHA256 match before
 *      issuing tokens.
 *
 * Why bother when the backend already holds a client_secret?
 *   PKCE hardens against a narrow but real threat: an attacker who intercepts
 *   the authorization code in transit (e.g. from browser history, referrer
 *   header, or a compromised proxy) cannot exchange it without the verifier.
 *   OAuth 2.1 makes PKCE mandatory for all client types, so shipping it now
 *   is future-proofing rather than gilding a lily.
 */

import { createHash, randomBytes } from 'node:crypto';

/**
 * RFC 7636 §4.1 — `code_verifier = high-entropy cryptographic random STRING
 * using the characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"`. Length
 * between 43 and 128 chars. 32 random bytes → 43-char base64url string.
 */
export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

/**
 * RFC 7636 §4.2 — `code_challenge = BASE64URL-ENCODE(SHA256(code_verifier))`.
 */
export function deriveCodeChallenge(verifier: string): string {
  const hash = createHash('sha256').update(verifier, 'utf8').digest();
  return base64UrlEncode(hash);
}

/**
 * Cryptographically random CSRF state token bound to a single pending OAuth
 * redirect. 24 random bytes → 32-char base64url string. Callers persist this
 * server-side alongside the code_verifier and tenantId/userId.
 */
export function generateStateToken(): string {
  return base64UrlEncode(randomBytes(24));
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
