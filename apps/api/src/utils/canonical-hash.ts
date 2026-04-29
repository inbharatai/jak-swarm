/**
 * Canonical-JSON hash utility — Item B of the OpenClaw-inspired Phase 1.
 *
 * The approval-card payload-binding contract requires that two callers who
 * see the SAME `proposedData` object always compute the SAME hash, even if
 * their JSON encoders happened to emit keys in different orders or with
 * different whitespace. Plain `JSON.stringify` is non-deterministic across
 * runtimes when the input has unsorted keys, so we canonicalize before
 * hashing.
 *
 * Canonicalization rules:
 *   - Object keys are sorted lexicographically (recursively).
 *   - Arrays preserve order (semantically meaningful).
 *   - `undefined` values are dropped (mirrors JSON.stringify behavior).
 *   - `Date` values are serialized via toISOString() so equivalent
 *     timestamps hash identically regardless of how they were constructed.
 *   - Dropping the cycle protection here is intentional — proposedData
 *     should never contain cycles in our schema; if it does, throwing is
 *     the right call.
 *
 * The output is a 64-char lowercase hex sha256 digest. This is what we
 * persist in `ApprovalRequest.proposedDataHash` and check on every decide.
 */
import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      const v = canonicalize(obj[k]);
      if (v === undefined) continue;
      out[k] = v;
    }
    return out;
  }
  // Primitives (string, number, boolean) pass through.
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
