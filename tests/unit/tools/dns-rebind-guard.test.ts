/**
 * resolveAndCheckHost — DNS-rebinding defence test suite.
 *
 * The URL allowlist alone is not enough — a public domain whose A
 * record changes between the allowlist check and the actual fetch
 * would resolve to a private IP. resolveAndCheckHost runs a real
 * DNS lookup and rejects if any resolved IP is private/metadata.
 */

import { describe, it, expect } from 'vitest';
import { resolveAndCheckHost } from '@jak-swarm/tools';

describe('resolveAndCheckHost — DNS-rebinding defence', () => {
  describe('IP literals (skip DNS, check directly)', () => {
    it('blocks 169.254.169.254 (AWS metadata) given as literal', async () => {
      const r = await resolveAndCheckHost('169.254.169.254');
      expect(r.allowed).toBe(false);
      expect(r.blockedIps).toContain('169.254.169.254');
    });

    it('blocks 127.0.0.1 literal', async () => {
      const r = await resolveAndCheckHost('127.0.0.1');
      expect(r.allowed).toBe(false);
    });

    it('blocks 10.0.0.1 literal', async () => {
      const r = await resolveAndCheckHost('10.0.0.1');
      expect(r.allowed).toBe(false);
    });

    it('allows 1.1.1.1 (Cloudflare DNS, public)', async () => {
      const r = await resolveAndCheckHost('1.1.1.1');
      expect(r.allowed).toBe(true);
      expect(r.resolvedIps).toEqual(['1.1.1.1']);
      expect(r.blockedIps).toEqual([]);
    });

    it('blocks IPv6 loopback ::1', async () => {
      const r = await resolveAndCheckHost('::1');
      expect(r.allowed).toBe(false);
    });

    it('blocks IPv6 link-local fe80:: prefix', async () => {
      const r = await resolveAndCheckHost('fe80::1');
      expect(r.allowed).toBe(false);
    });
  });

  describe('hostname resolution (live DNS — may be slow on cold cache)', () => {
    it('allows a public hostname resolving to a public IP', async () => {
      // example.com resolves to 93.184.216.34 etc — all public.
      const r = await resolveAndCheckHost('example.com');
      // Network may be unavailable in CI — accept either { allowed:true,
      // resolvedIps:[…] } OR a fail-closed { allowed:false, resolvedIps:[] }
      // (the latter happens when DNS is offline; that IS the safe
      // outcome — the production browser would refuse to fetch).
      if (r.resolvedIps.length > 0) {
        expect(r.allowed).toBe(true);
        expect(r.blockedIps).toEqual([]);
      } else {
        expect(r.allowed).toBe(false);
      }
    });

    it('fails-closed when DNS lookup errors (refuses to fetch)', async () => {
      const r = await resolveAndCheckHost('this-domain-cannot-exist-1234567890.invalid');
      expect(r.allowed).toBe(false);
      expect(r.resolvedIps).toEqual([]);
      expect(r.blockedIps).toEqual([]);
    });
  });
});
