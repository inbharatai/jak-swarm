/**
 * company-brain routes — Migration 16 surface.
 *
 * Endpoints (all tenant-scoped via request.user.tenantId):
 *
 * Company profile:
 *   GET    /company/profile                  Get current profile (any status)
 *   POST   /company/profile/manual           User-typed profile (status='manual')
 *   POST   /company/profile/extract          LLM extraction from uploaded docs (status='extracted')
 *   POST   /company/profile/approve          Approve extracted profile (status='user_approved')
 *   DELETE /company/profile                  Reject + clear extracted profile
 *
 * Intents (read-only analytics):
 *   GET    /intents                          Recent intent history (paginated)
 *   GET    /intents/stats                    Per-intent counts for the tenant
 *
 * Memory approval:
 *   GET    /memory/pending                   Memories awaiting approval
 *   POST   /memory/:id/approve               Approve agent-suggested memory
 *   POST   /memory/:id/reject                Reject agent-suggested memory
 *
 * Workflow templates (read-only for tenants; admin seeds):
 *   GET    /workflow-templates               List templates available to tenant
 *   GET    /workflow-templates/by-intent/:intent  Find template for intent
 *   POST   /admin/workflow-templates/seed    SYSTEM_ADMIN — seed system templates (idempotent)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { COMPANY_OS_INTENTS } from '@jak-swarm/agents';
import { CompanyProfileService, CompanyBrainSchemaUnavailableError } from '../services/company-brain/company-profile.service.js';
import { IntentRecordService } from '../services/company-brain/intent-record.service.js';
import { MemoryApprovalService, IllegalMemoryTransitionError } from '../services/company-brain/memory-approval.service.js';
import { WorkflowTemplateService } from '../services/company-brain/workflow-template.service.js';
import { ok, err } from '../types.js';

// ─── Schemas ────────────────────────────────────────────────────────────

const manualProfileSchema = z.object({
  name: z.string().max(200).optional(),
  industry: z.string().max(120).optional(),
  description: z.string().max(5000).optional(),
  productsServices: z.array(z.object({ name: z.string().max(120), description: z.string().max(500).optional() })).max(20).optional(),
  targetCustomers: z.string().max(2000).optional(),
  brandVoice: z.string().max(2000).optional(),
  competitors: z.array(z.object({ name: z.string().max(120), url: z.string().max(500).optional(), notes: z.string().max(500).optional() })).max(20).optional(),
  pricing: z.string().max(2000).optional(),
  websiteUrl: z.string().max(500).optional(),
  goals: z.string().max(2000).optional(),
  constraints: z.string().max(2000).optional(),
  preferredChannels: z.array(z.string().max(60)).max(10).optional(),
});

const extractSchema = z.object({
  documentIds: z.array(z.string().min(1)).max(25).optional(),
});

const approveSchema = z.object({
  edits: manualProfileSchema.optional(),
});

const intentListQuerySchema = z.object({
  intent: z.enum(COMPANY_OS_INTENTS).optional(),
  userId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const memoryDecisionSchema = z.object({
  reason: z.string().max(2000).optional(),
});

// ─── Error mapper ───────────────────────────────────────────────────────

function sendBrainError(reply: FastifyReply, e: unknown, fallbackCode: string): FastifyReply {
  if (e instanceof CompanyBrainSchemaUnavailableError) {
    return reply.status(503).send(err('COMPANY_BRAIN_SCHEMA_UNAVAILABLE', e.message));
  }
  if (e instanceof IllegalMemoryTransitionError) {
    return reply.status(409).send(err('ILLEGAL_TRANSITION', e.message));
  }
  if (e instanceof Error && /not found/i.test(e.message)) {
    return reply.status(404).send(err('NOT_FOUND', e.message));
  }
  if (e instanceof Error && /OPENAI_API_KEY/i.test(e.message)) {
    return reply.status(503).send(err('LLM_KEY_REQUIRED', e.message));
  }
  return reply.status(500).send(err(fallbackCode, e instanceof Error ? e.message : 'unknown'));
}

// ─── Plugin ─────────────────────────────────────────────────────────────

const companyBrainRoutes: FastifyPluginAsync = async (fastify) => {
  const profile = new CompanyProfileService(fastify.db, fastify.log);
  const intents = new IntentRecordService(fastify.db, fastify.log);
  const memory = new MemoryApprovalService(fastify.db, fastify.log);
  const templates = new WorkflowTemplateService(fastify.db, fastify.log);

  // ── Company profile ─────────────────────────────────────────────────

  fastify.get('/company/profile', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const row = await profile.get(request.user.tenantId);
      return reply.send(ok({ profile: row }));
    } catch (e) { return sendBrainError(reply, e, 'COMPANY_PROFILE_GET_FAILED'); }
  });

  fastify.post('/company/profile/manual', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = manualProfileSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
    try {
      const row = await profile.upsertManual({ tenantId: request.user.tenantId, userId: request.user.userId, fields: parsed.data });
      return reply.send(ok({ profile: row }));
    } catch (e) { return sendBrainError(reply, e, 'COMPANY_PROFILE_MANUAL_FAILED'); }
  });

  fastify.post('/company/profile/extract', {
    preHandler: [fastify.authenticate, ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN', 'OPERATOR')] : [])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = extractSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
    try {
      const row = await profile.extractFromDocuments({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        ...(parsed.data.documentIds ? { documentIds: parsed.data.documentIds } : {}),
      });
      return reply.send(ok({ profile: row }));
    } catch (e) { return sendBrainError(reply, e, 'COMPANY_PROFILE_EXTRACT_FAILED'); }
  });

  fastify.post('/company/profile/approve', {
    preHandler: [fastify.authenticate, ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : [])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = approveSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
    try {
      const row = await profile.approve({ tenantId: request.user.tenantId, userId: request.user.userId, ...(parsed.data.edits ? { edits: parsed.data.edits } : {}) });
      return reply.send(ok({ profile: row }));
    } catch (e) { return sendBrainError(reply, e, 'COMPANY_PROFILE_APPROVE_FAILED'); }
  });

  fastify.delete('/company/profile', {
    preHandler: [fastify.authenticate, ...(fastify.requireRole ? [fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')] : [])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await profile.reject({ tenantId: request.user.tenantId, userId: request.user.userId });
      return reply.status(204).send();
    } catch (e) { return sendBrainError(reply, e, 'COMPANY_PROFILE_REJECT_FAILED'); }
  });

  // ── Intents ─────────────────────────────────────────────────────────

  fastify.get('/intents', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = intentListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send(err('INVALID_QUERY', parsed.error.issues.map((i) => i.message).join('; ')));
    try {
      const result = await intents.list({
        tenantId: request.user.tenantId,
        ...(parsed.data.intent ? { intent: parsed.data.intent } : {}),
        ...(parsed.data.userId ? { userId: parsed.data.userId } : {}),
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      return reply.send(ok({ ...result, limit: parsed.data.limit, offset: parsed.data.offset }));
    } catch (e) { return sendBrainError(reply, e, 'INTENTS_LIST_FAILED'); }
  });

  fastify.get('/intents/stats', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await intents.stats(request.user.tenantId);
      return reply.send(ok({ stats }));
    } catch (e) { return sendBrainError(reply, e, 'INTENTS_STATS_FAILED'); }
  });

  // ── Memory approval ─────────────────────────────────────────────────

  fastify.get('/memory/pending', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as { limit?: string; offset?: string };
    try {
      const result = await memory.listPending({
        tenantId: request.user.tenantId,
        ...(q.limit ? { limit: Number(q.limit) } : {}),
        ...(q.offset ? { offset: Number(q.offset) } : {}),
      });
      return reply.send(ok(result));
    } catch (e) { return sendBrainError(reply, e, 'MEMORY_PENDING_FAILED'); }
  });

  fastify.post('/memory/:id/approve', {
    preHandler: [fastify.authenticate, ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : [])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      await memory.approve({ id, tenantId: request.user.tenantId, reviewedBy: request.user.userId });
      return reply.send(ok({ approved: true, id }));
    } catch (e) { return sendBrainError(reply, e, 'MEMORY_APPROVE_FAILED'); }
  });

  fastify.post('/memory/:id/reject', {
    preHandler: [fastify.authenticate, ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN')] : [])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const parsed = memoryDecisionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
    try {
      await memory.reject({ id, tenantId: request.user.tenantId, reviewedBy: request.user.userId, ...(parsed.data.reason ? { reason: parsed.data.reason } : {}) });
      return reply.send(ok({ rejected: true, id }));
    } catch (e) { return sendBrainError(reply, e, 'MEMORY_REJECT_FAILED'); }
  });

  // ── Workflow templates ──────────────────────────────────────────────

  fastify.get('/workflow-templates', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as { intent?: string };
    try {
      const items = await templates.list({ tenantId: request.user.tenantId, ...(q.intent ? { intent: q.intent } : {}) });
      return reply.send(ok({ items }));
    } catch (e) { return sendBrainError(reply, e, 'WORKFLOW_TEMPLATES_LIST_FAILED'); }
  });

  fastify.get('/workflow-templates/by-intent/:intent', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { intent } = request.params as { intent: string };
    try {
      const template = await templates.findForIntent({ tenantId: request.user.tenantId, intent });
      if (!template) return reply.status(404).send(err('NOT_FOUND', `No workflow template for intent "${intent}"`));
      return reply.send(ok({ template }));
    } catch (e) { return sendBrainError(reply, e, 'WORKFLOW_TEMPLATE_BY_INTENT_FAILED'); }
  });

  fastify.post('/admin/workflow-templates/seed', {
    preHandler: [fastify.authenticate, ...(fastify.requireRole ? [fastify.requireRole('SYSTEM_ADMIN')] : [])],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await templates.seedSystemTemplates();
      return reply.send(ok(result));
    } catch (e) { return sendBrainError(reply, e, 'WORKFLOW_TEMPLATES_SEED_FAILED'); }
  });
};

export default companyBrainRoutes;
