/**
 * Slack Channel Bridge
 *
 * Maps Slack events into JAK Swarm workflow executions and posts results
 * back to the originating Slack thread.
 *
 * Slack sends events to POST /slack/events:
 *   - url_verification (handshake challenge)
 *   - event_callback.message (new messages in channels where the bot is invited)
 *   - event_callback.app_mention (direct @mentions)
 *   - interactive actions (slash commands, buttons — future extension)
 *
 * Webhook verification: Slack signs requests with HMAC-SHA256 using the
 * app's signing secret. All non-challenge requests are verified.
 *
 * Tenant resolution: The Slack workspace (team_id) is mapped to a JAK
 * tenantId via the `integration` table (provider = 'SLACK').
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { SlackChannelAdapter } from '../channels/slack-adapter.js';

/* ---------------------------------------------------------------------- */
/*  Route plugin                                                           */
/* ---------------------------------------------------------------------- */

const slackRoutes: FastifyPluginAsync = async (fastify) => {
  const signingSecret = process.env['SLACK_SIGNING_SECRET'] ?? '';

  if (!signingSecret && process.env['NODE_ENV'] === 'production') {
    fastify.log.error('[slack] SLACK_SIGNING_SECRET is required in production');
  }

  // Lazy-import the existing decrypt helper so the adapter doesn't
  // hard-couple to fastify boot. Same crypto.ts used by the prior
  // inline path; this is a pure refactor.
  const { decrypt } = await import('../utils/crypto.js');
  const slackAdapter = new SlackChannelAdapter(signingSecret, decrypt);

  /* -------------------------------------------------------------------- */
  /*  POST /slack/events — main Slack webhook endpoint                    */
  /* -------------------------------------------------------------------- */

  fastify.post(
    '/events',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody =
        typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body);

      const payload =
        typeof request.body === 'string' ? JSON.parse(request.body) : request.body;

      // 1. Handshake (no signature required).
      const handshake = slackAdapter.handleHandshake(payload);
      if (handshake.handled) {
        return reply.send(handshake.response);
      }

      // 2. Signature verification.
      if (!signingSecret) {
        fastify.log.error('[slack] Signing secret not configured — rejecting');
        return reply.status(500).send({ error: 'Slack bridge not configured' });
      }
      if (!slackAdapter.verifySignature(rawBody, request.headers as Record<string, string | string[] | undefined>)) {
        fastify.log.warn('[slack] Invalid webhook signature');
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      // 3. Normalize inbound — drops bot echoes, edits, non-message events.
      const inbound = slackAdapter.extractInbound(payload);
      if (!inbound) return reply.status(200).send({ ok: true });

      // 4. Resolve tenant.
      const tenant = await slackAdapter.resolveTenant(payload, fastify.db, fastify.log);
      if (!tenant) {
        fastify.log.warn(
          { teamId: (payload as { team_id?: string }).team_id },
          '[slack] No connected integration for workspace',
        );
        return reply.status(200).send({ ok: true });
      }

      // 5. Idempotency + workflow create + fire-and-forget execution.
      const teamId = (payload as { team_id?: string }).team_id ?? '';
      const channelStr = inbound.replyContext['channel'] as string;
      const threadTs = inbound.replyContext['threadTs'] as string;
      const idempotencyKey = `slack:${teamId}:${channelStr}:${inbound.externalMessageId}`;

      try {
        const existingWorkflow = await fastify.db.workflow.findFirst({
          where: {
            tenantId: tenant.tenantId,
            stateJson: { path: ['slackIdempotencyKey'], equals: idempotencyKey },
          },
        });
        if (existingWorkflow) {
          fastify.log.info({ idempotencyKey }, '[slack] Duplicate event — skipping');
          return reply.status(200).send({ ok: true });
        }

        const workflow = await fastify.db.workflow.create({
          data: {
            tenantId: tenant.tenantId,
            userId: inbound.externalUserId || 'slack-bot',
            goal: inbound.text,
            status: 'PENDING',
            stateJson: {
              source: 'SLACK',
              slackChannel: channelStr,
              slackThread: threadTs,
              slackUser: inbound.externalUserId,
              slackTeam: teamId,
              slackIdempotencyKey: idempotencyKey,
            },
          },
        });

        setImmediate(() => {
          void (async () => {
            try {
              await fastify.swarm.executeAsync({
                workflowId: workflow.id,
                tenantId: tenant.tenantId,
                userId: inbound.externalUserId || 'slack-bot',
                goal: inbound.text,
              });

              const completed = await fastify.db.workflow.findUnique({
                where: { id: workflow.id },
                select: { finalOutput: true, status: true },
              });

              if (completed?.finalOutput) {
                await slackAdapter.reply(
                  tenant.accessToken,
                  inbound.replyContext,
                  `*Workflow complete* (${completed.status})\n\n${completed.finalOutput}`,
                  fastify.log,
                );
              }
            } catch (err) {
              fastify.log.error({ err, workflowId: workflow.id }, '[slack] Workflow execution failed');
              await slackAdapter.reply(
                tenant.accessToken,
                inbound.replyContext,
                `⚠️ Workflow failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                fastify.log,
              );
            }
          })();
        });

        // Acknowledge Slack within 3 seconds (required by Slack API).
        return reply.status(200).send({ ok: true });
      } catch (err) {
        fastify.log.error({ err }, '[slack] Failed to create workflow');
        return reply.status(500).send({ error: 'Internal error' });
      }
    },
  );

  /* -------------------------------------------------------------------- */
  /*  POST /slack/interactivity — button/action callbacks (future)        */
  /* -------------------------------------------------------------------- */

  fastify.post(
    '/interactivity',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody =
        typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body);

      if (!slackAdapter.verifySignature(rawBody, request.headers as Record<string, string | string[] | undefined>)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      // Placeholder for interactive component handling (approval buttons, etc.)
      fastify.log.info('[slack] Interactivity payload received');
      return reply.status(200).send({ ok: true });
    },
  );
};

export default slackRoutes;
