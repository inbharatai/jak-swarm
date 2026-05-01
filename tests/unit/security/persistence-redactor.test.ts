/**
 * persistence-redactor — P0-B test suite.
 *
 * Asserts that the one-way deep redactor used at the AgentTrace
 * persistence boundary scrubs raw PII out of arbitrary JSON values
 * before they reach durable storage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  redactJsonForPersistence,
  isPersistenceRedactionDisabled,
} from '@jak-swarm/security';

const DISABLE_FLAG = 'JAK_PII_PERSISTENCE_REDACTION_DISABLED';

describe('redactJsonForPersistence — P0-B', () => {
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = process.env[DISABLE_FLAG];
    delete process.env[DISABLE_FLAG];
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[DISABLE_FLAG];
    else process.env[DISABLE_FLAG] = originalFlag;
  });

  it('redacts emails in a top-level string', () => {
    const out = redactJsonForPersistence('contact me at jane.doe@example.com please');
    expect(out).not.toContain('jane.doe@example.com');
    expect(out).toMatch(/\[REDACTED-EMAIL\]/);
  });

  it('redacts SSNs', () => {
    const out = redactJsonForPersistence('SSN 123-45-6789 on file');
    expect(out).not.toContain('123-45-6789');
    expect(out).toMatch(/\[REDACTED-SSN\]/);
  });

  it('redacts phone numbers', () => {
    const out = redactJsonForPersistence('call (555) 123-4567 anytime');
    expect(out).not.toContain('(555) 123-4567');
    expect(out).toMatch(/\[REDACTED-PHONE\]/);
  });

  it('redacts credit card numbers', () => {
    const out = redactJsonForPersistence('card 4111 1111 1111 1111 expired');
    expect(out).not.toContain('4111 1111 1111 1111');
    expect(out).toMatch(/\[REDACTED-CC\]/);
  });

  it('walks nested objects (mirrors AgentTrace.inputJson shape)', () => {
    const trace = {
      role: 'user',
      content: 'My email is alice@acme.com and phone (555) 123-4567',
      tool_calls: [
        {
          type: 'function',
          function: {
            name: 'send_email',
            arguments: '{"to":"bob@example.com","body":"Hi"}',
          },
        },
      ],
    };
    const out = redactJsonForPersistence(trace) as typeof trace;
    expect(out.content).not.toContain('alice@acme.com');
    expect(out.content).not.toContain('(555) 123-4567');
    expect(out.tool_calls[0]!.function.arguments).not.toContain('bob@example.com');
  });

  it('walks arrays', () => {
    const messages = [
      { role: 'user', content: 'email me at user@example.com' },
      { role: 'assistant', content: 'ok, will reply to that address' },
    ];
    const out = redactJsonForPersistence(messages) as typeof messages;
    expect(out[0]!.content).not.toContain('user@example.com');
    expect(out[1]!.content).toBe('ok, will reply to that address');
  });

  it('passes through PII-free strings unchanged', () => {
    const out = redactJsonForPersistence('hello world, this is fine');
    expect(out).toBe('hello world, this is fine');
  });

  it('preserves numbers, booleans, null, and undefined', () => {
    const out = redactJsonForPersistence({
      n: 42,
      b: true,
      x: null,
      u: undefined,
      arr: [1, 2, 3],
    });
    expect(out).toEqual({ n: 42, b: true, x: null, u: undefined, arr: [1, 2, 3] });
  });

  it('does NOT redact when JAK_PII_PERSISTENCE_REDACTION_DISABLED=1', () => {
    process.env[DISABLE_FLAG] = '1';
    expect(isPersistenceRedactionDisabled()).toBe(true);
    const out = redactJsonForPersistence('email is alice@acme.com');
    expect(out).toBe('email is alice@acme.com');
  });

  it('does NOT mutate the input', () => {
    const input = { content: 'mail: alice@acme.com' };
    const before = JSON.stringify(input);
    redactJsonForPersistence(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('preserves Date instances', () => {
    const d = new Date('2026-04-30T00:00:00Z');
    const out = redactJsonForPersistence({ ts: d, note: 'email a@b.com' }) as {
      ts: Date;
      note: string;
    };
    expect(out.ts).toBeInstanceOf(Date);
    expect(out.ts.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(out.note).not.toContain('a@b.com');
  });

  it('handles deeply nested PII (5 levels)', () => {
    const deep = {
      level1: { level2: { level3: { level4: { content: 'ssn: 123-45-6789' } } } },
    };
    const out = redactJsonForPersistence(deep) as typeof deep;
    expect(out.level1.level2.level3.level4.content).not.toContain('123-45-6789');
  });
});
