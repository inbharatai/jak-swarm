/**
 * audit routes — the Audit & Compliance product surface (v0).
 *
 * Read-only views over the foundation (lifecycle events, agent traces,
 * approvals, artifacts, audit log) so a tenant admin / reviewer / auditor
 * can:
 *   - Inspect the full audit log of who-did-what-when
 *   - Drill into a single workflow's chronological trail
 *   - Triage pending approval gates (workflow approvals + artifact downloads)
 *   - See compliance metrics at a glance
 *
 * All routes are tenant-scoped via `request.user.tenantId`. Reviewer/admin
 * gating is enforced at the route level — VIEWERs can read the audit log
 * but cannot see reviewer queues, dashboards are admin-only.
 *
 * NOT in v0:
 *   - Custom control frameworks (SOC2/HIPAA mappings)
 *   - Auto-generated control attestations
 *   - Scheduled exports to customer S3 / GCS
 *   - Per-control evidence packaging
 * Those are documented as Phase 2 in qa/audit-compliance-v0-status.md.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';

// ─── Query schemas ──────────────────────────────────────────────────────

const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().optional(),
  resource: z.string().optional(),
  resourceId: z.string().optional(),
  userId: z.string().optional(),
  /** ISO datetime — entries created at or after this time. */
  from: z.string().optional(),
  /** ISO datetime — entries created at or before this time. */
  to: z.string().optional(),
  /** Free-text search over `action` and `resource`. */
  q: z.string().optional(),
});

const reviewerQueueQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Optional risk-level filter for workflow approvals. */
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────

interface TimelineEvent {
  at: string; // ISO timestamp
  source: 'lifecycle' | 'trace' | 'approval' | 'artifact';
  type: string;
  details: Record<string, unknown>;
}

/**
 * Build a chronologically-sorted unified trail for a single workflow.
 * Pulls audit-log lifecycle events + agent traces + approvals + artifacts
 * and merges them into one stream the UI renders top-to-bottom.
 */
async function buildWorkflowTrail(
  fastify: { db: { auditLog: { findMany: (a: unknown) => Promise<unknown[]> }; agentTrace: { findMany: (a: unknown) => Promise<unknown[]> }; approvalRequest: { findMany: (a: unknown) => Promise<unknown[]> }; workflowArtifact: { findMany: (a: unknown) => Promise<unknown[]> } } },
  workflowId: string,
  tenantId: string,
): Promise<TimelineEvent[]> {
  const [auditRows, traces, approvals, artifactRowsRaw] = await Promise.all([
    fastify.db.auditLog.findMany({
      where: { tenantId, resource: 'workflow', resourceId: workflowId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
    fastify.db.agentTrace.findMany({
      where: { tenantId, workflowId },
      orderBy: { startedAt: 'asc' },
      take: 500,
    }),
    fastify.db.approvalRequest.findMany({
      where: { tenantId, workflowId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    // Artifacts may fail if migration not deployed — degrade gracefully
    fastify.db.workflowArtifact.findMany({
      where: { tenantId, workflowId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }).catch(() => [] as unknown[]),
  ]);

  const events: TimelineEvent[] = [];

  for (const r of auditRows as Array<{ createdAt: Date; action: string; userId: string | null; details: unknown }>) {
    events.push({
      at: r.createdAt.toISOString(),
      source: 'lifecycle',
      type: r.action,
      details: { userId: r.userId, ...(r.details as Record<string, unknown> | null ?? {}) },
    });
  }
  for (const t of traces as Array<{ startedAt: Date; agentRole: string; stepIndex: number; durationMs: number | null; error: string | null; tokenUsage: unknown }>) {
    events.push({
      at: t.startedAt.toISOString(),
      source: 'trace',
      type: `agent_trace:${t.agentRole}`,
      details: { stepIndex: t.stepIndex, durationMs: t.durationMs, error: t.error, tokenUsage: t.tokenUsage },
    });
  }
  for (const a of approvals as Array<{ createdAt: Date; id: string; status: string; riskLevel: string; agentRole: string; reviewedBy: string | null; decidedAt: Date | null }>) {
    events.push({
      at: a.createdAt.toISOString(),
      source: 'approval',
      type: `approval_${a.status.toLowerCase()}`,
      details: {
        approvalId: a.id,
        status: a.status,
        riskLevel: a.riskLevel,
        agentRole: a.agentRole,
        reviewedBy: a.reviewedBy,
        decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
      },
    });
  }
  for (const a of artifactRowsRaw as Array<{ createdAt: Date; id: string; artifactType: string; fileName: string; status: string; approvalState: string; sizeBytes: number | null; contentHash: string | null }>) {
    events.push({
      at: a.createdAt.toISOString(),
      source: 'artifact',
      type: `artifact_${a.status.toLowerCase()}`,
      details: {
        artifactId: a.id,
        artifactType: a.artifactType,
        fileName: a.fileName,
        status: a.status,
        approvalState: a.approvalState,
        sizeBytes: a.sizeBytes,
        contentHash: a.contentHash,
      },
    });
  }

  events.sort((x, y) => x.at.localeCompare(y.at));
  return events;
}

// ─── Routes ─────────────────────────────────────────────────────────────

const auditRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /audit/log — paginated audit log with filters ─────────────────
  fastify.get(
    '/audit/log',
    {
      preHandler: [
        fastify.authenticate,
        // VIEWER can read audit logs (read-only). Below VIEWER (e.g.
        // unauthenticated) is rejected by `authenticate`. No further gate.
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = auditLogQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_QUERY', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      const q = parsed.data;
      const { tenantId } = request.user;

      const where: Record<string, unknown> = { tenantId };
      if (q.action) where['action'] = q.action;
      if (q.resource) where['resource'] = q.resource;
      if (q.resourceId) where['resourceId'] = q.resourceId;
      if (q.userId) where['userId'] = q.userId;
      if (q.from || q.to) {
        const range: Record<string, Date> = {};
        if (q.from) range['gte'] = new Date(q.from);
        if (q.to) range['lte'] = new Date(q.to);
        where['createdAt'] = range;
      }
      if (q.q) {
        where['OR'] = [
          { action: { contains: q.q, mode: 'insensitive' } },
          { resource: { contains: q.q, mode: 'insensitive' } },
          { resourceId: { contains: q.q, mode: 'insensitive' } },
        ];
      }

      const [items, total] = await Promise.all([
        (fastify.db.auditLog.findMany as unknown as (a: unknown) => Promise<unknown[]>)({
          where,
          orderBy: { createdAt: 'desc' },
          take: q.limit,
          skip: q.offset,
        }),
        (fastify.db.auditLog.count as unknown as (a: unknown) => Promise<number>)({ where }),
      ]);

      return reply.send(ok({
        items,
        total,
        limit: q.limit,
        offset: q.offset,
      }));
    },
  );

  // ── GET /audit/workflows/:workflowId/trail — chronological trail ──────
  fastify.get(
    '/audit/workflows/:workflowId/trail',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };
      const { tenantId } = request.user;

      // Validate workflow belongs to tenant first — prevents cross-tenant probes.
      const workflow = await (fastify.db.workflow.findFirst as unknown as (a: unknown) => Promise<{ id: string; goal: string; status: string; startedAt: Date; completedAt: Date | null; totalCostUsd: number } | null>)({
        where: { id: workflowId, tenantId },
        select: { id: true, goal: true, status: true, startedAt: true, completedAt: true, totalCostUsd: true },
      });
      if (!workflow) return reply.status(404).send(err('NOT_FOUND', 'Workflow not found'));

      const events = await buildWorkflowTrail(fastify as never, workflowId, tenantId);
      return reply.send(ok({ workflow, events, eventCount: events.length }));
    },
  );

  // ── GET /audit/reviewer-queue — pending approvals + artifact gates ────
  fastify.get(
    '/audit/reviewer-queue',
    {
      preHandler: [
        fastify.authenticate,
        // Reviewer queue is gated to REVIEWER+ — VIEWERs see audit log but
        // not the action surface. Operators can also see (they're the ones
        // who triggered the workflow most often).
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'OPERATOR', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewerQueueQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_QUERY', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      const q = parsed.data;
      const { tenantId } = request.user;

      // Two streams that need reviewer attention:
      //   1. Workflow approvals (status=PENDING)
      //   2. Artifact-download approvals (artifact.approvalState=REQUIRES_APPROVAL)
      const approvalWhere: Record<string, unknown> = { tenantId, status: 'PENDING' };
      if (q.riskLevel) approvalWhere['riskLevel'] = q.riskLevel;

      const [approvals, approvalsTotal, artifacts, artifactsTotal] = await Promise.all([
        (fastify.db.approvalRequest.findMany as unknown as (a: unknown) => Promise<unknown[]>)({
          where: approvalWhere,
          orderBy: { createdAt: 'asc' },
          take: q.limit,
          skip: q.offset,
        }),
        (fastify.db.approvalRequest.count as unknown as (a: unknown) => Promise<number>)({ where: approvalWhere }),
        // Artifacts may fail if migration not deployed — degrade gracefully.
        (fastify.db.workflowArtifact.findMany as unknown as (a: unknown) => Promise<unknown[]>)({
          where: { tenantId, deletedAt: null, approvalState: 'REQUIRES_APPROVAL', status: 'READY' },
          orderBy: { createdAt: 'asc' },
          take: q.limit,
          skip: q.offset,
          select: { id: true, workflowId: true, fileName: true, artifactType: true, sizeBytes: true, producedBy: true, createdAt: true },
        }).catch(() => []),
        (fastify.db.workflowArtifact.count as unknown as (a: unknown) => Promise<number>)({
          where: { tenantId, deletedAt: null, approvalState: 'REQUIRES_APPROVAL', status: 'READY' },
        }).catch(() => 0),
      ]);

      return reply.send(ok({
        workflowApprovals: { items: approvals, total: approvalsTotal },
        artifactApprovals: { items: artifacts, total: artifactsTotal },
        limit: q.limit,
        offset: q.offset,
      }));
    },
  );

  // ── GET /audit/dashboard — high-level compliance metrics ──────────────
  fastify.get(
    '/audit/dashboard',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.user;

      // 24-hour and 7-day windows for trend numbers
      const now = new Date();
      const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // groupBy for status + risk + action counts
      const [
        wfTotal,
        wfByStatus,
        approvalsByStatus,
        artifactsByType,
        artifactsByApprovalState,
        signedBundles,
        wf24h,
        wf7d,
        actionsLast7d,
      ] = await Promise.all([
        (fastify.db.workflow.count as unknown as (a: unknown) => Promise<number>)({ where: { tenantId } }),
        (fastify.db.workflow.groupBy as unknown as (a: unknown) => Promise<Array<{ status: string; _count: { _all: number } }>>)({
          by: ['status'],
          where: { tenantId },
          _count: { _all: true },
        }),
        (fastify.db.approvalRequest.groupBy as unknown as (a: unknown) => Promise<Array<{ status: string; _count: { _all: number } }>>)({
          by: ['status'],
          where: { tenantId },
          _count: { _all: true },
        }),
        // Artifacts (table may be missing — fail soft to []).
        (fastify.db.workflowArtifact.groupBy as unknown as (a: unknown) => Promise<Array<{ artifactType: string; _count: { _all: number } }>>)({
          by: ['artifactType'],
          where: { tenantId, deletedAt: null },
          _count: { _all: true },
        }).catch(() => []),
        (fastify.db.workflowArtifact.groupBy as unknown as (a: unknown) => Promise<Array<{ approvalState: string; _count: { _all: number } }>>)({
          by: ['approvalState'],
          where: { tenantId, deletedAt: null },
          _count: { _all: true },
        }).catch(() => []),
        (fastify.db.workflowArtifact.count as unknown as (a: unknown) => Promise<number>)({
          where: { tenantId, deletedAt: null, artifactType: 'evidence_bundle' },
        }).catch(() => 0),
        (fastify.db.workflow.count as unknown as (a: unknown) => Promise<number>)({
          where: { tenantId, startedAt: { gte: day } },
        }),
        (fastify.db.workflow.count as unknown as (a: unknown) => Promise<number>)({
          where: { tenantId, startedAt: { gte: week } },
        }),
        (fastify.db.auditLog.groupBy as unknown as (a: unknown) => Promise<Array<{ action: string; _count: { _all: number } }>>)({
          by: ['action'],
          where: { tenantId, createdAt: { gte: week } },
          _count: { _all: true },
          orderBy: { _count: { action: 'desc' } },
          take: 12,
        }),
      ]);

      // Materialise the artifact-table-missing diagnostic so the UI can
      // show "migration not deployed" instead of a silently empty card.
      const artifactsAvailable = artifactsByType.length > 0
        || artifactsByApprovalState.length > 0
        || signedBundles > 0;

      return reply.send(ok({
        generatedAt: new Date().toISOString(),
        windows: { day: day.toISOString(), week: week.toISOString() },
        workflows: {
          total: wfTotal,
          byStatus: wfByStatus.map((g) => ({ status: g.status, count: g._count._all })),
          last24h: wf24h,
          last7d: wf7d,
        },
        approvals: {
          byStatus: approvalsByStatus.map((g) => ({ status: g.status, count: g._count._all })),
        },
        artifacts: {
          available: artifactsAvailable,
          byType: artifactsByType.map((g) => ({ artifactType: g.artifactType, count: g._count._all })),
          byApprovalState: artifactsByApprovalState.map((g) => ({ approvalState: g.approvalState, count: g._count._all })),
          signedBundles,
        },
        actionsLast7d: actionsLast7d.map((g) => ({ action: g.action, count: g._count._all })),
      }));
    },
  );
};

export default auditRoutes;
