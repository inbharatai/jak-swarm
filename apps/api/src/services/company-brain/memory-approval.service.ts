/**
 * memory-approval.service — agent-suggested memory approval flow.
 *
 * Agents can suggest memories to be persisted (via the existing
 * MemoryItem model + new `status` field added in migration 16). The
 * memory is created with `status='suggested'`, NOT loaded into agent
 * grounding until a reviewer approves.
 *
 * Status transitions:
 *   - extracted    → user_approved | rejected
 *   - suggested    → user_approved | rejected
 *   - user_approved → (terminal, may be soft-deleted)
 *   - rejected     → (terminal)
 *
 * Tenant-scoped at every method. No silent state change.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { AuditLogger, AuditAction } from '@jak-swarm/security';
import type { AuditPrismaClient } from '@jak-swarm/security';

export type MemoryApprovalStatus = 'extracted' | 'suggested' | 'user_approved' | 'rejected';

const ALLOWED_TRANSITIONS: Record<MemoryApprovalStatus, ReadonlySet<MemoryApprovalStatus>> = {
  extracted:     new Set(['user_approved', 'rejected']),
  suggested:     new Set(['user_approved', 'rejected']),
  user_approved: new Set(['rejected']),  // can be revoked
  rejected:      new Set(),  // terminal
};

export class IllegalMemoryTransitionError extends Error {
  constructor(public readonly from: string, public readonly to: string, public readonly memoryId: string) {
    super(`[memory] illegal transition for ${memoryId}: ${from} → ${to}. Allowed next: ${Array.from(ALLOWED_TRANSITIONS[from as MemoryApprovalStatus] ?? []).join(', ') || '(terminal)'}`);
    this.name = 'IllegalMemoryTransitionError';
  }
}

export class MemoryApprovalService {
  private readonly audit: AuditLogger;

  constructor(
    private readonly db: PrismaClient,
    _log: FastifyBaseLogger,
  ) {
    this.audit = new AuditLogger(db as unknown as AuditPrismaClient);
  }

  /**
   * Agent suggests a memory. Status='suggested' — NOT loaded into prompts
   * until a reviewer approves.
   */
  async suggest(input: {
    tenantId: string;
    suggestedBy: string;        // agentRole or workflow id
    sourceRunId: string;
    scopeType: string;
    scopeId: string;
    key: string;
    value: unknown;
    memoryType: string;
    confidence?: number;
  }): Promise<{ id: string; status: MemoryApprovalStatus }> {
    const row = await this.db.memoryItem.upsert({
      where: { tenantId_scopeType_scopeId_key: {
        tenantId: input.tenantId, scopeType: input.scopeType, scopeId: input.scopeId, key: input.key,
      } },
      create: {
        tenantId: input.tenantId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        key: input.key,
        value: input.value as object,
        memoryType: input.memoryType,
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        source: 'agent_suggestion',
        sourceRunId: input.sourceRunId,
        status: 'suggested',
        suggestedBy: input.suggestedBy,
      },
      update: {
        // If a memory already exists and is approved, do NOT silently
        // overwrite it — keep the approved version, ignore the suggestion.
        // The agent can re-suggest with a different key if it wants.
        // We bump version + lastAccessedAt only.
        lastAccessedAt: new Date(),
      },
    });

    return { id: row.id, status: row.status as MemoryApprovalStatus };
  }

  /**
   * Reviewer approves a suggested/extracted memory. Status →
   * 'user_approved'. Now visible to agent grounding.
   */
  async approve(input: { id: string; tenantId: string; reviewedBy: string }): Promise<void> {
    const row = await this.db.memoryItem.findFirst({
      where: { id: input.id, tenantId: input.tenantId },
      select: { id: true, status: true },
    });
    if (!row) throw new Error(`Memory ${input.id} not found in tenant ${input.tenantId}`);
    const cur = (row.status ?? 'user_approved') as MemoryApprovalStatus;
    if (cur === 'user_approved') return;  // idempotent
    if (!ALLOWED_TRANSITIONS[cur]?.has('user_approved')) {
      throw new IllegalMemoryTransitionError(cur, 'user_approved', input.id);
    }
    await this.db.memoryItem.update({
      where: { id: input.id },
      data: { status: 'user_approved', reviewedBy: input.reviewedBy, reviewedAt: new Date() },
    });
    void this.audit.log({
      action: AuditAction.APPROVAL_GRANTED,
      tenantId: input.tenantId,
      userId: input.reviewedBy,
      resource: 'memory_item',
      resourceId: input.id,
      details: { from: cur, to: 'user_approved' },
    }).catch(() => {});
  }

  /**
   * Reviewer rejects. Status → 'rejected'. Memory remains in DB for
   * audit trail but never loaded into agent prompts.
   */
  async reject(input: { id: string; tenantId: string; reviewedBy: string; reason?: string }): Promise<void> {
    const row = await this.db.memoryItem.findFirst({
      where: { id: input.id, tenantId: input.tenantId },
      select: { id: true, status: true },
    });
    if (!row) throw new Error(`Memory ${input.id} not found in tenant ${input.tenantId}`);
    const cur = (row.status ?? 'user_approved') as MemoryApprovalStatus;
    if (cur === 'rejected') return;  // idempotent
    if (!ALLOWED_TRANSITIONS[cur]?.has('rejected')) {
      throw new IllegalMemoryTransitionError(cur, 'rejected', input.id);
    }
    await this.db.memoryItem.update({
      where: { id: input.id },
      data: { status: 'rejected', reviewedBy: input.reviewedBy, reviewedAt: new Date() },
    });
    void this.audit.log({
      action: AuditAction.APPROVAL_REJECTED,
      tenantId: input.tenantId,
      userId: input.reviewedBy,
      resource: 'memory_item',
      resourceId: input.id,
      details: { from: cur, to: 'rejected', reason: input.reason },
    }).catch(() => {});
  }

  /**
   * List pending memories (status in {extracted, suggested}) for review.
   */
  async listPending(input: { tenantId: string; limit?: number; offset?: number }): Promise<{ items: unknown[]; total: number }> {
    const where = { tenantId: input.tenantId, status: { in: ['extracted', 'suggested'] }, deletedAt: null };
    const [items, total] = await Promise.all([
      this.db.memoryItem.findMany({ where, orderBy: { createdAt: 'desc' }, take: input.limit ?? 50, skip: input.offset ?? 0 }),
      this.db.memoryItem.count({ where }),
    ]);
    return { items, total };
  }
}
