/**
 * assert-local-only — guard test suite.
 *
 * Proves the hard guard that refuses to run interactive QA against any
 * production-shaped DB / API host.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertLocalOnly,
  assertLocalOnlyOrThrow,
} from '../../human-qa/assert-local-only.js';

const ENV_KEYS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'REDIS_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
];

describe('assert-local-only — production-DB guard', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('passes when no DB env vars are set', () => {
    const r = assertLocalOnly();
    expect(r.ok).toBe(true);
  });

  it('passes for localhost Postgres', () => {
    process.env['DATABASE_URL'] = 'postgresql://postgres:test@localhost:5433/test';
    const r = assertLocalOnly();
    expect(r.ok).toBe(true);
    expect(r.inspected.find((i) => i.envVar === 'DATABASE_URL')?.classification).toBe('local');
  });

  it('passes for 127.0.0.1', () => {
    process.env['DATABASE_URL'] = 'postgresql://postgres:test@127.0.0.1:5432/test';
    expect(assertLocalOnly().ok).toBe(true);
  });

  it('FAILS for Supabase pooler', () => {
    process.env['DATABASE_URL'] = 'postgresql://postgres.x:y@aws-1-us-east-1.pooler.supabase.com:6543/postgres';
    const r = assertLocalOnly();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/supabase/i);
  });

  it('FAILS for direct Supabase host', () => {
    process.env['DIRECT_URL'] = 'postgresql://postgres:y@db.abc123.supabase.co:5432/postgres';
    expect(assertLocalOnly().ok).toBe(false);
  });

  it('FAILS for Upstash Redis', () => {
    process.env['REDIS_URL'] = 'rediss://default:abc@us1-special-toad-12345.upstash.io:6379';
    expect(assertLocalOnly().ok).toBe(false);
  });

  it('FAILS for AWS RDS-style host', () => {
    process.env['DATABASE_URL'] = 'postgresql://app:pw@my-cluster.cluster-xyz.us-east-1.rds.amazonaws.com:5432/app';
    expect(assertLocalOnly().ok).toBe(false);
  });

  it('FAILS for Vercel API URL', () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://my-app.vercel.app';
    expect(assertLocalOnly().ok).toBe(false);
  });

  it('FAILS for Render API URL', () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://jak-swarm-api.onrender.com';
    expect(assertLocalOnly().ok).toBe(false);
  });

  it('FAILS for Fly.dev API URL', () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://jak.fly.dev';
    expect(assertLocalOnly().ok).toBe(false);
  });

  it('throws with a useful message via assertLocalOnlyOrThrow', () => {
    process.env['DATABASE_URL'] = 'postgresql://x:y@db.abc.supabase.co:5432/postgres';
    expect(() => assertLocalOnlyOrThrow()).toThrow(/PRODUCTION DB/);
  });

  it('does not throw when all hosts are local', () => {
    process.env['DATABASE_URL'] = 'postgresql://postgres:t@localhost:5433/test';
    process.env['REDIS_URL'] = 'redis://localhost:6379';
    process.env['NEXT_PUBLIC_API_URL'] = 'http://localhost:4000';
    expect(() => assertLocalOnlyOrThrow()).not.toThrow();
  });
});
