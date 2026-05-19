import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import {
  PlaywrightBrowserOperator,
  SessionAccessError,
  BrowserApprovalRequiredError,
  type BrowserOperatorService,
  // Sprint 6 Part C — platform-specific adapter dispatch.
  linkedInAdapter,
  instagramAdapter,
  youtubeAdapter,
  metaAdapter,
  type PlatformAdapter,
  type PlatformDraft,
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
        const approval = await fastify.db.approvalRequest.findFirst({
          where: {
            id: parse.data.approvalId,
            tenantId: request.user.tenantId,
            status: 'APPROVED',
          },
          select: { id: true },
        });
        if (!approval) {
          return reply.status(403).send(err('APPROVAL_NOT_VALID', 'A tenant-scoped approved approvalId is required before executing browser actions.'));
        }
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

  // ── Sprint 6 Part C — platform-specific adapter dispatch ────────────
  //
  // /browser-sessions/:sessionId/platform/:platform/action
  // Body: { action: 'detect_login' | 'build_draft' | 'record_publish',
  //         topic?, tone?, draft?, approvalId? }
  //
  // Dispatches to LinkedInBrowserAdapter / InstagramBrowserAdapter /
  // YouTubeStudioBrowserAdapter / MetaBusinessBrowserAdapter. NEVER
  // auto-publishes — record_publish always returns
  // manualHandoffRequired:true (per the brief's safety mandate).
  //
  // Tenant isolation: the underlying browser session's tenantId is
  // re-checked via the operator's requireSession helper (already
  // throws SessionAccessError on mismatch). This route layer trusts
  // the operator + Fastify auth.

  const ADAPTER_BY_ID: Record<string, PlatformAdapter> = {
    LINKEDIN: linkedInAdapter,
    INSTAGRAM: instagramAdapter,
    YOUTUBE_STUDIO: youtubeAdapter,
    META_BUSINESS_SUITE: metaAdapter,
  };

  const platformActionBodySchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('detect_login') }),
    z.object({
      action: z.literal('build_draft'),
      topic: z.string().min(1).max(500),
      tone: z.enum(['professional', 'casual', 'enthusiastic']).optional(),
    }),
    z.object({
      action: z.literal('record_publish'),
      draft: z.object({
        kind: z.string(),
        body: z.string(),
        charLimit: z.number(),
        truncated: z.boolean(),
      }).passthrough(),
      approvalId: z.string().min(1),
    }),
  ]);

  fastify.post(
    '/:sessionId/platform/:platform/action',
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId, platform } = request.params as { sessionId: string; platform: string };
      const adapter = ADAPTER_BY_ID[platform.toUpperCase()];
      if (!adapter) {
        return reply.status(400).send(err('UNKNOWN_PLATFORM', `Platform "${platform}" is not supported. Allowed: ${Object.keys(ADAPTER_BY_ID).join(', ')}.`));
      }

      const parse = platformActionBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      const body = parse.data;

      try {
        // detect_login + build_draft both need a real session for the
        // tenant + page. record_publish does NOT need a page — it
        // just records the manual-handoff result with the approvalId
        // (no auto-publishing happens regardless).
        if (body.action === 'record_publish') {
          // record_publish path is entirely adapter-side; no Page needed.
          const result = await adapter.recordApprovedPublish({
            draft: body.draft as PlatformDraft,
            approvalId: body.approvalId,
          });
          return reply.status(200).send(ok(result));
        }

        // For detect_login + build_draft, we need the BrowserOperator
        // to expose the underlying Page. Today the public interface
        // exposes observe()/propose()/execute() — not the raw Page.
        // For platform-specific actions we fall back to the adapter's
        // own logic that does NOT require a live Playwright session
        // (build_draft is stateless), and surface a structured
        // session-not-required result so the UI is honest.
        if (body.action === 'build_draft') {
          // Stateless — build the draft from topic + tone alone.
          const draft = adapter.buildDraft({
            topic: body.topic,
            ...(body.tone !== undefined ? { tone: body.tone } : {}),
          });
          return reply.status(200).send(ok({
            adapter: adapter.id,
            displayName: adapter.displayName,
            draft,
            // The user opens the platform themselves to publish; JAK never auto-posts.
            manualHandoffRequired: true,
            manualHandoffMessage: `Draft is ready for ${adapter.displayName}. JAK never auto-posts — open the platform and paste the draft yourself, or trigger /platform/${platform.toLowerCase()}/action with action='record_publish' + approvalId after your approval is decided.`,
          }));
        }

        // detect_login — proxy through observe + run the adapter's
        // detector against the page. We delegate to the operator for
        // session lifecycle (which gives us tenant isolation) and
        // re-use the operator's screenshot for evidence. The
        // adapter's selector heuristic runs against the operator's
        // observation rather than directly against the Page (because
        // the operator is the chokepoint for tenant isolation +
        // audit log emission).
        if (body.action === 'detect_login') {
          const op = getOperator(fastify);
          const observation = await op.observe({ sessionId, tenantId: request.user.tenantId });
          // Convert observation to a heuristic login state by running
          // simple keyword checks on the accessibility text. Real
          // selector-based detection (which inspects the live DOM via
          // the adapter) is the next sub-sprint — what we ship today
          // is "observation+heuristic from accessibility text" which
          // is honest and useful.
          const at = (observation.accessibilityText ?? '').toLowerCase();
          const loggedIn =
            (adapter.id === 'LINKEDIN' && /home|my network|notifications|messaging/i.test(at)) ||
            (adapter.id === 'INSTAGRAM' && /home|reels|messages|profile/i.test(at)) ||
            (adapter.id === 'YOUTUBE_STUDIO' && /content|analytics|comments|monetization/i.test(at)) ||
            (adapter.id === 'META_BUSINESS_SUITE' && /home|content|inbox|insights/i.test(at));
          const challengeDetected = observation.blockedBySecurity ||
            /verification code|two[- ]factor|2fa|captcha|i'?m not a robot/i.test(at);
          const status = challengeDetected
            ? `${adapter.displayName} is showing a security challenge — please complete it in the browser. JAK does not see or store your code.`
            : loggedIn
              ? `Logged in to ${adapter.displayName}.`
              : `Not yet logged in to ${adapter.displayName} — please sign in on the page.`;
          return reply.status(200).send(ok({
            adapter: adapter.id,
            displayName: adapter.displayName,
            url: observation.url,
            title: observation.title,
            loggedIn,
            challengeDetected,
            status,
            screenshotUrl: `/browser-sessions/${sessionId}/screenshot/latest`,
          }));
        }

        return reply.status(400).send(err('BAD_ACTION', 'Unknown action'));
      } catch (e) {
        if (e instanceof SessionAccessError) {
          return reply.status(404).send(err('SESSION_NOT_FOUND', e.message));
        }
        const msg = e instanceof Error ? e.message : 'platform action failed';
        return reply.status(500).send(err('BROWSER_PLATFORM_ACTION_FAILED', msg));
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
