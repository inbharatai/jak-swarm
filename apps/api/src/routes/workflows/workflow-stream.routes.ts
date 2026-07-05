import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { err } from '../../types.js';

const workflowStreamRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /workflows/:workflowId/stream
   * SSE stream for real-time workflow updates.
   */
  fastify.get(
    '/:workflowId/stream',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Support legacy EventSource token query param if no Authorization header is present.
      const query = request.query as { token?: string };
      if (!request.headers.authorization && query.token) {
        request.headers.authorization = `Bearer ${query.token}`;
      }
      try {
        await fastify.authenticate(request, reply);
      } catch {
        return reply.code(401).send(err('UNAUTHORIZED', 'Unauthorized'));
      }

      const { workflowId } = request.params as { workflowId: string };
      const { tenantId } = request.user;

      // Verify workflow exists and belongs to tenant
      const workflow = await fastify.db.workflow.findFirst({
        where: { id: workflowId, tenantId },
      });
      if (!workflow) {
        return reply.code(404).send(err('NOT_FOUND', 'Workflow not found'));
      }

      // SSE stream — hijack the response so Fastify doesn't try to auto-close it
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      });

      // Send initial event
      const sendEvent = (data: unknown) => {
        try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
      };

      sendEvent({ type: 'connected', workflowId, status: workflow.status });

      // Replay already-persisted plan so reconnecting clients don't sit on
      // "Waiting for the planner..." when the plan was created before they
      // connected (common on network blip / reverse-proxy timeout).
      if (workflow.planJson) {
        try {
          const plan = typeof workflow.planJson === 'string'
            ? JSON.parse(workflow.planJson)
            : workflow.planJson;
          if (plan && Array.isArray(plan.tasks) && plan.tasks.length > 0) {
            sendEvent({ type: 'plan_created', workflowId, plan });
          }
        } catch {
          // Malformed planJson — non-fatal, live events will still fire.
        }
      }

      // If already terminal, close immediately
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(workflow.status)) {
        sendEvent({ type: workflow.status.toLowerCase(), workflowId });
        reply.raw.end();
        return;
      }

      // Listen for events from the execution service
      const handler = (event: unknown) => sendEvent(event);
      fastify.swarm.on(`workflow:${workflowId}`, handler);

      // TOCTOU race fix: a workflow can transition to terminal in the
      // window between the initial `findFirst` (line ~28) and the listener
      // attach just above — an event fired in that window has no listener
      // and is lost, so the client would hang on heartbeats forever waiting
      // for a terminal event it already missed. Re-query AFTER attaching
      // so a terminal transition in that window is caught and the stream
      // closes. (Mid-run events in the same tiny window can still be lost,
      // but plan_created is replayed from planJson above and the durable
      // GET /workflows/:id path is the fallback source of truth.) See
      // audit 2026-07-05.
      const latest = await fastify.db.workflow.findFirst({
        where: { id: workflowId, tenantId },
      });
      if (latest && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(latest.status)) {
        sendEvent({ type: latest.status.toLowerCase(), workflowId });
        fastify.swarm.removeListener(`workflow:${workflowId}`, handler);
        reply.raw.end();
        return;
      }

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try { reply.raw.write(`: heartbeat\n\n`); } catch { clearInterval(heartbeat); }
      }, 15000);

      // Cleanup on close
      request.raw.on('close', () => {
        fastify.swarm.removeListener(`workflow:${workflowId}`, handler);
        clearInterval(heartbeat);
      });
    },
  );
};

export default workflowStreamRoutes;
