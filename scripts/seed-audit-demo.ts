/**
 * scripts/seed-audit-demo.ts
 *
 * Operator helper — produces enough activity in the database for the
 * Audit & Compliance UI to render meaningfully on first launch.
 *
 * What it creates (idempotent — safe to re-run):
 *   - 1 demo workflow (COMPLETED) per existing tenant, if none exist yet
 *   - 1 pending APPROVAL request (HIGH risk) on each
 *   - 1 PII_DETECTED audit log row (so privacy controls show evidence)
 *   - 1 GUARDRAIL_TRIGGERED audit log row (so risk controls show evidence)
 *   - 1 final-marked WorkflowArtifact (REQUIRES_APPROVAL state) — only
 *     if the workflow_artifacts table exists
 *
 * Then it triggers the auto-mapper for SOC 2 so the Compliance UI tab
 * has populated coverage right away.
 *
 * Run:
 *   pnpm seed:audit-demo
 *
 * Requires:
 *   - DATABASE_URL set
 *   - migrations 10_workflow_artifacts + 11_compliance_framework deployed
 *   - At least one tenant + user already exist (rerun `pnpm db:seed` if not)
 *   - `pnpm seed:compliance` already run (otherwise auto-map step is skipped)
 *
 * Pure dev / staging tool — never run against production.
 */

import { PrismaClient } from '@prisma/client';
// AuditAction enum is provided by @jak-swarm/security; import via a relative
// path to keep this script free of workspace-only imports at deploy time.
const ACTIONS = {
  PII_DETECTED: 'PII_DETECTED',
  GUARDRAIL_TRIGGERED: 'GUARDRAIL_TRIGGERED',
  WORKFLOW_STARTED: 'WORKFLOW_STARTED',
  WORKFLOW_COMPLETED: 'WORKFLOW_COMPLETED',
  WORKFLOW_STEP_COMPLETED: 'WORKFLOW_STEP_COMPLETED',
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
} as const;

interface DemoOptions {
  /** When true, skip the auto-mapper step — useful in CI smoke tests. */
  skipAutoMap?: boolean;
}

async function seedDemo(prisma: PrismaClient, opts: DemoOptions = {}): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true },
    take: 5,
  });
  if (tenants.length === 0) {
    // eslint-disable-next-line no-console
    console.error('No tenants found. Run `pnpm db:seed` first to provision demo tenants.');
    process.exit(2);
  }

  for (const tenant of tenants) {
    // eslint-disable-next-line no-console
    console.log(`\n→ Tenant: ${tenant.name} (${tenant.slug})`);

    // Find any existing OPERATOR user for the tenant — required by Workflow.userId FK.
    const user = await prisma.user.findFirst({
      where: { tenantId: tenant.id },
      select: { id: true, email: true },
    });
    if (!user) {
      // eslint-disable-next-line no-console
      console.log(`  skipped: no user in tenant ${tenant.id}`);
      continue;
    }

    // 1. Demo workflow (idempotent by goal + recent createdAt window)
    const demoGoal = '[demo] write a LinkedIn launch post';
    let workflow = await prisma.workflow.findFirst({
      where: { tenantId: tenant.id, goal: demoGoal, status: 'COMPLETED' },
      select: { id: true },
    });
    if (!workflow) {
      workflow = await prisma.workflow.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          goal: demoGoal,
          industry: 'TECHNOLOGY',
          status: 'COMPLETED',
          finalOutput: 'JAK Swarm — your enterprise multi-agent platform. Three capabilities. One CTA.',
          totalCostUsd: 0.0123,
          startedAt: new Date(Date.now() - 60_000),
          completedAt: new Date(),
        },
        select: { id: true },
      });
      // eslint-disable-next-line no-console
      console.log(`  ✓ created demo workflow ${workflow.id}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`  ✓ reusing demo workflow ${workflow.id}`);
    }

    // 2. Audit log rows that exercise the auto-mapping rules
    const auditEntries = [
      { action: ACTIONS.WORKFLOW_STARTED, resource: 'workflow', resourceId: workflow.id, severity: 'INFO' },
      { action: ACTIONS.WORKFLOW_STEP_COMPLETED, resource: 'workflow', resourceId: workflow.id, severity: 'INFO' },
      { action: ACTIONS.WORKFLOW_COMPLETED, resource: 'workflow', resourceId: workflow.id, severity: 'INFO' },
      { action: ACTIONS.PII_DETECTED, resource: 'workflow', resourceId: workflow.id, severity: 'WARN' },
      { action: ACTIONS.GUARDRAIL_TRIGGERED, resource: 'workflow', resourceId: workflow.id, severity: 'WARN' },
    ];
    for (const entry of auditEntries) {
      // No unique key on AuditLog; rely on a "exists in last hour" check instead.
      const recent = await prisma.auditLog.findFirst({
        where: {
          tenantId: tenant.id,
          action: entry.action,
          resourceId: entry.resourceId,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (!recent) {
        await prisma.auditLog.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            action: entry.action,
            resource: entry.resource,
            resourceId: entry.resourceId,
            severity: entry.severity,
            details: { source: 'seed-audit-demo' },
          },
        });
      }
    }
    // eslint-disable-next-line no-console
    console.log(`  ✓ ensured ${auditEntries.length} audit log rows`);

    // 3. Pending HIGH-risk approval request (so reviewer queue isn't empty)
    const existingApproval = await prisma.approvalRequest.findFirst({
      where: { tenantId: tenant.id, workflowId: workflow.id, status: 'PENDING' },
      select: { id: true },
    });
    if (!existingApproval) {
      await prisma.approvalRequest.create({
        data: {
          tenantId: tenant.id,
          workflowId: workflow.id,
          taskId: 'demo-task-1',
          agentRole: 'WORKER_EMAIL',
          action: 'send_email',
          rationale: 'Demo: send launch announcement to mailing list (requires approval).',
          riskLevel: 'HIGH',
          status: 'PENDING',
          proposedDataJson: { recipients: 12, subject: 'JAK Swarm launch', preview: '...' },
        },
      });
      // eslint-disable-next-line no-console
      console.log(`  ✓ created pending HIGH approval`);
    }

    // 4. Demo artifact requiring approval — only if workflow_artifacts exists
    try {
      const existingArtifact = await prisma.workflowArtifact.findFirst({
        where: { tenantId: tenant.id, workflowId: workflow.id, artifactType: 'export' },
        select: { id: true },
      });
      if (!existingArtifact) {
        const inlineContent = '{\n  "demo": true,\n  "exportType": "audit_pack",\n  "generatedFor": "operator-demo"\n}\n';
        await prisma.workflowArtifact.create({
          data: {
            tenantId: tenant.id,
            workflowId: workflow.id,
            producedBy: user.id,
            artifactType: 'export',
            fileName: 'demo-audit-pack.json',
            mimeType: 'application/json',
            sizeBytes: Buffer.byteLength(inlineContent, 'utf8'),
            contentHash: 'demo-no-real-hash',
            inlineContent,
            status: 'READY',
            approvalState: 'REQUIRES_APPROVAL',
            metadata: { source: 'seed-audit-demo' },
          },
        });
        // eslint-disable-next-line no-console
        console.log(`  ✓ created REQUIRES_APPROVAL artifact`);
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'P2021') {
        // eslint-disable-next-line no-console
        console.log(`  · skipped artifact (workflow_artifacts table not present — run pnpm db:migrate:deploy)`);
      } else {
        throw err;
      }
    }

    // 5. Trigger the auto-mapper so Compliance tab is populated
    if (!opts.skipAutoMap) {
      try {
        const framework = await prisma.complianceFramework.findUnique({
          where: { slug: 'soc2-type2' },
          include: { controls: true },
        });
        if (!framework) {
          // eslint-disable-next-line no-console
          console.log(`  · skipped auto-map (run pnpm seed:compliance first)`);
        } else {
          // Run the mapping engine directly via a fresh import so we don't
          // need a running fastify instance. Service uses the same Prisma.
          const { ComplianceMapperService } = await import('../apps/api/src/services/compliance/compliance-mapper.service.js');
          const stubLog = {
            info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
            child: () => stubLog, level: 'info',
          };
          const svc = new ComplianceMapperService(prisma as never, stubLog as never);
          const result = await svc.runForTenant({
            tenantId: tenant.id,
            frameworkSlug: 'soc2-type2',
            triggeredBy: 'seed-audit-demo',
          });
          // eslint-disable-next-line no-console
          console.log(`  ✓ auto-mapped: ${result.newMappingsCreated} new mappings (${result.controlsWithRule} rules over ${result.totalEvidenceConsidered} rows)`);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(`  · auto-map failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('\nDone. Open /audit in the dashboard to see the seeded activity.');
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDemo(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed-audit-demo] failed:', err);
  process.exit(1);
});
