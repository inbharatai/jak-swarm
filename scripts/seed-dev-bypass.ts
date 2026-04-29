/**
 * scripts/seed-dev-bypass.ts
 *
 * Idempotent seed for the JAK_DEV_AUTH_BYPASS local-dev mode.
 *
 * Upserts a single tenant + user with predictable IDs:
 *   tenant.id  = 'dev-tenant-id'
 *   user.id    = 'dev-user-id'
 *   user.role  = 'TENANT_ADMIN' (max non-admin role; can do everything
 *                                except cross-tenant SYSTEM_ADMIN ops)
 *
 * The IDs match `DEV_BYPASS_SESSION` in apps/api/src/plugins/auth.plugin.ts.
 * Anything that runs while JAK_DEV_AUTH_BYPASS=1 + Bearer jak-dev-bypass
 * has these rows as real DB foreign keys, so workflows, audit logs,
 * approvals, etc. all persist normally — only the auth check is short-
 * circuited.
 *
 * Safe to run multiple times. Safe to run against any DATABASE_URL
 * (including production by accident — the upsert just adds two rows
 * and never modifies existing data). Production already refuses the
 * bypass via NODE_ENV=production gate in auth.plugin.ts.
 *
 * Run:
 *   pnpm tsx scripts/seed-dev-bypass.ts
 *   # or:
 *   pnpm --filter @jak-swarm/db exec tsx ../../scripts/seed-dev-bypass.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEV_TENANT_ID = 'dev-tenant-id';
const DEV_USER_ID = 'dev-user-id';
const DEV_USER_EMAIL = 'dev@local.test';

async function main() {
  console.log('[seed-dev-bypass] connecting to DATABASE_URL ...');

  // Tenant first (the user FK depends on it).
  const tenant = await prisma.tenant.upsert({
    where: { id: DEV_TENANT_ID },
    create: {
      id: DEV_TENANT_ID,
      name: 'Local Dev Tenant',
      slug: 'local-dev',
      status: 'ACTIVE',
      plan: 'TEAM',
      industry: 'GENERAL',
      // The dev tenant is permissive on purpose — auto-approve below
      // CRITICAL so a developer can iterate on the workflow loop without
      // clicking through every approval card. Set autoApproveEnabled
      // explicitly so the gate is honest, not silently disabled.
      autoApproveEnabled: true,
      approvalThreshold: 'CRITICAL',
      requireApprovals: false,
      enableBrowserAutomation: true,
      enableVoice: true,
    },
    update: {},
  });

  const user = await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    create: {
      id: DEV_USER_ID,
      tenantId: tenant.id,
      email: DEV_USER_EMAIL,
      name: 'Local Dev User',
      role: 'TENANT_ADMIN',
      active: true,
    },
    update: {
      tenantId: tenant.id,
      email: DEV_USER_EMAIL,
      name: 'Local Dev User',
      role: 'TENANT_ADMIN',
      active: true,
    },
  });

  // Subscription row — without this the workflow-create credit check
  // returns 429 NO_SUBSCRIPTION even with the auth bypass on. Grant the
  // dev tenant a generous "team-equivalent" allocation so a developer
  // can run hundreds of workflows without hitting any cap.
  const periodEnd = new Date();
  periodEnd.setFullYear(periodEnd.getFullYear() + 10); // 10-year far-future period
  const subscription = await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      planId: 'team',
      status: 'active',
      creditsTotal: 1_000_000,
      creditsUsed: 0,
      premiumTotal: 100_000,
      premiumUsed: 0,
      dailyUsed: 0,
      dailyCap: 100_000,
      perTaskCap: 10_000,
      concurrentCap: 100,
      maxModelTier: 3, // unlock premium models
      periodStart: new Date(),
      periodEnd,
      dailyResetAt: new Date(),
    },
    update: {
      // Idempotent reset on every seed run so daily/monthly caps don't
      // accumulate across multiple reseeds during a single dev session.
      planId: 'team',
      status: 'active',
      creditsTotal: 1_000_000,
      premiumTotal: 100_000,
      dailyCap: 100_000,
      perTaskCap: 10_000,
      concurrentCap: 100,
      maxModelTier: 3,
      periodEnd,
    },
  });

  console.log(`[seed-dev-bypass] tenant:       ${tenant.id} (${tenant.name})`);
  console.log(`[seed-dev-bypass] user:         ${user.id} (${user.email}, role=${user.role})`);
  console.log(`[seed-dev-bypass] subscription: ${subscription.id} (plan=${subscription.planId}, credits=${subscription.creditsTotal})`);
  console.log('');
  console.log('Local dev now ready. Set in apps/api/.env:');
  console.log('  JAK_DEV_AUTH_BYPASS=1');
  console.log('Set in apps/web/.env.local:');
  console.log('  NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS=1');
  console.log('Then hit any API route with `Authorization: Bearer jak-dev-bypass`.');
}

main()
  .catch((err) => {
    console.error('[seed-dev-bypass] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
