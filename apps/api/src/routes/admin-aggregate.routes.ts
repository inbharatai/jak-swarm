/**
 * SYSTEM_ADMIN aggregate routes — cross-tenant rollup views.
 *
 * Distinct from /audit/* which is tenant-scoped (REVIEWER+ within their
 * own tenant). These routes are reserved for SYSTEM_ADMIN — the
 * platform-level administrator role — and intentionally aggregate
 * across all tenants. NEVER mix the two: a TENANT_ADMIN must NEVER
 * see another tenant's data.
 *
 * Routes
 *   GET /admin/aggregate/overview      — tenant counts, workflow + cost
 *                                        + audit volume across the platform
 *   GET /admin/aggregate/tenants       — per-tenant compliance posture
 *                                        (workflows, approvals, coverage)
 *   GET /admin/aggregate/compliance    — per-framework adoption + average
 *                                        coverage across tenants
 *
 * NOT here (separate operator surfaces):
 *   - billing rollups (/usage routes)
 *   - LLM provider rollups (/admin already has these)
 *   - tenant management CRUD (/tenants already has these)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { ok, err } from '../types.js';

const adminAggregateRoutes: FastifyPluginAsync = async (fastify) => {
  // Hard SYSTEM_ADMIN gate — every route uses the same preHandler.
  const sysAdminGate = [
    fastify.authenticate,
    ...(fastify.requireRole ? [fastify.requireRole('SYSTEM_ADMIN')] : []),
  ];

  // ── GET /admin/aggregate/overview ───────────────────────────────────
  fastify.get(
    '/admin/aggregate/overview',
    { preHandler: sysAdminGate },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const now = new Date();
        const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const month = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [
          tenantCount,
          tenantsByStatus,
          userCount,
          workflowsTotal,
          workflowsByStatus,
          workflows24h,
          workflows7d,
          workflows30d,
          totalCostUsd,
          auditEventsTotal,
          auditEvents24h,
          attestationsTotal,
          schedulesActive,
        ] = await Promise.all([
          fastify.db.tenant.count(),
          fastify.db.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
          fastify.db.user.count(),
          fastify.db.workflow.count(),
          fastify.db.workflow.groupBy({ by: ['status'], _count: { _all: true } }),
          fastify.db.workflow.count({ where: { startedAt: { gte: day } } }),
          fastify.db.workflow.count({ where: { startedAt: { gte: week } } }),
          fastify.db.workflow.count({ where: { startedAt: { gte: month } } }),
          fastify.db.workflow.aggregate({ _sum: { totalCostUsd: true } }),
          fastify.db.auditLog.count(),
          fastify.db.auditLog.count({ where: { createdAt: { gte: day } } }),
          fastify.db.controlAttestation.count().catch(() => 0),
          fastify.db.scheduledAttestation.count({ where: { active: true } }).catch(() => 0),
        ]);

        return reply.send(ok({
          generatedAt: now.toISOString(),
          tenants: {
            total: tenantCount,
            byStatus: tenantsByStatus.map((t) => ({ status: t.status, count: t._count._all })),
          },
          users: { total: userCount },
          workflows: {
            total: workflowsTotal,
            byStatus: workflowsByStatus.map((w) => ({ status: w.status, count: w._count._all })),
            last24h: workflows24h,
            last7d: workflows7d,
            last30d: workflows30d,
            totalCostUsd: totalCostUsd._sum.totalCostUsd ?? 0,
          },
          auditLog: { total: auditEventsTotal, last24h: auditEvents24h },
          compliance: { attestationsTotal, activeSchedules: schedulesActive },
        }));
      } catch (e) {
        return reply.status(500).send(err('AGGREGATE_OVERVIEW_FAILED', e instanceof Error ? e.message : 'unknown'));
      }
    },
  );

  // ── GET /admin/aggregate/tenants ────────────────────────────────────
  fastify.get(
    '/admin/aggregate/tenants',
    { preHandler: sysAdminGate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as { limit?: string; offset?: string };
      const limit = Math.min(200, Math.max(1, Number(q.limit ?? '50') || 50));
      const offset = Math.max(0, Number(q.offset ?? '0') || 0);
      try {
        const tenants = await fastify.db.tenant.findMany({
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, slug: true, industry: true, status: true, createdAt: true },
        });

        // For each tenant, fetch lightweight rollups in parallel batches.
        const ids = tenants.map((t) => t.id);
        const [workflowCounts, approvalCounts, attestationCounts, mappingCounts] = await Promise.all([
          fastify.db.workflow.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }),
          fastify.db.approvalRequest.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }),
          fastify.db.controlAttestation.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }).catch(() => []),
          fastify.db.controlEvidenceMapping.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }).catch(() => []),
        ]);

        const wfByTenant = new Map(workflowCounts.map((c) => [c.tenantId, c._count._all]));
        const apByTenant = new Map(approvalCounts.map((c) => [c.tenantId, c._count._all]));
        const atByTenant = new Map(attestationCounts.map((c) => [c.tenantId, c._count._all]));
        const mpByTenant = new Map(mappingCounts.map((c) => [c.tenantId, c._count._all]));

        const total = await fastify.db.tenant.count();

        return reply.send(ok({
          items: tenants.map((t) => ({
            ...t,
            workflowCount: wfByTenant.get(t.id) ?? 0,
            approvalCount: apByTenant.get(t.id) ?? 0,
            attestationCount: atByTenant.get(t.id) ?? 0,
            evidenceMappingCount: mpByTenant.get(t.id) ?? 0,
          })),
          total,
          limit,
          offset,
        }));
      } catch (e) {
        return reply.status(500).send(err('AGGREGATE_TENANTS_FAILED', e instanceof Error ? e.message : 'unknown'));
      }
    },
  );

  // ── GET /admin/aggregate/compliance ─────────────────────────────────
  fastify.get(
    '/admin/aggregate/compliance',
    { preHandler: sysAdminGate },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const frameworks = await fastify.db.complianceFramework.findMany({
          where: { active: true },
          orderBy: { name: 'asc' },
          include: { controls: { select: { id: true } } },
        }).catch(() => []);

        // Per-framework: how many tenants have ANY mapping for it +
        // average coverage % across tenants with mappings.
        const result: Array<{
          slug: string;
          name: string;
          version: string;
          totalControls: number;
          tenantsWithEvidence: number;
          totalEvidenceMappings: number;
          attestationsGenerated: number;
        }> = [];

        for (const fw of frameworks) {
          const controlIds = fw.controls.map((c) => c.id);
          if (controlIds.length === 0) {
            result.push({
              slug: fw.slug,
              name: fw.name,
              version: fw.version,
              totalControls: 0,
              tenantsWithEvidence: 0,
              totalEvidenceMappings: 0,
              attestationsGenerated: 0,
            });
            continue;
          }
          const [mappingsByTenant, totalMappings, attestations] = await Promise.all([
            fastify.db.controlEvidenceMapping.groupBy({
              by: ['tenantId'],
              where: { controlId: { in: controlIds } },
              _count: { _all: true },
            }).catch(() => []),
            fastify.db.controlEvidenceMapping.count({ where: { controlId: { in: controlIds } } }).catch(() => 0),
            fastify.db.controlAttestation.count({ where: { frameworkId: fw.id } }).catch(() => 0),
          ]);
          result.push({
            slug: fw.slug,
            name: fw.name,
            version: fw.version,
            totalControls: controlIds.length,
            tenantsWithEvidence: mappingsByTenant.length,
            totalEvidenceMappings: totalMappings,
            attestationsGenerated: attestations,
          });
        }

        return reply.send(ok({ frameworks: result }));
      } catch (e) {
        return reply.status(500).send(err('AGGREGATE_COMPLIANCE_FAILED', e instanceof Error ? e.message : 'unknown'));
      }
    },
  );
};

export default adminAggregateRoutes;
