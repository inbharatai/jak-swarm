/**
 * audit-runs routes — Audit & Compliance v2 (engagement runs).
 *
 * Endpoints (all tenant-scoped via request.user.tenantId):
 *
 *   POST   /audit/runs                              Create new run + emit audit_run_started
 *   GET    /audit/runs                              List runs (paginated)
 *   GET    /audit/runs/:id                          Detail (run + tests + exceptions + workpapers)
 *   POST   /audit/runs/:id/plan                     Seed ControlTest rows (PLANNING → PLANNED)
 *   POST   /audit/runs/:id/auto-map                 Re-run ComplianceMapperService for the framework
 *   POST   /audit/runs/:id/test-controls            Run all not-yet-passed tests (PLANNED → TESTING)
 *   POST   /audit/runs/:id/controls/:controlTestId/test  Re-run one test
 *   POST   /audit/runs/:id/workpapers/generate      Generate workpaper PDFs (artifacts in REQUIRES_APPROVAL)
 *   POST   /audit/runs/:id/workpapers/:wpId/decide  Reviewer approve/reject one workpaper
 *   POST   /audit/runs/:id/exceptions               Manually create an exception
 *   PATCH  /audit/runs/:id/exceptions/:exId/remediation  Update remediation plan
 *   POST   /audit/runs/:id/exceptions/:exId/decide  Reviewer accept/reject/close exception
 *   POST   /audit/runs/:id/final-pack               Generate signed final pack (gated on workpaper approval)
 *   DELETE /audit/runs/:id                          Soft-delete
 *
 * RBAC:
 *   - Reads: any authenticated tenant member
 *   - Writes (create/plan/test/workpaper/exception/final-pack/delete): REVIEWER+
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  AuditRunService,
  AuditSchemaUnavailableError,
  IllegalAuditRunTransitionError,
  type AuditLifecycleEvent,
} from '../services/audit/audit-run.service.js';
import { ControlTestService } from '../services/audit/control-test.service.js';
import { AuditExceptionService, IllegalAuditExceptionTransitionError } from '../services/audit/audit-exception.service.js';
import { WorkpaperService } from '../services/audit/workpaper.service.js';
import { FinalAuditPackService, FinalPackGateError } from '../services/audit/final-audit-pack.service.js';
import { ComplianceMapperService, ComplianceSchemaUnavailableError } from '../services/compliance/compliance-mapper.service.js';
import { ArtifactSchemaUnavailableError } from '../services/artifact.service.js';
import { BundleSigningUnavailableError } from '../services/bundle-signing.service.js';
import { ok, err } from '../types.js';

// ─── Request schemas ─────────────────────────────────────────────────────

const createRunSchema = z.object({
  frameworkSlug: z.string().min(1),
  title: z.string().min(1).max(200),
  scope: z.string().max(2000).optional(),
  periodStart: z.string(),
  periodEnd: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const listRunsQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const testControlsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
});

const generateWorkpapersSchema = z.object({
  forceRegenerate: z.boolean().optional(),
});

const decideWorkpaperSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reviewerNotes: z.string().max(5000).optional(),
});

const manualExceptionSchema = z.object({
  controlId: z.string().min(1),
  controlCode: z.string().min(1).max(80),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string().min(1).max(5000),
  cause: z.string().max(5000).optional(),
  impact: z.string().max(5000).optional(),
  remediationPlan: z.string().max(5000).optional(),
  remediationOwner: z.string().max(120).optional(),
  remediationDueDate: z.string().optional(),
});

const updateRemediationSchema = z.object({
  remediationPlan: z.string().max(5000).optional(),
  remediationOwner: z.string().max(120).optional(),
  remediationDueDate: z.string().optional(),
});

const decideExceptionSchema = z.object({
  to: z.enum(['accepted', 'rejected', 'closed', 'remediation_planned', 'remediation_in_progress', 'remediation_complete']),
  reviewerComment: z.string().max(5000).optional(),
});

// ─── Error mapper ───────────────────────────────────────────────────────

function sendAuditError(reply: FastifyReply, e: unknown, fallbackCode: string): FastifyReply {
  if (e instanceof AuditSchemaUnavailableError) {
    return reply.status(503).send(err('AUDIT_SCHEMA_UNAVAILABLE', e.message));
  }
  if (e instanceof ComplianceSchemaUnavailableError) {
    return reply.status(503).send(err('COMPLIANCE_SCHEMA_UNAVAILABLE', e.message));
  }
  if (e instanceof ArtifactSchemaUnavailableError) {
    return reply.status(503).send(err('ARTIFACT_SCHEMA_UNAVAILABLE', e.message));
  }
  if (e instanceof BundleSigningUnavailableError) {
    return reply.status(503).send(err('BUNDLE_SIGNING_UNAVAILABLE', e.message));
  }
  if (e instanceof IllegalAuditRunTransitionError) {
    return reply.status(409).send(err('ILLEGAL_TRANSITION', e.message));
  }
  if (e instanceof IllegalAuditExceptionTransitionError) {
    return reply.status(409).send(err('ILLEGAL_TRANSITION', e.message));
  }
  if (e instanceof FinalPackGateError) {
    return reply.status(409).send({ ...err('FINAL_PACK_GATE', e.message), reason: e.reason, details: e.details });
  }
  if (e instanceof Error && /not found/i.test(e.message)) {
    return reply.status(404).send(err('NOT_FOUND', e.message));
  }
  return reply.status(500).send(err(fallbackCode, e instanceof Error ? e.message : 'unknown'));
}

// ─── Plugin ─────────────────────────────────────────────────────────────

const auditRunsRoutes: FastifyPluginAsync = async (fastify) => {
  // Lifecycle emitter — fans out to SSE channel + (later) audit log table.
  // The SSE channel `audit_run:{id}` mirrors the `workflow:{id}` channel
  // pattern so the cockpit subscribes the same way.
  const emitAuditEvent = (ev: AuditLifecycleEvent) => {
    try {
      fastify.swarm.emit(`audit_run:${ev.auditRunId}`, { ...ev, kind: 'audit-lifecycle' });
    } catch (e) {
      fastify.log.warn({ err: e instanceof Error ? e.message : String(e), eventType: ev.type }, '[audit-runs] SSE emit failed (non-fatal)');
    }
  };

  const runs = new AuditRunService(fastify.db, fastify.log, emitAuditEvent);
  const exceptions = new AuditExceptionService(fastify.db, fastify.log, emitAuditEvent);
  const tests = new ControlTestService(fastify.db, fastify.log, exceptions, emitAuditEvent);
  const workpapers = new WorkpaperService(fastify.db, fastify.log, emitAuditEvent);
  const finalPack = new FinalAuditPackService(fastify.db, fastify.log, emitAuditEvent);
  const mapper = new ComplianceMapperService(fastify.db, fastify.log);

  // ── Create run ──────────────────────────────────────────────────────
  fastify.post(
    '/audit/runs',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.user;
      const parsed = createRunSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await runs.create({
          tenantId,
          userId,
          frameworkSlug: parsed.data.frameworkSlug,
          title: parsed.data.title,
          ...(parsed.data.scope ? { scope: parsed.data.scope } : {}),
          periodStart: parsed.data.periodStart,
          periodEnd: parsed.data.periodEnd,
          ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}),
        });
        return reply.status(201).send(ok(result));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_RUN_CREATE_FAILED');
      }
    },
  );

  // ── List runs ───────────────────────────────────────────────────────
  fastify.get(
    '/audit/runs',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.user;
      const parsed = listRunsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_QUERY', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await runs.list({
          tenantId,
          ...(parsed.data.status ? { status: parsed.data.status as never } : {}),
          limit: parsed.data.limit,
          offset: parsed.data.offset,
        });
        return reply.send(ok({ ...result, limit: parsed.data.limit, offset: parsed.data.offset }));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_RUN_LIST_FAILED');
      }
    },
  );

  // ── Get run detail (run + tests + exceptions + workpapers) ──────────
  fastify.get(
    '/audit/runs/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      try {
        const [run, controlTests, exceptionList, workpaperList] = await Promise.all([
          runs.get(id, tenantId),
          fastify.db.controlTest.findMany({
            where: { auditRunId: id, tenantId },
            orderBy: { controlCode: 'asc' },
          }),
          exceptions.list({ tenantId, auditRunId: id }),
          workpapers.list({ tenantId, auditRunId: id }),
        ]);
        return reply.send(ok({ run, controlTests, exceptions: exceptionList, workpapers: workpaperList }));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_RUN_GET_FAILED');
      }
    },
  );

  // ── Plan (seed control tests) ───────────────────────────────────────
  fastify.post(
    '/audit/runs/:id/plan',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      try {
        const result = await runs.plan({ id, tenantId });
        return reply.send(ok(result));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_RUN_PLAN_FAILED');
      }
    },
  );

  // ── Auto-map (re-run compliance mapper for the run's framework) ─────
  fastify.post(
    '/audit/runs/:id/auto-map',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId, userId } = request.user;
      try {
        const run = (await runs.get(id, tenantId)) as { frameworkSlug: string; periodStart: Date; periodEnd: Date };
        const mapResult = await mapper.runForTenant({
          tenantId,
          frameworkSlug: run.frameworkSlug,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          triggeredBy: userId,
        });
        emitAuditEvent({
          type: 'evidence_mapped',
          auditRunId: id,
          agentRole: 'COMPLIANCE_MAPPER',
          timestamp: new Date().toISOString(),
          details: {
            controlsProcessed: mapResult.controlsProcessed,
            newMappingsCreated: mapResult.newMappingsCreated,
            totalEvidenceConsidered: mapResult.totalEvidenceConsidered,
          },
        });
        return reply.send(ok(mapResult));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_RUN_AUTOMAP_FAILED');
      }
    },
  );

  // ── Run all control tests ────────────────────────────────────────────
  fastify.post(
    '/audit/runs/:id/test-controls',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId, userId } = request.user;
      const parsed = testControlsSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await tests.runAll({
          auditRunId: id,
          tenantId,
          triggeredBy: userId,
          ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
        });
        return reply.send(ok(result));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_RUN_TEST_FAILED');
      }
    },
  );

  // ── Re-run a single control test ─────────────────────────────────────
  fastify.post(
    '/audit/runs/:id/controls/:controlTestId/test',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, controlTestId } = request.params as { id: string; controlTestId: string };
      const { tenantId, userId } = request.user;
      try {
        const result = await tests.runSingle({
          auditRunId: id,
          controlTestId,
          tenantId,
          triggeredBy: userId,
        });
        return reply.send(ok({ result }));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_RUN_TEST_SINGLE_FAILED');
      }
    },
  );

  // ── Generate workpapers ──────────────────────────────────────────────
  fastify.post(
    '/audit/runs/:id/workpapers/generate',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId, userId } = request.user;
      const parsed = generateWorkpapersSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await workpapers.generateAll({
          tenantId,
          auditRunId: id,
          generatedBy: userId,
          ...(parsed.data.forceRegenerate ? { forceRegenerate: true } : {}),
        });
        return reply.send(ok(result));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_WORKPAPER_GENERATE_FAILED');
      }
    },
  );

  // ── Reviewer decision on a workpaper ─────────────────────────────────
  fastify.post(
    '/audit/runs/:id/workpapers/:wpId/decide',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { wpId } = request.params as { id: string; wpId: string };
      const { tenantId, userId } = request.user;
      const parsed = decideWorkpaperSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await workpapers.setReviewDecision({
          workpaperId: wpId,
          tenantId,
          decision: parsed.data.decision,
          ...(parsed.data.reviewerNotes ? { reviewerNotes: parsed.data.reviewerNotes } : {}),
          reviewedBy: userId,
        });
        return reply.send(ok(result));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_WORKPAPER_DECIDE_FAILED');
      }
    },
  );

  // ── Manually create exception ────────────────────────────────────────
  fastify.post(
    '/audit/runs/:id/exceptions',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId, userId } = request.user;
      const parsed = manualExceptionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await exceptions.createManual({
          tenantId,
          auditRunId: id,
          controlId: parsed.data.controlId,
          controlCode: parsed.data.controlCode,
          severity: parsed.data.severity,
          description: parsed.data.description,
          ...(parsed.data.cause ? { cause: parsed.data.cause } : {}),
          ...(parsed.data.impact ? { impact: parsed.data.impact } : {}),
          ...(parsed.data.remediationPlan ? { remediationPlan: parsed.data.remediationPlan } : {}),
          ...(parsed.data.remediationOwner ? { remediationOwner: parsed.data.remediationOwner } : {}),
          ...(parsed.data.remediationDueDate ? { remediationDueDate: parsed.data.remediationDueDate } : {}),
          createdBy: userId,
        });
        return reply.status(201).send(ok(result));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_EXCEPTION_CREATE_FAILED');
      }
    },
  );

  // ── Update exception remediation ─────────────────────────────────────
  fastify.patch(
    '/audit/runs/:id/exceptions/:exId/remediation',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { exId } = request.params as { id: string; exId: string };
      const { tenantId, userId } = request.user;
      const parsed = updateRemediationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await exceptions.updateRemediation({
          id: exId,
          tenantId,
          ...(parsed.data.remediationPlan !== undefined ? { remediationPlan: parsed.data.remediationPlan } : {}),
          ...(parsed.data.remediationOwner !== undefined ? { remediationOwner: parsed.data.remediationOwner } : {}),
          ...(parsed.data.remediationDueDate !== undefined ? { remediationDueDate: parsed.data.remediationDueDate } : {}),
          updatedBy: userId,
        });
        return reply.send(ok(result));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_EXCEPTION_REMEDIATION_FAILED');
      }
    },
  );

  // ── Reviewer decision on exception ───────────────────────────────────
  fastify.post(
    '/audit/runs/:id/exceptions/:exId/decide',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { exId } = request.params as { id: string; exId: string };
      const { tenantId, userId } = request.user;
      const parsed = decideExceptionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await exceptions.transition({
          id: exId,
          tenantId,
          to: parsed.data.to,
          ...(parsed.data.reviewerComment ? { reviewerComment: parsed.data.reviewerComment } : {}),
          reviewedBy: userId,
        });
        return reply.send(ok(result));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_EXCEPTION_DECIDE_FAILED');
      }
    },
  );

  // ── Generate signed final pack ───────────────────────────────────────
  fastify.post(
    '/audit/runs/:id/final-pack',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId, userId } = request.user;
      try {
        const result = await finalPack.generate({
          tenantId,
          auditRunId: id,
          generatedBy: userId,
        });
        return reply.send(ok(result));
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_FINAL_PACK_FAILED');
      }
    },
  );

  // ── Soft-delete an audit run ─────────────────────────────────────────
  fastify.delete(
    '/audit/runs/:id',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId, userId } = request.user;
      try {
        await runs.delete({ id, tenantId, deletedBy: userId });
        return reply.status(204).send();
      } catch (e) {
        return sendAuditError(reply, e, 'AUDIT_RUN_DELETE_FAILED');
      }
    },
  );
};

export default auditRunsRoutes;
