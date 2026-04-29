import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthSession, UserRole } from '../types.js';
import { AuthService } from '../services/auth.service.js';
import { UnauthorizedError, ForbiddenError } from '../errors.js';

// Augment @fastify/jwt so that request.user is typed as AuthSession
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthSession;
    user: AuthSession;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: UserRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    auditLog: (
      request: FastifyRequest,
      action: string,
      resource: string,
      resourceId?: string,
      details?: Record<string, unknown>,
    ) => Promise<void>;
  }
}

/**
 * DEV-ONLY auth bypass.
 *
 * When ALL THREE conditions hold the `authenticate` middleware short-
 * circuits to a hardcoded local AuthSession, skipping the Supabase /
 * JWT round-trip entirely:
 *
 *   1. `NODE_ENV !== 'production'`           — never on in prod
 *   2. `JAK_DEV_AUTH_BYPASS === '1'`         — explicit env opt-in
 *   3. The Authorization header is exactly   — caller proves they
 *      `Bearer jak-dev-bypass`                 know the magic literal
 *
 * Each gate alone disables the bypass — even if NODE_ENV slips into
 * production, the caller still needs the literal token + the env flag.
 * Even if the env flag accidentally ships, prod NODE_ENV blocks it.
 *
 * The seeded dev user / tenant are upserted by
 * `scripts/seed-dev-bypass.ts` (idempotent). Use predictable IDs so
 * audit log + workflow rows have a real foreign key.
 */
const DEV_BYPASS_TOKEN = 'jak-dev-bypass';
const DEV_BYPASS_SESSION: AuthSession = {
  sub: 'dev-user-id',
  userId: 'dev-user-id',
  tenantId: 'dev-tenant-id',
  email: 'dev@local.test',
  name: 'Local Dev User',
  role: 'TENANT_ADMIN',
};

function devBypassActive(): boolean {
  return (
    process.env['NODE_ENV'] !== 'production' &&
    process.env['JAK_DEV_AUTH_BYPASS'] === '1'
  );
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService(fastify.db, fastify);

  if (devBypassActive()) {
    fastify.log.warn(
      'JAK_DEV_AUTH_BYPASS is ON — Authorization "Bearer jak-dev-bypass" will skip auth and inject the seeded dev user. NEVER set this in production.',
    );
  }

  /**
   * authenticate — verifies the Bearer JWT and populates request.user.
   * Throws 401 if the token is missing or invalid.
   */
  const authenticate = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';

    if (!token) {
      throw new UnauthorizedError('Missing authorization token');
    }

    // DEV-ONLY: bypass before any verification so a developer can run
    // the cockpit without standing up Supabase locally.
    if (devBypassActive() && token === DEV_BYPASS_TOKEN) {
      (request as FastifyRequest & { user: AuthSession }).user = DEV_BYPASS_SESSION;
      return;
    }

    try {
      // @fastify/jwt attaches jwtVerify to the request
      await request.jwtVerify<AuthSession>();
      return;
    } catch (localJwtError) {
      try {
        const session = await authService.authenticateSupabaseToken(token);
        (request as FastifyRequest & { user: AuthSession }).user = session;
        return;
      } catch (supabaseError) {
        throw new UnauthorizedError(
          supabaseError instanceof Error
            ? supabaseError.message
            : localJwtError instanceof Error
              ? localJwtError.message
              : 'Invalid or expired token',
        );
      }
    }
  };

  /**
   * requireRole — factory that returns a preHandler ensuring the authenticated
   * user has one of the specified roles.
   */
  const requireRole =
    (...roles: UserRole[]) =>
    async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      // authenticate must have already run, but guard just in case
      if (!request.user) {
        throw new UnauthorizedError();
      }
      if (!roles.includes(request.user.role)) {
        throw new ForbiddenError(
          `Role '${request.user.role}' is not allowed. Required: ${roles.join(', ')}`,
        );
      }
    };

  /**
   * auditLog — writes an audit log entry to the database.
   * Non-blocking: errors are logged but do not fail the request.
   */
  const auditLog = async (
    request: FastifyRequest,
    action: string,
    resource: string,
    resourceId?: string,
    details?: Record<string, unknown>,
  ): Promise<void> => {
    if (!request.user) return;

    try {
      await fastify.db.auditLog.create({
        data: {
          tenantId: request.user.tenantId,
          userId: request.user.userId,
          action,
          resource,
          resourceId: resourceId ?? null,
          details: details ? (details as object) : {},
          ip: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });
    } catch (err) {
      // Audit failures must never break the request flow
      request.log.error({ err }, 'Failed to write audit log');
    }
  };

  fastify.decorate('authenticate', authenticate);
  fastify.decorate('requireRole', requireRole);
  fastify.decorate('auditLog', auditLog);
};

export default fp(authPlugin, {
  name: 'auth-plugin',
  dependencies: ['db-plugin'],
});
