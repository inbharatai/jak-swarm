/**
 * Canonical-hash unit tests — Item B of the OpenClaw-inspired Phase 1.
 *
 * The approval payload-binding contract relies on `canonicalHash()`
 * producing a STABLE digest regardless of:
 *   - object key ordering (semantically equivalent objects must hash equal)
 *   - undefined values (mirrors JSON.stringify behavior — drop them)
 *   - Date values (must serialize to ISO so equivalent timestamps hash equal)
 *
 * If any of these drift, two callers seeing the SAME proposed payload
 * could compute DIFFERENT hashes and the decide endpoint would falsely
 * reject the decision with APPROVAL_PAYLOAD_MISMATCH. This is the
 * regression gate.
 */
import { describe, it, expect } from 'vitest';
import { canonicalHash, canonicalJson } from '../../../apps/api/src/utils/canonical-hash.js';

describe('canonical-hash', () => {
  describe('canonicalJson', () => {
    it('sorts object keys lexicographically', () => {
      expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    });

    it('sorts nested object keys recursively', () => {
      expect(canonicalJson({ outer: { z: 1, a: 2 }, first: true })).toBe(
        '{"first":true,"outer":{"a":2,"z":1}}',
      );
    });

    it('preserves array element order (semantically meaningful)', () => {
      expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    });

    it('drops undefined values (matches JSON.stringify)', () => {
      expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
    });

    it('serializes Date values to ISO strings', () => {
      const d = new Date('2026-01-15T12:00:00.000Z');
      expect(canonicalJson({ when: d })).toBe('{"when":"2026-01-15T12:00:00.000Z"}');
    });

    it('returns null for explicit null', () => {
      expect(canonicalJson(null)).toBe('null');
    });

    it('handles primitives directly', () => {
      expect(canonicalJson(42)).toBe('42');
      expect(canonicalJson('hi')).toBe('"hi"');
      expect(canonicalJson(true)).toBe('true');
    });
  });

  describe('canonicalHash', () => {
    it('produces a 64-char lowercase hex sha256 digest', () => {
      const h = canonicalHash({ a: 1 });
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('hashes equivalent objects with different key orders identically', () => {
      const h1 = canonicalHash({ a: 1, b: { c: 3, d: 4 } });
      const h2 = canonicalHash({ b: { d: 4, c: 3 }, a: 1 });
      expect(h1).toBe(h2);
    });

    it('hashes structurally different objects differently', () => {
      expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
      expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ b: 1 }));
      expect(canonicalHash({ a: [1, 2] })).not.toBe(canonicalHash({ a: [2, 1] }));
    });

    it('treats `b: undefined` and missing key `b` as identical', () => {
      expect(canonicalHash({ a: 1, b: undefined })).toBe(canonicalHash({ a: 1 }));
    });

    it('hashes equivalent Dates identically regardless of construction', () => {
      const d1 = new Date('2026-01-15T12:00:00.000Z');
      const d2 = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
      expect(canonicalHash({ t: d1 })).toBe(canonicalHash({ t: d2 }));
    });

    it('handles realistic approval proposedData shape', () => {
      const proposedData = {
        taskInput: 'Send weekly digest to alice@example.com',
        toolsRequired: ['gmail_send', 'find_document'],
        riskLevel: 'HIGH',
        previousResults: { 'task-1': { count: 5 } },
      };
      const h1 = canonicalHash(proposedData);
      // Re-stringified (e.g., after a DB round-trip with reordered keys)
      const reshuffled = JSON.parse(
        JSON.stringify({
          previousResults: proposedData.previousResults,
          riskLevel: proposedData.riskLevel,
          toolsRequired: proposedData.toolsRequired,
          taskInput: proposedData.taskInput,
        }),
      );
      expect(canonicalHash(reshuffled)).toBe(h1);
    });

    it('hashes null explicitly (used for legacy approvals with no proposedData)', () => {
      expect(canonicalHash(null)).toBe(canonicalHash(null));
      expect(canonicalHash(null)).not.toBe(canonicalHash({}));
    });
  });
});
