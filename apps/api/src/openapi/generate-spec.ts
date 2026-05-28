import { z } from 'zod';
import { registerSchema } from './schema-registry.js';

/**
 * Generate OpenAPI components from the application's Zod schemas.
 * Import the canonical Zod schemas from route files and register them
 * so fastify/swagger can expose fully-typed documentation.
 *
 * This is the single chokepoint: every new route-level Zod schema
 * that should appear in the OpenAPI spec must be imported here.
 */
export async function generateOpenAPISpec() {
  // ── Workflow schemas ──────────────────────────────────────────────────
  const workflows = await import('../routes/workflows.routes.js');
  registerSchema('CreateWorkflowRequest', workflows.createWorkflowBodySchema);
  registerSchema('ResumeWorkflowRequest', workflows.resumeWorkflowBodySchema);

  // ── Auth schemas ────────────────────────────────────────────────────
  try {
    const auth = await import('../routes/auth.routes.js');
    if ('loginBodySchema' in auth) registerSchema('LoginRequest', auth.loginBodySchema as z.ZodTypeAny);
    if ('registerBodySchema' in auth) registerSchema('RegisterRequest', auth.registerBodySchema as z.ZodTypeAny);
  } catch { /* auth routes may not export these */ }

  // ── Approval schemas ────────────────────────────────────────────────
  try {
    const approvals = await import('../routes/approvals.routes.js');
    if ('decisionBodySchema' in approvals) registerSchema('ApprovalDecisionRequest', approvals.decisionBodySchema as z.ZodTypeAny);
  } catch { /* approvals routes may not export these */ }

  // ── Tenant / Billing schemas ────────────────────────────────────────
  try {
    const tenants = await import('../routes/tenants.routes.js');
    if ('updateTenantBodySchema' in tenants) registerSchema('UpdateTenantRequest', tenants.updateTenantBodySchema as z.ZodTypeAny);
  } catch { /* tenant routes may not export these */ }
}
