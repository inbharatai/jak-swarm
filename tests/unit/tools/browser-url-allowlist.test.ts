/**
 * Browser URL allowlist — SSRF defence test suite.
 *
 * Covers every address class the headless Playwright browser might
 * be asked (or redirected) to fetch. The allowlist is the FIRST line
 * of defence; the per-request route guard inside startSession is the
 * second.
 */

import { describe, it, expect } from 'vitest';
import { defaultIsUrlAllowed } from '@jak-swarm/tools';

const SHOULD_BLOCK = [
  // Loopback + unspecified
  'http://localhost/',
  'https://localhost:8080/admin',
  'http://anything.localhost/',
  'http://127.0.0.1/',
  'http://127.5.5.5/',
  'http://0.0.0.0/',
  'http://[::1]/',
  // RFC1918
  'http://10.0.0.1/',
  'http://10.255.255.255/',
  'http://172.16.0.1/',
  'http://172.31.255.255/',
  'http://192.168.1.1/',
  // Link-local IPv4 — covers AWS metadata
  'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
  'http://169.254.0.1/',
  // Carrier-grade NAT
  'http://100.64.0.1/',
  'http://100.127.255.255/',
  // Benchmark / TEST-NET
  'http://198.18.0.1/',
  'http://192.0.2.1/',
  'http://198.51.100.1/',
  'http://203.0.113.1/',
  // IPv6 link-local + unique-local + loopback
  'http://[fe80::1]/',
  'http://[fc00::1]/',
  'http://[fd00::1]/',
  'http://[::]/',
  // Cloud metadata FQDNs
  'http://metadata.google.internal/computeMetadata/v1/',
  'http://metadata.azure.com/',
  'http://100.100.100.200/latest/meta-data/',
  // Suspicious TLDs
  'http://something.internal/',
  'http://node.local/',
  // Non-http(s)
  'file:///etc/passwd',
  'ftp://files.example.com/',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'gopher://evil.example.com/',
];

const SHOULD_ALLOW = [
  'https://www.linkedin.com/feed/',
  'https://github.com/inbharatai/jak-swarm',
  'https://example.com/path?query=1',
  'http://example.org/',           // http on a real domain is allowed (caller chooses)
  'https://api.example.com/v1/',
  'https://1.1.1.1/',              // Cloudflare DNS — public IPv4
  'https://8.8.8.8/',              // Google DNS
  'https://[2606:4700:4700::1111]/', // Cloudflare IPv6 (public)
];

describe('defaultIsUrlAllowed — SSRF defence', () => {
  describe('blocks dangerous targets', () => {
    for (const url of SHOULD_BLOCK) {
      it(`blocks ${url}`, () => {
        expect(defaultIsUrlAllowed(url), `expected ${url} to be BLOCKED`).toBe(false);
      });
    }
  });

  describe('allows legitimate targets', () => {
    for (const url of SHOULD_ALLOW) {
      it(`allows ${url}`, () => {
        expect(defaultIsUrlAllowed(url), `expected ${url} to be ALLOWED`).toBe(true);
      });
    }
  });

  describe('hardening edges', () => {
    it('rejects malformed URLs', () => {
      expect(defaultIsUrlAllowed('not-a-url')).toBe(false);
      expect(defaultIsUrlAllowed('')).toBe(false);
      expect(defaultIsUrlAllowed('http://')).toBe(false);
    });

    it('blocks 127.x.x.x ranges, not just 127.0.0.1', () => {
      expect(defaultIsUrlAllowed('http://127.42.99.1/')).toBe(false);
    });

    it('blocks localhost subdomains', () => {
      expect(defaultIsUrlAllowed('http://api.localhost/')).toBe(false);
      expect(defaultIsUrlAllowed('http://service.local/')).toBe(false);
    });

    it('rejects URLs with embedded credentials targeting metadata', () => {
      // URL parser strips credentials; we still inspect the hostname.
      expect(defaultIsUrlAllowed('http://attacker:x@169.254.169.254/')).toBe(false);
    });
  });
});
