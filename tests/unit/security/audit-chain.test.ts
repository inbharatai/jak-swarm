/**
 * audit-chain.test.ts — HyperAgent Phase 7 AuditLog HMAC row-chain unit tests.
 *
 * Proves the cryptographic primitives directly:
 *   - determinism: same (row, prevHash, tenantKey) → same rowHash;
 *   - tamper detection: altering any hashed field breaks verifyChain;
 *   - reorder/insert/delete detection (broken_chain_link);
 *   - missing-secret → rowHash=null (chain INACTIVE, fail-open-to-auditable);
 *   - tenant isolation: a different tenantId derives a different key → mismatch.
 *
 * Honest scope: this is a unit test of the chain primitives. The integration
 * test (audit-log-chain.integration.test.ts) proves the AuditLogger write path
 * chains rows end-to-end. Live DB round-trip remains env-blocked here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  canonicalJson,
  getEvidenceSigningSecret,
  auditChainActive,
  deriveAuditTenantKey,
  computeRowHash,
  prepareAuditChainFields,
  verifyChain,
  type AuditChainRow,
  type AuditChainPrismaClient,
} from '../../../packages/security/src/audit/audit-chain.js';

const SECRET = 'x'.repeat(48); // ≥16 bytes, well above the floor
const TENANT = 'tenant-1';

function row(over: Partial<AuditChainRow> & Pick<AuditChainRow, 'action' | 'resource'>): AuditChainRow {
  return {
    id: over.id ?? '00000000-0000-4000-8000-000000000001',
    tenantId: over.tenantId ?? TENANT,
    userId: over.userId ?? 'u1',
    action: over.action,
    resource: over.resource,
    resourceId: over.resourceId ?? null,
    details: over.details ?? { foo: 1 },
    ip: over.ip ?? '127.0.0.1',
    userAgent: over.userAgent ?? 'ua',
    severity: over.severity ?? 'INFO',
    createdAt: over.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
  };
}

function setSecret(v: string | undefined) {
  if (v === undefined) delete process.env['EVIDENCE_SIGNING_SECRET'];
  else process.env['EVIDENCE_SIGNING_SECRET'] = v;
}

beforeEach(() => setSecret(SECRET));
afterEach(() => setSecret(undefined));

describe('canonicalJson', () => {
  it('sorts object keys + preserves array order + drops undefineds (deterministic bytes)', () => {
    const a = canonicalJson({ b: 2, a: 1, c: { z: 9, a: 0 }, arr: [3, 1, 2], u: undefined });
    const b = canonicalJson({ a: 1, b: 2, c: { a: 0, z: 9 }, arr: [3, 1, 2], u: undefined });
    expect(a).toBe(b);
    expect(a).not.toContain('"u"'); // undefined dropped (key u absent)
    // JS sorts string keys lexicographically: 'a' < 'arr' < 'b' < 'c'.
    expect(a).toBe('{"a":1,"arr":[3,1,2],"b":2,"c":{"a":0,"z":9}}');
  });
});

describe('getEvidenceSigningSecret / auditChainActive', () => {
  it('returns the secret + active=true when provisioned (≥16 bytes)', () => {
    expect(getEvidenceSigningSecret()).not.toBeNull();
    expect(auditChainActive()).toBe(true);
  });
  it('returns null + active=false when unset', () => {
    setSecret(undefined);
    expect(getEvidenceSigningSecret()).toBeNull();
    expect(auditChainActive()).toBe(false);
  });
  it('returns null when the secret is too short (<16 bytes — a placeholder cannot pass)', () => {
    setSecret('short');
    expect(getEvidenceSigningSecret()).toBeNull();
    expect(auditChainActive()).toBe(false);
  });
});

describe('deriveAuditTenantKey', () => {
  it('derives a per-tenant key (null when secret absent)', () => {
    const k = deriveAuditTenantKey(TENANT);
    expect(k).not.toBeNull();
    expect(k!.byteLength).toBe(32); // HMAC-SHA256 → 32-byte key
  });
  it('different tenants derive different keys (tenant isolation)', () => {
    expect(deriveAuditTenantKey('t-a')!.equals(deriveAuditTenantKey('t-b')!)).toBe(false);
  });
  it('returns null when the secret is absent', () => {
    setSecret(undefined);
    expect(deriveAuditTenantKey(TENANT)).toBeNull();
  });
});

describe('computeRowHash', () => {
  it('is deterministic: same (row, prevHash, tenantKey) → same hash', () => {
    const k = deriveAuditTenantKey(TENANT)!;
    const r = row({ action: 'A', resource: 'R' });
    expect(computeRowHash(r, null, k)).toBe(computeRowHash(r, null, k));
  });
  it('returns null when the tenant key is null (chain inactive)', () => {
    expect(computeRowHash(row({ action: 'A', resource: 'R' }), null, null)).toBeNull();
  });
  it('changes when a hashed field changes (tamper sensitivity)', () => {
    const k = deriveAuditTenantKey(TENANT)!;
    const h1 = computeRowHash(row({ action: 'A', resource: 'R' }), null, k);
    const h2 = computeRowHash(row({ action: 'A-tampered', resource: 'R' }), null, k);
    expect(h1).not.toBe(h2);
  });
  it('changes when prevHash changes (the chain binds rows together)', () => {
    const k = deriveAuditTenantKey(TENANT)!;
    const r = row({ action: 'A', resource: 'R' });
    expect(computeRowHash(r, null, k)).not.toBe(computeRowHash(r, 'prev-hash-abc', k));
  });
  it('excludes the chain fields themselves from the hashed payload', () => {
    const k = deriveAuditTenantKey(TENANT)!;
    const base = row({ action: 'A', resource: 'R' });
    const h1 = computeRowHash({ ...base, rowHash: 'whatever', chainSeq: 99 }, null, k);
    const h2 = computeRowHash({ ...base, rowHash: 'different', chainSeq: 0 }, null, k);
    // rowHash/chainSeq are chain fields → excluded → same hash.
    expect(h1).toBe(h2);
  });
});

describe('prepareAuditChainFields', () => {
  function makeDb(latest: { rowHash: string | null; chainSeq: number | null } | null): AuditChainPrismaClient {
    return {
      auditLog: {
        findFirst: async () => latest,
      },
    };
  }
  it('chains off the latest row: prevHash=latest.rowHash, chainSeq=latest.chainSeq+1', async () => {
    const db = makeDb({ rowHash: 'abc123', chainSeq: 7 });
    const f = await prepareAuditChainFields(db, row({ action: 'A', resource: 'R' }));
    expect(f.prevHash).toBe('abc123');
    expect(f.chainSeq).toBe(8);
    expect(f.rowHash).not.toBeNull();
    expect(f.id).toMatch(/[0-9a-f-]{36}/);
  });
  it('first row in a tenant: prevHash=null, chainSeq=1', async () => {
    const db = makeDb(null);
    const f = await prepareAuditChainFields(db, row({ action: 'A', resource: 'R' }));
    expect(f.prevHash).toBeNull();
    expect(f.chainSeq).toBe(1);
  });
  it('returns rowHash=null + chainSeq=0 when the secret is absent (INACTIVE)', async () => {
    setSecret(undefined);
    const db = makeDb({ rowHash: 'abc', chainSeq: 5 });
    const f = await prepareAuditChainFields(db, row({ action: 'A', resource: 'R' }));
    expect(f.rowHash).toBeNull();
    expect(f.prevHash).toBeNull();
    expect(f.chainSeq).toBe(0);
  });
});

describe('verifyChain', () => {
  function buildChain(n: number): AuditChainRow[] {
    const k = deriveAuditTenantKey(TENANT)!;
    const rows: AuditChainRow[] = [];
    let prev: string | null = null;
    for (let i = 0; i < n; i++) {
      const r = row({
        id: `00000000-0000-4000-8000-0000000${String(i).padStart(3, '0')}`,
        action: `A${i}`,
        resource: 'R',
        createdAt: new Date(`2026-01-0${i + 1}T00:00:00.000Z`),
      });
      const rowHash = computeRowHash(r, prev, k);
      rows.push({ ...r, prevHash: prev, rowHash, chainSeq: i + 1 });
      prev = rowHash;
    }
    return rows;
  }

  it('verifies a well-formed chain', () => {
    expect(verifyChain(buildChain(3), TENANT)).toEqual({ valid: true });
  });

  it('detects a tampered row (altered action → row_hash_mismatch)', () => {
    const rows = buildChain(3);
    rows[1]!.action = 'TAMPERED'; // change a hashed field without re-signing
    const r = verifyChain(rows, TENANT);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('row_hash_mismatch');
    if (!r.valid) expect(r.rowIndex).toBe(1);
  });

  it('detects a reordered chain (broken_chain_link)', () => {
    const rows = buildChain(3);
    const [a, b, c] = rows;
    // swap rows 1 and 2 — row 2's prevHash now points to row 0, not row 1
    const reordered = [a!, c!, b!];
    const r = verifyChain(reordered, TENANT);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('broken_chain_link');
  });

  it('detects a deleted row in the middle (broken_chain_link)', () => {
    const rows = buildChain(4);
    // delete row 1 — row 2's prevHash still points to row 1's hash, but the
    // running chain after row 0 is row 0's hash ≠ row 1's hash
    const deleted = [rows[0]!, rows[2]!, rows[3]!];
    const r = verifyChain(deleted, TENANT);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('broken_chain_link');
  });

  it('detects a missing rowHash (missing_row_hash)', () => {
    const rows = buildChain(3);
    rows[1]!.rowHash = null;
    const r = verifyChain(rows, TENANT);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('missing_row_hash');
  });

  it('returns signing_unavailable when the secret is absent (chain was inactive)', () => {
    setSecret(undefined);
    const r = verifyChain(buildChain(3), TENANT);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('signing_unavailable');
  });

  it('tenant isolation: verifying with a different tenant fails (row_hash_mismatch)', () => {
    const r = verifyChain(buildChain(3), 'other-tenant');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('row_hash_mismatch');
  });

  it('verifies a single-row chain (prevHash=null)', () => {
    expect(verifyChain(buildChain(1), TENANT)).toEqual({ valid: true });
  });

  it('verifies an empty chain trivially', () => {
    expect(verifyChain([], TENANT)).toEqual({ valid: true });
  });
});