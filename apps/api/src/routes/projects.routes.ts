import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ProjectService } from '../services/project.service.js';
import { VibeCodingExecutionService } from '../services/vibe-coding-execution.service.js';
import { enforceTenantIsolation } from '../middleware/tenant-isolation.js';
import { ok, err } from '../types.js';
import { AppError } from '../errors.js';

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  framework: z.enum(['nextjs', 'react-spa', 'react-native', 'fastify-api']).optional(),
  templateId: z.string().max(100).optional(),
});

const iterateProjectSchema = z.object({
  message: z.string().min(1).max(5000),
  imageBase64: z.string().max(10_000_000).optional(), // FIX #10: max 10MB base64
});

const generateProjectSchema = z.object({
  description: z.string().min(1).max(5000),
  framework: z.string().max(50).optional(),
  templateId: z.string().max(100).optional(),
  imageBase64: z.string().max(10_000_000).optional(), // FIX: max 10MB base64
});

const rollbackSchema = z.object({
  version: z.number().int().positive(),
});

const updateFileSchema = z.object({
  content: z.string().max(5_000_000), // FIX: 5MB max file content
});

// FIX #6: Statuses that block concurrent generation
const BUSY_STATUSES = ['GENERATING', 'BUILDING'];

const projectsRoutes: FastifyPluginAsync = async (fastify) => {
  const projectService = new ProjectService(fastify.db, fastify.log);
  const vibeCoding = new VibeCodingExecutionService(fastify.db, fastify.log);
  const preHandler = [fastify.authenticate, enforceTenantIsolation];

  // ─── POST /projects ──────────────────────────────────────────────────
  fastify.post(
    '/',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createProjectSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request', parseResult.error.flatten()));
      }
      const { name, description, framework, templateId } = parseResult.data;
      const { tenantId, userId } = request.user;

      try {
        const project = await projectService.createProject(tenantId, userId, name, description, framework, templateId);
        await fastify.auditLog(request, 'CREATE_PROJECT', 'Project', project.id, { name });
        return reply.status(201).send(ok(project));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  // ─── GET /projects ───────────────────────────────────────────────────
  fastify.get(
    '/',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { page?: string; limit?: string; status?: string };
      const { tenantId } = request.user;
      const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
      const limit = Math.max(1, Math.min(parseInt(query.limit ?? '20', 10) || 20, 100));
      const projects = await projectService.listProjects(tenantId, { page, limit, status: query.status });
      return reply.send(ok(projects));
    },
  );

  // ─── GET /projects/:id ──────────────────────────────────────────────
  fastify.get(
    '/:id',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));
      return reply.send(ok(project));
    },
  );

  // ─── DELETE /projects/:id ───────────────────────────────────────────
  // FIX #11: Missing delete endpoint
  fastify.delete(
    '/:id',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));

      try {
        await projectService.deleteProject(tenantId, id);
        await fastify.auditLog(request, 'DELETE_PROJECT', 'Project', id);
        return reply.send(ok({ deleted: true }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  // ─── POST /projects/:id/generate ────────────────────────────────────
  fastify.post(
    '/:id/generate',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parseResult = generateProjectSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request', parseResult.error.flatten()));
      }

      const { tenantId, userId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));

      // FIX #6: Concurrency guard — reject if already generating
      if (BUSY_STATUSES.includes(project.status)) {
        return reply.status(409).send(err('CONFLICT', 'Project is already being generated. Please wait for the current operation to complete.'));
      }

      const { description, framework, templateId, imageBase64 } = parseResult.data;

      try {
        // Save user message to conversation
        await projectService.addConversation(id, 'user', description);

        // Fire-and-forget: run the vibe coding pipeline
        // FIX #4: Use once() instead of on() to prevent listener leak
        setImmediate(() => {
          void vibeCoding.generateProject({
            projectId: id,
            tenantId,
            userId,
            description,
            framework,
            templateId,
            imageBase64,
          });
        });

        // FIX #4: Forward events with once-per-event pattern, cleaned up by SSE endpoint
        const forwardHandler = (event: unknown) => {
          fastify.swarm.emit(`project:${id}`, event);
        };
        vibeCoding.on(`project:${id}`, forwardHandler);
        // Clean up after terminal event
        const cleanup = (event: Record<string, unknown>) => {
          if (event.type === 'generation_completed' || event.type === 'generation_failed') {
            vibeCoding.off(`project:${id}`, forwardHandler);
            vibeCoding.off(`project:${id}`, cleanup);
          }
        };
        vibeCoding.on(`project:${id}`, cleanup);

        await fastify.auditLog(request, 'GENERATE_PROJECT', 'Project', id, { description });
        return reply.status(202).send(ok({ projectId: id, status: 'GENERATING', message: 'Generation started' }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  // ─── POST /projects/:id/iterate ─────────────────────────────────────
  fastify.post(
    '/:id/iterate',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parseResult = iterateProjectSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request', parseResult.error.flatten()));
      }

      const { tenantId, userId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));

      // FIX #6: Concurrency guard
      if (BUSY_STATUSES.includes(project.status)) {
        return reply.status(409).send(err('CONFLICT', 'Project is currently busy. Please wait.'));
      }

      // FIX #10: Extract BOTH message AND imageBase64
      const { message, imageBase64 } = parseResult.data;

      await projectService.addConversation(id, 'user', message);

      setImmediate(() => {
        void vibeCoding.iterateProject({
          projectId: id,
          tenantId,
          userId,
          message,
          imageBase64,
        });
      });

      // FIX #4: Same cleanup pattern as generate
      const forwardHandler = (event: unknown) => {
        fastify.swarm.emit(`project:${id}`, event);
      };
      vibeCoding.on(`project:${id}`, forwardHandler);
      const cleanup = (event: Record<string, unknown>) => {
        if (event.type === 'iteration_completed' || event.type === 'iteration_failed') {
          vibeCoding.off(`project:${id}`, forwardHandler);
          vibeCoding.off(`project:${id}`, cleanup);
        }
      };
      vibeCoding.on(`project:${id}`, cleanup);

      return reply.status(202).send(ok({ projectId: id, status: 'GENERATING', message: 'Iteration started' }));
    },
  );

  // ─── POST /projects/:id/deploy ──────────────────────────────────────
  fastify.post(
    '/:id/deploy',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId, userId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));

      if (BUSY_STATUSES.includes(project.status)) {
        return reply.status(409).send(err('CONFLICT', 'Project is currently busy.'));
      }

      setImmediate(() => {
        void fastify.swarm.executeAsync({
          workflowId: `vibe-deploy-${id}-${Date.now()}`,
          tenantId,
          userId,
          goal: `[VIBE_CODING_DEPLOY] Deploy project ${id} to Vercel`,
          industry: 'TECHNOLOGY',
        });
      });

      await fastify.auditLog(request, 'DEPLOY_PROJECT', 'Project', id);
      return reply.status(202).send(ok({ projectId: id, status: 'DEPLOYING', message: 'Deployment started' }));
    },
  );

  // ─── POST /projects/:id/rollback ────────────────────────────────────
  fastify.post(
    '/:id/rollback',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parseResult = rollbackSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request', parseResult.error.flatten()));
      }

      const { tenantId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));

      try {
        const version = await projectService.rollbackToVersion(id, parseResult.data.version);
        await fastify.auditLog(request, 'ROLLBACK_PROJECT', 'Project', id, { version: parseResult.data.version });
        return reply.send(ok(version));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Rollback failed';
        return reply.status(400).send(err('ROLLBACK_FAILED', msg));
      }
    },
  );

  // ─── GET /projects/:id/files ────────────────────────────────────────
  fastify.get(
    '/:id/files',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));

      const files = await projectService.getFiles(id);
      return reply.send(ok(files));
    },
  );

  // ─── PUT /projects/:id/files/:path ──────────────────────────────────
  fastify.put(
    '/:id/files/*',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const filePath = (request.params as Record<string, string>)['*'];
      if (!filePath) return reply.status(400).send(err('VALIDATION_ERROR', 'File path required'));

      // FIX: Prevent path traversal
      if (filePath.includes('..') || filePath.startsWith('/')) {
        return reply.status(400).send(err('VALIDATION_ERROR', 'Invalid file path'));
      }

      const parseResult = updateFileSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request', parseResult.error.flatten()));
      }

      const { tenantId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));

      try {
        const file = await projectService.updateFile(id, filePath, parseResult.data.content);
        return reply.send(ok(file));
      } catch {
        return reply.status(404).send(err('NOT_FOUND', 'File not found'));
      }
    },
  );

  // ─── GET /projects/:id/versions ─────────────────────────────────────
  fastify.get(
    '/:id/versions',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));

      const versions = await projectService.getVersions(id);
      return reply.send(ok(versions));
    },
  );

  // ─── GET /projects/:id/conversations ────────────────────────────────
  fastify.get(
    '/:id/conversations',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));

      const conversations = await projectService.getConversations(id);
      return reply.send(ok(conversations));
    },
  );

  // ─── GET /projects/:id/stream ───────────────────────────────────────
  // FIX #1: Support both Authorization header AND query param token for EventSource
  fastify.get(
    '/:id/stream',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      // FIX #1: EventSource can't set headers, so accept token from query param
      const query = request.query as { token?: string };
      if (query.token) {
        // Manually set the Authorization header so fastify.authenticate works
        request.headers.authorization = `Bearer ${query.token}`;
      }

      // Now authenticate
      try {
        await fastify.authenticate(request, reply);
        enforceTenantIsolation(request, reply, () => {});
      } catch {
        return reply.status(401).send(err('UNAUTHORIZED', 'Invalid or missing token'));
      }

      const { tenantId } = request.user;
      const project = await projectService.getProject(tenantId, id);
      if (!project) return reply.status(404).send(err('NOT_FOUND', 'Project not found'));

      // SSE stream
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const send = (data: unknown) => {
        try {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          // Client disconnected
        }
      };

      send({ type: 'connected', projectId: id, status: project.status });

      const handler = (event: unknown) => {
        send(event);
      };

      fastify.swarm.on(`project:${id}`, handler);

      // Heartbeat every 15s
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(': heartbeat\n\n');
        } catch {
          // Client disconnected
        }
      }, 15000);

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        fastify.swarm.off(`project:${id}`, handler);
      });
    },
  );
};

export default projectsRoutes;
