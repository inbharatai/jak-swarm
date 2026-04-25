/**
 * bundles routes — produce + verify HMAC-signed evidence bundles.
 *
 * POST /workflows/:workflowId/bundle
 *   body: { metadata?: object }
 *   → returns { artifactId, signature, signatureAlgo, manifest }
 *   The bundle artifact is created with approvalState='REQUIRES_APPROVAL'
 *   so it can't be downloaded until a reviewer approves.
 *
 * POST /artifacts/:id/verify
 *   → returns { valid: true } OR { valid: false, reason, ... }
 *   Verifies the bundle's signature AND re-hashes every referenced
 *   artifact's bytes. Catches tampering of either.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BundleService } from '../services/bundle.service.js';
import { BundleSigningUnavailableError } from '../services/bundle-signing.service.js';
import {
  ArtifactSchemaUnavailableError,
  ArtifactNotFoundError,
} from '../services/artifact.service.js';
import { ok, err } from '../types.js';

const bundleRequestSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const bundlesRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new BundleService(fastify.db, fastify.log);

  fastify.post(
    '/workflows/:workflowId/bundle',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };
      const { tenantId, userId } = request.user;
      const parsed = bundleRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map(i => i.message).join('; ')));
      }
      try {
        const out = await service.createSignedBundle({
          workflowId,
          tenantId,
          requestedBy: userId,
          ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}),
        });
        return reply.send(ok(out));
      } catch (e) {
        if (e instanceof BundleSigningUnavailableError) {
          return reply.status(503).send(err('BUNDLE_SIGNING_UNAVAILABLE', e.message));
        }
        if (e instanceof ArtifactSchemaUnavailableError) {
          return reply.status(503).send(err('ARTIFACT_SCHEMA_UNAVAILABLE', e.message));
        }
        return reply.status(500).send(err('BUNDLE_CREATE_FAILED', e instanceof Error ? e.message : 'unknown'));
      }
    },
  );

  fastify.post(
    '/artifacts/:id/verify',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      try {
        const result = await service.verifyBundle({ bundleArtifactId: id, tenantId });
        // Always returns 200 with { valid: bool, reason? } — verification
        // failure is data, not an HTTP error.
        return reply.send(ok(result));
      } catch (e) {
        if (e instanceof ArtifactNotFoundError) {
          return reply.status(404).send(err('NOT_FOUND', e.message));
        }
        if (e instanceof ArtifactSchemaUnavailableError) {
          return reply.status(503).send(err('ARTIFACT_SCHEMA_UNAVAILABLE', e.message));
        }
        return reply.status(500).send(err('BUNDLE_VERIFY_FAILED', e instanceof Error ? e.message : 'unknown'));
      }
    },
  );
};

export default bundlesRoutes;
