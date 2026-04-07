import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ProjectService } from '../services/project.service.js';
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
  imageBase64: z.string().optional(),
});

const generateProjectSchema = z.object({
  description: z.string().min(1).max(5000),
  framework: z.string().max(50).optional(),
  templateId: z.string().max(100).optional(),
  imageBase64: z.string().optional(),
});

const rollbackSchema = z.object({
  version: z.number().int().positive(),
});

const updateFileSchema = z.object({
  content: z.string(),
});

const projectsRoutes: FastifyPluginAsync = async (fastify) => {
  const projectService = new ProjectService(fastify.db, fastify.log);
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
      const projects = await projectService.listProjects(tenantId, {
        page: query.page ? parseInt(query.page, 10) : 1,
        limit: query.limit ? parseInt(query.limit, 10) : 20,
        status: query.status,
      });
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

      const { description, framework, templateId, imageBase64 } = parseResult.data;

      try {
        // Update project status
        await projectService.updateProjectStatus(id, 'GENERATING');

        // Save user message to conversation
        await projectService.addConversation(id, 'user', description);

        // Fire-and-forget: run the vibe coding pipeline
        setImmediate(() => {
          void fastify.swarm.executeAsync({
            workflowId: `vibe-${id}-${Date.now()}`,
            tenantId,
            userId,
            goal: `[VIBE_CODING] Generate app for project ${id}: ${description}`,
            industry: framework ?? 'TECHNOLOGY',
          });
        });

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

      const { message } = parseResult.data;

      await projectService.addConversation(id, 'user', message);
      await projectService.updateProjectStatus(id, 'GENERATING');

      setImmediate(() => {
        void fastify.swarm.executeAsync({
          workflowId: `vibe-iter-${id}-${Date.now()}`,
          tenantId,
          userId,
          goal: `[VIBE_CODING_ITERATE] Modify project ${id}: ${message}`,
          industry: 'TECHNOLOGY',
        });
      });

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
        return reply.status(400).send(err('ROLLBACK_FAILED', (e as Error).message));
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
  fastify.get(
    '/:id/stream',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
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
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      send({ type: 'connected', projectId: id, status: project.status });

      // Listen for project events
      const handler = (event: unknown) => {
        send(event);
      };

      fastify.swarm.on(`project:${id}`, handler);

      // Heartbeat every 15s
      const heartbeat = setInterval(() => {
        reply.raw.write(': heartbeat\n\n');
      }, 15000);

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        fastify.swarm.off(`project:${id}`, handler);
      });
    },
  );
};

export default projectsRoutes;
