/**
 * RuntimePIIRedactor — Sprint 2.4 / Item G.
 *
 * Wraps detectPII() with a token-restoration layer so PII in user prompts
 * can be redacted before the bytes ever reach an external LLM, then
 * restored in the LLM's response before the trace is persisted.
 *
 * Design contract:
 *   - One redactor instance per BaseAgent call (per LLM round). The map
 *     of placeholder → original lives only in memory for that call.
 *   - Redaction is deterministic for the same input: identical PII gets
 *     the same placeholder (so the LLM's cache + reasoning aren't
 *     fragmented by random IDs).
 *   - Placeholder format: `[PII:TYPE:hashHex]` where hashHex is the
 *     first 8 chars of SHA-256 of the original. Avoids collisions in
 *     practice; safe for cache hits because the same value always
 *     produces the same placeholder.
 *   - `restore(text)` only restores placeholders that exist in the
 *     internal map. If the LLM hallucinates a placeholder (e.g. invents
 *     `[PII:SSN:00000000]`), it stays as-is rather than getting replaced
 *     with arbitrary content.
 *   - The redactor never touches:
 *       - JSON-stringified placeholders that already look like
 *         `[PII:...]` in the SOURCE text — we don't double-wrap.
 *       - Content that came from the LLM (only redact our outbound
 *         messages, only restore the LLM's response).
 *
 * Honesty:
 *   - When no PII is detected, `redact` returns the input verbatim and
 *     `getPiiCounts` returns an empty object. The caller must NOT claim
 *     redaction happened in telemetry when the count is zero.
 */

import { createHash } from 'node:crypto';
import { detectPII, PIIType, type PIIMatch } from './pii-detector.js';

export interface RedactionStats {
  /** Per-type counts of PII found. Empty object means nothing was redacted. */
  byType: Partial<Record<PIIType, number>>;
  /** Total number of distinct placeholders in the map. */
  uniquePlaceholders: number;
  /** Total number of PII match-instances detected (includes duplicates). */
  totalMatches: number;
}

const PLACEHOLDER_PREFIX = '[PII:';
const PLACEHOLDER_PATTERN = /\[PII:([A-Z_]+):([0-9a-f]{8})\]/g;

export class RuntimePIIRedactor {
  private map = new Map<string, string>(); // placeholder → original
  private stats: { byType: Partial<Record<PIIType, number>>; totalMatches: number } = {
    byType: {},
    totalMatches: 0,
  };

  /**
   * Build a stable placeholder for a (type, original) pair. Same input
   * always yields the same placeholder so cached prompt segments don't
   * fragment.
   */
  private placeholderFor(type: PIIType, value: string): string {
    const hash = createHash('sha256').update(`${type}|${value}`).digest('hex').slice(0, 8);
    return `[PII:${type}:${hash}]`;
  }

  /**
   * Redact PII in a string. Returns the redacted string + records the
   * mapping internally for later restore. Idempotent: passing in an
   * already-redacted string detects no NEW PII (because [PII:...] is
   * not itself PII per our patterns).
   */
  redact(input: string): string {
    if (typeof input !== 'string' || input.length === 0) return input;
    const detection = detectPII(input);
    if (!detection.containsPII) return input;

    // Sort matches descending by startIndex so splicing from the back
    // doesn't invalidate earlier offsets.
    const sorted: PIIMatch[] = [...detection.matches].sort((a, b) => b.startIndex - a.startIndex);

    let result = input;
    for (const m of sorted) {
      const placeholder = this.placeholderFor(m.type, m.value);
      this.map.set(placeholder, m.value);
      result = result.slice(0, m.startIndex) + placeholder + result.slice(m.endIndex);
      this.stats.byType[m.type] = (this.stats.byType[m.type] ?? 0) + 1;
      this.stats.totalMatches += 1;
    }
    return result;
  }

  /**
   * Restore placeholders to their original values. Only restores
   * placeholders this redactor instance recorded; unknown placeholders
   * (e.g. ones the LLM hallucinated) are left intact so they can be
   * caught downstream rather than silently substituted.
   */
  restore(input: string): string {
    if (typeof input !== 'string' || input.length === 0) return input;
    if (!input.includes(PLACEHOLDER_PREFIX)) return input;
    return input.replace(PLACEHOLDER_PATTERN, (whole) => {
      const original = this.map.get(whole);
      return original ?? whole;
    });
  }

  /**
   * Redact every string field in a message-shaped object. Walks
   * `content` (string or array-of-content-parts) + `tool_calls[].function.arguments`.
   * Returns a NEW object — does not mutate the input.
   */
  redactMessages<T extends { role?: string; content?: unknown; tool_calls?: unknown[] }>(
    messages: T[],
  ): T[] {
    return messages.map((m) => this.redactMessage(m));
  }

  redactMessage<T extends { role?: string; content?: unknown; tool_calls?: unknown[] }>(m: T): T {
    const out: Record<string, unknown> = { ...m };
    if (typeof m.content === 'string') {
      out['content'] = this.redact(m.content);
    } else if (Array.isArray(m.content)) {
      out['content'] = m.content.map((part) => {
        if (typeof part === 'string') return this.redact(part);
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
          return { ...(part as object), text: this.redact((part as { text: string }).text) };
        }
        return part;
      });
    }
    if (Array.isArray(m.tool_calls)) {
      out['tool_calls'] = m.tool_calls.map((tc) => {
        if (
          tc &&
          typeof tc === 'object' &&
          'function' in tc &&
          (tc as { function?: { arguments?: unknown } }).function &&
          typeof (tc as { function: { arguments: unknown } }).function.arguments === 'string'
        ) {
          const fn = (tc as { function: { name: string; arguments: string } }).function;
          return {
            ...(tc as object),
            function: { ...fn, arguments: this.redact(fn.arguments) },
          };
        }
        return tc;
      });
    }
    return out as T;
  }

  /**
   * Restore an LLM's textual response. Use this on the assistant
   * message content + any tool_call arguments before persisting to the
   * trace store, so the trace shows the user's original PII rather than
   * the placeholders.
   */
  restoreInResponse(text: string): string {
    return this.restore(text);
  }

  /**
   * Restore tool-call arguments. Tool calls are typed as JSON strings,
   * so we restore inside that string.
   */
  restoreInToolCalls<T extends { function?: { arguments?: string } }>(
    toolCalls: T[],
  ): T[] {
    return toolCalls.map((tc) => {
      if (tc.function && typeof tc.function.arguments === 'string') {
        return { ...tc, function: { ...tc.function, arguments: this.restore(tc.function.arguments) } };
      }
      return tc;
    });
  }

  /** Per-type counts for telemetry. Empty object when nothing was redacted. */
  getStats(): RedactionStats {
    return {
      byType: { ...this.stats.byType },
      uniquePlaceholders: this.map.size,
      totalMatches: this.stats.totalMatches,
    };
  }

  /** True if any PII was detected + replaced. */
  hasRedactions(): boolean {
    return this.map.size > 0;
  }
}
