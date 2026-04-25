/**
 * compliance routes — Audit & Compliance v1 (control framework mapping).
 *
 * GET    /compliance/frameworks
 *   List all available frameworks (e.g. soc2-type2). Authenticated.
 *
 * GET    /compliance/frameworks/:slug
 *   Framework detail + per-control evidence count for the requesting
 *   tenant. Optional ?from + ?to filter for period-scoped views.
 *
 * GET    /compliance/frameworks/:slug/controls/:controlId/evidence
 *   List evidence rows mapped to one control. Paginated.
 *
 * POST   /compliance/frameworks/:slug/auto-map
 *   Re-run the auto-mapping engine for the requesting tenant. Returns
 *   summary of new mappings created. REVIEWER+.
 *
 * POST   /compliance/frameworks/:slug/attestations
 *   Generate a period attestation PDF (optionally signed). Returns the
 *   new artifact id + summary. REVIEWER+.
 *
 * GET    /compliance/attestations
 *   List previously generated attestations. Authenticated.
 *
 * All routes are tenant-scoped via request.user.tenantId.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ComplianceMapperService, ComplianceSchemaUnavailableError } from '../services/compliance/compliance-mapper.service.js';
import { AttestationService } from '../services/compliance/attestation.service.js';
import { ArtifactSchemaUnavailableError } from '../services/artifact.service.js';
import { BundleSigningUnavailableError } from '../services/bundle-signing.service.js';
import { ok, err } from '../types.js';

const periodQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

const attestationRequestSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  sign: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const autoMapRequestSchema = z.object({
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});

const evidenceQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

function sendComplianceError(reply: FastifyReply, e: unknown, fallbackCode: string): FastifyReply {
  if (e instanceof ComplianceSchemaUnavailableError) {
    return reply.status(503).send(err('COMPLIANCE_SCHEMA_UNAVAILABLE', e.message));
  }
  if (e instanceof ArtifactSchemaUnavailableError) {
    return reply.status(503).send(err('ARTIFACT_SCHEMA_UNAVAILABLE', e.message));
  }
  if (e instanceof BundleSigningUnavailableError) {
    return reply.status(503).send(err('BUNDLE_SIGNING_UNAVAILABLE', e.message));
  }
  return reply.status(500).send(err(fallbackCode, e instanceof Error ? e.message : 'unknown'));
}

const complianceRoutes: FastifyPluginAsync = async (fastify) => {
  const mapper = new ComplianceMapperService(fastify.db, fastify.log);
  const attestor = new AttestationService(fastify.db, fastify.log);

  // ── List frameworks ────────────────────────────────────────────────
  fastify.get(
    '/compliance/frameworks',
    { preHandler: [fastify.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const frameworks = await fastify.db.complianceFramework.findMany({
          where: { active: true },
          orderBy: { name: 'asc' },
          select: { slug: true, name: true, shortName: true, issuer: true, description: true, version: true },
        });
        return reply.send(ok({ frameworks }));
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'P2021') {
          return reply.status(503).send(err('COMPLIANCE_SCHEMA_UNAVAILABLE',
            'Compliance schema not deployed. Run pnpm db:migrate:deploy + pnpm seed:compliance.'));
        }
        return sendComplianceError(reply, e, 'COMPLIANCE_LIST_FAILED');
      }
    },
  );

  // ── Framework detail (scoped to tenant) ────────────────────────────
  fastify.get(
    '/compliance/frameworks/:slug',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };
      const { tenantId } = request.user;
      const parsed = periodQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_QUERY', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const summary = await mapper.getFrameworkSummary({
          tenantId,
          frameworkSlug: slug,
          ...(parsed.data.from ? { periodStart: new Date(parsed.data.from) } : {}),
          ...(parsed.data.to ? { periodEnd: new Date(parsed.data.to) } : {}),
        });
        return reply.send(ok(summary));
      } catch (e) {
        if (e instanceof Error && /Framework not found/i.test(e.message)) {
          return reply.status(404).send(err('NOT_FOUND', e.message));
        }
        return sendComplianceError(reply, e, 'COMPLIANCE_DETAIL_FAILED');
      }
    },
  );

  // ── Drill into a single control's evidence ──────────────────────────
  fastify.get(
    '/compliance/frameworks/:slug/controls/:controlId/evidence',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { controlId } = request.params as { controlId: string };
      const { tenantId } = request.user;
      const parsed = evidenceQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_QUERY', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await mapper.getControlEvidence({
          tenantId,
          controlId,
          ...(parsed.data.from ? { periodStart: new Date(parsed.data.from) } : {}),
          ...(parsed.data.to ? { periodEnd: new Date(parsed.data.to) } : {}),
          limit: parsed.data.limit,
          offset: parsed.data.offset,
        });
        return reply.send(ok({ ...result, limit: parsed.data.limit, offset: parsed.data.offset }));
      } catch (e) {
        return sendComplianceError(reply, e, 'COMPLIANCE_EVIDENCE_FAILED');
      }
    },
  );

  // ── Run auto-mapping for the tenant ─────────────────────────────────
  fastify.post(
    '/compliance/frameworks/:slug/auto-map',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };
      const { tenantId, userId } = request.user;
      const parsed = autoMapRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await mapper.runForTenant({
          tenantId,
          frameworkSlug: slug,
          ...(parsed.data.periodStart ? { periodStart: parsed.data.periodStart } : {}),
          ...(parsed.data.periodEnd ? { periodEnd: parsed.data.periodEnd } : {}),
          triggeredBy: userId,
        });
        return reply.send(ok(result));
      } catch (e) {
        if (e instanceof Error && /Framework not found/i.test(e.message)) {
          return reply.status(404).send(err('NOT_FOUND', e.message));
        }
        return sendComplianceError(reply, e, 'COMPLIANCE_AUTOMAP_FAILED');
      }
    },
  );

  // ── Generate an attestation ─────────────────────────────────────────
  fastify.post(
    '/compliance/frameworks/:slug/attestations',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };
      const { tenantId, userId } = request.user;
      const parsed = attestationRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await attestor.generate({
          tenantId,
          frameworkSlug: slug,
          periodStart: parsed.data.periodStart,
          periodEnd: parsed.data.periodEnd,
          generatedBy: userId,
          ...(parsed.data.sign !== undefined ? { sign: parsed.data.sign } : {}),
          ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}),
        });
        return reply.send(ok(result));
      } catch (e) {
        return sendComplianceError(reply, e, 'COMPLIANCE_ATTESTATION_FAILED');
      }
    },
  );

  // ── List attestations ───────────────────────────────────────────────
  fastify.get(
    '/compliance/attestations',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.user;
      const q = request.query as { framework?: string; limit?: string; offset?: string };
      try {
        const result = await attestor.list({
          tenantId,
          ...(q.framework ? { frameworkSlug: q.framework } : {}),
          ...(q.limit ? { limit: Number(q.limit) } : {}),
          ...(q.offset ? { offset: Number(q.offset) } : {}),
        });
        return reply.send(ok(result));
      } catch (e) {
        return sendComplianceError(reply, e, 'COMPLIANCE_ATTESTATION_LIST_FAILED');
      }
    },
  );
};

export default complianceRoutes;
