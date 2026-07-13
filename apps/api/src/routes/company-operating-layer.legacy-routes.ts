import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CompanyOperatingLayerService } from '../services/company-brain/company-operating-layer.service.js';
import { CompanyBrainV2Service } from '../services/company-brain/company-brain-v2.service.js';
import { ok } from '../types.js';
import { body, createArtifactSchema, createEntitySchema, fail, generateSpecSchema, id, paging, priority, query, reviewRoles, writeRoles } from './company-operating-layer.route-utils.js';
import { createCompanyBrainProcessor } from './company-brain-v2.processing.js';

const legacyRoutes: FastifyPluginAsync = async (fastify) => {
  const legacy = new CompanyOperatingLayerService(fastify.db, fastify.log);
  const brain = new CompanyBrainV2Service(fastify.db, fastify.log);
  const processor = createCompanyBrainProcessor(fastify.db, legacy, brain, fastify.log);
  const write = fastify.requireRole ? [fastify.requireRole(...writeRoles)] : [];
  const review = fastify.requireRole ? [fastify.requireRole(...reviewRoles)] : [];

  fastify.post('/company/artifacts', { preHandler: [fastify.authenticate, ...write] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = body(createArtifactSchema, request, reply); if (!data) return;
    try { const artifact = await legacy.createArtifact({ tenantId: request.user.tenantId, userId: request.user.userId, ...data }); void processor.schedule(request.user.tenantId, request.user.userId, artifact.id); return reply.status(201).send(ok({ artifact })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_ARTIFACT_CREATE_FAILED'); }
  });
  fastify.get('/company/artifacts', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = query(paging.extend({ sourceType: z.string().max(80).optional(), artifactType: z.string().max(80).optional() }), request, reply); if (!data) return;
    try { return reply.send(ok({ ...(await legacy.listArtifacts({ tenantId: request.user.tenantId, ...data })), limit: data.limit, offset: data.offset })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_ARTIFACT_LIST_FAILED'); }
  });
  fastify.post('/company/artifacts/:id/extract', { preHandler: [fastify.authenticate, ...write] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const artifactId = id(request, reply); if (!artifactId) return;
    try { const extracted = await legacy.extractEntitiesFromArtifact({ tenantId: request.user.tenantId, userId: request.user.userId, artifactId }); const graph = await brain.processExtractedEntities({ tenantId: request.user.tenantId, userId: request.user.userId, artifactId, entityIds: extracted.entities.map((entity: { id: string }) => entity.id) }); return reply.send(ok({ ...extracted, graph })); }
    catch (error_) { await brain.markArtifactFailure({ tenantId: request.user.tenantId, artifactId, error: error_ }); return fail(reply, error_, 'COMPANY_ARTIFACT_EXTRACT_FAILED'); }
  });
  fastify.post('/company/entities', { preHandler: [fastify.authenticate, ...write] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = body(createEntitySchema, request, reply); if (!data) return;
    try { return reply.status(201).send(ok({ entity: await legacy.createEntity({ tenantId: request.user.tenantId, userId: request.user.userId, ...data }) })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_ENTITY_CREATE_FAILED'); }
  });
  fastify.get('/company/entities', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = query(paging.extend({ entityType: z.string().max(80).optional(), status: z.string().max(80).optional() }), request, reply); if (!data) return;
    try { return reply.send(ok({ ...(await legacy.listEntities({ tenantId: request.user.tenantId, ...data })), limit: data.limit, offset: data.offset })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_ENTITY_LIST_FAILED'); }
  });
  fastify.post('/company/alignment/analyze', { preHandler: [fastify.authenticate, ...write] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = body(z.object({ limit: z.number().int().positive().max(5000).optional() }).strict(), request, reply); if (!data) return;
    try { return reply.send(ok(await legacy.analyzeAlignment({ tenantId: request.user.tenantId, userId: request.user.userId, ...data }))); }
    catch (error_) { return fail(reply, error_, 'COMPANY_ALIGNMENT_ANALYZE_FAILED'); }
  });
  fastify.get('/company/alignment/drift', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = query(paging.extend({ status: z.string().max(80).optional(), severity: priority.optional() }), request, reply); if (!data) return;
    try { return reply.send(ok({ ...(await legacy.listDriftFindings({ tenantId: request.user.tenantId, ...data })), limit: data.limit, offset: data.offset })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_DRIFT_LIST_FAILED'); }
  });
  fastify.post('/company/specs/generate', { preHandler: [fastify.authenticate, ...write] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = body(generateSpecSchema, request, reply); if (!data) return;
    try { return reply.status(201).send(ok({ spec: await legacy.generateSpec({ tenantId: request.user.tenantId, userId: request.user.userId, ...data }) })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_SPEC_GENERATE_FAILED'); }
  });
  fastify.get('/company/specs', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = query(paging.extend({ status: z.string().max(80).optional() }), request, reply); if (!data) return;
    try { return reply.send(ok({ ...(await legacy.listSpecs({ tenantId: request.user.tenantId, ...data })), limit: data.limit, offset: data.offset })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_SPEC_LIST_FAILED'); }
  });
  fastify.post('/company/specs/:id/decide', { preHandler: [fastify.authenticate, ...review] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const specId = id(request, reply); if (!specId) return; const data = body(z.object({ decision: z.enum(['APPROVED','REJECTED']), comment: z.string().max(4000).optional() }).strict(), request, reply); if (!data) return;
    try { return reply.send(ok({ spec: await legacy.decideSpec({ tenantId: request.user.tenantId, userId: request.user.userId, specId, ...data }) })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_SPEC_DECIDE_FAILED'); }
  });
  fastify.post('/company/specs/:id/execute', { preHandler: [fastify.authenticate, ...review] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const specId = id(request, reply); if (!specId) return;
    try { return reply.send(ok({ execution: await legacy.executeSpec({ tenantId: request.user.tenantId, userId: request.user.userId, specId }) })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_SPEC_EXECUTE_FAILED'); }
  });
  // Phase 6 — resume a spec execution that paused at an approval gate. The
  // executionId (not specId) is the resource: a spec may have multiple paused
  // attempts; resume targets one. REVIEWER+ (same gate as execute).
  fastify.post('/company/spec-executions/:executionId/resume', { preHandler: [fastify.authenticate, ...review] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { executionId } = request.params as { executionId: string };
    if (!executionId || typeof executionId !== 'string') { return reply.status(400).send({ error: 'BAD_REQUEST', message: 'executionId required' }); }
    try { return reply.send(ok({ execution: await legacy.resumeSpecExecution({ tenantId: request.user.tenantId, userId: request.user.userId, executionId }) })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_SPEC_RESUME_FAILED'); }
  });
};
export default legacyRoutes;
