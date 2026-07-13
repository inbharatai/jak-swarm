/**
 * config-lifecycle.service.ts — HyperAgent Phase 4/9 config-lifecycle LIVE caller.
 *
 * The pure core (`packages/swarm/src/hyperagent/config-lifecycle.ts`) decides
 * which transitions a ConfigVersion may make and evaluates shadow/canary
 * metrics before advancing — refusing a fake advance on HOLD (the honest
 * evaluation seam). This service is the thin I/O layer that makes that gate
 * REACHABLE from live runtime: an operator advances/rolls back a versioned
 * config through a real API, the gate's decision is enforced, and every
 * transition is durably persisted + audited as a ConfigRolloutEvent.
 *
 * What this service does (the reachable-from-runtime part):
 *   - createDraft: a new DRAFT ConfigVersion enters the pipeline (operator
 *     proposes a config doc; the agent may not — self-modification is human-
 *     initiated here, evidence-gated by the lifecycle before it touches live
 *     behaviour);
 *   - advance: walk one step DRAFT→PROPOSED→SHADOW→CANARY (ramp)→PROMOTED,
 *     using the pure gate. On HOLD the version is NOT advanced (no fake
 *     advance) — the evaluation summary is attached for the operator. On
 *     ROLLBACK (safety breach) the version is rolled back. On PROMOTE the
 *     prior PROMOTED version of the same kind is superseded (ARCHIVED) and,
 *     for AUTONOMY_POLICY / REPAIR_BUDGET, the spec is applied to the tenant's
 *     HyperAgentConfig — the row the live autonomy-policy evaluator reads — so
 *     a PROMOTED config genuinely governs live agent behaviour;
 *   - rollback: SHADOW|CANARY|PROMOTED → ROLLED_BACK with a reason.
 *
 * Honest scope (NOT faked):
 *   - The canary TRAFFIC percentage (routing N% of live graph executions to a
 *     CANARY config) is not yet consumed by the live graph — the live graph
 *     reads LearningRecord arms for config selection, not ConfigVersion
 *     rollout %. The lifecycle decision + audit IS live; canary traffic
 *     routing is the remaining wire (documented in the truth audit).
 *   - LEARNING_GATE / GOVERNANCE_RULE / TOOL_POLICY configs are persisted +
 *     audited through the lifecycle but NOT yet applied to live behaviour
 *     (their live consumers are roadmap). Only AUTONOMY_POLICY + REPAIR_BUDGET
 *     reach live runtime via HyperAgentConfig today.
 *
 * Tenant-safe: every read/write is scoped by tenantId; cross-tenant probes get
 * null/404. Transactional: a transition + its audit event are written together
 * so the audit trail can never diverge from the row state.
 */
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import {
  ConfigKind,
  ConfigVersionStatus,
  PromotionDecision,
  RolloutStage,
} from '@jak-swarm/shared';
import type {
  ConfigKind as ConfigKindType,
  ConfigVersion,
  ConfigVersionStatus as ConfigVersionStatusType,
  RolloutMetrics,
  RolloutThresholds,
} from '@jak-swarm/shared';
import {
  createDraftConfig,
  proposeVersion,
  startShadow,
  startCanary,
  rampCanary,
  rollbackVersion,
  supersede,
  recordConfigEvent,
  withEvaluation,
  evaluateStage,
} from '@jak-swarm/swarm';

/** The DB row shape we read/write (only the fields the lifecycle path uses). */
interface ConfigVersionRow {
  id: string;
  tenantId: string;
  kind: string;
  version: number;
  spec: unknown;
  status: string;
  parentVersionId: string | null;
  supersededById: string | null;
  rolloutPercent: number;
  createdAt: Date;
  proposedAt: Date | null;
  shadowStartedAt: Date | null;
  canaryStartedAt: Date | null;
  promotedAt: Date | null;
  rolledBackAt: Date | null;
  changeReason: string | null;
  evaluationSummary: string | null;
}

/** Map a DB row to the pure ConfigVersion (timestamps as ISO strings). */
function rowToVersion(r: ConfigVersionRow): ConfigVersion {
  const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);
  return {
    id: r.id,
    tenantId: r.tenantId,
    kind: r.kind as ConfigKindType,
    version: r.version,
    spec: r.spec,
    status: r.status as ConfigVersionStatusType,
    parentVersionId: r.parentVersionId,
    supersededById: r.supersededById,
    rolloutPercent: r.rolloutPercent,
    createdAt: r.createdAt.toISOString(),
    proposedAt: toIso(r.proposedAt),
    shadowStartedAt: toIso(r.shadowStartedAt),
    canaryStartedAt: toIso(r.canaryStartedAt),
    promotedAt: toIso(r.promotedAt),
    rolledBackAt: toIso(r.rolledBackAt),
    changeReason: r.changeReason,
    evaluationSummary: r.evaluationSummary,
  };
}

// ─── Validated spec shapes for the kinds that reach live runtime ────────────
// Only the fields present are applied; validation rejects unknown/bad shapes.

const AUTONOMY_POLICY_SPEC_SCHEMA = z
  .object({
    hyperAgentEnabled: z.boolean().optional(),
    hyperAgentMode: z.enum(['OFF', 'OBSERVE', 'ASSISTED', 'AUTONOMOUS_SAFE']).optional(),
    autonomyLevel: z.enum(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']).optional(),
    allowShadowOptimization: z.boolean().optional(),
    allowCanaryOptimization: z.boolean().optional(),
    allowCodePatchProposal: z.boolean().optional(),
    requireApprovalForPromptPromotion: z.boolean().optional(),
    requireApprovalForWorkflowPromotion: z.boolean().optional(),
  })
  .strict();

const REPAIR_BUDGET_SPEC_SCHEMA = z
  .object({
    maxExecutionRetries: z.number().int().min(0).max(10).optional(),
    maxOutputRepairs: z.number().int().min(0).max(10).optional(),
    maxPlanRepairs: z.number().int().min(0).max(10).optional(),
    maxCapabilityRepairs: z.number().int().min(0).max(10).optional(),
    maxTotalCostUsd: z.number().min(0).optional(),
    maxDurationMs: z.number().int().min(0).optional(),
  })
  .strict();

export class ConfigLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigLifecycleError';
  }
}

export type AdvanceDecision = PromotionDecision | 'NOOP';

export interface AdvanceResult {
  configVersionId: string;
  fromStatus: ConfigVersionStatusType;
  toStatus: ConfigVersionStatusType;
  decision: AdvanceDecision;
  /** The evaluation summary the gate produced (audit + cockpit). */
  evaluationSummary: string;
  /** The new rollout percentage (unchanged on HOLD). */
  rolloutPercent: number;
  /** True when promotion applied the spec to the live HyperAgentConfig. */
  appliedToLiveConfig: boolean;
  /** True when a prior PROMOTED version was superseded (ARCHIVED). */
  supersededPrior: boolean;
}

export interface CreateDraftInput {
  tenantId: string;
  kind: ConfigKindType;
  spec: unknown;
  reason?: string;
}

export interface AdvanceInput {
  tenantId: string;
  configVersionId: string;
  /** Stage metrics (required to advance from PROPOSED→SHADOW→CANARY→PROMOTED). */
  metrics?: RolloutMetrics;
  /** Baseline metrics the candidate is compared against for lift. */
  baseline?: RolloutMetrics;
  thresholds?: RolloutThresholds;
  reason?: string;
}

export interface RollbackInput {
  tenantId: string;
  configVersionId: string;
  reason: string;
}

/**
 * Minimal Prisma seam for the config-lifecycle path. Mirrors the
 * `CheckpointPrismaClient` pattern so the live API injects the real Prisma
 * client while tests inject an in-memory stub.
 */
export interface ConfigLifecyclePrismaClient {
  configVersion: {
    findUnique: (args: unknown) => Promise<ConfigVersionRow | null>;
    findFirst: (args: unknown) => Promise<ConfigVersionRow | null>;
    findMany: (args: unknown) => Promise<ConfigVersionRow[]>;
    create: (args: unknown) => Promise<ConfigVersionRow>;
    update: (args: unknown) => Promise<ConfigVersionRow>;
    count: (args: unknown) => Promise<number>;
  };
  configRolloutEvent: {
    create: (args: unknown) => Promise<unknown>;
  };
  hyperAgentConfig: {
    findUnique: (args: unknown) => Promise<{ tenantId: string } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
}

export class ConfigLifecycleService {
  constructor(
    private readonly db: ConfigLifecyclePrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Create a new DRAFT ConfigVersion (the only entry point into the pipeline). */
  async createDraft(input: CreateDraftInput): Promise<ConfigVersion> {
    // Validate the spec shape for the kinds we know; unknown kinds are stored
    // as-is (persisted + audited, not applied to live config — honest roadmap).
    validateSpecShape(input.kind, input.spec);

    // Monotonic per-(tenant,kind) version counter.
    const maxVersionRow = await this.db.configVersion.findFirst({
      where: { tenantId: input.tenantId, kind: input.kind },
      orderBy: { version: 'desc' },
    } as never);
    const nextVersion = (maxVersionRow?.version ?? 0) + 1;
    const id = `cfg_${input.tenantId}_${input.kind}_${nextVersion}_${Date.now()}`;
    const now = new Date().toISOString();
    const v = createDraftConfig({
      id,
      tenantId: input.tenantId,
      kind: input.kind,
      version: nextVersion,
      spec: input.spec,
      parentVersionId: null,
      now,
    });
    const row = await this.db.configVersion.create({
      data: {
        id: v.id,
        tenantId: v.tenantId,
        kind: v.kind,
        version: v.version,
        spec: v.spec as object,
        status: v.status,
        parentVersionId: null,
        supersededById: null,
        rolloutPercent: 0,
        changeReason: input.reason ?? 'draft created',
      },
    } as never);
    return rowToVersion(row);
  }

  /** Advance one lifecycle step via the pure gate. Refuses a fake advance on HOLD. */
  async advance(input: AdvanceInput): Promise<AdvanceResult> {
    const row = await this.db.configVersion.findUnique({ where: { id: input.configVersionId } } as never);
    if (!row || row.tenantId !== input.tenantId) {
      throw new ConfigLifecycleError('config version not found in tenant');
    }
    const v = rowToVersion(row);
    const fromStatus = v.status;
    const now = new Date().toISOString();
    const metrics = input.metrics;
    const baseline = input.baseline ?? { samples: 0, successRate: 0, failureRate: 0 };

    // Decide the next version via the pure gate, per current status.
    let nextVersion: ConfigVersion | null = null;
    let decision: AdvanceDecision = 'NOOP';
    let evaluationSummary = v.evaluationSummary ?? '';

    switch (v.status) {
      case ConfigVersionStatus.DRAFT:
        nextVersion = proposeVersion(v, now, input.reason);
        decision = PromotionDecision.ADVANCE;
        evaluationSummary = 'DRAFT → PROPOSED (operator proposed)';
        break;

      case ConfigVersionStatus.PROPOSED: {
        // PROPOSED → SHADOW: start shadow execution. No metrics required to
        // *start* shadow (shadow runs alongside live; its evaluation happens
        // at the SHADOW→CANARY step). The operator may supply metrics here to
        // gate the start, but the lifecycle permits the transition regardless.
        nextVersion = startShadow(v, now, input.reason);
        decision = PromotionDecision.ADVANCE;
        evaluationSummary = 'PROPOSED → SHADOW (shadow execution started)';
        break;
      }

      case ConfigVersionStatus.SHADOW: {
        if (!metrics) {
          // Hold for evidence — never fake an advance without metrics.
          const held = withEvaluation(v, 'HOLD: shadow metrics required to advance to canary');
          return persistHold(this.db, v.id, input.tenantId, v.status, held.evaluationSummary ?? '', v.rolloutPercent);
        }
        const evalResult = evaluateStage(metrics, baseline, input.thresholds);
        evaluationSummary = evalResult.summary;
        if (evalResult.decision === PromotionDecision.ROLLBACK) {
          return this.persistRollback(v, now, evalResult.summary);
        }
        if (evalResult.decision === PromotionDecision.HOLD) {
          return persistHold(this.db, v.id, input.tenantId, v.status, evalResult.summary, v.rolloutPercent);
        }
        nextVersion = startCanary(v, now, undefined, input.reason ?? evalResult.summary);
        decision = PromotionDecision.ADVANCE;
        break;
      }

      case ConfigVersionStatus.CANARY: {
        if (!metrics) {
          const held = withEvaluation(v, 'HOLD: canary metrics required to ramp');
          return persistHold(this.db, v.id, input.tenantId, v.status, held.evaluationSummary ?? '', v.rolloutPercent);
        }
        const ramp = rampCanary(v, metrics, baseline, now, { thresholds: input.thresholds, reason: input.reason });
        evaluationSummary = ramp.evaluation.summary;
        if (ramp.decision === PromotionDecision.ROLLBACK) {
          return this.persistRollback(v, now, ramp.evaluation.summary);
        }
        if (ramp.decision === PromotionDecision.HOLD || !ramp.nextVersion) {
          return persistHold(this.db, v.id, input.tenantId, v.status, ramp.evaluation.summary, v.rolloutPercent);
        }
        nextVersion = ramp.nextVersion;
        decision = PromotionDecision.ADVANCE;
        break;
      }

      default:
        // PROMOTED / ROLLED_BACK / ARCHIVED — nothing to advance.
        throw new ConfigLifecycleError(`cannot advance a config version with status '${v.status}'`);
    }

    if (!nextVersion) {
      // Defensive — should be unreachable; treat as HOLD, never a fake advance.
      return persistHold(this.db, v.id, input.tenantId, v.status, 'HOLD: no advance computed', v.rolloutPercent);
    }

    return this.persistTransition(v, nextVersion, fromStatus, decision, evaluationSummary, now);
  }

  /** Roll back a SHADOW | CANARY | PROMOTED version. */
  async rollback(input: RollbackInput): Promise<AdvanceResult> {
    const row = await this.db.configVersion.findUnique({ where: { id: input.configVersionId } } as never);
    if (!row || row.tenantId !== input.tenantId) {
      throw new ConfigLifecycleError('config version not found in tenant');
    }
    const v = rowToVersion(row);
    const now = new Date().toISOString();
    return this.persistRollback(v, now, input.reason);
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private async persistRollback(v: ConfigVersion, now: string, reason: string): Promise<AdvanceResult> {
    const rolledBack = rollbackVersion(v, now, reason);
    return this.persistTransition(v, rolledBack, v.status, PromotionDecision.ROLLBACK, reason, now);
  }

  private async persistTransition(
    prev: ConfigVersion,
    next: ConfigVersion,
    fromStatus: ConfigVersionStatusType,
    decision: AdvanceDecision,
    evaluationSummary: string,
    now: string,
  ): Promise<AdvanceResult> {
    const stage = stageFor(next.status);
    const eventId = `cre_${prev.id}_${Date.now()}`;
    const event = recordConfigEvent(next, {
      id: eventId,
      fromStatus,
      toStatus: next.status,
      stage,
      decision: decision === 'NOOP' ? null : decision,
      rolloutPercent: next.rolloutPercent,
      reason: next.changeReason ?? evaluationSummary,
      now,
    });

    let supersededPrior = false;
    let appliedToLiveConfig = false;
    this.log.info(
      { tenantId: prev.tenantId, configVersionId: prev.id, from: fromStatus, to: next.status, decision },
      'config-lifecycle transition',
    );

    // On PROMOTE: supersede the prior PROMOTED version of the same kind + apply
    // to the live HyperAgentConfig (for AUTONOMY_POLICY / REPAIR_BUDGET).
    if (next.status === ConfigVersionStatus.PROMOTED) {
      const priorPromoted = await this.db.configVersion.findFirst({
        where: { tenantId: prev.tenantId, kind: prev.kind, status: ConfigVersionStatus.PROMOTED, id: { not: prev.id } },
      } as never);
      if (priorPromoted) {
        const { archived, promoted } = supersede(rowToVersion(priorPromoted), next, now);
        next = promoted;
        // Persist within a transaction: update this version, archive the prior,
        // write the audit event, and apply the live config — atomically.
        await this.db.$transaction(async (tx) => {
          await updateVersion(tx, next);
          await updateVersion(tx, archived);
          await createEvent(tx, event);
          appliedToLiveConfig = await applyLiveConfig(tx, prev.tenantId, prev.kind, next.spec);
        });
        supersededPrior = true;
        return {
          configVersionId: next.id,
          fromStatus,
          toStatus: next.status,
          decision,
          evaluationSummary,
          rolloutPercent: next.rolloutPercent,
          appliedToLiveConfig,
          supersededPrior,
        };
      }
    }

    // Non-promote transitions (or promote with no prior): persist the version +
    // audit event atomically; apply live config on promote even without a prior.
    await this.db.$transaction(async (tx) => {
      await updateVersion(tx, next);
      await createEvent(tx, event);
      if (next.status === ConfigVersionStatus.PROMOTED) {
        appliedToLiveConfig = await applyLiveConfig(tx, prev.tenantId, prev.kind, next.spec);
      }
    });

    return {
      configVersionId: next.id,
      fromStatus,
      toStatus: next.status,
      decision,
      evaluationSummary,
      rolloutPercent: next.rolloutPercent,
      appliedToLiveConfig,
      supersededPrior,
    };
  }
}

// ─── module helpers (operate on a tx or the client — both expose the seam) ──

async function persistHold(
  db: ConfigLifecyclePrismaClient,
  id: string,
  tenantId: string,
  currentStatus: ConfigVersionStatusType,
  summary: string,
  rolloutPercent: number,
): Promise<AdvanceResult> {
  // Attach the evaluation summary WITHOUT a status change; write a HOLD audit
  // event so the operator's evidence gap is durably recorded. The status is
  // unchanged — a HOLD never advances the version (no fake advance).
  const now = new Date().toISOString();
  const eventId = `cre_${id}_hold_${Date.now()}`;
  await db.$transaction(async (tx) => {
    await (tx as { configVersion: { update: (a: unknown) => Promise<unknown> } }).configVersion.update({
      where: { id },
      data: { evaluationSummary: summary },
    });
    await (tx as { configRolloutEvent: { create: (a: unknown) => Promise<unknown> } }).configRolloutEvent.create({
      data: {
        id: eventId,
        configVersionId: id,
        tenantId,
        fromStatus: currentStatus,
        toStatus: currentStatus,
        stage: null,
        decision: PromotionDecision.HOLD,
        rolloutPercent,
        reason: summary,
        occurredAt: now,
      },
    });
  });
  return {
    configVersionId: id,
    fromStatus: currentStatus,
    toStatus: currentStatus,
    decision: PromotionDecision.HOLD,
    evaluationSummary: summary,
    rolloutPercent,
    appliedToLiveConfig: false,
    supersededPrior: false,
  };
}

async function updateVersion(tx: unknown, v: ConfigVersion): Promise<void> {
  await (tx as { configVersion: { update: (a: unknown) => Promise<unknown> } }).configVersion.update({
    where: { id: v.id },
    data: {
      status: v.status,
      parentVersionId: v.parentVersionId,
      supersededById: v.supersededById,
      rolloutPercent: v.rolloutPercent,
      proposedAt: v.proposedAt ? new Date(v.proposedAt) : null,
      shadowStartedAt: v.shadowStartedAt ? new Date(v.shadowStartedAt) : null,
      canaryStartedAt: v.canaryStartedAt ? new Date(v.canaryStartedAt) : null,
      promotedAt: v.promotedAt ? new Date(v.promotedAt) : null,
      rolledBackAt: v.rolledBackAt ? new Date(v.rolledBackAt) : null,
      changeReason: v.changeReason,
      evaluationSummary: v.evaluationSummary,
    },
  });
}

async function createEvent(tx: unknown, event: {
  id: string; configVersionId: string; tenantId: string; fromStatus: ConfigVersionStatusType;
  toStatus: ConfigVersionStatusType; stage: RolloutStage | null; decision: PromotionDecision | null;
  rolloutPercent: number; reason: string; occurredAt: string;
}): Promise<void> {
  await (tx as { configRolloutEvent: { create: (a: unknown) => Promise<unknown> } }).configRolloutEvent.create({
    data: {
      id: event.id,
      configVersionId: event.configVersionId,
      tenantId: event.tenantId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      stage: event.stage,
      decision: event.decision,
      rolloutPercent: event.rolloutPercent,
      reason: event.reason,
      occurredAt: event.occurredAt,
    },
  });
}

/** The rollout stage a transition targets (null for non-stage transitions). */
function stageFor(status: ConfigVersionStatusType): RolloutStage | null {
  switch (status) {
    case ConfigVersionStatus.SHADOW:
      return RolloutStage.SHADOW;
    case ConfigVersionStatus.CANARY:
      return RolloutStage.CANARY;
    case ConfigVersionStatus.PROMOTED:
      return RolloutStage.PROMOTED;
    default:
      return null;
  }
}

/** Validate the spec shape for the kinds that reach live runtime. Throws on a bad shape. */
function validateSpecShape(kind: ConfigKindType, spec: unknown): void {
  if (kind === ConfigKind.AUTONOMY_POLICY) {
    const parsed = AUTONOMY_POLICY_SPEC_SCHEMA.safeParse(spec);
    if (!parsed.success) {
      throw new ConfigLifecycleError(`invalid AUTONOMY_POLICY spec: ${parsed.error.message}`);
    }
  } else if (kind === ConfigKind.REPAIR_BUDGET) {
    const parsed = REPAIR_BUDGET_SPEC_SCHEMA.safeParse(spec);
    if (!parsed.success) {
      throw new ConfigLifecycleError(`invalid REPAIR_BUDGET spec: ${parsed.error.message}`);
    }
  }
  // LEARNING_GATE / GOVERNANCE_RULE / TOOL_POLICY: stored as-is (not applied live).
}

/**
 * Apply a PROMOTED spec to the tenant's HyperAgentConfig (the row the live
 * autonomy-policy evaluator reads). Only AUTONOMY_POLICY + REPAIR_BUDGET are
 * applied; other kinds return false (persisted + audited, not live — honest).
 * Returns true when the live config was changed.
 */
async function applyLiveConfig(tx: unknown, tenantId: string, kind: ConfigKindType, spec: unknown): Promise<boolean> {
  if (kind !== ConfigKind.AUTONOMY_POLICY && kind !== ConfigKind.REPAIR_BUDGET) {
    return false;
  }
  const data: Record<string, unknown> = {};
  if (kind === ConfigKind.AUTONOMY_POLICY) {
    const s = AUTONOMY_POLICY_SPEC_SCHEMA.parse(spec);
    if (s.hyperAgentEnabled !== undefined) data.hyperAgentEnabled = s.hyperAgentEnabled;
    if (s.hyperAgentMode !== undefined) data.hyperAgentMode = s.hyperAgentMode;
    if (s.autonomyLevel !== undefined) data.autonomyLevel = s.autonomyLevel;
    if (s.allowShadowOptimization !== undefined) data.allowShadowOptimization = s.allowShadowOptimization;
    if (s.allowCanaryOptimization !== undefined) data.allowCanaryOptimization = s.allowCanaryOptimization;
    if (s.allowCodePatchProposal !== undefined) data.allowCodePatchProposal = s.allowCodePatchProposal;
    if (s.requireApprovalForPromptPromotion !== undefined) data.requireApprovalForPromptPromotion = s.requireApprovalForPromptPromotion;
    if (s.requireApprovalForWorkflowPromotion !== undefined) data.requireApprovalForWorkflowPromotion = s.requireApprovalForWorkflowPromotion;
  } else {
    const s = REPAIR_BUDGET_SPEC_SCHEMA.parse(spec);
    if (s.maxExecutionRetries !== undefined) data.maxExecutionRetries = s.maxExecutionRetries;
    if (s.maxOutputRepairs !== undefined) data.maxOutputRepairs = s.maxOutputRepairs;
    if (s.maxPlanRepairs !== undefined) data.maxPlanRepairs = s.maxPlanRepairs;
    if (s.maxCapabilityRepairs !== undefined) data.maxCapabilityRepairs = s.maxCapabilityRepairs;
    if (s.maxTotalCostUsd !== undefined) data.maxTotalCostUsd = s.maxTotalCostUsd;
    if (s.maxDurationMs !== undefined) data.maxDurationMs = s.maxDurationMs;
  }
  if (Object.keys(data).length === 0) return false;
  await (tx as { hyperAgentConfig: { upsert: (a: unknown) => Promise<unknown> } }).hyperAgentConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  return true;
}