import type { FastifyRequest, FastifyReply } from 'fastify';
import { TenantIsolationError } from '../errors.js';

/**
 * enforceTenantIsolation — Fastify preHandler that ensures the authenticated
 * user can only access resources belonging to their own tenant.
 *
 * If the route has a `:tenantId` path parameter, the value is compared against
 * `request.user.tenantId`. SYSTEM_ADMIN users bypass this check.
 */
export async function enforceTenantIsolation(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const user = request.user;

  // User must already be authenticated before this middleware runs
  if (!user) {
    return; // Let the auth plugin surface the 401
  }

  // System admins can access any tenant
  if (user.role === 'SYSTEM_ADMIN') {
    return;
  }

  const params = request.params as Record<string, string | undefined>;
  const routeTenantId = params['tenantId'];

  if (routeTenantId !== undefined && (!routeTenantId || routeTenantId !== user.tenantId)) {
    throw new TenantIsolationError();
  }
}
