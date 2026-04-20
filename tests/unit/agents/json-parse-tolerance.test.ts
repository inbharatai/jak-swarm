/**
 * Tolerance tests for the shared LLM JSON-response parser.
 *
 * Regression guard for a real production bug: agents crashed with
 * `Unexpected token 'L', "Looking at"... is not valid JSON` when an LLM
 * returned prose wrapping the JSON. parseJsonResponse now:
 *   1. fast-paths fenced / bare JSON via direct JSON.parse
 *   2. falls back to extracting the first balanced { ... } / [ ... ] blob
 *   3. throws a clear diagnostic error (with content preview) only when
 *      even the extraction path can't find a JSON blob
 *
 * These tests pin each path independently so future refactors cannot
 * silently regress the fallback behavior.
 */

import { describe, it, expect } from 'vitest';
import { extractFirstJsonBlob, BaseAgent } from '@jak-swarm/agents';
import { AgentRole } from '@jak-swarm/shared';

// Tiny shim: exercise BaseAgent.parseJsonResponse directly without going
// through executeWithTools (which adds tool-call-loop complexity that's
// orthogonal to what we're testing here — tolerance to LLM prose).
class TestAgent extends BaseAgent {
  constructor() {
    super(AgentRole.WORKER_SUPPORT, 'stub-key');
  }
  public async execute(): Promise<unknown> { return {}; }
  public parse<T>(content: string): T {
    return this.parseJsonResponse<T>(content);
  }
}
const agent = new TestAgent();

// ─── extractFirstJsonBlob — the extraction primitive ───────────────────────

describe('extractFirstJsonBlob', () => {
  it('returns null for pure prose', () => {
    expect(extractFirstJsonBlob('no json here')).toBeNull();
    expect(extractFirstJsonBlob('')).toBeNull();
  });

  it('extracts a flat object surrounded by prose', () => {
    const text = 'Looking at the transcript, here is the result: {"action":"CLASSIFY","confidence":0.8} — hope this helps.';
    expect(extractFirstJsonBlob(text)).toBe('{"action":"CLASSIFY","confidence":0.8}');
  });

  it('extracts a nested object', () => {
    const text = 'prefix {"a":{"b":{"c":1}}} suffix';
    expect(extractFirstJsonBlob(text)).toBe('{"a":{"b":{"c":1}}}');
  });

  it('extracts an array', () => {
    const text = 'prefix [1, 2, [3, 4], 5] suffix';
    expect(extractFirstJsonBlob(text)).toBe('[1, 2, [3, 4], 5]');
  });

  it('respects string escapes so quoted braces do not confuse depth', () => {
    // The `}` inside the value is inside a string — must not close the outer object.
    const text = 'noise {"text":"not a closing } here","count":2} noise';
    const extracted = extractFirstJsonBlob(text);
    expect(extracted).toBe('{"text":"not a closing } here","count":2}');
    expect(() => JSON.parse(extracted!)).not.toThrow();
  });

  it('handles escaped double quotes inside strings', () => {
    const text = 'pre {"greeting":"say \\"hi\\"","done":true} post';
    const extracted = extractFirstJsonBlob(text);
    expect(extracted).toBe('{"greeting":"say \\"hi\\"","done":true}');
    expect(() => JSON.parse(extracted!)).not.toThrow();
  });

  it('returns null for unbalanced braces', () => {
    expect(extractFirstJsonBlob('{"a":1')).toBeNull();
    expect(extractFirstJsonBlob('[1,2,3')).toBeNull();
  });

  it('returns the FIRST blob when multiple are present', () => {
    const text = '{"first":1} then {"second":2}';
    expect(extractFirstJsonBlob(text)).toBe('{"first":1}');
  });
});

// ─── parseJsonResponse — direct tests (no tool-call loop) ─────────────────

describe('parseJsonResponse', () => {
  it('parses bare JSON (happy path, direct JSON.parse)', () => {
    const r = agent.parse<{ a: number }>('{"a":1}');
    expect(r.a).toBe(1);
  });

  it('parses markdown-fenced JSON', () => {
    const r = agent.parse<{ x: string }>('```json\n{"x":"hi"}\n```');
    expect(r.x).toBe('hi');
  });

  it('parses fenced JSON with no language tag', () => {
    const r = agent.parse<{ x: number }>('```\n{"x":42}\n```');
    expect(r.x).toBe(42);
  });

  it('EXTRACTS JSON from LLM prose (the prod failure mode)', () => {
    const prose =
      'Looking at the transcript I see a billing issue. Here is the structured result: {"category":"billing","urgency":4} — hope that helps!';
    const r = agent.parse<{ category: string; urgency: number }>(prose);
    expect(r.category).toBe('billing');
    expect(r.urgency).toBe(4);
  });

  it('extracts JSON when LLM wraps it between code blocks and commentary', () => {
    const mixed = `Sure, here's my analysis:

{"action":"DRAFT_RESPONSE","summary":"refund requested","nextActions":["Pull stripe logs"]}

Let me know if you want a different format.`;
    const r = agent.parse<{ action: string; nextActions: string[] }>(mixed);
    expect(r.action).toBe('DRAFT_RESPONSE');
    expect(r.nextActions).toContain('Pull stripe logs');
  });

  it('respects string escapes (quoted braces do not confuse extraction)', () => {
    const text = 'noise {"msg":"unbalanced } here","ok":true} noise';
    const r = agent.parse<{ msg: string; ok: boolean }>(text);
    expect(r.msg).toBe('unbalanced } here');
    expect(r.ok).toBe(true);
  });

  it('parses array-at-root responses', () => {
    const r = agent.parse<number[]>('[1, 2, 3]');
    expect(r).toEqual([1, 2, 3]);
  });

  it('extracts array from prose', () => {
    const r = agent.parse<string[]>('Here are the tags: ["refund","urgent","billing"] — end.');
    expect(r).toEqual(['refund', 'urgent', 'billing']);
  });

  it('THROWS a clear error when no JSON blob is present', () => {
    expect(() =>
      agent.parse('I am unable to produce structured output right now.'),
    ).toThrow(/no valid JSON/i);
  });

  it('throws error preview includes content head for log debuggability', () => {
    try {
      agent.parse('pure prose, not a JSON in sight');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error).message).toMatch(/pure prose/);
    }
  });

  it('THROWS on unbalanced braces (no silent partial parse)', () => {
    expect(() => agent.parse('{"a":1')).toThrow(/no valid JSON/i);
  });

  it('handles empty string', () => {
    expect(() => agent.parse('')).toThrow(/no valid JSON/i);
  });
});
