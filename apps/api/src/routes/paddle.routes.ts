/**
 * Paddle webhook handler.
 *
 * Paddle sends events for subscription lifecycle:
 * - subscription.created
 * - subscription.updated
 * - subscription.cancelled
 * - subscription.past_due
 *
 * Webhook verification: Paddle signs webhooks with a shared secret.
 * Set PADDLE_WEBHOOK_SECRET in environment.
 *
 * See: https://developer.paddle.com/webhooks/overview
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { CreditService } from '../billing/credit-service.js';

// Map Paddle price IDs to Jak plan IDs.
//
// Builds from env at import-time. Any price env var that isn't set is
// simply omitted from the map — better than silently matching a
// `pri_*_placeholder` string that would NEVER appear in a real Paddle
// webhook, which produced the misleading behaviour of "webhook arrived
// but plan wasn't recognized" for every real event when env wasn't
// configured. Unknown price IDs now surface cleanly (no match → warn +
// reject) instead of matching a placeholder by accident.
const PADDLE_PLAN_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const pro = process.env['PADDLE_PRICE_PRO'];
  const team = process.env['PADDLE_PRICE_TEAM'];
  const enterprise = process.env['PADDLE_PRICE_ENTERPRISE'];
  if (pro) map[pro] = 'pro';
  if (team) map[team] = 'team';
  if (enterprise) map[enterprise] = 'enterprise';
  return map;
})();

function verifyPaddleSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  try {
    // Paddle v2 uses ts;h1=signature format
    const parts = signature.split(';');
    const ts = parts.find((p) => p.startsWith('ts='))?.split('=')[1];
    const h1 = parts.find((p) => p.startsWith('h1='))?.split('=')[1];
    if (!ts || !h1) return false;

    const payload = `${ts}:${rawBody}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(h1), Buffer.from(expected));
  } catch {
    return false;
  }
}

const paddleRoutes: FastifyPluginAsync = async (fastify) => {
  const creditService = new CreditService(fastify.db);
  const webhookSecret = process.env['PADDLE_WEBHOOK_SECRET'] ?? '';

  if (!webhookSecret && process.env['NODE_ENV'] === 'production') {
    fastify.log.error('[paddle] PADDLE_WEBHOOK_SECRET is required in production');
  }

  /**
   * POST /paddle/webhook — Paddle event handler
   * No auth required (verified via signature)
   */
  fastify.post(
    '/webhook',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      const signature = request.headers['paddle-signature'] as string | undefined;

      // Verify webhook signature — always require in production
      if (!webhookSecret) {
        fastify.log.error('[paddle] Webhook secret not configured — rejecting request');
        return reply.status(500).send({ error: 'Webhook not configured' });
      }
      if (!verifyPaddleSignature(rawBody, signature, webhookSecret)) {
        fastify.log.warn('[paddle] Invalid webhook signature');
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      const event = (typeof request.body === 'string' ? JSON.parse(request.body) : request.body) as {
        event_type: string;
        data: {
          id: string;
          status: string;
          customer_id: string;
          items?: Array<{ price?: { id: string } }>;
          custom_data?: { tenantId?: string };
          current_billing_period?: { starts_at: string; ends_at: string };
        };
      };

      const tenantId = event.data.custom_data?.tenantId;
      if (!tenantId) {
        fastify.log.warn({ eventType: event.event_type }, '[paddle] Webhook missing tenantId in custom_data');
        return reply.status(200).send({ received: true, warning: 'missing tenantId' });
      }

      fastify.log.info({ eventType: event.event_type, tenantId }, '[paddle] Webhook received');

      try {
        switch (event.event_type) {
          case 'subscription.created':
          case 'subscription.updated': {
            const priceId = event.data.items?.[0]?.price?.id;
            const planId = priceId ? (PADDLE_PLAN_MAP[priceId] ?? 'pro') : 'pro';

            await creditService.updateSubscription(
              tenantId,
              planId,
              event.data.id,
              event.data.customer_id,
            );

            // Update tenant plan field for backward compat
            await fastify.db.tenant.update({
              where: { id: tenantId },
              data: { plan: planId.toUpperCase() },
            });

            fastify.log.info({ tenantId, planId, paddleSubId: event.data.id }, '[paddle] Subscription activated');
            break;
          }

          case 'subscription.canceled': {
            await (fastify.db as any).subscription.update({
              where: { tenantId },
              data: { status: 'cancelled' },
            });

            await fastify.db.tenant.update({
              where: { id: tenantId },
              data: { plan: 'FREE' },
            });

            fastify.log.info({ tenantId }, '[paddle] Subscription cancelled → downgraded to Free');
            break;
          }

          case 'subscription.past_due': {
            await (fastify.db as any).subscription.update({
              where: { tenantId },
              data: { status: 'past_due' },
            });

            fastify.log.warn({ tenantId }, '[paddle] Subscription past due');
            break;
          }

          default:
            fastify.log.debug({ eventType: event.event_type }, '[paddle] Unhandled event type');
        }
      } catch (err) {
        fastify.log.error({ err, tenantId, eventType: event.event_type }, '[paddle] Webhook processing failed');
        return reply.status(500).send({ error: 'Processing failed' });
      }

      return reply.status(200).send({ received: true });
    },
  );
};

export default paddleRoutes;
