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

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService(fastify.db, fastify);

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
