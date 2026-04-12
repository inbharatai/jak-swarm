import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { config } from './config.js';
import { AppError } from './errors.js';

// Plugins
import dbPlugin from './plugins/db.plugin.js';
import redisPlugin from './plugins/redis.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import swarmPlugin from './plugins/swarm.plugin.js';

// Routes
import authRoutes from './routes/auth.routes.js';
import tenantsRoutes from './routes/tenants.routes.js';
import workflowsRoutes from './routes/workflows.routes.js';
import approvalsRoutes from './routes/approvals.routes.js';
import skillsRoutes from './routes/skills.routes.js';
import toolsRoutes from './routes/tools.routes.js';
import voiceRoutes from './routes/voice.routes.js';
import memoryRoutes from './routes/memory.routes.js';
import tracesRoutes from './routes/traces.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import llmSettingsRoutes from './routes/llm-settings.routes.js';
import schedulesRoutes from './routes/schedules.routes.js';
import { onboardingRoutes } from './routes/onboarding.routes.js';
import { integrationRoutes } from './routes/integrations.routes.js';
import projectsRoutes from './routes/projects.routes.js';
import layoutRoutes from './routes/layouts.routes.js';

async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    // Attach request id to all log lines
    genReqId: () => `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    // Global body size limit: 10MB (individual routes can override)
    bodyLimit: 10 * 1024 * 1024,
  });

  // -------------------------------------------------------------------------
  // Security & utility plugins
  // -------------------------------------------------------------------------
  await fastify.register(helmet, {
    // Allow Swagger UI iframes
    contentSecurityPolicy: config.nodeEnv === 'production' ? undefined : false,
  });

  await fastify.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(cookie);

  await fastify.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.jwtExpiresIn },
  });

  await fastify.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded. Please try again later.',
      },
    }),
  });

  // -------------------------------------------------------------------------
  // OpenAPI / Swagger
  // -------------------------------------------------------------------------
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'JAK Swarm API',
        description: 'Production-grade autonomous swarm agent platform API',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${config.port}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  // -------------------------------------------------------------------------
  // Application plugins
  // -------------------------------------------------------------------------
  await fastify.register(dbPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(authPlugin);
  await fastify.register(swarmPlugin);

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(tenantsRoutes, { prefix: '/tenants' });
  await fastify.register(workflowsRoutes, { prefix: '/workflows' });
  await fastify.register(approvalsRoutes, { prefix: '/approvals' });
  await fastify.register(skillsRoutes, { prefix: '/skills' });
  await fastify.register(toolsRoutes, { prefix: '/tools' });
  await fastify.register(voiceRoutes, { prefix: '/voice' });
  await fastify.register(memoryRoutes, { prefix: '/memory' });
  await fastify.register(tracesRoutes, { prefix: '/traces' });
  await fastify.register(analyticsRoutes, { prefix: '/analytics' });
  await fastify.register(llmSettingsRoutes, { prefix: '/settings/llm' });
  await fastify.register(schedulesRoutes, { prefix: '/schedules' });
  await fastify.register(onboardingRoutes);
  await fastify.register(integrationRoutes);
  await fastify.register(projectsRoutes, { prefix: '/projects' });
  await fastify.register(layoutRoutes, { prefix: '/layouts' });

  // -------------------------------------------------------------------------
  // Health check — probes DB + Redis connectivity
  // -------------------------------------------------------------------------
  fastify.get('/health', async (_request, reply) => {
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    // Database
    const dbStart = Date.now();
    try {
      await fastify.db.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (e) {
      checks.database = { status: 'error', latencyMs: Date.now() - dbStart, error: e instanceof Error ? e.message : String(e) };
    }

    // Redis
    const redisStart = Date.now();
    try {
      await fastify.redis.ping();
      checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
    } catch (e) {
      checks.redis = { status: 'error', latencyMs: Date.now() - redisStart, error: e instanceof Error ? e.message : String(e) };
    }

    const allHealthy = Object.values(checks).every((c) => c.status === 'ok');

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      environment: config.nodeEnv,
      checks,
    });
  });

  // -------------------------------------------------------------------------
  // Global error handler
  // -------------------------------------------------------------------------
  fastify.setErrorHandler((error: FastifyError & { details?: unknown }, request, reply) => {
    // Known application errors — return structured JSON, no stack trace
    if (error instanceof AppError) {
      request.log.warn({ code: error.code, statusCode: error.statusCode }, error.message);
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }

    // Fastify validation errors (JSON schema)
    if (error.validation) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation,
        },
      });
    }

    // JWT errors
    if (error.statusCode === 401) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: error.message },
      });
    }

    // Rate limit errors are already handled by the plugin; but catch here too
    if (error.statusCode === 429) {
      return reply.status(429).send({
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
      });
    }

    // Unhandled/unexpected errors — log full details server-side, return safe message
    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  // 404 handler
  fastify.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  return fastify;
}

// -------------------------------------------------------------------------
// Bootstrap
// -------------------------------------------------------------------------
async function main() {
  const fastify = await buildApp();

  const gracefulShutdown = async (signal: string) => {
    fastify.log.info({ signal }, 'Received shutdown signal, closing server...');
    try {
      await fastify.close();
      fastify.log.info('Server closed gracefully');
      process.exit(0);
    } catch (err) {
      fastify.log.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
  process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    fastify.log.info(
      { port: config.port, env: config.nodeEnv },
      `JAK Swarm API listening on port ${config.port}`,
    );
  } catch (err) {
    fastify.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

void main();

export { buildApp };
