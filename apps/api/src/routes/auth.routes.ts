import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../services/auth.service.js';
import { ok, err } from '../types.js';
import { AppError } from '../errors.js';

const registerBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(120),
  tenantName: z.string().min(1, 'Tenant name is required').max(120),
  tenantSlug: z
    .string()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
});

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
  tenantSlug: z.string().optional(),
});

// A.1 — accepts a Supabase access token and returns a JAK JWT. Used by
// non-web clients that authenticate via Supabase but want to call the
// JAK API with a JAK JWT (so jwtVerify() succeeds on the first try and
// no per-request Supabase round-trip is incurred). The web instead uses
// GET /auth/me, which mints the JAK JWT idempotently when the inbound
// token is a Supabase token.
const exchangeBodySchema = z.object({
  supabaseToken: z.string().min(1, 'supabaseToken is required'),
});

// Strict rate-limit config applied to authentication endpoints.
// 10 attempts per minute per IP to block brute-force attacks while
// keeping the door open for rapid testing in development.
const AUTH_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute',
      errorResponseBuilder: () => ({
        success: false,
        error: {
          code: 'AUTH_RATE_LIMIT',
          message: 'Too many authentication attempts. Please wait 1 minute and try again.',
        },
      }),
    },
  },
};

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService(fastify.db, fastify);

  /**
   * POST /auth/register
   * Create a new tenant and admin user, returns a signed JWT.
   */
  fastify.post(
    '/register',
    AUTH_RATE_LIMIT,
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const parseResult = registerBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(
          err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()),
        );
      }

      const { email, password, name, tenantName, tenantSlug } = parseResult.data;

      try {
        const result = await authService.register(email, password, name, tenantName, tenantSlug);

        // Create free subscription for the new tenant
        try {
          const { CreditService } = await import('../billing/credit-service.js');
          const creditService = new CreditService(fastify.db);
          await creditService.createFreeSubscription(result.user.tenantId);
        } catch (subErr) {
          fastify.log.warn({ tenantId: result.user.tenantId, err: subErr }, '[auth] Failed to create free subscription');
        }

        return reply.status(201).send(ok(result));
      } catch (e) {
        if (e instanceof AppError) {
          return reply.status(e.statusCode).send(err(e.code, e.message, e.details));
        }
        throw e;
      }
    },
  );

  /**
   * POST /auth/login
   * Authenticate with email + password, returns a signed JWT.
   */
  fastify.post(
    '/login',
    AUTH_RATE_LIMIT,
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const parseResult = loginBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(
          err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()),
        );
      }

      const { email, password, tenantSlug } = parseResult.data;

      try {
        const result = await authService.login(email, password, tenantSlug);
        return reply.status(200).send(ok(result));
      } catch (e) {
        if (e instanceof AppError) {
          return reply.status(e.statusCode).send(err(e.code, e.message));
        }
        throw e;
      }
    },
  );

  /**
   * POST /auth/logout
   * Stateless JWT approach — client should discard the token.
   * For a stateful approach, add the JTI to a Redis blocklist here.
   */
  fastify.post(
    '/logout',
    {
      preHandler: [fastify.authenticate],
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send(ok({ message: 'Logged out successfully' }));
    },
  );

  /**
   * GET /auth/me
   * Returns the currently authenticated user's profile.
   *
   * A.1 (perf): when the request was resolved via the Supabase fallback
   * (request.authViaSupabase === true — the stored token is a Supabase
   * access token, not a JAK JWT), mint a JAK JWT and return it alongside
   * the profile as `jakToken`. The web stores it and uses it for all
   * subsequent API + SSE calls so jwtVerify() succeeds on the first try,
   * eliminating the per-request Supabase round-trip. Idempotent: when
   * the request was authenticated via a JAK JWT we do NOT re-mint (the
   * stored token is already a JAK JWT), so the response envelope is the
   * plain `{ success, data }` and `jakToken` is omitted.
   */
  fastify.get(
    '/me',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = await authService.getUserById(request.user.userId);
        if (request.authViaSupabase === true) {
          const jakToken = authService.signToken(user);
          return reply.status(200).send({ ...ok(user), jakToken });
        }
        return reply.status(200).send(ok(user));
      } catch (e) {
        if (e instanceof AppError) {
          return reply.status(e.statusCode).send(err(e.code, e.message));
        }
        throw e;
      }
    },
  );

  /**
   * POST /auth/exchange
   * Exchange a Supabase access token for a JAK JWT. Same resolution path
   * as the Supabase fallback in auth.plugin.ts (authenticateSupabaseToken,
   * with the 60s in-process identity cache), then mints a JAK JWT. For
   * non-web clients; the web uses GET /auth/me instead.
   */
  fastify.post(
    '/exchange',
    AUTH_RATE_LIMIT,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = exchangeBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(
          err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()),
        );
      }
      try {
        const user = await authService.authenticateSupabaseToken(parseResult.data.supabaseToken);
        const jakToken = authService.signToken(user);
        return reply.status(200).send({ ...ok(user), jakToken });
      } catch (e) {
        if (e instanceof AppError) {
          return reply.status(e.statusCode).send(err(e.code, e.message));
        }
        throw e;
      }
    },
  );
};

export default authRoutes;
