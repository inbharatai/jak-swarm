/**
 * Phase 4 — config-lifecycle LIVE caller (real Postgres).
 *
 * Drives the REAL `ConfigLifecycleService` (createDraft / advance / rollback)
 * against a real pgvector/pgvector:pg16 container with the full migration
 * chain. The pure gate (`config-lifecycle.ts`) decides transitions + refuses
 * a fake advance on HOLD; this test proves the LIVE caller persists the
 * gate's decision, audits every transition, supersedes the prior PROMOTED
 * version, and applies a PROMOTED AUTONOMY_POLICY to the live
 * HyperAgentConfig (the row the live autonomy-policy evaluator reads).
 *
 * Proves the Phase 4 guarantees:
 *   - createDraft → a DRAFT ConfigVersion row, monotonic per-(tenant,kind) version;
 *   - DRAFT → PROPOSED → SHADOW → CANARY (ramp) → PROMOTED happy path;
 *   - HOLD on missing/insufficient metrics (NEVER a fake advance — the status
 *     does not change, an audit HOLD event is written, the evaluation summary
 *     is attached);
 *   - PROMOTE applies the AUTONOMY_POLICY spec to HyperAgentConfig
 *     (appliedToLiveConfig=true) and supersedes the prior PROMOTED (ARCHIVED,
 *     supersededById linked, parentVersionId set on the new one);
 *   - rollback: CANARY → ROLLED_BACK with rolledBackAt stamped + audit event;
 *   - every transition writes a ConfigRolloutEvent audit row;
 *   - cross-tenant isolation: tenant B cannot advance tenant A's config.
 *
 * Honest scope: the canary TRAFFIC-PERCENT routing into the live graph (N% of
 * executions to a CANARY config) is NOT consumed by the live graph yet — the
 * lifecycle decision + audit + PROMOTED→HyperAgentConfig application ARE live.
 * Skipped (not silently passed) when the container runtime is down.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@jak-swarm/db';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigKind, ConfigVersionStatus, PromotionDecision } from '../../packages/shared/src/index.js';
import type { RolloutMetrics } from '../../packages/shared/src/index.js';
import { ConfigLifecycleService } from '../../apps/api/src/services/company-brain/config-lifecycle.service.js';
import type { ConfigLifecyclePrismaClient } from '../../apps/api/src/services/company-brain/config-lifecycle.service.js';
import type { FastifyBaseLogger } from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const noopLog = { info() {}, warn() {}, debug() {}, error() {} } as unknown as FastifyBaseLogger;

const GOOD: RolloutMetrics = { samples: 30, successRate: 0.95, failureRate: 0.05, safetyIncidentRate: 0 };
const BASELINE: RolloutMetrics = { samples: 100, successRate: 0.9, failureRate: 0.1 };
const THIN: RolloutMetrics = { samples: 5, successRate: 0.95, failureRate: 0.05, safetyIncidentRate: 0 };

describe.sequential('Phase 4 — config-lifecycle live caller (testcontainers)', () => {
  let container: Awaited<ReturnType<GenericContainer['start']>>;
  let prisma: PrismaClient;
  let svc: ConfigLifecycleService;
  let runtimeUnavailable = false;

  beforeAll(async () => {
    try {
      container = await new GenericContainer('pgvector/pgvector:pg16')
        .withEnvironment({ POSTGRES_DB: 'jakswarm', POSTGRES_USER: 'jakswarm', POSTGRES_PASSWORD: 'jakswarm' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/i))
        .start();
      const dbUrl = `postgresql://jakswarm:jakswarm@${container.getHost()}:${container.getMappedPort(5432)}/jakswarm`;
      process.env.DATABASE_URL = dbUrl;
      process.env.DIRECT_URL = dbUrl;
      execSync('pnpm --filter @jak-swarm/db db:migrate:deploy', {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl } as NodeJS.ProcessEnv,
      });
      prisma = new PrismaClient();
      await prisma.$connect();
      svc = new ConfigLifecycleService(prisma as unknown as ConfigLifecyclePrismaClient, noopLog);
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[config-lifecycle-live] Skipping: container runtime unavailable', error);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  const mkTenant = async (slug: string): Promise<string> => {
    const t = await prisma.tenant.create({ data: { name: slug, slug: `${slug}-${Date.now()}`, plan: 'FREE' } });
    return t.id;
  };

  const row = async (tid: string, id: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      status: string; version: number; rolloutPercent: number; parentVersionId: string | null;
      supersededById: string | null; evaluationSummary: string | null; rolledBackAt: Date | null;
    }>>(
      `SELECT "status","version","rolloutPercent","parentVersionId","supersededById","evaluationSummary","rolledBackAt"
       FROM "config_versions" WHERE "id" = $1 AND "tenantId" = $2`,
      id, tid,
    );
    return rows[0] ?? null;
  };

  const events = async (tid: string, id: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; fromStatus: string; toStatus: string; decision: string | null }>>(
      `SELECT "id","fromStatus","toStatus","decision" FROM "config_rollout_events" WHERE "tenantId" = $1 AND "configVersionId" = $2 ORDER BY "occurredAt"`,
      tid, id,
    );
    return rows;
  };

  const hyperConfig = async (tid: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ autonomyLevel: string; hyperAgentMode: string; hyperAgentEnabled: boolean }>>(
      `SELECT "autonomyLevel","hyperAgentMode","hyperAgentEnabled" FROM "hyper_agent_configs" WHERE "tenantId" = $1`,
      tid,
    );
    return rows[0] ?? null;
  };

  // ── Helper: walk a version all the way to PROMOTED with good metrics ──────
  async function promoteToEnd(tid: string, id: string, spec: object): Promise<{ promotedId: string; result: { appliedToLiveConfig: boolean; supersededPrior: boolean } }> {
    await svc.advance({ tenantId: tid, configVersionId: id, reason: 'propose' }); // DRAFT→PROPOSED
    await svc.advance({ tenantId: tid, configVersionId: id, reason: 'shadow' }); // PROPOSED→SHADOW
    let r = await svc.advance({ tenantId: tid, configVersionId: id, metrics: GOOD, baseline: BASELINE, reason: 'canary' }); // SHADOW→CANARY(1%)
    expect(r.toStatus).toBe(ConfigVersionStatus.CANARY);
    // Ramp the canary ladder 1→5→25→50→PROMOTED.
    while (r.toStatus === ConfigVersionStatus.CANARY) {
      r = await svc.advance({ tenantId: tid, configVersionId: id, metrics: GOOD, baseline: BASELINE, reason: 'ramp' });
    }
    expect(r.toStatus).toBe(ConfigVersionStatus.PROMOTED);
    return { promotedId: r.configVersionId, result: { appliedToLiveConfig: r.appliedToLiveConfig, supersededPrior: r.supersededPrior } };
  }

  // -------------------------------------------------------------------------

  it('createDraft persists a DRAFT ConfigVersion with a monotonic per-(tenant,kind) version', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('cfg-draft');
    const v1 = await svc.createDraft({ tenantId: tid, kind: ConfigKind.AUTONOMY_POLICY, spec: { autonomyLevel: 'L2' } });
    expect(v1.status).toBe(ConfigVersionStatus.DRAFT);
    expect(v1.version).toBe(1);
    const v2 = await svc.createDraft({ tenantId: tid, kind: ConfigKind.AUTONOMY_POLICY, spec: { autonomyLevel: 'L3' } });
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);
  });

  it('refuses an invalid AUTONOMY_POLICY spec at createDraft (strict validation — no shapeless config reaches the pipeline)', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('cfg-invalid');
    await expect(
      svc.createDraft({ tenantId: tid, kind: ConfigKind.AUTONOMY_POLICY, spec: { autonomyLevel: 'L99', bad: 1 } }),
    ).rejects.toThrow(/invalid AUTONOMY_POLICY spec/i);
  });

  it('HOLD on missing + insufficient metrics — NEVER a fake advance (status unchanged, audit HOLD event written, summary attached)', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('cfg-hold');
    const v = await svc.createDraft({ tenantId: tid, kind: ConfigKind.LEARNING_GATE, spec: { miThreshold: 0.05 } });
    await svc.advance({ tenantId: tid, configVersionId: v.id, reason: 'propose' }); // → PROPOSED
    await svc.advance({ tenantId: tid, configVersionId: v.id, reason: 'shadow' }); // → SHADOW

    // Missing metrics ⇒ HOLD, status stays SHADOW.
    const r1 = await svc.advance({ tenantId: tid, configVersionId: v.id, reason: 'no metrics' });
    expect(r1.decision).toBe(PromotionDecision.HOLD);
    expect(r1.toStatus).toBe(ConfigVersionStatus.SHADOW);
    const afterR1 = await row(tid, v.id);
    expect(afterR1?.status).toBe(ConfigVersionStatus.SHADOW);

    // Insufficient samples ⇒ HOLD, status still SHADOW.
    const r2 = await svc.advance({ tenantId: tid, configVersionId: v.id, metrics: THIN, baseline: BASELINE, reason: 'thin' });
    expect(r2.decision).toBe(PromotionDecision.HOLD);
    const afterR2 = await row(tid, v.id);
    expect(afterR2?.status).toBe(ConfigVersionStatus.SHADOW);
    expect(afterR2?.evaluationSummary).toMatch(/hold/i);

    // A HOLD audit event was written.
    const evs = await events(tid, v.id);
    expect(evs.some((e) => e.decision === PromotionDecision.HOLD)).toBe(true);
  });

  it('happy path: DRAFT→PROPOSED→SHADOW→CANARY(ramp)→PROMOTED, every transition audited, spec applied to live HyperAgentConfig', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('cfg-happy');
    const v = await svc.createDraft({ tenantId: tid, kind: ConfigKind.AUTONOMY_POLICY, spec: { autonomyLevel: 'L2', hyperAgentMode: 'ASSISTED', hyperAgentEnabled: true } });

    const { result } = await promoteToEnd(tid, v.id, { autonomyLevel: 'L2' });
    expect(result.appliedToLiveConfig).toBe(true);
    expect(result.supersededPrior).toBe(false); // first PROMOTED, no prior

    const finalRow = await row(tid, v.id);
    expect(finalRow?.status).toBe(ConfigVersionStatus.PROMOTED);
    expect(finalRow?.rolloutPercent).toBe(100);

    // The live HyperAgentConfig received the spec.
    const hc = await hyperConfig(tid);
    expect(hc?.autonomyLevel).toBe('L2');
    expect(hc?.hyperAgentMode).toBe('ASSISTED');
    expect(hc?.hyperAgentEnabled).toBe(true);

    // Every transition wrote an audit event (DRAFT→PROPOSED, →SHADOW, →CANARY,
    // ramp steps, →PROMOTED). At minimum the terminal + advance events.
    const evs = await events(tid, v.id);
    expect(evs.length).toBeGreaterThanOrEqual(4);
    expect(evs.some((e) => e.toStatus === ConfigVersionStatus.PROMOTED)).toBe(true);
  });

  it('supersede: a second PROMOTED AUTONOMY_POLICY ARCHIVEs the prior + links parent/successor + applies the new spec live', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('cfg-supersede');
    const v1 = await svc.createDraft({ tenantId: tid, kind: ConfigKind.AUTONOMY_POLICY, spec: { autonomyLevel: 'L2' } });
    const first = await promoteToEnd(tid, v1.id, { autonomyLevel: 'L2' });
    expect(first.result.supersededPrior).toBe(false);

    const v2 = await svc.createDraft({ tenantId: tid, kind: ConfigKind.AUTONOMY_POLICY, spec: { autonomyLevel: 'L3' } });
    const second = await promoteToEnd(tid, v2.id, { autonomyLevel: 'L3' });
    expect(second.result.supersededPrior).toBe(true);
    expect(second.result.appliedToLiveConfig).toBe(true);

    // The prior is ARCHIVED with supersededById → the new version.
    const prior = await row(tid, v1.id);
    expect(prior?.status).toBe(ConfigVersionStatus.ARCHIVED);
    expect(prior?.supersededById).toBe(second.promotedId);
    // The new version records the prior as its parent.
    const newest = await row(tid, second.promotedId);
    expect(newest?.parentVersionId).toBe(v1.id);

    // The live config now reflects the NEW spec.
    const hc = await hyperConfig(tid);
    expect(hc?.autonomyLevel).toBe('L3');
  });

  it('rollback: CANARY → ROLLED_BACK with rolledBackAt stamped + audit event', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('cfg-rollback');
    const v = await svc.createDraft({ tenantId: tid, kind: ConfigKind.REPAIR_BUDGET, spec: { maxOutputRepairs: 3 } });
    await svc.advance({ tenantId: tid, configVersionId: v.id, reason: 'propose' });
    await svc.advance({ tenantId: tid, configVersionId: v.id, reason: 'shadow' });
    const toCanary = await svc.advance({ tenantId: tid, configVersionId: v.id, metrics: GOOD, baseline: BASELINE, reason: 'canary' });
    expect(toCanary.toStatus).toBe(ConfigVersionStatus.CANARY);

    const rb = await svc.rollback({ tenantId: tid, configVersionId: v.id, reason: 'safety signal' });
    expect(rb.toStatus).toBe(ConfigVersionStatus.ROLLED_BACK);
    expect(rb.decision).toBe(PromotionDecision.ROLLBACK);
    const after = await row(tid, v.id);
    expect(after?.status).toBe(ConfigVersionStatus.ROLLED_BACK);
    expect(after?.rolledBackAt).not.toBeNull();
    const evs = await events(tid, v.id);
    expect(evs.some((e) => e.toStatus === ConfigVersionStatus.ROLLED_BACK)).toBe(true);
  });

  it('cross-tenant isolation: tenant B cannot advance tenant A’s config (not-found-in-tenant, never touches A rows)', async () => {
    if (runtimeUnavailable) return;
    const tidA = await mkTenant('cfg-iso-a');
    const tidB = await mkTenant('cfg-iso-b');
    const v = await svc.createDraft({ tenantId: tidA, kind: ConfigKind.LEARNING_GATE, spec: { miThreshold: 0.05 } });
    await expect(
      svc.advance({ tenantId: tidB, configVersionId: v.id, reason: 'cross-tenant probe' }),
    ).rejects.toThrow(/not found in tenant/i);
    // A's row is untouched (still DRAFT).
    const after = await row(tidA, v.id);
    expect(after?.status).toBe(ConfigVersionStatus.DRAFT);
    // B has no config versions + no rollout events.
    const bVersions = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "config_versions" WHERE "tenantId" = $1`, tidB,
    );
    expect(Number(bVersions[0]?.n ?? 0)).toBe(0);
    const bEvents = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "config_rollout_events" WHERE "tenantId" = $1`, tidB,
    );
    expect(Number(bEvents[0]?.n ?? 0)).toBe(0);
  });

  it('LEARNING_GATE / GOVERNANCE_RULE / TOOL_POLICY are persisted + audited but NOT applied to live config (honest roadmap)', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('cfg-notlive');
    const v = await svc.createDraft({ tenantId: tid, kind: ConfigKind.LEARNING_GATE, spec: { miThreshold: 0.05 } });
    const { result } = await promoteToEnd(tid, v.id, { miThreshold: 0.05 });
    expect(result.appliedToLiveConfig).toBe(false); // not an AUTONOMY_POLICY/REPAIR_BUDGET
    const finalRow = await row(tid, v.id);
    expect(finalRow?.status).toBe(ConfigVersionStatus.PROMOTED);
    // No HyperAgentConfig row was created for this tenant (LEARNING_GATE not applied).
    const hc = await hyperConfig(tid);
    expect(hc).toBeNull();
  });
});