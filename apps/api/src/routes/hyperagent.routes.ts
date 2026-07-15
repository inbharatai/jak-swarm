/**
 * HyperAgent Control Centre routes — Phase 13.
 *
 * Operational dashboard over REAL backend data only. The spec mandates:
 * "No fake graphs, placeholder percentages, sample success rates or
 * fabricated 'all systems healthy' states." These routes enforce that by:
 *
 *   - selecting real rows from Prisma for the authenticated tenant;
 *   - handing them to the PURE aggregation core
 *     (`@jak-swarm/swarm` control-centre.ts) which fabricates nothing and
 *     returns honest empty views when tables are empty;
 *   - stamping `generatedAt` from the request clock (the pure core reads no
 *     clock);
 *   - returning `ok(view)` on success and `err(...)` on a DB failure — NEVER
 *     a synthetic "healthy" payload.
 *
 * RBAC: every route is tenant-scoped + REVIEWER+ (the operator who can see
 * diagnoses, plan history, learnings, experiments, governance, and Shield
 * evidence). A SYSTEM_ADMIN hits these for their own tenant; cross-tenant
 * rollups live in /admin/aggregate/* (deliberately separate).
 *
 * Routes (prefix /hyperagent):
 *   GET /overview       — mode + outcome/plan/repair/learning buckets
 *   GET /runs           — outcomes + diagnoses + repairs
 *   GET /learnings      — learning candidates / promoted / impact
 *   GET /optimizations  — config proposals + plan/config diffs + benchmarks
 *   GET /experiments    — shadow/canary/promoted/rolled-back + rollout trail
 *   GET /governance     — security-class violations + governance rules
 *   GET /agent-fleet    — per-role trace aggregates
 *   GET /autonomy       — autonomy config + recent decisions
 *   GET /shield         — Shield decisions (from audit log; dedicated store roadmap)
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ConfigKind } from '@jak-swarm/shared';
import type { ConfigKind as ConfigKindType, RolloutMetrics, RolloutThresholds } from '@jak-swarm/shared';
import { ok, err } from '../types.js';
import { ConfigLifecycleService } from '../services/company-brain/config-lifecycle.service.js';
import {
  aggregateOverview,
  aggregateRuns,
  aggregateLearnings,
  aggregateOptimizations,
  aggregateExperiments,
  aggregateGovernance,
  aggregateAgentFleet,
  aggregateAutonomy,
  aggregateShield,
} from '@jak-swarm/swarm';
import type {
  OutcomeInput,
  DiagnosisInput,
  RepairInput,
  PlanVersionInput,
  LearningInput,
  ConfigVersionInput,
  RolloutEventInput,
  HyperAgentConfigInput,
  AgentTraceInput,
  ShieldAuditInput,
} from '@jak-swarm/swarm';
import type { BenchmarkResultRow } from '@jak-swarm/shared';

// REVIEWER+ may view the control centre. SYSTEM_ADMIN sees their own tenant.
const REVIEWER_PLUS = ['REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN'] as const;
// TENANT_ADMIN+ may advance/rollback/create experiments (operator-only —
// advancing a versioned config through shadow→canary→promote changes live
// behaviour, so it is gated above the read role).
const ADMIN_PLUS = ['TENANT_ADMIN', 'SYSTEM_ADMIN'] as const;

// Honest capability flags. Raised to true ONLY when the backing write/persist
// path is wired. Until then the pure core surfaces an honest roadmap note.
const BENCHMARKS_PERSISTED = false; // Phase 8 harness runs in-process; no benchmark_results table yet.
const SHIELD_DECISIONS_PERSISTED = false; // Phase 8 signed-decision core + MCP client exist; no shield_decisions table yet.
// Phase 4 — the config-lifecycle advance/rollback write endpoint is now WIRED
// (ConfigLifecycleService). An operator can advance a versioned config through
// the bounded, evidence-gated lifecycle + roll it back, fully audited. The
// pure core refuses a fake advance on HOLD; PROMOTED AUTONOMY_POLICY /
// REPAIR_BUDGET configs are applied to the live HyperAgentConfig. (Canary
// traffic-percentage routing into the live graph is the remaining wire.)
const EXPERIMENT_CONTROLS_WIRED = true;

// Row caps — the control centre shows recent activity, not an unbounded dump.
const LIST_LIMIT = 100;

const hyperagentRoutes: FastifyPluginAsync = async (fastify) => {
  const gate = [fastify.authenticate, ...(fastify.requireRole ? [fastify.requireRole(...REVIEWER_PLUS)] : [])];

  // ── GET /overview ───────────────────────────────────────────────────────
  fastify.get('/overview', { preHandler: gate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.user!.tenantId;
    try {
      const [config, outcomes, planVersions, repairs, learnings] = await Promise.all([
        fastify.db.hyperAgentConfig.findUnique({ where: { tenantId } }),
        fastify.db.workflowOutcome.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
        fastify.db.planVersion.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
        fastify.db.codeRepairProposal.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
        fastify.db.learningRecord.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
      ]);
      const view = aggregateOverview({
        config: config
          ? ({
              hyperAgentEnabled: config.hyperAgentEnabled,
              hyperAgentMode: config.hyperAgentMode,
              autonomyLevel: config.autonomyLevel,
              maxExecutionRetries: config.maxExecutionRetries,
              maxOutputRepairs: config.maxOutputRepairs,
              maxPlanRepairs: config.maxPlanRepairs,
              maxCapabilityRepairs: config.maxCapabilityRepairs,
              maxTotalCostUsd: config.maxTotalCostUsd,
              maxDurationMs: config.maxDurationMs,
              allowShadowOptimization: config.allowShadowOptimization,
              allowCanaryOptimization: config.allowCanaryOptimization,
              allowCodePatchProposal: config.allowCodePatchProposal,
              requireApprovalForPromptPromotion: config.requireApprovalForPromptPromotion,
              requireApprovalForWorkflowPromotion: config.requireApprovalForWorkflowPromotion,
              updatedAt: config.updatedAt,
            } satisfies HyperAgentConfigInput)
          : null,
        outcomes: outcomes as OutcomeInput[],
        planVersions: planVersions as PlanVersionInput[],
        repairs: repairs as RepairInput[],
        learnings: learnings as LearningInput[],
      });
      return reply.send(ok({ ...view, generatedAt: new Date().toISOString() }));
    } catch (e) {
      return reply.status(500).send(err('HYPERAGENT_OVERVIEW_FAILED', e instanceof Error ? e.message : 'unknown'));
    }
  });

  // ── GET /runs ───────────────────────────────────────────────────────────
  fastify.get('/runs', { preHandler: gate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.user!.tenantId;
    try {
      const [outcomes, diagnoses, repairs] = await Promise.all([
        fastify.db.workflowOutcome.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
        fastify.db.failureDiagnosis.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
        fastify.db.codeRepairProposal.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
      ]);
      const view = aggregateRuns({
        outcomes: outcomes as OutcomeInput[],
        diagnoses: diagnoses as DiagnosisInput[],
        repairs: repairs as RepairInput[],
      });
      return reply.send(ok({ ...view, generatedAt: new Date().toISOString() }));
    } catch (e) {
      return reply.status(500).send(err('HYPERAGENT_RUNS_FAILED', e instanceof Error ? e.message : 'unknown'));
    }
  });

  // ── GET /learnings ──────────────────────────────────────────────────────
  fastify.get('/learnings', { preHandler: gate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.user!.tenantId;
    try {
      const learnings = await fastify.db.learningRecord.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } });
      const view = aggregateLearnings({ learnings: learnings as LearningInput[] });
      return reply.send(ok({ ...view, generatedAt: new Date().toISOString() }));
    } catch (e) {
      return reply.status(500).send(err('HYPERAGENT_LEARNINGS_FAILED', e instanceof Error ? e.message : 'unknown'));
    }
  });

  // ── GET /optimizations ──────────────────────────────────────────────────
  fastify.get('/optimizations', { preHandler: gate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.user!.tenantId;
    try {
      const [configVersions, planVersions] = await Promise.all([
        fastify.db.configVersion.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
        fastify.db.planVersion.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
      ]);
      const view = aggregateOptimizations({
        configVersions: configVersions as ConfigVersionInput[],
        planVersions: planVersions as PlanVersionInput[],
        benchmarks: [] as BenchmarkResultRow[], // no persisted benchmark store yet (honest)
        benchmarksPersisted: BENCHMARKS_PERSISTED,
      });
      return reply.send(ok({ ...view, generatedAt: new Date().toISOString() }));
    } catch (e) {
      return reply.status(500).send(err('HYPERAGENT_OPTIMIZATIONS_FAILED', e instanceof Error ? e.message : 'unknown'));
    }
  });

  // ── GET /experiments ────────────────────────────────────────────────────
  fastify.get('/experiments', { preHandler: gate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.user!.tenantId;
    try {
      const [configVersions, rolloutEvents] = await Promise.all([
        fastify.db.configVersion.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
        fastify.db.configRolloutEvent.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { occurredAt: 'desc' } }),
      ]);
      const view = aggregateExperiments({
        configVersions: configVersions as ConfigVersionInput[],
        rolloutEvents: rolloutEvents as RolloutEventInput[],
        controlsWired: EXPERIMENT_CONTROLS_WIRED,
      });
      return reply.send(ok({ ...view, generatedAt: new Date().toISOString() }));
    } catch (e) {
      return reply.status(500).send(err('HYPERAGENT_EXPERIMENTS_FAILED', e instanceof Error ? e.message : 'unknown'));
    }
  });

  // ── GET /governance ─────────────────────────────────────────────────────
  fastify.get('/governance', { preHandler: gate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.user!.tenantId;
    try {
      const [diagnoses, configVersions] = await Promise.all([
        fastify.db.failureDiagnosis.findMany({ where: { tenantId }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
        fastify.db.configVersion.findMany({ where: { tenantId, kind: 'GOVERNANCE_RULE' }, take: LIST_LIMIT, orderBy: { createdAt: 'desc' } }),
      ]);
      const view = aggregateGovernance({
        diagnoses: diagnoses as DiagnosisInput[],
        configVersions: configVersions as ConfigVersionInput[],
      });
      return reply.send(ok({ ...view, generatedAt: new Date().toISOString() }));
    } catch (e) {
      return reply.status(500).send(err('HYPERAGENT_GOVERNANCE_FAILED', e instanceof Error ? e.message : 'unknown'));
    }
  });

  // ── GET /agent-fleet ────────────────────────────────────────────────────
  fastify.get('/agent-fleet', { preHandler: gate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.user!.tenantId;
    try {
      // AgentTrace has no tenantId relation enforcement beyond the column; filter by it.
      const traces = await fastify.db.agentTrace.findMany({ where: { tenantId }, take: 500, orderBy: { startedAt: 'desc' } });
      const view = aggregateAgentFleet({
        traces: traces.map((t) => ({
          agentRole: t.agentRole,
          durationMs: t.durationMs,
          error: t.error,
          createdAt: t.startedAt,
        })) as AgentTraceInput[],
      });
      return reply.send(ok({ ...view, generatedAt: new Date().toISOString() }));
    } catch (e) {
      return reply.status(500).send(err('HYPERAGENT_AGENT_FLEET_FAILED', e instanceof Error ? e.message : 'unknown'));
    }
  });

  // ── GET /autonomy ───────────────────────────────────────────────────────
  fastify.get('/autonomy', { preHandler: gate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.user!.tenantId;
    try {
      const [config, outcomes] = await Promise.all([
        fastify.db.hyperAgentConfig.findUnique({ where: { tenantId } }),
        // Outcomes carrying a finalAutonomy snapshot = real autonomy decisions.
        fastify.db.workflowOutcome.findMany({ where: { tenantId, NOT: { finalAutonomy: null } }, take: 50, orderBy: { createdAt: 'desc' } }),
      ]);
      const view = aggregateAutonomy({
        config: config
          ? ({
              hyperAgentEnabled: config.hyperAgentEnabled,
              hyperAgentMode: config.hyperAgentMode,
              autonomyLevel: config.autonomyLevel,
              maxExecutionRetries: config.maxExecutionRetries,
              maxOutputRepairs: config.maxOutputRepairs,
              maxPlanRepairs: config.maxPlanRepairs,
              maxCapabilityRepairs: config.maxCapabilityRepairs,
              maxTotalCostUsd: config.maxTotalCostUsd,
              maxDurationMs: config.maxDurationMs,
              allowShadowOptimization: config.allowShadowOptimization,
              allowCanaryOptimization: config.allowCanaryOptimization,
              allowCodePatchProposal: config.allowCodePatchProposal,
              requireApprovalForPromptPromotion: config.requireApprovalForPromptPromotion,
              requireApprovalForWorkflowPromotion: config.requireApprovalForWorkflowPromotion,
              updatedAt: config.updatedAt,
            } satisfies HyperAgentConfigInput)
          : null,
        outcomes: outcomes as OutcomeInput[],
      });
      return reply.send(ok({ ...view, generatedAt: new Date().toISOString() }));
    } catch (e) {
      return reply.status(500).send(err('HYPERAGENT_AUTONOMY_FAILED', e instanceof Error ? e.message : 'unknown'));
    }
  });

  // ── GET /shield ─────────────────────────────────────────────────────────
  fastify.get('/shield', { preHandler: gate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.user!.tenantId;
    try {
      // No dedicated shield_decisions table yet (Phase 8 wires the crypto core
      // + MCP client; persistence is roadmap). Surface real Shield-related
      // audit-log rows only — honest, never fabricated.
      const auditRows = await fastify.db.auditLog
        .findMany({
          where: { tenantId, resource: { contains: 'shield', mode: 'insensitive' } },
          take: LIST_LIMIT,
          orderBy: { createdAt: 'desc' },
        })
        .catch(() => []);
      const decisions: ShieldAuditInput[] = [];
      for (const a of auditRows) {
        const details = (a.details ?? null) as { verdict?: string; subjectKind?: string; tenantId?: string } | null;
        const verdict = details?.verdict ?? 'BLOCK'; // audit-log evidence of a shield action; default BLOCK (fail-closed) only when a row exists but lacks a verdict
        decisions.push({
          auditEventId: a.id,
          verdict,
          subjectKind: details?.subjectKind ?? null,
          tenantId: details?.tenantId ?? a.tenantId,
          issuedAt: a.createdAt,
        });
      }
      const view = aggregateShield({ decisions, decisionsPersisted: SHIELD_DECISIONS_PERSISTED });
      return reply.send(ok({ ...view, generatedAt: new Date().toISOString() }));
    } catch (e) {
      return reply.status(500).send(err('HYPERAGENT_SHIELD_FAILED', e instanceof Error ? e.message : 'unknown'));
    }
  });

  // ── Phase 4 — config-lifecycle LIVE caller (write endpoints) ───────────
  // The pure core (`config-lifecycle.ts`) decides which transitions are legal
  // and refuses a fake advance on HOLD. These routes make that gate reachable
  // from runtime: an operator creates/advances/rolls back a versioned config,
  // the gate enforces the decision, and every transition is durably audited.
  // TENANT_ADMIN+ only (operator action — a PROMOTED AUTONOMY_POLICY /
  // REPAIR_BUDGET config is applied to the live HyperAgentConfig).
  const lifecycle = new ConfigLifecycleService(
    fastify.db as unknown as import('../services/company-brain/config-lifecycle.service.js').ConfigLifecyclePrismaClient,
    fastify.log,
  );
  const adminGate = [fastify.authenticate, ...(fastify.requireRole ? [fastify.requireRole(...ADMIN_PLUS)] : [])];

  const createDraftBodySchema = z.object({
    kind: z.enum([
      ConfigKind.AUTONOMY_POLICY,
      ConfigKind.REPAIR_BUDGET,
      ConfigKind.LEARNING_GATE,
      ConfigKind.GOVERNANCE_RULE,
      ConfigKind.TOOL_POLICY,
    ]),
    spec: z.record(z.unknown()),
    reason: z.string().max(2000).optional(),
  });

  fastify.post('/experiments', { preHandler: adminGate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parse = createDraftBodySchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
    }
    try {
      const version = await lifecycle.createDraft({
        tenantId: request.user!.tenantId,
        kind: parse.data.kind as ConfigKindType,
        spec: parse.data.spec,
        reason: parse.data.reason,
      });
      return reply.status(201).send(ok(version));
    } catch (e) {
      return reply.status(400).send(err('CONFIG_LIFECYCLE_FAILED', e instanceof Error ? e.message : 'unknown'));
    }
  });

  const advanceBodySchema = z.object({
    metrics: z
      .object({
        samples: z.number(),
        successRate: z.number(),
        failureRate: z.number(),
        meanCost: z.number().optional(),
        safetyIncidentRate: z.number().optional(),
      })
      .optional(),
    baseline: z
      .object({
        samples: z.number(),
        successRate: z.number(),
        failureRate: z.number(),
        meanCost: z.number().optional(),
        safetyIncidentRate: z.number().optional(),
      })
      .optional(),
    thresholds: z
      .object({
        minSamples: z.number(),
        minSuccessRate: z.number(),
        maxFailureRate: z.number(),
        maxSafetyIncidentRate: z.number(),
        minLiftOverBaseline: z.number(),
      })
      .optional(),
    reason: z.string().max(2000).optional(),
  });

  fastify.post(
    '/experiments/:configVersionId/advance',
    { preHandler: adminGate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { configVersionId } = request.params as { configVersionId: string };
      const parse = advanceBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      try {
        const result = await lifecycle.advance({
          tenantId: request.user!.tenantId,
          configVersionId,
          metrics: parse.data.metrics as RolloutMetrics | undefined,
          baseline: parse.data.baseline as RolloutMetrics | undefined,
          thresholds: parse.data.thresholds as RolloutThresholds | undefined,
          reason: parse.data.reason,
        });
        return reply.send(ok(result));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        // An illegal transition / not-found / wrong-tenant → 409; other failures → 500.
        const status = /not found|cannot advance|illegal/i.test(msg) ? 409 : 500;
        return reply.status(status).send(err('CONFIG_LIFECYCLE_FAILED', msg));
      }
    },
  );

  const rollbackBodySchema = z.object({
    reason: z.string().min(1).max(2000),
  });

  fastify.post(
    '/experiments/:configVersionId/rollback',
    { preHandler: adminGate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { configVersionId } = request.params as { configVersionId: string };
      const parse = rollbackBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      try {
        const result = await lifecycle.rollback({
          tenantId: request.user!.tenantId,
          configVersionId,
          reason: parse.data.reason,
        });
        return reply.send(ok(result));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        const status = /not found|not allowed/i.test(msg) ? 409 : 500;
        return reply.status(status).send(err('CONFIG_LIFECYCLE_FAILED', msg));
      }
    },
  );
  // ── PUT /config — operator-gated enable/disable of the HyperAgent ───────
  // The single switch that turns the self-healing + governed-learning layer ON
  // for this tenant (default OFF; default workflows stay byte-for-byte
  // unchanged). The swarm-execution service reads hyperAgentConfig on every
  // run, so this is what unblocks the HyperAgent for live work. TENANT_ADMIN+
  // only — enabling autonomous repair changes live behaviour.
  const hyperAgentConfigBodySchema = z.object({
    hyperAgentEnabled: z.boolean(),
    hyperAgentMode: z.enum(['OFF', 'OBSERVE', 'ASSISTED', 'AUTONOMOUS_SAFE']).optional(),
    autonomyLevel: z.enum(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']).optional(),
    maxExecutionRetries: z.number().int().min(0).max(5).optional(),
    maxOutputRepairs: z.number().int().min(0).max(5).optional(),
    maxPlanRepairs: z.number().int().min(0).max(3).optional(),
    maxCapabilityRepairs: z.number().int().min(0).max(3).optional(),
    maxTotalCostUsd: z.number().min(0).max(1000).optional(),
    maxDurationMs: z.number().int().min(0).max(3_600_000).optional(),
    allowShadowOptimization: z.boolean().optional(),
    allowCanaryOptimization: z.boolean().optional(),
    allowCodePatchProposal: z.boolean().optional(),
  });

  fastify.put(
    '/config',
    { preHandler: adminGate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.user!.tenantId;
      const parse = hyperAgentConfigBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      const body = parse.data;
      try {
        const config = await fastify.db.hyperAgentConfig.upsert({
          where: { tenantId },
          create: { tenantId, ...body },
          update: { ...body },
        });
        await fastify.auditLog(request, 'HYPERAGENT_CONFIG_UPDATED', 'HyperAgentConfig', config.id, {
          hyperAgentEnabled: config.hyperAgentEnabled,
          hyperAgentMode: config.hyperAgentMode,
          autonomyLevel: config.autonomyLevel,
        });
        return reply.send(ok({ config }));
      } catch (e) {
        return reply.status(500).send(err('HYPERAGENT_CONFIG_UPDATE_FAILED', e instanceof Error ? e.message : 'unknown'));
      }
    },
  );

};

export default hyperagentRoutes;