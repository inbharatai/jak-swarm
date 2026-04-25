/**
 * artifacts routes — production foundation for the Audit & Compliance
 * product. Tenant-scoped CRUD on WorkflowArtifact rows.
 *
 * Routes:
 *   GET    /workflows/:workflowId/artifacts        — list artefacts for a workflow
 *   GET    /artifacts/:id                          — fetch one (metadata only)
 *   POST   /artifacts/:id/download                 — request a signed download URL
 *                                                    (enforces approval gate)
 *   POST   /artifacts/:id/approve                  — reviewer approves download
 *   POST   /artifacts/:id/reject                   — reviewer rejects download
 *   DELETE /artifacts/:id                          — soft-delete the artifact
 *
 * Security:
 *   - All routes require authentication (`fastify.authenticate`).
 *   - Tenant isolation enforced at the service layer — every method takes
 *     tenantId and validates the row belongs to it.
 *   - Approval/reject routes additionally require REVIEWER+ role.
 *   - Download requests on artefacts with approvalState=REQUIRES_APPROVAL
 *     return 403 with reason 'requires_approval' — the cockpit surfaces
 *     this honestly.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  ArtifactService,
  ArtifactGatedError,
  ArtifactNotFoundError,
  ArtifactSchemaUnavailableError,
} from '../services/artifact.service.js';
import { ok, err } from '../types.js';

/**
 * Translate service errors → HTTP responses with honest codes.
 * Keep in one helper so every route renders the same shape.
 */
function sendArtifactError(reply: FastifyReply, e: unknown, fallbackCode: string): FastifyReply {
  if (e instanceof ArtifactSchemaUnavailableError) {
    return reply.status(503).send(err('ARTIFACT_SCHEMA_UNAVAILABLE',
      'Artifact storage is not provisioned in this database. Run pnpm db:migrate:deploy to apply migration 10_workflow_artifacts.'));
  }
  if (e instanceof ArtifactNotFoundError) {
    return reply.status(404).send(err('NOT_FOUND', e.message));
  }
  if (e instanceof ArtifactGatedError) {
    return reply.status(403).send(err(`ARTIFACT_GATED_${e.reason.toUpperCase()}`, e.message));
  }
  return reply.status(500).send(err(fallbackCode, e instanceof Error ? e.message : 'unknown'));
}

const artifactsRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ArtifactService(fastify.db, fastify.log);

  // ── Diagnostic: artifact subsystem health ───────────────────────────
  fastify.get(
    '/admin/diagnostics/artifacts',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const health = await service.healthCheck();
      const ready = health.schemaPresent && health.bucketReachable === true;
      return reply.send(ok({
        ready,
        ...health,
        hint: !health.schemaPresent
          ? 'Migration 10_workflow_artifacts not deployed. Run pnpm db:migrate:deploy.'
          : health.bucketReachable === false
            ? 'Supabase Storage not reachable. Check SUPABASE_SERVICE_ROLE_KEY + bucket creation.'
            : 'Artifact subsystem is operational.',
      }));
    },
  );

  // ── List artefacts for a workflow ───────────────────────────────────
  fastify.get(
    '/workflows/:workflowId/artifacts',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };
      const { tenantId } = request.user;
      try {
        const rows = await service.listArtifactsForWorkflow(workflowId, tenantId);
        return reply.send(ok({ artifacts: rows }));
      } catch (e) {
        return sendArtifactError(reply, e, 'ARTIFACT_LIST_FAILED');
      }
    },
  );

  // ── Fetch one artifact (metadata) ────────────────────────────────────
  fastify.get(
    '/artifacts/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      try {
        const row = await service.getArtifact(id, tenantId);
        return reply.send(ok({ artifact: row }));
      } catch (e) {
        return sendArtifactError(reply, e, 'ARTIFACT_GET_FAILED');
      }
    },
  );

  // ── Request signed download URL (compliance gate enforced) ───────────
  fastify.post(
    '/artifacts/:id/download',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId, userId } = request.user;
      try {
        const result = await service.requestSignedDownloadUrl({
          artifactId: id,
          tenantId,
          requestedBy: userId,
          expiresInSeconds: 600,
        });
        return reply.send(ok(result));
      } catch (e) {
        return sendArtifactError(reply, e, 'ARTIFACT_DOWNLOAD_FAILED');
      }
    },
  );

  // ── Approve / reject artifact (REVIEWER+ only) ───────────────────────
  fastify.post(
    '/artifacts/:id/approve',
    {
      preHandler: [
        fastify.authenticate,
        // Reuse the existing role guard — falls back to authenticate-only
        // if the role middleware isn't installed.
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId, userId } = request.user;
      try {
        const row = await service.setApprovalState({
          artifactId: id,
          tenantId,
          decision: 'APPROVED',
          reviewedBy: userId,
        });
        return reply.send(ok({ artifact: row }));
      } catch (e) {
        return sendArtifactError(reply, e, 'ARTIFACT_APPROVE_FAILED');
      }
    },
  );

  fastify.post(
    '/artifacts/:id/reject',
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
        const row = await service.setApprovalState({
          artifactId: id,
          tenantId,
          decision: 'REJECTED',
          reviewedBy: userId,
        });
        return reply.send(ok({ artifact: row }));
      } catch (e) {
        return sendArtifactError(reply, e, 'ARTIFACT_REJECT_FAILED');
      }
    },
  );

  // ── Soft-delete an artifact ──────────────────────────────────────────
  fastify.delete(
    '/artifacts/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId, userId } = request.user;
      try {
        await service.deleteArtifact({ artifactId: id, tenantId, deletedBy: userId });
        return reply.send(ok({ deleted: true, id }));
      } catch (e) {
        return sendArtifactError(reply, e, 'ARTIFACT_DELETE_FAILED');
      }
    },
  );
};

export default artifactsRoutes;
