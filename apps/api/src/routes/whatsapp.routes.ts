import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { ok, err } from '../types.js';
import crypto from 'crypto';

const commandBodySchema = z.object({
  from: z.string().min(1),
  text: z.string().max(2000).optional(),
});

const registerBodySchema = z.object({
  number: z.string().min(6).max(32),
});

type CommandContext = {
  tenantId: string;
  userId: string;
};

type LinkStatus = 'PENDING' | 'VERIFIED' | 'EXPIRED';

type WhatsAppStatus = 'starting' | 'qr' | 'connected' | 'disconnected' | 'error';

function normalizeNumber(value: string): string {
  return value
    .replace(/^whatsapp:/i, '')
    .replace('@s.whatsapp.net', '')
    .replace(/\D/g, '');
}

function isValidNumber(normalized: string): boolean {
  return normalized.length >= 8 && normalized.length <= 15;
}

function toE164(normalized: string): string {
  return normalized ? `+${normalized}` : '';
}

function generateChallengeCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

function resolveLinkStatus(link: { status: string; challengeExpiresAt: Date | null }): LinkStatus {
  if (link.status === 'VERIFIED') return 'VERIFIED';
  if (!link.challengeExpiresAt) return link.status === 'PENDING' ? 'PENDING' : 'EXPIRED';
  return link.challengeExpiresAt.getTime() > Date.now() ? 'PENDING' : 'EXPIRED';
}

async function resolveCommandContext(
  fastify: Parameters<FastifyPluginAsync>[0],
  from: string,
): Promise<CommandContext | null> {
  const normalized = normalizeNumber(from);
  if (!normalized) return null;

  const dbEntry = await fastify.db.whatsappLink.findUnique({
    where: { phoneNumber: normalized },
  });
  if (dbEntry && dbEntry.status === 'VERIFIED') {
    return { tenantId: dbEntry.tenantId, userId: dbEntry.userId };
  }

  const configEntry = config.whatsappNumberMap.find((item) => item.number === normalized);
  if (!configEntry) return null;
  return { tenantId: configEntry.tenantId, userId: configEntry.userId };
}

function hasBridgeToken(request: FastifyRequest): boolean {
  if (!config.whatsappBridgeToken) return false;
  const authHeader = request.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) return false;
  return authHeader.slice('Bearer '.length).trim() === config.whatsappBridgeToken;
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return value.slice(0, length - 3) + '...';
}

async function fetchWhatsappStatus(): Promise<{ status: WhatsAppStatus; qr?: string; message?: string }> {
  const url = `http://localhost:${config.whatsappClientPort}/status`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) {
      return { status: 'disconnected', message: 'whatsapp-client not running' };
    }
    const payload = (await resp.json()) as { status?: WhatsAppStatus; qr?: string; message?: string };
    return {
      status: payload.status ?? 'disconnected',
      qr: payload.qr,
      message: payload.message,
    };
  } catch {
    return {
      status: 'disconnected',
      message: 'whatsapp-client not running — start with: pnpm --filter @jak-swarm/whatsapp-client dev',
    };
  }
}

async function handleListCommand(fastify: Parameters<FastifyPluginAsync>[0], ctx: CommandContext, status?: string): Promise<string> {
  const where: { tenantId: string; status?: string } = { tenantId: ctx.tenantId };
  if (status) where.status = status.toUpperCase();

  const workflows = await fastify.db.workflow.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: 5,
  });

  if (workflows.length === 0) {
    return 'No workflows found for this tenant.';
  }

  const lines = workflows.map((wf) =>
    `• ${wf.id.slice(0, 8)} ${wf.status} — ${truncate(wf.goal ?? 'No goal', 64)}`,
  );

  return `Latest workflows (${workflows.length}):\n${lines.join('\n')}`;
}

async function handleStatusCommand(fastify: Parameters<FastifyPluginAsync>[0], ctx: CommandContext, workflowId?: string): Promise<string> {
  if (!workflowId) return 'Usage: status WORKFLOW_ID';
  const workflow = await fastify.db.workflow.findFirst({
    where: { id: workflowId, tenantId: ctx.tenantId },
  });
  if (!workflow) return `Workflow not found: ${workflowId}`;

  return [
    `Workflow ${workflow.id} — ${workflow.status}`,
    `Goal: ${truncate(workflow.goal ?? 'No goal', 140)}`,
  ].join('\n');
}

async function pauseWorkflow(fastify: Parameters<FastifyPluginAsync>[0], ctx: CommandContext, workflowId?: string): Promise<string> {
  if (!workflowId) return 'Usage: pause WORKFLOW_ID';

  const workflow = await fastify.db.workflow.findFirst({
    where: { id: workflowId, tenantId: ctx.tenantId },
  });
  if (!workflow) return `Workflow not found: ${workflowId}`;

  if (workflow.status !== 'RUNNING' && workflow.status !== 'EXECUTING') {
    return `Cannot pause workflow in ${workflow.status} status.`;
  }

  fastify.swarm.pauseWorkflow(workflowId);
  await fastify.coordination.signals.publish({
    type: 'pause',
    workflowId,
    issuedBy: ctx.userId,
    timestamp: new Date().toISOString(),
  });

  await fastify.db.workflow.update({
    where: { id: workflowId },
    data: { status: 'PAUSED' },
  });

  fastify.swarm.emit(`workflow:${workflowId}`, {
    type: 'paused',
    workflowId,
    timestamp: new Date().toISOString(),
  });

  return 'Workflow will pause after current node completes.';
}

async function unpauseWorkflow(fastify: Parameters<FastifyPluginAsync>[0], ctx: CommandContext, workflowId?: string): Promise<string> {
  if (!workflowId) return 'Usage: resume WORKFLOW_ID';

  const workflow = await fastify.db.workflow.findFirst({
    where: { id: workflowId, tenantId: ctx.tenantId },
  });
  if (!workflow) return `Workflow not found: ${workflowId}`;

  if (workflow.status !== 'PAUSED') {
    return `Cannot resume workflow in ${workflow.status} status.`;
  }

  // Broadcast unpause signal — whichever instance holds the paused workflow will resume it
  // under a distributed lock. Local unpauseWorkflow is idempotent and kept for single-instance path.
  fastify.swarm.unpauseWorkflow(workflowId);
  await fastify.coordination.signals.publish({
    type: 'unpause',
    workflowId,
    issuedBy: ctx.userId,
    timestamp: new Date().toISOString(),
  });
  await fastify.db.workflow.update({
    where: { id: workflowId },
    data: { status: 'RUNNING' },
  });

  return 'Workflow resumed.';
}

async function stopWorkflow(fastify: Parameters<FastifyPluginAsync>[0], ctx: CommandContext, workflowId?: string): Promise<string> {
  if (!workflowId) return 'Usage: stop WORKFLOW_ID';

  const workflow = await fastify.db.workflow.findFirst({
    where: { id: workflowId, tenantId: ctx.tenantId },
  });
  if (!workflow) return `Workflow not found: ${workflowId}`;

  fastify.swarm.stopWorkflow(workflowId);
  await fastify.coordination.signals.publish({
    type: 'stop',
    workflowId,
    issuedBy: ctx.userId,
    timestamp: new Date().toISOString(),
  });

  await fastify.db.workflow.update({
    where: { id: workflowId },
    data: { status: 'CANCELLED', error: 'Stopped via WhatsApp', completedAt: new Date() },
  });

  return 'Workflow stopped.';
}

async function handleCommand(
  fastify: Parameters<FastifyPluginAsync>[0],
  ctx: CommandContext,
  text: string,
): Promise<string> {
  const trimmed = text.trim();
  const [command, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ').trim();

  if (!command || command === 'help') {
    return [
      'JAK Swarm — WhatsApp Control',
      '',
      'Commands:',
      '  help',
      '  list [STATUS]',
      '  status WORKFLOW_ID',
      '  pause WORKFLOW_ID',
      '  resume WORKFLOW_ID',
      '  stop WORKFLOW_ID',
    ].join('\n');
  }

  switch (command.toLowerCase()) {
    case 'list':
      return handleListCommand(fastify, ctx, arg || undefined);
    case 'status':
      return handleStatusCommand(fastify, ctx, arg || undefined);
    case 'pause':
      return pauseWorkflow(fastify, ctx, arg || undefined);
    case 'resume':
    case 'unpause':
      return unpauseWorkflow(fastify, ctx, arg || undefined);
    case 'stop':
      return stopWorkflow(fastify, ctx, arg || undefined);
    default:
      return `Unknown command: ${command}. Send "help" for available commands.`;
  }
}

const whatsappRoutes: FastifyPluginAsync = async (fastify) => {
  const challengeTtlMs = 10 * 60 * 1000;

  fastify.get(
    '/number',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.user;
      const link = await fastify.db.whatsappLink.findFirst({
        where: { tenantId, userId },
      });

      if (!link) {
        return reply.status(200).send(ok({ number: null, status: 'PENDING' }));
      }

      const status = resolveLinkStatus({
        status: link.status,
        challengeExpiresAt: link.challengeExpiresAt,
      });

      return reply.status(200).send(ok({
        number: link.phoneNumber ? toE164(link.phoneNumber) : null,
        status,
        verificationCode: status === 'PENDING' ? link.challengeCode : null,
        expiresAt: link.challengeExpiresAt?.toISOString() ?? null,
        verifiedAt: link.verifiedAt?.toISOString() ?? null,
      }));
    },
  );

  fastify.post(
    '/number',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = registerBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { tenantId, userId } = request.user;
      const normalized = normalizeNumber(parseResult.data.number);
      if (!isValidNumber(normalized)) {
        return reply.status(422).send(err('INVALID_NUMBER', 'Phone number must include country code (8-15 digits).'));
      }

      const existing = await fastify.db.whatsappLink.findUnique({
        where: { phoneNumber: normalized },
      });

      if (existing && (existing.tenantId !== tenantId || existing.userId !== userId)) {
        return reply.status(409).send(err('NUMBER_IN_USE', 'That WhatsApp number is already linked to another account.'));
      }

      if (existing && existing.tenantId === tenantId && existing.userId === userId && existing.status === 'VERIFIED') {
        return reply.status(200).send(ok({
          number: toE164(existing.phoneNumber),
          status: 'VERIFIED',
          verificationCode: null,
          expiresAt: null,
          verifiedAt: existing.verifiedAt?.toISOString() ?? null,
        }));
      }

      const challengeCode = generateChallengeCode();
      const challengeExpiresAt = new Date(Date.now() + challengeTtlMs);

      const link = await fastify.db.whatsappLink.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        update: {
          phoneNumber: normalized,
          status: 'PENDING',
          challengeCode,
          challengeExpiresAt,
          verifiedAt: null,
        },
        create: {
          tenantId,
          userId,
          phoneNumber: normalized,
          status: 'PENDING',
          challengeCode,
          challengeExpiresAt,
        },
      });

      return reply.status(200).send(ok({
        number: toE164(link.phoneNumber),
        status: 'PENDING',
        verificationCode: link.challengeCode,
        expiresAt: link.challengeExpiresAt?.toISOString() ?? null,
        verifiedAt: null,
      }));
    },
  );

  fastify.delete(
    '/number',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.user;
      await fastify.db.whatsappLink.deleteMany({ where: { tenantId, userId } });
      return reply.status(204).send();
    },
  );

  fastify.get(
    '/status',
    { preHandler: [fastify.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const status = await fetchWhatsappStatus();
      return reply.status(200).send(ok(status));
    },
  );

  fastify.get(
    '/qr.png',
    { preHandler: [fastify.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const url = `http://localhost:${config.whatsappClientPort}/qr.png`;
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (!resp.ok) {
          return reply.status(204).send();
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        reply.header('Content-Type', 'image/png');
        reply.header('Content-Length', String(buf.length));
        return reply.status(200).send(buf);
      } catch {
        return reply.status(204).send();
      }
    },
  );

  fastify.post(
    '/command',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = commandBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      if (!config.whatsappBridgeToken) {
        return reply.status(503).send(err('WHATSAPP_NOT_CONFIGURED', 'WHATSAPP_BRIDGE_TOKEN is required'));
      }

      if (!hasBridgeToken(request)) {
        return reply.status(401).send(err('UNAUTHORIZED', 'Invalid WhatsApp bridge token'));
      }

      const { from, text } = parseResult.data;
      const normalized = normalizeNumber(from);
      if (!normalized) {
        return reply.status(200).send(ok({ ignore: true }));
      }

      const link = await fastify.db.whatsappLink.findUnique({
        where: { phoneNumber: normalized },
      });

      if (link && link.status !== 'VERIFIED') {
        const status = resolveLinkStatus({
          status: link.status,
          challengeExpiresAt: link.challengeExpiresAt,
        });

        const payloadText = text?.trim() ?? '';
        const normalizedText = payloadText.replace(/\s+/g, ' ').trim();
        const expected = link.challengeCode ?? '';

        if (status === 'PENDING' && expected && (normalizedText === expected || normalizedText === `verify ${expected}`)) {
          await fastify.db.whatsappLink.update({
            where: { id: link.id },
            data: {
              status: 'VERIFIED',
              verifiedAt: new Date(),
              challengeCode: null,
              challengeExpiresAt: null,
            },
          });
          return reply.status(200).send(ok({ reply: '✅ Number verified. Send "help" to see commands.' }));
        }

        return reply.status(200).send(ok({ ignore: true }));
      }

      const ctx = await resolveCommandContext(fastify, from);
      if (!ctx) {
        return reply.status(200).send(ok({ ignore: true }));
      }

      try {
        const replyText = await handleCommand(fastify, ctx, text ?? '');
        return reply.status(200).send(ok({ reply: replyText }));
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Command failed';
        return reply.status(500).send(err('WHATSAPP_COMMAND_FAILED', message));
      }
    },
  );
};

export default whatsappRoutes;
