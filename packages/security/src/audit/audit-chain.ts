/**
 * audit-chain.ts — HyperAgent Phase 7 AuditLog HMAC row-chain hashing.
 *
 * Tamper-evidence for the audit log: each row's `rowHash` is
 *   HMAC-SHA256(tenantKey, canonicalJson({ ...row, prevHash }))
 * where `tenantKey = HMAC-SHA256(EVIDENCE_SIGNING_SECRET, tenantId)` and
 * `prevHash` is the prior row's `rowHash`. The rows form a per-tenant chain —
 * altering any row (or reordering/inserting/deleting) breaks the chain, which
 * `verifyChain` detects by recomputing + constant-time comparing each hash.
 *
 * Key derivation (mirrors bundle-signing.service.ts, intentionally tenant-scoped
 * without per-tenant DB columns):
 *   server_secret = process.env.EVIDENCE_SIGNING_SECRET  (operator-managed,
 *                 separate from AUTH_SECRET so rotating one doesn't invalidate
 *                 the other; ≥16 bytes enforced, ≥32 recommended)
 *   tenant_key    = HMAC-SHA256(server_secret, tenantId)
 *   row_hash      = HMAC-SHA256(tenant_key, canonicalJson({ ...row, prevHash }))
 *
 * FAIL-OPEN-TO-AUDITABLE (NOT fail-closed): when EVIDENCE_SIGNING_SECRET is
 * unset/short, the chain runs INACTIVE — `rowHash = null` + `chainSeq = 0` and
 * a warn is logged. Audit logging MUST NOT break when the secret is absent (an
 * operator who hasn't provisioned it still gets audit logging, just without
 * tamper-evidence). `verifyChain` surfaces `signing_unavailable` so a reviewer
 * knows the chain was inactive rather than silently trusting null hashes.
 *
 * `canonicalJson` is DUPLICATED here (not imported from apps/api) to avoid an
 * api → security circular import. The two copies are intentionally identical;
 * keep them in sync if the canonicalisation rule changes.
 *
 * Honest open edge (CLOSED in PR E for the live path): the "fetch latest row
 * then write" sequence WAS a TOCTOU under concurrency — two simultaneous
 * writes could read the same latest row and both chain off it, branching the
 * chain. {@link appendChainedAuditRow} closes it: the fetch+compute+insert run
 * inside one `pg_advisory_xact_lock(hashtext(tenantId))`-guarded transaction
 * with a partial `UNIQUE (tenantId, chainSeq) WHERE rowHash IS NOT NULL`
 * backstop (migration 122_audit_chain_unique_seq). The legacy
 * {@link prepareAuditChainFields} (fetch-then-compute, no lock) is retained for
 * unit tests of the pure decision; live writes use the atomic path.
 */
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export const AUDIT_CHAIN_ALGO = 'HMAC-SHA256';
/** Minimum server-secret length (matches bundle-signing.service.ts). ≥32 bytes
 *  is recommended; ≥16 is enforced so a placeholder value can't pass. */
const MIN_SECRET_BYTES = 16;

/**
 * Deterministic canonical JSON: sorted object keys, preserved array order,
 * dropped undefineds. Two equivalent objects always produce the same signed
 * bytes — critical for hash stability across Node versions / insertion order.
 */
export function canonicalJson(value: unknown): string {
  const stable = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(stable);
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      const x = obj[k];
      if (x !== undefined) out[k] = stable(x);
    }
    return out;
  };
  return JSON.stringify(stable(value));
}

/**
 * The server-wide evidence-signing secret. Returns null when unset/short —
 * the chain runs INACTIVE (rowHash=null), auditable but not tamper-evident.
 * Never throws.
 */
export function getEvidenceSigningSecret(): Buffer | null {
  const raw = process.env['EVIDENCE_SIGNING_SECRET']?.trim();
  if (!raw || raw.length < MIN_SECRET_BYTES) return null;
  return Buffer.from(raw, 'utf8');
}

/** True when the chain is ACTIVE (secret provisioned). */
export function auditChainActive(): boolean {
  return getEvidenceSigningSecret() !== null;
}

/**
 * Derive the per-tenant HMAC key. Returns null when the server secret is
 * absent (chain inactive for ALL tenants).
 */
export function deriveAuditTenantKey(tenantId: string): Buffer | null {
  const serverSecret = getEvidenceSigningSecret();
  if (!serverSecret) return null;
  return createHmac('sha256', serverSecret).update(tenantId).digest();
}

/**
 * The audit row shape the chain hashes over. The chain fields themselves
 * (`prevHash` / `rowHash` / `chainSeq`) are EXCLUDED from the hashed payload —
 * they ARE the chain, and `prevHash` is folded in as a separate field.
 */
export interface AuditChainRow {
  id: string;
  tenantId: string;
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  details?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  severity?: string;
  createdAt: Date | string;
  // chain fields — excluded from the hash payload (see computeRowHash):
  prevHash?: string | null;
  rowHash?: string | null;
  chainSeq?: number;
}

/** Minimal Prisma interface for the chain's "fetch latest row" (pure-core path). */
export interface AuditChainPrismaClient {
  auditLog: {
    findFirst: (args: unknown) => Promise<unknown>;
  };
}

/**
 * The create payload `appendChainedAuditRow` writes inside its transaction.
 * Mirrors `AuditChainRow` minus the chain fields (which are computed) plus the
 * normalized-to-stored representation (null for absent optionals) so the bytes
 * hashed at write equal the bytes `verifyChain` recomputes from the read-back.
 */
export interface AuditChainCreateData {
  id: string;
  tenantId: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  details: unknown;
  ip: string | null;
  userAgent: string | null;
  severity: string;
  createdAt: Date | string;
  prevHash: string | null;
  rowHash: string | null;
  chainSeq: number;
}

/** Transaction runner exposed inside `appendClient.$transaction(fn)`. */
export interface AuditChainTxRunner {
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown>;
  auditLog: {
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: { data: AuditChainCreateData }) => Promise<{ id: string }>;
  };
}

/**
 * Client for the atomic append path: must expose an interactive `$transaction`
 * whose runner can run raw SQL (the advisory lock) + findFirst + create on
 * `auditLog`. Prisma's `PrismaClient` satisfies this; the loose typing keeps
 * `packages/security` free of a `@jak-swarm/db` import (no circular dep).
 */
export interface AuditChainAppendClient {
  $transaction: <R>(fn: (tx: AuditChainTxRunner) => Promise<R>) => Promise<R>;
  /** Used only by the INACTIVE / fallback unsigned write path. */
  auditLog: {
    create: (args: { data: AuditChainCreateData }) => Promise<{ id: string }>;
  };
}

/** The chain fields to merge into an `auditLog.create` data payload. */
export interface PreparedChainFields {
  /** Client-generated row id, included in the hashed payload (so the hash
   *  covers a stable id known before the row is persisted). */
  id: string;
  prevHash: string | null;
  rowHash: string | null;
  chainSeq: number;
}

/**
 * Compute a row's hash = HMAC-SHA256(tenantKey, canonicalJson({ ...row (minus
 * chain fields), prevHash })). `prevHash` binds this row to the prior row,
 * forming the chain. Returns null when the tenantKey is null (chain inactive).
 * Pure given (row, prevHash, tenantKey).
 */
export function computeRowHash(
  row: AuditChainRow,
  prevHash: string | null,
  tenantKey: Buffer | null,
): string | null {
  if (!tenantKey) return null;
  // Exclude the chain fields from the payload — they are the chain itself.
  const { prevHash: _ph, rowHash: _rh, chainSeq: _cs, ...rest } = row;
  void _ph; void _rh; void _cs;
  const payload = canonicalJson({ ...rest, prevHash });
  return createHmac('sha256', tenantKey).update(payload).digest('hex');
}

/**
 * PURE core: build the chain fields for a NEW row given the previous row's
 * `{ rowHash, chainSeq }` + the per-tenant key. No I/O, no clock, no process
 * env. The deterministic gate both the atomic live path
 * (`appendChainedAuditRow`) and the legacy `prepareAuditChainFields` enforce.
 *
 * `latest` is the tenant's most-recent SIGNED row (`rowHash` non-null) under
 * the ordering the caller chose. `prevHash = latest.rowHash ?? null`,
 * `chainSeq = (latest.chainSeq ?? 0) + 1`. Optional fields are NORMALIZED to
 * their STORED representation (null for absent optionals, "INFO" for absent
 * severity) so the bytes hashed at write equal the bytes `verifyChain`
 * recomputes from the read-back row — the hash-over-stored-row invariant.
 */
export function buildChainFields(
  row: Omit<AuditChainRow, 'id' | 'prevHash' | 'rowHash' | 'chainSeq'>,
  latest: { rowHash: string | null; chainSeq: number | null } | null,
  tenantKey: Buffer,
  id: string = randomUUID(),
): PreparedChainFields {
  const prevHash = latest?.rowHash ?? null;
  const prevSeq = latest?.chainSeq ?? 0;
  const normalized: AuditChainRow = {
    id,
    tenantId: row.tenantId,
    userId: row.userId ?? null,
    action: row.action,
    resource: row.resource,
    resourceId: row.resourceId ?? null,
    details: row.details ?? null,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    severity: row.severity ?? 'INFO', // matches AuditLog.severity @default("INFO")
    createdAt: row.createdAt,
  };
  const rowHash = computeRowHash(normalized, prevHash, tenantKey);
  return { id, prevHash, rowHash, chainSeq: prevSeq + 1 };
}

/**
 * LEGACY non-atomic chain-field builder (fetch latest then compute). Retained
 * for unit tests of the pure decision + callers that cannot run an interactive
 * transaction. Live writes MUST use {@link appendChainedAuditRow}, which wraps
 * the fetch+compute+insert in one `pg_advisory_xact_lock`-guarded transaction
 * so concurrent tenant writes cannot branch the chain. The TOCTOU open edge
 * documented in the file header applies to THIS function, not the atomic path.
 */
export async function prepareAuditChainFields(
  db: AuditChainPrismaClient,
  row: Omit<AuditChainRow, 'id' | 'prevHash' | 'rowHash' | 'chainSeq'>,
): Promise<PreparedChainFields> {
  const tenantKey = deriveAuditTenantKey(row.tenantId);
  if (!tenantKey) {
    // Chain INACTIVE — auditable, not tamper-evident.
    return { id: randomUUID(), prevHash: null, rowHash: null, chainSeq: 0 };
  }
  const latest = (await db.auditLog.findFirst({
    where: { tenantId: row.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { rowHash: true, chainSeq: true },
  })) as { rowHash: string | null; chainSeq: number | null } | null;
  return buildChainFields(row, latest, tenantKey);
}

/**
 * Build the `auditLog.create` data payload from a row + prepared chain fields.
 * Shared by the atomic path + the unsigned fallback so both write the SAME
 * normalized-to-stored representation that was hashed (preserving the
 * hash-over-stored-row invariant on both paths).
 */
export function buildAuditCreateData(
  row: Omit<AuditChainRow, 'id' | 'prevHash' | 'rowHash' | 'chainSeq'>,
  chain: PreparedChainFields,
): AuditChainCreateData {
  return {
    id: chain.id,
    tenantId: row.tenantId,
    userId: row.userId ?? null,
    action: row.action,
    resource: row.resource,
    resourceId: row.resourceId ?? null,
    details: row.details ?? null,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    severity: row.severity ?? 'INFO',
    createdAt: row.createdAt,
    prevHash: chain.prevHash,
    rowHash: chain.rowHash,
    chainSeq: chain.chainSeq,
  };
}

/**
 * ATOMIC append — the durable fix for the audit-chain TOCTOU. Appends one
 * chained row to the tenant's chain inside a single interactive transaction
 * that:
 *   1. acquires `pg_advisory_xact_lock(hashtext(tenantId))` — a per-tenant
 *      transaction-scoped lock that serializes concurrent writers for the SAME
 *      tenant (released at COMMIT/ROLLBACK, so different tenants proceed in
 *      parallel);
 *   2. fetches the tenant's latest SIGNED row ordered by `chainSeq` desc
 *      (deterministic — no `createdAt`-tie ambiguity);
 *   3. computes the chain fields via the pure {@link buildChainFields};
 *   4. inserts the row — all under the lock, so two concurrent appends for the
 *      same tenant can never read the same latest row + both chain off it.
 *
 * The DB-side backstop is the partial `UNIQUE (tenantId, chainSeq) WHERE
 * rowHash IS NOT NULL` index (migration 122) — if anything ever slips the lock,
 * the second writer's insert hits a unique violation and the transaction
 * aborts (caught here → unsigned fallback write, auditable, never silent).
 *
 * FAIL-OPEN-TO-AUDITABLE (NOT fail-closed): when `EVIDENCE_SIGNING_SECRET` is
 * unset/short, the chain runs INACTIVE — the row is written unsigned
 * (`rowHash=null`, `chainSeq=0`) with no lock/transaction. When the atomic
 * append itself throws (unique violation, connection loss), the row is STILL
 * written unsigned — audit logging must never break. `verifyChain` surfaces
 * `signing_unavailable` for the inactive path so a reviewer knows.
 *
 * Returns the persisted row id.
 */
export async function appendChainedAuditRow(
  db: AuditChainAppendClient,
  row: Omit<AuditChainRow, 'id' | 'prevHash' | 'rowHash' | 'chainSeq'>,
): Promise<string> {
  const tenantKey = deriveAuditTenantKey(row.tenantId);
  if (!tenantKey) {
    // Chain INACTIVE — write unsigned directly (no lock/tx; the partial unique
    // index excludes rowHash-null rows so chainSeq=0 never conflicts).
    const chain: PreparedChainFields = { id: randomUUID(), prevHash: null, rowHash: null, chainSeq: 0 };
    await db.auditLog.create({ data: buildAuditCreateData(row, chain) });
    return chain.id;
  }
  try {
    return await db.$transaction(async (tx) => {
      // Per-tenant transaction-scoped advisory lock. hashtext(tenantId) → int4;
      // the single-arg pg_advisory_xact_lock(int4) form. Different tenants may
      // hash-collide (serialized unnecessarily, correctness preserved).
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', row.tenantId);
      const latest = (await tx.auditLog.findFirst({
        where: { tenantId: row.tenantId, rowHash: { not: null } },
        orderBy: [{ chainSeq: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { rowHash: true, chainSeq: true },
      })) as { rowHash: string | null; chainSeq: number | null } | null;
      const chain = buildChainFields(row, latest, tenantKey);
      await tx.auditLog.create({ data: buildAuditCreateData(row, chain) });
      return chain.id;
    });
  } catch (err) {
    // Atomic append failed (unique violation on the backstop index, connection
    // loss, etc). FAIL-OPEN-TO-AUDITABLE: still write the row unsigned so audit
    // logging never breaks. The partial unique index excludes rowHash-null rows
    // so this fallback insert cannot itself conflict. NOT silent — verifyChain
    // surfaces signing_unavailable for any null-hash row.
    console.error('[audit-chain] atomic append failed (writing unsigned):', err);
    const chain: PreparedChainFields = { id: randomUUID(), prevHash: null, rowHash: null, chainSeq: 0 };
    await db.auditLog.create({ data: buildAuditCreateData(row, chain) });
    return chain.id;
  }
}

export type VerifyChainResult =
  | { valid: true }
  | { valid: false; reason: 'signing_unavailable'; rowIndex: number }
  | { valid: false; reason: 'missing_row_hash'; rowIndex: number }
  | { valid: false; reason: 'broken_chain_link'; rowIndex: number }
  | { valid: false; reason: 'row_hash_mismatch'; rowIndex: number };

/**
 * Verify a chain of rows: recompute each row's hash from its payload + the
 * prior row's hash, and compare in constant time. Returns `{ valid: true }` or
 * `{ valid: false, reason, rowIndex }`. `signing_unavailable` when the tenant
 * key is null (the chain was inactive — can't verify null hashes).
 *
 * The rows MUST be ordered by `chainSeq` ascending within the tenant before
 * verification — the caller is responsible for the ordering.
 */
export function verifyChain(rows: AuditChainRow[], tenantId: string): VerifyChainResult {
  const tenantKey = deriveAuditTenantKey(tenantId);
  if (!tenantKey) return { valid: false, reason: 'signing_unavailable', rowIndex: -1 };
  let prevHash: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    // The row's prevHash must match the running chain (catches reordering /
    // insertion / deletion — a row whose prevHash doesn't match the prior
    // row's hash is a broken link).
    if ((row.prevHash ?? null) !== prevHash) {
      return { valid: false, reason: 'broken_chain_link', rowIndex: i };
    }
    const actual = row.rowHash ?? null;
    if (actual === null) {
      return { valid: false, reason: 'missing_row_hash', rowIndex: i };
    }
    const expected = computeRowHash(row, prevHash, tenantKey);
    if (expected === null) {
      return { valid: false, reason: 'signing_unavailable', rowIndex: i };
    }
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: 'row_hash_mismatch', rowIndex: i };
    }
    prevHash = actual;
  }
  return { valid: true };
}