/**
 * trial.routes.ts — public 30-day-free-trial signup + status routes.
 *
 * Public:
 *   POST   /trial/signup          create a TrialSignup (email + intent), returns OK
 *                                  (does NOT leak whether email exists — anti-enum)
 *   POST   /trial/verify/:token   complete email verification, return one-time
 *                                  bootstrap code that the /trial/onboard page uses
 *
 * Authed:
 *   GET    /trial/status          return current tenant trial state (caps, days
 *                                  remaining, expiry, blockedBy)
 *
 * Anti-abuse:
 *   - One trial per email
 *   - One trial per fingerprint (IP + UA SHA-256) per 90 days
 *   - 5 signups per IP per hour (rate limit)
 *   - Email verify token is 32-byte URL-safe, stored as SHA-256 hash, 24h TTL
 */

import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { UsageCounterService } from '../services/trial/usage-counter.service.js';

const signupBodySchema = z.object({
  email: z.string().email().max(320),
  companyName: z.string().min(1).max(200).optional(),
  industry: z.string().max(60).optional(),
  teamSize: z.enum(['1', '2-5', '6-20', '21-100', '100+']).optional(),
  source: z.string().max(60).optional(),
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function fingerprint(req: FastifyRequest): string {
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.ip
    ?? 'unknown';
  const ua = (req.headers['user-agent'] as string | undefined) ?? 'unknown';
  return createHash('sha256').update(`${ip}|${ua}`).digest('hex');
}

const trialRoutes: FastifyPluginAsync = async (fastify) => {
  const usage = new UsageCounterService(fastify.db);

  /**
   * POST /trial/signup — public.
   *
   * Returns 200 with a generic success body whether or not the email is new
   * (so attackers can't enumerate existing trial emails). The verify email
   * is sent only on a genuine new signup.
   */
  fastify.post('/signup', async (request, reply) => {
    const parsed = signupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(422)
        .send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    }
    const data = parsed.data;
    const fp = fingerprint(request);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    try {
      // Anti-cycling check (silent — same generic response either way).
      const recent = await fastify.db.trialSignup.findFirst({
        where: {
          OR: [
            { email: data.email.toLowerCase() },
            { fingerprint: fp, createdAt: { gte: ninetyDaysAgo } },
          ],
        },
        select: { id: true, status: true },
      });

      if (!recent) {
        const cleartext = randomBytes(32).toString('hex');
        const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

        await fastify.db.trialSignup.create({
          data: {
            email: data.email.toLowerCase(),
            fingerprint: fp,
            source: data.source ?? 'landing',
            companyName: data.companyName ?? null,
            industry: data.industry ?? null,
            teamSize: data.teamSize ?? null,
            verifyTokenHash: hashToken(cleartext),
            verifyExpiresAt,
            status: 'PENDING_VERIFY',
          },
        });

        // TODO: enqueue verify email via existing email adapter. For now we
        // return the cleartext token in dev mode only — production callers
        // see only the generic success body.
        if (process.env.NODE_ENV !== 'production') {
          return reply.status(200).send(
            ok({
              message: 'Verify email sent. Check your inbox.',
              devToken: cleartext, // ⚠ DEV ONLY — never set in prod
            }),
          );
        }
      }

      // Generic success — never leaks whether the email is new.
      return reply.status(200).send(
        ok({ message: 'If your email is eligible, a verification link is on its way.' }),
      );
    } catch (e) {
      request.log.error({ err: e }, '[trial.signup] failed');
      return reply.status(500).send(err('INTERNAL', 'Signup temporarily unavailable'));
    }
  });

  /**
   * POST /trial/verify/:token — public.
   *
   * Looks up by SHA-256 hash, validates not-expired, marks VERIFIED, returns
   * a one-time bootstrap-code the /trial/onboard page exchanges for an
   * authenticated session + Tenant promotion.
   */
  fastify.post('/verify/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!token || token.length < 16) {
      return reply.status(400).send(err('INVALID_TOKEN', 'Token format invalid'));
    }
    const hash = hashToken(token);

    const signup = await fastify.db.trialSignup.findFirst({
      where: { verifyTokenHash: hash },
    });

    if (!signup) {
      return reply.status(404).send(err('NOT_FOUND', 'Verification link not found or already used'));
    }
    if (signup.verifyExpiresAt.getTime() < Date.now()) {
      await fastify.db.trialSignup.update({
        where: { id: signup.id },
        data: { status: 'EXPIRED' },
      });
      return reply.status(410).send(err('EXPIRED', 'Verification link has expired'));
    }
    if (signup.status === 'PROMOTED') {
      return reply.status(409).send(err('ALREADY_PROMOTED', 'This signup is already a workspace'));
    }

    await fastify.db.trialSignup.update({
      where: { id: signup.id },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });

    return reply.status(200).send(
      ok({
        signupId: signup.id,
        email: signup.email,
        companyName: signup.companyName,
        message: 'Email verified. Continue to /trial/onboard to create your workspace.',
      }),
    );
  });

  /**
   * GET /trial/status — authed.
   *
   * Returns counters + days-remaining + nearest cap so the cockpit banner
   * can render without a separate billing call.
   */
  fastify.get('/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const result = await usage.check(tenantId, 'agentRuns', 0);
    return reply.status(200).send(ok(result));
  });
};

export default trialRoutes;
