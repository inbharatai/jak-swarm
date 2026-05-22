import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { CompanyBrainSchemaUnavailableError } from '../services/company-brain/company-profile.service.js';
import { CompanyConnectorSyncService } from '../services/company-brain/company-connector-sync.service.js';

const providerParamsSchema = z.object({
  provider: z.string().min(1),
});

const statusQuerySchema = z.object({
  provider: z.string().min(1).optional(),
});

const triggerBodySchema = z.object({
  mode: z.enum(['incremental', 'full']).default('incremental'),
}).strict();

const writeRoles = ['REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN', 'OPERATOR'] as const;

function validationMessage(error_: z.ZodError): string {
  return error_.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  }).join('; ');
}

function sendSyncError(reply: FastifyReply, e: unknown, fallbackCode: string): FastifyReply {
  if (e instanceof CompanyBrainSchemaUnavailableError) {
    return reply.status(503).send(err('COMPANY_CONNECTOR_SYNC_SCHEMA_UNAVAILABLE', e.message));
  }
  if (e instanceof Error && /Unsupported provider/i.test(e.message)) {
    return reply.status(400).send(err('INVALID_PROVIDER', e.message));
  }
  if (e instanceof Error && /not connected/i.test(e.message)) {
    return reply.status(409).send(err('PROVIDER_NOT_CONNECTED', e.message));
  }
  if (e instanceof Error && /already running/i.test(e.message)) {
    return reply.status(409).send(err('SYNC_ALREADY_RUNNING', e.message));
  }
  if (e instanceof Error && /disabled/i.test(e.message)) {
    return reply.status(409).send(err('SYNC_DISABLED', e.message));
  }
  if (e instanceof Error && /API failed|token refresh|OAuth token|access token/i.test(e.message)) {
    return reply.status(502).send(err('SYNC_PROVIDER_ERROR', e.message));
  }
  return reply.status(500).send(err(fallbackCode, e instanceof Error ? e.message : 'unknown'));
}

const companySyncRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new CompanyConnectorSyncService(fastify.db, fastify.log);
  const writeGuard = fastify.requireRole ? [fastify.requireRole(...writeRoles)] : [];

  // Read current sync state for all wave-1 providers, or a single provider.
  fastify.get('/company/sync', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = statusQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send(err('INVALID_QUERY', validationMessage(parsed.error)));

    try {
      if (parsed.data.provider) {
        const status = await service.getStatus({
          tenantId: request.user.tenantId,
          provider: parsed.data.provider,
        });
        return reply.send(ok({ status }));
      }

      const items = await service.listStatuses({ tenantId: request.user.tenantId });
      return reply.send(ok({ items }));
    } catch (e) {
      return sendSyncError(reply, e, 'COMPANY_SYNC_STATUS_FAILED');
    }
  });

  // Enable scheduled/manual sync for a provider.
  fastify.post('/company/sync/:provider/enable', {
    preHandler: [fastify.authenticate, ...writeGuard],
  }, async (request, reply) => {
    const params = providerParamsSchema.safeParse(request.params ?? {});
    if (!params.success) return reply.status(400).send(err('INVALID_PARAMS', validationMessage(params.error)));

    try {
      const status = await service.setProviderEnabled({
        tenantId: request.user.tenantId,
        provider: params.data.provider,
        enabled: true,
      });

      await fastify.auditLog(request, 'COMPANY_CONNECTOR_SYNC_ENABLED', 'CompanyConnectorSyncState', status.provider, {
        provider: status.provider,
      });

      return reply.send(ok({ status }));
    } catch (e) {
      return sendSyncError(reply, e, 'COMPANY_SYNC_ENABLE_FAILED');
    }
  });

  // Disable sync for a provider while keeping cursor/history for later resume.
  fastify.post('/company/sync/:provider/disable', {
    preHandler: [fastify.authenticate, ...writeGuard],
  }, async (request, reply) => {
    const params = providerParamsSchema.safeParse(request.params ?? {});
    if (!params.success) return reply.status(400).send(err('INVALID_PARAMS', validationMessage(params.error)));

    try {
      const status = await service.setProviderEnabled({
        tenantId: request.user.tenantId,
        provider: params.data.provider,
        enabled: false,
      });

      await fastify.auditLog(request, 'COMPANY_CONNECTOR_SYNC_DISABLED', 'CompanyConnectorSyncState', status.provider, {
        provider: status.provider,
      });

      return reply.send(ok({ status }));
    } catch (e) {
      return sendSyncError(reply, e, 'COMPANY_SYNC_DISABLE_FAILED');
    }
  });

  // Trigger an immediate incremental/full sync against a specific provider.
  fastify.post('/company/sync/:provider/trigger', {
    preHandler: [fastify.authenticate, ...writeGuard],
  }, async (request, reply) => {
    const params = providerParamsSchema.safeParse(request.params ?? {});
    if (!params.success) return reply.status(400).send(err('INVALID_PARAMS', validationMessage(params.error)));

    const body = triggerBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send(err('INVALID_REQUEST', validationMessage(body.error)));

    try {
      const run = await service.triggerSync({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        provider: params.data.provider,
        forceFull: body.data.mode === 'full',
      });

      await fastify.auditLog(request, 'COMPANY_CONNECTOR_SYNC_TRIGGERED', 'CompanyConnectorSyncRun', run.runId, {
        provider: run.provider,
        mode: body.data.mode,
        status: run.status,
        fetchedCount: run.fetchedCount,
        ingestedCount: run.ingestedCount,
        skippedCount: run.skippedCount,
      });

      const status = await service.getStatus({
        tenantId: request.user.tenantId,
        provider: params.data.provider,
      });

      return reply.send(ok({ run, status }));
    } catch (e) {
      return sendSyncError(reply, e, 'COMPANY_SYNC_TRIGGER_FAILED');
    }
  });
};

export default companySyncRoutes;
