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
 */
export interface AuditPrismaClient {
  auditLog: {
    create: (args: {
      data: {
        action: string;
        tenantId: string;
        userId?: string;
        resource: string;
        resourceId?: string;
        details: Record<string, unknown>;
        ip?: string;
        severity: string;
        createdAt: Date;
      };
    }) => Promise<{ id: string }>;
  };
}

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
      await this.db.auditLog.create({
        data: {
          action: entry.action,
          tenantId: entry.tenantId,
          ...(entry.userId !== undefined && { userId: entry.userId }),
          resource: entry.resource,
          ...(entry.resourceId !== undefined && { resourceId: entry.resourceId }),
          details: entry.details as Record<string, unknown>,
          ...(entry.ip !== undefined && { ip: entry.ip }),
          severity: entry.severity ?? 'INFO',
          createdAt: entry.createdAt,
        },
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
  const noopDb: AuditPrismaClient = {
    auditLog: {
      create: async () => ({ id: crypto.randomUUID() }),
    },
  };
  return new AuditLogger(noopDb, () => {});
}
