import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CompanyOperatingLayerService } from '../services/company-brain/company-operating-layer.service.js';
import { CompanyBrainV2Service } from '../services/company-brain/company-brain-v2.service.js';
import { ok } from '../types.js';
import { body, fail, id, paging, query, reviewRoles, writeRoles } from './company-operating-layer.route-utils.js';
import { createCompanyBrainProcessor } from './company-brain-v2.processing.js';

const brainRoutes: FastifyPluginAsync = async (fastify) => {
  const legacy = new CompanyOperatingLayerService(fastify.db, fastify.log);
  const brain = new CompanyBrainV2Service(fastify.db, fastify.log);
  const processor = createCompanyBrainProcessor(legacy, brain, fastify.log);
  const write = fastify.requireRole ? [fastify.requireRole(...writeRoles)] : [];
  const review = fastify.requireRole ? [fastify.requireRole(...reviewRoles)] : [];

  fastify.post('/company/artifacts/:id/process', { preHandler: [fastify.authenticate, ...write] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const artifactId = id(request, reply); if (!artifactId) return;
    try { return reply.send(ok(await processor.processArtifact({ tenantId: request.user.tenantId, userId: request.user.userId, artifactId, force: true }))); }
    catch (error_) { return fail(reply, error_, 'COMPANY_ARTIFACT_PROCESS_FAILED'); }
  });
  fastify.patch('/company/artifacts/:id/policy', { preHandler: [fastify.authenticate, ...review] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const artifactId = id(request, reply); if (!artifactId) return;
    const data = body(z.object({ visibility: z.enum(['public','internal','restricted']), allowedAgentRoles: z.array(z.string().min(1).max(120)).max(100).optional(), sensitivity: z.enum(['normal','confidential','highly_confidential']).optional(), retentionUntil: z.string().datetime().nullable().optional() }).strict(), request, reply); if (!data) return;
    try { return reply.send(ok({ artifact: await brain.setArtifactPolicy({ tenantId: request.user.tenantId, artifactId, ...data, retentionUntil: data.retentionUntil ? new Date(data.retentionUntil) : null }) })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_ARTIFACT_POLICY_FAILED'); }
  });
  fastify.get('/company/brain/graph', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = query(z.object({ query: z.string().max(500).optional(), entityType: z.string().max(80).optional(), limit: z.coerce.number().int().positive().max(500).default(200) }), request, reply); if (!data) return;
    try { return reply.send(ok(await brain.getGraph({ tenantId: request.user.tenantId, ...data }))); }
    catch (error_) { return fail(reply, error_, 'COMPANY_GRAPH_FAILED'); }
  });
  fastify.get('/company/brain/entities/:id', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const entityId = id(request, reply); if (!entityId) return;
    try { return reply.send(ok(await brain.getEntityDetail({ tenantId: request.user.tenantId, entityId }))); }
    catch (error_) { return fail(reply, error_, 'COMPANY_ENTITY_DETAIL_FAILED'); }
  });
  fastify.post('/company/brain/context', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = body(z.object({ task: z.string().min(1).max(20_000), agentRole: z.string().min(1).max(120), tokenBudget: z.number().int().min(500).max(8000).optional() }).strict(), request, reply); if (!data) return;
    try { return reply.send(ok(await brain.getContextPackage({ tenantId: request.user.tenantId, ...data }))); }
    catch (error_) { return fail(reply, error_, 'COMPANY_CONTEXT_FAILED'); }
  });
  fastify.get('/company/brain/reviews', { preHandler: [fastify.authenticate, ...review] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = query(paging.extend({ status: z.enum(['open','approved','rejected','resolved']).default('open') }), request, reply); if (!data) return;
    try { return reply.send(ok({ ...(await brain.listReviews({ tenantId: request.user.tenantId, ...data })), limit: data.limit, offset: data.offset })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_REVIEW_LIST_FAILED'); }
  });
  fastify.post('/company/brain/claims/:id/decide', { preHandler: [fastify.authenticate, ...review] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const claimId = id(request, reply); if (!claimId) return; const data = body(z.object({ decision: z.enum(['APPROVED','REJECTED']), comment: z.string().max(4000).optional() }).strict(), request, reply); if (!data) return;
    try { return reply.send(ok({ claim: await brain.decideClaim({ tenantId: request.user.tenantId, userId: request.user.userId, claimId, ...data }) })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_CLAIM_DECIDE_FAILED'); }
  });
  fastify.post('/company/brain/entities/:id/merge', { preHandler: [fastify.authenticate, ...review] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const sourceEntityId = id(request, reply); if (!sourceEntityId) return; const data = body(z.object({ targetEntityId: z.string().min(1), reason: z.string().min(5).max(4000), similarity: z.number().min(0).max(1).optional() }).strict(), request, reply); if (!data) return;
    try { return reply.send(ok({ entity: await brain.mergeEntities({ tenantId: request.user.tenantId, userId: request.user.userId, sourceEntityId, ...data }) })); }
    catch (error_) { return fail(reply, error_, 'COMPANY_ENTITY_MERGE_FAILED'); }
  });

  if (process.env['COMPANY_BRAIN_AUTO_PROCESS_ENABLED'] !== 'false') {
    const intervalMs = Math.max(15_000, Number.parseInt(process.env['COMPANY_BRAIN_AUTO_PROCESS_INTERVAL_MS'] ?? '60000', 10) || 60_000);
    const batchSize = Math.max(1, Math.min(Number.parseInt(process.env['COMPANY_BRAIN_AUTO_PROCESS_BATCH_SIZE'] ?? '3', 10) || 3, 25));
    let running = false;
    const tick = async () => {
      if (running) return; running = true;
      try { for (const artifact of await brain.listPendingArtifacts({ limit: batchSize })) await processor.processArtifact({ tenantId: artifact.tenantId, userId: artifact.userId, artifactId: artifact.id }).catch((error_) => fastify.log.warn({ error_, artifactId: artifact.id }, '[company-brain-v2] sweep item failed')); }
      catch (error_) { fastify.log.warn({ error_ }, '[company-brain-v2] processing sweep failed'); }
      finally { running = false; }
    };
    const timer = setInterval(() => void tick(), intervalMs); timer.unref(); setImmediate(() => void tick());
    fastify.addHook('onClose', async () => clearInterval(timer));
  }
};
export default brainRoutes;
