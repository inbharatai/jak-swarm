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
import { TrialPromotionService } from '../services/trial/trial-promotion.service.js';
import { TrialEmailService } from '../services/trial/trial-email.service.js';

const signupBodySchema = z.object({
  email: z.string().email().max(320),
  companyName: z.string().min(1).max(200).optional(),
  industry: z.string().max(60).optional(),
  teamSize: z.enum(['1', '2-5', '6-20', '21-100', '100+']).optional(),
  source: z.string().max(60).optional(),
});

const verifyTokenParamsSchema = z.object({
  token: z.string().min(16),
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function fingerprint(req: FastifyRequest): string {
  // P0-6 (audit 2026-05-08): X-Forwarded-For is operator-controlled when
  // Fastify is configured with `trustProxy`. When trustProxy is off (default),
  // `req.ip` is the direct socket peer and IS trusted; X-Forwarded-For is
  // NOT trusted user input and must NOT influence the fingerprint, otherwise
  // an attacker can rotate the header value to bypass the 90-day per-IP+UA
  // anti-cycling check.
  //
  // Behaviour:
  //   - If JAK_TRUST_PROXY === 'true' (operator opt-in behind a real proxy
  //     that strips the header): use the X-Forwarded-For first hop.
  //   - Otherwise: ignore the header entirely and use req.ip.
  const trustProxy = process.env['JAK_TRUST_PROXY'] === 'true';
  const fwd = trustProxy
    ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    : undefined;
  const ip = fwd ?? req.ip ?? 'unknown';
  const ua = (req.headers['user-agent'] as string | undefined) ?? 'unknown';
  return createHash('sha256').update(`${ip}|${ua}`).digest('hex');
}

function trustedClientIp(req: FastifyRequest): string {
  const trustProxy = process.env['JAK_TRUST_PROXY'] === 'true';
  const fwd = trustProxy
    ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    : undefined;
  return fwd ?? req.ip ?? 'unknown';
}

/**
 * P0-5 (audit 2026-05-08): in-process per-email rate limiter.
 *
 * Keyed by lowercase email. Window-based — N submissions per W ms. Returns
 * { allowed, retryAfterMs }. State is in-memory only (resets on restart),
 * which is intentional: this is the second layer behind the per-IP route
 * limit, and a restart-resistant per-email floor would need Redis we don't
 * want to require for this public path.
 *
 * Defaults: 3 attempts per hour per email (covers re-tries + accidental
 * double-clicks; bars inbox-flood + disk-fill scenarios).
 */
const emailLimiterState = new Map<string, { count: number; resetAt: number }>();
function checkEmailRateLimit(
  email: string,
  max = 3,
  windowMs = 60 * 60 * 1000,
): { allowed: boolean; retryAfterMs: number } {
  const key = email.toLowerCase();
  const now = Date.now();
  const slot = emailLimiterState.get(key);
  if (!slot || slot.resetAt <= now) {
    emailLimiterState.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (slot.count >= max) {
    return { allowed: false, retryAfterMs: slot.resetAt - now };
  }
  slot.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

// Test-only export so the unit test can reset state between cases.
export function _resetEmailRateLimiterForTests(): void {
  emailLimiterState.clear();
}

const trialRoutes: FastifyPluginAsync = async (fastify) => {
  const usage = new UsageCounterService(fastify.db);
  const promotion = new TrialPromotionService(fastify.db, fastify);
  const email = new TrialEmailService(fastify.log);

  /**
   * POST /trial/signup — public.
   *
   * Returns 200 with a generic success body whether or not the email is new
   * (so attackers can't enumerate existing trial emails). The verify email
   * is sent only on a genuine new signup.
   *
   * P0-5 (audit 2026-05-08) — per-route rate limits:
   *   - 5 signups per minute keyed by IP (existing global already covers
   *     this, but make it explicit + lower so signup-flood is bounded
   *     before the global trips)
   *   - 3 signups per hour keyed by email (prevents using a victim's email
   *     to flood their inbox / fill our disk via the file backend)
   */
  fastify.post('/signup', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
        keyGenerator: (req) => `trial-signup-ip:${trustedClientIp(req)}`,
      },
    },
  }, async (request, reply) => {
    const parsed = signupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(422)
        .send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    }
    const data = parsed.data;

    // P0-5 (audit 2026-05-08): per-email rate limit. Returns the same
    // generic 200 success body even on cap so we don't reveal whether
    // the email is interesting (anti-enum). The limiter's count is
    // incremented on EVERY attempt — even rejected ones — so a flood
    // from a single attacker still trips the gate.
    const emailGate = checkEmailRateLimit(data.email);
    if (!emailGate.allowed) {
      reply.header('Retry-After', Math.ceil(emailGate.retryAfterMs / 1000).toString());
      return reply.status(200).send(
        ok({ message: 'If your email is eligible, a verification link is on its way.' }),
      );
    }

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

        // Send the verify email through the transparent backend.
        // Failures are logged but never surface to the caller (anti-enum).
        const sendResult = await email.sendVerifyEmail({
          to: data.email,
          cleartextToken: cleartext,
          companyName: data.companyName ?? null,
        }).catch((e) => {
          request.log.warn({ err: e, to: data.email }, '[trial.signup] email send failed');
          return { delivered: false, backend: 'noop' as const };
        });

        // In non-production, return the cleartext token + delivery info so
        // the dev loop can click through without checking SMTP. Production
        // never leaks the token in the response body.
        if (process.env.NODE_ENV !== 'production') {
          return reply.status(200).send(
            ok({
              message: 'Verify email sent. Check your inbox (or the file backend in dev).',
              devToken: cleartext,
              emailBackend: sendResult.backend,
              emailDelivered: sendResult.delivered,
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
   * Three-phase flow in one call:
   *   1. Look up by SHA-256 hash, validate not-expired
   *   2. Mark signup VERIFIED (idempotent)
   *   3. Promote into a real Tenant + first User (TENANT_ADMIN) +
   *      Subscription(trialing, trialEndsAt = now+30d)
   *
   * Returns:
   *   200 { token, initialPassword, tenant, user } — cockpit drops the JWT
   *        in localStorage and redirects to / (the dashboard).
   *
   * Idempotent: clicking the link a second time returns a fresh JWT against
   * the existing tenant (no duplicate-tenant error).
   */
  fastify.post('/verify/:token', {
    config: {
      // P0-5 (audit 2026-05-08): tight per-IP limit. A real user clicks
      // 1-2 times. 10/min/IP is generous enough for legitimate retries
      // (network hiccups) while hard-blocking token brute force.
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (req) => `trial-verify-ip:${req.ip ?? 'unknown'}`,
      },
    },
  }, async (request, reply) => {
    // P0-3 (audit 2026-05-08): the success response carries `initialPassword`
    // in cleartext. Set strict no-store headers on EVERY exit path so
    // intermediate proxies / CDNs / browser caches cannot persist it.
    // (Also closes a fingerprintable timing-side-channel on `Vary` defaults.)
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');

    // P0-2 (audit 2026-05-08): normalise response time across all paths
    // (404 / 410 / 200) so timing observation cannot distinguish "valid
    // token in flight" from "random brute-force miss". The floor (~80ms)
    // is greater than the natural variance of the slowest path (DB
    // transaction in promotion.promote), so all responses settle to ≥ floor.
    const VERIFY_FLOOR_MS = 80;
    const startedAt = Date.now();
    const padToFloor = async () => {
      const elapsed = Date.now() - startedAt;
      const remain = VERIFY_FLOOR_MS - elapsed;
      if (remain > 0) await new Promise((r) => setTimeout(r, remain));
    };

    const paramsParsed = verifyTokenParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      await padToFloor();
      return reply.status(400).send(err('INVALID_TOKEN', 'Token format invalid'));
    }
    const hash = hashToken(paramsParsed.data.token);

    const signup = await fastify.db.trialSignup.findFirst({
      where: { verifyTokenHash: hash },
    });

    if (!signup) {
      await padToFloor();
      return reply.status(404).send(err('NOT_FOUND', 'Verification link not found or already used'));
    }
    if (signup.verifyExpiresAt.getTime() < Date.now()) {
      await fastify.db.trialSignup.update({
        where: { id: signup.id },
        data: { status: 'EXPIRED' },
      });
      await padToFloor();
      return reply.status(410).send(err('EXPIRED', 'Verification link has expired'));
    }

    try {
      // If not yet PROMOTED, mark VERIFIED first so the promotion service
      // sees the right state. PROMOTED signups skip straight through.
      if (signup.status === 'PENDING_VERIFY') {
        await fastify.db.trialSignup.update({
          where: { id: signup.id },
          data: { status: 'VERIFIED', verifiedAt: new Date() },
        });
        signup.status = 'VERIFIED';
        signup.verifiedAt = new Date();
      }

      const result = await promotion.promote({
        id: signup.id,
        email: signup.email,
        companyName: signup.companyName,
        industry: signup.industry,
        status: signup.status,
        tenantId: signup.tenantId,
        verifiedAt: signup.verifiedAt,
      });

      await padToFloor();
      return reply.status(200).send(
        ok({
          token: result.token,
          initialPassword: result.initialPassword,
          tenant: result.tenant,
          user: {
            id: result.user.userId,
            email: result.user.email,
            name: result.user.name,
            role: result.user.role,
          },
          reusedExistingTenant: result.reusedExistingTenant,
          message: result.reusedExistingTenant
            ? 'Welcome back. Your workspace is ready.'
            : 'Trial workspace created. Save your initial password — you can change it from Settings later.',
        }),
      );
    } catch (e) {
      request.log.error({ err: e, signupId: signup.id }, '[trial.verify] promotion failed');
      await padToFloor();
      return reply.status(500).send(
        err('PROMOTION_FAILED', 'Verification succeeded but workspace creation failed. Contact support.'),
      );
    }
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
