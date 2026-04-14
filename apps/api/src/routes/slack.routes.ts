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
import crypto from 'crypto';

/* ---------------------------------------------------------------------- */
/*  Slack signature verification                                          */
/* ---------------------------------------------------------------------- */

function verifySlackSignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  signingSecret: string,
): boolean {
  if (!timestamp || !signature || !signingSecret) return false;

  // Protect against replay attacks — reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');

  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/*  Types                                                                  */
/* ---------------------------------------------------------------------- */

interface SlackEvent {
  type: string;
  challenge?: string;
  token?: string;
  team_id?: string;
  event?: {
    type: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
  };
}

/* ---------------------------------------------------------------------- */
/*  Route plugin                                                           */
/* ---------------------------------------------------------------------- */

const slackRoutes: FastifyPluginAsync = async (fastify) => {
  const signingSecret = process.env['SLACK_SIGNING_SECRET'] ?? '';

  if (!signingSecret && process.env['NODE_ENV'] === 'production') {
    fastify.log.error('[slack] SLACK_SIGNING_SECRET is required in production');
  }

  /**
   * Resolve a Slack team_id to a JAK tenantId using stored integration records.
   */
  async function resolveTenant(teamId: string): Promise<{
    tenantId: string;
    accessToken: string;
  } | null> {
    const integration = await fastify.db.integration.findFirst({
      where: { provider: 'SLACK', status: 'CONNECTED', metadata: { path: ['team_id'], equals: teamId } },
      include: { credentials: true },
    });
    if (!integration?.credentials) return null;

    // Decrypt token — the credential stores the full JSON blob
    let creds: Record<string, string>;
    try {
      const { decrypt } = await import('../utils/crypto.js');
      creds = JSON.parse(decrypt(integration.credentials.accessTokenEnc)) as Record<string, string>;
    } catch (decryptErr) {
      fastify.log.error({ teamId, err: decryptErr }, '[slack] Failed to decrypt/parse credentials');
      return null;
    }
    const accessToken = creds['bot_token'] ?? creds['access_token'] ?? '';
    if (!accessToken) return null;

    return { tenantId: integration.tenantId, accessToken };
  }

  /**
   * Post a message back to Slack (thread reply).
   */
  async function postSlackReply(
    accessToken: string,
    channel: string,
    threadTs: string,
    text: string,
  ): Promise<void> {
    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel, thread_ts: threadTs, text }),
      });
      if (!res.ok) {
        fastify.log.warn({ status: res.status }, '[slack] Failed to post reply');
      }
    } catch (err) {
      fastify.log.error({ err }, '[slack] Error posting reply');
    }
  }

  /* -------------------------------------------------------------------- */
  /*  POST /slack/events — main Slack webhook endpoint                    */
  /* -------------------------------------------------------------------- */

  fastify.post(
    '/events',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);

      const event = (typeof request.body === 'string'
        ? JSON.parse(request.body)
        : request.body) as SlackEvent;

      // ----------------------------------------------------------
      // 1. URL verification challenge (no signature check needed)
      // ----------------------------------------------------------
      if (event.type === 'url_verification') {
        return reply.send({ challenge: event.challenge });
      }

      // ----------------------------------------------------------
      // 2. Verify request signature
      // ----------------------------------------------------------
      if (!signingSecret) {
        fastify.log.error('[slack] Signing secret not configured — rejecting');
        return reply.status(500).send({ error: 'Slack bridge not configured' });
      }

      const timestamp = request.headers['x-slack-request-timestamp'] as string | undefined;
      const signature = request.headers['x-slack-signature'] as string | undefined;

      if (!verifySlackSignature(rawBody, timestamp, signature, signingSecret)) {
        fastify.log.warn('[slack] Invalid webhook signature');
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      // ----------------------------------------------------------
      // 3. Ignore bot messages + message subtypes (edits, deletes)
      // ----------------------------------------------------------
      const slackEvent = event.event;
      if (!slackEvent || slackEvent.bot_id || slackEvent.subtype) {
        return reply.status(200).send({ ok: true });
      }

      // ----------------------------------------------------------
      // 4. Only process message + app_mention events
      // ----------------------------------------------------------
      if (slackEvent.type !== 'message' && slackEvent.type !== 'app_mention') {
        return reply.status(200).send({ ok: true });
      }

      const text = slackEvent.text?.trim();
      if (!text || !slackEvent.channel) {
        return reply.status(200).send({ ok: true });
      }

      // ----------------------------------------------------------
      // 5. Resolve Slack workspace → JAK tenant
      // ----------------------------------------------------------
      const teamId = event.team_id;
      if (!teamId) {
        fastify.log.warn('[slack] Event missing team_id');
        return reply.status(200).send({ ok: true });
      }

      const tenant = await resolveTenant(teamId);
      if (!tenant) {
        fastify.log.warn({ teamId }, '[slack] No connected integration for workspace');
        return reply.status(200).send({ ok: true });
      }

      // ----------------------------------------------------------
      // 6. Create workflow + trigger execution
      // ----------------------------------------------------------
      const threadTs = slackEvent.thread_ts ?? slackEvent.ts ?? '';
      const channel = slackEvent.channel;

      fastify.log.info(
        { tenantId: tenant.tenantId, channel, user: slackEvent.user },
        '[slack] Triggering workflow from Slack message',
      );

      try {
        // Idempotency: prevent duplicate workflows from Slack retries
        const idempotencyKey = `slack:${teamId}:${channel}:${slackEvent.ts}`;
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

        // Create workflow record
        const workflow = await fastify.db.workflow.create({
          data: {
            tenantId: tenant.tenantId,
            userId: slackEvent.user ?? 'slack-bot',
            goal: text,
            status: 'PENDING',
            stateJson: {
              source: 'SLACK',
              slackChannel: channel,
              slackThread: threadTs,
              slackUser: slackEvent.user,
              slackTeam: teamId,
              slackIdempotencyKey: idempotencyKey,
            },
          },
        });

        // Fire-and-forget workflow execution
        setImmediate(() => {
          void (async () => {
            try {
              await fastify.swarm.executeAsync({
                workflowId: workflow.id,
                tenantId: tenant.tenantId,
                userId: slackEvent.user ?? 'slack-bot',
                goal: text,
              });

              // Post completion back to Slack thread
              const completed = await fastify.db.workflow.findUnique({
                where: { id: workflow.id },
                select: { finalOutput: true, status: true },
              });

              if (completed?.finalOutput) {
                const resultText = completed.finalOutput;
                await postSlackReply(
                  tenant.accessToken,
                  channel,
                  threadTs,
                  `*Workflow complete* (${completed.status})\n\n${resultText}`,
                );
              }
            } catch (err) {
              fastify.log.error({ err, workflowId: workflow.id }, '[slack] Workflow execution failed');
              await postSlackReply(
                tenant.accessToken,
                channel,
                threadTs,
                `⚠️ Workflow failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
              );
            }
          })();
        });

        // Acknowledge Slack within 3 seconds (required by Slack API)
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
      const rawBody = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);

      const timestamp = request.headers['x-slack-request-timestamp'] as string | undefined;
      const signature = request.headers['x-slack-signature'] as string | undefined;

      if (!verifySlackSignature(rawBody, timestamp, signature, signingSecret)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      // Placeholder for interactive component handling (approval buttons, etc.)
      fastify.log.info('[slack] Interactivity payload received');
      return reply.status(200).send({ ok: true });
    },
  );
};

export default slackRoutes;
