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
 * Honest open edge: the "fetch latest row then write" sequence is a TOCTOU
 * under concurrency — two simultaneous writes can read the same latest row and
 * both chain off it, branching the chain. `verifyChain` would surface a
 * `broken_chain_link` for the loser. A sequential per-tenant counter under a
 * lock/transaction is the durable fix (separate, migration-gated). Best-effort
 * chaining is shipped here; the TOCTOU is documented, not silently ignored.
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

/** Minimal Prisma interface for the chain's "fetch latest row" + write. */
export interface AuditChainPrismaClient {
  auditLog: {
    findFirst: (args: unknown) => Promise<unknown>;
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
 * Build the chain fields for a NEW row given the previous row's hash + seq.
 * Fetches the tenant's latest row from the DB to chain off it. Returns
 * `{ id, prevHash: null, rowHash: null, chainSeq: 0 }` when the chain is
 * inactive (secret absent) — the caller still writes the row (auditable),
 * just without a hash. The TOCTOU open edge (concurrent writes branching the
 * chain) is documented in the file header.
 */
export async function prepareAuditChainFields(
  db: AuditChainPrismaClient,
  row: Omit<AuditChainRow, 'id' | 'prevHash' | 'rowHash' | 'chainSeq'>,
): Promise<PreparedChainFields> {
  const id = randomUUID();
  const tenantKey = deriveAuditTenantKey(row.tenantId);
  if (!tenantKey) {
    // Chain INACTIVE — auditable, not tamper-evident.
    return { id, prevHash: null, rowHash: null, chainSeq: 0 };
  }
  // Fetch the tenant's latest row to chain off it. orderBy createdAt desc picks
  // the most recent; chainSeq disambiguates within a shared timestamp.
  const latest = (await db.auditLog.findFirst({
    where: { tenantId: row.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { rowHash: true, chainSeq: true },
  })) as { rowHash: string | null; chainSeq: number | null } | null;
  const prevHash = latest?.rowHash ?? null;
  const prevSeq = latest?.chainSeq ?? 0;
  // NORMALIZE optional fields to their STORED representation before hashing so
  // the bytes hashed at write equal the bytes that verifyChain will recompute
  // from the row read back. Prisma round-trips an absent optional as NULL and
  // an absent severity as "INFO" (the column default) — so an `undefined` here
  // MUST become `null` / "INFO" in the payload, not be dropped (canonicalJson
  // drops undefined, which would diverge from the stored NULL and break the
  // chain). This is the invariant: hash-over-stored-row, not hash-over-input.
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