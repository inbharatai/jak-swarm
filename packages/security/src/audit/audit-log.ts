import { appendChainedAuditRow, type AuditChainAppendClient } from './audit-chain.js';

export enum AuditAction {
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  // Hardening pass: full lifecycle coverage so the Audit & Compliance
  // product can replay every workflow transition deterministically.
  WORKFLOW_CREATED = 'WORKFLOW_CREATED',
  WORKFLOW_PLANNED = 'WORKFLOW_PLANNED',
  WORKFLOW_STARTED = 'WORKFLOW_STARTED',
  WORKFLOW_STEP_STARTED = 'WORKFLOW_STEP_STARTED',
  WORKFLOW_STEP_COMPLETED = 'WORKFLOW_STEP_COMPLETED',
  WORKFLOW_STEP_FAILED = 'WORKFLOW_STEP_FAILED',
  WORKFLOW_RESUMED = 'WORKFLOW_RESUMED',
  WORKFLOW_COMPLETED = 'WORKFLOW_COMPLETED',
  WORKFLOW_CANCELLED = 'WORKFLOW_CANCELLED',
  WORKFLOW_FAILED = 'WORKFLOW_FAILED',
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  APPROVAL_GRANTED = 'APPROVAL_GRANTED',
  APPROVAL_REJECTED = 'APPROVAL_REJECTED',
  APPROVAL_DEFERRED = 'APPROVAL_DEFERRED',
  SKILL_APPROVED = 'SKILL_APPROVED',
  SKILL_REJECTED = 'SKILL_REJECTED',
  SKILL_PROPOSED = 'SKILL_PROPOSED',
  SKILL_DEPRECATED = 'SKILL_DEPRECATED',
  TOOL_EXECUTED = 'TOOL_EXECUTED',
  TOOL_BLOCKED = 'TOOL_BLOCKED',
  MEMORY_WRITTEN = 'MEMORY_WRITTEN',
  MEMORY_READ = 'MEMORY_READ',
  MEMORY_DELETED = 'MEMORY_DELETED',
  GUARDRAIL_TRIGGERED = 'GUARDRAIL_TRIGGERED',
  PII_DETECTED = 'PII_DETECTED',
  INJECTION_DETECTED = 'INJECTION_DETECTED',
  ADMIN_ACTION = 'ADMIN_ACTION',
  TENANT_SETTINGS_CHANGED = 'TENANT_SETTINGS_CHANGED',
  USER_CREATED = 'USER_CREATED',
  USER_ROLE_CHANGED = 'USER_ROLE_CHANGED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INDUSTRY_PACK_SELECTED = 'INDUSTRY_PACK_SELECTED',
  COMPANY_ARTIFACT_INGESTED = 'COMPANY_ARTIFACT_INGESTED',
  COMPANY_ENTITY_EXTRACTED = 'COMPANY_ENTITY_EXTRACTED',
  EXECUTION_DRIFT_DETECTED = 'EXECUTION_DRIFT_DETECTED',
  AGENT_SPEC_GENERATED = 'AGENT_SPEC_GENERATED',
  AGENT_SPEC_APPROVED = 'AGENT_SPEC_APPROVED',
  AGENT_SPEC_REJECTED = 'AGENT_SPEC_REJECTED',
  /** Phase 6 — an approved spec was executed via the closed loop (materialise
   *  → run → harvest → acceptance verdict). The details carry the verdict. */
  AGENT_SPEC_EXECUTED = 'AGENT_SPEC_EXECUTED',
  /** PR E (Phase 10) — a ShieldMcpClient signed, Ed25519-verifiable decision was
   *  issued for a live input scan and recorded in the audit chain. The details
   *  carry `decisionId` (resourceId), `verdict`, `shieldId`, the signed
   *  `subject` (kind `input_scan` + `requestHash`), issue/expiry times, and the
   *  scan's block reasons — enough to `replayDecision` the exact signed verdict
   *  later. Severity WARN when the Shield blocked, INFO otherwise. */
  SHIELD_DECISION_SIGNED = 'SHIELD_DECISION_SIGNED',
}

export interface AuditEvent {
  action: AuditAction;
  tenantId: string;
  userId?: string;
  resource: string;
  resourceId?: string;
  details: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  severity?: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
}

export interface AuditLogEntry extends AuditEvent {
  id: string;
  createdAt: Date;
}

/**
 * Minimal Prisma client interface for audit logging.
 * This allows using the AuditLogger without importing the full Prisma client.
 *
 * PR E — the live write path is the ATOMIC `appendChainedAuditRow`
 * (per-tenant `pg_advisory_xact_lock` + partial-unique backstop), so this
 * interface now requires `$transaction` + a raw-SQL-capable runner. The loose
 * typing keeps `packages/security` free of a `@jak-swarm/db` import.
 */
export interface AuditPrismaClient extends AuditChainAppendClient {}

export class AuditLogger {
  private readonly db: AuditPrismaClient;
  private readonly fallbackLogger: (entry: AuditLogEntry) => void;

  constructor(
    db: AuditPrismaClient,
    fallbackLogger?: (entry: AuditLogEntry) => void,
  ) {
    this.db = db;
    this.fallbackLogger = fallbackLogger ?? ((entry) => {
      console.log('[AUDIT]', JSON.stringify({
        id: entry.id,
        action: entry.action,
        tenantId: entry.tenantId,
        userId: entry.userId,
        resource: entry.resource,
        resourceId: entry.resourceId,
        severity: entry.severity,
        createdAt: entry.createdAt.toISOString(),
      }));
    });
  }

  async log(event: AuditEvent): Promise<void> {
    const entry: AuditLogEntry = {
      ...event,
      id: crypto.randomUUID(),
      severity: event.severity ?? this.inferSeverity(event.action),
      createdAt: new Date(),
    };

    try {
      // PR E — ATOMIC append: the fetch-latest + chain-field compute + insert
      // run inside one `pg_advisory_xact_lock(hashtext(tenantId))`-guarded
      // transaction with a partial-unique backstop, so concurrent writers for
      // the same tenant cannot branch the chain. INACTIVE (rowHash=null,
      // chainSeq=0) when EVIDENCE_SIGNING_SECRET is unset; the atomic append
      // also fail-opens to an unsigned write if the transaction itself throws
      // (unique violation / connection loss). Audit logging MUST NOT break.
      await appendChainedAuditRow(this.db, {
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        details: entry.details as unknown,
        ip: entry.ip,
        userAgent: entry.userAgent,
        severity: entry.severity,
        createdAt: entry.createdAt,
      });
    } catch (err) {
      // Never let audit logging failure break the main flow
      // Fall back to console logging
      this.fallbackLogger(entry);
      console.error('[AuditLogger] Failed to write to DB:', err);
    }
  }

  async logBatch(events: AuditEvent[]): Promise<void> {
    await Promise.allSettled(events.map((e) => this.log(e)));
  }

  private inferSeverity(action: AuditAction): 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL' {
    switch (action) {
      case AuditAction.INJECTION_DETECTED:
      case AuditAction.GUARDRAIL_TRIGGERED:
      case AuditAction.TOOL_BLOCKED:
        return 'WARN';
      case AuditAction.WORKFLOW_FAILED:
      case AuditAction.PERMISSION_DENIED:
        return 'ERROR';
      case AuditAction.PII_DETECTED:
        return 'WARN';
      default:
        return 'INFO';
    }
  }
}

/**
 * Create a no-op audit logger for testing.
 */
export function createNullAuditLogger(): AuditLogger {
  const noopRunner = {
    $executeRawUnsafe: async () => [],
    auditLog: {
      findFirst: async () => null,
      create: async () => ({ id: crypto.randomUUID() }),
    },
  };
  const noopDb: AuditPrismaClient = {
    $transaction: async (fn) => fn(noopRunner),
    auditLog: {
      create: async () => ({ id: crypto.randomUUID() }),
    },
  };
  return new AuditLogger(noopDb, () => {});
}
