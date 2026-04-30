import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import {
  PlaywrightBrowserOperator,
  SessionAccessError,
  BrowserApprovalRequiredError,
  type BrowserOperatorService,
} from '@jak-swarm/tools';

/**
 * Browser-operator HTTP routes.
 *
 * Lifecycle:
 *   POST /browser-sessions          — start a session for a platform
 *   GET  /browser-sessions          — list this tenant's sessions
 *   GET  /browser-sessions/:id      — observe (screenshot + DOM text)
 *   POST /browser-sessions/:id/propose  — propose an action (returns preview + approval-required flag)
 *   POST /browser-sessions/:id/execute  — execute an APPROVED action (must include approvalId)
 *   POST /browser-sessions/:id/screenshot/latest — convenience: serve the latest screenshot file
 *   DELETE /browser-sessions/:id    — end the session and wipe its data dir
 *
 * Tenant isolation: every route asserts the session's tenantId matches
 * `request.user.tenantId` via `requireSession()` inside the operator.
 *
 * Approval gating: `execute` calls `operator.execute` which throws
 * `BrowserApprovalRequiredError` if approvalId is missing — surfaced
 * as 409 with the action category for the cockpit to surface in the
 * approval inbox.
 *
 * Audit log: every successful action emits an AuditLog row via
 * `fastify.auditLog`.
 */

const startBodySchema = z.object({
  platform: z.enum(['INSTAGRAM', 'LINKEDIN', 'YOUTUBE_STUDIO', 'META_BUSINESS_SUITE', 'GENERIC']),
  initialUrl: z.string().url(),
  workflowId: z.string().optional(),
});

const proposeBodySchema = z.object({
  action: z.object({
    kind: z.enum(['navigate', 'click', 'fill', 'screenshot_only', 'extract_text']),
    description: z.string().max(300),
    payload: z.record(z.unknown()).default({}),
  }),
});

const executeBodySchema = proposeBodySchema.extend({
  approvalId: z.string().min(1),
});

/**
 * Single shared operator instance. The instance keeps in-memory
 * sessions; restarting the API drops them (the persistent data
 * dirs on disk are still cleaned up by endSession or by the next
 * sweep cycle on a fresh start).
 */
let sharedOperator: BrowserOperatorService | null = null;

function getOperator(fastify: import('fastify').FastifyInstance): BrowserOperatorService {
  if (sharedOperator) return sharedOperator;
  const op = new PlaywrightBrowserOperator({
    auditEmitter: async (event) => {
      try {
        // Best-effort audit. Don't crash the operator if the audit
        // store is briefly unavailable.
        await fastify.db.auditLog.create({
          data: {
            tenantId: event.tenantId,
            userId: event.userId,
            action: event.action,
            resource: 'browser_session',
            resourceId: event.sessionId,
            details: (event.metadata ?? {}) as never,
            severity: event.severity ?? 'INFO',
          },
        });
      } catch {
        fastify.log.warn(
          { sessionId: event.sessionId, action: event.action },
          '[browser-operator] audit emission failed (non-fatal)',
        );
      }
    },
  });
  op.startCleanupTimer();
  sharedOperator = op;
  return op;
}

const browserOperatorRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes require auth.
  const auth = [fastify.authenticate];

  fastify.post(
    '/',
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parse = startBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      try {
        const op = getOperator(fastify);
        const result = await op.startSession({
          tenantId: request.user.tenantId,
          userId: request.user.userId,
          platform: parse.data.platform,
          initialUrl: parse.data.initialUrl,
          ...(parse.data.workflowId !== undefined ? { workflowId: parse.data.workflowId } : {}),
        });
        return reply.status(200).send(ok(result));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to start browser session.';
        return reply.status(400).send(err('BROWSER_SESSION_START_FAILED', msg));
      }
    },
  );

  fastify.get(
    '/',
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const op = getOperator(fastify);
      const sessions = await op.listSessions(request.user.tenantId);
      return reply.status(200).send(ok({ items: sessions, count: sessions.length }));
    },
  );

  fastify.get(
    '/:sessionId',
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = request.params as { sessionId: string };
      try {
        const op = getOperator(fastify);
        const observation = await op.observe({
          sessionId,
          tenantId: request.user.tenantId,
        });
        // Don't ship the local filesystem path to the client; expose
        // a relative reference the screenshot endpoint can serve.
        const { screenshotPath: _ignored, ...safeFields } = observation;
        return reply.status(200).send(ok({
          ...safeFields,
          screenshotUrl: `/browser-sessions/${sessionId}/screenshot/latest`,
        }));
      } catch (e) {
        if (e instanceof SessionAccessError) {
          return reply.status(404).send(err('SESSION_NOT_FOUND', e.message));
        }
        const msg = e instanceof Error ? e.message : 'observe failed';
        return reply.status(500).send(err('BROWSER_OBSERVE_FAILED', msg));
      }
    },
  );

  fastify.post(
    '/:sessionId/propose',
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = request.params as { sessionId: string };
      const parse = proposeBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      try {
        const op = getOperator(fastify);
        const preview = await op.propose({
          sessionId,
          tenantId: request.user.tenantId,
          action: parse.data.action,
        });
        return reply.status(200).send(ok(preview));
      } catch (e) {
        if (e instanceof SessionAccessError) {
          return reply.status(404).send(err('SESSION_NOT_FOUND', e.message));
        }
        const msg = e instanceof Error ? e.message : 'propose failed';
        return reply.status(500).send(err('BROWSER_PROPOSE_FAILED', msg));
      }
    },
  );

  fastify.post(
    '/:sessionId/execute',
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = request.params as { sessionId: string };
      const parse = executeBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      try {
        const op = getOperator(fastify);
        const result = await op.execute({
          sessionId,
          tenantId: request.user.tenantId,
          action: parse.data.action,
          approvalId: parse.data.approvalId,
        });
        return reply.status(200).send(ok(result));
      } catch (e) {
        if (e instanceof BrowserApprovalRequiredError) {
          return reply.status(409).send(err('APPROVAL_REQUIRED', e.message, { category: e.category }));
        }
        if (e instanceof SessionAccessError) {
          return reply.status(404).send(err('SESSION_NOT_FOUND', e.message));
        }
        const msg = e instanceof Error ? e.message : 'execute failed';
        return reply.status(500).send(err('BROWSER_EXECUTE_FAILED', msg));
      }
    },
  );

  fastify.delete(
    '/:sessionId',
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = request.params as { sessionId: string };
      try {
        const op = getOperator(fastify);
        await op.endSession({ sessionId, tenantId: request.user.tenantId });
        return reply.status(200).send(ok({ sessionId, ended: true }));
      } catch (e) {
        if (e instanceof SessionAccessError) {
          return reply.status(404).send(err('SESSION_NOT_FOUND', e.message));
        }
        const msg = e instanceof Error ? e.message : 'endSession failed';
        return reply.status(500).send(err('BROWSER_END_SESSION_FAILED', msg));
      }
    },
  );
};

export default browserOperatorRoutes;
