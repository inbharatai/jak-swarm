import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import type {
  Workflow,
  AgentTrace,
  TraceStep,
  ApprovalRequest,
  WorkflowStatus,
  PaginatedResult,
  ApprovalDecision,
} from '../types.js';
import {
  NotFoundError,
  WorkflowStateError,
  ForbiddenError,
} from '../errors.js';
import { assertTransition } from '@jak-swarm/swarm';
import { WorkflowStatus as SharedWorkflowStatus } from '@jak-swarm/shared';

const TERMINAL_STATUSES: WorkflowStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Phase 5 — local API status strings ↔ shared enum mapping.
 * Two of the API-local strings don't have a direct shared-enum twin:
 *   - 'RUNNING' is the API's umbrella for the executing phase (maps to EXECUTING).
 *   - 'PAUSED' covers anything in approval/wait (maps to AWAITING_APPROVAL).
 * Any unknown string falls back to PENDING and triggers a log-only warning
 * in assertTransition (since PENDING → unknown isn't in the table).
 */
function toSharedStatus(s: string | null | undefined): SharedWorkflowStatus {
  switch ((s ?? '').toUpperCase()) {
    case 'PENDING': return SharedWorkflowStatus.PENDING;
    case 'PLANNING': return SharedWorkflowStatus.PLANNING;
    case 'ROUTING': return SharedWorkflowStatus.ROUTING;
    case 'EXECUTING':
    case 'RUNNING': return SharedWorkflowStatus.EXECUTING;
    case 'PAUSED':
    case 'AWAITING_APPROVAL': return SharedWorkflowStatus.AWAITING_APPROVAL;
    case 'VERIFYING': return SharedWorkflowStatus.VERIFYING;
    case 'COMPLETED': return SharedWorkflowStatus.COMPLETED;
    case 'FAILED': return SharedWorkflowStatus.FAILED;
    case 'CANCELLED': return SharedWorkflowStatus.CANCELLED;
    case 'ROLLED_BACK': return SharedWorkflowStatus.ROLLED_BACK;
    default: return SharedWorkflowStatus.PENDING;
  }
}

export interface ListWorkflowsOptions {
  page: number;
  limit: number;
  status?: WorkflowStatus | WorkflowStatus[];
}

export interface SaveTraceInput {
  workflowId: string;
  tenantId: string;
  traceId: string;
  runId: string;
  agentRole: string;
  stepIndex: number;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  inputJson?: Record<string, unknown>;
  outputJson?: Record<string, unknown>;
  toolCallsJson?: Record<string, unknown>;
  handoffsJson?: Record<string, unknown>;
  tokenUsage?: Record<string, unknown>;
  error?: string;
}

export interface CreateApprovalInput {
  workflowId: string;
  tenantId: string;
  taskId: string;
  agentRole: string;
  action: string;
  rationale: string;
  proposedDataJson?: Record<string, unknown>;
  riskLevel: string;
}

export class WorkflowService {
  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Create a new workflow record in PENDING state.
   */
  async createWorkflow(
    tenantId: string,
    userId: string,
    goal: string,
    industry?: string,
  ): Promise<Workflow> {
    const workflow = await this.db.workflow.create({
      data: {
        tenantId,
        userId,
        goal,
        industry: industry ?? null,
        status: 'PENDING',
      },
    });

    this.log.info({ workflowId: workflow.id, tenantId }, 'Workflow created');

    return this.mapWorkflow(workflow);
  }

  /**
   * Fetch a single workflow with tenant ownership check.
   */
  async getWorkflow(tenantId: string, workflowId: string): Promise<Workflow> {
    const workflow = await this.db.workflow.findUnique({
      where: { id: workflowId },
    });

    if (!workflow) {
      throw new NotFoundError('Workflow', workflowId);
    }

    if (workflow.tenantId !== tenantId) {
      throw new ForbiddenError('Access to workflow in another tenant is not allowed');
    }

    return this.mapWorkflow(workflow);
  }

  /**
   * Return a paginated list of workflows for a tenant.
   */
  async listWorkflows(
    tenantId: string,
    options: ListWorkflowsOptions,
  ): Promise<PaginatedResult<Workflow>> {
    const { page, limit, status } = options;
    const skip = (page - 1) * limit;
    const statuses = Array.isArray(status) ? status : status ? [status] : undefined;

    const where = {
      tenantId,
      ...(statuses?.length ? { status: { in: statuses } } : {}),
    };

    const [total, rows] = await Promise.all([
      this.db.workflow.count({ where }),
      this.db.workflow.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
        // Include trace count so the Runs inspector can show
        // "N agent traces" without a per-workflow N+1 fetch.
        // QA fix: the list view used to show "0 agent traces" on every
        // row because traces weren't in the query.
        include: {
          _count: { select: { traces: true } },
        },
      }),
    ]);

    return {
      items: rows.map(this.mapWorkflow),
      total,
      page,
      limit,
      hasMore: skip + rows.length < total,
    };
  }

  /**
   * Cancel a workflow — only allowed when not already in a terminal state.
   */
  async cancelWorkflow(tenantId: string, workflowId: string): Promise<Workflow> {
    const existing = await this.getWorkflow(tenantId, workflowId);

    if (TERMINAL_STATUSES.includes(existing.status)) {
      throw new WorkflowStateError(
        `Cannot cancel workflow with status '${existing.status}'`,
      );
    }

    const updated = await this.db.workflow.update({
      where: { id: workflowId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    this.log.info({ workflowId }, 'Workflow cancelled');
    return this.mapWorkflow(updated);
  }

  /**
   * Internal status update used by the Temporal worker callbacks.
   */
  async updateWorkflowStatus(
    workflowId: string,
    status: WorkflowStatus,
    error?: string,
  ): Promise<Workflow> {
    // Phase 5 — single chokepoint for workflow status writes. Read the
    // current status first, validate the transition against the canonical
    // run-lifecycle state machine, then write. assertTransition is
    // log-only in Phase 5 (does NOT throw) so any drift surfaces in
    // production logs without breaking in-flight workflows.
    try {
      const current = await this.db.workflow.findUnique({
        where: { id: workflowId },
        select: { status: true },
      });
      if (current?.status) {
        assertTransition(
          toSharedStatus(current.status),
          toSharedStatus(status),
          {
            workflowId,
            logger: this.log,
            reason: error ? `error: ${error.slice(0, 80)}` : 'updateWorkflowStatus',
          },
        );
      }
    } catch (lifecycleErr) {
      // Lifecycle assertion must NEVER prevent a status write — we'd risk
      // leaving workflows orphaned on the slightest enum drift.
      this.log.warn(
        { workflowId, err: lifecycleErr instanceof Error ? lifecycleErr.message : String(lifecycleErr) },
        '[run-lifecycle] assertion threw unexpectedly — proceeding with status write',
      );
    }

    const data: Record<string, unknown> = { status };

    if (status === 'RUNNING') {
      data['startedAt'] = new Date();
    }

    if (TERMINAL_STATUSES.includes(status)) {
      data['completedAt'] = new Date();
    }

    if (error) {
      data['error'] = error;
    }

    const updated = await this.db.workflow.update({
      where: { id: workflowId },
      data,
    });

    this.log.info({ workflowId, status }, 'Workflow status updated');
    return this.mapWorkflow(updated);
  }

  /**
   * Persist an agent trace from a workflow execution.
   */
  async saveTrace(input: SaveTraceInput): Promise<AgentTrace> {
    const trace = await this.db.agentTrace.create({
      data: {
        workflowId: input.workflowId,
        tenantId: input.tenantId,
        traceId: input.traceId,
        runId: input.runId,
        agentRole: input.agentRole,
        stepIndex: input.stepIndex,
        startedAt: input.startedAt,
        completedAt: input.completedAt ?? null,
        durationMs: input.durationMs ?? null,
        inputJson: input.inputJson ? (input.inputJson as object) : undefined,
        outputJson: input.outputJson ? (input.outputJson as object) : undefined,
        toolCallsJson: input.toolCallsJson ? (input.toolCallsJson as object) : undefined,
        handoffsJson: input.handoffsJson ? (input.handoffsJson as object) : undefined,
        tokenUsage: input.tokenUsage ? (input.tokenUsage as object) : undefined,
        error: input.error ?? null,
      },
    });

    return this.mapTrace(trace);
  }

  /**
   * Create a human-in-the-loop approval request.
   */
  async createApprovalRequest(input: CreateApprovalInput): Promise<ApprovalRequest> {
    const approval = await this.db.approvalRequest.create({
      data: {
        workflowId: input.workflowId,
        tenantId: input.tenantId,
        taskId: input.taskId,
        agentRole: input.agentRole,
        action: input.action,
        rationale: input.rationale,
        proposedDataJson: input.proposedDataJson ? (input.proposedDataJson as object) : undefined,
        riskLevel: input.riskLevel,
        status: 'PENDING',
      },
    });

    this.log.info(
      { approvalId: approval.id, workflowId: input.workflowId },
      'Approval request created',
    );

    return this.mapApproval(approval);
  }

  /**
   * Resolve an approval with a decision.
   */
  async resolveApproval(
    tenantId: string,
    approvalId: string,
    decision: ApprovalDecision,
    reviewedBy: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    const existing = await this.db.approvalRequest.findUnique({
      where: { id: approvalId },
    });

    if (!existing) {
      throw new NotFoundError('ApprovalRequest', approvalId);
    }

    if (existing.tenantId !== tenantId) {
      throw new ForbiddenError('Access to approval request in another tenant is not allowed');
    }

    if (existing.status !== 'PENDING') {
      throw new WorkflowStateError(
        `Cannot decide approval with status '${existing.status}'`,
      );
    }

    const updated = await this.db.approvalRequest.update({
      where: { id: approvalId },
      data: {
        status: decision,
        reviewedBy,
        comment: comment ?? null,
        reviewedAt: new Date(),
      },
    });

    this.log.info({ approvalId, decision, reviewedBy }, 'Approval resolved');
    return this.mapApproval(updated);
  }

  /**
   * List agent traces for a workflow, with optional tenant check.
   */
  async getWorkflowTraces(tenantId: string, workflowId: string): Promise<AgentTrace[]> {
    const traces = await this.db.agentTrace.findMany({
      where: { workflowId, tenantId },
      orderBy: { startedAt: 'desc' },
    });

    return traces.map(this.mapTrace);
  }

  /**
   * List approval requests for a workflow.
   */
  async getWorkflowApprovals(tenantId: string, workflowId: string): Promise<ApprovalRequest[]> {
    const approvals = await this.db.approvalRequest.findMany({
      where: { workflowId, tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return approvals.map(this.mapApproval);
  }

  // ---------------------------------------------------------------------------
  // Private mapping helpers
  // ---------------------------------------------------------------------------

  private mapWorkflow = (row: Record<string, unknown>): Workflow => {
    // `_count` is populated only when listWorkflows() is used (via the
    // Prisma include). Detail queries currently don't populate it, so the
    // frontend should treat `traceCount` as optional.
    const count = row['_count'] as { traces?: number } | undefined;
    return {
      id: row['id'] as string,
      tenantId: row['tenantId'] as string,
      createdBy: (row['userId'] as string) ?? '',
      goal: row['goal'] as string,
      industry: (row['industry'] as string | null) ?? null,
      status: row['status'] as WorkflowStatus,
      result: null,
      finalOutput: (row['finalOutput'] as string | null) ?? null,
      error: (row['error'] as string | null) ?? null,
      startedAt: (row['startedAt'] as Date | null) ?? null,
      completedAt: (row['completedAt'] as Date | null) ?? null,
      createdAt: (row['startedAt'] as Date) ?? new Date(),
      updatedAt: row['updatedAt'] as Date,
      traceCount: typeof count?.traces === 'number' ? count.traces : undefined,
    };
  };

  private mapTrace = (row: Record<string, unknown>): AgentTrace => {
    const input = (row['inputJson'] ?? null) as Record<string, unknown> | null;
    const output = (row['outputJson'] ?? null) as Record<string, unknown> | null;
    const toolCalls = (row['toolCallsJson'] ?? null) as Record<string, unknown> | null;
    const tokenUsage = (row['tokenUsage'] ?? null) as Record<string, unknown> | null;
    const err = (row['error'] as string | null) ?? null;
    const stepIndex = typeof row['stepIndex'] === 'number' ? (row['stepIndex'] as number) : 0;
    const durationMs = typeof row['durationMs'] === 'number' ? (row['durationMs'] as number) : 0;
    const costUsd = typeof row['costUsd'] === 'number' ? (row['costUsd'] as number) : null;

    // Each DB row is one agent execution — represent as a single TraceStep
    // for API-contract backward compatibility, but also surface the fields
    // directly at the trace level so callers don't have to dig into steps[0].
    const step: TraceStep = {
      id: row['id'] as string,
      traceId: (row['traceId'] as string) ?? (row['id'] as string),
      seq: stepIndex,
      agentRole: row['agentRole'] as string,
      action: 'execute',
      input: input ?? {},
      output,
      durationMs,
      error: err,
      createdAt: (row['startedAt'] as Date) ?? new Date(),
    };

    return {
      id: row['id'] as string,
      workflowId: row['workflowId'] as string,
      tenantId: row['tenantId'] as string,
      agentRole: row['agentRole'] as string,
      status: err ? 'FAILED' : 'COMPLETED',
      steps: [step],
      startedAt: row['startedAt'] as Date,
      completedAt: (row['completedAt'] as Date | null) ?? null,
      createdAt: (row['startedAt'] as Date) ?? new Date(),
      stepIndex,
      durationMs,
      input,
      output,
      toolCalls,
      tokenUsage,
      costUsd,
      error: err,
    };
  };

  private mapApproval = (row: Record<string, unknown>): ApprovalRequest => ({
    id: row['id'] as string,
    workflowId: row['workflowId'] as string,
    tenantId: row['tenantId'] as string,
    taskId: row['taskId'] as string,
    agentRole: row['agentRole'] as string,
    requestedBy: '',
    reviewedBy: (row['reviewedBy'] as string | null) ?? null,
    action: row['action'] as string,
    context: {},
    riskLevel: row['riskLevel'] as ApprovalRequest['riskLevel'],
    status: row['status'] as ApprovalRequest['status'],
    decision: null,
    comment: (row['comment'] as string | null) ?? null,
    expiresAt: null,
    decidedAt: (row['reviewedAt'] as Date | null) ?? null,
    createdAt: row['createdAt'] as Date,
    updatedAt: row['updatedAt'] as Date,
  });
}
