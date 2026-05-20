/**
 * Company Operating Layer tests — Migration 107.
 *
 * These protect the YC closed-loop core from becoming "dashboard-only":
 * drift detection must compare customer/decision intent against execution
 * evidence deterministically, without LLM fallback or marketing claims.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDriftCandidates,
  driftFingerprint,
  jsonStringArray,
  sha256,
  CompanyOperatingLayerService,
  type AgentExecutableSpecRow,
  type CompanyArtifactRow,
  type CompanyGraphEntityRow,
  type ExecutionDriftFindingRow,
} from '../../../apps/api/src/services/company-brain/company-operating-layer.service.js';

const now = new Date('2026-05-19T12:00:00.000Z');

function entity(overrides: Partial<CompanyGraphEntityRow> & { id: string; entityType: string; title: string }): CompanyGraphEntityRow {
  return {
    id: overrides.id,
    tenantId: overrides.tenantId ?? 'tenant_1',
    primaryArtifactId: overrides.primaryArtifactId ?? null,
    entityType: overrides.entityType,
    title: overrides.title,
    summary: overrides.summary ?? `${overrides.title} summary`,
    status: overrides.status ?? 'active',
    ownerName: overrides.ownerName ?? null,
    priority: overrides.priority ?? null,
    confidence: overrides.confidence ?? 0.8,
    occurredAt: overrides.occurredAt ?? null,
    dueAt: overrides.dueAt ?? null,
    sourceArtifactIds: overrides.sourceArtifactIds ?? ['artifact_1'],
    relatedEntityIds: overrides.relatedEntityIds ?? [],
    properties: overrides.properties ?? {},
    extractedBy: overrides.extractedBy ?? 'manual',
    createdBy: overrides.createdBy ?? 'user_1',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt ?? null,
  };
}

describe('Company Operating Layer pure helpers', () => {
  it('hashes artifact bodies deterministically', () => {
    expect(sha256('same evidence')).toBe(sha256('same evidence'));
    expect(sha256('same evidence')).not.toBe(sha256('different evidence'));
  });

  it('only accepts string arrays from JSON-ish values', () => {
    expect(jsonStringArray(['a', 42, '', 'b', null])).toEqual(['a', 'b']);
    expect(jsonStringArray({ a: 'b' })).toEqual([]);
  });

  it('builds a stable fingerprint independent of evidence id ordering', () => {
    expect(driftFingerprint('t1', 'customer_signal_unaddressed', ['b', 'a'])).toBe(
      driftFingerprint('t1', 'customer_signal_unaddressed', ['a', 'b']),
    );
  });
});

describe('buildDriftCandidates', () => {
  it('flags high-priority customer signals with no linked task/spec/code', () => {
    const findings = buildDriftCandidates({
      tenantId: 'tenant_1',
      now,
      entities: [
        entity({
          id: 'signal_1',
          entityType: 'customer_signal',
          title: 'Customers cannot finish onboarding',
          priority: 'high',
          sourceArtifactIds: ['call_1'],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.driftType).toBe('customer_signal_unaddressed');
    expect(findings[0]?.severity).toBe('high');
    expect(findings[0]?.evidenceArtifactIds).toEqual(['call_1']);
  });

  it('does not flag a customer signal when execution is linked by relatedEntityIds', () => {
    const findings = buildDriftCandidates({
      tenantId: 'tenant_1',
      now,
      entities: [
        entity({
          id: 'signal_1',
          entityType: 'customer_signal',
          title: 'Customers need import from CSV',
          priority: 'high',
          sourceArtifactIds: ['call_1'],
          relatedEntityIds: ['task_1'],
        }),
        entity({
          id: 'task_1',
          entityType: 'task',
          title: 'Build CSV importer',
          sourceArtifactIds: ['ticket_1'],
        }),
      ],
    });

    expect(findings.filter((f) => f.driftType === 'customer_signal_unaddressed')).toHaveLength(0);
  });

  it('treats completed linked execution as evidence that a customer signal was addressed', () => {
    const findings = buildDriftCandidates({
      tenantId: 'tenant_1',
      now,
      entities: [
        entity({
          id: 'signal_1',
          entityType: 'customer_signal',
          title: 'Customers need import from CSV',
          priority: 'high',
          sourceArtifactIds: ['call_1'],
          relatedEntityIds: ['task_1'],
        }),
        entity({
          id: 'task_1',
          entityType: 'task',
          title: 'Build CSV importer',
          status: 'completed',
          sourceArtifactIds: ['ticket_1'],
        }),
      ],
    });

    expect(findings.filter((f) => f.driftType === 'customer_signal_unaddressed')).toHaveLength(0);
  });

  it('flags decisions that never became execution work', () => {
    const findings = buildDriftCandidates({
      tenantId: 'tenant_1',
      now,
      entities: [
        entity({
          id: 'decision_1',
          entityType: 'decision',
          title: 'Founder decided to focus on engineering/product alignment',
          priority: 'critical',
          sourceArtifactIds: ['meeting_1'],
        }),
      ],
    });

    expect(findings.some((f) => f.driftType === 'decision_not_operationalized' && f.severity === 'critical')).toBe(true);
  });

  it('flags execution work that has no visible customer, decision, or spec rationale', () => {
    const findings = buildDriftCandidates({
      tenantId: 'tenant_1',
      now,
      entities: [
        entity({
          id: 'code_1',
          entityType: 'code_change',
          title: 'Refactor billing page colors',
          sourceArtifactIds: ['commit_1'],
        }),
      ],
    });

    expect(findings.some((f) => f.driftType === 'ungrounded_execution')).toBe(true);
  });

  it('does not flag grounded execution work when it shares evidence with a decision', () => {
    const findings = buildDriftCandidates({
      tenantId: 'tenant_1',
      now,
      entities: [
        entity({
          id: 'decision_1',
          entityType: 'decision',
          title: 'Fix billing trust issue',
          sourceArtifactIds: ['meeting_1'],
        }),
        entity({
          id: 'task_1',
          entityType: 'task',
          title: 'Add billing audit trail',
          sourceArtifactIds: ['meeting_1'],
        }),
      ],
    });

    expect(findings.filter((f) => f.driftType === 'ungrounded_execution')).toHaveLength(0);
    expect(findings.filter((f) => f.driftType === 'decision_not_operationalized')).toHaveLength(0);
  });

  it('uses primaryArtifactId as evidence when matching entities', () => {
    const findings = buildDriftCandidates({
      tenantId: 'tenant_1',
      now,
      entities: [
        entity({
          id: 'decision_1',
          entityType: 'decision',
          title: 'Fix billing trust issue',
          primaryArtifactId: 'meeting_1',
          sourceArtifactIds: [],
        }),
        entity({
          id: 'task_1',
          entityType: 'task',
          title: 'Add billing audit trail',
          primaryArtifactId: 'meeting_1',
          sourceArtifactIds: [],
        }),
      ],
    });

    expect(findings.filter((f) => f.driftType === 'ungrounded_execution')).toHaveLength(0);
    expect(findings.filter((f) => f.driftType === 'decision_not_operationalized')).toHaveLength(0);
  });

  it('flags overdue high-priority tasks as execution drift', () => {
    const findings = buildDriftCandidates({
      tenantId: 'tenant_1',
      now,
      entities: [
        entity({
          id: 'task_1',
          entityType: 'task',
          title: 'Ship approval gate hardening',
          priority: 'high',
          dueAt: new Date('2026-05-18T12:00:00.000Z'),
          sourceArtifactIds: ['ticket_1'],
        }),
      ],
    });

    expect(findings.some((f) => f.driftType === 'stale_high_priority_task' && f.severity === 'high')).toBe(true);
  });
});

interface FakeState {
  artifacts: CompanyArtifactRow[];
  entities: CompanyGraphEntityRow[];
  findings: ExecutionDriftFindingRow[];
  specs: AgentExecutableSpecRow[];
  audits: Array<Record<string, unknown>>;
}

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) continue;
    if (expected && typeof expected === 'object' && 'in' in expected) {
      const values = (expected as { in: unknown[] }).in;
      if (!values.includes(row[key])) return false;
      continue;
    }
    if (row[key] !== expected) return false;
  }
  return true;
}

function makeFakeDb() {
  let counter = 0;
  const state: FakeState = { artifacts: [], entities: [], findings: [], specs: [], audits: [] };
  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  const db = {
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        state.audits.push(args.data);
        return { id: nextId('audit') };
      },
    },
    companyArtifact: {
      create: async (args: { data: Partial<CompanyArtifactRow> & { tenantId: string; sourceType: string; artifactType: string; title: string; body: string; bodyHash: string } }) => {
        const row: CompanyArtifactRow = {
          id: nextId('artifact'),
          externalId: null,
          sourceUrl: null,
          authorName: null,
          occurredAt: null,
          metadata: {},
          ingestionStatus: 'ingested',
          extractedAt: null,
          createdBy: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...args.data,
        };
        state.artifacts.push(row);
        return row;
      },
      upsert: async (args: {
        where: { tenantId_sourceType_externalId: { tenantId: string; sourceType: string; externalId: string } };
        create: Partial<CompanyArtifactRow> & { tenantId: string; sourceType: string; artifactType: string; title: string; body: string; bodyHash: string };
        update: Partial<CompanyArtifactRow>;
      }) => {
        const key = args.where.tenantId_sourceType_externalId;
        const existing = state.artifacts.find((a) => a.tenantId === key.tenantId && a.sourceType === key.sourceType && a.externalId === key.externalId);
        if (existing) {
          Object.assign(existing, args.update, { updatedAt: now });
          return existing;
        }
        return db.companyArtifact.create({ data: args.create });
      },
      findMany: async (args: { where?: Record<string, unknown>; take?: number; skip?: number }) =>
        state.artifacts
          .filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {}))
          .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? state.artifacts.length)),
      findFirst: async (args: { where?: Record<string, unknown> }) =>
        state.artifacts.find((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {})) ?? null,
      update: async (args: { where: { id: string }; data: Partial<CompanyArtifactRow> }) => {
        const row = state.artifacts.find((a) => a.id === args.where.id);
        if (!row) throw new Error('artifact not found');
        Object.assign(row, args.data, { updatedAt: now });
        return row;
      },
      updateMany: async () => ({ count: 0 }),
      count: async (args: { where?: Record<string, unknown> }) =>
        state.artifacts.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {})).length,
    },
    companyGraphEntity: {
      create: async (args: { data: Partial<CompanyGraphEntityRow> & { tenantId: string; entityType: string; title: string; summary: string } }) => {
        const row: CompanyGraphEntityRow = {
          id: nextId('entity'),
          primaryArtifactId: null,
          status: 'active',
          ownerName: null,
          priority: null,
          confidence: 0.75,
          occurredAt: null,
          dueAt: null,
          sourceArtifactIds: [],
          relatedEntityIds: [],
          properties: {},
          extractedBy: 'manual',
          createdBy: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...args.data,
        };
        state.entities.push(row);
        return row;
      },
      createMany: async () => ({ count: 0 }),
      findMany: async (args: { where?: Record<string, unknown>; take?: number; skip?: number }) =>
        state.entities
          .filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {}))
          .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? state.entities.length)),
      findFirst: async (args: { where?: Record<string, unknown> }) =>
        state.entities.find((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {})) ?? null,
      count: async (args: { where?: Record<string, unknown> }) =>
        state.entities.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {})).length,
    },
    executionDriftFinding: {
      upsert: async (args: {
        where: { tenantId_fingerprint: { tenantId: string; fingerprint: string } };
        create: Partial<ExecutionDriftFindingRow> & { tenantId: string; fingerprint: string; driftType: string; severity: string; title: string; summary: string; recommendation: string };
        update: Partial<ExecutionDriftFindingRow>;
      }) => {
        const key = args.where.tenantId_fingerprint;
        const existing = state.findings.find((f) => f.tenantId === key.tenantId && f.fingerprint === key.fingerprint);
        if (existing) {
          Object.assign(existing, args.update, { updatedAt: now });
          return existing;
        }
        const row: ExecutionDriftFindingRow = {
          id: nextId('finding'),
          status: 'open',
          evidenceArtifactIds: [],
          evidenceEntityIds: [],
          confidence: 0.7,
          detectedAt: now,
          resolvedAt: null,
          metadata: {},
          createdAt: now,
          updatedAt: now,
          ...args.create,
        };
        state.findings.push(row);
        return row;
      },
      findMany: async (args: { where?: Record<string, unknown>; take?: number; skip?: number }) =>
        state.findings
          .filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {}))
          .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? state.findings.length)),
      findFirst: async (args: { where?: Record<string, unknown> }) =>
        state.findings.find((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {})) ?? null,
      count: async (args: { where?: Record<string, unknown> }) =>
        state.findings.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {})).length,
    },
    agentExecutableSpec: {
      create: async (args: { data: Partial<AgentExecutableSpecRow> & { tenantId: string; title: string; problemStatement: string; objective: string; contextSummary: string; proposedApproach: string } }) => {
        const row: AgentExecutableSpecRow = {
          id: nextId('spec'),
          driftFindingId: null,
          acceptanceCriteria: [],
          testPlan: [],
          agentTaskPlan: [],
          approvalGates: [],
          evidenceArtifactIds: [],
          evidenceEntityIds: [],
          status: 'draft',
          generatedBy: 'openai',
          reviewedBy: null,
          reviewedAt: null,
          reviewComment: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...args.data,
        };
        state.specs.push(row);
        return row;
      },
      findMany: async (args: { where?: Record<string, unknown>; take?: number; skip?: number }) =>
        state.specs
          .filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {}))
          .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? state.specs.length)),
      findFirst: async (args: { where?: Record<string, unknown> }) =>
        state.specs.find((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {})) ?? null,
      update: async (args: { where: { id: string }; data: Partial<AgentExecutableSpecRow> }) => {
        const row = state.specs.find((s) => s.id === args.where.id);
        if (!row) throw new Error('spec not found');
        Object.assign(row, args.data, { updatedAt: now });
        return row;
      },
      count: async (args: { where?: Record<string, unknown> }) =>
        state.specs.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where ?? {})).length,
    },
  };

  return { state, db };
}

describe('CompanyOperatingLayerService behavioral persistence', () => {
  it('persists evidence, creates cited entities, and writes drift findings', async () => {
    const { state, db } = makeFakeDb();
    const service = new CompanyOperatingLayerService(db as never);

    const artifact = await service.createArtifact({
      tenantId: 'tenant_1',
      userId: 'user_1',
      sourceType: 'manual',
      artifactType: 'customer_feedback',
      title: 'Customer calls show onboarding confusion',
      body: 'Three customer calls this week said onboarding is confusing and users cannot find the approval inbox.',
    });

    const signal = await service.createEntity({
      tenantId: 'tenant_1',
      userId: 'user_1',
      entityType: 'customer_signal',
      title: 'Users cannot find approval inbox',
      summary: 'Multiple customer calls indicate approval inbox discoverability is blocking onboarding.',
      priority: 'high',
      sourceArtifactIds: [artifact.id],
    });

    const analyzed = await service.analyzeAlignment({ tenantId: 'tenant_1', userId: 'user_1' });

    expect(state.artifacts).toHaveLength(1);
    expect(signal.sourceArtifactIds).toEqual([artifact.id]);
    expect(analyzed.findings).toHaveLength(1);
    expect(analyzed.findings[0]?.driftType).toBe('customer_signal_unaddressed');
    expect(analyzed.findings[0]?.evidenceEntityIds).toEqual([signal.id]);
  });

  it('adds primaryArtifactId to the cited sourceArtifactIds when creating an entity', async () => {
    const { db } = makeFakeDb();
    const service = new CompanyOperatingLayerService(db as never);

    const primary = await service.createArtifact({
      tenantId: 'tenant_1',
      userId: 'user_1',
      sourceType: 'manual',
      artifactType: 'decision_note',
      title: 'Founder direction',
      body: 'Founder decided that onboarding activation is the current product priority.',
    });
    const supporting = await service.createArtifact({
      tenantId: 'tenant_1',
      userId: 'user_1',
      sourceType: 'manual',
      artifactType: 'customer_feedback',
      title: 'Customer support summary',
      body: 'Customer support notes repeatedly mention confusion around onboarding activation.',
    });

    const created = await service.createEntity({
      tenantId: 'tenant_1',
      userId: 'user_1',
      entityType: 'decision',
      title: 'Prioritize onboarding activation',
      summary: 'Founder direction plus customer support evidence point to onboarding activation.',
      primaryArtifactId: primary.id,
      sourceArtifactIds: [supporting.id],
    });

    expect(created.primaryArtifactId).toBe(primary.id);
    expect(created.sourceArtifactIds).toEqual([primary.id, supporting.id].sort());
  });

  it('reopens a previously resolved drift finding when the same drift is detected again', async () => {
    const { state, db } = makeFakeDb();
    const service = new CompanyOperatingLayerService(db as never);
    const artifact = await service.createArtifact({
      tenantId: 'tenant_1',
      userId: 'user_1',
      sourceType: 'manual',
      artifactType: 'customer_feedback',
      title: 'Customer calls show activation issue',
      body: 'Customer calls show activation issue remains unresolved after the sprint planning meeting.',
    });
    await service.createEntity({
      tenantId: 'tenant_1',
      userId: 'user_1',
      entityType: 'customer_signal',
      title: 'Activation issue unresolved',
      summary: 'Customer calls show activation issue remains unresolved.',
      priority: 'high',
      sourceArtifactIds: [artifact.id],
    });

    await service.analyzeAlignment({ tenantId: 'tenant_1', userId: 'user_1' });
    state.findings[0]!.status = 'resolved';
    state.findings[0]!.resolvedAt = new Date('2026-05-19T11:00:00.000Z');

    const analyzedAgain = await service.analyzeAlignment({ tenantId: 'tenant_1', userId: 'user_1' });

    expect(analyzedAgain.findings).toHaveLength(1);
    expect(analyzedAgain.findings[0]?.status).toBe('open');
    expect(analyzedAgain.findings[0]?.resolvedAt).toBeNull();
  });

  it('approves and rejects specs through the review gate', async () => {
    const { db } = makeFakeDb();
    const service = new CompanyOperatingLayerService(db as never);
    const spec = await db.agentExecutableSpec.create({
      data: {
        tenantId: 'tenant_1',
        title: 'Fix onboarding inbox discoverability',
        problemStatement: 'Users cannot find approvals.',
        objective: 'Make approval inbox discoverable.',
        contextSummary: 'Customer evidence cited.',
        proposedApproach: 'Improve navigation and test it.',
      },
    });

    const approved = await service.decideSpec({
      tenantId: 'tenant_1',
      userId: 'reviewer_1',
      specId: spec.id,
      decision: 'APPROVED',
      comment: 'Ship behind approval gate.',
    });

    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toBe('reviewer_1');
    expect(approved.reviewComment).toBe('Ship behind approval gate.');
  });

  it('refuses to change a spec after it has already been reviewed', async () => {
    const { db } = makeFakeDb();
    const service = new CompanyOperatingLayerService(db as never);
    const spec = await db.agentExecutableSpec.create({
      data: {
        tenantId: 'tenant_1',
        title: 'Fix onboarding inbox discoverability',
        problemStatement: 'Users cannot find approvals.',
        objective: 'Make approval inbox discoverable.',
        contextSummary: 'Customer evidence cited.',
        proposedApproach: 'Improve navigation and test it.',
      },
    });

    await service.decideSpec({
      tenantId: 'tenant_1',
      userId: 'reviewer_1',
      specId: spec.id,
      decision: 'APPROVED',
    });

    await expect(service.decideSpec({
      tenantId: 'tenant_1',
      userId: 'reviewer_2',
      specId: spec.id,
      decision: 'REJECTED',
    })).rejects.toThrow(/already reviewed/);
  });

  it('fails spec generation honestly when OpenAI is not configured', async () => {
    const originalKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const { db } = makeFakeDb();
      const service = new CompanyOperatingLayerService(db as never);
      await expect(service.generateSpec({
        tenantId: 'tenant_1',
        userId: 'user_1',
        entityIds: ['entity_1'],
      })).rejects.toThrow(/OPENAI_API_KEY required/);
    } finally {
      if (originalKey !== undefined) process.env['OPENAI_API_KEY'] = originalKey;
    }
  });
});
