/**
 * audit-log-chain.test.ts — HyperAgent Phase 7 AuditLog HMAC row-chain integration.
 *
 * Drives the REAL `AuditLogger.log` write path (Phase 7 threading) against an
 * in-memory Prisma stub and verifies the resulting rows form a valid HMAC chain
 * via the REAL `verifyChain`. Then proves tamper detection: mutating a stored
 * row's hashed field (without re-signing) makes `verifyChain` fail.
 *
 * Honest scope: the AuditLogger + chain primitives are exercised for real; the
 * only stub is the Prisma client (a tiny in-memory store). Live Postgres
 * round-trip is env-blocked here. The TOCTOU fix (concurrent same-tenant writes
 * cannot branch the chain) is proven against real Postgres in
 * audit-chain-concurrency.test.ts (PR E).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AuditLogger,
  AuditAction,
  verifyChain,
  type AuditChainRow,
  type AuditPrismaClient,
} from '../../packages/security/src/index.js';

interface StoredRow {
  id: string;
  action: string;
  tenantId: string;
  userId: string | null;
  resource: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  severity: string;
  createdAt: Date;
  prevHash: string | null;
  rowHash: string | null;
  chainSeq: number;
}

function makeInMemoryDb(): AuditPrismaClient & { rows: StoredRow[] } {
  const rows: StoredRow[] = [];
  const doCreate = (args: { data: { id: string; action: string; tenantId: string; userId: string | null; resource: string; resourceId: string | null; details: Record<string, unknown>; ip: string | null; userAgent: string | null; severity: string; createdAt: Date; prevHash: string | null; rowHash: string | null; chainSeq: number } }): { id: string } => {
    const d = args.data;
    const stored: StoredRow = {
      id: d.id,
      action: d.action,
      tenantId: d.tenantId,
      userId: d.userId,
      resource: d.resource,
      resourceId: d.resourceId,
      details: d.details,
      ip: d.ip,
      userAgent: d.userAgent,
      severity: d.severity,
      createdAt: d.createdAt,
      prevHash: d.prevHash,
      rowHash: d.rowHash,
      chainSeq: d.chainSeq,
    };
    rows.push(stored);
    return { id: stored.id };
  };
  // The transaction runner the atomic append path uses: lock is a noop
  // (single-writer test), findFirst returns the latest SIGNED row by chainSeq.
  const runner = {
    $executeRawUnsafe: async () => [],
    auditLog: {
      findFirst: async (args: unknown) => {
        const a = args as { where: { tenantId: string; rowHash?: { not: null } } };
        let matching = rows.filter((r) => r.tenantId === a.where.tenantId);
        if (a.where.rowHash) matching = matching.filter((r) => r.rowHash !== null);
        if (matching.length === 0) return null;
        const sorted = [...matching].sort((x, y) => y.chainSeq - x.chainSeq);
        return { rowHash: sorted[0]!.rowHash, chainSeq: sorted[0]!.chainSeq };
      },
      create: async (args: { data: Parameters<typeof doCreate>[0]['data'] }) => doCreate(args),
    },
  };
  const db: AuditPrismaClient = {
    $transaction: async (fn) => fn(runner as never),
    auditLog: {
      // Used by the INACTIVE / unsigned-fallback path (no transaction).
      create: async (args: { data: Parameters<typeof doCreate>[0]['data'] }) => doCreate(args),
    },
  };
  return Object.assign(db, { rows });
}

function setSecret(v: string | undefined) {
  if (v === undefined) delete process.env['EVIDENCE_SIGNING_SECRET'];
  else process.env['EVIDENCE_SIGNING_SECRET'] = v;
}

const SECRET = 'x'.repeat(48);
const TENANT = 'tenant-1';

beforeEach(() => setSecret(SECRET));
afterEach(() => setSecret(undefined));

function toChainRow(r: StoredRow): AuditChainRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    action: r.action,
    resource: r.resource,
    resourceId: r.resourceId,
    details: r.details,
    ip: r.ip,
    userAgent: r.userAgent,
    severity: r.severity,
    createdAt: r.createdAt,
    prevHash: r.prevHash,
    rowHash: r.rowHash,
    chainSeq: r.chainSeq,
  };
}

describe('Phase 7 — AuditLogger HMAC row-chain (integration)', () => {
  it('writes 3 rows that form a valid chain (verifyChain passes)', async () => {
    const db = makeInMemoryDb();
    const logger = new AuditLogger(db);
    const base = Date.now();
    for (let i = 0; i < 3; i++) {
      await logger.log({
        action: AuditAction.WORKFLOW_CREATED,
        tenantId: TENANT,
        userId: `u${i}`,
        resource: 'workflow',
        resourceId: `wf-${i}`,
        details: { step: i },
        severity: 'INFO',
      });
      // ensure monotonic createdAt across awaits (Date.now is fine in tests)
      await new Promise((res) => setTimeout(res, 1));
      void base;
    }
    expect(db.rows).toHaveLength(3);
    // every row is signed (secret present → chain active)
    expect(db.rows.every((r) => r.rowHash !== null)).toBe(true);
    // chainSeq is monotonic per tenant
    expect(db.rows.map((r) => r.chainSeq)).toEqual([1, 2, 3]);
    // prevHash links each row to the prior row's rowHash
    expect(db.rows[1]!.prevHash).toBe(db.rows[0]!.rowHash);
    expect(db.rows[2]!.prevHash).toBe(db.rows[1]!.rowHash);
    // verifyChain over the ordered chain
    const result = verifyChain(db.rows.map(toChainRow), TENANT);
    expect(result).toEqual({ valid: true });
  });

  it('detects tampering: altering a stored row breaks verifyChain', async () => {
    const db = makeInMemoryDb();
    const logger = new AuditLogger(db);
    for (let i = 0; i < 3; i++) {
      await logger.log({
        action: AuditAction.WORKFLOW_STARTED,
        tenantId: TENANT,
        userId: `u${i}`,
        resource: 'workflow',
        resourceId: `wf-${i}`,
        details: { step: i },
      });
      await new Promise((res) => setTimeout(res, 1));
    }
    // tamper the middle row's hashed payload (action) without re-signing
    db.rows[1]!.action = 'TAMPERED';
    const result = verifyChain(db.rows.map(toChainRow), TENANT);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('row_hash_mismatch');
      expect(result.rowIndex).toBe(1);
    }
  });

  it('writes UNSIGNED rows (rowHash=null, chain INACTIVE) when the secret is absent', async () => {
    setSecret(undefined);
    const db = makeInMemoryDb();
    const logger = new AuditLogger(db);
    await logger.log({
      action: AuditAction.USER_LOGIN,
      tenantId: TENANT,
      userId: 'u1',
      resource: 'user',
      resourceId: 'u1',
      details: {},
    });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]!.rowHash).toBeNull();
    expect(db.rows[0]!.prevHash).toBeNull();
    expect(db.rows[0]!.chainSeq).toBe(0);
    // verifyChain surfaces signing_unavailable (NOT silently valid)
    const result = verifyChain(db.rows.map(toChainRow), TENANT);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('signing_unavailable');
  });

  it('isolates chains per tenant (two tenants each get their own chainSeq)', async () => {
    const db = makeInMemoryDb();
    const logger = new AuditLogger(db);
    await logger.log({ action: AuditAction.WORKFLOW_CREATED, tenantId: 't-a', resource: 'w', details: {} });
    await logger.log({ action: AuditAction.WORKFLOW_CREATED, tenantId: 't-b', resource: 'w', details: {} });
    await logger.log({ action: AuditAction.WORKFLOW_CREATED, tenantId: 't-a', resource: 'w', details: {} });
    const a = db.rows.filter((r) => r.tenantId === 't-a');
    const b = db.rows.filter((r) => r.tenantId === 't-b');
    expect(a.map((r) => r.chainSeq)).toEqual([1, 2]);
    expect(b.map((r) => r.chainSeq)).toEqual([1]);
    // each tenant chain verifies independently
    expect(verifyChain(a.map(toChainRow), 't-a')).toEqual({ valid: true });
    expect(verifyChain(b.map(toChainRow), 't-b')).toEqual({ valid: true });
  });
});