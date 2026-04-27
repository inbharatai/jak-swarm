/**
 * External Auditor Portal routes — Sprint 2.6 / Item B.
 *
 * Two surfaces:
 *
 *   ADMIN routes (existing tenant users with REVIEWER+):
 *     POST   /audit/runs/:auditRunId/auditors/invite   create invite
 *     GET    /audit/runs/:auditRunId/auditors          list invites + engagements
 *     POST   /audit/runs/:auditRunId/auditors/:inviteId/revoke
 *     GET    /audit/runs/:auditRunId/auditors/actions  audit trail of auditor actions
 *
 *   AUDITOR routes (EXTERNAL_AUDITOR role + engagement isolation middleware):
 *     POST   /auditor/accept/:token        accept invite, returns JWT
 *     GET    /auditor/runs                 list MY engagements
 *     GET    /auditor/runs/:auditRunId     scoped audit run detail
 *     GET    /auditor/runs/:auditRunId/workpapers  list workpapers
 *     POST   /auditor/runs/:auditRunId/workpapers/:wpId/decide  decide
 *     POST   /auditor/runs/:auditRunId/comment     add a free-form comment
 *
 * Security model:
 *   - Invite tokens are SHA-256 hashed; cleartext is never persisted.
 *   - Auditor JWT carries userId + role=EXTERNAL_AUDITOR. Per-request
 *     middleware verifies (a) the role matches, and (b) the auditor has
 *     an active engagement for the requested auditRunId.
 *   - Cross-tenant access is blocked: every query scopes by
 *     engagement.tenantId.
 *   - Workpaper decide actions write the action AUDIT TRAIL row before
 *     mutating the workpaper, so a failed mutation still leaves a
 *     forensic record of intent.
 */

import type {
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { ExternalAuditorService } from '../services/audit/external-auditor.service.js';
import { AuthService } from '../services/auth.service.js';
import type { AuthSession } from '../types.js';

// ─── Validation schemas ─────────────────────────────────────────────────

const createInviteSchema = z.object({
  auditorEmail: z.string().email().max(254),
  auditorName: z.string().max(120).optional(),
  scopes: z.array(z.enum(['view_workpapers', 'comment', 'decide_workpapers', 'view_evidence', 'view_final_pack'])).optional(),
  expiresInDays: z.number().int().positive().max(180).optional(),
});

const acceptInviteSchema = z.object({
  // Cleartext token from URL param; we never accept it in body.
});

const decideWorkpaperSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']),
  comment: z.string().max(5_000).optional(),
});

const commentSchema = z.object({
  comment: z.string().min(1).max(5_000),
});

// ─── Engagement isolation middleware ────────────────────────────────────

/**
 * Builds a preHandler that verifies the authenticated user is an
 * EXTERNAL_AUDITOR with an active engagement for the auditRunId from
 * the URL params. On success, attaches `engagement` to request for
 * downstream handlers.
 */
function requireAuditorEngagement(svc: ExternalAuditorService): preHandlerHookHandler {
  return async (request, reply) => {
    const user = request.user as AuthSession | undefined;
    if (!user || user.role !== 'EXTERNAL_AUDITOR') {
      return reply.status(403).send(err('FORBIDDEN', 'Auditor role required'));
    }
    const { auditRunId } = request.params as { auditRunId: string };
    if (!auditRunId) {
      return reply.status(400).send(err('INVALID_REQUEST', 'auditRunId required'));
    }
    const engagement = await svc.findActiveEngagement(user.userId, auditRunId);
    if (!engagement) {
      return reply.status(403).send(err('NO_ENGAGEMENT', `No active engagement for audit run ${auditRunId}`));
    }
    // Attach for downstream handlers. Using a typed extension avoids
    // mutating `request.user`.
    (request as FastifyRequest & { engagement?: typeof engagement }).engagement = engagement;
  };
}

// ─── Plugin ─────────────────────────────────────────────────────────────

const externalAuditorRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = new ExternalAuditorService(
    fastify.db,
    fastify.log,
    process.env['JAK_PORTAL_BASE_URL'] ?? 'https://app.jak-swarm.com',
  );
  const authSvc = new AuthService(fastify.db, fastify);

  // ── ADMIN ROUTES ─────────────────────────────────────────────────────

  fastify.post(
    '/audit/runs/:auditRunId/auditors/invite',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN', 'OPERATOR')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.user;
      const { auditRunId } = request.params as { auditRunId: string };
      const parsed = createInviteSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      try {
        const result = await svc.createInvite({
          tenantId,
          auditRunId,
          auditorEmail: parsed.data.auditorEmail,
          ...(parsed.data.auditorName !== undefined ? { auditorName: parsed.data.auditorName } : {}),
          ...(parsed.data.scopes !== undefined ? { scopes: parsed.data.scopes } : {}),
          ...(parsed.data.expiresInDays !== undefined ? { expiresInDays: parsed.data.expiresInDays } : {}),
          createdBy: userId,
        });
        // Cleartext token returned ONCE here so admin UI can copy/email it.
        // We never log the cleartext.
        return reply.status(201).send(ok({
          inviteId: result.inviteId,
          cleartextToken: result.cleartextToken,
          acceptUrl: result.acceptUrl,
          expiresAt: result.expiresAt.toISOString(),
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        return reply.status(500).send(err('INVITE_CREATE_FAILED', msg));
      }
    },
  );

  fastify.get(
    '/audit/runs/:auditRunId/auditors',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN', 'OPERATOR')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.user;
      const { auditRunId } = request.params as { auditRunId: string };
      try {
        const invites = await svc.listInvitesForAuditRun(tenantId, auditRunId);
        return reply.send(ok({ invites }));
      } catch (e) {
        return reply.status(500).send(err('LIST_INVITES_FAILED', e instanceof Error ? e.message : 'unknown'));
      }
    },
  );

  fastify.post(
    '/audit/runs/:auditRunId/auditors/:inviteId/revoke',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN', 'OPERATOR')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.user;
      const { inviteId } = request.params as { inviteId: string };
      try {
        await svc.revokeInvite({ inviteId, tenantId, revokedBy: userId });
        return reply.send(ok({ revoked: true }));
      } catch (e) {
        return reply.status(500).send(err('INVITE_REVOKE_FAILED', e instanceof Error ? e.message : 'unknown'));
      }
    },
  );

  fastify.get(
    '/audit/runs/:auditRunId/auditors/actions',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN', 'OPERATOR')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.user;
      const { auditRunId } = request.params as { auditRunId: string };
      try {
        const actions = await svc.listActionsForAuditRun(tenantId, auditRunId);
        return reply.send(ok({ actions }));
      } catch (e) {
        return reply.status(500).send(err('LIST_ACTIONS_FAILED', e instanceof Error ? e.message : 'unknown'));
      }
    },
  );

  // ── PUBLIC ACCEPT ROUTE (no JWT yet) ─────────────────────────────────

  fastify.post('/auditor/accept/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.params as { token: string };
    void acceptInviteSchema.safeParse(request.body ?? {}); // body intentionally empty
    if (!token || token.length < 32) {
      return reply.status(400).send(err('INVALID_TOKEN', 'Token missing or malformed'));
    }
    try {
      const result = await svc.acceptInvite({ cleartextToken: token });
      // Issue a JWT scoped to this auditor.
      const jwt = authSvc.signToken({
        userId: result.userId,
        tenantId: result.tenantId,
        email: '',
        role: 'EXTERNAL_AUDITOR',
        name: '',
      } as AuthSession);
      return reply.send(ok({
        token: jwt,
        engagement: {
          id: result.engagementId,
          auditRunId: result.auditRunId,
          tenantId: result.tenantId,
          scopes: result.scopes,
          expiresAt: result.expiresAt.toISOString(),
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      return reply.status(401).send(err('INVITE_INVALID', msg));
    }
  });

  // ── AUDITOR ROUTES (require EXTERNAL_AUDITOR + active engagement) ────

  fastify.get(
    '/auditor/runs',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as AuthSession;
      if (user.role !== 'EXTERNAL_AUDITOR') {
        return reply.status(403).send(err('FORBIDDEN', 'Auditor role required'));
      }
      const engagements = await svc.listEngagementsForAuditor(user.userId);
      return reply.send(ok({ engagements }));
    },
  );

  fastify.get(
    '/auditor/runs/:auditRunId',
    { preHandler: [fastify.authenticate, requireAuditorEngagement(svc)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as AuthSession;
      const { auditRunId } = request.params as { auditRunId: string };
      const engagement = (request as FastifyRequest & { engagement: { id: string; tenantId: string } }).engagement;
      // Read the audit run scoped to engagement tenant.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auditRun = await (fastify.db as any).auditRun.findFirst({
        where: { id: auditRunId, tenantId: engagement.tenantId },
      });
      if (!auditRun) return reply.status(404).send(err('NOT_FOUND', 'Audit run not found'));
      // Log the view action.
      await svc.logAction({
        tenantId: engagement.tenantId,
        userId: user.userId,
        auditorEmail: user.email ?? '',
        auditRunId,
        engagementId: engagement.id,
        objectType: 'engagement',
        action: 'view',
      });
      return reply.send(ok({ auditRun }));
    },
  );

  fastify.get(
    '/auditor/runs/:auditRunId/workpapers',
    { preHandler: [fastify.authenticate, requireAuditorEngagement(svc)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as AuthSession;
      const { auditRunId } = request.params as { auditRunId: string };
      const engagement = (request as FastifyRequest & { engagement: { id: string; tenantId: string } }).engagement;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const workpapers = await (fastify.db as any).auditWorkpaper.findMany({
        where: { auditRunId, tenantId: engagement.tenantId },
        orderBy: { createdAt: 'desc' },
      });
      await svc.logAction({
        tenantId: engagement.tenantId,
        userId: user.userId,
        auditorEmail: user.email ?? '',
        auditRunId,
        engagementId: engagement.id,
        objectType: 'workpaper',
        action: 'view',
      });
      return reply.send(ok({ workpapers }));
    },
  );

  fastify.post(
    '/auditor/runs/:auditRunId/workpapers/:wpId/decide',
    { preHandler: [fastify.authenticate, requireAuditorEngagement(svc)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as AuthSession;
      const { auditRunId, wpId } = request.params as { auditRunId: string; wpId: string };
      const engagement = (request as FastifyRequest & {
        engagement: { id: string; tenantId: string; scopes: string[] };
      }).engagement;
      // Scope check: 'decide_workpapers' must be in engagement.scopes
      if (!engagement.scopes.includes('decide_workpapers')) {
        return reply.status(403).send(err('SCOPE_DENIED', 'decide_workpapers scope required'));
      }
      const parsed = decideWorkpaperSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      // Verify the workpaper belongs to this audit run.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wp = await (fastify.db as any).auditWorkpaper.findFirst({
        where: { id: wpId, auditRunId, tenantId: engagement.tenantId },
      });
      if (!wp) return reply.status(404).send(err('NOT_FOUND', 'Workpaper not found'));

      // Log the action FIRST so the audit trail captures intent even
      // if the mutation fails.
      const actionType =
        parsed.data.decision === 'APPROVE'
          ? 'approve'
          : parsed.data.decision === 'REJECT'
            ? 'reject'
            : 'request_changes';
      await svc.logAction({
        tenantId: engagement.tenantId,
        userId: user.userId,
        auditorEmail: user.email ?? '',
        auditRunId,
        engagementId: engagement.id,
        objectType: 'workpaper',
        objectId: wpId,
        action: actionType,
        ...(parsed.data.comment !== undefined ? { comment: parsed.data.comment } : {}),
        metadata: { previousStatus: wp.status },
      });

      // Update the workpaper status. The actual "approval"/"rejection"
      // semantics for downstream artifacts (e.g. final pack gating) is
      // owned by WorkpaperService; here we set the auditor-decision
      // metadata.
      const newStatus =
        parsed.data.decision === 'APPROVE'
          ? 'auditor_approved'
          : parsed.data.decision === 'REJECT'
            ? 'auditor_rejected'
            : 'auditor_changes_requested';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated = await (fastify.db as any).auditWorkpaper.update({
        where: { id: wpId },
        data: { status: newStatus },
      });
      return reply.send(ok({ workpaper: updated }));
    },
  );

  fastify.post(
    '/auditor/runs/:auditRunId/comment',
    { preHandler: [fastify.authenticate, requireAuditorEngagement(svc)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as AuthSession;
      const { auditRunId } = request.params as { auditRunId: string };
      const engagement = (request as FastifyRequest & {
        engagement: { id: string; tenantId: string; scopes: string[] };
      }).engagement;
      if (!engagement.scopes.includes('comment')) {
        return reply.status(403).send(err('SCOPE_DENIED', 'comment scope required'));
      }
      const parsed = commentSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      await svc.logAction({
        tenantId: engagement.tenantId,
        userId: user.userId,
        auditorEmail: user.email ?? '',
        auditRunId,
        engagementId: engagement.id,
        objectType: 'engagement',
        action: 'comment',
        comment: parsed.data.comment,
      });
      return reply.send(ok({ logged: true }));
    },
  );
};

export default externalAuditorRoutes;
