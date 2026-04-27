/**
 * RuntimePIIRedactor unit tests — Sprint 2.4 / Item G.
 */
import { describe, it, expect } from 'vitest';
import { RuntimePIIRedactor, PIIType } from '@jak-swarm/security';

describe('RuntimePIIRedactor — basic redact + restore round-trip', () => {
  it('returns input verbatim when no PII present', () => {
    const r = new RuntimePIIRedactor();
    const input = 'Hello, please summarize this document about widgets.';
    expect(r.redact(input)).toBe(input);
    expect(r.hasRedactions()).toBe(false);
    expect(r.getStats().totalMatches).toBe(0);
  });

  it('redacts an email and restores it intact', () => {
    const r = new RuntimePIIRedactor();
    const input = 'Please email john.doe@example.com about the meeting.';
    const redacted = r.redact(input);
    expect(redacted).not.toContain('john.doe@example.com');
    expect(redacted).toMatch(/\[PII:EMAIL:[0-9a-f]{8}\]/);
    expect(r.hasRedactions()).toBe(true);
    expect(r.getStats().byType.EMAIL).toBe(1);
    // Restore round-trip
    const restored = r.restore(redacted);
    expect(restored).toBe(input);
  });

  it('redacts an SSN and restores it', () => {
    const r = new RuntimePIIRedactor();
    const input = 'Patient SSN is 123-45-6789 in the form.';
    const redacted = r.redact(input);
    expect(redacted).not.toContain('123-45-6789');
    expect(redacted).toMatch(/\[PII:SSN:[0-9a-f]{8}\]/);
    expect(r.restore(redacted)).toBe(input);
  });

  it('produces deterministic placeholders — same value yields same hash', () => {
    const r1 = new RuntimePIIRedactor();
    const r2 = new RuntimePIIRedactor();
    const a = r1.redact('Email me at foo@bar.com please');
    const b = r2.redact('Email me at foo@bar.com please');
    expect(a).toBe(b);
  });

  it('handles two identical PII occurrences with one placeholder (de-dup)', () => {
    const r = new RuntimePIIRedactor();
    const input = 'Send to alice@x.com — confirm to alice@x.com again';
    const redacted = r.redact(input);
    // Both occurrences replaced with the same placeholder
    const matches = redacted.match(/\[PII:EMAIL:[0-9a-f]{8}\]/g);
    expect(matches).toHaveLength(2);
    expect(matches![0]).toBe(matches![1]);
    // De-dup: 1 unique placeholder, 2 total matches
    expect(r.getStats().uniquePlaceholders).toBe(1);
    expect(r.getStats().totalMatches).toBe(2);
    expect(r.restore(redacted)).toBe(input);
  });

  it('handles multiple PII types in one string', () => {
    const r = new RuntimePIIRedactor();
    const input = 'Contact alice@x.com or call 555-123-4567 about case 999-88-7777.';
    const redacted = r.redact(input);
    expect(redacted).not.toContain('alice@x.com');
    expect(redacted).not.toContain('555-123-4567');
    expect(redacted).not.toContain('999-88-7777');
    expect(r.getStats().byType.EMAIL).toBe(1);
    expect(r.getStats().byType.PHONE).toBeGreaterThanOrEqual(1);
    expect(r.getStats().byType.SSN).toBe(1);
    expect(r.restore(redacted)).toBe(input);
  });

  it('restore leaves unknown placeholders intact (no false substitution)', () => {
    const r = new RuntimePIIRedactor();
    // No PII redacted yet; restore receives a placeholder we never created
    const text = 'Some text with [PII:SSN:deadbeef] hallucinated by LLM';
    expect(r.restore(text)).toBe(text);
  });
});

describe('RuntimePIIRedactor — message redaction', () => {
  it('redacts string content in OpenAI message shape', () => {
    const r = new RuntimePIIRedactor();
    const messages = [
      { role: 'system', content: 'Be helpful.' }, // no PII
      { role: 'user', content: 'Send a follow-up to bob@example.com.' },
    ];
    const out = r.redactMessages(messages);
    expect(out[0].content).toBe('Be helpful.'); // untouched
    expect(out[1].content).not.toContain('bob@example.com');
    expect(out[1].content).toMatch(/\[PII:EMAIL:[0-9a-f]{8}\]/);
  });

  it('redacts content-array shape (multimodal messages)', () => {
    const r = new RuntimePIIRedactor();
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this email: alice@x.com' },
          { type: 'image_url', image_url: { url: 'http://example.com/x.png' } },
        ],
      },
    ];
    const out = r.redactMessages(messages);
    const content = out[0].content as Array<{ type: string; text?: string }>;
    expect(content[0].text).not.toContain('alice@x.com');
  });

  it('redacts tool_call arguments JSON string', () => {
    const r = new RuntimePIIRedactor();
    const messages = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'send_email', arguments: '{"to": "carol@x.com"}' },
          },
        ],
      },
    ];
    const out = r.redactMessages(messages);
    const tc = (out[0].tool_calls as Array<{ function: { arguments: string } }>)[0];
    expect(tc.function.arguments).not.toContain('carol@x.com');
    expect(tc.function.arguments).toMatch(/\[PII:EMAIL:[0-9a-f]{8}\]/);
  });
});

describe('RuntimePIIRedactor — restoreInToolCalls', () => {
  it('restores PII in tool call arguments', () => {
    const r = new RuntimePIIRedactor();
    // First, redact something so the map has an entry
    const original = '{"to": "user@example.com", "subject": "hi"}';
    const redacted = r.redact(original);
    // Now simulate the LLM returning tool calls with the placeholder
    const restored = r.restoreInToolCalls([
      { function: { name: 'send_email', arguments: redacted } },
    ]);
    expect(restored[0].function.arguments).toBe(original);
  });
});

describe('RuntimePIIRedactor — telemetry', () => {
  it('reports byType + totalMatches + uniquePlaceholders correctly', () => {
    const r = new RuntimePIIRedactor();
    r.redact('Two emails: one@x.com and two@y.com plus one@x.com again');
    const stats = r.getStats();
    expect(stats.byType.EMAIL).toBe(3); // three occurrences
    expect(stats.totalMatches).toBe(3);
    expect(stats.uniquePlaceholders).toBe(2); // two unique values
  });

  it('reports empty stats when no PII detected', () => {
    const r = new RuntimePIIRedactor();
    r.redact('Plain text with no PII at all.');
    expect(r.getStats().totalMatches).toBe(0);
    expect(r.getStats().uniquePlaceholders).toBe(0);
    expect(Object.keys(r.getStats().byType)).toHaveLength(0);
  });
});

// Sanity: PIIType enum is exported (so consumers can check stats keys)
describe('RuntimePIIRedactor — module exports', () => {
  it('exports PIIType for downstream stats parsing', () => {
    expect(PIIType.EMAIL).toBe('EMAIL');
    expect(PIIType.SSN).toBe('SSN');
    expect(PIIType.PHONE).toBe('PHONE');
  });
});
