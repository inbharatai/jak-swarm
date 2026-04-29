import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { ok, err } from '../types.js';
import { AppError } from '../errors.js';

/**
 * /metrics/yc-snapshot — lightweight usage-metrics endpoint built for
 * design-partner reporting + YC application "what does usage look like"
 * questions. Scope follows role:
 *   - SYSTEM_ADMIN: platform-wide numbers across every tenant
 *   - TENANT_ADMIN: numbers scoped to the caller's tenant only
 *   - other roles: 403
 *
 * The endpoint deliberately ships 5 simple numbers + one breakdown:
 *   1. workflowRuns.total / completed / failed / awaitingApproval
 *   2. approvals.total / approved / rejected / deferred
 *   3. activeUsers (distinct userId who triggered ≥1 workflow this period)
 *   4. activeTenants (platform scope only — distinct tenants with ≥1 workflow)
 *   5. retention.tenantsWith5PlusRunsThisWeek (platform scope only — proxy for
 *      "did the design partner come back week 2")
 *   6. topTemplates: Array<{ templateName, runs }> — which template intents
 *      are getting traction
 *
 * Design-partner usage report flow:
 *   curl /metrics/yc-snapshot?days=7  // each Friday, screenshot, put in YC app
 *
 * No new dashboards, no new schema. Pure SELECT against existing tables
 * (Workflow, ApprovalRequest, IntentRecord). Safe to remove later.
 */
const ycMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/yc-snapshot',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { days?: string };
      const days = Math.max(1, Math.min(90, parseInt(query.days ?? '7', 10) || 7));
      const now = new Date();
      const from = new Date(now.getTime() - days * 86_400_000);

      const isPlatform = request.user.role === 'SYSTEM_ADMIN';
      const tenantFilter = isPlatform ? {} : { tenantId: request.user.tenantId };

      try {
        // ── 1. Workflow run counts ─────────────────────────────────────────
        const [
          totalRuns,
          completedRuns,
          failedRuns,
          awaitingApprovalRuns,
        ] = await Promise.all([
          fastify.db.workflow.count({
            where: { ...tenantFilter, startedAt: { gte: from } },
          }),
          fastify.db.workflow.count({
            where: { ...tenantFilter, startedAt: { gte: from }, status: 'COMPLETED' },
          }),
          fastify.db.workflow.count({
            where: { ...tenantFilter, startedAt: { gte: from }, status: 'FAILED' },
          }),
          fastify.db.workflow.count({
            where: { ...tenantFilter, startedAt: { gte: from }, status: { in: ['AWAITING_APPROVAL', 'PAUSED'] } },
          }),
        ]);

        // ── 2. Approval events ─────────────────────────────────────────────
        // Count by stored status. `reviewedAt >= from` is the honest filter
        // (a decision happened in the period); rows still PENDING are not
        // counted as "events" — only decisions are.
        const [
          totalApprovals,
          approvedCount,
          rejectedCount,
          deferredCount,
        ] = await Promise.all([
          fastify.db.approvalRequest.count({
            where: { ...tenantFilter, reviewedAt: { gte: from } },
          }),
          fastify.db.approvalRequest.count({
            where: { ...tenantFilter, reviewedAt: { gte: from }, status: 'APPROVED' },
          }),
          fastify.db.approvalRequest.count({
            where: { ...tenantFilter, reviewedAt: { gte: from }, status: 'REJECTED' },
          }),
          fastify.db.approvalRequest.count({
            where: { ...tenantFilter, reviewedAt: { gte: from }, status: 'DEFERRED' },
          }),
        ]);

        // ── 3. Active users (distinct triggerers in the period) ────────────
        const distinctUsers = await fastify.db.workflow.findMany({
          where: { ...tenantFilter, startedAt: { gte: from } },
          select: { userId: true },
          distinct: ['userId'],
        });
        const activeUsers = distinctUsers.length;

        // ── 4. Active tenants (platform scope only) ────────────────────────
        let activeTenants: number | null = null;
        if (isPlatform) {
          const distinctTenants = await fastify.db.workflow.findMany({
            where: { startedAt: { gte: from } },
            select: { tenantId: true },
            distinct: ['tenantId'],
          });
          activeTenants = distinctTenants.length;
        }

        // ── 5. Retention proxy: tenants with ≥5 runs this week ─────────────
        // This is the "did the design partner actually come back" number that
        // matters for YC. Cosmetic 1-touch usage doesn't count.
        let tenantsWith5PlusRunsThisWeek: number | null = null;
        if (isPlatform) {
          const groups = await fastify.db.workflow.groupBy({
            by: ['tenantId'],
            where: { startedAt: { gte: from } },
            _count: { _all: true },
          });
          tenantsWith5PlusRunsThisWeek = groups.filter((g) => g._count._all >= 5).length;
        }

        // ── 6. Top templates by run count ──────────────────────────────────
        // Pulls from IntentRecord which carries `workflowTemplateId`.
        // Best-effort — if the table doesn't exist (early migrations) we
        // return an empty list rather than 500.
        let topTemplates: Array<{ templateId: string; runs: number }> = [];
        try {
          const intentGroups = await fastify.db.intentRecord.groupBy({
            by: ['workflowTemplateId'],
            where: {
              ...tenantFilter,
              createdAt: { gte: from },
              workflowTemplateId: { not: null },
            },
            _count: { _all: true },
            orderBy: { _count: { workflowTemplateId: 'desc' } },
            take: 5,
          });
          topTemplates = intentGroups
            .filter((g): g is typeof g & { workflowTemplateId: string } => g.workflowTemplateId !== null)
            .map((g) => ({ templateId: g.workflowTemplateId, runs: g._count._all }));
        } catch {
          // IntentRecord schema may not be deployed yet — emit empty list.
        }

        return reply.status(200).send(
          ok({
            period: {
              from: from.toISOString(),
              to: now.toISOString(),
              days,
            },
            scope: isPlatform ? 'platform' : 'tenant',
            workflowRuns: {
              total: totalRuns,
              completed: completedRuns,
              failed: failedRuns,
              awaitingApproval: awaitingApprovalRuns,
            },
            approvals: {
              total: totalApprovals,
              approved: approvedCount,
              rejected: rejectedCount,
              deferred: deferredCount,
            },
            activeUsers,
            activeTenants,
            retention: {
              tenantsWith5PlusRunsThisWeek,
            },
            topTemplates,
          }),
        );
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default ycMetricsRoutes;
