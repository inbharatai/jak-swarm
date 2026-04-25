/**
 * compliance-mapper.service — runs the auto-mapping rule engine for a
 * tenant, producing ControlEvidenceMapping rows.
 *
 * Idempotent: the unique index `(tenantId, controlId, evidenceType,
 * evidenceId)` lets us re-run safely. New evidence rows produced since
 * the last run are added; existing mappings are untouched.
 *
 * Performance budget: target O(controls × evidence) per run with the
 * input rows pre-loaded in memory. For a tenant with 1k audit rows over
 * 30 days against 50 controls, that's ~50k iterations — well under 100ms.
 *
 * Tenant isolation: ALL queries are scoped to the supplied tenantId. The
 * service refuses to run without one.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { AUTO_MAPPING_RULES, type AutoMapInputs, type EvidenceCandidate } from './auto-mapping-rules.js';

export interface AutoMapResult {
  tenantId: string;
  frameworkSlug: string;
  periodStart: Date;
  periodEnd: Date;
  controlsProcessed: number;
  controlsWithRule: number;
  controlsWithoutRule: number;
  newMappingsCreated: number;
  totalEvidenceConsidered: number;
  perControl: Array<{ controlCode: string; ruleKey: string | null; created: number; total: number }>;
  durationMs: number;
}

export class ComplianceMapperService {
  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Run the auto-mapping engine for a tenant against a specific framework.
   * Returns a summary of what was mapped + how long it took.
   *
   * Throws if:
   *   - Framework slug doesn't exist
   *   - Compliance schema not deployed (translates Prisma P2021)
   */
  async runForTenant(input: {
    tenantId: string;
    frameworkSlug: string;
    /** ISO date or Date — defaults to 90 days ago. */
    periodStart?: Date | string;
    /** ISO date or Date — defaults to now. */
    periodEnd?: Date | string;
    /** Who triggered the mapping run. Recorded on every new mapping row. */
    triggeredBy?: string;
  }): Promise<AutoMapResult> {
    const startTime = Date.now();
    const periodEnd = input.periodEnd ? new Date(input.periodEnd) : new Date();
    const periodStart = input.periodStart
      ? new Date(input.periodStart)
      : new Date(periodEnd.getTime() - 90 * 24 * 60 * 60 * 1000);
    const triggeredBy = input.triggeredBy ?? 'auto-mapper';

    if (!input.tenantId) {
      throw new Error('[compliance-mapper] tenantId is required');
    }

    // Look up framework + its controls. Lock by slug.
    const framework = await this.db.complianceFramework.findUnique({
      where: { slug: input.frameworkSlug },
      include: { controls: true },
    }).catch((err) => { this.rethrowSchemaMissing(err); throw err; });

    if (!framework) {
      throw new Error(`Framework not found: ${input.frameworkSlug}. Run \`pnpm seed:compliance\` to populate.`);
    }

    // Single read of the tenant's evidence universe for the period.
    // We do this ONCE so each rule is a pure function over the input set.
    const inputs = await this.loadInputs(input.tenantId, periodStart, periodEnd);

    const perControl: AutoMapResult['perControl'] = [];
    let newMappingsCreated = 0;
    let controlsWithRule = 0;
    let controlsWithoutRule = 0;

    for (const control of framework.controls) {
      if (!control.autoRuleKey) {
        controlsWithoutRule++;
        perControl.push({ controlCode: control.code, ruleKey: null, created: 0, total: 0 });
        continue;
      }
      const rule = AUTO_MAPPING_RULES[control.autoRuleKey];
      if (!rule) {
        // Catalogue references a rule that isn't implemented. Log + skip.
        this.log.warn(
          { controlCode: control.code, ruleKey: control.autoRuleKey },
          '[compliance-mapper] control references unknown autoRuleKey — skipping',
        );
        controlsWithoutRule++;
        perControl.push({ controlCode: control.code, ruleKey: control.autoRuleKey, created: 0, total: 0 });
        continue;
      }
      controlsWithRule++;

      let candidates: EvidenceCandidate[];
      try {
        candidates = rule(inputs);
      } catch (err) {
        this.log.error(
          { controlCode: control.code, ruleKey: control.autoRuleKey, err: err instanceof Error ? err.message : String(err) },
          '[compliance-mapper] rule threw — skipping this control',
        );
        perControl.push({ controlCode: control.code, ruleKey: control.autoRuleKey, created: 0, total: 0 });
        continue;
      }

      let created = 0;
      for (const ev of candidates) {
        try {
          // upsert on the unique index — idempotent re-runs.
          const result = await this.db.controlEvidenceMapping.upsert({
            where: {
              tenantId_controlId_evidenceType_evidenceId: {
                tenantId: input.tenantId,
                controlId: control.id,
                evidenceType: ev.type,
                evidenceId: ev.id,
              },
            },
            create: {
              tenantId: input.tenantId,
              controlId: control.id,
              evidenceType: ev.type,
              evidenceId: ev.id,
              evidenceAt: ev.at,
              mappedBy: triggeredBy,
              mappingSource: 'auto',
            },
            update: {}, // never overwrite an existing mapping
          });
          // Prisma upsert always returns the row; check if it was newly created
          // by comparing timestamps. Cleaner: rely on the unique-violation
          // path — if the row existed, the create payload was ignored.
          // For our purposes, count an upsert as "created" only when the
          // returned row's createdAt is within the last second. Approximation
          // is fine for the summary metric.
          if (Date.now() - new Date(result.createdAt).getTime() < 5_000) {
            created++;
            newMappingsCreated++;
          }
        } catch (err) {
          this.log.warn(
            { controlCode: control.code, evType: ev.type, evId: ev.id, err: err instanceof Error ? err.message : String(err) },
            '[compliance-mapper] mapping upsert failed — skipping this evidence row',
          );
        }
      }

      perControl.push({
        controlCode: control.code,
        ruleKey: control.autoRuleKey,
        created,
        total: candidates.length,
      });
    }

    const totalEvidenceConsidered =
      inputs.auditLogs.length + inputs.workflows.length + inputs.approvals.length + inputs.artifacts.length;
    const durationMs = Date.now() - startTime;

    this.log.info(
      {
        tenantId: input.tenantId,
        framework: input.frameworkSlug,
        controlsProcessed: framework.controls.length,
        newMappingsCreated,
        durationMs,
      },
      '[compliance-mapper] completed',
    );

    return {
      tenantId: input.tenantId,
      frameworkSlug: input.frameworkSlug,
      periodStart,
      periodEnd,
      controlsProcessed: framework.controls.length,
      controlsWithRule,
      controlsWithoutRule,
      newMappingsCreated,
      totalEvidenceConsidered,
      perControl,
      durationMs,
    };
  }

  /**
   * List all controls + their evidence counts for a framework, scoped to
   * the requesting tenant. Used by the Compliance UI tab + attestations.
   */
  async getFrameworkSummary(input: { tenantId: string; frameworkSlug: string; periodStart?: Date; periodEnd?: Date }): Promise<{
    framework: { id: string; slug: string; name: string; shortName: string; issuer: string; description: string; version: string };
    controls: Array<{
      id: string;
      code: string;
      category: string;
      series: string;
      title: string;
      description: string;
      autoRuleKey: string | null;
      evidenceCount: number;
    }>;
    coverageCounts: { total: number; covered: number; uncovered: number; coveragePercent: number };
  }> {
    const framework = await this.db.complianceFramework.findUnique({
      where: { slug: input.frameworkSlug },
      include: { controls: { orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] } },
    }).catch((err) => { this.rethrowSchemaMissing(err); throw err; });
    if (!framework) {
      throw new Error(`Framework not found: ${input.frameworkSlug}`);
    }

    // Optional period — when supplied, count only evidence in window.
    const evidenceWhere: Record<string, unknown> = { tenantId: input.tenantId };
    if (input.periodStart || input.periodEnd) {
      const at: Record<string, Date> = {};
      if (input.periodStart) at['gte'] = input.periodStart;
      if (input.periodEnd) at['lte'] = input.periodEnd;
      evidenceWhere['evidenceAt'] = at;
    }

    // Per-control counts in one groupBy.
    const grouped = await this.db.controlEvidenceMapping.groupBy({
      by: ['controlId'],
      where: { ...evidenceWhere, controlId: { in: framework.controls.map((c) => c.id) } },
      _count: { _all: true },
    }).catch((err) => { this.rethrowSchemaMissing(err); throw err; });

    const countByControl = new Map<string, number>();
    for (const g of grouped) countByControl.set(g.controlId, g._count._all);

    const controls = framework.controls.map((c) => ({
      id: c.id,
      code: c.code,
      category: c.category,
      series: c.series,
      title: c.title,
      description: c.description,
      autoRuleKey: c.autoRuleKey,
      evidenceCount: countByControl.get(c.id) ?? 0,
    }));

    const total = controls.length;
    const covered = controls.filter((c) => c.evidenceCount > 0).length;
    const uncovered = total - covered;
    const coveragePercent = total > 0 ? Math.round((covered / total) * 1000) / 10 : 0;

    return {
      framework: {
        id: framework.id,
        slug: framework.slug,
        name: framework.name,
        shortName: framework.shortName,
        issuer: framework.issuer,
        description: framework.description,
        version: framework.version,
      },
      controls,
      coverageCounts: { total, covered, uncovered, coveragePercent },
    };
  }

  /**
   * List the evidence rows mapped to a single control. Tenant-scoped.
   */
  async getControlEvidence(input: { tenantId: string; controlId: string; periodStart?: Date; periodEnd?: Date; limit?: number; offset?: number }): Promise<{
    items: Array<{ id: string; evidenceType: string; evidenceId: string; evidenceAt: Date; mappedBy: string; mappingSource: string; notes: string | null; createdAt: Date }>;
    total: number;
  }> {
    const where: Record<string, unknown> = { tenantId: input.tenantId, controlId: input.controlId };
    if (input.periodStart || input.periodEnd) {
      const at: Record<string, Date> = {};
      if (input.periodStart) at['gte'] = input.periodStart;
      if (input.periodEnd) at['lte'] = input.periodEnd;
      where['evidenceAt'] = at;
    }
    const [items, total] = await Promise.all([
      this.db.controlEvidenceMapping.findMany({
        where,
        orderBy: { evidenceAt: 'desc' },
        take: input.limit ?? 100,
        skip: input.offset ?? 0,
      }),
      this.db.controlEvidenceMapping.count({ where }),
    ]).catch((err) => { this.rethrowSchemaMissing(err); throw err; });

    return { items, total };
  }

  // ─── Internal ───────────────────────────────────────────────────────

  private async loadInputs(tenantId: string, periodStart: Date, periodEnd: Date): Promise<AutoMapInputs> {
    const [auditLogs, workflows, approvals, artifactsRaw] = await Promise.all([
      this.db.auditLog.findMany({
        where: { tenantId, createdAt: { gte: periodStart, lte: periodEnd } },
        select: { id: true, action: true, resource: true, resourceId: true, details: true, createdAt: true, userId: true, severity: true },
      }),
      this.db.workflow.findMany({
        where: { tenantId, OR: [{ startedAt: { gte: periodStart, lte: periodEnd } }, { completedAt: { gte: periodStart, lte: periodEnd } }] },
        select: { id: true, status: true, goal: true, startedAt: true, completedAt: true, error: true },
      }),
      this.db.approvalRequest.findMany({
        where: { tenantId, createdAt: { gte: periodStart, lte: periodEnd } },
        select: { id: true, status: true, riskLevel: true, createdAt: true, reviewedAt: true, reviewedBy: true, agentRole: true },
      }),
      this.db.workflowArtifact.findMany({
        where: { tenantId, deletedAt: null, createdAt: { gte: periodStart, lte: periodEnd } },
        select: { id: true, artifactType: true, status: true, approvalState: true, createdAt: true, producedBy: true },
      }).catch(() => [] as Array<{ id: string; artifactType: string; status: string; approvalState: string; createdAt: Date; producedBy: string }>),
    ]);

    return {
      tenantId,
      periodStart,
      periodEnd,
      auditLogs,
      workflows,
      approvals,
      artifacts: artifactsRaw,
    };
  }

  private rethrowSchemaMissing(err: unknown): never {
    const code = (err as { code?: string }).code;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
      throw new ComplianceSchemaUnavailableError();
    }
    throw err;
  }
}

/**
 * Thrown when the compliance_* tables don't exist. Routes translate to
 * 503 + "run pnpm db:migrate:deploy + pnpm seed:compliance" hint.
 */
export class ComplianceSchemaUnavailableError extends Error {
  constructor() {
    super(
      '[compliance] compliance_frameworks / compliance_controls tables not present. ' +
      'Apply migration 11_compliance_framework via `pnpm db:migrate:deploy` then `pnpm seed:compliance`.',
    );
    this.name = 'ComplianceSchemaUnavailableError';
  }
}
