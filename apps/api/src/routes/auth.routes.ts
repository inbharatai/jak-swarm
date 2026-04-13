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
   */
  fastify.get(
    '/me',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = await authService.getUserById(request.user.userId);
        return reply.status(200).send(ok(user));
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
