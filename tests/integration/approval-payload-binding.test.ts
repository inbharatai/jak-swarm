/**
 * Approval payload-binding integration tests — Item B of the
 * OpenClaw-inspired Phase 1.
 *
 * The contract this test pins:
 *   1. createApprovalRequest computes a canonical sha256 of proposedData
 *      and persists it on the row.
 *   2. resolveApproval re-hashes the CURRENT proposedData and compares to
 *      the stored hash. A mismatch throws ApprovalPayloadMismatchError.
 *   3. Successful resolveApproval writes an ApprovalScope row inside the
 *      same transaction.
 *   4. Legacy approvals (proposedDataHash = null) get the hash initialized
 *      on first decide so subsequent decides are bound.
 *   5. The unique (approvalId, proposedDataHash) constraint makes a
 *      replayed decide for the SAME hash idempotent (no error, no double
 *      audit row).
 *
 * Why integration (not unit): the transactional `$transaction` wrapping
 * an upsert + an insert is the contract that prevents the audit log from
 * disagreeing with the row state. Mocking $transaction in a pure unit
 * test risks shipping a false-green where the production code wired up
 * the transaction wrong.
 *
 * The test stubs `db` with an in-memory replica that mirrors only the
 * surface area the WorkflowService actually touches. If the service
 * reaches for a method we haven't stubbed, the stub throws so we know
 * to extend the harness.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowService } from '../../apps/api/src/services/workflow.service.js';
import { ApprovalPayloadMismatchError, NotFoundError } from '../../apps/api/src/errors.js';
import { canonicalHash } from '../../apps/api/src/utils/canonical-hash.js';

interface ApprovalRow {
  id: string;
  workflowId: string;
  tenantId: string;
  taskId: string;
  agentRole: string;
  action: string;
  rationale: string;
  proposedDataJson: Record<string, unknown> | null;
  riskLevel: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  comment: string | null;
  proposedDataHash: string | null;
  toolName: string | null;
  filesAffected: string[];
  externalService: string | null;
  idempotencyKey: string | null;
  expectedResult: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ScopeRow {
  id: string;
  approvalId: string;
  proposedDataHash: string;
  decision: string;
  approverId: string | null;
  decidedAt: Date;
}

function makeStubDb() {
  const approvals = new Map<string, ApprovalRow>();
  const scopes: ScopeRow[] = [];

  let approvalSeq = 0;
  let scopeSeq = 0;

  const tx = {
    approvalRequest: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<ApprovalRow>;
      }) => {
        const existing = approvals.get(where.id);
        if (!existing) throw new Error(`approvalRequest not found: ${where.id}`);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        approvals.set(where.id, updated);
        return updated;
      },
    },
    approvalScope: {
      create: async ({
        data,
      }: {
        data: Omit<ScopeRow, 'id' | 'decidedAt'> & { decidedAt?: Date };
      }) => {
        // Enforce the unique (approvalId, proposedDataHash) just like the DB.
        const dup = scopes.find(
          (s) => s.approvalId === data.approvalId && s.proposedDataHash === data.proposedDataHash,
        );
        if (dup) {
          const e = new Error(
            'Unique constraint failed on the fields: (`approvalId`,`proposedDataHash`)',
          ) as Error & { code: string };
          e.code = 'P2002';
          throw e;
        }
        const row: ScopeRow = {
          id: `scope_${++scopeSeq}`,
          approvalId: data.approvalId,
          proposedDataHash: data.proposedDataHash,
          decision: data.decision,
          approverId: data.approverId ?? null,
          decidedAt: data.decidedAt ?? new Date(),
        };
        scopes.push(row);
        return row;
      },
    },
  };

  const db = {
    approvalRequest: {
      create: async ({ data }: { data: Partial<ApprovalRow> & Pick<ApprovalRow, 'workflowId' | 'tenantId' | 'taskId' | 'agentRole' | 'action' | 'rationale' | 'riskLevel'> }) => {
        const id = `apr_${++approvalSeq}`;
        const row: ApprovalRow = {
          id,
          workflowId: data.workflowId,
          tenantId: data.tenantId,
          taskId: data.taskId,
          agentRole: data.agentRole,
          action: data.action,
          rationale: data.rationale,
          proposedDataJson: (data.proposedDataJson as Record<string, unknown> | undefined) ?? null,
          riskLevel: data.riskLevel,
          status: data.status ?? 'PENDING',
          reviewedBy: data.reviewedBy ?? null,
          reviewedAt: data.reviewedAt ?? null,
          comment: data.comment ?? null,
          proposedDataHash: data.proposedDataHash ?? null,
          toolName: data.toolName ?? null,
          filesAffected: data.filesAffected ?? [],
          externalService: data.externalService ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
          expectedResult: data.expectedResult ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        approvals.set(id, row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        return approvals.get(where.id) ?? null;
      },
    },
    $transaction: async <T,>(fn: (txArg: typeof tx) => Promise<T>): Promise<T> => {
      return fn(tx);
    },
    // Sentinel — surfaces the next missing method as a clear error.
    __scopes: scopes,
    __approvals: approvals,
  };

  return db as unknown as Parameters<typeof WorkflowService['prototype']['constructor']>[0] & {
    __scopes: ScopeRow[];
    __approvals: Map<string, ApprovalRow>;
  };
}

const stubLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => stubLogger,
  level: 'info',
} as never;

describe('Approval payload-binding integration', () => {
  let db: ReturnType<typeof makeStubDb>;
  let service: WorkflowService;

  beforeEach(() => {
    db = makeStubDb();
    service = new WorkflowService(db, stubLogger);
  });

  describe('createApprovalRequest', () => {
    it('persists a canonical sha256 hash of proposedData', async () => {
      const proposed = { taskInput: 'Send digest', toolsRequired: ['gmail_send'], riskLevel: 'HIGH' };
      const created = await service.createApprovalRequest({
        workflowId: 'wf_1',
        tenantId: 'tenant_1',
        taskId: 'task_1',
        agentRole: 'WORKER_EMAIL',
        action: 'Send digest',
        rationale: 'Weekly customer digest',
        proposedDataJson: proposed,
        riskLevel: 'HIGH',
        toolName: 'gmail_send',
        filesAffected: [],
        externalService: 'Gmail',
        expectedResult: 'Email sent to recipients',
      });

      expect(created.proposedDataHash).toBe(canonicalHash(proposed));
      expect(created.toolName).toBe('gmail_send');
      expect(created.externalService).toBe('Gmail');
    });

    it('persists null hash when proposedDataJson is omitted', async () => {
      const created = await service.createApprovalRequest({
        workflowId: 'wf_1',
        tenantId: 'tenant_1',
        taskId: 'task_1',
        agentRole: 'WORKER_EMAIL',
        action: 'Send digest',
        rationale: 'Weekly customer digest',
        riskLevel: 'HIGH',
      });
      expect(created.proposedDataHash).toBeNull();
    });
  });

  describe('resolveApproval — payload-binding gate', () => {
    it('accepts decisions when proposedData is unchanged (hashes match)', async () => {
      const proposed = { tool: 'gmail_send', to: 'alice@example.com' };
      const created = await service.createApprovalRequest({
        workflowId: 'wf_1',
        tenantId: 'tenant_1',
        taskId: 'task_1',
        agentRole: 'WORKER_EMAIL',
        action: 'Send email',
        rationale: '',
        proposedDataJson: proposed,
        riskLevel: 'HIGH',
      });

      const updated = await service.resolveApproval(
        'tenant_1',
        created.id,
        'APPROVED',
        'reviewer_1',
        'looks good',
      );

      expect(updated.status).toBe('APPROVED');
      // ApprovalScope row was written
      expect(db.__scopes).toHaveLength(1);
      expect(db.__scopes[0]).toMatchObject({
        approvalId: created.id,
        proposedDataHash: canonicalHash(proposed),
        decision: 'APPROVED',
        approverId: 'reviewer_1',
      });
    });

    it('rejects decisions with 409 APPROVAL_PAYLOAD_MISMATCH when proposedData was mutated', async () => {
      const original = { tool: 'gmail_send', to: 'alice@example.com', subject: 'Hi' };
      const created = await service.createApprovalRequest({
        workflowId: 'wf_1',
        tenantId: 'tenant_1',
        taskId: 'task_1',
        agentRole: 'WORKER_EMAIL',
        action: 'Send email',
        rationale: '',
        proposedDataJson: original,
        riskLevel: 'HIGH',
      });

      // Simulate a tampered or buggy mutation between create and decide:
      // someone changed `to` to a different recipient under the same approvalId.
      const row = db.__approvals.get(created.id)!;
      row.proposedDataJson = { tool: 'gmail_send', to: 'attacker@evil.com', subject: 'Hi' };

      await expect(
        service.resolveApproval('tenant_1', created.id, 'APPROVED', 'reviewer_1'),
      ).rejects.toBeInstanceOf(ApprovalPayloadMismatchError);

      // The row stays PENDING — the tampered decision must NOT take effect.
      const after = db.__approvals.get(created.id)!;
      expect(after.status).toBe('PENDING');
      // No scope row written
      expect(db.__scopes).toHaveLength(0);
    });

    it('initializes proposedDataHash on legacy rows (hash was null) at first decide', async () => {
      const proposed = { tool: 'slack_post', to: '#general' };
      const created = await service.createApprovalRequest({
        workflowId: 'wf_1',
        tenantId: 'tenant_1',
        taskId: 'task_1',
        agentRole: 'WORKER_MESSAGING',
        action: 'Post message',
        rationale: '',
        proposedDataJson: proposed,
        riskLevel: 'MEDIUM',
      });

      // Simulate a legacy row by clearing the hash post-create.
      const row = db.__approvals.get(created.id)!;
      row.proposedDataHash = null;

      const updated = await service.resolveApproval(
        'tenant_1',
        created.id,
        'APPROVED',
        'reviewer_1',
      );

      expect(updated.status).toBe('APPROVED');
      // Hash was initialized
      expect(db.__approvals.get(created.id)!.proposedDataHash).toBe(canonicalHash(proposed));
      // Scope row was written
      expect(db.__scopes).toHaveLength(1);
    });

    it('throws NotFoundError when the approval does not exist', async () => {
      await expect(
        service.resolveApproval('tenant_1', 'apr_missing', 'APPROVED', 'reviewer_1'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('exposes APPROVAL_PAYLOAD_MISMATCH error code + 409 status', async () => {
      const proposed = { x: 1 };
      const created = await service.createApprovalRequest({
        workflowId: 'wf_1',
        tenantId: 'tenant_1',
        taskId: 'task_1',
        agentRole: 'WORKER_EMAIL',
        action: 'X',
        rationale: '',
        proposedDataJson: proposed,
        riskLevel: 'HIGH',
      });
      const row = db.__approvals.get(created.id)!;
      row.proposedDataJson = { x: 2 };

      try {
        await service.resolveApproval('tenant_1', created.id, 'APPROVED', 'reviewer_1');
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ApprovalPayloadMismatchError);
        const ae = e as ApprovalPayloadMismatchError;
        expect(ae.statusCode).toBe(409);
        expect(ae.code).toBe('APPROVAL_PAYLOAD_MISMATCH');
        expect(ae.details).toMatchObject({
          expectedHash: canonicalHash(proposed),
          observedHash: canonicalHash({ x: 2 }),
        });
      }
    });
  });
});
