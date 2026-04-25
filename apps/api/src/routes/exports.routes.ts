/**
 * exports routes — kick off a real export of a workflow's data into a
 * persisted WorkflowArtifact row. Tenant-scoped and approval-gated.
 *
 * POST /workflows/:workflowId/export
 *   body: { kind: ExportKind, format: ExportFormat, markFinal?: boolean }
 *   → returns { artifactId, status, approvalState, fileName, sizeBytes }
 *   On converter failure: returns 200 with status='FAILED' + error so the
 *   UI can show the row honestly instead of a generic 500.
 *
 *   Subsequent download via POST /artifacts/:id/download (artifacts.routes.ts)
 *   respects the `markFinal` approval gate.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ExportService } from '../services/export.service.js';
import { ArtifactSchemaUnavailableError } from '../services/artifact.service.js';
import { ok, err } from '../types.js';

const exportRequestSchema = z.object({
  kind: z.enum(['workflow_report', 'audit_evidence_index', 'control_matrix', 'workpaper', 'audit_pack']),
  format: z.enum(['json', 'csv', 'xlsx', 'pdf', 'docx']),
  markFinal: z.boolean().optional(),
  redact: z.boolean().optional(),
});

const exportsRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ExportService(fastify.db, fastify.log);

  fastify.post(
    '/workflows/:workflowId/export',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };
      const { tenantId, userId } = request.user;
      const parsed = exportRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      }
      try {
        const result = await service.export({
          workflowId,
          tenantId,
          requestedBy: userId,
          kind: parsed.data.kind,
          format: parsed.data.format,
          ...(parsed.data.markFinal !== undefined ? { markFinal: parsed.data.markFinal } : {}),
          ...(parsed.data.redact !== undefined ? { redact: parsed.data.redact } : {}),
        });
        return reply.send(ok(result));
      } catch (e) {
        if (e instanceof ArtifactSchemaUnavailableError) {
          return reply.status(503).send(err('ARTIFACT_SCHEMA_UNAVAILABLE', e.message));
        }
        return reply.status(500).send(err('EXPORT_FAILED', e instanceof Error ? e.message : 'unknown'));
      }
    },
  );
};

export default exportsRoutes;
