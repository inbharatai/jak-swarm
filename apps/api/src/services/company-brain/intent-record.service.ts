/**
 * intent-record.service — persists Commander intent classifications.
 *
 * Every workflow run that goes through Commander produces an IntentRecord.
 * This gives us:
 *   - queryable history per tenant (analytics on what users ask for)
 *   - audit trail (which intent triggered which workflow)
 *   - input for future ML on intent → template matching quality
 *
 * Tenant-scoped at every method.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { CompanyBrainSchemaUnavailableError } from './company-profile.service.js';

function rethrowIfSchemaMissing(err: unknown): never {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
    throw new CompanyBrainSchemaUnavailableError();
  }
  throw err;
}

export interface CreateIntentInput {
  tenantId: string;
  userId: string;
  workflowId?: string;
  rawInput: string;
  intent: string;  // CompanyOSIntent value
  intentConfidence?: number | null;
  subFunction?: string;
  urgency?: number;
  riskIndicators?: string[];
  requiredOutputs?: string[];
  workflowTemplateId?: string;
  clarificationNeeded?: boolean;
  clarificationQuestion?: string | null;
  directAnswer?: string | null;
}

export class IntentRecordService {
  constructor(
    private readonly db: PrismaClient,
    _log: FastifyBaseLogger,
  ) {}

  async create(input: CreateIntentInput): Promise<{ id: string; intent: string }> {
    const row = await (this.db.intentRecord.create as unknown as (a: unknown) => Promise<{ id: string; intent: string }>)({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
        rawInput: input.rawInput,
        intent: input.intent,
        ...(input.intentConfidence !== undefined ? { intentConfidence: input.intentConfidence } : {}),
        ...(input.subFunction ? { subFunction: input.subFunction } : {}),
        ...(input.urgency !== undefined ? { urgency: input.urgency } : {}),
        ...(input.riskIndicators ? { riskIndicators: input.riskIndicators } : {}),
        ...(input.requiredOutputs ? { requiredOutputs: input.requiredOutputs } : {}),
        ...(input.workflowTemplateId ? { workflowTemplateId: input.workflowTemplateId } : {}),
        clarificationNeeded: input.clarificationNeeded ?? false,
        ...(input.clarificationQuestion ? { clarificationQuestion: input.clarificationQuestion } : {}),
        ...(input.directAnswer ? { directAnswer: input.directAnswer } : {}),
      },
    }).catch((err) => rethrowIfSchemaMissing(err));
    return { id: row.id, intent: row.intent };
  }

  async list(input: {
    tenantId: string;
    intent?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: unknown[]; total: number }> {
    const where: Record<string, unknown> = { tenantId: input.tenantId };
    if (input.intent) where['intent'] = input.intent;
    if (input.userId) where['userId'] = input.userId;
    const [items, total] = await Promise.all([
      this.db.intentRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.limit ?? 50,
        skip: input.offset ?? 0,
      }),
      this.db.intentRecord.count({ where }),
    ]).catch((err) => { rethrowIfSchemaMissing(err); throw err; });
    return { items, total };
  }

  async stats(tenantId: string): Promise<Array<{ intent: string; count: number }>> {
    const rows = await (this.db.intentRecord.groupBy as unknown as (a: unknown) => Promise<Array<{ intent: string; _count: { _all: number } }>>)({
      by: ['intent'],
      where: { tenantId },
      _count: { _all: true },
    }).catch((err) => rethrowIfSchemaMissing(err));
    return rows
      .map((r) => ({ intent: r.intent, count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  }
}
