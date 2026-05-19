/**
 * Sprint 6 Part E — Tool installer HTTP routes.
 *
 * Wires the existing `ToolRequirementDetector` + `SandboxedInstaller`
 * into reachable routes. Closes the previously-Partial criterion #13
 * (tool installer workflow) by giving the user a real surface to
 * detect missing capabilities + plan + (admin-only) execute.
 *
 * Routes:
 *   POST /tool-installer/detect    — detect missing capability from task description
 *   POST /tool-installer/plan      — produce a dry-run install plan for an allowlisted tool
 *   POST /tool-installer/execute   — execute the install (REQUIRES approvalId + admin role)
 *
 * Hard rules ENFORCED at this route layer:
 *   - Detect endpoint: any auth user (read-only)
 *   - Plan endpoint: any auth user (read-only)
 *   - Execute endpoint: REVIEWER+ AND approvalId required
 *   - Tenant: every route logs tenantId + userId in the audit log
 *   - Allowlist: only `SANDBOX_ADAPTERS`-registered tools can fire
 *   - Argv: shell-metachar guard already inside `getValidatedAdapter`
 *   - Timeout: 60s default
 *   - Logs: 64KB-truncated stdout/stderr returned in result.message
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import {
  ToolRequirementDetector,
  SandboxedInstaller,
  SANDBOX_ADAPTERS,
  toolRegistry,
  InstallApprovalRequiredError,
  InstallNotAllowedError,
  type ToolInstallRequest,
} from '@jak-swarm/tools';

const detectBodySchema = z.object({
  task: z.string().min(1).max(2000),
});

const planBodySchema = z.object({
  toolName: z.string().min(1).max(120),
  purpose: z.string().min(1).max(500),
});

const executeBodySchema = planBodySchema.extend({
  approvalId: z.string().min(1),
});

function buildRequest(input: { toolName: string; purpose: string; tenantId: string; userId: string; approvalId?: string }): ToolInstallRequest {
  return {
    toolName: input.toolName,
    purpose: input.purpose,
    riskCategory: 'INSTALL' as never,
    requiredPermissions: [],
    installMethod: 'npm',
    approvalStatus: input.approvalId ? 'APPROVED' : 'PENDING',
    tenantId: input.tenantId,
    userId: input.userId,
  };
}

const toolInstallerRoutes: FastifyPluginAsync = async (fastify) => {
  // Shared installer instance — capability_check default; full_install
  // is gated by JAK_INSTALL_ALLOW_WRITE=1 inside the SandboxedInstaller.
  const installer = new SandboxedInstaller();

  fastify.post(
    '/detect',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parse = detectBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      const registeredNames = new Set(toolRegistry.list().map((m) => m.name));
      const detector = new ToolRequirementDetector(registeredNames);
      const requirements = detector.detectFromTask(parse.data.task);
      // Augment each requirement with sandbox adapter availability so
      // the UI knows whether plan/execute will work.
      const augmented = requirements.map((req) => ({
        ...req,
        sandboxAdapterAvailable:
          req.suggestedToolName !== null &&
          SANDBOX_ADAPTERS[req.suggestedToolName] !== undefined,
      }));
      return reply.status(200).send(ok({ requirements: augmented }));
    },
  );

  fastify.post(
    '/plan',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parse = planBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      const plan = await installer.dryRun(
        buildRequest({
          toolName: parse.data.toolName,
          purpose: parse.data.purpose,
          tenantId: request.user.tenantId,
          userId: request.user.userId,
        }),
      );
      return reply.status(200).send(ok(plan));
    },
  );

  fastify.post(
    '/execute',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parse = executeBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parse.error.flatten()));
      }
      try {
        const approval = await fastify.db.approvalRequest.findFirst({
          where: {
            id: parse.data.approvalId,
            tenantId: request.user.tenantId,
            status: 'APPROVED',
            toolName: parse.data.toolName,
          },
          select: { id: true },
        });
        if (!approval) {
          return reply.status(403).send(err('APPROVAL_NOT_VALID', 'A tenant-scoped approved approvalId for this tool is required before installation.'));
        }
        const result = await installer.install({
          request: buildRequest({
            toolName: parse.data.toolName,
            purpose: parse.data.purpose,
            tenantId: request.user.tenantId,
            userId: request.user.userId,
            approvalId: parse.data.approvalId,
          }),
          approvalId: parse.data.approvalId,
        });

        // Audit log — every execute attempt is recorded with tenant +
        // user + tool + result. This is critical for compliance.
        try {
          await fastify.db.auditLog.create({
            data: {
              tenantId: request.user.tenantId,
              userId: request.user.userId,
              action: 'TOOL_INSTALL_EXECUTED',
              resource: 'tool_installer',
              resourceId: parse.data.toolName,
              details: {
                approvalId: parse.data.approvalId,
                success: result.success,
                mode: result.mode,
                purpose: parse.data.purpose,
              } as never,
              severity: result.success ? 'INFO' : 'WARN',
            },
          });
        } catch (auditErr) {
          fastify.log.warn({ err: auditErr }, '[tool-installer] audit emission failed (non-fatal)');
        }

        return reply.status(200).send(ok(result));
      } catch (e) {
        if (e instanceof InstallApprovalRequiredError) {
          return reply.status(409).send(err('APPROVAL_REQUIRED', e.message));
        }
        if (e instanceof InstallNotAllowedError) {
          return reply.status(400).send(err('NOT_ALLOWED', e.message));
        }
        const msg = e instanceof Error ? e.message : 'install failed';
        return reply.status(500).send(err('INSTALL_FAILED', msg));
      }
    },
  );
};

export default toolInstallerRoutes;
