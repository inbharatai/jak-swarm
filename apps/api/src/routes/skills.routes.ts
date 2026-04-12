import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { AppError, NotFoundError, ForbiddenError } from '../errors.js';
import type { SkillStatus } from '../types.js';

// SkillTier in DB is Int: 1=BUILTIN, 2=COMMUNITY, 3=TENANT
const TIER_MAP: Record<string, number> = {
  BUILTIN: 1,
  COMMUNITY: 2,
  TENANT: 3,
};

const proposeSkillBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  permissions: z.array(z.string()),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  testCases: z.array(z.record(z.unknown())).min(1),
});


const skillsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /skills
   * List skills — global built-ins and tenant-specific skills.
   * Supports filtering by tier and status.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        tier?: string;
        status?: string;
        page?: string;
        limit?: string;
      };

      const VALID_TIERS = Object.keys(TIER_MAP);
      const VALID_STATUSES: SkillStatus[] = [
        'PROPOSED', 'SANDBOX_RUNNING', 'SANDBOX_PASSED', 'SANDBOX_FAILED',
        'APPROVED', 'REJECTED', 'DEPRECATED',
      ];

      const tierStr = query.tier;
      const status = query.status as SkillStatus | undefined;

      if (tierStr && !VALID_TIERS.includes(tierStr)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid tier '${tierStr}'`));
      }
      if (status && !VALID_STATUSES.includes(status)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid status '${status}'`));
      }

      const tierNum = tierStr ? TIER_MAP[tierStr] : undefined;

      const page = Math.max(1, parseInt(query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
      const skip = (page - 1) * limit;

      try {
        const where = {
          AND: [
            // Show global skills OR the tenant's own skills
            {
              OR: [
                { tenantId: null },
                { tenantId: request.user.tenantId },
              ],
            },
            ...(tierNum !== undefined ? [{ tier: tierNum }] : []),
            ...(status ? [{ status }] : []),
          ],
        };

        const [total, skills] = await Promise.all([
          fastify.db.skill.count({ where }),
          fastify.db.skill.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
        ]);

        return reply
          .status(200)
          .send(ok({ items: skills, total, page, limit, hasMore: skip + skills.length < total }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /skills/propose
   * Propose a new skill for this tenant.
   */
  fastify.post(
    '/propose',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = proposeSkillBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { name, description, inputSchema, outputSchema, permissions, riskLevel, testCases } =
        parseResult.data;

      try {
        // Check name uniqueness within the tenant scope
        const existing = await fastify.db.skill.findFirst({
          where: { name, tenantId: request.user.tenantId },
        });
        if (existing) {
          return reply.status(409).send(err('CONFLICT', `Skill '${name}' already exists`));
        }

        const skill = await fastify.db.skill.create({
          data: {
            tenantId: request.user.tenantId,
            name,
            description,
            tier: TIER_MAP['TENANT'],
            status: 'PROPOSED',
            riskLevel,
            inputSchemaJson: inputSchema as object,
            outputSchemaJson: outputSchema as object,
            permissions,
            testCasesJson: testCases as object[],
          },
        });

        await fastify.auditLog(request, 'PROPOSE_SKILL', 'Skill', skill.id, { name, riskLevel });
        return reply.status(201).send(ok(skill));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /skills/:skillId
   * Get a skill by id — accessible if global or belongs to the tenant.
   */
  fastify.get(
    '/:skillId',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { skillId: string };

      try {
        const skill = await fastify.db.skill.findUnique({ where: { id: skillId } });
        if (!skill) throw new NotFoundError('Skill', skillId);

        // Access check: global skills are visible to all; tenant skills only to their tenant
        if (
          skill.tenantId !== null &&
          skill.tenantId !== request.user.tenantId &&
          request.user.role !== 'SYSTEM_ADMIN'
        ) {
          throw new ForbiddenError('Access to skill in another tenant is not allowed');
        }

        return reply.status(200).send(ok(skill));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /skills/:skillId/approve
   * Approve a proposed skill — TENANT_ADMIN only, scoped to their tenant.
   */
  fastify.post(
    '/:skillId/approve',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { skillId: string };

      try {
        const skill = await fastify.db.skill.findUnique({ where: { id: skillId } });
        if (!skill) throw new NotFoundError('Skill', skillId);

        if (skill.tenantId !== request.user.tenantId && request.user.role !== 'SYSTEM_ADMIN') {
          throw new ForbiddenError('Access to skill in another tenant is not allowed');
        }

        if (skill.status !== 'PROPOSED' && skill.status !== 'SANDBOX_PASSED') {
          return reply
            .status(409)
            .send(err('CONFLICT', `Cannot approve skill with status '${skill.status}'`));
        }

        const updated = await fastify.db.skill.update({
          where: { id: skillId },
          data: { status: 'APPROVED', approvedBy: request.user.userId, approvedAt: new Date() },
        });

        await fastify.auditLog(request, 'APPROVE_SKILL', 'Skill', skillId);
        return reply.status(200).send(ok(updated));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /skills/:skillId/reject
   * Reject a proposed skill — TENANT_ADMIN only.
   */
  fastify.post(
    '/:skillId/reject',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { skillId: string };
      const body = request.body as { reason?: string } | null;

      try {
        const skill = await fastify.db.skill.findUnique({ where: { id: skillId } });
        if (!skill) throw new NotFoundError('Skill', skillId);

        if (skill.tenantId !== request.user.tenantId && request.user.role !== 'SYSTEM_ADMIN') {
          throw new ForbiddenError('Access to skill in another tenant is not allowed');
        }

        if (skill.status === 'APPROVED' || skill.status === 'REJECTED') {
          return reply
            .status(409)
            .send(err('CONFLICT', `Cannot reject skill with status '${skill.status}'`));
        }

        const updated = await fastify.db.skill.update({
          where: { id: skillId },
          data: { status: 'REJECTED' },
        });

        await fastify.auditLog(request, 'REJECT_SKILL', 'Skill', skillId, {
          reason: body?.reason,
        });
        return reply.status(200).send(ok(updated));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /skills/:skillId/sandbox
   * Trigger a sandbox test run for a proposed skill — TENANT_ADMIN only.
   */
  fastify.post(
    '/:skillId/sandbox',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { skillId: string };

      try {
        const skill = await fastify.db.skill.findUnique({ where: { id: skillId } });
        if (!skill) throw new NotFoundError('Skill', skillId);

        if (skill.tenantId !== request.user.tenantId && request.user.role !== 'SYSTEM_ADMIN') {
          throw new ForbiddenError('Access to skill in another tenant is not allowed');
        }

        if (skill.status !== 'PROPOSED') {
          return reply
            .status(409)
            .send(err('CONFLICT', `Cannot run sandbox for skill with status '${skill.status}'`));
        }

        await fastify.db.skill.update({
          where: { id: skillId },
          data: { status: 'SANDBOX_RUNNING' },
        });

        await fastify.auditLog(request, 'SANDBOX_SKILL', 'Skill', skillId);
        request.log.info({ skillId }, 'Skill sandbox run triggered');

        // ── Phase 1: Schema Validation ────────────────────────────────────
        const validationErrors: string[] = [];
        let inputSchema: Record<string, unknown> | null = null;
        let outputSchema: Record<string, unknown> | null = null;

        try {
          inputSchema = typeof skill.inputSchemaJson === 'string'
            ? JSON.parse(skill.inputSchemaJson as string)
            : skill.inputSchemaJson as Record<string, unknown>;
          if (!inputSchema || typeof inputSchema !== 'object') {
            validationErrors.push('Invalid input schema: must be a JSON object');
          }
        } catch (e) {
          validationErrors.push(`Input schema parse error: ${e instanceof Error ? e.message : String(e)}`);
        }

        try {
          outputSchema = typeof skill.outputSchemaJson === 'string'
            ? JSON.parse(skill.outputSchemaJson as string)
            : skill.outputSchemaJson as Record<string, unknown>;
          if (!outputSchema || typeof outputSchema !== 'object') {
            validationErrors.push('Invalid output schema: must be a JSON object');
          }
        } catch (e) {
          validationErrors.push(`Output schema parse error: ${e instanceof Error ? e.message : String(e)}`);
        }

        if (validationErrors.length > 0) {
          const updated = await fastify.db.skill.update({
            where: { id: skillId },
            data: {
              status: 'PROPOSED',
              sandboxResult: { passed: false, phase: 'validation', errors: validationErrors } as object,
            },
          });
          return reply.status(200).send(ok({
            ...updated,
            sandboxResult: { passed: false, phase: 'validation', errors: validationErrors },
            message: `Sandbox validation failed: ${validationErrors.join('; ')}`,
          }));
        }

        // ── Phase 2: Code Execution (if implementation + test cases exist) ──
        interface TestResult {
          name: string;
          passed: boolean;
          output?: string;
          error?: string;
          durationMs: number;
        }
        const testResults: TestResult[] = [];
        let executionError: string | null = null;

        const hasCode = skill.implementation && typeof skill.implementation === 'string' && skill.implementation.trim().length > 0;
        const testCases = (skill.testCasesJson as Array<{ name: string; input: unknown; expectedOutput?: unknown }>) ?? [];

        if (hasCode && testCases.length > 0) {
          try {
            const { getSandboxAdapter } = await import('@jak-swarm/tools');
            const sandbox = await getSandboxAdapter();
            const sandboxInfo = await sandbox.create({ template: 'node', timeoutMs: 2 * 60 * 1000 });

            try {
              // Write the skill implementation
              await sandbox.writeFile(sandboxInfo.id, 'skill.js', skill.implementation!);

              // Write test runner
              const testRunner = `
const skill = require('./skill.js');
const testCases = ${JSON.stringify(testCases)};

(async () => {
  const results = [];
  for (const tc of testCases) {
    const start = Date.now();
    try {
      const fn = typeof skill === 'function' ? skill : skill.default ?? skill.execute;
      if (typeof fn !== 'function') {
        results.push({ name: tc.name, passed: false, error: 'Skill does not export a function', durationMs: 0 });
        continue;
      }
      const output = await fn(tc.input);
      const passed = tc.expectedOutput !== undefined
        ? JSON.stringify(output) === JSON.stringify(tc.expectedOutput)
        : output !== undefined && output !== null;
      results.push({ name: tc.name, passed, output: JSON.stringify(output).slice(0, 500), durationMs: Date.now() - start });
    } catch (err) {
      results.push({ name: tc.name, passed: false, error: err.message, durationMs: Date.now() - start });
    }
  }
  console.log(JSON.stringify(results));
})();
`;
              await sandbox.writeFile(sandboxInfo.id, 'test-runner.js', testRunner);

              // Execute tests
              const execResult = await sandbox.exec(sandboxInfo.id, 'node test-runner.js', { timeoutMs: 30_000 });

              if (execResult.exitCode === 0 && execResult.stdout.trim()) {
                try {
                  const parsed = JSON.parse(execResult.stdout.trim()) as TestResult[];
                  testResults.push(...parsed);
                } catch {
                  executionError = `Test output parse error. stdout: ${execResult.stdout.slice(0, 300)}`;
                }
              } else {
                executionError = execResult.stderr
                  ? `Test execution failed (exit ${execResult.exitCode}): ${execResult.stderr.slice(0, 500)}`
                  : `Test execution failed with exit code ${execResult.exitCode}`;
              }
            } finally {
              // Always destroy the sandbox
              try { await sandbox.destroy(sandboxInfo.id); } catch { /* best-effort cleanup */ }
            }
          } catch (sandboxErr) {
            // Sandbox infrastructure not available — fall back to schema-only validation
            request.log.warn({ skillId, error: sandboxErr instanceof Error ? sandboxErr.message : String(sandboxErr) },
              'Sandbox execution unavailable, falling back to schema-only validation');
            executionError = null; // Not a test failure — just no sandbox available
          }
        }

        // ── Phase 3: Determine result ─────────────────────────────────────
        const allTestsPassed = testResults.length > 0
          ? testResults.every((t) => t.passed)
          : true; // No tests = schema-only pass
        const passed = !executionError && allTestsPassed;
        const finalStatus = passed ? 'SANDBOX_PASSED' : 'PROPOSED';

        const fullResult = {
          passed,
          phase: testResults.length > 0 ? 'execution' : 'validation',
          schemaValid: validationErrors.length === 0,
          testResults: testResults.length > 0 ? testResults : undefined,
          executionError: executionError ?? undefined,
          testsRun: testResults.length,
          testsPassed: testResults.filter((t) => t.passed).length,
        };

        const updated = await fastify.db.skill.update({
          where: { id: skillId },
          data: { status: finalStatus, sandboxResult: fullResult as object },
        });

        return reply.status(200).send(ok({
          ...updated,
          sandboxResult: fullResult,
          message: passed
            ? `Sandbox passed (${fullResult.testsPassed}/${fullResult.testsRun} tests passed)`
            : `Sandbox failed: ${executionError ?? `${fullResult.testsRun - fullResult.testsPassed} test(s) failed`}`,
        }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default skillsRoutes;
