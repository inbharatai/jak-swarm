/**
 * Company Operating Layer routes — YC closed-loop foundation.
 *
 * These routes sit under `/company/*` and are deliberately evidence-first:
 * artifacts -> graph entities -> drift findings -> agent-executable specs.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CompanyBrainSchemaUnavailableError } from '../services/company-brain/company-profile.service.js';
import { CompanyOperatingLayerService } from '../services/company-brain/company-operating-layer.service.js';
import { ok, err } from '../types.js';

const artifactSourceSchema = z.enum([
  'github',
  'linear',
  'jira',
  'slack',
  'notion',
  'google_drive',
  'gmail',
  'meeting',
  'customer_call',
  'support',
  'document',
  'manual',
  'other',
]);

const artifactTypeSchema = z.enum([
  'ticket',
  'issue',
  'pull_request',
  'commit',
  'slack_thread',
  'notion_page',
  'document',
  'meeting_transcript',
  'customer_feedback',
  'support_ticket',
  'email',
  'decision_note',
  'other',
]);

const entityTypeSchema = z.enum([
  'decision',
  'task',
  'spec',
  'customer_signal',
  'risk',
  'owner',
  'deadline',
  'code_change',
  'customer',
  'metric',
  'requirement',
]);

const prioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

const createArtifactSchema = z.object({
  sourceType: artifactSourceSchema,
  artifactType: artifactTypeSchema,
  title: z.string().min(1).max(500),
  body: z.string().min(20).max(250_000),
  externalId: z.string().max(500).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  authorName: z.string().max(200).optional(),
  occurredAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

const listArtifactsQuerySchema = z.object({
  sourceType: z.string().max(80).optional(),
  artifactType: z.string().max(80).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createEntitySchema = z.object({
  entityType: entityTypeSchema,
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(4000),
  sourceArtifactIds: z.array(z.string().min(1)).min(1).max(50),
  primaryArtifactId: z.string().min(1).optional(),
  status: z.string().min(1).max(80).optional(),
  ownerName: z.string().max(160).nullable().optional(),
  priority: prioritySchema.nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  occurredAt: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
  relatedEntityIds: z.array(z.string().min(1)).max(100).optional(),
  properties: z.record(z.unknown()).optional(),
  extractedBy: z.enum(['manual', 'connector', 'openai', 'system']).optional(),
}).strict();

const listEntitiesQuerySchema = z.object({
  entityType: z.string().max(80).optional(),
  status: z.string().max(80).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const analyzeSchema = z.object({
  limit: z.number().int().positive().max(5000).optional(),
}).strict();

const listDriftQuerySchema = z.object({
  status: z.string().max(80).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const generateSpecSchema = z.object({
  driftFindingId: z.string().min(1).optional(),
  entityIds: z.array(z.string().min(1)).max(100).optional(),
}).strict().refine((value) => Boolean(value.driftFindingId || (value.entityIds && value.entityIds.length > 0)), {
  message: 'driftFindingId or entityIds is required',
});

const listSpecsQuerySchema = z.object({
  status: z.string().max(80).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const decideSpecSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().max(4000).optional(),
}).strict();

const idParamsSchema = z.object({
  id: z.string().min(1),
});

function validationMessage(error_: z.ZodError): string {
  return error_.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  }).join('; ');
}

function sendCompanyOsError(reply: FastifyReply, e: unknown, fallbackCode: string): FastifyReply {
  if (e instanceof CompanyBrainSchemaUnavailableError) {
    return reply.status(503).send(err('COMPANY_OPERATING_LAYER_SCHEMA_UNAVAILABLE', e.message));
  }
  if (e instanceof Error && /OPENAI_API_KEY/i.test(e.message)) {
    return reply.status(503).send(err('LLM_KEY_REQUIRED', e.message));
  }
  if (e instanceof Error && /not found|not present|not in this tenant/i.test(e.message)) {
    return reply.status(404).send(err('NOT_FOUND', e.message));
  }
  if (e instanceof Error && /unique constraint|P2002/i.test(e.message)) {
    return reply.status(409).send(err('DUPLICATE_RESOURCE', e.message));
  }
  return reply.status(500).send(err(fallbackCode, e instanceof Error ? e.message : 'unknown'));
}

const writeRoles = ['REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN', 'OPERATOR'] as const;
const reviewRoles = ['REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN'] as const;

const companyOperatingLayerRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new CompanyOperatingLayerService(fastify.db, fastify.log);
  const writeGuard = fastify.requireRole ? [fastify.requireRole(...writeRoles)] : [];
  const reviewGuard = fastify.requireRole ? [fastify.requireRole(...reviewRoles)] : [];

  fastify.post('/company/artifacts', {
    preHandler: [fastify.authenticate, ...writeGuard],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createArtifactSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_REQUEST', validationMessage(parsed.error)));
    try {
      const artifact = await service.createArtifact({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        ...parsed.data,
      });
      return reply.status(201).send(ok({ artifact }));
    } catch (e) {
      return sendCompanyOsError(reply, e, 'COMPANY_ARTIFACT_CREATE_FAILED');
    }
  });

  fastify.get('/company/artifacts', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = listArtifactsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_QUERY', validationMessage(parsed.error)));
    try {
      const result = await service.listArtifacts({
        tenantId: request.user.tenantId,
        ...parsed.data,
      });
      return reply.send(ok({ ...result, limit: parsed.data.limit, offset: parsed.data.offset }));
    } catch (e) {
      return sendCompanyOsError(reply, e, 'COMPANY_ARTIFACT_LIST_FAILED');
    }
  });

  fastify.post('/company/artifacts/:id/extract', {
    preHandler: [fastify.authenticate, ...writeGuard],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = idParamsSchema.safeParse(request.params ?? {});
    if (!params.success) return reply.status(400).send(err('INVALID_PARAMS', validationMessage(params.error)));
    try {
      const result = await service.extractEntitiesFromArtifact({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        artifactId: params.data.id,
      });
      return reply.send(ok(result));
    } catch (e) {
      return sendCompanyOsError(reply, e, 'COMPANY_ARTIFACT_EXTRACT_FAILED');
    }
  });

  fastify.post('/company/entities', {
    preHandler: [fastify.authenticate, ...writeGuard],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createEntitySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_REQUEST', validationMessage(parsed.error)));
    try {
      const entity = await service.createEntity({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        ...parsed.data,
      });
      return reply.status(201).send(ok({ entity }));
    } catch (e) {
      return sendCompanyOsError(reply, e, 'COMPANY_ENTITY_CREATE_FAILED');
    }
  });

  fastify.get('/company/entities', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = listEntitiesQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_QUERY', validationMessage(parsed.error)));
    try {
      const result = await service.listEntities({
        tenantId: request.user.tenantId,
        ...parsed.data,
      });
      return reply.send(ok({ ...result, limit: parsed.data.limit, offset: parsed.data.offset }));
    } catch (e) {
      return sendCompanyOsError(reply, e, 'COMPANY_ENTITY_LIST_FAILED');
    }
  });

  fastify.post('/company/alignment/analyze', {
    preHandler: [fastify.authenticate, ...writeGuard],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = analyzeSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_REQUEST', validationMessage(parsed.error)));
    try {
      const result = await service.analyzeAlignment({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
      });
      return reply.send(ok(result));
    } catch (e) {
      return sendCompanyOsError(reply, e, 'COMPANY_ALIGNMENT_ANALYZE_FAILED');
    }
  });

  fastify.get('/company/alignment/drift', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = listDriftQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_QUERY', validationMessage(parsed.error)));
    try {
      const result = await service.listDriftFindings({
        tenantId: request.user.tenantId,
        ...parsed.data,
      });
      return reply.send(ok({ ...result, limit: parsed.data.limit, offset: parsed.data.offset }));
    } catch (e) {
      return sendCompanyOsError(reply, e, 'COMPANY_DRIFT_LIST_FAILED');
    }
  });

  fastify.post('/company/specs/generate', {
    preHandler: [fastify.authenticate, ...writeGuard],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = generateSpecSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_REQUEST', validationMessage(parsed.error)));
    try {
      const spec = await service.generateSpec({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        ...parsed.data,
      });
      return reply.status(201).send(ok({ spec }));
    } catch (e) {
      return sendCompanyOsError(reply, e, 'COMPANY_SPEC_GENERATE_FAILED');
    }
  });

  fastify.get('/company/specs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = listSpecsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_QUERY', validationMessage(parsed.error)));
    try {
      const result = await service.listSpecs({
        tenantId: request.user.tenantId,
        ...parsed.data,
      });
      return reply.send(ok({ ...result, limit: parsed.data.limit, offset: parsed.data.offset }));
    } catch (e) {
      return sendCompanyOsError(reply, e, 'COMPANY_SPEC_LIST_FAILED');
    }
  });

  fastify.post('/company/specs/:id/decide', {
    preHandler: [fastify.authenticate, ...reviewGuard],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = idParamsSchema.safeParse(request.params ?? {});
    if (!params.success) return reply.status(400).send(err('INVALID_PARAMS', validationMessage(params.error)));
    const parsed = decideSpecSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_REQUEST', validationMessage(parsed.error)));
    try {
      const spec = await service.decideSpec({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        specId: params.data.id,
        ...parsed.data,
      });
      return reply.send(ok({ spec }));
    } catch (e) {
      return sendCompanyOsError(reply, e, 'COMPANY_SPEC_DECIDE_FAILED');
    }
  });
};

export default companyOperatingLayerRoutes;
