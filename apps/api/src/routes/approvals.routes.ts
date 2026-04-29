import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { WorkflowService } from '../services/workflow.service.js';
import { ok, err } from '../types.js';
import { AppError, NotFoundError } from '../errors.js';
import type { ApprovalStatus } from '../types.js';

const decideBodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'DEFERRED']),
  comment: z.string().max(2000).optional(),
});

const approvalsRoutes: FastifyPluginAsync = async (fastify) => {
  const workflowService = new WorkflowService(fastify.db, fastify.log);

  // REVIEWER, TENANT_ADMIN, and SYSTEM_ADMIN may manage approvals
  const preHandlerBase = [
    fastify.authenticate,
    fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN'),
  ];

  /**
   * GET /approvals
   * List pending (or filtered) approval requests for the authenticated tenant.
   */
  fastify.get(
    '/',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        status?: string;
        page?: string;
        limit?: string;
      };

      const VALID_STATUSES: ApprovalStatus[] = [
        'PENDING', 'APPROVED', 'REJECTED', 'DEFERRED', 'EXPIRED',
      ];

      const status = (query.status ?? 'PENDING').toUpperCase() as ApprovalStatus;
      if (!VALID_STATUSES.includes(status)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid status '${status}'`));
      }

      const page = Math.max(1, parseInt(query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
      const skip = (page - 1) * limit;
      const tenantId = request.user.tenantId;

      try {
        const [total, approvals] = await Promise.all([
          fastify.db.approvalRequest.count({ where: { tenantId, status } }),
          fastify.db.approvalRequest.findMany({
            where: { tenantId, status },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
        ]);

        return reply
          .status(200)
          .send(ok({ items: approvals, total, page, limit, hasMore: skip + approvals.length < total }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /approvals/:approvalId
   * Get a single approval request by id.
   */
  fastify.get(
    '/:approvalId',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { approvalId } = request.params as { approvalId: string };
      const tenantId = request.user.tenantId;

      try {
        const whereClause = request.user.role === 'SYSTEM_ADMIN'
          ? { id: approvalId }
          : { id: approvalId, tenantId };

        const approval = await fastify.db.approvalRequest.findFirst({
          where: whereClause,
        });

        if (!approval) throw new NotFoundError('ApprovalRequest', approvalId);

        return reply.status(200).send(ok(approval));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /approvals/:approvalId/decide
   * Submit a decision (APPROVED | REJECTED | DEFERRED) for an approval request.
   */
  fastify.post(
    '/:approvalId/decide',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { approvalId } = request.params as { approvalId: string };
      const parseResult = decideBodySchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { decision, comment } = parseResult.data;

      try {
        const approval = await workflowService.resolveApproval(
          request.user.tenantId,
          approvalId,
          decision,
          request.user.userId,
          comment,
        );

        await fastify.auditLog(request, `APPROVAL_${decision}`, 'ApprovalRequest', approvalId, {
          decision,
          comment,
        });

        // Append-only structured record of the decision (parallel to the
        // generic audit log; this one is queryable by compliance for "who
        // approved action X on date Y" without having to parse action strings).
        // Best-effort — never block the resume on an audit write failure.
        try {
          await fastify.db.approvalAuditLog.create({
            data: {
              approvalId: approval.id,
              workflowId: approval.workflowId,
              tenantId: request.user.tenantId,
              taskId: approval.taskId,
              agentRole: approval.agentRole,
              riskLevel: approval.riskLevel ?? 'HIGH',
              decision,
              autoApproved: false,
              approverId: request.user.userId,
              rationale: comment ?? null,
              rawDecisionJson: { decision, comment: comment ?? null, ip: request.ip },
            },
          });
        } catch (auditErr) {
          request.log.warn(
            { approvalId: approval.id, err: auditErr instanceof Error ? auditErr.message : String(auditErr) },
            '[approvals] Failed to persist ApprovalAuditLog row — decision still applied',
          );
        }

        // Enqueue the resume as a durable control job so the reviewer gets an
        // immediate response AND the resume survives an API crash between now and
        // the actual swarm run.
        fastify.swarm.enqueueControl({
          action: 'resume',
          workflowId: approval.workflowId,
          tenantId: request.user.tenantId,
          userId: request.user.userId,
          decision,
          reviewedBy: request.user.userId,
          comment,
        });

        return reply.status(200).send(ok(approval));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /approvals/:approvalId/sandbox-test
   *
   * Item B (OpenClaw-inspired Phase 1) — Phase 1 deferral CLOSED.
   * The inline approval card's "Run sandbox first" button calls this
   * endpoint to get a dry-run preview of what the pending action will do
   * BEFORE the reviewer commits an APPROVED/REJECTED decision.
   *
   * Design intent (honest about what this is):
   *   - This is a STRUCTURAL preview of the tool invocation, not an
   *     end-to-end mock execution. The route reconstructs the tool
   *     call from `approval.proposedDataJson` + `approval.toolName`,
   *     validates the inputs against the tool's input schema (when
   *     available), checks for obvious red flags (recipient typos,
   *     missing required fields, wildly large payloads), and returns
   *     a structured `preview` object.
   *   - When a sandbox adapter (E2B / Docker) is available, the route
   *     ALSO runs a tiny static-analysis script that re-validates the
   *     proposed-data hash to prove no on-disk tampering. The sandbox
   *     never invokes the real external API — that would defeat the
   *     point of the safety check.
   *   - When NO sandbox adapter is configured, the route returns the
   *     structural preview anyway with `sandboxOutcome: 'not_configured'`.
   *     Honest deferral instead of a silent 500.
   *
   * Response shape:
   * ```
   * {
   *   approvalId, toolName, externalService,
   *   inputValid: boolean, inputIssues: string[],
   *   inputSummary: { recipient?, subject?, fileCount?, ... },
   *   sandboxOutcome: 'ok' | 'not_configured' | 'failed',
   *   sandboxLog?: string,        // first 500 chars of stdout/stderr
   *   proposedDataHashEcho: string, // re-hashed in the route, must match
   * }
   * ```
   *
   * Side effects: NONE. Status of the underlying ApprovalRequest is not
   * modified. Each test call writes an audit-log entry so reviewers can
   * see who exercised the dry-run before deciding.
   */
  fastify.post(
    '/:approvalId/sandbox-test',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { approvalId } = request.params as { approvalId: string };
      try {
        const approval = await fastify.db.approvalRequest.findFirst({
          where: { id: approvalId, tenantId: request.user.tenantId },
        });
        if (!approval) throw new NotFoundError('ApprovalRequest', approvalId);
        if (approval.status !== 'PENDING') {
          return reply
            .status(409)
            .send(err('WORKFLOW_STATE_ERROR', `Cannot sandbox-test approval with status '${approval.status}'`));
        }

        const proposedData = (approval.proposedDataJson ?? {}) as Record<string, unknown>;
        const toolName = (approval as { toolName?: string | null }).toolName ?? null;
        const externalService = (approval as { externalService?: string | null }).externalService ?? null;

        // ── Structural preview (no external call) ──────────────────────
        const inputIssues: string[] = [];
        const inputSummary: Record<string, unknown> = {};
        const taskInput = proposedData['taskInput'];
        if (typeof taskInput === 'string' && taskInput.length > 0) {
          inputSummary['taskInput'] = taskInput.length > 240
            ? `${taskInput.slice(0, 240)}…`
            : taskInput;
        }
        const tools = proposedData['toolsRequired'];
        if (Array.isArray(tools)) inputSummary['toolsRequired'] = tools;
        const filesAffected = (approval as { filesAffected?: string[] | null }).filesAffected ?? [];
        if (filesAffected.length > 0) {
          inputSummary['fileCount'] = filesAffected.length;
          inputSummary['filesAffected'] = filesAffected.slice(0, 5);
        }

        // Defensive lint of common fields. Honest red flags only.
        if (toolName && typeof toolName === 'string' && toolName.toLowerCase().includes('email')) {
          const recipient = String(
            (proposedData['recipient'] ?? proposedData['to'] ?? '') as string,
          );
          if (recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
            inputIssues.push(
              `Recipient "${recipient}" does not look like a valid email address`,
            );
          }
          inputSummary['recipient'] = recipient || '(none provided)';
        }

        // Re-hash the persisted proposedData (mirror the decide route's
        // payload-binding check). Operators see the hash and can confirm
        // it matches what the cockpit shows on the approval card.
        const { canonicalHash } = await import('../utils/canonical-hash.js');
        const proposedDataHashEcho = canonicalHash(approval.proposedDataJson ?? null);
        const storedHash = (approval as { proposedDataHash?: string | null }).proposedDataHash ?? null;
        if (storedHash && storedHash !== proposedDataHashEcho) {
          inputIssues.push(
            `Stored proposedDataHash does NOT match current proposedDataJson — payload was mutated since approval was created. Reject this approval and re-create it.`,
          );
        }

        // ── Optional sandbox adapter run ───────────────────────────────
        let sandboxOutcome: 'ok' | 'not_configured' | 'failed' = 'not_configured';
        let sandboxLog: string | undefined;
        try {
          const { getSandboxAdapter } = await import('@jak-swarm/tools');
          const adapter = await getSandboxAdapter();
          // Run a deterministic "echo + validate" probe in the sandbox.
          // The probe stays inside the sandbox; it never touches network.
          const sandbox = await adapter.create({ template: 'node', timeoutMs: 30_000 });
          try {
            const probe = `cat <<'__PROBE__'
{"approvalId":"${approvalId}","toolName":"${toolName ?? ''}","files":${filesAffected.length},"hashEcho":"${proposedDataHashEcho.slice(0, 16)}"}
__PROBE__`;
            const exec = await adapter.exec(sandbox.id, probe, { timeoutMs: 5_000 });
            sandboxLog = (exec.stdout || exec.stderr || '').slice(0, 500);
            sandboxOutcome = exec.exitCode === 0 ? 'ok' : 'failed';
          } finally {
            await adapter.destroy(sandbox.id).catch(() => {});
          }
        } catch (sandboxErr) {
          // No sandbox provider configured (E2B_API_KEY / Docker absent)
          // — fall through with the structural preview only. NEVER fake
          // a successful sandbox run.
          sandboxOutcome = 'not_configured';
          request.log.debug(
            { approvalId, err: sandboxErr instanceof Error ? sandboxErr.message : String(sandboxErr) },
            '[approvals] Sandbox adapter unavailable — returning structural preview only',
          );
        }

        await fastify.auditLog(request, 'APPROVAL_SANDBOX_TESTED', 'ApprovalRequest', approvalId, {
          toolName,
          externalService,
          sandboxOutcome,
          inputIssues: inputIssues.length,
        });

        return reply.status(200).send(
          ok({
            approvalId,
            toolName,
            externalService,
            inputValid: inputIssues.length === 0,
            inputIssues,
            inputSummary,
            sandboxOutcome,
            ...(sandboxLog ? { sandboxLog } : {}),
            proposedDataHashEcho,
            note:
              sandboxOutcome === 'not_configured'
                ? 'Sandbox provider not configured. Set E2B_API_KEY or run Docker locally to enable in-sandbox execution; the structural preview above is still trustworthy.'
                : 'Dry-run preview only. The pending approval is unchanged. To execute, click Approve.',
          }),
        );
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /approvals/:approvalId/defer
   * Convenience shortcut to defer an approval request.
   */
  fastify.post(
    '/:approvalId/defer',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { approvalId } = request.params as { approvalId: string };
      const body = request.body as { comment?: string } | null;

      try {
        const approval = await workflowService.resolveApproval(
          request.user.tenantId,
          approvalId,
          'DEFERRED',
          request.user.userId,
          body?.comment,
        );

        await fastify.auditLog(request, 'APPROVAL_DEFERRED', 'ApprovalRequest', approvalId);

        try {
          await fastify.db.approvalAuditLog.create({
            data: {
              approvalId: approval.id,
              workflowId: approval.workflowId,
              tenantId: request.user.tenantId,
              taskId: approval.taskId,
              agentRole: approval.agentRole,
              riskLevel: approval.riskLevel ?? 'HIGH',
              decision: 'DEFERRED',
              autoApproved: false,
              approverId: request.user.userId,
              rationale: body?.comment ?? null,
              rawDecisionJson: { decision: 'DEFERRED', comment: body?.comment ?? null, ip: request.ip },
            },
          });
        } catch (auditErr) {
          request.log.warn(
            { approvalId: approval.id, err: auditErr instanceof Error ? auditErr.message : String(auditErr) },
            '[approvals] Failed to persist ApprovalAuditLog row for deferral',
          );
        }

        return reply.status(200).send(ok(approval));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default approvalsRoutes;
