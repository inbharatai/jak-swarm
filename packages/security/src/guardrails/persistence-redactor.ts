/**
 * persistence-redactor — one-way deep redaction for any JSON value
 * about to be written to durable storage.
 *
 * Intended caller: `WorkflowService.saveTrace` (and any other path that
 * persists agent input/output/tool-call JSON to AgentTrace, AuditLog,
 * etc.). Walks the value recursively and redacts every string leaf via
 * the existing `redactPII()`.
 *
 * Why a separate helper from `RuntimePIIRedactor`:
 *   - Runtime redactor is stateful (placeholder ↔ original map) so the
 *     LLM round-trip can restore originals for tool calls. Persistence
 *     is the OPPOSITE: we want the original value to never reach disk,
 *     so we don't keep a map and we don't ever restore.
 *   - Runtime redactor is per-call. Persistence redactor is per-write
 *     and stateless. Importing it has zero side effects.
 *
 * Behavior:
 *   - string  → `redactPII(s)` (replaces matches with `[REDACTED:TYPE]`)
 *   - array   → recurse
 *   - object  → recurse on values; keys are NOT redacted (they're field
 *     names, not user content)
 *   - number/boolean/null/undefined → returned as-is
 *   - dates / Buffers / typed arrays → returned as-is (Prisma serialises
 *     these without our help)
 *
 * Honesty: when a string contains no PII, `redactPII` returns it
 * verbatim — there is no overhead penalty and the persisted value is
 * identical to the input. The redactor is safe to wrap around every
 * JSON column unconditionally.
 *
 * Disable for forensic debugging: set
 *   JAK_PII_PERSISTENCE_REDACTION_DISABLED=1
 * Off-switch is INTENTIONAL — operators may need raw traces during a
 * specific incident, in which case they document the deviation per
 * audit policy and re-enable redaction immediately. Default is ON in
 * every environment.
 */

import { redactPII } from './pii-detector.js';

const DISABLE_FLAG = 'JAK_PII_PERSISTENCE_REDACTION_DISABLED';

export function isPersistenceRedactionDisabled(): boolean {
  return process.env[DISABLE_FLAG] === '1';
}

/**
 * Recursively walk an arbitrary JSON-serialisable value and redact PII
 * in every string leaf. Returns a NEW value — does not mutate input.
 *
 * Honors the JAK_PII_PERSISTENCE_REDACTION_DISABLED env flag (returns
 * input unchanged when set) so operators can opt OUT for forensic
 * traces if their compliance regime allows.
 */
export function redactJsonForPersistence<T = unknown>(value: T): T {
  if (isPersistenceRedactionDisabled()) return value;
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactPII(value);
  }
  if (Array.isArray(value)) {
    return value.map(walk);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  // Preserve Date / Buffer / typed-array shapes — Prisma + JSON.stringify
  // know how to handle them; we'd corrupt them if we walked into them.
  if (value instanceof Date) return value;
  if (typeof Buffer !== 'undefined' && value instanceof Buffer) return value;
  if (ArrayBuffer.isView(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = walk(v);
  }
  return out;
}
