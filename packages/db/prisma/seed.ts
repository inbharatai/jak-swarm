/**
 * Seed script — provisions demo data for local development and demos.
 *
 * Run with:
 *   pnpm --filter @jak-swarm/db db:seed
 *
 * Creates:
 *   - 5 industry tenants (healthcare, finance, recruiting, legal, retail)
 *   - 1 TENANT_ADMIN + 1 OPERATOR + 1 REVIEWER per tenant
 *   - 5 built-in skills (global)
 *   - Sample completed workflows + agent traces for the trace viewer
 *   - Sample pending approval requests for the approvals inbox
 *   - Sample tenant memory entries
 *
 * All user passwords default to: jak-demo-2024
 * All auth tokens are JWTs — use the /auth/login endpoint to obtain one.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Demo password (hashed at seeding time)
// ---------------------------------------------------------------------------
const DEMO_PASSWORD = 'jak-demo-2024';

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// ---------------------------------------------------------------------------
// Industry tenants
// ---------------------------------------------------------------------------
const TENANTS = [
  {
    name: 'Apex Health Network',
    slug: 'apex-health',
    industry: 'HEALTHCARE',
    approvalThreshold: 'MEDIUM',
  },
  {
    name: 'Meridian Capital',
    slug: 'meridian-capital',
    industry: 'FINANCE',
    approvalThreshold: 'HIGH',
  },
  {
    name: 'TalentFlow Recruiting',
    slug: 'talentflow',
    industry: 'RECRUITING',
    approvalThreshold: 'MEDIUM',
  },
  {
    name: 'Lexara Legal Services',
    slug: 'lexara-legal',
    industry: 'LEGAL',
    approvalThreshold: 'HIGH',
  },
  {
    name: 'Nexus Retail Group',
    slug: 'nexus-retail',
    industry: 'RETAIL',
    approvalThreshold: 'LOW',
  },
] as const;

// ---------------------------------------------------------------------------
// Built-in skills (global — tenantId null)
// ---------------------------------------------------------------------------
const BUILTIN_SKILLS = [
  {
    name: 'Document Summarizer',
    description: 'Condenses long documents to key bullet points using GPT-4o.',
    tier: 1,
    status: 'APPROVED',
    riskLevel: 'LOW',
    permissions: ['read:documents'],
  },
  {
    name: 'Email Composer',
    description: 'Drafts professional emails from a brief description and recipient context.',
    tier: 1,
    status: 'APPROVED',
    riskLevel: 'LOW',
    permissions: ['write:email'],
  },
  {
    name: 'Data Extraction',
    description: 'Extracts structured data (tables, KPIs, dates) from unstructured documents.',
    tier: 1,
    status: 'APPROVED',
    riskLevel: 'MEDIUM',
    permissions: ['read:documents', 'write:memory'],
  },
  {
    name: 'Competitor Research',
    description: 'Uses web search to compile a competitive landscape report.',
    tier: 1,
    status: 'APPROVED',
    riskLevel: 'LOW',
    permissions: ['use:web_search', 'write:documents'],
  },
  {
    name: 'Meeting Scheduler',
    description: 'Finds available slots and books calendar events on behalf of the user.',
    tier: 1,
    status: 'APPROVED',
    riskLevel: 'MEDIUM',
    permissions: ['read:calendar', 'write:calendar'],
  },
] as const;

// ---------------------------------------------------------------------------
// Sample workflow goals per industry
// ---------------------------------------------------------------------------
const SAMPLE_GOALS: Record<string, string[]> = {
  HEALTHCARE: [
    'Summarise the latest patient intake forms and flag missing fields',
    'Draft follow-up emails for all patients discharged this week',
    'Compile Q3 pharmacy cost report from billing data',
  ],
  FINANCE: [
    'Analyse portfolio exposure to interest rate risk and generate a summary',
    'Draft investor update for Q4 earnings call',
    'Extract KPIs from annual report and format as board-ready dashboard',
  ],
  RECRUITING: [
    'Screen the 12 software engineer applications and rank by match score',
    'Draft personalised rejection emails for shortlisted candidates',
    'Research top talent communities for ML engineers in London',
  ],
  LEGAL: [
    'Review the NDA draft for unusual clauses and flag high-risk provisions',
    'Summarise discovery documents for the Henderson v. Marquette case',
    'Draft GDPR-compliant data processing addendum for new vendor',
  ],
  RETAIL: [
    'Identify top 20 products by margin and draft a seasonal promotion plan',
    'Analyse customer support tickets and extract common complaints',
    'Generate weekly inventory restocking recommendations',
  ],
};

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------
async function seed() {
  console.info('🌱 Starting seed...');

  // ── 1. Global skills ───────────────────────────────────────────────────────
  console.info('  Creating global built-in skills...');
  for (const skill of BUILTIN_SKILLS) {
    await prisma.skill.upsert({
      where: { id: `skill_builtin_${skill.name.toLowerCase().replace(/\s+/g, '_')}` },
      update: {},
      create: {
        id: `skill_builtin_${skill.name.toLowerCase().replace(/\s+/g, '_')}`,
        tenantId: null,
        name: skill.name,
        description: skill.description,
        tier: skill.tier,
        status: skill.status,
        riskLevel: skill.riskLevel,
        permissions: skill.permissions as string[],
      },
    });
  }

  // ── 2. Tenants + Users ────────────────────────────────────────────────────
  const passwordHash = await hash(DEMO_PASSWORD);

  for (const tenantDef of TENANTS) {
    console.info(`  Seeding tenant: ${tenantDef.name} (${tenantDef.industry})`);

    const tenant = await prisma.tenant.upsert({
      where: { slug: tenantDef.slug },
      update: {},
      create: {
        name: tenantDef.name,
        slug: tenantDef.slug,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        industry: tenantDef.industry,
        approvalThreshold: tenantDef.approvalThreshold,
        requireApprovals: true,
        enableVoice: true,
        enableBrowserAutomation: false,
        maxConcurrentWorkflows: 10,
        logRetentionDays: 90,
      },
    });

    // Create 3 users per tenant
    const users = [
      {
        email: `admin@${tenantDef.slug}.demo`,
        name: `${tenantDef.name} Admin`,
        role: 'TENANT_ADMIN',
      },
      {
        email: `operator@${tenantDef.slug}.demo`,
        name: `${tenantDef.name} Operator`,
        role: 'OPERATOR',
      },
      {
        email: `reviewer@${tenantDef.slug}.demo`,
        name: `${tenantDef.name} Reviewer`,
        role: 'REVIEWER',
      },
    ];

    const createdUsers: Array<{ id: string; role: string }> = [];

    for (const u of users) {
      const user = await prisma.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
        update: {},
        create: {
          tenantId: tenant.id,
          email: u.email,
          name: u.name,
          passwordHash,
          role: u.role,
          active: true,
        },
      });
      createdUsers.push({ id: user.id, role: u.role });
    }

    const adminUser = createdUsers.find(u => u.role === 'TENANT_ADMIN')!;
    const operatorUser = createdUsers.find(u => u.role === 'OPERATOR')!;
    const reviewerUser = createdUsers.find(u => u.role === 'REVIEWER')!;

    // ── 3. Sample workflows ─────────────────────────────────────────────────
    const goals = SAMPLE_GOALS[tenantDef.industry] ?? [];

    for (let i = 0; i < goals.length; i++) {
      const goal = goals[i]!;
      const isCompleted = i < 2;
      const status = isCompleted ? 'COMPLETED' : 'PENDING';
      const startedAt = new Date(Date.now() - (i + 1) * 60 * 60 * 1000); // staggered
      const completedAt = isCompleted ? new Date(startedAt.getTime() + 3 * 60 * 1000) : null;

      const workflow = await prisma.workflow.create({
        data: {
          tenantId: tenant.id,
          userId: operatorUser.id,
          goal,
          industry: tenantDef.industry,
          status,
          startedAt,
          completedAt,
        },
      });

      // Add agent traces for completed workflows
      if (isCompleted) {
        const agents = ['COMMANDER', 'PLANNER', 'ROUTER', 'GUARDRAIL', 'WORKER_DOCUMENT', 'VERIFIER'];
        for (let step = 0; step < agents.length; step++) {
          const agentRole = agents[step]!;
          const traceStart = new Date(startedAt.getTime() + step * 25_000);
          await prisma.agentTrace.create({
            data: {
              traceId: `trc_seed_${workflow.id}_${step}`,
              runId: `run_seed_${workflow.id}`,
              workflowId: workflow.id,
              tenantId: tenant.id,
              agentRole,
              stepIndex: step,
              startedAt: traceStart,
              completedAt: new Date(traceStart.getTime() + 22_000),
              durationMs: 22_000,
              inputJson: { goal: step === 0 ? goal : `Step ${step} input` } as object,
              outputJson: { result: `${agentRole} completed successfully` } as object,
              tokenUsage: { promptTokens: 150 + step * 20, completionTokens: 80 + step * 10, totalTokens: 230 + step * 30 } as object,
            },
          });
        }
      }

      // Add pending approval for the last workflow
      if (i === goals.length - 1) {
        await prisma.approvalRequest.create({
          data: {
            workflowId: workflow.id,
            tenantId: tenant.id,
            taskId: `task_seed_${workflow.id}_0`,
            agentRole: 'WORKER_DOCUMENT',
            action: 'Send compiled report to distribution list (12 recipients)',
            rationale: 'This action will send data to external recipients outside the tenant. Requires approval per compliance policy.',
            riskLevel: 'HIGH',
            status: 'PENDING',
          },
        });
      }
    }

    // ── 4. Tenant memory ────────────────────────────────────────────────────
    const memoryEntries = [
      {
        key: 'company_overview',
        value: { summary: `${tenantDef.name} is a ${tenantDef.industry.toLowerCase()} company using JAK Swarm.` },
        memoryType: 'KNOWLEDGE',
        source: 'SYSTEM',
      },
      {
        key: 'approval_policy',
        value: { threshold: tenantDef.approvalThreshold, requiresHuman: true },
        memoryType: 'POLICY',
        source: 'ADMIN',
      },
    ];

    for (const entry of memoryEntries) {
      await prisma.tenantMemory.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: entry.key } },
        update: { value: entry.value },
        create: {
          tenantId: tenant.id,
          key: entry.key,
          value: entry.value,
          source: entry.source,
          memoryType: entry.memoryType,
        },
      });
    }

    // ── 5. Audit log entries ────────────────────────────────────────────────
    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: adminUser.id,
        action: 'TENANT_CREATED',
        resource: 'Tenant',
        resourceId: tenant.id,
        details: { via: 'seed' },
        ip: '127.0.0.1',
        userAgent: 'SeedScript/1.0',
      },
    });

    console.info(`    ✓ ${tenantDef.name}: ${createdUsers.length} users, ${goals.length} workflows`);
  }

  // ── 6. Summary ──────────────────────────────────────────────────────────
  const counts = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count(),
    prisma.workflow.count(),
    prisma.agentTrace.count(),
    prisma.approvalRequest.count(),
    prisma.skill.count(),
    prisma.tenantMemory.count(),
  ]);

  console.info('\n🎉 Seed complete!');
  console.info(`   Tenants:          ${counts[0]}`);
  console.info(`   Users:            ${counts[1]}`);
  console.info(`   Workflows:        ${counts[2]}`);
  console.info(`   Agent traces:     ${counts[3]}`);
  console.info(`   Approval reqs:    ${counts[4]}`);
  console.info(`   Skills:           ${counts[5]}`);
  console.info(`   Memory entries:   ${counts[6]}`);
  console.info('\n   Demo credentials (password: jak-demo-2024):');

  for (const t of TENANTS) {
    console.info(`   ${t.industry.padEnd(12)} admin@${t.slug}.demo`);
  }
  console.info('');
  console.info('   Login via: POST http://localhost:4000/auth/login');
  console.info('   Body: { "email": "admin@apex-health.demo", "password": "jak-demo-2024" }');
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
